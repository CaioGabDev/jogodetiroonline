import * as THREE from 'three';
import type { BladeShape, SkinDef } from '../game/progression';

/**
 * Knife models for the knife skins. Built in the knife's own space: blade up (+Y) from y = 0.06, the grip below,
 * the flat of the blade in the XY plane. Premium knives get a glowing edge that pulses and flares on a swing,
 * and the butterfly knife opens and closes its handles when inspected.
 */

const steel = new THREE.MeshStandardMaterial({ color: 0xdfe5ec, roughness: 0.3, metalness: 0.55 });
const gripMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.85 });
const brass = new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 0.5, metalness: 0.6 });

interface Rig {
  flaps: THREE.Object3D[];
  glow: THREE.Material[];
  /** Inspection progress 0..1, or -1. */
  inspect: number;
  /** Flare left from the last swing, 1 right after it. */
  swing: number;
  update(dt: number, t: number): void;
}

const rigs = new WeakMap<THREE.Object3D, Rig>();
const live = new Set<Rig>();
let clock = 0;

/** Runs from tickSkins, so the viewmodel and the Arsenal preview both animate. */
export function tickKnives(dt: number): void {
  clock += dt;
  for (const r of live) r.update(dt, clock);
}

function profile(blade: BladeShape): THREE.Shape {
  const s = new THREE.Shape();
  switch (blade) {
    case 'tanto':
      s.moveTo(-0.022, 0);
      s.lineTo(0.02, 0);
      s.lineTo(0.02, 0.25);
      s.lineTo(0.002, 0.31);
      s.lineTo(-0.022, 0.27);
      break;
    case 'cutelo': {
      s.moveTo(-0.058, 0);
      s.lineTo(0.018, 0);
      s.lineTo(0.018, 0.21);
      s.lineTo(-0.058, 0.235);
      const hole = new THREE.Path();
      hole.absarc(-0.038, 0.195, 0.009, 0, Math.PI * 2, true);
      s.holes.push(hole);
      break;
    }
    case 'karambit':
      s.moveTo(-0.014, 0);
      s.quadraticCurveTo(0.078, 0.1, 0.012, 0.235);
      s.lineTo(0.0, 0.218);
      s.quadraticCurveTo(0.046, 0.1, -0.03, 0.022);
      break;
    case 'borboleta':
      s.moveTo(-0.015, 0);
      s.lineTo(0.014, 0);
      s.lineTo(0.014, 0.22);
      s.lineTo(0.0, 0.28);
      s.quadraticCurveTo(-0.015, 0.24, -0.015, 0.18);
      break;
    default:
      s.moveTo(-0.024, 0);
      s.lineTo(0.02, 0);
      s.lineTo(0.02, 0.25);
      s.lineTo(0.016, 0.31);
      s.quadraticCurveTo(-0.024, 0.24, -0.024, 0.14);
  }
  s.closePath();
  return s;
}

function box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** Skins and the gun's bounding box leave these alone (same flag as the premium gun parts). */
function fxPart<T extends THREE.Object3D>(o: T): T {
  o.userData.kitPart = true;
  return o;
}

const smooth = THREE.MathUtils.smoothstep;
/** 0 → 1 → 0, twice over k = 0..1: open and close, open and close. */
const flick = (k: number): number => 0.5 - 0.5 * Math.cos(k * Math.PI * 4);

/** A new knife for the skin. Painted with the skin's pattern by applySkin, like the guns. */
export function knifeModel(skin: SkinDef): THREE.Group {
  const look = skin.knife ?? { blade: 'baioneta' as BladeShape, inspect: 'default' as const };
  const root = new THREE.Group();
  const bladeGeo = new THREE.ExtrudeGeometry(profile(look.blade), { depth: 0.008, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1 });
  bladeGeo.translate(0, 0.06, -0.004);
  root.add(new THREE.Mesh(bladeGeo, steel));

  const flaps: THREE.Object3D[] = [];
  switch (look.blade) {
    case 'karambit': {
      const g = box(gripMat, 0.028, 0.13, 0.03, -0.01, -0.005);
      g.rotation.z = 0.35;
      root.add(g);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 24), brass);
      ring.position.set(-0.034, -0.085, 0);
      root.add(ring);
      break;
    }
    case 'borboleta':
      for (const side of [-1, 1]) {
        const hinge = new THREE.Group();
        hinge.position.set(side * 0.011, 0.055, 0);
        const handle = box(side < 0 ? gripMat : brass, 0.011, 0.14, 0.026, 0, -0.07);
        hinge.add(handle, box(steel, 0.012, 0.012, 0.028, 0, -0.005));
        root.add(hinge);
        flaps.push(hinge);
      }
      break;
    case 'cutelo':
      root.add(box(gripMat, 0.03, 0.12, 0.032, -0.012, -0.01), box(brass, 0.034, 0.016, 0.036, -0.012, 0.052));
      break;
    default:
      root.add(box(gripMat, 0.03, 0.13, 0.03, 0, -0.01), box(look.blade === 'tanto' ? brass : gripMat, look.blade === 'tanto' ? 0.05 : 0.07, 0.012, 0.03, 0, 0.06), box(gripMat, 0.034, 0.02, 0.034, 0, -0.08));
  }

  const glow: THREE.Material[] = [];
  if (look.edge) {
    const line = new THREE.LineBasicMaterial({ color: look.edge, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const haze = new THREE.MeshBasicMaterial({ color: look.edge, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    root.add(fxPart(new THREE.LineSegments(new THREE.EdgesGeometry(bladeGeo, 25), line)));
    const aura = fxPart(new THREE.Mesh(bladeGeo, haze));
    aura.scale.set(1.12, 1.04, 2.4);
    aura.position.y = -0.003;
    root.add(aura);
    glow.push(line, haze);
  }

  const rig: Rig = {
    flaps,
    glow,
    inspect: -1,
    swing: 0,
    update(dt, t) {
      rig.swing = Math.max(0, rig.swing - dt * 3);
      const pulse = 0.75 + Math.sin(t * 3.2) * 0.25;
      if (glow[0]) (glow[0] as THREE.LineBasicMaterial).opacity = Math.min(1, 0.55 + pulse * 0.35 + rig.swing);
      if (glow[1]) (glow[1] as THREE.MeshBasicMaterial).opacity = 0.12 + pulse * 0.1 + rig.swing * 0.5;
      if (flaps.length === 2) {
        const k = rig.inspect >= 0 ? smooth(rig.inspect, 0.12, 0.88) : 0;
        flaps[0].rotation.z = -Math.PI * flick(k);
        flaps[1].rotation.z = Math.PI * flick(Math.max(0, (k - 0.08) / 0.92));
      }
    },
  };
  rigs.set(root, rig);
  live.add(rig);
  return root;
}

export function setKnifeInspect(root: THREE.Object3D | null, p: number): void {
  const r = root && rigs.get(root);
  if (r) r.inspect = p;
}

export function knifeSwing(root: THREE.Object3D | null): void {
  const r = root && rigs.get(root);
  if (r) r.swing = 1;
}

/** Stops animating a knife that left the scene. */
export function releaseKnife(root: THREE.Object3D | null): void {
  const r = root && rigs.get(root);
  if (r) live.delete(r);
}
