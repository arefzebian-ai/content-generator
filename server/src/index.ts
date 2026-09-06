import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { ensureDataDirs, DATA_DIR, IMAGES_DIR } from "./paths.js";
import { getDb } from "./db.js";
import { loadSecrets, saveSecrets, secretsStatus } from "./secrets.js";
import {
  approveConcept,
  createScene,
  generateConcepts,
  getAsset,
  getScene,
  importLayoutAndReuseLibrary,
  isolateAndMeshyObject,
  listLibrary,
  listScenes,
  placeLibraryAsset,
  refineConcept,
  regenerateOneConcept,
  relayoutApprovedScene,
  resumeGenerationIfNeeded,
  saveStagePlate,
  updateConceptObjects,
  updateObjectTransform,
  updateScene,
  uploadUserConcept,
} from "./scenes.js";
import type { PlannedObject, Stage } from "./types.js";

ensureDataDirs();
getDb();

const app = express();
const upload = multer({ dest: path.join(DATA_DIR, "uploads") });

function pid(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use("/files", express.static(DATA_DIR));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/settings", (_req, res) => {
  res.json(secretsStatus());
});

app.post("/api/settings", (req, res) => {
  const { meshyApiKey, openaiApiKey } = req.body as {
    meshyApiKey?: string;
    openaiApiKey?: string;
  };
  const patch: { meshyApiKey?: string; openaiApiKey?: string } = {};
  if (typeof meshyApiKey === "string" && meshyApiKey.trim()) {
    patch.meshyApiKey = meshyApiKey.trim();
  }
  if (typeof openaiApiKey === "string" && openaiApiKey.trim()) {
    patch.openaiApiKey = openaiApiKey.trim();
  }
  saveSecrets(patch);
  res.json(secretsStatus());
});

app.get("/api/scenes", (_req, res) => {
  res.json(listScenes());
});

app.post("/api/scenes", (req, res) => {
  const scene = createScene(req.body ?? {});
  res.json(scene);
});

app.get("/api/scenes/:id", (req, res) => {
  const scene = getScene(pid(req.params.id));
  if (!scene) return res.status(404).json({ error: "Not found" });
  res.json(scene);
});

app.patch("/api/scenes/:id", (req, res) => {
  try {
    const scene = updateScene(pid(req.params.id), req.body as {
      name?: string;
      description?: string;
      stage?: Stage;
    });
    res.json(scene);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/scenes/:id/stage-plate", upload.single("plate"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing plate file" });
    const id = pid(req.params.id);
    const buf = fs.readFileSync(req.file.path);
    const full = saveStagePlate(id, buf);
    fs.unlinkSync(req.file.path);
    res.json({ path: full, url: `/files/stage-plates/${id}.png` });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/scenes/:id/concepts/generate", async (req, res) => {
  try {
    if (!loadSecrets().openaiApiKey) {
      return res.status(400).json({ error: "OpenAI API key required" });
    }
    const id = pid(req.params.id);
    const platePath = path.join(DATA_DIR, "stage-plates", `${id}.png`);
    const scene = await generateConcepts(
      id,
      fs.existsSync(platePath) ? platePath : undefined,
    );
    res.json(scene);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/scenes/:id/concepts/:conceptId/regenerate", async (req, res) => {
  try {
    const scene = await regenerateOneConcept(pid(req.params.id), pid(req.params.conceptId));
    res.json(scene);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/scenes/:id/concepts/:conceptId/refine", async (req, res) => {
  try {
    const instruction = String((req.body as { instruction?: string }).instruction ?? "");
    if (!instruction.trim()) return res.status(400).json({ error: "instruction required" });
    const scene = await refineConcept(pid(req.params.id), pid(req.params.conceptId), instruction);
    res.json(scene);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/scenes/:id/concepts/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing image" });
    if (!loadSecrets().openaiApiKey) {
      return res.status(400).json({ error: "OpenAI API key required to analyze upload" });
    }
    const mime = req.file.mimetype || "image/png";
    const scene = await uploadUserConcept(pid(req.params.id), req.file.path, mime);
    fs.unlinkSync(req.file.path);
    res.json(scene);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.patch("/api/scenes/:id/concepts/:conceptId/objects", (req, res) => {
  try {
    const objects = (req.body as { objects: PlannedObject[] }).objects;
    updateConceptObjects(pid(req.params.conceptId), objects);
    res.json(getScene(pid(req.params.id)));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/scenes/:id/concepts/:conceptId/approve", async (req, res) => {
  try {
    if (!loadSecrets().openaiApiKey) {
      return res.status(400).json({ error: "OpenAI API key required" });
    }
    const scene = await approveConcept(pid(req.params.id), pid(req.params.conceptId));
    res.json(scene);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/scenes/:id/relayout", async (req, res) => {
  try {
    if (!loadSecrets().openaiApiKey) {
      return res.status(400).json({ error: "OpenAI API key required" });
    }
    const scene = await relayoutApprovedScene(pid(req.params.id));
    res.json(scene);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/scenes/:id/layout-from-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing image" });
    if (!loadSecrets().openaiApiKey) {
      return res.status(400).json({ error: "OpenAI API key required" });
    }
    const mime = req.file.mimetype || "image/png";
    const scene = await importLayoutAndReuseLibrary(
      pid(req.params.id),
      req.file.path,
      mime,
    );
    try {
      fs.unlinkSync(req.file.path);
    } catch {
      /* ignore */
    }
    res.json(scene);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/scenes/:id/continue-generation", (req, res) => {
  try {
    resumeGenerationIfNeeded(pid(req.params.id));
    res.json(getScene(pid(req.params.id)));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/scenes/:id/objects/:objectId/generate", async (req, res) => {
  try {
    if (!loadSecrets().openaiApiKey) {
      return res.status(400).json({ error: "OpenAI API key required (object isolation images)" });
    }
    if (!loadSecrets().meshyApiKey) {
      return res.status(400).json({ error: "Meshy API key required" });
    }
    const scene = await isolateAndMeshyObject(pid(req.params.id), pid(req.params.objectId));
    res.json(scene);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/scenes/:id/objects/:objectId/isolate-only", async (req, res) => {
  try {
    const scene = await isolateAndMeshyObject(pid(req.params.id), pid(req.params.objectId), {
      skipMeshy: true,
    });
    res.json(scene);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.patch("/api/scenes/:id/objects/:objectId/transform", (req, res) => {
  try {
    updateObjectTransform(pid(req.params.objectId), req.body as never);
    res.json(getScene(pid(req.params.id)));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/library", (req, res) => {
  res.json(listLibrary(typeof req.query.q === "string" ? req.query.q : undefined));
});

app.get("/api/library/:id", (req, res) => {
  const asset = getAsset(pid(req.params.id));
  if (!asset) return res.status(404).json({ error: "Not found" });
  res.json(asset);
});

app.post("/api/scenes/:id/place-asset", (req, res) => {
  try {
    const { assetId, version, name } = req.body as {
      assetId: string;
      version?: number;
      name?: string;
    };
    const scene = placeLibraryAsset(pid(req.params.id), assetId, { version, name });
    res.json(scene);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/jobs/meshy-count", (_req, res) => {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM jobs WHERE kind = 'meshy_image_to_3d' AND provider_task_id IS NOT NULL`,
    )
    .get() as { c: number };
  res.json({ count: row.c });
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`Spatial Content Generator server on http://localhost:${PORT}`);
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });
});
