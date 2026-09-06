import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF, Html } from "@react-three/drei";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Scene, SceneObject, Stage } from "./types";

export function Viewport({
  scene,
  selectedObjectId,
  hiddenObjectIds,
  onSelect,
  captureRef,
}: {
  scene: Scene;
  selectedObjectId: string | null;
  hiddenObjectIds: Set<string>;
  onSelect: (id: string | null) => void;
  captureRef?: React.MutableRefObject<(() => Promise<Blob | null>) | null>;
}) {
  return (
    <Canvas
      shadows
      camera={{
        position: [
          scene.stage.viewer.position.x,
          scene.stage.viewer.position.y,
          scene.stage.viewer.position.z,
        ],
        fov: 40,
        near: 0.01,
        far: 50,
      }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
    >
      <color attach="background" args={["#ffffff"]} />
      <hemisphereLight args={["#ffffff", "#e8e4dc", 0.9]} />
      <directionalLight
        castShadow
        position={[1.4, 2.6, 1.2]}
        intensity={1.05}
        shadow-mapSize={[1024, 1024]}
      />
      <StageScene
        scene={scene}
        selectedObjectId={selectedObjectId}
        hiddenObjectIds={hiddenObjectIds}
        onSelect={onSelect}
      />
      <OrbitControls
        target={[
          scene.stage.viewer.target.x,
          scene.stage.viewer.target.y,
          scene.stage.viewer.target.z,
        ]}
        makeDefault
      />
      {captureRef ? <CaptureBridge captureRef={captureRef} /> : null}
    </Canvas>
  );
}

function CaptureBridge({
  captureRef,
}: {
  captureRef: React.MutableRefObject<(() => Promise<Blob | null>) | null>;
}) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    captureRef.current = async () => {
      gl.render(scene, camera);
      const data = gl.domElement.toDataURL("image/png");
      const res = await fetch(data);
      return res.blob();
    };
    return () => {
      captureRef.current = null;
    };
  }, [gl, scene, camera, captureRef]);
  return null;
}

function StageScene({
  scene,
  selectedObjectId,
  hiddenObjectIds,
  onSelect,
}: {
  scene: Scene;
  selectedObjectId: string | null;
  hiddenObjectIds: Set<string>;
  onSelect: (id: string | null) => void;
}) {
  const grass = scene.objects.find(
    (o) => o.role === "foundation" || /grass/i.test(o.name),
  );
  const grassHidden = grass ? hiddenObjectIds.has(grass.id) : false;

  return (
    <group>
      <Table stage={scene.stage} />
      <HeightCage stage={scene.stage} />
      {!grassHidden ? (
        <GrassFoundation stage={scene.stage} objects={scene.objects} />
      ) : null}
      {scene.objects
        .filter((o) => o.role !== "foundation" && o.status !== "procedural")
        .filter((o) => !hiddenObjectIds.has(o.id))
        .map((obj) => (
          <SceneObjectView
            key={`${obj.id}-${obj.transform?.boxHeight ?? 0}-${obj.transform?.boxWidth ?? 0}-${obj.box.sx}-${obj.box.sy}`}
            obj={obj}
            stage={scene.stage}
            selected={selectedObjectId === obj.id}
            onSelect={() => onSelect(obj.id)}
          />
        ))}
    </group>
  );
}

function Table({ stage }: { stage: Stage }) {
  const isCircle = stage.shape === "circle" || almostCircle(stage.polygon);
  const radius = stage.size.width / 2;
  const shape = useMemo(() => polygonShape(stage.polygon), [stage.polygon]);

  if (isCircle) {
    return (
      <group>
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, stage.tableHeight, 0]}
          receiveShadow
        >
          <circleGeometry args={[radius, 64]} />
          <meshStandardMaterial color="#8b6a4a" roughness={0.82} />
        </mesh>
        <mesh position={[0, stage.tableHeight / 2, 0]} castShadow>
          <cylinderGeometry args={[radius * 0.12, radius * 0.18, stage.tableHeight, 24]} />
          <meshStandardMaterial color="#5c4332" roughness={0.9} />
        </mesh>
      </group>
    );
  }

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, stage.tableHeight, 0]}
        receiveShadow
      >
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial color="#8b6a4a" roughness={0.82} />
      </mesh>
      <mesh position={[0, stage.tableHeight / 2, 0]} castShadow>
        <boxGeometry args={[stage.size.width * 0.92, stage.tableHeight, stage.size.depth * 0.92]} />
        <meshStandardMaterial color="#5c4332" roughness={0.9} />
      </mesh>
    </group>
  );
}

