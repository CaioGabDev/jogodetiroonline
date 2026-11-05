import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapDef, MatKind, RampDef } from '../game/mapData';
import { TEAM_COLORS } from '../game/constants';
import { getTexture, makeGlowTexture, TEX_SCALE } from './textures';

/** Box geometry whose UVs are scaled to world size so textures tile uniformly. */
function texturedBox(w: number, h: number, d: number, scale: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const spans: Array<[number, number]> = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * spans[f][0]) / scale, (uv.getY(i) * spans[f][1]) / scale);
    }
  }
  return g;
}

function rampGeometry(r: RampDef, scale: number): THREE.BufferGeometry {
  const hAt = (x: number, z: number): number => {
    const c = r.axis === 'x' ? x : z;
    const lo = r.axis === 'x' ? r.minX : r.minZ;
    const hi = r.axis === 'x' ? r.maxX : r.maxZ;
    const t = r.rise === 1 ? (c - lo) / (hi - lo) : (hi - c) / (hi - lo);
    return r.y0 + (r.y1 - r.y0) * t;
  };
  const corners: Array<[number, number]> = [
    [r.minX, r.minZ],
    [r.maxX, r.minZ],
    [r.maxX, r.maxZ],
    [r.minX, r.maxZ],
  ];
  const B = corners.map(([x, z]) => new THREE.Vector3(x, r.y0, z));
  const T = corners.map(([x, z]) => new THREE.Vector3(x, hAt(x, z), z));
  const pos: number[] = [];
  const uvs: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uvFn: (p: THREE.Vector3) => [number, number]): void => {
    const area = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).length();
    if (area < 1e-6 && new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(d, b)).length() < 1e-6) return;
    for (const p of [a, b, c, a, c, d]) {
      pos.push(p.x, p.y, p.z);
      uvs.push(...uvFn(p));
    }
  };
  const uvTop = (p: THREE.Vector3): [number, number] => [p.x / scale, p.z / scale];
  const uvX = (p: THREE.Vector3): [number, number] => [p.z / scale, p.y / scale];
  const uvZ = (p: THREE.Vector3): [number, number] => [p.x / scale, p.y / scale];
  // Top (slope), CCW seen from above
  quad(T[0], T[3], T[2], T[1], uvTop);
  // Bottom
  quad(B[0], B[1], B[2], B[3], uvTop);
  // -z side
  quad(B[0], T[0], T[1], B[1], uvZ);
  // +z side
  quad(B[2], T[2], T[3], B[3], uvZ);
  // -x side
  quad(B[3], T[3], T[0], B[0], uvX);
  // +x side
  quad(B[1], T[1], T[2], B[2], uvX);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  g.setIndex([...Array(pos.length / 3).keys()]);
  return g;
}

export function buildMap(def: MapDef, anisotropy: number): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group();
  group.name = 'map';
  const byMat = new Map<MatKind, THREE.BufferGeometry[]>();
  const add = (k: MatKind, g: THREE.BufferGeometry): void => {
    if (!byMat.has(k)) byMat.set(k, []);
    byMat.get(k)!.push(g);
  };
  for (const b of def.boxes) {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    const g = texturedBox(w, h, d, TEX_SCALE[b.mat]);
    g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    add(b.mat, g);
  }
  for (const r of def.ramps) add(r.mat, rampGeometry(r, TEX_SCALE[r.mat]));

  const materials: THREE.Material[] = [];
  for (const [kind, geoms] of byMat) {
    const merged = mergeGeometries(geoms, false);
    geoms.forEach((g) => g.dispose());
    if (!merged) continue;
    const mat = new THREE.MeshStandardMaterial({
      map: getTexture(kind, anisotropy),
      roughness: kind === 'metal' ? 0.55 : 0.9,
      metalness: kind === 'metal' ? 0.35 : 0.05,
    });
    materials.push(mat);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = kind !== 'floor';
    mesh.receiveShadow = true;
    mesh.name = 'map-' + kind;
    group.add(mesh);
  }

  // Team base floor markings
  for (const mark of def.baseMarks) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(mark.w, mark.d),
      new THREE.MeshBasicMaterial({ color: TEAM_COLORS[mark.team], transparent: true, opacity: 0.18, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(mark.x, 0.02, mark.z);
    group.add(m);
  }
  return { group, materials };
}

export function buildSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(450, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#2f6fb8') },
      horizon: { value: new THREE.Color('#bcd3e6') },
      bottom: { value: new THREE.Color('#6b7480') },
      sunDir: { value: new THREE.Vector3(0.45, 0.6, 0.35).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.6)) : mix(horizon, bottom, clamp(-h*4.0,0.0,1.0));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0,0.9,0.7) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

/** Floating, spinning pickup models. */
export class PickupView {
  readonly group = new THREE.Group();
  private items: THREE.Group[] = [];

  constructor(map: MapDef) {
    const glowHealth = makeGlowTexture('rgba(255,255,255,0.9)', 'rgba(80,255,120,0.35)');
    const glowAmmo = makeGlowTexture('rgba(255,255,255,0.9)', 'rgba(255,200,60,0.35)');
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
    const red = new THREE.MeshStandardMaterial({ color: 0xe02424, emissive: 0x550000, roughness: 0.4 });
    const olive = new THREE.MeshStandardMaterial({ color: 0x4b5a2a, roughness: 0.6 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe8b923, emissive: 0x332200, roughness: 0.5 });
    const padMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7 });
    for (const def of map.pickups) {
      const g = new THREE.Group();
      g.position.set(def.pos[0], def.pos[1], def.pos[2]);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.08, 20), padMat);
      pad.position.y = 0.04;
      pad.receiveShadow = true;
      g.add(pad);
      const item = new THREE.Group();
      item.position.y = 0.8;
      if (def.kind === 'health') {
        item.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.45), white));
        const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.47), red);
        const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.36, 0.47), red);
        item.add(c1, c2);
      } else {
        item.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.4), olive));
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.42), yellow);
        item.add(s);
      }
      item.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: def.kind === 'health' ? glowHealth : glowAmmo,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      glow.scale.set(1.8, 1.8, 1);
      glow.position.y = 0.8;
      g.add(item, glow);
      g.userData.item = item;
      g.userData.glow = glow;
      this.items.push(g);
      this.group.add(g);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      } else if (o instanceof THREE.Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }

  setActive(idx: number, on: boolean): void {
    const g = this.items[idx];
    if (!g) return;
    (g.userData.item as THREE.Object3D).visible = on;
    (g.userData.glow as THREE.Object3D).visible = on;
  }

  setAll(states: boolean[]): void {
    states.forEach((s, i) => this.setActive(i, s));
  }

  update(t: number): void {
    this.items.forEach((g, i) => {
      const item = g.userData.item as THREE.Object3D;
      item.rotation.y = t * 1.5 + i;
      item.position.y = 0.8 + Math.sin(t * 2 + i) * 0.12;
    });
  }
}
