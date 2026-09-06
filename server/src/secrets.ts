import fs from "node:fs";
import { SECRETS_PATH, ensureDataDirs } from "./paths.js";

export interface Secrets {
  meshyApiKey?: string;
  openaiApiKey?: string;
  /** @deprecated removed — kept only so old secrets.json still loads */
  geminiApiKey?: string;
}

export function loadSecrets(): Secrets {
  ensureDataDirs();
  if (!fs.existsSync(SECRETS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SECRETS_PATH, "utf8")) as Secrets;
  } catch {
    return {};
  }
}

export function saveSecrets(partial: Secrets): Secrets {
  ensureDataDirs();
  const next = { ...loadSecrets(), ...partial };
  fs.writeFileSync(SECRETS_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function secretsStatus() {
  const s = loadSecrets();
  return {
    openaiConfigured: Boolean(s.openaiApiKey),
    meshyConfigured: Boolean(s.meshyApiKey),
    openaiHint: mask(s.openaiApiKey),
    meshyHint: mask(s.meshyApiKey),
  };
}

function mask(key?: string) {
  if (!key) return null;
  if (key.length <= 4) return "****";
  return `…${key.slice(-4)}`;
}
