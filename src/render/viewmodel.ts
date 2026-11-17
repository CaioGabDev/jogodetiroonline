import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEFAULT_KNIFE, DEFAULT_SKIN, skinById } from '../game/progression';
import { knifeModel, knifeSwing, releaseKnife, setKnifeInspect } from './knives';
import { W } from '../game/weapons';
import { assetsReady, gunAssets } from './assets';
import { inspectPose, setKit, setKitInspect } from './skinKits';
import { applySkin, tickSkins } from './skins';
import { makeGlowTexture } from './textures';

const metal = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.45, metalness: 0.6 });
const dark = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.6, metalness: 0.3 });
const wood = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.8 });
const accent = new THREE.MeshStandardMaterial({ color: 0x5c6b3a, roughness: 0.7 });
const sleeve = new THREE.MeshStandardMaterial({ color: 0x3b4230, roughness: 0.9 });
const glove = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.9 });
const lens = new THREE.MeshStandardMaterial({ color: 0x113355, emissive: 0x0a2244, roughness: 0.2, metalness: 0.8 });
const steel = new THREE.MeshStandardMaterial({ color: 0xe4e8ee, roughness: 0.35, metalness: 0.2 });
/** Never painted by a skin. */
const UNSKINNED = new Set<THREE.Material>([glove, sleeve, lens]);

const HAND_TMP = new THREE.Vector3();
const HAND_E = new THREE.Euler();

/** Duration of a knife swing, in seconds. */
const SWING_TIME = 0.28;

function box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(mat: THREE.Material, r: number, len: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

/** What each builder makes: the gun and the hands holding it, all in one group. */
interface GunParts {
  group: THREE.Group;
  muzzle: THREE.Vector3;
  /** Offset that centers the sights on screen while aiming. */
  adsPos: THREE.Vector3;
  hipPos: THREE.Vector3;
  mag: THREE.Object3D | null;
}

interface GunModel extends GunParts {
  /** The gun without the hands, centered on itself: premium inspections turn it in hand. */
  pivot: THREE.Group;
  /** Where the pivot rests. */
  pivotBase: THREE.Vector3;
  /** Hand groups, which drop a little while the gun is tossed. */
  hands: THREE.Object3D[];
}

/** Hands are kept out of the pivot: the gun turns and is tossed between them. */
const isHand = (o: THREE.Object3D): boolean => o.userData.hand === true || (o instanceof THREE.Mesh && (o.material === glove || o.material === sleeve));

/** Moves the pivot to the middle of what it holds, without moving anything on screen. */
function recenter(pivot: THREE.Group): void {
  const box = new THREE.Box3();
  for (const c of pivot.children) {
    c.updateMatrix();
    c.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.updateMatrixWorld(true);
    });
  }
  pivot.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(pivot.matrixWorld).invert();
  const m = new THREE.Matrix4();
  pivot.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.userData.kitPart) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox!.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
  });
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  pivot.position.add(c);
  for (const child of pivot.children) child.position.sub(c);
}

/** Splits the gun from the hands, so it can turn in them. */
function withPivot(parts: GunParts): GunModel {
  const pivot = new THREE.Group();
  const gun = parts.group.children.filter((c) => !isHand(c));
  const hands = parts.group.children.filter(isHand);
  parts.group.add(pivot);
  pivot.add(...gun);
  recenter(pivot);
  return { ...parts, pivot, pivotBase: pivot.position.clone(), hands };
}

// ---------------------------------------------------------------------------
// Hands: palm, fingers wrapped around the gun, thumb and a forearm that runs off screen.
// ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const cuffMat = new THREE.MeshStandardMaterial({ color: 0x2a2f24, roughness: 0.95 });
UNSKINNED.add(cuffMat);

/** A capsule or tapered cylinder from a to b. */
function limb(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, capped = true): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = capped && r0 === r1 ? new THREE.CapsuleGeometry(r0, Math.max(0.001, len), 4, 10) : new THREE.CylinderGeometry(r1, r0, len, 12);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return m;
}

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

function rounded(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.35), mat);
  m.position.set(x, y, z);
  return m;
}

