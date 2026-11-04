import * as THREE from 'three';
import { makeLabelTexture } from './textures';

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const skinMat = new THREE.MeshLambertMaterial({ color: 0xd9a77c });
const darkMat = new THREE.MeshLambertMaterial({ color: 0x1d2026 });
const visorMat = new THREE.MeshLambertMaterial({ color: 0x111111, emissive: 0x0a2a3a });
const gunMat = new THREE.MeshLambertMaterial({ color: 0x2b2e33 });

function part(mat: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Gun lengths per weapon for the third-person model. */
const GUN_SHAPES: Array<{ len: number; h: number }> = [
  { len: 0.75, h: 0.12 },
  { len: 0.35, h: 0.12 },
  { len: 0.85, h: 0.14 },
  { len: 1.1, h: 0.11 },
  { len: 0.3, h: 0.05 },
];

export interface ModelState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: boolean;
  alive: boolean;
  protected: boolean;
  weapon: number;
  speed: number;
}

/** Simple blocky soldier: legs, torso, head with visor, arms holding a gun. */
export class PlayerModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private upper = new THREE.Group();
  private legL: THREE.Group;
  private legR: THREE.Group;
  private head: THREE.Group;
  private armGroup = new THREE.Group();
  private gun: THREE.Mesh;
  private teamMat: THREE.MeshLambertMaterial;
  private label: THREE.Sprite | null = null;
  private labelText = '';
  private crouchT = 0;
  private walkPhase = 0;
  private deathT = 0;
  muzzle = new THREE.Object3D();

  constructor(color: string) {
    this.teamMat = new THREE.MeshLambertMaterial({ color });
    const mkLeg = (x: number): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(x, 0.8, 0);
      g.add(part(this.teamMat, 0.22, 0.8, 0.24, 0, -0.4, 0));
      g.add(part(darkMat, 0.24, 0.12, 0.3, 0, -0.76, -0.03));
      return g;
    };
    this.legL = mkLeg(-0.13);
    this.legR = mkLeg(0.13);

    this.upper.position.y = 0.8;
    this.upper.add(part(this.teamMat, 0.56, 0.65, 0.32, 0, 0.325, 0));
    this.upper.add(part(darkMat, 0.6, 0.1, 0.36, 0, 0.05, 0));
    this.upper.add(part(darkMat, 0.4, 0.3, 0.1, 0, 0.35, 0.2));

    this.head = new THREE.Group();
    this.head.position.y = 0.83;
    this.head.add(part(skinMat, 0.34, 0.36, 0.34, 0, 0, 0));
    this.head.add(part(visorMat, 0.3, 0.1, 0.05, 0, 0.04, -0.17));
    this.head.add(part(this.teamMat, 0.38, 0.12, 0.38, 0, 0.17, 0));
    this.upper.add(this.head);

    // Arms + gun pivot at shoulder height, pitched with aim.
    this.armGroup.position.set(0, 0.55, 0);
    this.armGroup.add(part(this.teamMat, 0.13, 0.13, 0.45, 0.24, -0.05, -0.2));
    this.armGroup.add(part(this.teamMat, 0.13, 0.13, 0.45, -0.18, -0.05, -0.25));
    this.gun = part(gunMat, 0.09, 0.12, 0.75, 0.06, 0, -0.55);
    this.armGroup.add(this.gun);
    this.muzzle.position.set(0.06, 0, -0.95);
    this.armGroup.add(this.muzzle);
    this.upper.add(this.armGroup);

    this.body.add(this.legL, this.legR, this.upper);
    this.root.add(this.body);
  }

  setColor(color: string): void {
    this.teamMat.color.set(color);
  }

  setLabel(text: string, color: string): void {
    const key = text + color;
    if (key === this.labelText) return;
    this.labelText = key;
    if (this.label) {
      this.root.remove(this.label);
      this.label.material.map?.dispose();
      this.label.material.dispose();
    }
    const { tex, aspect } = makeLabelTexture(text, color);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false });
    this.label = new THREE.Sprite(mat);
    const h = 0.28;
    this.label.scale.set(h * aspect, h, 1);
    this.label.position.y = 2.25;
    this.label.renderOrder = 10;
    this.root.add(this.label);
  }

  setLabelVisible(v: boolean): void {
    if (this.label) this.label.visible = v;
  }

  setWeapon(w: number): void {
    const s = GUN_SHAPES[w] ?? GUN_SHAPES[0];
    this.gun.scale.set(0.09, s.h, s.len);
    this.gun.position.z = -0.2 - s.len / 2;
    this.muzzle.position.z = -0.2 - s.len;
  }

  update(s: ModelState, dt: number): void {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;

    // Death: tip over and sink.
    if (!s.alive) {
      this.deathT = Math.min(1, this.deathT + dt * 2.5);
    } else {
      this.deathT = 0;
    }
    this.body.rotation.x = -this.deathT * (Math.PI / 2) * 0.95;
    this.body.position.y = -this.deathT * 0.15;

    this.crouchT += ((s.crouch ? 1 : 0) - this.crouchT) * Math.min(1, dt * 12);
    const legScale = 1 - this.crouchT * 0.55;
    this.legL.scale.y = this.legR.scale.y = legScale;
    this.legL.position.y = this.legR.position.y = 0.8 * legScale;
    this.upper.position.y = 0.8 * legScale;
    this.upper.rotation.x = -this.crouchT * 0.15;

    const sp = Math.min(s.speed, 9);
    if (sp > 0.5 && s.alive) this.walkPhase += dt * (4 + sp * 1.1);
    const swing = sp > 0.5 ? Math.sin(this.walkPhase) * Math.min(0.7, sp * 0.1) : 0;
    this.legL.rotation.x += (swing - this.legL.rotation.x) * Math.min(1, dt * 15);
    this.legR.rotation.x += (-swing - this.legR.rotation.x) * Math.min(1, dt * 15);

    this.armGroup.rotation.x = s.pitch * 0.9;
    this.head.rotation.x = s.pitch * 0.5;

    // Spawn protection: flicker.
    const vis = !s.protected || Math.floor(performance.now() / 90) % 2 === 0;
    this.body.visible = vis || !s.alive;
  }

  dispose(): void {
    this.teamMat.dispose();
    if (this.label) {
      this.label.material.map?.dispose();
      this.label.material.dispose();
    }
  }
}
