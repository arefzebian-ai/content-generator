/**
 * Minimal example: create a scene from a rendering and print object GLB + pose.
 *
 *   node examples/integrate.mjs ./my-rendering.png
 *
 * Requires: npm run dev (API on :8787), OpenAI key set in the studio Settings.
 */
import fs from "node:fs";
import path from "node:path";

const API = process.env.SPATAIL_API ?? "http://localhost:8787";
const imagePath = process.argv[2];

if (!imagePath || !fs.existsSync(imagePath)) {
  console.error("Usage: node examples/integrate.mjs <rendering.png>");
  process.exit(1);
}

async function main() {
  const sceneRes = await fetch(`${API}/api/scenes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Partner integration",
      description: "Scene created from partner app via Spatail API",
    }),
  });
  if (!sceneRes.ok) throw new Error(await sceneRes.text());
  const scene = await sceneRes.json();
  console.log("scene", scene.id);

  const fd = new FormData();
  const buf = fs.readFileSync(imagePath);
  const blob = new Blob([buf], {
    type: imagePath.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "image/png",
  });
  fd.append("image", blob, path.basename(imagePath));

  const layoutRes = await fetch(`${API}/api/scenes/${scene.id}/layout-from-image`, {
    method: "POST",
    body: fd,
  });
  if (!layoutRes.ok) throw new Error(await layoutRes.text());
  const laidOut = await layoutRes.json();

  console.log("objects:");
  for (const o of laidOut.objects ?? []) {
    console.log({
      name: o.name,
      status: o.status,
      glbUrl: o.glbUrl ? `${API}${o.glbUrl}` : null,
      position: o.transform?.position ?? null,
      rotation: o.transform?.rotation ?? null,
      size: {
        w: o.transform?.boxWidth,
        h: o.transform?.boxHeight,
        d: o.transform?.boxDepth,
      },
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
