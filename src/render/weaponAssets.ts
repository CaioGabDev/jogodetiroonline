import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { W } from '../game/weapons';

/**
 * Weapon GLB models (see CREDITS.md). Each file loads once and is normalized:
 * barrel along -Z, muzzle tip at the origin, gun extending towards +Z, length 1.
 * A model that fails to load is simply never reported, so callers keep their procedural gun.
 */

interface ModelSpec {
  file: string;
  /** Turns the file's own axes into barrel -Z, up +Y. */
  rotation?: [number, number, number];
  /** Replaces the sight height measured from the mesh, for guns too wide to look along the barrel. */
  sightHeight?: number;
}

/** Files that point the barrel along +X. */
const BARREL_X: [number, number, number] = [0, Math.PI / 2, 0];

const SPECS: Record<number, ModelSpec> = {
  [W.RIFLE]: { file: 'rifle.glb', rotation: BARREL_X },
  [W.PISTOL]: { file: 'pistol.glb', rotation: BARREL_X },
  [W.SHOTGUN]: { file: 'shotgun.glb', rotation: BARREL_X },
  [W.SNIPER]: { file: 'sniper.glb', rotation: BARREL_X },
  [W.KNIFE]: { file: 'knife.glb', rotation: [-Math.PI / 2, 0, 0] },
  [W.SMG]: { file: 'smg.glb', rotation: BARREL_X },
  [W.LMG]: { file: 'lmg.glb' },
  [W.CROSSBOW]: { file: 'crossbow.glb' },
  [W.DMR]: { file: 'dmr.glb' },
  [W.LAUNCHER]: { file: 'launcher.glb', sightHeight: 0.2 },
  [W.DEAGLE]: { file: 'deagle.glb' },
  [W.REVOLVER]: { file: 'revolver.glb', rotation: BARREL_X },
  [W.AUTO_PISTOL]: { file: 'autopistol.glb', rotation: BARREL_X },
};

/** Share of the length, from the tip, used to find the bore and the front sight. */
const BORE_SLICE = 0.02;
const SIGHT_SLICE = 0.25;
/** Without an environment map, metallic materials and near-black paint turn into a silhouette. */
const MAX_METALNESS = 0.15;
const LIGHTEN = 0.07;

export interface WeaponAsset {
  /** New instance that shares geometry and materials: never dispose it. */
  instance(): THREE.Object3D;
  /** Height of the sights above the bore, as a share of the length. */
  sightHeight: number;
}

type ReadyCallback = (asset: WeaponAsset) => void;

const assets = new Map<number, WeaponAsset>();
const waiting = new Map<number, ReadyCallback[]>();
let started = false;

function forEachVertex(root: THREE.Object3D, visit: (v: THREE.Vector3) => void): void {
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position');
    for (let i = 0; i < pos.count; i++) visit(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
}

function normalize(scene: THREE.Object3D, spec: ModelSpec): WeaponAsset {
  const inner = new THREE.Group();
  inner.add(scene);
  if (spec.rotation) inner.rotation.set(...spec.rotation);

  const box = new THREE.Box3();
  forEachVertex(inner, (v) => box.expandByPoint(v));
  const length = box.max.z - box.min.z;

  let boreSum = 0;
  let boreCount = 0;
  let sightTop = -Infinity;
  forEachVertex(inner, (v) => {
    const fromTip = (v.z - box.min.z) / length;
    if (fromTip < BORE_SLICE) {
      boreSum += v.y;
      boreCount++;
    }
    if (fromTip < SIGHT_SLICE) sightTop = Math.max(sightTop, v.y);
  });
  const boreY = boreSum / Math.max(1, boreCount);

  inner.position.set(-(box.min.x + box.max.x) / 2, -boreY, -box.min.z);
  const root = new THREE.Group();
  root.add(inner);
  root.scale.setScalar(1 / length);

  // Meshes share materials, so each one must be adjusted only once.
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    for (const m of [o.material].flat()) materials.add(m);
  });
  for (const m of materials) {
    if (!(m instanceof THREE.MeshStandardMaterial)) continue;
    m.metalness = Math.min(m.metalness, MAX_METALNESS);
    m.color.offsetHSL(0, 0, LIGHTEN);
  }

  return { instance: () => cloneSkinned(root), sightHeight: spec.sightHeight ?? (sightTop - boreY) / length };
}

/** Starts downloading every model in the background. Safe to call more than once. */
export function loadWeaponModels(): void {
  if (started) return;
  started = true;
  const loader = new GLTFLoader();
  for (const [key, spec] of Object.entries(SPECS)) {
    const w = Number(key);
    loader
      .loadAsync(`/models/weapons/${spec.file}`)
      .then((gltf) => {
        const asset = normalize(gltf.scene, spec);
        assets.set(w, asset);
        waiting.get(w)?.forEach((cb) => cb(asset));
        waiting.delete(w);
      })
      .catch((err: unknown) => console.warn(`Modelo ${spec.file} não carregou; usando a arma procedural.`, err));
  }
}

/** The model of a weapon, or null while it isn't available. */
export function weaponAsset(w: number): WeaponAsset | null {
  return assets.get(w) ?? null;
}

/** Runs `cb` as soon as the model exists, right away if it already does. Never runs if it fails to load. */
export function onWeaponAsset(w: number, cb: ReadyCallback): void {
  const asset = assets.get(w);
  if (asset) cb(asset);
  else waiting.set(w, [...(waiting.get(w) ?? []), cb]);
}
