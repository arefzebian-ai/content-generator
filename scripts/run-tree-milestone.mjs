const BASE = "http://localhost:8787";
const SCENE = "44186187-e154-453d-93a3-e0924733487d";

async function req(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const before = await req("/api/jobs/meshy-count");
  console.log("meshy before", before.count);

  const scene = await req(`/api/scenes/${SCENE}`);
  console.log("scene", scene.id, "approved", scene.approvedConceptId);
  const tree = scene.objects.find((o) => /tree/i.test(o.name));
  if (!tree) throw new Error("no tree");
  console.log("generating", tree.name, tree.id, tree.status);

  const t0 = Date.now();
  const next = await req(`/api/scenes/${SCENE}/objects/${tree.id}/generate`, {
    method: "POST",
  });
  const afterObj = next.objects.find((o) => o.id === tree.id);
  console.log(
    `done in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    afterObj?.status,
    afterObj?.glbUrl,
    afterObj?.assetId,
  );

  const after = await req("/api/jobs/meshy-count");
  console.log("meshy after", after.count);

  const lib = await req("/api/library");
  console.log(
    "library",
    lib.map((a) => `${a.name} v${a.currentVersion}`).join(", ") || "(empty)",
  );

  const scene2 = await req("/api/scenes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Reuse Test Scene" }),
  });
  const reused = await req(`/api/scenes/${scene2.id}/place-asset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetId: afterObj.assetId }),
  });
  const placed = reused.objects.find((o) => o.assetId === afterObj.assetId);
  console.log("reused in", scene2.id, placed?.name, placed?.glbUrl);
  console.log("MILESTONE OK");
}

main().catch((e) => {
  console.error("FAILED", e.message || e);
  process.exit(1);
});
