import OpenAI from "openai";
import {
  applyMeterPlacements,
  applyTableUvPlacements,
  clampBox,
  fitCompositionToStage,
  metersToBox,
  normalizePlannedObjects,
} from "./layout.js";
import { loadSecrets } from "./secrets.js";
import type { PlanResult, PlannedObject, Stage, StyleFamily } from "./types.js";

const TEXT_MODEL = "gpt-4.1-mini";
const TEXT_FALLBACK = "gpt-4o-mini";
/** Stronger vision model for spatial layout matching the rendering. */
const LAYOUT_MODEL = "gpt-4.1";
const LAYOUT_FALLBACK = "gpt-4o";

function client() {
  const key = loadSecrets().openaiApiKey;
  if (!key) throw new Error("OpenAI API key not configured. Add it in Settings.");
  return new OpenAI({ apiKey: key });
}

async function chatJson(opts: {
  system: string;
  user: string;
  imageBase64?: string;
  imageMime?: string;
  models?: string[];
}): Promise<unknown> {
  const openai = client();
  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: opts.user },
  ];
  if (opts.imageBase64) {
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${opts.imageMime ?? "image/png"};base64,${opts.imageBase64}`,
        detail: "high",
      },
    });
  }

  const models = opts.models ?? [TEXT_MODEL, TEXT_FALLBACK];
  let lastError: unknown;
  for (const model of models) {
    try {
      const response = await openai.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
      });
      const text = response.choices[0]?.message?.content ?? "{}";
      return JSON.parse(text);
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/model|404|not found|invalid/i.test(msg)) throw e;
      console.warn(`[openai] text model ${model} failed, trying next`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function cameraLayoutGuide(stage: Stage) {
  const diameter =
    stage.shape === "circle"
      ? stage.size.width
      : Math.max(stage.size.width, stage.size.depth);
  const radius = diameter / 2;
  return `CAMERA ↔ TABLE MAPPING (must follow exactly — this is how we place 3D assets):
- The photo is shot from in FRONT of the table (camera sits at +Z looking toward the table center).
- Mentally find the round table disk in the image.
- tableU: 0 = LEFT edge of the table disk, 1 = RIGHT edge.
- tableV: 0 = BACK of the table (TOP of the photo), 1 = FRONT of the table (BOTTOM of the photo, toward camera).
- Vertical position in the PHOTO is DEPTH (tableV), NOT height. Objects near the top of the photo are farther back (tableV near 0), still elevFrac=0.
- Size as fractions of the known stage (NOT pixels):
  - wFrac / dFrac = footprint ÷ table diameter ${diameter.toFixed(3)}m
  - hFrac = object height ÷ allowed content height ${stage.size.height.toFixed(3)}m
- Typical diorama proportions (match the rendering relative sizes):
  - Tree: wFrac/dFrac ≈ 0.28–0.42, hFrac ≈ 0.65–0.9
  - Seated person: wFrac/dFrac ≈ 0.12–0.2, hFrac ≈ 0.25–0.4
  - Falling apple: wFrac/dFrac ≈ 0.04–0.08, hFrac ≈ 0.06–0.12, elevFrac ≈ 0.35–0.5
- elevFrac MUST be 0 for trees/people/ground props. Only mid-air apples get elevFrac > 0.
- yawDeg: 0 = faces camera. Positive turns left (CCW from above).
- Keep footprints on the disk. Table diameter ${diameter.toFixed(3)}m (radius ${radius.toFixed(3)}m).`;
}

export async function generatePlan(
  description: string,
  stage: Stage,
): Promise<PlanResult> {
  const diameter =
    stage.shape === "circle"
      ? stage.size.width
      : Math.max(stage.size.width, stage.size.depth);
  const r = diameter / 2;

  const parsed = (await chatJson({
    system:
      "You are an art director for spatial tabletop experiences. Return ONLY valid JSON.",
    user: `Create ONE shared style-family and THREE distinct but cohesive scene concept briefs.

Experience:
${description}

Physical stage: "${stage.name}", circular table diameter ${diameter.toFixed(3)}m, content height ${stage.size.height.toFixed(3)}m.

Rules:
- Style family name should be memorable (e.g. "Living Historical Illustration").
- Each concept needs title, summary, and objects. Always include a procedural "Grass foundation" (role foundation, procedural true).
- Also include separate named objects (tree, Newton, falling apple for Newton scenes).
- For layout, use meter placements from table center (+X right, +Z toward camera):
  - Tree rear-right: x≈${(r * 0.35).toFixed(2)}, z≈${(-r * 0.35).toFixed(2)}, elev 0
  - Newton forward-left: x≈${(-r * 0.35).toFixed(2)}, z≈${(r * 0.4).toFixed(2)}, elev 0
  - Falling apple center lane: x≈0, z≈0, elev≈${(stage.size.height * 0.45).toFixed(2)}
- No cosmic imagery.

Return JSON:
{
  "styleFamily": {
    "id": "kebab-id",
    "name": "string",
    "artDirection": "string",
    "shapeLanguage": "string",
    "palette": [{"name":"","hex":"#rrggbb","usage":""}],
    "materials": "string",
    "forbidden": ["string"]
  },
  "concepts": [
    {
      "title": "string",
      "summary": "string",
      "objects": [
        {
          "name": "string",
          "role": "environment|character|action|prop|foundation",
          "purpose": "string",
          "procedural": false,
          "yawDeg": 0,
          "placement": {"x":0,"z":0,"elev":0,"width":0.2,"height":0.3,"depth":0.2}
        }
      ]
    }
  ]
}`,
  })) as {
    styleFamily: StyleFamily;
    concepts: Array<{
      title: string;
      summary: string;
      objects: Array<
        PlannedObject & {
          yawDeg?: number;
          placement?: {
            x: number;
            z: number;
            elev?: number;
            width: number;
            height: number;
            depth?: number;
          };
        }
      >;
    }>;
  };

  if (!parsed.styleFamily?.id) parsed.styleFamily = { ...parsed.styleFamily, id: "style-family" };
  if (!Array.isArray(parsed.concepts) || parsed.concepts.length < 1) {
    throw new Error("OpenAI plan returned no concepts");
  }

  const concepts = parsed.concepts.map((c) => {
    const withBoxes: PlannedObject[] = (c.objects ?? []).map((o) => {
      if (o.placement) {
        return {
          name: o.name,
          role: o.role,
          purpose: o.purpose,
          procedural: o.procedural,
          yaw: o.yawDeg ?? o.yaw ?? 0,
          box: metersToBox(
            {
              x: o.placement.x,
              z: o.placement.z,
              elev: o.placement.elev ?? 0,
              width: o.placement.width,
              height: o.placement.height,
              depth: o.placement.depth ?? o.placement.width,
            },
            stage,
          ),
        };
      }
      return {
        name: o.name,
        role: o.role,
        purpose: o.purpose,
        procedural: o.procedural,
        yaw: o.yawDeg ?? o.yaw ?? 0,
        box: clampBox(
          o.box ?? { x: 0.5, y: 0, z: 0.5, sx: 0.2, sy: 0.3, sz: 0.2 },
        ),
      };
    });
    return {
      title: c.title,
      summary: c.summary,
      objects: normalizePlannedObjects(withBoxes),
    };
  });

  const result: PlanResult = {
    styleFamily: parsed.styleFamily,
    concepts,
  };
  while (result.concepts.length < 3 && result.concepts.length > 0) {
    result.concepts.push({
      ...result.concepts[0],
      title: `${result.concepts[0].title} (variant ${result.concepts.length + 1})`,
    });
  }
  return result;
}

export async function analyzeUserRendering(opts: {
  description: string;
  stage: Stage;
  imageBase64: string;
  mimeType: string;
}): Promise<{ styleFamily: StyleFamily; objects: PlannedObject[]; title: string; summary: string }> {
  const parsed = (await chatJson({
    system:
      "You analyze tabletop diorama renderings for accurate spatial layout. Return ONLY valid JSON.",
    user: `Analyze this user-supplied scene rendering.
Experience brief: ${opts.description}

${cameraLayoutGuide(opts.stage)}

Extract a style-family and separate named objects for 3D assets.
Always include procedural Grass foundation covering the table (procedural true).
For every other object, place it with table UV + size fractions that match the image.

Return JSON:
{
  "title": "string",
  "summary": "string",
  "styleFamily": { "id":"", "name":"", "artDirection":"", "shapeLanguage":"", "palette":[{"name":"","hex":"","usage":""}], "materials":"", "forbidden":[] },
  "objects": [{
    "name":"",
    "role":"environment|character|action|prop|foundation",
    "purpose":"",
    "procedural": false,
    "yawDeg": 0,
    "table": {"u":0.5,"v":0.5,"wFrac":0.3,"hFrac":0.7,"dFrac":0.3,"elevFrac":0}
  }]
}`,
    imageBase64: opts.imageBase64,
    imageMime: opts.mimeType,
    models: [LAYOUT_MODEL, LAYOUT_FALLBACK, TEXT_MODEL],
  })) as {
    title: string;
    summary: string;
    styleFamily: StyleFamily;
    objects: Array<{
      name: string;
      role: PlannedObject["role"];
      purpose: string;
      procedural?: boolean;
      yawDeg?: number;
      table?: {
        u: number;
        v: number;
        wFrac: number;
        hFrac: number;
        dFrac?: number;
        elevFrac?: number;
      };
      placement?: {
        x: number;
        z: number;
        elev?: number;
        width: number;
        height: number;
        depth?: number;
      };
      box?: PlannedObject["box"];
    }>;
  };

  if (!parsed.styleFamily?.id) {
    parsed.styleFamily = { ...parsed.styleFamily, id: "user-style" };
  }

  const seed: PlannedObject[] = (parsed.objects ?? []).map((o) => ({
    name: o.name,
    role: o.role,
    purpose: o.purpose,
    procedural: o.procedural,
    yaw: o.yawDeg ?? 0,
    box: o.box ?? { x: 0.5, y: 0, z: 0.5, sx: 0.2, sy: 0.3, sz: 0.2 },
  }));

  const uv = (parsed.objects ?? [])
    .filter((o) => o.table && Number.isFinite(o.table.u) && Number.isFinite(o.table.v))
    .map((o) => ({
      name: o.name,
      role: o.role,
      purpose: o.purpose,
      procedural: o.procedural,
      yawDeg: o.yawDeg,
      u: o.table!.u,
      v: o.table!.v,
      wFrac: Math.max(0.03, o.table!.wFrac),
      hFrac: Math.max(0.03, o.table!.hFrac),
      dFrac: Math.max(0.03, o.table!.dFrac ?? o.table!.wFrac),
      elevFrac: o.table!.elevFrac,
    }));

  const objects =
    uv.length > 0
      ? applyTableUvPlacements(seed, uv, opts.stage)
      : fitCompositionToStage(
          (() => {
            const placements = (parsed.objects ?? [])
              .filter((o) => o.placement)
              .map((o) => ({
                name: o.name,
                role: o.role,
                purpose: o.purpose,
                procedural: o.procedural,
                yawDeg: o.yawDeg,
                x: o.placement!.x,
                z: o.placement!.z,
                elev: o.placement!.elev,
                width: o.placement!.width,
                height: o.placement!.height,
                depth: o.placement!.depth,
              }));
            return placements.length
              ? applyMeterPlacements(seed, placements, opts.stage)
              : normalizePlannedObjects(seed);
          })(),
          opts.stage,
        );

  return {
    title: parsed.title,
    summary: parsed.summary,
    styleFamily: parsed.styleFamily,
    objects,
  };
}

/** Re-read the approved concept image and produce layout that matches it, then fits the stage. */
export async function layoutFromConceptImage(opts: {
  description: string;
  stage: Stage;
  imageBase64: string;
  mimeType: string;
  objects: PlannedObject[];
}): Promise<PlannedObject[]> {
  const catalog = opts.objects
    .map(
      (o) =>
        `- ${o.name} (${o.role}${o.procedural ? ", procedural" : ""}): ${o.purpose}`,
    )
    .join("\n");

  const parsed = (await chatJson({
    system:
      "You are a technical layout artist. You read diorama photos and return table-disk UV placements that match the image. Return ONLY valid JSON.",
    user: `Match this concept rendering EXACTLY — same left/right, front/back, and relative sizes. Then we will fit the composition into the physical table volume.

${cameraLayoutGuide(opts.stage)}

Experience: ${opts.description}

Objects to place (keep these exact names):
${catalog}

Instructions:
1. Find the round table in the image.
2. For each object, mark its ground contact (or mid-air center for a falling apple) as tableU/tableV on that disk.
3. Estimate wFrac/dFrac/hFrac from how large it appears vs the table — preserve relative scale between tree, person, and apple as in the image.
4. elevFrac = 0 except mid-air apples.
5. Grass/foundation: tableU=0.5, tableV=0.5, wFrac=1, dFrac=1, hFrac=0.02, elevFrac=0, procedural true.

Return JSON:
{
  "objects": [{
    "name": "exact name from list",
    "role": "environment|character|action|prop|foundation",
    "purpose": "string",
    "procedural": false,
    "yawDeg": 0,
    "table": {"u":0.5,"v":0.5,"wFrac":0.3,"hFrac":0.7,"dFrac":0.3,"elevFrac":0}
  }]
}`,
    imageBase64: opts.imageBase64,
    imageMime: opts.mimeType,
    models: [LAYOUT_MODEL, LAYOUT_FALLBACK, TEXT_MODEL],
  })) as {
    objects: Array<{
      name: string;
      role?: PlannedObject["role"];
      purpose?: string;
      procedural?: boolean;
      yawDeg?: number;
      table?: {
        u: number;
        v: number;
        wFrac: number;
        hFrac: number;
        dFrac?: number;
        elevFrac?: number;
      };
      placement?: {
        x: number;
        z: number;
        elev?: number;
        width: number;
        height: number;
        depth?: number;
      };
      box?: PlannedObject["box"];
    }>;
  };

  const uvPlacements = (parsed.objects ?? [])
    .filter(
      (o) =>
        o.table &&
        Number.isFinite(o.table.u) &&
        Number.isFinite(o.table.v) &&
        Number.isFinite(o.table.wFrac) &&
        Number.isFinite(o.table.hFrac),
    )
    .map((o) => ({
      name: o.name,
      role: o.role,
      purpose: o.purpose,
      procedural: o.procedural,
      yawDeg: o.yawDeg,
      u: o.table!.u,
      v: o.table!.v,
      wFrac: Math.max(0.03, o.table!.wFrac),
      hFrac: Math.max(0.03, o.table!.hFrac),
      dFrac: Math.max(0.03, o.table!.dFrac ?? o.table!.wFrac),
      elevFrac: o.table!.elevFrac,
    }));

  if (uvPlacements.length > 0) {
    return applyTableUvPlacements(opts.objects, uvPlacements, opts.stage);
  }

  // Legacy meter placements
  const meterPlacements = (parsed.objects ?? [])
    .filter((o) => o.placement && Number.isFinite(o.placement.x) && Number.isFinite(o.placement.z))
    .map((o) => ({
      name: o.name,
      role: o.role,
      purpose: o.purpose,
      procedural: o.procedural,
      yawDeg: o.yawDeg,
      x: o.placement!.x,
      z: o.placement!.z,
      elev: o.placement!.elev,
      width: Math.max(0.02, o.placement!.width),
      height: Math.max(0.02, o.placement!.height),
      depth: Math.max(0.02, o.placement!.depth ?? o.placement!.width),
    }));

  if (meterPlacements.length > 0) {
    return applyMeterPlacements(opts.objects, meterPlacements, opts.stage);
  }

  const byName = new Map(
    (parsed.objects ?? []).map((o) => [o.name.trim().toLowerCase(), o]),
  );
  return fitCompositionToStage(
    opts.objects.map((orig) => {
      const hit = byName.get(orig.name.trim().toLowerCase());
      if (!hit?.box) return orig;
      return {
        ...orig,
        role: hit.role ?? orig.role,
        purpose: hit.purpose ?? orig.purpose,
        yaw: hit.yawDeg ?? orig.yaw ?? 0,
        box: clampBox(hit.box),
      };
    }),
    opts.stage,
  );
}
