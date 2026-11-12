import * as THREE from 'three';
import { assetsReady, gunAssets } from './assets';
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

interface GunModel {
  group: THREE.Group;
  muzzle: THREE.Vector3;
  /** Offset that centers the sights on screen while aiming. */
  adsPos: THREE.Vector3;
  hipPos: THREE.Vector3;
  mag: THREE.Object3D | null;
}

function hands(group: THREE.Group, gripZ: number, foreZ: number, foreY = -0.02): void {
  group.add(box(glove, 0.06, 0.08, 0.08, 0, -0.07, gripZ));
  group.add(box(sleeve, 0.055, 0.05, 0.16, 0.0, -0.08, gripZ + 0.11));
  group.add(box(glove, 0.07, 0.06, 0.08, -0.01, foreY - 0.03, foreZ));
  group.add(box(sleeve, 0.05, 0.05, 0.18, -0.05, foreY - 0.05, foreZ + 0.1));
}

function buildRifle(): GunModel {
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

function buildPistol(): GunModel {
  const g = new THREE.Group();
  g.add(box(metal, 0.045, 0.05, 0.2, 0, 0, -0.05));
  g.add(box(dark, 0.04, 0.03, 0.18, 0, -0.035, -0.04));
  const grip = box(dark, 0.04, 0.11, 0.055, 0, -0.09, 0.02);
  grip.rotation.x = 0.25;
  g.add(grip);
  g.add(box(dark, 0.01, 0.015, 0.01, 0, 0.032, -0.14));
  g.add(box(glove, 0.06, 0.07, 0.08, 0, -0.1, 0.03));
  g.add(box(sleeve, 0.055, 0.05, 0.16, 0, -0.12, 0.14));
  g.add(box(glove, 0.06, 0.06, 0.07, -0.035, -0.1, 0.02));
  return { group: g, muzzle: new THREE.Vector3(0, 0.0, -0.16), hipPos: new THREE.Vector3(0.17, -0.17, -0.45), adsPos: new THREE.Vector3(0, -0.04, -0.36), mag: grip };
}

function buildShotgun(): GunModel {
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

function buildSniper(): GunModel {
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

function buildKnife(): GunModel {
  const g = new THREE.Group();
  g.add(box(steel, 0.014, 0.04, 0.2, 0, 0.012, -0.16));
  const tip = box(steel, 0.014, 0.028, 0.028, 0, 0.018, -0.265);
  tip.rotation.x = Math.PI / 4;
  g.add(tip);
  g.add(box(dark, 0.03, 0.06, 0.012, 0, 0.01, -0.055));
  g.add(box(dark, 0.028, 0.035, 0.11, 0, 0.006, 0.005));
  g.add(box(glove, 0.06, 0.07, 0.08, 0, -0.01, 0.01));
  g.add(box(sleeve, 0.055, 0.05, 0.16, 0, -0.02, 0.12));
  const pos = new THREE.Vector3(0.2, -0.17, -0.48);
  return { group: g, muzzle: new THREE.Vector3(0, 0.015, -0.27), hipPos: pos, adsPos: pos, mag: null };
}

function buildSmg(): GunModel {
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

function buildLmg(): GunModel {
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

function buildCrossbow(): GunModel {
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

function buildDmr(): GunModel {
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

function buildLauncher(): GunModel {
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
  g.add(box(glove, 0.06, 0.07, 0.08, 0, -0.1, 0.03));
  g.add(box(sleeve, 0.055, 0.05, 0.16, 0, -0.12, 0.14));
  g.add(box(glove, 0.06, 0.06, 0.07, -0.035, -0.1, 0.02));
  return grip;
}

function buildDeagle(): GunModel {
  const g = new THREE.Group();
  g.add(box(steel, 0.055, 0.065, 0.26, 0, 0, -0.08));
  g.add(box(dark, 0.05, 0.03, 0.2, 0, -0.045, -0.05));
  g.add(box(dark, 0.012, 0.018, 0.012, 0, 0.04, -0.19));
  const grip = pistolGrip(g);
  return { group: g, muzzle: new THREE.Vector3(0, 0.005, -0.22), hipPos: new THREE.Vector3(0.17, -0.17, -0.45), adsPos: new THREE.Vector3(0, -0.05, -0.36), mag: grip };
}

function buildRevolver(): GunModel {
  const g = new THREE.Group();
  g.add(cyl(steel, 0.016, 0.2, 0, 0.012, -0.14));
  g.add(cyl(metal, 0.036, 0.075, 0, -0.008, -0.01));
  g.add(box(metal, 0.04, 0.045, 0.1, 0, 0.01, 0.03));
  g.add(box(dark, 0.01, 0.018, 0.012, 0, 0.038, -0.22));
  const grip = pistolGrip(g);
  return { group: g, muzzle: new THREE.Vector3(0, 0.012, -0.25), hipPos: new THREE.Vector3(0.17, -0.17, -0.45), adsPos: new THREE.Vector3(0, -0.048, -0.36), mag: grip };
}

function buildAutoPistol(): GunModel {
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

  constructor(scene: THREE.Scene) {
    this.guns = [
      buildRifle(),
      buildPistol(),
      buildShotgun(),
      buildSniper(),
      buildKnife(),
      buildSmg(),
      buildLmg(),
      buildCrossbow(),
      buildDmr(),
      buildLauncher(),
      buildDeagle(),
      buildRevolver(),
      buildAutoPistol(),
    ];
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
      if (!asset) return;
      const old = g.group.children.filter((c) => c instanceof THREE.Mesh && c.material !== glove && c.material !== sleeve);
      g.group.remove(...old);
      const model = asset.object.clone();
      model.position.copy(g.muzzle);
      g.group.add(model);
      if (g.adsPos === g.hipPos) return;
      g.adsPos.y = -(g.muzzle.y + asset.sightY);
      // These models are bulkier at the back: further out, they cover less of the screen.
      g.adsPos.z -= 0.12;
    });
    if (this.skin) this.guns.forEach((g) => applySkin(g.group, this.skin, UNSKINNED));
  }

  /** Paints every gun (not the hands) with a weapon skin. */
  setSkin(id: string): void {
    if (id === this.skin) return;
    this.skin = id;
    this.guns.forEach((g) => applySkin(g.group, id, UNSKINNED));
  }

  setWeapon(w: number): void {
    this.current = w;
    this.swingT = 0;
    this.guns.forEach((g, i) => (g.group.visible = i === w));
  }

  swing(): void {
    this.swingT = SWING_TIME;
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
    if (s.sprint && s.aim < 0.1 && moving) {
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
    const lower = 1 - s.raise;
    pos.y -= lower * 0.3;
    rotX -= lower * 0.6;

    // Knife slash: right to left across the screen, applied directly so the smoothing below doesn't mute it.
    this.swingT = Math.max(0, this.swingT - dt);
    const swinging = this.swingT > 0;
    if (swinging) {
      const a = Math.sin((1 - this.swingT / SWING_TIME) * Math.PI);
      pos.x -= a * 0.2;
      pos.y += a * 0.06;
      pos.z -= a * 0.16;
      rotX -= a * 0.3;
      rotY += a * 0.9;
      rotZ += a * 0.5;
    }

    g.group.position.lerp(pos, swinging ? 1 : Math.min(1, dt * 25));
    g.group.rotation.x += (rotX - g.group.rotation.x) * (swinging ? 1 : Math.min(1, dt * 18));
    g.group.rotation.y += (rotY - g.group.rotation.y) * (swinging ? 1 : Math.min(1, dt * 10));
    g.group.rotation.z += (rotZ - g.group.rotation.z) * (swinging ? 1 : Math.min(1, dt * 10));
    g.group.updateMatrix();

    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) this.flash.visible = false;
    }
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }
}