/** Bakes a hand's pieces into one mesh per material: a hand is 3 draw calls instead of ~13. */
function bakeHand(g: THREE.Group): THREE.Group {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const meshes: THREE.Mesh[] = [];
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    meshes.push(o);
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const mat = o.material as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(geo);
  });
  for (const m of meshes) {
    m.removeFromParent();
    m.geometry.dispose();
  }
  // Empty pose groups would be left behind; the baked meshes go straight on the hand.
  g.clear();
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((x) => x.dispose());
    if (merged) g.add(new THREE.Mesh(merged, mat));
  }
  return g;
}

function handGroup(): THREE.Group {
  const g = new THREE.Group();
  g.userData.hand = true;
  return g;
}

/** Forearm from the wrist back past the edge of the screen, with a cuff at the glove. */
function forearm(g: THREE.Group, wrist: THREE.Vector3, elbow: THREE.Vector3): void {
  const dir = new THREE.Vector3().subVectors(elbow, wrist).normalize();
  g.add(limb(cuffMat, wrist, wrist.clone().addScaledVector(dir, 0.04), 0.03, 0.033, false));
  g.add(limb(sleeve, wrist.clone().addScaledVector(dir, 0.03), elbow, 0.034, 0.05, false));
}

/**
 * Right hand around a vertical grip at (0, y, z): palm on the right side,
 * four fingers wrapped round the front and the thumb over the left.
 */
function gripHand(y: number, z: number): THREE.Group {
  const g = handGroup();
  g.add(rounded(glove, 0.03, 0.08, 0.07, 0.03, y - 0.005, z + 0.006));
  for (let i = 0; i < 4; i++) {
    const fy = y + 0.026 - i * 0.019;
    const fz = z - 0.034 + i * 0.002;
    g.add(limb(glove, v(0.032, fy, fz + 0.012), v(-0.012, fy, fz - 0.004), 0.0095));
    g.add(limb(glove, v(-0.012, fy, fz - 0.004), v(-0.03, fy - 0.002, fz + 0.022), 0.0088));
  }
  g.add(limb(glove, v(0.03, y + 0.03, z + 0.03), v(-0.004, y + 0.044, z + 0.004), 0.0105));
  g.add(limb(glove, v(-0.004, y + 0.044, z + 0.004), v(-0.03, y + 0.036, z - 0.012), 0.0095));
  const wrist = v(0.034, y - 0.03, z + 0.05);
  forearm(g, wrist, v(0.1, y - 0.18, z + 0.42));
  return bakeHand(g);
}

/** Left hand under the handguard at (0, y, z): palm up, fingers up the right side, thumb on the left. */
function supportHand(y: number, z: number, width = 0.066): THREE.Group {
  const g = handGroup();
  const half = width / 2;
  g.add(rounded(glove, width * 0.8, 0.026, 0.075, -0.004, y - 0.016, z + 0.004));
  for (let i = 0; i < 4; i++) {
    const fz = z - 0.03 + i * 0.019;
    g.add(limb(glove, v(half * 0.6, y - 0.018, fz), v(half + 0.006, y + 0.006, fz - 0.004), 0.009));
    g.add(limb(glove, v(half + 0.006, y + 0.006, fz - 0.004), v(half + 0.002, y + 0.03, fz - 0.008), 0.0085));
  }
  g.add(limb(glove, v(-half * 0.6, y - 0.014, z + 0.03), v(-half - 0.004, y + 0.008, z - 0.012), 0.0105));
  forearm(g, v(-0.01, y - 0.026, z + 0.045), v(-0.16, y - 0.2, z + 0.42));
  return bakeHand(g);
}

/** Left hand cupped round the right one on a handgun. */
function cupHand(y: number, z: number): THREE.Group {
  const g = handGroup();
  g.add(rounded(glove, 0.03, 0.075, 0.07, -0.034, y - 0.01, z + 0.01));
  for (let i = 0; i < 4; i++) {
    const fy = y + 0.008 - i * 0.019;
    g.add(limb(glove, v(-0.034, fy, z - 0.026), v(0.014, fy - 0.004, z - 0.05), 0.0095));
  }
  g.add(limb(glove, v(-0.03, y + 0.022, z + 0.02), v(-0.02, y + 0.05, z - 0.03), 0.0105));
  forearm(g, v(-0.036, y - 0.04, z + 0.05), v(-0.17, y - 0.2, z + 0.4));
  return bakeHand(g);
}

