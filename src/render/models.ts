import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PLAYER } from '../game/constants';
import { WEAPONS } from '../game/weapons';
import { assetsReady, gunAssets, soldierAsset } from './assets';
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

/** Rows of the soldier's palette texture, top to bottom, and how many pixels each one takes. */
const PALETTE: Array<[string | null, number]> = [
  ['#c99a74', 6], // skin
  ['#1f2124', 5], // boots, gloves
  ['#2a2c22', 6], // hair
  [null, 6], // shirt: the player's color
  ['#3b4230', 9], // trousers
];

const gearMat = new THREE.MeshLambertMaterial({ color: 0x2c3024 });
const bootMat = new THREE.MeshLambertMaterial({ color: 0x17181a });
const helmetGeo = new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56);

/** Where the gun rides on the body: sideways toward the right shoulder, and how far ahead its rear end is. */
const GUN_X = 0.12;
const GUN_REAR = 0.05;
const HANDGUN_REAR = 0.3;
const SPEED_RUN = 6.5;
/** Speed at which each clip's feet match the ground. */
const CLIP_SPEED = { idle: 1, walk: 3.4, run: 7 };
const CROUCH_SQUASH = 0.24;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _w = new THREE.Quaternion();
const _p = new THREE.Quaternion();

/** Turns `bone` so that `tip`, further down the arm, points at `target`. Everything is in world space. */
function pointBone(bone: THREE.Object3D, tip: THREE.Object3D, target: THREE.Vector3): void {
  bone.getWorldPosition(_a);
  tip.getWorldPosition(_b);
  _q.setFromUnitVectors(_b.sub(_a).normalize(), _c.copy(target).sub(_a).normalize());
  bone.getWorldQuaternion(_w);
  bone.parent?.getWorldQuaternion(_p);
  bone.quaternion.copy(_p.invert().multiply(_q.multiply(_w)));
  bone.updateWorldMatrix(false, true);
}

/** The animated character: walks with clips, while its arms are posed on the gun every frame. */
class Soldier {
  readonly root: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private clips: Record<keyof typeof CLIP_SPEED, THREE.AnimationAction>;
  private active: THREE.AnimationAction;
  private material: THREE.MeshLambertMaterial;
  private canvas = document.createElement('canvas');
  private texture = new THREE.CanvasTexture(this.canvas);
  private scale: number;
  private arms: Array<{ upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D; side: number }>;

