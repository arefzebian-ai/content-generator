import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { IMAGES_DIR } from "./paths.js";
import { openaiEditImage, openaiGenerateImage } from "./openaiImages.js";
import type { PlannedObject, Stage, StyleFamily } from "./types.js";

export {
  generatePlan,
  analyzeUserRendering,
  layoutFromConceptImage,
} from "./openaiPlan.js";

function stagePrompt(stage: Stage) {
  const shape =
    stage.shape === "circle"
      ? `circular table diameter ${stage.size.width.toFixed(2)}m`
      : `table ${stage.size.width.toFixed(2)}×${stage.size.depth.toFixed(2)}m`;
  return `Fit the miniature on a ${shape}, max content height ${stage.size.height.toFixed(2)}m. Keep everything on the table surface.`;
}

export async function generateConceptImage(opts: {
  description: string;
  stage: Stage;
  styleFamily: StyleFamily;
  concept: { title: string; summary: string; objects: PlannedObject[] };
  stagePlateBase64?: string;
  stagePlateMime?: string;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const objectList = opts.concept.objects
    .filter((o) => !o.procedural)
    .map((o) => `${o.name} (${o.role}): ${o.purpose}`)
    .join("; ");

  const prompt = `Create a beautiful miniature tabletop diorama photograph / painted rendering for a spatial experience.
Title: ${opts.concept.title}
Summary: ${opts.concept.summary}
Experience brief: ${opts.description}
Style family "${opts.styleFamily.name}": ${opts.styleFamily.artDirection}. Shape language: ${opts.styleFamily.shapeLanguage}. Materials: ${opts.styleFamily.materials}. Palette: ${opts.styleFamily.palette.map((p) => `${p.name} ${p.hex}`).join(", ")}.
Forbidden: ${opts.styleFamily.forbidden.join(", ")}.
Objects visible: ${objectList}. Grass covers the table surface.
${stagePrompt(opts.stage)}
Soft museum lighting, cohesive Living Historical Illustration look, no text overlays, no UI chrome, no wireframe HUD.`;

  if (opts.stagePlateBase64) {
    return openaiEditImage({
      prompt: `${prompt}\nUse the attached empty stage plate as the camera and table. Paint the diorama onto that table.`,
      imageBuffer: Buffer.from(opts.stagePlateBase64, "base64"),
      mimeType: opts.stagePlateMime ?? "image/png",
      filename: "stage-plate.png",
      size: "1536x1024",
    });
  }

  return openaiGenerateImage({ prompt, size: "1536x1024" });
}

export async function refineConceptImage(opts: {
  previousImageBase64: string;
  previousMime?: string;
  instruction: string;
  styleFamily: StyleFamily;
  stage: Stage;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const prompt = `Refine this tabletop diorama concept while preserving the shared style "${opts.styleFamily.name}" (${opts.styleFamily.artDirection}).
${stagePrompt(opts.stage)}
User instruction: ${opts.instruction}
Return a single refined image. No text overlays.`;

  return openaiEditImage({
    prompt,
    imageBuffer: Buffer.from(opts.previousImageBase64, "base64"),
    mimeType: opts.previousMime ?? "image/png",
    size: "1536x1024",
  });
}

export async function isolateObjectImage(opts: {
  conceptImageBase64: string;
  conceptMime?: string;
  objectName: string;
  objectPurpose: string;
  styleFamily: StyleFamily;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const prompt = `From the provided scene image, create a CLEAN ISOLATED turnaround-ready image of ONLY "${opts.objectName}" (${opts.objectPurpose}).
Preserve its exact appearance, colors, materials, and style ("${opts.styleFamily.name}").
Complete any hidden / occluded areas plausibly so the full object is visible.
Place it centered on a plain empty studio backdrop (soft neutral gray or soft linen).
No other props, no grass, no characters unless this IS that character, no text, no shadows under the object if possible.
Single object only — suitable as input for image-to-3D.`;

  return openaiEditImage({
    prompt,
    imageBuffer: Buffer.from(opts.conceptImageBase64, "base64"),
    mimeType: opts.conceptMime ?? "image/png",
    size: "1024x1024",
  });
}

export async function generateConceptImageFallback(
  opts: Parameters<typeof generateConceptImage>[0],
) {
  return generateConceptImage(opts);
}

export function saveImageBuffer(buffer: Buffer, mimeType: string, prefix: string): string {
  const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
  const filename = `${prefix}-${uuid()}.${ext}`;
  const full = path.join(IMAGES_DIR, filename);
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  fs.writeFileSync(full, buffer);
  return full;
}

export function fileToBase64(filePath: string): { data: string; mimeType: string } {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return { data: buf.toString("base64"), mimeType };
}
