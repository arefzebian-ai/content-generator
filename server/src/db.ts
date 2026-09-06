import Database from "better-sqlite3";
import { DB_PATH, ensureDataDirs } from "./paths.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  ensureDataDirs();
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      stage_json TEXT NOT NULL,
      style_family_json TEXT,
      approved_concept_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS concepts (
      id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      image_path TEXT,
      objects_json TEXT NOT NULL,
      style_family_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scene_objects (
      id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL,
      concept_id TEXT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      box_json TEXT NOT NULL,
      isolate_image_path TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      asset_id TEXT,
      asset_version INTEGER,
      transform_json TEXT,
      generation_settings_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      style_family_id TEXT,
      current_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_versions (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      thumbnail_path TEXT,
      reference_image_path TEXT,
      glb_path TEXT NOT NULL,
      generation_settings_json TEXT,
      style_family_json TEXT,
      meshy_task_id TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(asset_id, version),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      provider_task_id TEXT,
      input_json TEXT,
      result_json TEXT,
      error TEXT,
      scene_id TEXT,
      object_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(kind, fingerprint)
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_concepts_scene ON concepts(scene_id);
    CREATE INDEX IF NOT EXISTS idx_objects_scene ON scene_objects(scene_id);
    CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);
  `);
}
