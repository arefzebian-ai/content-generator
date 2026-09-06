import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { getDb } from "./db.js";
import {
  createOrAttachJob,
  fingerprint,
  isTerminal,
  parseResult,
  updateJob,
  withJobLock,
  type JobRow,
} from "./jobs.js";
import {
  analyzeUserRendering,
  fileToBase64,
  generateConceptImage,
  generateConceptImageFallback,
  generatePlan,
  isolateObjectImage,
  layoutFromConceptImage,
  refineConceptImage,
  saveImageBuffer,
} from "./images.js";
import { boxToTransform, isFloatingObject, bestLibraryMatch } from "./layout.js";
import {
  createImageTo3dTask,
  downloadMeshyResult,
  getImageTo3dTask,
  imageFileToDataUri,
  pollUntilDone,
} from "./meshy.js";
import { DATA_DIR, LIBRARY_DIR, STAGE_PLATES_DIR } from "./paths.js";
import {
  NEWTON_DESCRIPTION,
  sampleStage,
  type PlannedObject,
  type Stage,
  type StyleFamily,
} from "./types.js";

export function createScene(opts?: {
  name?: string;
  description?: string;
  stage?: Stage;
}) {
  const id = uuid();
  const now = Date.now();
  const stage = opts?.stage ?? sampleStage();
  const name = opts?.name ?? "Newton Discovers Gravity";
  const description = opts?.description ?? NEWTON_DESCRIPTION;
  getDb()
    .prepare(
      `INSERT INTO scenes (id, name, description, stage_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
    )
    .run(id, name, description, JSON.stringify(stage), now, now);
  return getScene(id)!;
}

export function listScenes() {
  return getDb()
    .prepare("SELECT id, name, description, status, created_at, updated_at FROM scenes ORDER BY updated_at DESC")
    .all();
}

export function getScene(id: string) {
  const row = getDb().prepare("SELECT * FROM scenes WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return hydrateScene(row);
}

function hydrateScene(row: Record<string, unknown>) {
  const concepts = getDb()
    .prepare("SELECT * FROM concepts WHERE scene_id = ? ORDER BY created_at ASC")
    .all(row.id as string) as Array<Record<string, unknown>>;
  const objects = getDb()
    .prepare("SELECT * FROM scene_objects WHERE scene_id = ? ORDER BY created_at ASC")
    .all(row.id as string) as Array<Record<string, unknown>>;

  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    stage: (() => {
      const stage = JSON.parse(row.stage_json as string) as Stage;
      if (!stage.shape) {
        stage.shape = "polygon";
      }
      return stage;
    })(),
    styleFamily: row.style_family_json
      ? (JSON.parse(row.style_family_json as string) as StyleFamily)
      : null,
    approvedConceptId: (row.approved_concept_id as string) || null,
    status: row.status as string,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    concepts: concepts.map((c) => ({
      id: c.id as string,
      source: c.source as string,
      title: c.title as string,
      summary: c.summary as string,
      imageUrl: c.image_path ? publicFileUrl(c.image_path as string) : null,
      imagePath: c.image_path as string | null,
      objects: JSON.parse(c.objects_json as string) as PlannedObject[],
      styleFamily: c.style_family_json
        ? (JSON.parse(c.style_family_json as string) as StyleFamily)
        : null,
      createdAt: c.created_at as number,
    })),
    objects: objects.map((o) => ({
      id: o.id as string,
      name: o.name as string,
      role: o.role as string,
      box: JSON.parse(o.box_json as string),
      isolateImageUrl: o.isolate_image_path
        ? publicFileUrl(o.isolate_image_path as string)
        : null,
      status: o.status as string,
      assetId: o.asset_id as string | null,
      assetVersion: o.asset_version as number | null,
      transform: o.transform_json ? JSON.parse(o.transform_json as string) : null,
      generationSettings: o.generation_settings_json
        ? JSON.parse(o.generation_settings_json as string)
        : null,
      glbUrl:
        o.asset_id && o.asset_version
          ? assetGlbUrl(o.asset_id as string, o.asset_version as number)
          : null,
    })),
    progress: (() => {
      const tracked = objects.filter(
        (o) => (o.role as string) !== "foundation" && (o.status as string) !== "procedural",
      );
      const ready = tracked.filter((o) => (o.status as string) === "ready").length;
      const failed = tracked.filter((o) => (o.status as string) === "failed").length;
      const active = tracked.filter((o) =>
        ["queued", "isolating", "meshing", "planned", "isolated"].includes(o.status as string),
      ).length;
      const current = tracked.find((o) =>
        ["isolating", "meshing", "queued"].includes(o.status as string),
      );
      return {
        total: tracked.length,
        ready,
        failed,
        active,
        percent: tracked.length ? Math.round(((ready + failed) / tracked.length) * 100) : 0,
        label:
          current
            ? `${current.name as string}: ${current.status as string} (${ready}/${tracked.length} done)`
            : failed && ready + failed === tracked.length
              ? `Done with ${failed} failure(s)`
              : ready === tracked.length && tracked.length > 0
                ? "All assets ready"
                : tracked.length
                  ? `${ready}/${tracked.length} ready`
                  : null,
      };
    })(),
  };
}

export function updateScene(
  id: string,
  patch: Partial<{ name: string; description: string; stage: Stage }>,
) {
  const scene = getScene(id);
  if (!scene) throw new Error("Scene not found");
  getDb()
    .prepare(
      `UPDATE scenes SET name = ?, description = ?, stage_json = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      patch.name ?? scene.name,
      patch.description ?? scene.description,
      JSON.stringify(patch.stage ?? scene.stage),
      Date.now(),
      id,
    );
  return getScene(id)!;
}

