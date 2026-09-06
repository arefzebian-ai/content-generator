import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createScene, approveConcept, getScene, countMeshyJobsWithProvider } from "./scenes.js";
import { getDb } from "./db.js";

describe("meshy approval gate", () => {
  it("blocks meshy path conceptually until approve (no provider tasks from concepts)", () => {
    const before = countMeshyJobsWithProvider();
    const scene = createScene({ name: "Gate Test" });
    // Insert a fake concept without going through OpenAI
    const conceptId = "test-concept-" + Date.now();
    getDb()
      .prepare(
        `INSERT INTO concepts (id, scene_id, source, title, summary, image_path, objects_json, style_family_json, created_at)
         VALUES (?, ?, 'openai', 'Test', 'Summary', NULL, ?, ?, ?)`,
      )
      .run(
        conceptId,
        scene.id,
        JSON.stringify([
          {
            name: "Tree",
            role: "environment",
            purpose: "test",
            box: { x: 0.7, y: 0.4, z: 0.3, sx: 0.3, sy: 0.8, sz: 0.3 },
          },
          {
            name: "Grass foundation",
            role: "foundation",
            purpose: "ground",
            procedural: true,
            box: { x: 0.5, y: 0.02, z: 0.5, sx: 1, sy: 0.04, sz: 1 },
          },
        ]),
        JSON.stringify({
          id: "test-style",
          name: "Test",
          artDirection: "x",
          shapeLanguage: "x",
          palette: [],
          materials: "x",
          forbidden: [],
        }),
        Date.now(),
      );

    assert.equal(getScene(scene.id)!.approvedConceptId, null);
    assert.equal(countMeshyJobsWithProvider(), before, "creating concepts must not create Meshy tasks");
  });

  it("approve creates scene objects including procedural grass", async () => {
    const scene = createScene({ name: "Approve Test" });
    const conceptId = "approve-concept-" + Date.now();
    getDb()
      .prepare(
        `INSERT INTO concepts (id, scene_id, source, title, summary, image_path, objects_json, style_family_json, created_at)
         VALUES (?, ?, 'user', 'Yours', 'Upload', 'fake.png', ?, ?, ?)`,
      )
      .run(
        conceptId,
        scene.id,
        JSON.stringify([
          {
            name: "Tree",
            role: "environment",
            purpose: "tree",
            box: { x: 0.7, y: 0.4, z: 0.3, sx: 0.3, sy: 0.8, sz: 0.3 },
          },
          {
            name: "Grass foundation",
            role: "foundation",
            purpose: "ground",
            procedural: true,
            box: { x: 0.5, y: 0.02, z: 0.5, sx: 1, sy: 0.04, sz: 1 },
          },
        ]),
        JSON.stringify({
          id: "s",
          name: "S",
          artDirection: "",
          shapeLanguage: "",
          palette: [],
          materials: "",
          forbidden: [],
        }),
        Date.now(),
      );

    const next = await approveConcept(scene.id, conceptId);
    assert.equal(next.approvedConceptId, conceptId);
    assert.ok(next.objects.some((o) => o.status === "procedural"));
    assert.ok(next.objects.some((o) => o.name === "Tree"));
    assert.ok(
      next.objects.some((o) => o.name === "Tree" && o.status !== "procedural"),
    );
  });

  it("isolateAndMeshy throws without approval", async () => {
    const { isolateAndMeshyObject } = await import("./scenes.js");
    const scene = createScene({ name: "No Approve" });
    await assert.rejects(
      () => isolateAndMeshyObject(scene.id, "missing"),
      /approved|not found/i,
    );
  });
});
