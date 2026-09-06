import { create } from "zustand";
import { api } from "./api";
import type { LibraryAsset, Scene, SettingsStatus, Tab } from "./types";

function circlePolygon(radius: number, segments = 48) {
  const pts: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * radius, z: Math.sin(a) * radius });
  }
  return pts;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

interface Store {
  scene: Scene | null;
  settings: SettingsStatus | null;
  tab: Tab;
  selectedConceptId: string | null;
  selectedObjectId: string | null;
  hiddenObjectIds: string[];
  library: LibraryAsset[];
  libraryQuery: string;
  busy: string | null;
  error: string | null;
  showSettings: boolean;
  refineText: string;
  setTab: (t: Tab) => void;
  setSelectedConcept: (id: string | null) => void;
  setSelectedObject: (id: string | null) => void;
  toggleObjectVisible: (id: string) => void;
  setObjectVisible: (id: string, visible: boolean) => void;
  setAllObjectsVisible: (visible: boolean) => void;
  setRefineText: (t: string) => void;
  setShowSettings: (v: boolean) => void;
  setLibraryQuery: (q: string) => void;
  boot: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  saveKeys: (openai?: string, meshy?: string) => Promise<void>;
  saveBrief: () => Promise<void>;
  setDescription: (d: string) => void;
  setName: (n: string) => void;
  patchStage: (partial: Partial<Scene["stage"]>) => void;
  generateConcepts: (plateBlob?: Blob | null) => Promise<void>;
  regenerate: (conceptId: string) => Promise<void>;
  refine: (conceptId: string) => Promise<void>;
  uploadRendering: (file: File) => Promise<void>;
  approve: (conceptId: string) => Promise<void>;
  relayout: () => Promise<void>;
  importLayoutImage: (file: File) => Promise<void>;
  generateObject: (objectId: string) => Promise<void>;
  refreshScene: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  placeFromLibrary: (assetId: string) => Promise<void>;
  newScene: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

export const useStore = create<Store>((set, get) => ({
  scene: null,
  settings: null,
  tab: "brief",
  selectedConceptId: null,
  selectedObjectId: null,
  hiddenObjectIds: [],
  library: [],
  libraryQuery: "",
  busy: null,
  error: null,
  showSettings: false,
  refineText: "",

  setTab: (t) => set({ tab: t }),
  setSelectedConcept: (id) => set({ selectedConceptId: id }),
  setSelectedObject: (id) => set({ selectedObjectId: id }),
  toggleObjectVisible: (id) => {
    const hidden = get().hiddenObjectIds;
    set({
      hiddenObjectIds: hidden.includes(id)
        ? hidden.filter((x) => x !== id)
        : [...hidden, id],
    });
  },
  setObjectVisible: (id, visible) => {
    const hidden = get().hiddenObjectIds.filter((x) => x !== id);
    set({ hiddenObjectIds: visible ? hidden : [...hidden, id] });
  },
  setAllObjectsVisible: (visible) => {
    if (visible) set({ hiddenObjectIds: [] });
    else {
      const scene = get().scene;
      set({ hiddenObjectIds: scene?.objects.map((o) => o.id) ?? [] });
    }
  },
  setRefineText: (t) => set({ refineText: t }),
  setShowSettings: (v) => set({ showSettings: v }),
  setLibraryQuery: (q) => set({ libraryQuery: q }),

  setDescription: (d) => {
    const scene = get().scene;
    if (!scene) return;
    set({ scene: { ...scene, description: d } });
  },
  setName: (n) => {
    const scene = get().scene;
    if (!scene) return;
    set({ scene: { ...scene, name: n } });
  },
  patchStage: (partial) => {
    const scene = get().scene;
    if (!scene) return;
    const stage = { ...scene.stage, ...partial, shape: partial.shape ?? scene.stage.shape ?? "circle" };
    if (partial.size) {
      stage.size = { ...stage.size, ...partial.size };
      if (stage.shape === "circle") {
        const diameter = partial.size.width ?? partial.size.depth ?? stage.size.width;
        stage.size.width = diameter;
        stage.size.depth = diameter;
        stage.polygon = circlePolygon(diameter / 2);
      } else {
        const w = stage.size.width;
        const d = stage.size.depth;
        stage.polygon = [
          { x: -w / 2, z: -d / 2 },
          { x: w / 2, z: -d / 2 },
          { x: w / 2, z: d / 2 },
          { x: -w / 2, z: d / 2 },
        ];
      }
    }
    set({ scene: { ...scene, stage } });
  },

  boot: async () => {
    try {
      const settings = await api.settings();
      set({ settings, showSettings: !settings.openaiConfigured });
      const scenes = await api.listScenes();
      let scene: Scene;
      if (scenes.length) {
        scene = await api.getScene(scenes[0].id);
      } else {
        scene = await api.createScene();
      }
      set({ scene });
      if (scene.approvedConceptId && scene.progress && scene.progress.active > 0) {
        try {
          const resumed = await api.continueGeneration(scene.id);
          set({ scene: resumed });
        } catch {
          /* ignore — poll will still refresh */
        }
        get().startPolling();
      }
      await get().refreshLibrary();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  refreshSettings: async () => {
    set({ settings: await api.settings() });
  },

  saveKeys: async (openai, meshy) => {
    set({ busy: "Saving keys…" });
    try {
      const settings = await api.saveSettings({
        openaiApiKey: openai,
        meshyApiKey: meshy,
      });
      set({ settings, showSettings: false, busy: null, error: null });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  saveBrief: async () => {
    const scene = get().scene;
    if (!scene) return;
    set({ busy: "Saving…" });
    try {
      const next = await api.updateScene(scene.id, {
        name: scene.name,
        description: scene.description,
        stage: scene.stage,
      });
      set({ scene: next, busy: null });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  generateConcepts: async (plateBlob) => {
    const scene = get().scene;
    if (!scene) return;
    set({ busy: "Planning + drawing three concepts with OpenAI…", error: null });
    try {
      await api.updateScene(scene.id, {
        name: scene.name,
        description: scene.description,
        stage: scene.stage,
      });
      if (plateBlob) await api.uploadStagePlate(scene.id, plateBlob);
      const next = await api.generateConcepts(scene.id);
      set({
        scene: next,
        busy: null,
        tab: "concepts",
        selectedConceptId: next.concepts[0]?.id ?? null,
      });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  regenerate: async (conceptId) => {
    const scene = get().scene;
    if (!scene) return;
    set({ busy: "Regenerating concept…", error: null });
    try {
      const next = await api.regenerateConcept(scene.id, conceptId);
      set({ scene: next, busy: null });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  refine: async (conceptId) => {
    const scene = get().scene;
    const instruction = get().refineText;
    if (!scene || !instruction.trim()) return;
    set({ busy: "Refining concept…", error: null });
    try {
      const next = await api.refineConcept(scene.id, conceptId, instruction);
      set({ scene: next, busy: null, refineText: "" });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  uploadRendering: async (file) => {
    const scene = get().scene;
    if (!scene) return;
    set({ busy: "Analyzing your rendering…", error: null });
    try {
      const next = await api.uploadConcept(scene.id, file);
      const yours = [...next.concepts].reverse().find((c) => c.source === "user");
      set({
        scene: next,
        busy: null,
        tab: "concepts",
        selectedConceptId: yours?.id ?? next.concepts.at(-1)?.id ?? null,
      });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  approve: async (conceptId) => {
    const scene = get().scene;
    if (!scene) return;
    set({
      busy: "Approving — measuring layout from image, then auto-building…",
      error: null,
    });
    try {
      const next = await api.approveConcept(scene.id, conceptId);
      set({ scene: next, busy: null, tab: "assemble" });
      get().startPolling();
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  relayout: async () => {
    const scene = get().scene;
    if (!scene) return;
    set({ busy: "Re-measuring + rescaling to match image and fit table…", error: null });
    try {
      const next = await api.relayoutScene(scene.id);
      set({ scene: next, busy: null });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  importLayoutImage: async (file) => {
    const scene = get().scene;
    if (!scene) return;
    set({
      busy: "Importing layout image — placing matching library assets (no Meshy)…",
      error: null,
    });
    try {
      await api.updateScene(scene.id, {
        name: scene.name,
        description: scene.description,
        stage: scene.stage,
      });
      const next = await api.layoutFromImage(scene.id, file);
      set({ scene: next, busy: null, tab: "assemble" });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  generateObject: async (objectId) => {
    const scene = get().scene;
    if (!scene) return;
    if (!scene.approvedConceptId) {
      set({ error: "Approve a concept before generating 3D assets." });
      return;
    }
    set({ busy: "Isolating + Meshy for one object…", error: null });
    try {
      const next = await api.generateObject(scene.id, objectId);
      set({ scene: next, busy: null });
      await get().refreshLibrary();
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  refreshScene: async () => {
    const scene = get().scene;
    if (!scene) return;
    const next = await api.getScene(scene.id);
    set({ scene: next });
    if (!next.progress?.active) {
      get().stopPolling();
      await get().refreshLibrary();
    }
  },

  startPolling: () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void get().refreshScene().catch(() => undefined);
    }, 2500);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },

  refreshLibrary: async () => {
    const q = get().libraryQuery;
    set({ library: await api.library(q || undefined) });
  },

  placeFromLibrary: async (assetId) => {
    const scene = get().scene;
    if (!scene) return;
    set({ busy: "Placing library asset…" });
    try {
      const next = await api.placeAsset(scene.id, assetId);
      set({ scene: next, busy: null, tab: "assemble" });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  newScene: async () => {
    get().stopPolling();
    set({ busy: "Creating scene…" });
    try {
      const scene = await api.createScene();
      set({
        scene,
        busy: null,
        tab: "brief",
        selectedConceptId: null,
        selectedObjectId: null,
        hiddenObjectIds: [],
      });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