function HeightCage({ stage }: { stage: Stage }) {
  const h = stage.size.height;
  const isCircle = stage.shape === "circle" || almostCircle(stage.polygon);
  if (isCircle) {
    return (
      <mesh position={[0, stage.tableHeight + h / 2, 0]}>
        <cylinderGeometry args={[stage.size.width / 2, stage.size.width / 2, h, 48, 1, true]} />
        <meshBasicMaterial color="#5a7a9a" wireframe transparent opacity={0.45} />
      </mesh>
    );
  }
  return (
    <mesh position={[0, stage.tableHeight + h / 2, 0]}>
      <boxGeometry args={[stage.size.width, h, stage.size.depth]} />
      <meshBasicMaterial color="#5a7a9a" wireframe transparent opacity={0.45} />
    </mesh>
  );
}

function GrassFoundation({
  stage,
  objects,
}: {
  stage: Stage;
  objects: SceneObject[];
}) {
  const grass = objects.find((o) => o.role === "foundation" || /grass/i.test(o.name));
  const shape = useMemo(() => polygonShape(stage.polygon), [stage.polygon]);
  const show = Boolean(grass) || objects.length === 0;
  if (!show && !grass) return null;
  const isCircle = stage.shape === "circle" || almostCircle(stage.polygon);
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, stage.tableHeight + 0.004, 0]}
      receiveShadow
    >
      {isCircle ? (
        <circleGeometry args={[stage.size.width / 2 * 0.98, 64]} />
      ) : (
        <shapeGeometry args={[shape]} />
      )}
      <meshStandardMaterial color="#6a8248" roughness={0.95} />
    </mesh>
  );
}

