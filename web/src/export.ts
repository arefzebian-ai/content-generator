import JSZip from "jszip";
import type { Scene } from "./types";

export async function exportScenePackage(scene: Scene) {
  const zip = new JSZip();
  const layout = {
    id: scene.id,
    name: scene.name,
    description: scene.description,
    stage: scene.stage,
    styleFamily: scene.styleFamily,
    approvedConceptId: scene.approvedConceptId,
    instances: scene.objects.map((o) => ({
      id: o.id,
      name: o.name,
      role: o.role,
      status: o.status,
      box: o.box,
      transform: o.transform,
      assetId: o.assetId,
      assetVersion: o.assetVersion,
      glbUrl: o.glbUrl,
      procedural: o.status === "procedural" || o.role === "foundation",
    })),
  };
  zip.file("layout.json", JSON.stringify(layout, null, 2));

  for (const obj of scene.objects) {
    if (!obj.glbUrl) continue;
    const res = await fetch(obj.glbUrl);
    if (!res.ok) continue;
    const buf = await res.arrayBuffer();
    const safe = obj.name.replace(/[^a-z0-9-_]+/gi, "_");
    zip.file(`assets/${safe}.glb`, buf);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${scene.name.replace(/\s+/g, "_") || "scene"}.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
}
