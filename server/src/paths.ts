import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");
export const DATA_DIR = path.join(ROOT, "data");
export const DB_PATH = path.join(DATA_DIR, "studio.db");
export const SECRETS_PATH = path.join(DATA_DIR, "secrets.json");
export const IMAGES_DIR = path.join(DATA_DIR, "images");
export const GLBS_DIR = path.join(DATA_DIR, "glbs");
export const THUMBS_DIR = path.join(DATA_DIR, "thumbs");
export const LIBRARY_DIR = path.join(DATA_DIR, "library");
export const STAGE_PLATES_DIR = path.join(DATA_DIR, "stage-plates");

export function ensureDataDirs() {
  for (const dir of [
    DATA_DIR,
    IMAGES_DIR,
    GLBS_DIR,
    THUMBS_DIR,
    LIBRARY_DIR,
    STAGE_PLATES_DIR,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
