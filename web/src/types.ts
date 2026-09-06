export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ObjectBox {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
}

export interface Stage {
  name: string;
  tableHeight: number;
  size: { width: number; height: number; depth: number };
  shape: "circle" | "polygon";
  polygon: Array<{ x: number; z: number }>;
  viewer: { position: Vec3; target: Vec3 };
}

export interface StyleFamily {
  id: string;
  name: string;
  artDirection: string;
  shapeLanguage: string;
  palette: Array<{ name: string; hex: string; usage: string }>;
  materials: string;
  forbidden: string[];
}

export interface PlannedObject {
  name: string;
  role: string;
  purpose: string;
  box: ObjectBox;
  yaw?: number;
  procedural?: boolean;
}

export interface Concept {
  id: string;
  source: string;
  title: string;
  summary: string;
  imageUrl: string | null;
  imagePath?: string | null;
  objects: PlannedObject[];
  styleFamily: StyleFamily | null;
  createdAt: number;
}

export interface SceneObject {
  id: string;
  name: string;
  role: string;
  box: ObjectBox;
  isolateImageUrl: string | null;
  status: string;
  assetId: string | null;
  assetVersion: number | null;
  transform: {
    position: Vec3;
    rotation: Vec3;
    scale: Vec3;
    boxHeight?: number;
    boxWidth?: number;
    boxDepth?: number;
  } | null;
  generationSettings: unknown;
  glbUrl: string | null;
}

export interface SceneProgress {
  total: number;
  ready: number;
  failed: number;
  active: number;
  percent: number;
  label: string | null;
}

export interface Scene {
  id: string;
  name: string;
  description: string;
  stage: Stage;
  styleFamily: StyleFamily | null;
  approvedConceptId: string | null;
  status: string;
  concepts: Concept[];
  objects: SceneObject[];
  progress?: SceneProgress;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryAsset {
  id: string;
  name: string;
  styleFamilyId: string;
  currentVersion: number;
  glbUrl: string | null;
  thumbnailUrl: string | null;
  referenceImageUrl: string | null;
  generationSettings: unknown;
  styleFamily: StyleFamily | null;
}

export interface SettingsStatus {
  openaiConfigured: boolean;
  meshyConfigured: boolean;
  openaiHint: string | null;
  meshyHint: string | null;
}

export type Tab = "brief" | "concepts" | "assemble" | "library";
