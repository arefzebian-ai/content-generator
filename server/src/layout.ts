import type { ObjectBox, PlannedObject, Stage } from "./types.js";

export interface MeterPlacement {
  /** Meters from table center; +X right, +Z toward camera / front of table. */
  x: number;
  z: number;
  /** Meters above table surface (0 = sitting on grass). */
  elev: number;
  /** Footprint width (X) in meters. */
  width: number;
  /** Object height in meters. */
  height: number;
  /** Footprint depth (Z) in meters. */
  depth: number;
  /** Yaw degrees around up-axis; 0 = facing camera (+Z). */
  yawDeg?: number;
}

/** Image-space placement on the table disk (matches the rendering). */
export interface TableUvPlacement {
  /** 0 = left edge of table, 1 = right edge */
  u: number;
  /** 0 = back of table (top of photo), 1 = front (bottom of photo / toward camera) */
  v: number;
  /** Footprint width as fraction of table diameter */
  wFrac: number;
  /** Height as fraction of allowed content height */
  hFrac: number;
  /** Footprint depth as fraction of table diameter */
  dFrac: number;
  /** Elevation as fraction of content height (0 on grass) */
  elevFrac?: number;
  yawDeg?: number;
}

/** Only explicit mid-air action props may leave the table. */
export function isFloatingObject(o: PlannedObject): boolean {
  if (o.procedural || o.role === "foundation") return false;
  if (o.role === "environment" || o.role === "character") return false;
  if (o.role === "action") return true;
  const text = `${o.name} ${o.purpose}`.toLowerCase();
  if (/tree|newton|grass|ground|figure|character|person|isaac|man|boy/.test(text)) {
    return false;
  }
  return /falling|mid-?air|floating|hovering|suspended/.test(text);
}

export function tableUvToMeters(p: TableUvPlacement, stage: Stage): MeterPlacement {
  const diameter = Math.max(stage.size.width, stage.size.depth);
  const u = clamp01(p.u, 0.5);
  const v = clamp01(p.v, 0.5);
  return {
    x: (u - 0.5) * diameter,
    z: (v - 0.5) * diameter,
    elev: Math.max(0, (p.elevFrac ?? 0) * stage.size.height),
    width: Math.max(0.02, p.wFrac * diameter),
    height: Math.max(0.02, p.hFrac * stage.size.height),
    depth: Math.max(0.02, (p.dFrac || p.wFrac) * diameter),
    yawDeg: p.yawDeg,
  };
}

/** Convert table-local meters into normalized stage boxes. */
export function metersToBox(p: MeterPlacement, stage: Stage, floating = false): ObjectBox {
  const w = Math.max(stage.size.width, 1e-4);
  const h = Math.max(stage.size.height, 1e-4);
  const d = Math.max(stage.size.depth, 1e-4);
  const elev = sanitizeElev(p.elev, floating, stage);
  return clampBox({
    x: 0.5 + p.x / w,
    y: elev / h,
    z: 0.5 + p.z / d,
    sx: Math.max(0.02, p.width) / w,
    sy: Math.max(0.02, Math.min(p.height, h * 0.98)) / h,
    sz: Math.max(0.02, p.depth) / d,
  });
}

export function sanitizeElev(elev: number, floating: boolean, stage: Stage): number {
  if (!floating) return 0;
  if (!Number.isFinite(elev) || elev <= 0) return stage.size.height * 0.4;
  const h = stage.size.height;
  if (elev > 0 && elev <= 1 && elev < h * 0.85) {
    return Math.min(elev, h * 0.55);
  }
  if (elev > h) {
    if (elev <= 100) return Math.min((elev / 100) * h, h * 0.55);
    return h * 0.4;
  }
  return Math.min(elev, h * 0.55);
}

function clamp01(v: number, fallback: number) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

export function clampBox(box: ObjectBox): ObjectBox {
  return {
    x: clamp01(box.x, 0.5),
    y: clamp01(box.y, 0),
    z: clamp01(box.z, 0.5),
    sx: Math.max(0.02, clamp01(box.sx, 0.2)),
    sy: Math.max(0.02, clamp01(box.sy, 0.3)),
    sz: Math.max(0.02, clamp01(box.sz, 0.2)),
  };
}