export function saveStagePlate(sceneId: string, buffer: Buffer) {
  fs.mkdirSync(STAGE_PLATES_DIR, { recursive: true });
  const full = path.join(STAGE_PLATES_DIR, `${sceneId}.png`);
  fs.writeFileSync(full, buffer);
  return full;
}

export async function generateConcepts(sceneId: string, stagePlatePath?: string) {
  const scene = getScene(sceneId);
  if (!scene) throw new Error("Scene not found");

  const planFp = fingerprint({
    kind: "plan",
    description: scene.description,
    stage: scene.stage,
  });

  const planJob = await withJobLock("openai_plan", planFp, async () => {
    const { job, created } = createOrAttachJob({
      kind: "openai_plan",
      fingerprint: planFp,
      sceneId,
      input: { description: scene.description, stage: scene.stage },
    });
    if (job.status === "SUCCEEDED") return job;
    if (!created && job.status === "IN_PROGRESS") {
      // wait briefly for sibling
      return waitJob(job.id);
    }
    updateJob(job.id, { status: "IN_PROGRESS", progress: 10 });
    try {
      const plan = await generatePlan(scene.description, scene.stage);
      updateJob(job.id, {
        status: "SUCCEEDED",
        progress: 100,
        result_json: JSON.stringify(plan),
      });
      return getJob(job.id)!;
    } catch (e) {
      updateJob(job.id, {
        status: "FAILED",
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  });

  const plan = parseResult<{
    styleFamily: StyleFamily;
    concepts: Array<{ title: string; summary: string; objects: PlannedObject[] }>;
  }>(planJob)!;

  getDb()
    .prepare(`UPDATE scenes SET style_family_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(plan.styleFamily), Date.now(), sceneId);

  // Clear previous AI concepts for regen; keep user uploads.
  getDb()
    .prepare(
      `DELETE FROM concepts WHERE scene_id = ? AND source IN ('openai', 'gemini')`,
    )
    .run(sceneId);

  let plateB64: string | undefined;
  let plateMime: string | undefined;
  if (stagePlatePath && fs.existsSync(stagePlatePath)) {
    const f = fileToBase64(stagePlatePath);
    plateB64 = f.data;
    plateMime = f.mimeType;
  }

  const createdConcepts = [];
  for (let i = 0; i < Math.min(3, plan.concepts.length); i++) {
    const brief = plan.concepts[i];
    const imgFp = fingerprint({
      kind: "concept",
      description: scene.description,
      styleId: plan.styleFamily.id,
      title: brief.title,
      summary: brief.summary,
      objects: brief.objects,
      plate: plateB64 ? fingerprint(plateB64.slice(0, 200)) : null,
    });

    const imageJob = await withJobLock("openai_concept", imgFp, async () => {
      const { job, created } = createOrAttachJob({
        kind: "openai_concept",
        fingerprint: imgFp,
        sceneId,
        input: { title: brief.title },
      });
      if (job.status === "SUCCEEDED") return job;
      updateJob(job.id, { status: "IN_PROGRESS", progress: 20 });
      try {
        let image;
        try {
          image = await generateConceptImage({
            description: scene.description,
            stage: scene.stage,
            styleFamily: plan.styleFamily,
            concept: brief,
            stagePlateBase64: plateB64,
            stagePlateMime: plateMime,
          });
        } catch {
          image = await generateConceptImageFallback({
            description: scene.description,
            stage: scene.stage,
            styleFamily: plan.styleFamily,
            concept: brief,
            stagePlateBase64: plateB64,
            stagePlateMime: plateMime,
          });
        }
        const imagePath = saveImageBuffer(image.buffer, image.mimeType, `concept-${i}`);
        updateJob(job.id, {
          status: "SUCCEEDED",
          progress: 100,
          result_json: JSON.stringify({ imagePath }),
        });
        return getJob(job.id)!;
      } catch (e) {
        updateJob(job.id, {
          status: "FAILED",
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    });

    const { imagePath } = parseResult<{ imagePath: string }>(imageJob)!;
    const conceptId = uuid();
    getDb()
      .prepare(
        `INSERT INTO concepts (id, scene_id, source, title, summary, image_path, objects_json, style_family_json, created_at)
         VALUES (?, ?, 'openai', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        conceptId,
        sceneId,
        brief.title,
        brief.summary,
        imagePath,
        JSON.stringify(brief.objects),
        JSON.stringify(plan.styleFamily),
        Date.now(),
      );
    createdConcepts.push(conceptId);
  }

  touchScene(sceneId);
  return getScene(sceneId)!;
}

export async function regenerateOneConcept(sceneId: string, conceptId: string) {
  const scene = getScene(sceneId);
  if (!scene) throw new Error("Scene not found");
  const concept = scene.concepts.find((c) => c.id === conceptId);
  if (!concept) throw new Error("Concept not found");
  if (!scene.styleFamily) throw new Error("No style family yet");

  const platePath = path.join(STAGE_PLATES_DIR, `${sceneId}.png`);
  let plateB64: string | undefined;
  let plateMime: string | undefined;
  if (fs.existsSync(platePath)) {
    const f = fileToBase64(platePath);
    plateB64 = f.data;
    plateMime = f.mimeType;
  }

  // Force new fingerprint with attempt
  const imgFp = fingerprint({
    kind: "concept-regen",
    conceptId,
    attempt: Date.now(),
    title: concept.title,
  });

  await withJobLock("openai_concept", imgFp, async () => {
    const { job } = createOrAttachJob({
      kind: "openai_concept",
      fingerprint: imgFp,
      sceneId,
    });
    updateJob(job.id, { status: "IN_PROGRESS" });
    try {
      let image;
      try {
        image = await generateConceptImage({
          description: scene.description,
          stage: scene.stage,
          styleFamily: scene.styleFamily!,
          concept: {
            title: concept.title,
            summary: concept.summary,
            objects: concept.objects,
          },
          stagePlateBase64: plateB64,
          stagePlateMime: plateMime,
        });
      } catch {
        image = await generateConceptImageFallback({
          description: scene.description,
          stage: scene.stage,
          styleFamily: scene.styleFamily!,
          concept: {
            title: concept.title,
            summary: concept.summary,
            objects: concept.objects,
          },
          stagePlateBase64: plateB64,
          stagePlateMime: plateMime,
        });
      }
      const imagePath = saveImageBuffer(image.buffer, image.mimeType, "concept-regen");
      getDb()
        .prepare(`UPDATE concepts SET image_path = ? WHERE id = ?`)
        .run(imagePath, conceptId);
      updateJob(job.id, {
        status: "SUCCEEDED",
        progress: 100,
        result_json: JSON.stringify({ imagePath }),
      });
    } catch (e) {
      updateJob(job.id, {
        status: "FAILED",
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  });

  touchScene(sceneId);
  return getScene(sceneId)!;
}

export async function refineConcept(sceneId: string, conceptId: string, instruction: string) {
  const scene = getScene(sceneId);
  if (!scene) throw new Error("Scene not found");
  const concept = scene.concepts.find((c) => c.id === conceptId);
  if (!concept?.imagePath) throw new Error("Concept image missing");
  const style = concept.styleFamily ?? scene.styleFamily;
  if (!style) throw new Error("No style family");

  const prev = fileToBase64(concept.imagePath);
  const fp = fingerprint({
    kind: "refine",
    conceptId,
    instruction,
    prev: fingerprint(prev.data.slice(0, 200)),
  });

  await withJobLock("openai_concept", fp, async () => {
    const { job, created } = createOrAttachJob({
      kind: "openai_concept",
      fingerprint: fp,
      sceneId,
    });
    if (job.status === "SUCCEEDED") {
      const { imagePath } = parseResult<{ imagePath: string }>(job)!;
      getDb().prepare(`UPDATE concepts SET image_path = ? WHERE id = ?`).run(imagePath, conceptId);
      return;
    }
    updateJob(job.id, { status: "IN_PROGRESS" });
    try {
      const image = await refineConceptImage({
        previousImageBase64: prev.data,
        previousMime: prev.mimeType,
        instruction,
        styleFamily: style,
        stage: scene.stage,
      });
      const imagePath = saveImageBuffer(image.buffer, image.mimeType, "refine");
      getDb().prepare(`UPDATE concepts SET image_path = ? WHERE id = ?`).run(imagePath, conceptId);
      updateJob(job.id, {
        status: "SUCCEEDED",
        progress: 100,
        result_json: JSON.stringify({ imagePath }),
      });
    } catch (e) {
      updateJob(job.id, {
        status: "FAILED",
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  });

  touchScene(sceneId);
  return getScene(sceneId)!;
}

export async function uploadUserConcept(
  sceneId: string,
  filePath: string,
  mimeType: string,
) {
  const scene = getScene(sceneId);
  if (!scene) throw new Error("Scene not found");
  const img = fileToBase64(filePath);
  const fp = fingerprint({
    kind: "analyze-upload",
    sceneId,
    file: path.basename(filePath),
    hash: fingerprint(img.data.slice(0, 500)),
  });

  const analysis = await withJobLock("openai_analyze_upload", fp, async () => {
    const { job, created } = createOrAttachJob({
      kind: "openai_analyze_upload",
      fingerprint: fp,
      sceneId,
    });
    if (job.status === "SUCCEEDED") return parseResult<{
      title: string;
      summary: string;
      styleFamily: StyleFamily;
      objects: PlannedObject[];
    }>(job)!;
    updateJob(job.id, { status: "IN_PROGRESS" });
    try {
      const result = await analyzeUserRendering({
        description: scene.description,
        stage: scene.stage,
        imageBase64: img.data,
        mimeType,
      });
      updateJob(job.id, {
        status: "SUCCEEDED",
        progress: 100,
        result_json: JSON.stringify(result),
      });
      return result;
    } catch (e) {
      updateJob(job.id, {
        status: "FAILED",
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  });

  // Copy into images dir
  const stored = saveImageBuffer(fs.readFileSync(filePath), mimeType, "user");
  const conceptId = uuid();
  getDb()
    .prepare(
      `INSERT INTO concepts (id, scene_id, source, title, summary, image_path, objects_json, style_family_json, created_at)
       VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      conceptId,
      sceneId,
      analysis.title || "Yours",
      analysis.summary || "User-supplied rendering",
      stored,
      JSON.stringify(analysis.objects),
      JSON.stringify(analysis.styleFamily),
      Date.now(),
    );

  if (!scene.styleFamily) {
    getDb()
      .prepare(`UPDATE scenes SET style_family_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(analysis.styleFamily), Date.now(), sceneId);
  }

  touchScene(sceneId);
  return getScene(sceneId)!;
}

export function updateConceptObjects(conceptId: string, objects: PlannedObject[]) {
  getDb()
    .prepare(`UPDATE concepts SET objects_json = ? WHERE id = ?`)
    .run(JSON.stringify(objects), conceptId);
}

/**
 * Explicit approval gate. Relayouts from the concept image, then queues
 * isolate+Meshy for every non-procedural object automatically.
 */
export async function approveConcept(sceneId: string, conceptId: string) {
  const scene = getScene(sceneId);
  if (!scene) throw new Error("Scene not found");
  const concept = scene.concepts.find((c) => c.id === conceptId);
  if (!concept) throw new Error("Concept not found");
  if (!concept.imagePath) throw new Error("Concept has no image");

  // Re-read the rendering so boxes match what you approved
  let objects = concept.objects;
  try {
    const img = fileToBase64(concept.imagePath);
    objects = await layoutFromConceptImage({
      description: scene.description,
      stage: scene.stage,
      imageBase64: img.data,
      mimeType: img.mimeType,
      objects: concept.objects,
    });
    getDb()
      .prepare(`UPDATE concepts SET objects_json = ? WHERE id = ?`)
      .run(JSON.stringify(objects), conceptId);
    console.log(
      "[layout] vision placements:",
      objects.map((o) => ({
        name: o.name,
        box: o.box,
        yaw: o.yaw,
      })),
    );
  } catch (e) {
    console.warn(
      "[layout] vision relayout failed, using concept boxes:",
      e instanceof Error ? e.message : e,
    );
  }

  getDb()
    .prepare(
      `UPDATE scenes SET approved_concept_id = ?, style_family_json = ?, status = 'generating', updated_at = ? WHERE id = ?`,
    )
    .run(
      conceptId,
      JSON.stringify(concept.styleFamily ?? scene.styleFamily),
      Date.now(),
      sceneId,
    );

  getDb().prepare(`DELETE FROM scene_objects WHERE scene_id = ?`).run(sceneId);
  const now = Date.now();
  const queuedIds: string[] = [];
  const library = listLibrary();
  for (const obj of objects) {
    const oid = uuid();
    const procedural = Boolean(obj.procedural || obj.role === "foundation");
    const transform = boxToTransform(obj.box, scene.stage, obj.yaw ?? 0, {
      floating: isFloatingObject(obj),
    });

    if (procedural) {
      getDb()
        .prepare(
          `INSERT INTO scene_objects (id, scene_id, concept_id, name, role, box_json, status, transform_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'procedural', ?, ?, ?)`,
        )
        .run(
          oid,
          sceneId,
          conceptId,
          obj.name,
          obj.role,
          JSON.stringify(obj.box),
          JSON.stringify(transform),
          now,
          now,
        );
      continue;
    }

    const match = bestLibraryMatch(obj.name, library);
    if (match) {
      getDb()
        .prepare(
          `INSERT INTO scene_objects (id, scene_id, concept_id, name, role, box_json, status, asset_id, asset_version, transform_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?)`,
        )
        .run(
          oid,
          sceneId,
          conceptId,
          obj.name,
          obj.role,
          JSON.stringify(obj.box),
          match.id,
          match.currentVersion,
          JSON.stringify(transform),
          now,
          now,
        );
      console.log(`[approve] reused library "${match.name}" for "${obj.name}"`);
    } else {
      getDb()
        .prepare(
          `INSERT INTO scene_objects (id, scene_id, concept_id, name, role, box_json, status, transform_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
        )
        .run(
          oid,
          sceneId,
          conceptId,
          obj.name,
          obj.role,
          JSON.stringify(obj.box),
          JSON.stringify(transform),
          now,
          now,
        );
      queuedIds.push(oid);
    }
  }

  if (queuedIds.length) {
    const { loadSecrets } = await import("./secrets.js");
    if (loadSecrets().meshyApiKey) {
      void runGenerationQueue(sceneId, queuedIds, { reuseLibrary: true });
    } else {
      for (const id of queuedIds) setObjectStatus(id, "planned");
      getDb()
        .prepare(`UPDATE scenes SET status = 'ready', updated_at = ? WHERE id = ?`)
        .run(Date.now(), sceneId);
    }
  } else {
    getDb()
      .prepare(`UPDATE scenes SET status = 'ready', updated_at = ? WHERE id = ?`)
      .run(Date.now(), sceneId);
  }

  return getScene(sceneId)!;
}

/**
 * Re-measure the approved concept image and update transforms only
 * (does not re-run Meshy). Use when placement looks wrong.
 */
export async function relayoutApprovedScene(
  sceneId: string,
  opts?: { imagePath?: string },
) {
  const scene = getScene(sceneId);
  if (!scene) throw new Error("Scene not found");
  if (!scene.approvedConceptId && !opts?.imagePath) {
    throw new Error("Approve a concept or provide a layout image first");
  }
  const concept = scene.approvedConceptId
    ? scene.concepts.find((c) => c.id === scene.approvedConceptId)
    : null;
  const imagePath = opts?.imagePath ?? concept?.imagePath;
  if (!imagePath) throw new Error("Layout image missing");

  const seedObjects: PlannedObject[] =
    concept?.objects?.length
      ? concept.objects
      : scene.objects.map((o) => ({
          name: o.name,
          role: o.role as PlannedObject["role"],
          purpose: o.name,
          box: o.box,
          procedural: o.status === "procedural" || o.role === "foundation",
        }));

  const img = fileToBase64(imagePath);
  const objects = await layoutFromConceptImage({
    description: scene.description,
    stage: scene.stage,
    imageBase64: img.data,
    mimeType: img.mimeType,
    objects: seedObjects.length
      ? seedObjects
      : [
          {
            name: "Object",
            role: "prop",
            purpose: "from image",
            box: { x: 0.5, y: 0, z: 0.5, sx: 0.2, sy: 0.3, sz: 0.2 },
          },
        ],
  });

  console.log(
    "[relayout] fitted composition:",
    objects.map((o) => ({
      name: o.name,
      box: o.box,
      yaw: o.yaw,
      hM: (o.box.sy * scene.stage.size.height).toFixed(3),
    })),
  );
  if (concept) {
    getDb()
      .prepare(`UPDATE concepts SET objects_json = ? WHERE id = ?`)
      .run(JSON.stringify(objects), concept.id);
  }

  const now = Date.now();
  for (const planned of objects) {
    const existing = scene.objects.find(
      (o) => o.name.toLowerCase() === planned.name.toLowerCase(),
    );
    if (!existing) continue;
    getDb()
      .prepare(
        `UPDATE scene_objects SET box_json = ?, transform_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        JSON.stringify(planned.box),
        JSON.stringify(
          boxToTransform(planned.box, scene.stage, planned.yaw ?? 0, {
            floating: isFloatingObject(planned),
          }),
        ),
        now,
        existing.id,
      );
  }

  touchScene(sceneId);
  return getScene(sceneId)!;
}

/**
 * Import a layout reference image, measure placements, and attach matching
 * library GLBs — no Meshy rebuild.
 */
export async function importLayoutAndReuseLibrary(
  sceneId: string,
  imagePath: string,
  mimeType: string,
) {
  const scene = getScene(sceneId);
  if (!scene) throw new Error("Scene not found");

  const analysis = await analyzeUserRendering({
    description: scene.description,
    stage: scene.stage,
    imageBase64: fileToBase64(imagePath).data,
    mimeType,
  });

  // Persist as a user concept and approve it (layout source of truth)
  const saved = saveImageBuffer(
    fs.readFileSync(imagePath),
    mimeType,
    "layout-ref",
  );
  const conceptId = uuid();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO concepts (id, scene_id, source, title, summary, image_path, objects_json, style_family_json, created_at)
       VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      conceptId,
      sceneId,
      analysis.title || "Layout reference",
      analysis.summary || "Imported for layout reuse",
      saved,
      JSON.stringify(analysis.objects),
      JSON.stringify(analysis.styleFamily),
      now,
    );

  getDb()
    .prepare(
      `UPDATE scenes SET approved_concept_id = ?, style_family_json = ?, status = 'ready', updated_at = ? WHERE id = ?`,
    )
    .run(conceptId, JSON.stringify(analysis.styleFamily), now, sceneId);

  getDb().prepare(`DELETE FROM scene_objects WHERE scene_id = ?`).run(sceneId);

  const library = listLibrary();
  for (const obj of analysis.objects) {
    const oid = uuid();
    const procedural = Boolean(obj.procedural || obj.role === "foundation");
    const transform = boxToTransform(obj.box, scene.stage, obj.yaw ?? 0, {
      floating: isFloatingObject(obj),
    });

    if (procedural) {
      getDb()
        .prepare(
          `INSERT INTO scene_objects (id, scene_id, concept_id, name, role, box_json, status, transform_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'procedural', ?, ?, ?)`,
        )
        .run(
          oid,
          sceneId,
          conceptId,
          obj.name,
          obj.role,
          JSON.stringify(obj.box),
          JSON.stringify(transform),
          now,
          now,
        );
      continue;
    }

    const match = bestLibraryMatch(obj.name, library);
    if (match) {
      getDb()
        .prepare(
          `INSERT INTO scene_objects (id, scene_id, concept_id, name, role, box_json, status, asset_id, asset_version, transform_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?)`,
        )
        .run(
          oid,
          sceneId,
          conceptId,
          obj.name,
          obj.role,
          JSON.stringify(obj.box),
          match.id,
          match.currentVersion,
          JSON.stringify(transform),
          now,
          now,
        );
    } else {
      getDb()
        .prepare(
          `INSERT INTO scene_objects (id, scene_id, concept_id, name, role, box_json, status, transform_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)`,
        )
        .run(
          oid,
          sceneId,
          conceptId,
          obj.name,
          obj.role,
          JSON.stringify(obj.box),
          JSON.stringify(transform),
          now,
          now,
        );
    }
  }

  touchScene(sceneId);
  return getScene(sceneId)!;
}

const activeQueues = new Set<string>();

async function runGenerationQueue(
  sceneId: string,
  objectIds: string[],
  opts?: { reuseLibrary?: boolean },
) {
  if (activeQueues.has(sceneId)) return;
  activeQueues.add(sceneId);
  try {
    const library = opts?.reuseLibrary ? listLibrary() : [];
    for (const objectId of objectIds) {
      try {
        if (opts?.reuseLibrary) {
          const scene = getScene(sceneId);
          const obj = scene?.objects.find((o) => o.id === objectId);
          if (obj) {
            const match = bestLibraryMatch(obj.name, library);
            if (match) {
              getDb()
                .prepare(
                  `UPDATE scene_objects SET asset_id = ?, asset_version = ?, status = 'ready', updated_at = ? WHERE id = ?`,
                )
                .run(match.id, match.currentVersion, Date.now(), objectId);
              console.log(`[pipeline] reused library asset for ${obj.name}`);
              continue;
            }
          }
        }
        setObjectStatus(objectId, "queued");
        await isolateAndMeshyObject(sceneId, objectId);
      } catch (e) {
        console.error(
          `[pipeline] object ${objectId} failed:`,
          e instanceof Error ? e.message : e,
        );
        setObjectStatus(objectId, "failed");
      }
    }
    const scene = getScene(sceneId);
    const pending = scene?.objects.some((o) =>
      ["queued", "isolating", "meshing", "planned"].includes(o.status),
    );
    getDb()
      .prepare(`UPDATE scenes SET status = ?, updated_at = ? WHERE id = ?`)
      .run(pending ? "generating" : "ready", Date.now(), sceneId);
  } finally {
    activeQueues.delete(sceneId);
  }
}

/** Resume incomplete auto-generation (e.g. after server restart). */
export function resumeGenerationIfNeeded(sceneId: string) {
  const scene = getScene(sceneId);
  if (!scene?.approvedConceptId) return;
  const todo = scene.objects
    .filter(
      (o) =>
        o.role !== "foundation" &&
        o.status !== "procedural" &&
        o.status !== "ready" &&
        o.status !== "failed",
    )
    .map((o) => o.id);
  const failedOrPlanned = scene.objects
    .filter(
      (o) =>
        o.role !== "foundation" &&
        o.status !== "procedural" &&
        !o.glbUrl &&
        (o.status === "planned" || o.status === "queued" || o.status === "failed" || o.status === "isolated"),
    )
    .map((o) => o.id);
  const ids = todo.length ? todo : failedOrPlanned;
  if (ids.length) void runGenerationQueue(sceneId, ids);
}

export async function isolateAndMeshyObject(
  sceneId: string,
  objectId: string,
  opts?: { skipMeshy?: boolean },
) {
  const scene = getScene(sceneId);
  if (!scene) throw new Error("Scene not found");
  if (!scene.approvedConceptId) {
    throw new Error("No approved concept — Meshy is blocked until you approve.");
  }
  const obj = scene.objects.find((o) => o.id === objectId);
  if (!obj) throw new Error("Object not found");
  if (obj.status === "procedural" || obj.role === "foundation") {
    throw new Error("Procedural foundation objects are not sent to Meshy");
  }

  const concept = scene.concepts.find((c) => c.id === scene.approvedConceptId);
  if (!concept?.imagePath) throw new Error("Approved concept image missing");
  const style = concept.styleFamily ?? scene.styleFamily;
  if (!style) throw new Error("Missing style family");

  // Isolate
  const conceptImg = fileToBase64(concept.imagePath);
  const isolateFp = fingerprint({
    kind: "isolate",
    conceptId: concept.id,
    objectName: obj.name,
    purpose: obj.role,
  });

  const isolatePath = await withJobLock("openai_isolate", isolateFp, async () => {
    const { job } = createOrAttachJob({
      kind: "openai_isolate",
      fingerprint: isolateFp,
      sceneId,
      objectId,
    });
    if (job.status === "SUCCEEDED") {
      return parseResult<{ imagePath: string }>(job)!.imagePath;
    }
    // Allow retry after a previous failure on the same fingerprint
    if (job.status === "FAILED") {
      updateJob(job.id, { status: "PENDING", error: null, progress: 0 });
    }
    updateJob(job.id, { status: "IN_PROGRESS" });
    setObjectStatus(objectId, "isolating");
    try {
      const image = await isolateObjectImage({
        conceptImageBase64: conceptImg.data,
        conceptMime: conceptImg.mimeType,
        objectName: obj.name,
        objectPurpose: obj.role,
        styleFamily: style,
      });
      const imagePath = saveImageBuffer(image.buffer, image.mimeType, `isolate-${slug(obj.name)}`);
      updateJob(job.id, {
        status: "SUCCEEDED",
        progress: 100,
        result_json: JSON.stringify({ imagePath }),
      });
      getDb()
        .prepare(`UPDATE scene_objects SET isolate_image_path = ?, status = 'isolated', updated_at = ? WHERE id = ?`)
        .run(imagePath, Date.now(), objectId);
      return imagePath;
    } catch (e) {
      updateJob(job.id, {
        status: "FAILED",
        error: e instanceof Error ? e.message : String(e),
      });
      setObjectStatus(objectId, "failed");
      throw e;
    }
  });

  if (opts?.skipMeshy) {
    return getScene(sceneId)!;
  }

  // Meshy — hard gated: only here after approve
  return runMeshyForObject(sceneId, objectId, isolatePath, style);
}

export async function runMeshyForObject(
  sceneId: string,
  objectId: string,
  isolatePath: string,
  style: StyleFamily,
) {
  const scene = getScene(sceneId);
  if (!scene?.approvedConceptId) {
    throw new Error("Meshy blocked: scene has no approved concept");
  }

  const settings = {
    ai_model: "meshy-7",
    should_texture: true,
    image_enhancement: false,
    target_formats: ["glb"],
  };

  const dataUri = imageFileToDataUri(isolatePath);
  const meshyFp = fingerprint({
    kind: "meshy",
    isolatePath: path.basename(isolatePath),
    // content hash of isolate
    imageHash: fingerprint(fs.readFileSync(isolatePath)),
    settings,
  });

  await withJobLock("meshy_image_to_3d", meshyFp, async () => {
    const { job, created } = createOrAttachJob({
      kind: "meshy_image_to_3d",
      fingerprint: meshyFp,
      sceneId,
      objectId,
      input: settings,
    });

    // Resume or reuse succeeded
    if (job.status === "SUCCEEDED") {
      const result = parseResult<{
        glbPath: string;
        thumbPath: string | null;
        meshyTaskId: string;
        assetId: string;
        version: number;
      }>(job)!;
      linkAssetToObject(objectId, result);
      return;
    }

    if (job.provider_task_id && (job.status === "PENDING" || job.status === "IN_PROGRESS")) {
      setObjectStatus(objectId, "meshing");
      const task = await pollUntilDone(job.provider_task_id, (t) => {
        updateJob(job.id, { status: "IN_PROGRESS", progress: t.progress ?? 0 });
      });
      if (task.status !== "SUCCEEDED") {
        updateJob(job.id, {
          status: "FAILED",
          error: task.task_error?.message || "Meshy failed",
        });
        setObjectStatus(objectId, "failed");
        throw new Error(task.task_error?.message || "Meshy failed");
      }
      const downloaded = await downloadMeshyResult(task);
      const saved = saveAssetVersion({
        name: scene.objects.find((o) => o.id === objectId)?.name ?? "Asset",
        styleFamilyId: style.id,
        styleFamily: style,
        glbPath: downloaded.glbPath,
        thumbPath: downloaded.thumbPath,
        referenceImagePath: isolatePath,
        meshyTaskId: task.id,
        settings,
      });
      updateJob(job.id, {
        status: "SUCCEEDED",
        progress: 100,
        result_json: JSON.stringify({
          glbPath: downloaded.glbPath,
          thumbPath: downloaded.thumbPath,
          meshyTaskId: task.id,
          assetId: saved.assetId,
          version: saved.version,
        }),
      });
      linkAssetToObject(objectId, {
        ...downloaded,
        meshyTaskId: task.id,
        assetId: saved.assetId,
        version: saved.version,
      });
      return;
    }

    // Fresh paid POST — only if no provider_task_id
    if (job.provider_task_id) {
      // Already posted
      return;
    }

    setObjectStatus(objectId, "meshing");
    updateJob(job.id, { status: "IN_PROGRESS", progress: 5 });
    const taskId = await createImageTo3dTask({ imageDataUri: dataUri });
    updateJob(job.id, {
      status: "IN_PROGRESS",
      provider_task_id: taskId,
      progress: 10,
    });

    const task = await pollUntilDone(taskId, (t) => {
      updateJob(job.id, { progress: t.progress ?? 0 });
    });

    if (task.status !== "SUCCEEDED") {
      updateJob(job.id, {
        status: "FAILED",
        error: task.task_error?.message || "Meshy failed",
      });
      setObjectStatus(objectId, "failed");
      throw new Error(task.task_error?.message || "Meshy failed");
    }

    const downloaded = await downloadMeshyResult(task);
    const saved = saveAssetVersion({
      name: scene.objects.find((o) => o.id === objectId)?.name ?? "Asset",
      styleFamilyId: style.id,
      styleFamily: style,
      glbPath: downloaded.glbPath,
      thumbPath: downloaded.thumbPath,
      referenceImagePath: isolatePath,
      meshyTaskId: task.id,
      settings,
    });

    updateJob(job.id, {
      status: "SUCCEEDED",
      progress: 100,
      result_json: JSON.stringify({
        glbPath: downloaded.glbPath,
        thumbPath: downloaded.thumbPath,
        meshyTaskId: task.id,
        assetId: saved.assetId,
        version: saved.version,
      }),
    });
    linkAssetToObject(objectId, {
      ...downloaded,
      meshyTaskId: task.id,
      assetId: saved.assetId,
      version: saved.version,
    });
  });

  touchScene(sceneId);
  return getScene(sceneId)!;
}

function linkAssetToObject(
  objectId: string,
  result: {
    assetId: string;
    version: number;
    glbPath: string;
    thumbPath: string | null;
    meshyTaskId: string;
  },
) {
  getDb()
    .prepare(
      `UPDATE scene_objects SET
        asset_id = ?, asset_version = ?, status = 'ready',
        generation_settings_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      result.assetId,
      result.version,
      JSON.stringify({ meshyTaskId: result.meshyTaskId }),
      Date.now(),
      objectId,
    );
}

export function saveAssetVersion(opts: {
  name: string;
  styleFamilyId: string;
  styleFamily: StyleFamily;
  glbPath: string;
  thumbPath: string | null;
  referenceImagePath: string;
  meshyTaskId: string;
  settings: unknown;
  assetId?: string;
}) {
  const now = Date.now();
  let assetId = opts.assetId;
  let version = 1;

  if (assetId) {
    const row = getDb().prepare("SELECT * FROM assets WHERE id = ?").get(assetId) as
      | { current_version: number }
      | undefined;
    if (row) {
      version = row.current_version + 1;
      getDb()
        .prepare(`UPDATE assets SET current_version = ?, updated_at = ? WHERE id = ?`)
        .run(version, now, assetId);
    } else {
      assetId = undefined;
    }
  }

  if (!assetId) {
    // Reuse by name + style if exists
    const existing = getDb()
      .prepare(`SELECT * FROM assets WHERE name = ? AND style_family_id = ?`)
      .get(opts.name, opts.styleFamilyId) as
      | { id: string; current_version: number }
      | undefined;
    if (existing) {
      assetId = existing.id;
      version = existing.current_version + 1;
      getDb()
        .prepare(`UPDATE assets SET current_version = ?, updated_at = ? WHERE id = ?`)
        .run(version, now, assetId);
    } else {
      assetId = uuid();
      getDb()
        .prepare(
          `INSERT INTO assets (id, name, style_family_id, current_version, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .run(assetId, opts.name, opts.styleFamilyId, now, now);
      version = 1;
    }
  }

  // Copy into library folder
  const libDir = path.join(LIBRARY_DIR, assetId, `v${version}`);
  fs.mkdirSync(libDir, { recursive: true });
  const glbDest = path.join(libDir, "model.glb");
  fs.copyFileSync(opts.glbPath, glbDest);
  let thumbDest: string | null = null;
  if (opts.thumbPath && fs.existsSync(opts.thumbPath)) {
    thumbDest = path.join(libDir, "thumb.png");
    fs.copyFileSync(opts.thumbPath, thumbDest);
  }
  const refDest = path.join(libDir, "reference.png");
  if (fs.existsSync(opts.referenceImagePath)) {
    fs.copyFileSync(opts.referenceImagePath, refDest);
  }

  const versionId = uuid();
  getDb()
    .prepare(
      `INSERT INTO asset_versions (id, asset_id, version, thumbnail_path, reference_image_path, glb_path, generation_settings_json, style_family_json, meshy_task_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      versionId,
      assetId,
      version,
      thumbDest,
      fs.existsSync(refDest) ? refDest : opts.referenceImagePath,
      glbDest,
      JSON.stringify(opts.settings),
      JSON.stringify(opts.styleFamily),
      opts.meshyTaskId,
      now,
    );

  return { assetId, version, glbPath: glbDest, thumbPath: thumbDest };
}

export function listLibrary(query?: string) {
  let rows = getDb()
    .prepare(
      `SELECT a.*, 
        (SELECT glb_path FROM asset_versions WHERE asset_id = a.id AND version = a.current_version) as glb_path,
        (SELECT thumbnail_path FROM asset_versions WHERE asset_id = a.id AND version = a.current_version) as thumbnail_path,
        (SELECT reference_image_path FROM asset_versions WHERE asset_id = a.id AND version = a.current_version) as reference_image_path,
        (SELECT generation_settings_json FROM asset_versions WHERE asset_id = a.id AND version = a.current_version) as generation_settings_json,
        (SELECT style_family_json FROM asset_versions WHERE asset_id = a.id AND version = a.current_version) as style_family_json
       FROM assets a ORDER BY a.updated_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;

  if (query) {
    const q = query.toLowerCase();
    rows = rows.filter((r) => String(r.name).toLowerCase().includes(q));
  }

  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    styleFamilyId: r.style_family_id as string,
    currentVersion: r.current_version as number,
    glbUrl: r.glb_path ? publicFileUrl(r.glb_path as string) : null,
    thumbnailUrl: r.thumbnail_path ? publicFileUrl(r.thumbnail_path as string) : null,
    referenceImageUrl: r.reference_image_path
      ? publicFileUrl(r.reference_image_path as string)
      : null,
    generationSettings: r.generation_settings_json
      ? JSON.parse(r.generation_settings_json as string)
      : null,
    styleFamily: r.style_family_json ? JSON.parse(r.style_family_json as string) : null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  }));
}

export function getAsset(assetId: string) {
  const asset = getDb().prepare("SELECT * FROM assets WHERE id = ?").get(assetId) as
    | Record<string, unknown>
    | undefined;
  if (!asset) return null;
  const versions = getDb()
    .prepare(`SELECT * FROM asset_versions WHERE asset_id = ? ORDER BY version DESC`)
    .all(assetId) as Array<Record<string, unknown>>;
  return {
    id: asset.id as string,
    name: asset.name as string,
    styleFamilyId: asset.style_family_id as string,
    currentVersion: asset.current_version as number,
    versions: versions.map((v) => ({
      version: v.version as number,
      glbUrl: publicFileUrl(v.glb_path as string),
      thumbnailUrl: v.thumbnail_path ? publicFileUrl(v.thumbnail_path as string) : null,
      referenceImageUrl: v.reference_image_path
        ? publicFileUrl(v.reference_image_path as string)
        : null,
      generationSettings: v.generation_settings_json
        ? JSON.parse(v.generation_settings_json as string)
        : null,
      styleFamily: v.style_family_json ? JSON.parse(v.style_family_json as string) : null,
      meshyTaskId: v.meshy_task_id as string,
      createdAt: v.created_at as number,
    })),
  };
}

export function placeLibraryAsset(
  sceneId: string,
  assetId: string,
  opts?: { version?: number; name?: string },
) {
  const scene = getScene(sceneId);
  if (!scene) throw new Error("Scene not found");
  const asset = getAsset(assetId);
  if (!asset) throw new Error("Asset not found");
  const version = opts?.version ?? asset.currentVersion;
  const ver = asset.versions.find((v) => v.version === version);
  if (!ver) throw new Error("Version not found");

  const id = uuid();
  const now = Date.now();
  const box = { x: 0.5, y: 0, z: 0.5, sx: 0.25, sy: 0.5, sz: 0.25 };
  getDb()
    .prepare(
      `INSERT INTO scene_objects (id, scene_id, concept_id, name, role, box_json, status, asset_id, asset_version, transform_json, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'prop', ?, 'ready', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      sceneId,
      opts?.name ?? asset.name,
      JSON.stringify(box),
      assetId,
      version,
      JSON.stringify(boxToTransform(box, scene.stage, 0, { floating: false })),
      now,
      now,
    );
  touchScene(sceneId);
  return getScene(sceneId)!;
}

export function updateObjectTransform(
  objectId: string,
  transform: { position: Vec3Like; rotation: Vec3Like; scale: Vec3Like },
) {
  getDb()
    .prepare(`UPDATE scene_objects SET transform_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(transform), Date.now(), objectId);
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

function setObjectStatus(objectId: string, status: string) {
  getDb()
    .prepare(`UPDATE scene_objects SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, Date.now(), objectId);
}

function touchScene(id: string) {
  getDb().prepare(`UPDATE scenes SET updated_at = ? WHERE id = ?`).run(Date.now(), id);
}

function publicFileUrl(absPath: string) {
  const rel = path.relative(DATA_DIR, absPath).split(path.sep).join("/");
  return `/files/${rel}`;
}

function assetGlbUrl(assetId: string, version: number) {
  const row = getDb()
    .prepare(`SELECT glb_path FROM asset_versions WHERE asset_id = ? AND version = ?`)
    .get(assetId, version) as { glb_path: string } | undefined;
  return row ? publicFileUrl(row.glb_path) : null;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function getJob(id: string): JobRow {
  return getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow;
}

async function waitJob(id: string, timeoutMs = 120000): Promise<JobRow> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j = getJob(id);
    if (isTerminal(j.status)) return j;
    await new Promise((r) => setTimeout(r, 500));
  }
  return getJob(id);
}

/** Count Meshy POSTs attempted — for tests we track via jobs with provider_task_id. */
export function countMeshyJobsWithProvider() {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM jobs WHERE kind = 'meshy_image_to_3d' AND provider_task_id IS NOT NULL`,
    )
    .get() as { c: number };
  return row.c;
}