function hands(group: THREE.Group, gripZ: number, foreZ: number, foreY = -0.02): void {
  group.add(gripHand(-0.075, gripZ));
  group.add(supportHand(foreY - 0.04, foreZ));
}

function buildRifle(): GunParts {
  const g = new THREE.Group();
  g.add(box(metal, 0.06, 0.08, 0.42, 0, 0, -0.1));
  g.add(cyl(dark, 0.014, 0.28, 0, 0.01, -0.44));
  g.add(box(accent, 0.065, 0.06, 0.2, 0, -0.005, -0.33));
  g.add(box(dark, 0.05, 0.07, 0.18, 0, -0.01, 0.18));
  g.add(box(dark, 0.02, 0.03, 0.03, 0, 0.055, -0.27));
  g.add(box(dark, 0.025, 0.035, 0.04, 0, 0.055, 0.05));
  const mag = box(dark, 0.04, 0.14, 0.06, 0, -0.1, -0.12);
  mag.rotation.x = 0.2;
  g.add(mag);
  g.add(box(dark, 0.04, 0.1, 0.05, 0, -0.08, 0.02));
  hands(g, 0.03, -0.3);
  return { group: g, muzzle: new THREE.Vector3(0, 0.01, -0.6), hipPos: new THREE.Vector3(0.2, -0.2, -0.62), adsPos: new THREE.Vector3(0, -0.072, -0.42), mag };
}

function buildPistol(): GunParts {
  const g = new THREE.Group();
  g.add(box(metal, 0.045, 0.05, 0.2, 0, 0, -0.05));
  g.add(box(dark, 0.04, 0.03, 0.18, 0, -0.035, -0.04));
  const grip = box(dark, 0.04, 0.11, 0.055, 0, -0.09, 0.02);
  grip.rotation.x = 0.25;
  g.add(grip);
  g.add(box(dark, 0.01, 0.015, 0.01, 0, 0.032, -0.14));
  g.add(gripHand(-0.075, 0.03), cupHand(-0.085, 0.03));
  return { group: g, muzzle: new THREE.Vector3(0, 0.0, -0.16), hipPos: new THREE.Vector3(0.17, -0.17, -0.45), adsPos: new THREE.Vector3(0, -0.04, -0.36), mag: grip };
}

function buildShotgun(): GunParts {
  const g = new THREE.Group();
  g.add(box(metal, 0.065, 0.08, 0.32, 0, 0, -0.05));
  g.add(cyl(dark, 0.02, 0.5, 0, 0.015, -0.42));
  g.add(cyl(dark, 0.017, 0.42, 0, -0.025, -0.38));
  const pump = box(wood, 0.07, 0.06, 0.16, 0, -0.03, -0.36);
  g.add(pump);
  g.add(box(wood, 0.055, 0.09, 0.22, 0, -0.03, 0.2));
  g.add(box(dark, 0.015, 0.02, 0.02, 0, 0.05, -0.62));
  hands(g, 0.04, -0.36);
  return { group: g, muzzle: new THREE.Vector3(0, 0.015, -0.68), hipPos: new THREE.Vector3(0.2, -0.2, -0.6), adsPos: new THREE.Vector3(0, -0.065, -0.4), mag: pump };
}

function buildSniper(): GunParts {
  const g = new THREE.Group();
  g.add(box(accent, 0.06, 0.08, 0.46, 0, 0, -0.05));
  g.add(cyl(dark, 0.013, 0.5, 0, 0.012, -0.52));
  g.add(cyl(dark, 0.028, 0.26, 0, 0.085, -0.08));
  g.add(cyl(lens, 0.03, 0.01, 0, 0.085, -0.215));
  g.add(box(dark, 0.02, 0.05, 0.02, 0, 0.05, -0.12));
  g.add(box(dark, 0.02, 0.05, 0.02, 0, 0.05, 0.0));
  g.add(box(accent, 0.05, 0.1, 0.24, 0, -0.03, 0.27));
  const mag = box(dark, 0.04, 0.08, 0.07, 0, -0.08, -0.06);
  g.add(mag);
  hands(g, 0.08, -0.3);
  return { group: g, muzzle: new THREE.Vector3(0, 0.012, -0.78), hipPos: new THREE.Vector3(0.2, -0.2, -0.62), adsPos: new THREE.Vector3(0, -0.085, -0.4), mag };
}

