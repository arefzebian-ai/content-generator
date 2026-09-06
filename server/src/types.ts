export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Normalized AABB in stage space: position center (0–1), size (0–1 of volume). */
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
  /** Table surface height from floor (m). */
  tableHeight: number;
  /** Content volume size W×H×D in meters (H = allowed height). For circle, width=depth=diameter. */
  size: { width: number; height: number; depth: number };
  /** circle | polygon — placeholder shape of the build surface. */
  shape: "circle" | "polygon";
  /** Closed polygon on the table top in local meters, origin at table center. */
  polygon: Array<{ x: number; z: number }>;
  viewer: {
    position: Vec3;
    target: Vec3;
  };
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
  role: "environment" | "character" | "action" | "prop" | "foundation";
  purpose: string;
  box: ObjectBox;
  /** Yaw in degrees around up-axis; 0 = facing camera (+Z). */
  yaw?: number;
  /** If true, generate procedurally (grass) — never Meshy. */
  procedural?: boolean;
}

export interface ConceptBrief {
  title: string;
  summary: string;
  objects: PlannedObject[];
}

export interface PlanResult {
  styleFamily: StyleFamily;
  concepts: ConceptBrief[];
}

export const NEWTON_DESCRIPTION = `A living tabletop diorama for a round coffee table: Isaac Newton discovers gravity. Grass grows across the usable table disk. A tree stands rear-right. Newton sits forward-left facing the viewer. An apple falls through a clear central lane. Style: Living Historical Illustration — soft painted miniature, linen and navy, warm bark and foliage, crimson apple. No planets, sun, moon, cosmic imagery, neon, glossy plastic, or large floating panels.`;

/** Approx a circle as a polygon for grass extrusion. */
export function circlePolygon(radius: number, segments = 48): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * radius, z: Math.sin(a) * radius });
  }
  return pts;
}

export function sampleStage(): Stage {
  const diameter = 0.9;
  const radius = diameter / 2;
  return {
    name: "Round coffee table",
    tableHeight: 0.42,
    size: { width: diameter, height: 0.42, depth: diameter },
    shape: "circle",
    polygon: circlePolygon(radius),
    viewer: {
      position: { x: 0.02, y: 1.14, z: 1.35 },
      target: { x: 0, y: 0.55, z: 0 },
    },
  };
}