function SceneObjectView({
  obj,
  stage,
  selected,
  onSelect,
}: {
  obj: SceneObject;
  stage: Stage;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = obj.transform;
  const floating = obj.role === "action";
  const raw = t?.position ?? boxToPos(obj.box, stage);
  const pos = {
    x: raw.x,
    y: floating
      ? Math.min(
          Math.max(raw.y, stage.tableHeight + 0.08),
          stage.tableHeight + stage.size.height * 0.5,
        )
      : stage.tableHeight,
    z: raw.z,
  };
  const yaw = t?.rotation?.y ?? 0;

  // Sensible size caps so bad layout boxes don't explode scale
  const table = Math.max(stage.size.width, stage.size.depth);
  const boxH = Math.min(
    Math.max(0.04, t?.boxHeight ?? obj.box.sy * stage.size.height),
    stage.size.height * 0.95,
  );
  const boxW = Math.min(
    Math.max(0.03, t?.boxWidth ?? obj.box.sx * stage.size.width),
    table * 0.55,
  );
  const boxD = Math.min(
    Math.max(0.03, t?.boxDepth ?? obj.box.sz * stage.size.depth),
    table * 0.55,
  );

  if (obj.glbUrl) {
    return (
      <Suspense
        fallback={
          <PlaceholderBox
            obj={obj}
            position={pos}
            yaw={yaw}
            size={[boxW, boxH, boxD]}
            label="Loading…"
            selected={selected}
          />
        }
      >
        <FittedGlb
          url={obj.glbUrl}
          position={pos}
          yaw={yaw}
          targetSize={[boxW, boxH, boxD]}
          selected={selected}
          onSelect={onSelect}
          name={obj.name}
        />
      </Suspense>
    );
  }

  const label =
    obj.status === "isolating" || obj.status === "meshing" || obj.status === "queued"
      ? obj.status
      : obj.isolateImageUrl
        ? "MOCK / generating"
        : obj.status;

  return (
    <PlaceholderBox
      obj={obj}
      position={pos}
      yaw={yaw}
      size={[boxW, boxH, boxD]}
      label={label}
      selected={selected}
      onSelect={onSelect}
      imageUrl={obj.isolateImageUrl ?? undefined}
    />
  );
}

/**
 * Meshy GLBs are often in cm-scale units. We MUST scale first, then measure,
 * then put feet on y=0 — offsetting before scale flings the mesh into the sky.
 */
function FittedGlb({
  url,
  position,
  yaw,
  targetSize,
  selected,
  onSelect,
  name,
}: {
  url: string;
  position: { x: number; y: number; z: number };
  yaw: number;
  targetSize: [number, number, number];
  selected: boolean;
  onSelect: () => void;
  name: string;
}) {
  const { scene } = useGLTF(url);
  const [targetW, targetH, targetD] = targetSize;
  const fitted = useMemo(() => {
    const root = new THREE.Group();
    const clone = scene.clone(true);
    root.add(clone);

    clone.updateWorldMatrix(true, true);
    const rawBox = new THREE.Box3().setFromObject(clone);
    if (rawBox.isEmpty()) return root;

    const rawSize = rawBox.getSize(new THREE.Vector3());
    // Match planned height primarily; keep footprint from exploding
    let scale = targetH / Math.max(rawSize.y, 1e-4);
    const foot = Math.max(rawSize.x, rawSize.z) * scale;
    const maxFoot = Math.max(targetW, targetD, 0.04) * 1.35;
    if (foot > maxFoot) scale *= maxFoot / foot;

    clone.scale.setScalar(scale);
    clone.position.set(0, 0, 0);
    clone.updateWorldMatrix(true, true);

    const box = new THREE.Box3().setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    // Position is applied after scale in local matrix, in parent units (= scaled world here)
    clone.position.x += -center.x;
    clone.position.z += -center.z;
    clone.position.y += -box.min.y;

    clone.traverse((c) => {
      c.castShadow = true;
      c.receiveShadow = true;
    });
    return root;
  }, [scene, targetW, targetH, targetD]);

  return (
    <group
      position={[position.x, position.y, position.z]}
      rotation={[0, yaw, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <primitive object={fitted} />
      {selected ? (
        <Html center distanceFactor={3}>
          <div className="badge pass">{name}</div>
        </Html>
      ) : null}
    </group>
  );
}

function PlaceholderBox({
  obj,
  position,
  yaw = 0,
  size,
  label,
  selected,
  onSelect,
  imageUrl,
}: {
  obj: SceneObject;
  position: { x: number; y: number; z: number };
  yaw?: number;
  size: [number, number, number];
  label: string;
  selected?: boolean;
  onSelect?: () => void;
  imageUrl?: string;
}) {
  const texture = useMemo(() => {
    if (!imageUrl) return null;
    return new THREE.TextureLoader().load(imageUrl);
  }, [imageUrl]);

  return (
    <group
      position={[position.x, position.y + size[1] / 2, position.z]}
      rotation={[0, yaw, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
    >
      <mesh castShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial
          map={texture ?? undefined}
          color={texture ? "#ffffff" : selected ? "#6b8cae" : "#c9c2b4"}
          transparent
          opacity={texture ? 1 : 0.55}
        />
      </mesh>
      <Html center distanceFactor={2.8}>
        <div className={`badge ${/ready|pass/i.test(label) ? "pass" : "mock"}`}>
          {obj.name} · {label}
        </div>
      </Html>
    </group>
  );
}

function almostCircle(poly: Array<{ x: number; z: number }>) {
  return poly.length >= 24;
}

function polygonShape(poly: Array<{ x: number; z: number }>) {
  const shape = new THREE.Shape();
  if (!poly.length) {
    shape.moveTo(-0.5, -0.5);
    shape.lineTo(0.5, -0.5);
    shape.lineTo(0.5, 0.5);
    shape.lineTo(-0.5, 0.5);
    return shape;
  }
  shape.moveTo(poly[0].x, poly[0].z);
  for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i].x, poly[i].z);
  shape.closePath();
  return shape;
}

function boxToPos(box: SceneObject["box"], stage: Stage) {
  return {
    x: (box.x - 0.5) * stage.size.width,
    y: stage.tableHeight + Math.max(0, box.y) * stage.size.height,
    z: (box.z - 0.5) * stage.size.depth,
  };
}