/** Fist closed round a knife grip along +Y, in the knife's own space (flat of the blade in XY). */
function knifeFist(): THREE.Group {
  const g = new THREE.Group();
  g.add(rounded(glove, 0.05, 0.085, 0.034, 0.012, -0.012, -0.022));
  for (let i = 0; i < 4; i++) {
    const fy = 0.034 - i * 0.022;
    g.add(limb(glove, v(0.03, fy, -0.016), v(-0.006, fy - 0.002, 0.028), 0.0105));
    g.add(limb(glove, v(-0.006, fy - 0.002, 0.028), v(-0.026, fy - 0.004, 0.006), 0.0098));
  }
  g.add(limb(glove, v(-0.02, 0.01, -0.03), v(-0.022, 0.05, 0.004), 0.011));
  return g;
}

/** The knife in hand: the model of the knife skin, held at the fist so swings pivot on the hand. */
function buildKnife(model: THREE.Object3D): GunParts {
  const g = new THREE.Group();
  // Turned on its long axis so the flat of the blade faces the camera, then tilted up and forward.
  // The knife and the fist share the pose but not the group: an inspection turns the knife alone.
  const pose = (o: THREE.Object3D): THREE.Group => {
    const twist = new THREE.Group();
    twist.rotation.y = 0.85;
    twist.add(o);
    const tilt = new THREE.Group();
    tilt.rotation.x = -0.95;
    tilt.add(twist);
    return tilt;
  };
  g.add(pose(model));
  const fist = handGroup();
  fist.add(pose(knifeFist()));
  forearm(fist, v(0.01, -0.06, 0.05), v(0.06, -0.2, 0.42));
  g.add(bakeHand(fist));
  const pos = new THREE.Vector3(0.2, -0.2, -0.46);
  return { group: g, muzzle: new THREE.Vector3(0, 0.21, -0.3), hipPos: pos, adsPos: pos, mag: null };
}

function buildSmg(): GunParts {
  const g = new THREE.Group();
  g.add(box(metal, 0.05, 0.07, 0.3, 0, 0, -0.06));
  g.add(cyl(dark, 0.012, 0.14, 0, 0.012, -0.27));
  g.add(box(dark, 0.03, 0.03, 0.14, 0, -0.01, 0.16));
  const mag = box(dark, 0.03, 0.17, 0.045, 0, -0.11, -0.1);
  g.add(mag);
  g.add(box(dark, 0.015, 0.025, 0.02, 0, 0.045, -0.14));
  hands(g, 0.04, -0.17);
  return { group: g, muzzle: new THREE.Vector3(0, 0.012, -0.35), hipPos: new THREE.Vector3(0.19, -0.19, -0.55), adsPos: new THREE.Vector3(0, -0.06, -0.38), mag };
}

function buildLmg(): GunParts {
  const g = new THREE.Group();
  g.add(box(metal, 0.08, 0.1, 0.5, 0, 0, -0.08));
  g.add(cyl(dark, 0.018, 0.5, 0, 0.012, -0.56));
  g.add(box(accent, 0.075, 0.07, 0.16, 0, -0.005, -0.4));
  g.add(box(dark, 0.06, 0.09, 0.2, 0, -0.01, 0.26));
  const mag = box(accent, 0.11, 0.13, 0.15, 0, -0.1, -0.1);
  g.add(mag);
  g.add(box(dark, 0.012, 0.13, 0.012, -0.03, -0.07, -0.62));
  g.add(box(dark, 0.012, 0.13, 0.012, 0.03, -0.07, -0.62));
  g.add(box(dark, 0.02, 0.03, 0.03, 0, 0.065, -0.26));
  hands(g, 0.08, -0.36);
  return { group: g, muzzle: new THREE.Vector3(0, 0.012, -0.82), hipPos: new THREE.Vector3(0.21, -0.23, -0.62), adsPos: new THREE.Vector3(0, -0.095, -0.44), mag };
}

