import fs from "node:fs";
import path from "node:path";
import { loadSecrets } from "./secrets.js";
import { GLBS_DIR, THUMBS_DIR } from "./paths.js";
import { v4 as uuid } from "uuid";

const BASE = "https://api.meshy.ai/openapi/v1/image-to-3d";

export interface MeshyTask {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";
  progress: number;
  model_urls?: { glb?: string };
  thumbnail_url?: string;
  task_error?: { message?: string };
}

function headers() {
  const key = loadSecrets().meshyApiKey;
  if (!key) throw new Error("Meshy API key not configured. Add it in Settings.");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export async function createImageTo3dTask(opts: {
  imageDataUri: string;
}): Promise<string> {
  const body = {
    image_url: opts.imageDataUri,
    ai_model: "meshy-7",
    should_texture: true,
    image_enhancement: false,
    target_formats: ["glb"],
    alpha_thumbnail: true,
  };

  const res = await fetch(BASE, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meshy create failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { result?: string; id?: string };
  const id = json.result ?? json.id;
  if (!id) throw new Error("Meshy create returned no task id");
  return id;
}

export async function getImageTo3dTask(taskId: string): Promise<MeshyTask> {
  const res = await fetch(`${BASE}/${taskId}`, { headers: headers() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meshy get failed (${res.status}): ${text}`);
  }
  return (await res.json()) as MeshyTask;
}

export async function pollUntilDone(
  taskId: string,
  onProgress?: (task: MeshyTask) => void,
  intervalMs = 5000,
  timeoutMs = 15 * 60 * 1000,
): Promise<MeshyTask> {
  const start = Date.now();
  while (true) {
    const task = await getImageTo3dTask(taskId);
    onProgress?.(task);
    if (task.status === "SUCCEEDED" || task.status === "FAILED" || task.status === "CANCELED") {
      return task;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Meshy task ${taskId} timed out`);
    }
    await sleep(intervalMs);
  }
}

export async function downloadMeshyResult(task: MeshyTask): Promise<{
  glbPath: string;
  thumbPath: string | null;
}> {
  if (task.status !== "SUCCEEDED" || !task.model_urls?.glb) {
    throw new Error(task.task_error?.message || "Meshy task did not succeed with GLB");
  }
  fs.mkdirSync(GLBS_DIR, { recursive: true });
  fs.mkdirSync(THUMBS_DIR, { recursive: true });
  const id = uuid();
  const glbPath = path.join(GLBS_DIR, `${id}.glb`);
  const glbBuf = Buffer.from(await (await fetch(task.model_urls.glb)).arrayBuffer());
  fs.writeFileSync(glbPath, glbBuf);

  let thumbPath: string | null = null;
  if (task.thumbnail_url) {
    thumbPath = path.join(THUMBS_DIR, `${id}.png`);
    const tBuf = Buffer.from(await (await fetch(task.thumbnail_url)).arrayBuffer());
    fs.writeFileSync(thumbPath, tBuf);
  }

  return { glbPath, thumbPath };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function imageFileToDataUri(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
