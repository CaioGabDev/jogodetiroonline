import * as THREE from 'three';
import { DEFAULT_SKIN, skinById, type SkinDef, type SkinPattern } from '../game/progression';
import { tickKnives } from './knives';
import { isKitPart, tickKits } from './skinKits';

/**
 * Weapon skins. The gun models have no usable UVs, so the pattern is computed in the shader from each
 * vertex's position in the gun's own space (meters), baked once per geometry into a `skinPos` attribute.
 * Every part of the gun keeps its own brightness, so dark grips stay darker than the body.
 */

const PATTERN_ID: Record<SkinPattern, number> = { solid: 0, camo: 1, digital: 2, stripes: 3, flow: 4, scan: 5, prisma: 6 };

/** Shared clock, so animated skins (lava, galaxy) move. */
const skinTime = { value: 0 };

export function tickSkins(dt: number): void {
  skinTime.value = (skinTime.value + dt) % 1000;
  tickKits(dt);
  tickKnives(dt);
}

/** #rrggbb as a number, for tracers and flashes. */
export function hexColor(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

const VERT_HEAD = /* glsl */ `
attribute vec3 skinPos;
varying vec3 vSkinPos;
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vSkinPos;
uniform vec3 uSkinA;
uniform vec3 uSkinB;
uniform vec3 uSkinC;
uniform vec3 uSkinD;
uniform float uSkinShade;
uniform float uSkinGlow;
uniform float uSkinTime;

float skHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float skNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(skHash(i), skHash(i + vec3(1, 0, 0)), f.x), mix(skHash(i + vec3(0, 1, 0)), skHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(skHash(i + vec3(0, 0, 1)), skHash(i + vec3(1, 0, 1)), f.x), mix(skHash(i + vec3(0, 1, 1)), skHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float skFbm(vec3 p) {
  return 0.55 * skNoise(p) + 0.3 * skNoise(p * 2.03 + 7.1) + 0.15 * skNoise(p * 4.01 + 3.7);
}
vec3 skPick(float n) {
  return n < 0.44 ? uSkinA : n < 0.52 ? uSkinB : n < 0.6 ? uSkinC : uSkinD;
}
/** xyz = color, w = how much of it glows. */
vec4 skinPattern(vec3 p) {
#if SKIN_PATTERN == 0
  return vec4(uSkinA, 1.0);
#elif SKIN_PATTERN == 1
  return vec4(skPick(skFbm(p * 14.0)), 1.0);
#elif SKIN_PATTERN == 2
  vec3 q = floor(p * 70.0) / 70.0;
  return vec4(skPick(skFbm(q * 12.0)), 1.0);
#elif SKIN_PATTERN == 3
  float s = sin(p.z * 48.0 + p.y * 20.0 + skFbm(p * 9.0) * 7.0);
  float m = step(0.3, s);
  return vec4(mix(uSkinA, uSkinB, m), m);
#elif SKIN_PATTERN == 4
  float n = skFbm(p * 9.0 + vec3(0.0, uSkinTime * 0.12, uSkinTime * 0.05));
  float hot = smoothstep(0.5, 0.68, n);
  vec3 c = mix(uSkinA, uSkinB, smoothstep(0.36, 0.56, n));
  c = mix(c, uSkinC, smoothstep(0.62, 0.76, n));
  return vec4(c, hot);
#elif SKIN_PATTERN == 5
  // Hologram: a gradient along the gun, scan lines running down it and a bright sweep along it.
  float scanBand = smoothstep(0.84, 1.0, fract(p.y * 38.0 - uSkinTime * 1.6));
  float sweep = smoothstep(0.9, 1.0, fract(p.z * 1.2 - uSkinTime * 0.45));
  vec3 c = mix(uSkinA, uSkinB, clamp(p.z * 1.6 + 0.5, 0.0, 1.0));
  c = mix(c, uSkinC, max(scanBand, sweep));
  return vec4(c, 0.35 + max(scanBand, sweep) * 0.65);
#else
  // Prism: every hue, flowing along the gun.
  float hue = fract(p.z * 1.4 + p.y * 2.0 + uSkinTime * 0.18 + skFbm(p * 6.0) * 0.25);
  vec3 c = clamp(abs(mod(hue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return vec4(mix(uSkinA, c, 0.85), 0.6);
#endif
}
`;

/** Brightness of the original part, 0..1, perceptual. */
function luminance(c: THREE.Color): number {
  return Math.sqrt(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);
}

function materialColor(m: THREE.Material): THREE.Color {
  const c = (m as THREE.MeshPhongMaterial).color;
  return c instanceof THREE.Color ? c : new THREE.Color(0x303030);
}

const cache = new Map<string, THREE.Material>();

function skinnedMaterial(orig: THREE.Material, skin: SkinDef): THREE.Material {
  const key = `${orig.uuid}|${skin.id}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const l = luminance(materialColor(orig));
  const colors = skin.colors.length ? skin.colors : ['#808080'];
  const pick = (i: number): THREE.Color => new THREE.Color(colors[i % colors.length]);
  const m = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    shininess: 12 + skin.shine * 110,
    specular: new THREE.Color().setScalar(0.08 + skin.shine * 0.55),
    transparent: orig.transparent,
    opacity: orig.opacity,
    side: orig.side,
  });
  m.defines = { SKIN_PATTERN: PATTERN_ID[skin.pattern] };
  const uniforms = {
    uSkinA: { value: pick(0) },
    uSkinB: { value: pick(1) },
    uSkinC: { value: pick(2) },
    uSkinD: { value: pick(3) },
    // Keeps the parts apart: dark pieces stay a bit darker than the body.
    uSkinShade: { value: 0.6 + 0.6 * THREE.MathUtils.smoothstep(l, 0.15, 0.7) },
    uSkinGlow: { value: skin.glow },
    uSkinTime: skinTime,
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSkinPos = skinPos;');
    shader.fragmentShader =
      FRAG_HEAD +
      shader.fragmentShader
        .replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          'vec4 skinCol = skinPattern(vSkinPos);\n  vec4 diffuseColor = vec4( skinCol.rgb * uSkinShade, opacity );',
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += skinCol.rgb * skinCol.a * uSkinGlow;');
  };
  m.customProgramCacheKey = () => `skin-${skin.pattern}`;
  cache.set(key, m);
  return m;
}

const _rel = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _v = new THREE.Vector3();

/** Positions in the space of the root `applySkin` got (inverse in `_inv`), once per geometry. */
function bakeSkinPos(mesh: THREE.Mesh): void {
  const geo = mesh.geometry;
  if (geo.getAttribute('skinPos')) return;
  const pos = geo.getAttribute('position');
  if (!pos) return;
  _rel.multiplyMatrices(_inv, mesh.matrixWorld);
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(_rel);
    out[i * 3] = _v.x;
    out[i * 3 + 1] = _v.y;
    out[i * 3 + 2] = _v.z;
  }
  geo.setAttribute('skinPos', new THREE.BufferAttribute(out, 3));
}

/** Materials each mesh had before its first skin. Not in userData: `clone()` would serialize them. */
const originals = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();

/**
 * Paints every mesh under `root` with the skin, or puts the original materials back for the default one.
 * Materials in `keep` (hands, sleeves) are left alone. Call it again to change skins.
 */
export function applySkin(root: THREE.Object3D, skinId: string, keep?: ReadonlySet<THREE.Material>): void {
  const skin = skinById(skinId);
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || isKitPart(o)) return;
    let orig = originals.get(o);
    if (!orig) {
      orig = o.material as THREE.Material | THREE.Material[];
      originals.set(o, orig);
    }
    if (skin.id === DEFAULT_SKIN) {
      o.material = orig;
      return;
    }
    let changed = false;
    const swap = (m: THREE.Material): THREE.Material => {
      if (keep?.has(m)) return m;
      changed = true;
      return skinnedMaterial(m, skin);
    };
    const next = Array.isArray(orig) ? orig.map(swap) : swap(orig);
    if (!changed) return;
    bakeSkinPos(o);
    o.material = next;
  });
}