function buildCrossbow(): GunParts {
  const g = new THREE.Group();
  g.add(box(wood, 0.05, 0.05, 0.6, 0, 0, -0.05));
  g.add(box(wood, 0.045, 0.1, 0.16, 0, -0.04, 0.2));
  g.add(box(metal, 0.46, 0.022, 0.03, 0, 0.012, -0.32));
  g.add(box(dark, 0.45, 0.005, 0.005, 0, 0.018, -0.14));
  g.add(box(steel, 0.008, 0.008, 0.36, 0, 0.034, -0.2));
  g.add(box(dark, 0.012, 0.03, 0.02, 0, 0.05, -0.02));
  hands(g, 0.09, -0.22);
  return { group: g, muzzle: new THREE.Vector3(0, 0.03, -0.4), hipPos: new THREE.Vector3(0.2, -0.2, -0.6), adsPos: new THREE.Vector3(0, -0.062, -0.42), mag: null };
}

function buildDmr(): GunParts {
  const g = new THREE.Group();
  g.add(box(wood, 0.055, 0.075, 0.5, 0, 0, -0.06));
  g.add(cyl(dark, 0.012, 0.4, 0, 0.012, -0.5));
  g.add(cyl(dark, 0.022, 0.18, 0, 0.075, -0.1));
  g.add(box(dark, 0.018, 0.04, 0.018, 0, 0.045, -0.1));
  const mag = box(dark, 0.035, 0.1, 0.06, 0, -0.08, -0.1);
  g.add(mag);
  g.add(box(wood, 0.05, 0.09, 0.2, 0, -0.03, 0.24));
  hands(g, 0.06, -0.28);
  return { group: g, muzzle: new THREE.Vector3(0, 0.012, -0.7), hipPos: new THREE.Vector3(0.2, -0.2, -0.62), adsPos: new THREE.Vector3(0, -0.075, -0.4), mag };
}

function buildLauncher(): GunParts {
  const g = new THREE.Group();
  g.add(cyl(metal, 0.05, 0.42, 0, 0.012, -0.24));
  g.add(cyl(dark, 0.056, 0.05, 0, 0.012, -0.46));
  g.add(box(dark, 0.06, 0.09, 0.2, 0, -0.01, 0.06));
  g.add(box(accent, 0.05, 0.09, 0.2, 0, -0.03, 0.26));
  g.add(box(dark, 0.015, 0.04, 0.02, 0, 0.08, -0.2));
  hands(g, 0.08, -0.26, -0.03);
  return { group: g, muzzle: new THREE.Vector3(0, 0.012, -0.49), hipPos: new THREE.Vector3(0.21, -0.2, -0.58), adsPos: new THREE.Vector3(0, -0.1, -0.44), mag: null };
}

/** Pistol hand and grip, shared by the bigger handguns. */
function pistolGrip(g: THREE.Group): THREE.Mesh {
  const grip = box(dark, 0.04, 0.11, 0.055, 0, -0.09, 0.02);
  grip.rotation.x = 0.25;
  g.add(grip);
  g.add(gripHand(-0.075, 0.03), cupHand(-0.085, 0.03));
  return grip;
}

function buildDeagle(): GunParts {
  const g = new THREE.Group();
  g.add(box(steel, 0.055, 0.065, 0.26, 0, 0, -0.08));
  g.add(box(dark, 0.05, 0.03, 0.2, 0, -0.045, -0.05));
  g.add(box(dark, 0.012, 0.018, 0.012, 0, 0.04, -0.19));
  const grip = pistolGrip(g);
  return { group: g, muzzle: new THREE.Vector3(0, 0.005, -0.22), hipPos: new THREE.Vector3(0.17, -0.17, -0.45), adsPos: new THREE.Vector3(0, -0.05, -0.36), mag: grip };
}

function buildRevolver(): GunParts {
  const g = new THREE.Group();
  g.add(cyl(steel, 0.016, 0.2, 0, 0.012, -0.14));
  g.add(cyl(metal, 0.036, 0.075, 0, -0.008, -0.01));
  g.add(box(metal, 0.04, 0.045, 0.1, 0, 0.01, 0.03));
  g.add(box(dark, 0.01, 0.018, 0.012, 0, 0.038, -0.22));
  const grip = pistolGrip(g);
  return { group: g, muzzle: new THREE.Vector3(0, 0.012, -0.25), hipPos: new THREE.Vector3(0.17, -0.17, -0.45), adsPos: new THREE.Vector3(0, -0.048, -0.36), mag: grip };
}