  constructor(asset: NonNullable<typeof soldierAsset>, color: string) {
    this.root = SkeletonUtils.clone(asset.object);
    this.scale = PLAYER.height / asset.height;
    this.root.scale.setScalar(this.scale);
    this.root.rotation.y = Math.PI;

    this.canvas.width = 1;
    this.canvas.height = PALETTE.reduce((n, [, h]) => n + h, 0);
    this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshLambertMaterial({ map: this.texture });
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.material = this.material;
      o.castShadow = true;
      o.frustumCulled = false;
    });
    this.setColor(color);

    this.mixer = new THREE.AnimationMixer(this.root);
    const action = (name: string): THREE.AnimationAction => {
      const clip = asset.clips.find((c) => c.name.endsWith(`|${name}`));
      if (!clip) throw new Error(`Clip ausente: ${name}`);
      return this.mixer.clipAction(clip);
    };
    this.clips = { idle: action('Idle'), walk: action('Walk'), run: action('Run') };
    this.active = this.clips.idle;
    this.active.play();

    const bone = (name: string): THREE.Object3D => {
      const b = this.root.getObjectByName(name);
      if (!b) throw new Error(`Osso ausente: ${name}`);
      return b;
    };
    this.arms = [
      { upper: bone('RightArm'), fore: bone('RightForeArm'), hand: bone('RightHand'), side: 1 },
      { upper: bone('LeftArm'), fore: bone('LeftForeArm'), hand: bone('LeftHand'), side: -1 },
    ];
    this.addGear(bone);
  }

  /** Helmet, vest and boots, in meters whatever the scale of the bone they ride on. */
  private addGear(bone: (name: string) => THREE.Object3D): void {
    this.root.updateWorldMatrix(true, true);
    const attach = (name: string, mesh: THREE.Mesh, x: number, y: number, z: number): void => {
      const b = bone(name);
      const k = 1 / b.getWorldScale(new THREE.Vector3()).x;
      mesh.scale.multiplyScalar(k);
      mesh.position.set(x * k, y * k, z * k);
      mesh.castShadow = true;
      b.add(mesh);
    };
    attach('Head', new THREE.Mesh(helmetGeo, gearMat), 0, 0.09, 0.01);
    attach('Spine1', new THREE.Mesh(boxGeo, gearMat), 0, 0.1, 0);
    bone('Spine1').children.at(-1)?.scale.multiply(new THREE.Vector3(0.36, 0.42, 0.25));
    for (const foot of ['LeftFoot', 'RightFoot']) {
      const boot = new THREE.Mesh(boxGeo, bootMat);
      attach(foot, boot, 0, 0.07, 0.02);
      boot.scale.multiply(new THREE.Vector3(0.12, 0.24, 0.13));
    }
  }

  setColor(color: string): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    let y = 0;
    for (const [fill, h] of PALETTE) {
      ctx.fillStyle = fill ?? color;
      ctx.fillRect(0, y, 1, h);
      y += h;
    }
    this.texture.needsUpdate = true;
  }

  animate(dt: number, speed: number, crouch: number): void {
    const name = speed < 0.5 ? 'idle' : speed < SPEED_RUN ? 'walk' : 'run';
    const next = this.clips[name];
    if (next !== this.active) {
      next.reset().play();
      this.active.crossFadeTo(next, 0.15, false);
      this.active = next;
    }
    next.timeScale = name === 'idle' ? 1 : speed / CLIP_SPEED[name];
    this.mixer.update(dt);
    this.root.scale.y = this.scale * (1 - CROUCH_SQUASH * crouch);
  }

  /** Runs after the clips, so the pose wins over them. Elbows hang below and outside the line to the hand. */
  holdGun(right: THREE.Object3D, left: THREE.Object3D, yaw: number): void {
    const out = _b.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const ox = out.x;
    const oz = out.z;
    this.arms.forEach((arm, i) => {
      const grip = (i === 0 ? right : left).getWorldPosition(new THREE.Vector3());
      const shoulder = arm.upper.getWorldPosition(new THREE.Vector3());
      const elbow = shoulder.clone().lerp(grip, 0.5);
      elbow.x += ox * arm.side * 0.1;
      elbow.y -= 0.14;
      elbow.z += oz * arm.side * 0.1;
      pointBone(arm.upper, arm.fore, elbow);
      pointBone(arm.fore, arm.hand, grip);
    });
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.material.dispose();
    this.texture.dispose();
  }
}

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
  private soldier: Soldier | null = null;
  private gripR = new THREE.Object3D();
  private gripL = new THREE.Object3D();
  private gunModels = new Map<number, THREE.Object3D>();
  private weapon = -1;
  private disposed = false;
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
    this.gun = part(gunMat, 0.09, 0.12, 0.75, GUN_X, 0, -0.55);
    this.armGroup.add(this.gun);
    this.muzzle.position.set(GUN_X, 0, -0.95);
    this.armGroup.add(this.muzzle);
    this.upper.add(this.armGroup);

    this.armGroup.add(this.gripR, this.gripL);
    this.body.add(this.legL, this.legR, this.upper);
    this.root.add(this.body);
    void assetsReady.then(() => this.useAssets());
  }

  /** Swaps the blocky body for the animated character. The groups stay: they place the gun. */
  private useAssets(): void {
    if (this.disposed || !soldierAsset) return;
    this.soldier = new Soldier(soldierAsset, `#${this.teamMat.color.getHexString()}`);
    this.legL.visible = this.legR.visible = this.head.visible = false;
    for (const g of [this.upper, this.armGroup]) {
      for (const c of g.children) if (c instanceof THREE.Mesh && c !== this.gun) c.visible = false;
    }
    this.body.add(this.soldier.root);
    const w = this.weapon;
    this.weapon = -1;
    if (w >= 0) this.setWeapon(w);
  }

  setColor(color: string): void {
    this.teamMat.color.set(color);
    this.soldier?.setColor(color);
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
    if (w === this.weapon) return;
    this.weapon = w;
    const def = WEAPONS[w] ?? WEAPONS[0];
    const s = def.shape;
    // Long guns rest on the shoulder; handguns are held out in front.
    const rear = def.category === 'primary' ? GUN_REAR : HANDGUN_REAR;
    this.gun.scale.set(0.09, s.h, s.len);
    this.gun.position.z = -rear - s.len / 2;
    this.muzzle.position.z = -rear - s.len;
    this.gripR.position.set(GUN_X, -0.07, -rear - Math.min(s.len * 0.4, 0.3));
    this.gripL.position.set(GUN_X - 0.02, -0.03, -rear - Math.min(s.len * 0.7, 0.52));

    this.gunModels.forEach((m) => (m.visible = false));
    const asset = gunAssets.get(w);
    this.gun.visible = !asset;
    if (!asset) return;
    let model = this.gunModels.get(w);
    if (!model) {
      model = asset.object.clone();
      model.scale.setScalar(s.len / asset.len);
      model.traverse((o) => (o.castShadow = o instanceof THREE.Mesh));
      this.armGroup.add(model);
      this.gunModels.set(w, model);
    }
    model.visible = true;
    model.position.copy(this.muzzle.position);
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

    if (this.soldier) {
      this.soldier.animate(dt, s.alive ? s.speed : 0, this.crouchT);
      this.soldier.holdGun(this.gripR, this.gripL, s.yaw);
    }

    // Spawn protection: flicker.
    const vis = !s.protected || Math.floor(performance.now() / 90) % 2 === 0;
    this.body.visible = vis || !s.alive;
  }

  dispose(): void {
    this.disposed = true;
    this.soldier?.dispose();
    this.teamMat.dispose();
    if (this.label) {
      this.label.material.map?.dispose();
      this.label.material.dispose();
    }
  }
}
