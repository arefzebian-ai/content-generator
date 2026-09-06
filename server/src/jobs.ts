import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import { getDb } from "./db.js";

export type JobStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED";

export type JobKind =
  | "openai_plan"
  | "openai_concept"
  | "openai_isolate"
  | "openai_analyze_upload"
  | "meshy_image_to_3d";

export interface JobRow {
  id: string;
  kind: JobKind;
  fingerprint: string;
  status: JobStatus;
  progress: number;
  provider_task_id: string | null;
  input_json: string | null;
  result_json: string | null;
  error: string | null;
  scene_id: string | null;
  object_id: string | null;
  created_at: number;
  updated_at: number;
}

const locks = new Map<string, Promise<unknown>>();

export function fingerprint(parts: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(parts)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function getJobByFingerprint(kind: JobKind, fp: string): JobRow | undefined {
  return getDb()
    .prepare("SELECT * FROM jobs WHERE kind = ? AND fingerprint = ?")
    .get(kind, fp) as JobRow | undefined;
}

export function getJob(id: string): JobRow | undefined {
  return getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
}

export function createOrAttachJob(opts: {
  kind: JobKind;
  fingerprint: string;
  sceneId?: string;
  objectId?: string;
  input?: unknown;
}): { job: JobRow; created: boolean } {
  const existing = getJobByFingerprint(opts.kind, opts.fingerprint);
  if (existing) {
    return { job: existing, created: false };
  }
  const now = Date.now();
  const id = uuid();
  getDb()
    .prepare(
      `INSERT INTO jobs (id, kind, fingerprint, status, progress, input_json, scene_id, object_id, created_at, updated_at)
       VALUES (?, ?, ?, 'PENDING', 0, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      opts.kind,
      opts.fingerprint,
      opts.input ? JSON.stringify(opts.input) : null,
      opts.sceneId ?? null,
      opts.objectId ?? null,
      now,
      now,
    );
  return { job: getJob(id)!, created: true };
}

export function updateJob(
  id: string,
  patch: Partial<{
    status: JobStatus;
    progress: number;
    provider_task_id: string | null;
    result_json: string | null;
    error: string | null;
  }>,
) {
  const now = Date.now();
  const current = getJob(id);
  if (!current) throw new Error(`Job ${id} not found`);
  getDb()
    .prepare(
      `UPDATE jobs SET
        status = ?,
        progress = ?,
        provider_task_id = ?,
        result_json = ?,
        error = ?,
        updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.status ?? current.status,
      patch.progress ?? current.progress,
      patch.provider_task_id !== undefined ? patch.provider_task_id : current.provider_task_id,
      patch.result_json !== undefined ? patch.result_json : current.result_json,
      patch.error !== undefined ? patch.error : current.error,
      now,
      id,
    );
  return getJob(id)!;
}

/** Serialize work per fingerprint so double-clicks cannot create duplicate paid POSTs. */
export async function withJobLock<T>(
  kind: JobKind,
  fp: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${kind}:${fp}`;
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const chain = prev.then(() => gate);
  locks.set(
    key,
    chain.catch(() => undefined),
  );
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chain) locks.delete(key);
  }
}

export function isTerminal(status: JobStatus) {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELED";
}

export function parseResult<T>(job: JobRow): T | null {
  if (!job.result_json) return null;
  return JSON.parse(job.result_json) as T;
}

/** Exported for tests — clear in-memory locks. */
export function __clearJobLocks() {
  locks.clear();
}
