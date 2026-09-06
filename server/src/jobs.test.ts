import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  fingerprint,
  createOrAttachJob,
  withJobLock,
  getJobByFingerprint,
  updateJob,
  __clearJobLocks,
} from "./jobs.js";
import { getDb } from "./db.js";
import { DATA_DIR } from "./paths.js";

describe("job fingerprints and mutex", () => {
  it("produces stable fingerprints", () => {
    const a = fingerprint({ model: "meshy-7", image: "abc", settings: { a: 1, b: 2 } });
    const b = fingerprint({ settings: { b: 2, a: 1 }, image: "abc", model: "meshy-7" });
    assert.equal(a, b);
    assert.notEqual(a, fingerprint({ model: "meshy-7", image: "xyz", settings: { a: 1, b: 2 } }));
  });

  it("reattaches instead of creating duplicate jobs", () => {
    // Use a unique kind fingerprint for this test run
    const fp = fingerprint({ test: "reattach", t: Date.now(), n: Math.random() });
    const first = createOrAttachJob({ kind: "meshy_image_to_3d", fingerprint: fp });
    const second = createOrAttachJob({ kind: "meshy_image_to_3d", fingerprint: fp });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.job.id, second.job.id);
  });

  it("mutex prevents concurrent duplicate paid work", async () => {
    __clearJobLocks();
    const fp = fingerprint({ test: "mutex", t: Date.now(), n: Math.random() });
    let posts = 0;
    const run = async () =>
      withJobLock("meshy_image_to_3d", fp, async () => {
        const { job, created } = createOrAttachJob({
          kind: "meshy_image_to_3d",
          fingerprint: fp,
        });
        if (created || job.status === "PENDING") {
          // Simulate paid POST only when starting fresh or still pending without provider id
          if (!job.provider_task_id) {
            posts += 1;
            updateJob(job.id, {
              status: "IN_PROGRESS",
              provider_task_id: "fake-task",
              progress: 10,
            });
          }
        }
        return getJobByFingerprint("meshy_image_to_3d", fp)!;
      });

    const [a, b] = await Promise.all([run(), run()]);
    assert.equal(a.id, b.id);
    assert.equal(posts, 1, "exactly one Meshy POST should occur");
  });
});

// Ensure DB can open under data/
getDb();
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
