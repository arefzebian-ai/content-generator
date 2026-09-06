import {
  bestLibraryMatch,
  boxToTransform,
  fitCompositionToStage,
  metersToBox,
  namesMatch,
  normalizePlannedObjects,
} from "./layout.js";
import { sampleStage } from "./types.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("layout meters ↔ transform", () => {
  const stage = sampleStage();

  it("maps table-center meters onto the table surface", () => {
    const box = metersToBox(
      { x: 0.2, z: -0.15, elev: 0, width: 0.18, height: 0.3, depth: 0.16 },
      stage,
      false,
    );
    const t = boxToTransform(box, stage, 25, { floating: false });
    assert.ok(Math.abs(t.position.x - 0.2) < 1e-6);
    assert.ok(Math.abs(t.position.z - -0.15) < 1e-6);
    assert.ok(Math.abs(t.position.y - stage.tableHeight) < 1e-6);
    assert.ok(Math.abs(t.boxHeight - 0.3) < 1e-6);
    assert.ok(Math.abs(t.rotation.y - (25 * Math.PI) / 180) < 1e-6);
  });

  it("grounds trees even if elev was wrong, keeps action apple up", () => {
    const objs = normalizePlannedObjects([
      {
        name: "Oak tree",
        role: "environment",
        purpose: "tree rear-right",
        box: { x: 0.7, y: 0.9, z: 0.3, sx: 0.3, sy: 0.7, sz: 0.3 },
      },
      {
        name: "Falling apple",
        role: "action",
        purpose: "apple mid air",
        box: { x: 0.5, y: 0.9, z: 0.5, sx: 0.08, sy: 0.08, sz: 0.08 },
      },
    ]);
    assert.equal(objs[0].box.y, 0);
    assert.ok(objs[1].box.y <= 0.55);
    const treeT = boxToTransform(objs[0].box, stage, 0, { floating: false });
    assert.equal(treeT.position.y, stage.tableHeight);
  });

  it("matches library names loosely", () => {
    assert.ok(namesMatch("Newton figure", "Isaac Newton"));
    assert.ok(namesMatch("Oak Tree", "tree"));
    assert.ok(!namesMatch("Tree", "Apple"));
    assert.ok(!namesMatch("Apple Tree", "Falling Apple"));
    assert.ok(!namesMatch("Apple Tree", "Apple"));
    assert.ok(namesMatch("Falling Apple", "Apple"));
    assert.ok(namesMatch("Apple Tree", "Tree"));
  });

  it("picks apple fruit over apple tree for falling apple", () => {
    const lib = [{ name: "Apple Tree" }, { name: "Falling Apple" }, { name: "Isaac Newton" }];
    assert.equal(bestLibraryMatch("Falling apple", lib)?.name, "Falling Apple");
    assert.equal(bestLibraryMatch("Apple Tree", lib)?.name, "Apple Tree");
    assert.equal(bestLibraryMatch("Tree", lib)?.name, "Apple Tree");
  });

  it("fits oversized composition into the table volume while keeping relative scale", () => {
    const fitted = fitCompositionToStage(
      [
        {
          name: "Apple Tree",
          role: "environment",
          purpose: "tree",
          box: { x: 0.85, y: 0, z: 0.2, sx: 0.6, sy: 1.2, sz: 0.6 },
        },
        {
          name: "Isaac Newton",
          role: "character",
          purpose: "figure",
          box: { x: 0.2, y: 0, z: 0.85, sx: 0.5, sy: 0.9, sz: 0.5 },
        },
        {
          name: "Falling apple",
          role: "action",
          purpose: "apple",
          box: { x: 0.5, y: 0.5, z: 0.5, sx: 0.4, sy: 0.4, sz: 0.4 },
        },
      ],
      stage,
    );
    const tree = fitted.find((o) => /tree/i.test(o.name))!;
    const newton = fitted.find((o) => /newton/i.test(o.name))!;
    const apple = fitted.find(
      (o) => /\bapple\b/i.test(o.name) && !/tree/i.test(o.name),
    )!;
    assert.ok(tree.box.sy > newton.box.sy);
    assert.ok(newton.box.sy > apple.box.sy);
    assert.ok(tree.box.y + tree.box.sy <= 0.96);
    for (const o of [tree, newton, apple]) {
      const r =
        Math.hypot(o.box.x - 0.5, o.box.z - 0.5) +
        Math.max(o.box.sx, o.box.sz) * 0.5;
      assert.ok(r <= 0.5, `${o.name} extends off disk: ${r}`);
    }
  });
});
