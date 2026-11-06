import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { W } from '../game/weapons';

const BASE = `${import.meta.env.BASE_URL}models/`;

/** The pack has no crossbow or launcher: those two keep the models built in code. */
const GUN_FILES: Partial<Record<number, { file: string; len: number }>> = {
  [W.RIFLE]: { file: 'AssaultRifle2_2', len: 0.87 },
  [W.SMG]: { file: 'SubmachineGun_3', len: 0.62 },
  [W.LMG]: { file: 'Bullpup_1', len: 1.05 },
  [W.SHOTGUN]: { file: 'Shotgun_2', len: 1 },
  [W.SNIPER]: { file: 'SniperRifle_1', len: 1.2 },
  [W.DMR]: { file: 'SniperRifle_4', len: 1.05 },
  [W.PISTOL]: { file: 'Pistol_1', len: 0.27 },
  [W.DEAGLE]: { file: 'Pistol_6', len: 0.36 },
  [W.AUTO_PISTOL]: { file: 'Pistol_4', len: 0.3 },
  [W.REVOLVER]: { file: 'Revolver_2', len: 0.32 },
  [W.KNIFE]: { file: 'Bayonet', len: 0.33 },
};

export interface GunAsset {
  /** Barrel along -Z, with the muzzle at the origin. Clone it: it is shared. */
  object: THREE.Group;
  len: number;
  /** Height of the sights over the bore. */
  sightY: number;
}

export interface SoldierAsset {
  object: THREE.Group;
  clips: THREE.AnimationClip[];
  height: number;
}

export const gunAssets = new Map<number, GunAsset>();
export let soldierAsset: SoldierAsset | null = null;

/** Every point of the model, in the space of its parent. */
function eachVertex(root: THREE.Object3D, fn: (p: THREE.Vector3) => void): void {
  const p = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) fn(p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
}

async function loadGun(w: number, file: string, len: number): Promise<void> {
  const materials = await new MTLLoader().setPath(`${BASE}guns/`).loadAsync(`${file}.mtl`);
  materials.preload();
  const model = await new OBJLoader().setMaterials(materials).loadAsync(`${BASE}guns/${file}.obj`);
  // Blender writes linear colors, but MTLLoader reads them as sRGB, which turns the guns black.
  for (const m of Object.values(materials.materials)) (m as THREE.MeshPhongMaterial).color.convertLinearToSRGB();

  // The pack points barrels along +X.
  model.rotation.y = Math.PI / 2;
  const box = new THREE.Box3().setFromObject(model);
  model.scale.setScalar(len / (box.max.z - box.min.z));
  box.setFromObject(model);

  // The front 2% of the gun is the muzzle: its height is the bore. The sights top the front half.
  let boreSum = 0;
  let boreCount = 0;
  let sight = -Infinity;
  eachVertex(model, (p) => {
    const along = (p.z - box.min.z) / len;
    if (along < 0.02) {
      boreSum += p.y;
      boreCount++;
    }
    if (along < 0.45) sight = Math.max(sight, p.y);
  });
  const bore = boreSum / boreCount;
  model.position.set(0, -bore, -box.min.z);

  const object = new THREE.Group();
  object.add(model);
  gunAssets.set(w, { object, len, sightY: sight - bore });
}

async function loadSoldier(): Promise<void> {
  const object = await new FBXLoader().loadAsync(`${BASE}soldier.fbx`);
  const box = new THREE.Box3().setFromObject(object);
  soldierAsset = { object, clips: object.animations, height: box.max.y - box.min.y };
}

async function load(): Promise<void> {
  const guns = Object.entries(GUN_FILES).map(([w, g]) => loadGun(Number(w), g!.file, g!.len));
  const results = await Promise.allSettled([...guns, loadSoldier()]);
  for (const r of results) if (r.status === 'rejected') console.warn('Modelo não carregou:', r.reason);
}

/** Models built in code stand in until this resolves, and for good if a file is missing. */
export const assetsReady = load();
