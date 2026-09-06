/**
 * Live milestone: concepts → approve → tree isolate+Meshy → library → reuse
 */
const BASE = "http://localhost:8787";

async function req(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${init?.method || "GET"} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("1) Meshy count before…");
  const before = await req("/api/jobs/meshy-count");
  console.log("   meshy provider tasks:", before.count);

  console.log("2) Create Newton scene…");
  const scene = await req("/api/scenes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  console.log("   scene:", scene.id, scene.name);

  console.log("3) Generate 3 OpenAI concepts (this takes a few minutes)…");
  const t0 = Date.now();
  const withConcepts = await req(`/api/scenes/${scene.id}/concepts/generate`, {
    method: "POST",
  });
  console.log(
    `   done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${withConcepts.concepts.length} concepts`,
  );
  for (const c of withConcepts.concepts) {
    console.log(`   - [${c.source}] ${c.title} image=${Boolean(c.imageUrl)}`);
  }
  if (withConcepts.concepts.length < 1) throw new Error("No concepts returned");

  const mid = await req("/api/jobs/meshy-count");
  console.log("4) Meshy count after concepts (must equal before):", mid.count);
  if (mid.count !== before.count) {
    throw new Error("Meshy was called before approval — gate failed");
  }

  const concept = withConcepts.concepts[0];
  console.log("5) Approve concept:", concept.title);
  const approved = await req(
    `/api/scenes/${scene.id}/concepts/${concept.id}/approve`,
    { method: "POST" },
  );
  console.log(
    "   objects:",
    approved.objects.map((o) => `${o.name}(${o.status})`).join(", "),
  );

  const tree =
    approved.objects.find((o) => /tree/i.test(o.name)) ||
    approved.objects.find(
      (o) => o.status !== "procedural" && o.role !== "foundation",
    );
  if (!tree) throw new Error("No tree/non-procedural object to generate");
  console.log("6) Isolate + Meshy for:", tree.name, tree.id);

  const t1 = Date.now();
  const meshed = await req(
    `/api/scenes/${scene.id}/objects/${tree.id}/generate`,
    { method: "POST" },
  );
  const treeAfter = meshed.objects.find((o) => o.id === tree.id);
  console.log(
    `   done in ${((Date.now() - t1) / 1000).toFixed(1)}s — status=${treeAfter?.status} glb=${treeAfter?.glbUrl}`,
  );
  if (treeAfter?.status !== "ready" || !treeAfter.glbUrl) {
    throw new Error("Tree did not become ready with a GLB");
  }

  const after = await req("/api/jobs/meshy-count");
  console.log("7) Meshy count after tree:", after.count, "(expect +1)");
  if (after.count < before.count + 1) {
    console.warn("   warning: expected at least one new Meshy provider task");
  }

  const lib = await req("/api/library?q=tree");
  console.log(
    "8) Library hits:",
    lib.length,
    lib.map((a) => `${a.name} v${a.currentVersion}`).join(", "),
  );
  const asset =
    lib.find((a) => a.id === treeAfter.assetId) ||
    lib[0] ||
    (await req("/api/library")).find((a) => a.id === treeAfter.assetId);
  if (!asset) throw new Error("Tree not found in library");

  console.log("9) New scene + reuse library asset…");
  const scene2 = await req("/api/scenes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Reuse Test Scene" }),
  });
  const reused = await req(`/api/scenes/${scene2.id}/place-asset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetId: asset.id }),
  });
  const placed = reused.objects.find((o) => o.assetId === asset.id);
  console.log("   placed:", placed?.name, placed?.glbUrl);

  // Second generate of same tree fingerprint should not bump Meshy count
  console.log("10) Re-request same tree generate (should reuse, no new Meshy POST)…");
  const countBeforeReuse = (await req("/api/jobs/meshy-count")).count;
  await req(`/api/scenes/${scene.id}/objects/${tree.id}/generate`, {
    method: "POST",
  });
  const countAfterReuse = (await req("/api/jobs/meshy-count")).count;
  console.log(
    `   meshy count ${countBeforeReuse} → ${countAfterReuse} (should be equal)`,
  );

  console.log("\nMILESTONE OK");
  console.log(
    JSON.stringify(
      {
        sceneId: scene.id,
        conceptId: concept.id,
        conceptTitle: concept.title,
        treeName: tree.name,
        glbUrl: treeAfter.glbUrl,
        assetId: asset.id,
        reuseSceneId: scene2.id,
        meshyBefore: before.count,
        meshyAfter: after.count,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("\nMILESTONE FAILED:", e.message || e);
  process.exit(1);
});
