import OpenAI, { toFile } from "openai";
import { loadSecrets } from "./secrets.js";

const IMAGE_MODEL = "gpt-image-2";

function client() {
  const key = loadSecrets().openaiApiKey;
  if (!key) {
    throw new Error("OpenAI API key not configured. Add it in Settings (used for concept + isolate images).");
  }
  return new OpenAI({ apiKey: key });
}

function decodeImage(result: { data?: Array<{ b64_json?: string | null }> | null }) {
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return {
    buffer: Buffer.from(b64, "base64"),
    mimeType: "image/png",
  };
}

/** Text → image (concept cards). */
export async function openaiGenerateImage(opts: {
  prompt: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto";
  quality?: "low" | "medium" | "high";
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const openai = client();
  const result = await openai.images.generate({
    model: IMAGE_MODEL,
    prompt: opts.prompt,
    size: opts.size ?? "1536x1024",
    quality: opts.quality ?? "medium",
  });
  return decodeImage(result);
}

/** Image + prompt → edited image (refine / isolate). */
export async function openaiEditImage(opts: {
  prompt: string;
  imageBuffer: Buffer;
  mimeType?: string;
  filename?: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto";
  quality?: "low" | "medium" | "high";
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const openai = client();
  const ext =
    opts.mimeType?.includes("jpeg") || opts.mimeType?.includes("jpg") ? "jpg" : "png";
  const file = await toFile(
    opts.imageBuffer,
    opts.filename ?? `input.${ext}`,
    { type: opts.mimeType ?? (ext === "jpg" ? "image/jpeg" : "image/png") },
  );

  const result = await openai.images.edit({
    model: IMAGE_MODEL,
    image: file,
    prompt: opts.prompt,
    size: opts.size ?? "1024x1024",
    quality: opts.quality ?? "medium",
  });
  return decodeImage(result);
}