/** Soft role size priors so relative scale matches a typical diorama rendering. */
export function applyRoleSizePriors(o: PlannedObject): PlannedObject {
  if (o.procedural || o.role === "foundation") return o;
  const box = { ...clampBox(o.box) };
  const name = `${o.name} ${o.purpose}`.toLowerCase();

  if (o.role === "environment" || /tree/.test(name)) {
    box.sy = clamp(box.sy, 0.55, 0.92);
    box.sx = clamp(box.sx, 0.22, 0.48);
    box.sz = clamp(box.sz, 0.22, 0.48);
  } else if (o.role === "character" || /newton|figure|person|isaac/.test(name)) {
    box.sy = clamp(box.sy, 0.22, 0.42);
    box.sx = clamp(box.sx, 0.1, 0.22);
    box.sz = clamp(box.sz, 0.1, 0.22);
  } else if (o.role === "action" || (/\bapple\b/.test(name) && !/tree/.test(name))) {
    box.sy = clamp(box.sy, 0.06, 0.14);
    box.sx = clamp(box.sx, 0.035, 0.09);
    box.sz = clamp(box.sz, 0.035, 0.09);
  }

  return { ...o, box };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Keep relative layout from the rendering, then uniformly scale positions +
 * sizes so the whole composition fits inside the table disk and height cage.
 */
export function fitCompositionToStage(
  objects: PlannedObject[],
  stage: Stage,
): PlannedObject[] {
  let next = normalizePlannedObjects(objects).map(applyRoleSizePriors);

  const tree = next.find((o) => /tree/i.test(o.name) && o.role !== "foundation");
  const character = next.find(
    (o) => o.role === "character" || /newton|figure|isaac/i.test(o.name),
  );
  const apples = next.filter(
    (o) => /\bapple\b/i.test(o.name) && !/tree/i.test(o.name),
  );
  if (tree && character && character.box.sy > tree.box.sy * 0.65) {
    character.box.sy = tree.box.sy * 0.4;
    character.box.sx = Math.min(character.box.sx, tree.box.sx * 0.45);
    character.box.sz = Math.min(character.box.sz, tree.box.sz * 0.45);
  }
  if (character) {
    for (const a of apples) {
      a.box.sy = Math.min(a.box.sy, character.box.sy * 0.28);
      a.box.sx = Math.min(a.box.sx, character.box.sx * 0.45);
      a.box.sz = Math.min(a.box.sz, character.box.sz * 0.45);
    }
  }

  let maxR = 0;
  for (const o of next) {
    if (o.procedural || o.role === "foundation") continue;
    const half = Math.max(o.box.sx, o.box.sz) * 0.5;
    maxR = Math.max(maxR, Math.hypot(o.box.x - 0.5, o.box.z - 0.5) + half);
  }
  if (maxR > 0.47) {
    const s = 0.47 / maxR;
    next = next.map((o) => {
      if (o.procedural || o.role === "foundation") return o;
      return {
        ...o,
        box: clampBox({
          ...o.box,
          x: 0.5 + (o.box.x - 0.5) * s,
          z: 0.5 + (o.box.z - 0.5) * s,
          sx: o.box.sx * s,
          sz: o.box.sz * s,
        }),
      };
    });
  }

  let maxTop = 0;
  for (const o of next) {
    if (o.procedural || o.role === "foundation") continue;
    maxTop = Math.max(maxTop, o.box.y + o.box.sy);
  }
  if (maxTop > 0.96) {
    const s = 0.92 / maxTop;
    next = next.map((o) => {
      if (o.procedural || o.role === "foundation") return o;
      return {
        ...o,
        box: clampBox({
          ...o.box,
          y: o.box.y * s,
          sy: o.box.sy * s,
        }),
      };
    });
  }

  // Final relative scale pass (after fit) — match diorama hierarchy in the rendering
  next = normalizePlannedObjects(next);
  {
    const t = next.find((o) => /tree/i.test(o.name) && o.role !== "foundation");
    const c = next.find(
      (o) => o.role === "character" || /newton|figure|isaac/i.test(o.name),
    );
    const aList = next.filter(
      (o) => /\bapple\b/i.test(o.name) && !/tree/i.test(o.name),
    );
    if (t && c) {
      c.box.sy = Math.min(c.box.sy, t.box.sy * 0.45);
      c.box.sx = Math.min(c.box.sx, t.box.sx * 0.5);
      c.box.sz = Math.min(c.box.sz, t.box.sz * 0.5);
    }
    if (c) {
      for (const a of aList) {
        a.box.sy = Math.min(a.box.sy, c.box.sy * 0.3);
        a.box.sx = Math.min(a.box.sx, c.box.sx * 0.5);
        a.box.sz = Math.min(a.box.sz, c.box.sz * 0.5);
      }
    }
  }

  return normalizePlannedObjects(next);
}

export function groundObject(o: PlannedObject): PlannedObject {
  if (o.procedural || o.role === "foundation") {
    return {
      ...o,
      yaw: 0,
      box: clampBox({ x: 0.5, y: 0, z: 0.5, sx: 1, sy: 0.04, sz: 1 }),
    };
  }
  const box = clampBox(o.box);
  if (!isFloatingObject(o)) {
    box.y = 0;
  } else {
    box.y = Math.min(box.y, 0.55);
  }
  const cx = box.x - 0.5;
  const cz = box.z - 0.5;
  const r = Math.hypot(cx, cz);
  const maxR = 0.46;
  if (r > maxR) {
    const s = maxR / r;
    box.x = 0.5 + cx * s;
    box.z = 0.5 + cz * s;
  }
  return { ...o, box, yaw: o.yaw ?? 0 };
}

export function normalizePlannedObjects(objects: PlannedObject[]): PlannedObject[] {
  return (objects ?? []).map((o) =>
    groundObject({
      ...o,
      box: clampBox(o.box ?? { x: 0.5, y: 0, z: 0.5, sx: 0.2, sy: 0.3, sz: 0.2 }),
      yaw: typeof o.yaw === "number" && Number.isFinite(o.yaw) ? o.yaw : 0,
    }),
  );
}

export function boxToTransform(
  box: ObjectBox,
  stage: Stage,
  yawDeg = 0,
  opts?: { floating?: boolean },
) {
  const w = stage.size.width;
  const h = stage.size.height;
  const d = stage.size.depth;
  const floating = Boolean(opts?.floating);
  const elevNorm = floating ? Math.min(Math.max(0, box.y), 0.55) : 0;
  const boxHeight = Math.max(0.02, (box.sy || 0.3) * h);
  const boxWidth = Math.max(0.02, (box.sx || 0.2) * w);
  const boxDepth = Math.max(0.02, (box.sz || 0.2) * d);
  return {
    position: {
      x: (box.x - 0.5) * w,
      y: stage.tableHeight + elevNorm * h,
      z: (box.z - 0.5) * d,
    },
    rotation: { x: 0, y: (yawDeg * Math.PI) / 180, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    boxHeight,
    boxWidth,
    boxDepth,
    grounded: !floating,
  };
}

export function applyMeterPlacements(
  objects: PlannedObject[],
  placements: Array<{
    name: string;
    x: number;
    z: number;
    elev?: number;
    width: number;
    height: number;
    depth?: number;
    yawDeg?: number;
    role?: PlannedObject["role"];
    purpose?: string;
    procedural?: boolean;
  }>,
  stage: Stage,
): PlannedObject[] {
  const byName = new Map(
    placements.map((p) => [p.name.trim().toLowerCase(), p]),
  );
  const mapped = objects.map((orig) => {
    const hit = byName.get(orig.name.trim().toLowerCase());
    if (!hit) return orig;
    const merged: PlannedObject = {
      ...orig,
      role: hit.role ?? orig.role,
      purpose: hit.purpose ?? orig.purpose,
      procedural: hit.procedural ?? orig.procedural,
      yaw: hit.yawDeg ?? orig.yaw ?? 0,
      box: orig.box,
    };
    const floating = isFloatingObject(merged);
    const depth = hit.depth ?? hit.width;
    const elev = floating ? (hit.elev ?? stage.size.height * 0.4) : 0;
    return {
      ...merged,
      box: metersToBox(
        {
          x: hit.x,
          z: hit.z,
          elev,
          width: hit.width,
          height: hit.height,
          depth,
          yawDeg: hit.yawDeg,
        },
        stage,
        floating,
      ),
    };
  });
  return fitCompositionToStage(mapped, stage);
}

export function applyTableUvPlacements(
  objects: PlannedObject[],
  placements: Array<{
    name: string;
    u: number;
    v: number;
    wFrac: number;
    hFrac: number;
    dFrac?: number;
    elevFrac?: number;
    yawDeg?: number;
    role?: PlannedObject["role"];
    purpose?: string;
    procedural?: boolean;
  }>,
  stage: Stage,
): PlannedObject[] {
  const byName = new Map(
    placements.map((p) => [p.name.trim().toLowerCase(), p]),
  );
  const mapped = objects.map((orig) => {
    const hit = byName.get(orig.name.trim().toLowerCase());
    if (!hit) return orig;
    const merged: PlannedObject = {
      ...orig,
      role: hit.role ?? orig.role,
      purpose: hit.purpose ?? orig.purpose,
      procedural: hit.procedural ?? orig.procedural,
      yaw: hit.yawDeg ?? orig.yaw ?? 0,
      box: orig.box,
    };
    const floating = isFloatingObject(merged);
    const meters = tableUvToMeters(
      {
        u: hit.u,
        v: hit.v,
        wFrac: hit.wFrac,
        hFrac: hit.hFrac,
        dFrac: hit.dFrac ?? hit.wFrac,
        elevFrac: floating ? (hit.elevFrac ?? 0.4) : 0,
        yawDeg: hit.yawDeg,
      },
      stage,
    );
    return {
      ...merged,
      box: metersToBox(meters, stage, floating),
    };
  });
  return fitCompositionToStage(mapped, stage);
}

/** Classify object names so "apple" never matches "apple tree". */
export function nameKind(name: string): "tree" | "apple" | "character" | "foundation" | "other" {
  const n = normalizeName(name);
  if (/\b(grass|foundation|ground)\b/.test(n)) return "foundation";
  if (/\b(tree|oak|pine|willow|maple|elm)\b/.test(n)) return "tree";
  if (/\bapple\b/.test(n)) return "apple";
  if (/\b(newton|isaac|figure|character|person|man|boy)\b/.test(n)) return "character";
  return "other";
}

function nameTokens(normalized: string): string[] {
  return normalized.split(" ").filter(Boolean);
}

/** 0–1 similarity. Hard-rejects apple↔tree collisions. */
export function nameMatchScore(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;

  const ka = nameKind(a);
  const kb = nameKind(b);
  if (ka !== "other" && kb !== "other" && ka !== kb) return 0;

  if (na === nb) return 1;

  const ta = nameTokens(na);
  const tb = nameTokens(nb);
  const setA = new Set(ta);
  const setB = new Set(tb);
  const inter = ta.filter((t) => setB.has(t));
  if (inter.length === 0) return 0;

  // "apple" ⊂ "apple tree" — kinds already conflict when tree present on one side
  const shorter = ta.length <= tb.length ? ta : tb;
  const longerSet = ta.length <= tb.length ? setB : setA;
  const shorterIsSubset = shorter.every((t) => longerSet.has(t));
  if (shorterIsSubset && ka === kb) {
    // Prefer more complete names: "falling apple" ↔ "apple"
    return 0.7 + 0.2 * (inter.length / Math.max(ta.length, tb.length));
  }

  const unionSize = new Set([...ta, ...tb]).size;
  const jaccard = inter.length / unionSize;
  if (jaccard >= 0.5) return jaccard;

  // Strong unique token (newton, etc.)
  if (inter.some((t) => t.length >= 5) && (ka === kb || ka === "other" || kb === "other")) {
    return 0.65;
  }

  return 0;
}

export function namesMatch(a: string, b: string): boolean {
  return nameMatchScore(a, b) >= 0.55;
}

/** Pick the best library asset for a scene object name. */
export function bestLibraryMatch<T extends { name: string }>(
  query: string,
  items: T[],
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    const score = nameMatchScore(query, item.name);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= 0.55 ? best : null;
}

function normalizeName(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    // Keep "falling" — it helps separate fruit apple from other props; do not strip it.
    .replace(/\b(the|a|an|old|young|small|large|red|green)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