function buildAutoPistol(): GunParts {
  const g = new THREE.Group();
  g.add(box(metal, 0.045, 0.05, 0.22, 0, 0, -0.06));
  g.add(box(dark, 0.04, 0.03, 0.2, 0, -0.035, -0.05));
  g.add(box(dark, 0.01, 0.015, 0.01, 0, 0.032, -0.15));
  const grip = pistolGrip(g);
  g.add(box(dark, 0.034, 0.1, 0.045, 0, -0.19, 0.045));
  return { group: g, muzzle: new THREE.Vector3(0, 0, -0.18), hipPos: new THREE.Vector3(0.17, -0.15, -0.45), adsPos: new THREE.Vector3(0, -0.04, -0.36), mag: grip };
}

export interface ViewmodelState {
  aim: number;
  speed: number;
  onGround: boolean;
  sprint: boolean;
  /** Reload progress 0..1, or -1 when not reloading. */
  reload: number;
  /** Inspection progress 0..1, or -1 when not inspecting. */
  inspect: number;
  /** Weapon raise progress 0..1 (1 = ready). */
  raise: number;
  lookDX: number;
  lookDY: number;
  crouch: boolean;
}

/** First-person weapon rendered in its own scene so it never clips into walls. */
export class Viewmodel {
  readonly root = new THREE.Group();
  private guns: GunModel[];
  private current = 0;
  private bobPhase = 0;
  private kickZ = 0;
  private kickRot = 0;
  private swayX = 0;
  private swayY = 0;
  private flash: THREE.Sprite;
  private flashLife = 0;
  private landDip = 0;
  private swingT = 0;
  private skin = '';
  /** How the equipped skin turns the gun when inspected. */
  private inspectStyle = skinById(DEFAULT_SKIN).fx?.inspect ?? 'default';
  private knifeSkin = DEFAULT_KNIFE;
  private knifeStyle = skinById(DEFAULT_KNIFE).knife?.inspect ?? 'default';
  /** The knife model in hand, for its inspection and swing effects. */
  private blade: THREE.Object3D = knifeModel(skinById(DEFAULT_KNIFE));

