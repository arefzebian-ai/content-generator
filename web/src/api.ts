import type { LibraryAsset, Scene, SettingsStatus, Stage } from "./types";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || res.statusText);
  }
  return data as T;
}

export const api = {
  settings: () => req<SettingsStatus>("/api/settings"),
  saveSettings: (body: { meshyApiKey?: string; openaiApiKey?: string }) =>
    req<SettingsStatus>("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  createScene: () =>
    req<Scene>("/api/scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  getScene: (id: string) => req<Scene>(`/api/scenes/${id}`),
  listScenes: () => req<Array<{ id: string; name: string }>>("/api/scenes"),
  updateScene: (
    id: string,
    patch: Partial<{ name: string; description: string; stage: Stage }>,
  ) =>
    req<Scene>(`/api/scenes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  uploadStagePlate: async (id: string, blob: Blob) => {
    const fd = new FormData();
    fd.append("plate", blob, "plate.png");
    return req<{ url: string }>(`/api/scenes/${id}/stage-plate`, {
      method: "POST",
      body: fd,
    });
  },
  generateConcepts: (id: string) =>
    req<Scene>(`/api/scenes/${id}/concepts/generate`, { method: "POST" }),
  regenerateConcept: (sceneId: string, conceptId: string) =>
    req<Scene>(`/api/scenes/${sceneId}/concepts/${conceptId}/regenerate`, {
      method: "POST",
    }),
  refineConcept: (sceneId: string, conceptId: string, instruction: string) =>
    req<Scene>(`/api/scenes/${sceneId}/concepts/${conceptId}/refine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    }),
  uploadConcept: async (sceneId: string, file: File) => {
    const fd = new FormData();
    fd.append("image", file);
    return req<Scene>(`/api/scenes/${sceneId}/concepts/upload`, {
      method: "POST",
      body: fd,
    });
  },
  updateConceptObjects: (sceneId: string, conceptId: string, objects: unknown) =>
    req<Scene>(`/api/scenes/${sceneId}/concepts/${conceptId}/objects`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objects }),
    }),
  layoutFromImage: async (sceneId: string, file: File) => {
    const fd = new FormData();
    fd.append("image", file);
    return req<Scene>(`/api/scenes/${sceneId}/layout-from-image`, {
      method: "POST",
      body: fd,
    });
  },
  approveConcept: (sceneId: string, conceptId: string) =>
    req<Scene>(`/api/scenes/${sceneId}/concepts/${conceptId}/approve`, {
      method: "POST",
    }),
  relayoutScene: (sceneId: string) =>
    req<Scene>(`/api/scenes/${sceneId}/relayout`, { method: "POST" }),
  generateObject: (sceneId: string, objectId: string) =>
    req<Scene>(`/api/scenes/${sceneId}/objects/${objectId}/generate`, {
      method: "POST",
    }),
  updateTransform: (sceneId: string, objectId: string, transform: unknown) =>
    req<Scene>(`/api/scenes/${sceneId}/objects/${objectId}/transform`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(transform),
    }),
  library: (q?: string) =>
    req<LibraryAsset[]>(`/api/library${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  placeAsset: (sceneId: string, assetId: string) =>
    req<Scene>(`/api/scenes/${sceneId}/place-asset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId }),
    }),
  continueGeneration: (id: string) =>
    req<Scene>(`/api/scenes/${id}/continue-generation`, { method: "POST" }),
  meshyCount: () => req<{ count: number }>("/api/jobs/meshy-count"),
};