  constructor(scene: THREE.Scene) {
    this.guns = [
      buildRifle(),
      buildPistol(),
      buildShotgun(),
      buildSniper(),
      buildKnife(this.blade),
      buildSmg(),
      buildLmg(),
      buildCrossbow(),
      buildDmr(),
      buildLauncher(),
      buildDeagle(),
      buildRevolver(),
      buildAutoPistol(),
    ].map(withPivot);
    this.guns.forEach((g, i) => {
      g.group.visible = i === 0;
      this.root.add(g.group);
    });
    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture('rgba(255,255,230,1)', 'rgba(255,170,40,0.8)'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.flash.visible = false;
    this.root.add(this.flash);
    scene.add(this.root);
    void assetsReady.then(() => this.useAssets());
  }

  /** Swaps the guns built in code for the loaded models. Only the hands stay. */
  private useAssets(): void {
    this.guns.forEach((g, w) => {
      const asset = gunAssets.get(w);
      // The knife keeps its own model: in first person the blade has to show past the hand.
      if (!asset || w === W.KNIFE) return;
      g.pivot.position.copy(g.pivotBase);
      g.pivot.rotation.set(0, 0, 0);
      g.pivot.remove(...g.pivot.children.filter((c) => c instanceof THREE.Mesh));
      const model = asset.object.clone();
      model.position.copy(g.muzzle).sub(g.pivot.position);
      g.pivot.add(model);
      recenter(g.pivot);
      g.pivotBase.copy(g.pivot.position);
      if (g.adsPos === g.hipPos) return;
      g.adsPos.y = -(g.muzzle.y + asset.sightY);
      // These models are bulkier at the back: further out, they cover less of the screen.
      g.adsPos.z -= 0.12;
    });
    if (this.skin) this.paint(this.skin);
  }

  /** Pattern on every gun, and the premium parts on all but the knife. */
  private paint(id: string): void {
    const skin = skinById(id);
    this.guns.forEach((g, w) => {
      // The knife wears the knife skin instead.
      if (w === W.KNIFE) return;
      applySkin(g.pivot, id, UNSKINNED);
      setKit(g.pivot, skin, UNSKINNED);
    });
    this.flash.material.color.set(skin.fx?.flash ?? '#ffffff');
    this.inspectStyle = skin.fx?.inspect ?? 'default';
  }

  /** Paints every gun (not the hands) with a weapon skin. */
  setSkin(id: string): void {
    if (id === this.skin) return;
    this.skin = id;
    this.paint(id);
  }

  /** Swaps the knife for the knife skin's own model and finish. */
  setKnifeSkin(id: string): void {
    const skin = skinById(id);
    const next = skin.slot === 'faca' ? skin : skinById(DEFAULT_KNIFE);
    if (next.id === this.knifeSkin) return;
    this.knifeSkin = next.id;
    this.knifeStyle = next.knife?.inspect ?? 'default';
    const old = this.guns[W.KNIFE];
    old.group.removeFromParent();
    releaseKnife(this.blade);
    this.blade = knifeModel(next);
    const knife = withPivot(buildKnife(this.blade));
    knife.group.visible = this.current === W.KNIFE;
    this.guns[W.KNIFE] = knife;
    this.root.add(knife.group);
    applySkin(knife.pivot, next.id, UNSKINNED);
  }

  setWeapon(w: number): void {
    this.current = w;
    this.swingT = 0;
    this.guns.forEach((g, i) => (g.group.visible = i === w));
  }

  swing(): void {
    this.swingT = SWING_TIME;
    if (this.current === W.KNIFE) knifeSwing(this.blade);
  }

  fire(strength: number): void {
    this.kickZ += 0.05 * strength;
    this.kickRot += 0.09 * strength;
    const g = this.guns[this.current];
    this.flash.position.copy(g.muzzle).applyMatrix4(g.group.matrix);
    this.flash.scale.setScalar(0.13 + Math.random() * 0.06 + strength * 0.03);
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flash.visible = true;
    this.flashLife = 0.045;
  }

  land(strength: number): void {
    this.landDip = Math.min(0.06, this.landDip + strength * 0.006);
  }

  /** Muzzle position in camera space (to place world tracers). */
  muzzleCameraSpace(out: THREE.Vector3): THREE.Vector3 {
    const g = this.guns[this.current];
    this.root.updateMatrixWorld();
    return out.copy(g.muzzle).applyMatrix4(g.group.matrixWorld);
  }

  update(dt: number, s: ViewmodelState): void {
    const g = this.guns[this.current];
    const k = Math.min(1, dt * 10);
    tickSkins(dt);

    // Bob
    const moving = s.onGround && s.speed > 0.5;
    if (moving) this.bobPhase += dt * (5 + s.speed * 0.9);
    const bobAmt = moving ? Math.min(1, s.speed / 6) * (1 - s.aim * 0.95) : 0;
    const bobX = Math.sin(this.bobPhase) * 0.012 * bobAmt;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.012 * bobAmt;

    // Sway lags behind mouse movement
    this.swayX += (-s.lookDX * 0.0004 * (1 - s.aim * 0.95) - this.swayX) * k;
    this.swayY += (s.lookDY * 0.0004 * (1 - s.aim * 0.95) - this.swayY) * k;
    this.swayX = Math.max(-0.04, Math.min(0.04, this.swayX));
    this.swayY = Math.max(-0.04, Math.min(0.04, this.swayY));

    // Recoil recovery
    this.kickZ += (0 - this.kickZ) * Math.min(1, dt * 14);
    this.kickRot += (0 - this.kickRot) * Math.min(1, dt * 12);
    this.landDip += (0 - this.landDip) * Math.min(1, dt * 8);

    const pos = new THREE.Vector3().lerpVectors(g.hipPos, g.adsPos, s.aim);
    pos.x += bobX + this.swayX;
    pos.y += bobY + this.swayY - this.landDip;
    pos.z += this.kickZ * (1 - s.aim * 0.5);

    let rotX = this.kickRot * (1 - s.aim * 0.6);
    let rotY = 0;
    let rotZ = 0;
    // Not tied to the ground: the run pose holds through a jump.
    // Inspecting while running shows the gun instead of lowering it.
    if (s.sprint && s.aim < 0.1 && s.speed > 0.5 && s.inspect < 0) {
      rotY = 0.5;
      rotX -= 0.25;
      pos.x -= 0.03;
      pos.y -= 0.04;
    }
    if (s.reload >= 0) {
      const r = Math.sin(Math.min(1, s.reload) * Math.PI);
      rotX -= r * 0.5;
      rotZ += r * 0.35;
      pos.y -= r * 0.08;
    }
    if (s.inspect >= 0) {
      // Brings the weapon in, shows one side, turns it over to show the other, and puts it back.
      const smooth = THREE.MathUtils.smoothstep;
      const hold = smooth(s.inspect, 0, 0.15) * (1 - smooth(s.inspect, 0.85, 1));
      const turn = smooth(s.inspect, 0.15, 0.45) - 2 * smooth(s.inspect, 0.52, 0.8);
      pos.x -= hold * 0.08;
      pos.y += hold * 0.04;
      pos.z += hold * 0.06;
      rotX += hold * 0.12;
      rotY += hold * (0.35 + turn * 0.5);
      rotZ += hold * (0.2 - turn * 0.35);
    }
    const lower = 1 - s.raise;
    pos.y -= lower * 0.3;
    rotX -= lower * 0.6;

    // Knife thrust: the hand moves a little and the blade sweeps across the screen.
    // Applied directly so the smoothing below doesn't mute it.
    this.swingT = Math.max(0, this.swingT - dt);
    const swinging = this.swingT > 0;
    if (swinging) {
      const a = Math.sin((1 - this.swingT / SWING_TIME) * Math.PI);
      pos.x -= a * 0.12;
      pos.y += a * 0.03;
      pos.z -= a * 0.2;
      rotX -= a * 0.55;
      rotY += a * 0.7;
      rotZ += a * 0.35;
    }

    g.group.position.lerp(pos, swinging ? 1 : Math.min(1, dt * 25));
    g.group.rotation.x += (rotX - g.group.rotation.x) * (swinging ? 1 : Math.min(1, dt * 18));
    g.group.rotation.y += (rotY - g.group.rotation.y) * (swinging ? 1 : Math.min(1, dt * 10));
    g.group.rotation.z += (rotZ - g.group.rotation.z) * (swinging ? 1 : Math.min(1, dt * 10));
    g.group.updateMatrix();

    // Premium inspections: the gun turns in the hands, and its parts react.
    const knife = this.current === W.KNIFE;
    const pose = inspectPose(knife ? this.knifeStyle : this.inspectStyle, s.inspect);
    setKnifeInspect(this.blade, knife ? s.inspect : -1);
    g.pivot.rotation.set(pose.rx, pose.ry, pose.rz);
    // Tossed tricks: the gun goes up clear of the hands, which drop and open a little, then catch it.
    const lift = pose.toss * (knife ? 0.07 : 0.13);
    g.pivot.position.set(g.pivotBase.x, g.pivotBase.y + pose.dy + lift, g.pivotBase.z - pose.toss * 0.03);
    // Only tricks done in hand (the butterfly knife) carry the hands along. Tossed tricks and the normal
    // inspection leave them still: the arms never spin with the gun.
    const inHand = (knife ? this.knifeStyle : this.inspectStyle) === 'butterfly';
    const base = HAND_TMP.copy(g.pivotBase).applyQuaternion(g.pivot.quaternion);
    for (const h of g.hands) {
      if (inHand) {
        h.quaternion.copy(g.pivot.quaternion);
        h.position.copy(g.pivotBase).sub(base);
        h.position.y += pose.dy;
      } else {
        h.quaternion.setFromEuler(HAND_E.set(pose.toss * 0.25, 0, 0));
        h.position.set(0, -pose.toss * 0.07, pose.toss * 0.02);
      }
    }
    setKitInspect(g.pivot, pose.amount);

    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) this.flash.visible = false;
    }
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }
}
