import * as THREE from 'three';
import { skinById } from '../game/progression';
import { assetsReady, gunAssets } from './assets';
import { knifeModel, releaseKnife, setKnifeInspect } from './knives';
import { inspectPose, removeKit, setKit, setKitInspect } from './skinKits';
import { applySkin, tickSkins } from './skins';

/** Same length as the inspection in the game (game.ts INSPECT_MS). */
const INSPECT_S = 2.6;

/** A gun on a turntable, with a skin and its parts, for the Arsenal. Its own renderer, kept while the page lives. */
export class SkinPreview {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 20);
  /** Turns slowly, to show the gun from both sides. */
  private holder = new THREE.Group();
  /** Inspection tricks, around the gun's middle. */
  private pivot = new THREE.Group();
  private model: THREE.Object3D | null = null;
  /** The knife model, when the skin shown is a knife skin. */
  private knife: THREE.Object3D | null = null;
  private skinId = '';
  private weapon = 0;
  private raf = 0;
  private last = 0;
  private spin = 0;
  private inspectT = -1;
  private ready = false;

  constructor() {
    this.canvas.className = 'skin-3d';
    this.camera.position.set(1.9, 0.35, 0);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1a1e26, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 3, 1.5);
    const rim = new THREE.DirectionalLight(0x6fa8ff, 1.4);
    rim.position.set(-2, 1, -2);
    this.scene.add(key, rim, this.holder);
    this.holder.add(this.pivot);
    void assetsReady.then(() => {
      this.ready = true;
      this.rebuild();
    });
  }

  show(skinId: string, weapon: number): void {
    if (skinId === this.skinId && weapon === this.weapon) return;
    // Each knife skin has its own model, so it always rebuilds.
    const knives = skinById(skinId).slot === 'faca' || skinById(this.skinId).slot === 'faca';
    const sameGun = !knives && weapon === this.weapon && this.model !== null;
    this.skinId = skinId;
    this.weapon = weapon;
    if (sameGun) this.dress();
    else this.rebuild();
  }

  inspect(): void {
    this.inspectT = 0;
  }

  start(): void {
    if (this.raf) return;
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      } catch {
        return; // No WebGL: the 2D previews still show the colors.
      }
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    }
    this.last = performance.now();
    const frame = (t: number): void => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.tick(dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private rebuild(): void {
    if (!this.ready) return;
    if (this.model) {
      removeKit(this.model);
      this.pivot.remove(this.model);
      this.model = null;
    }
    releaseKnife(this.knife);
    this.knife = null;
    const skin = skinById(this.skinId);
    let model: THREE.Object3D;
    if (skin.slot === 'faca') {
      // Blade along -Z like the guns, with its flat side toward the camera.
      const k = knifeModel(skin);
      k.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
      model = new THREE.Group();
      model.add(k);
      this.knife = k;
    } else {
      const asset = gunAssets.get(this.weapon);
      if (!asset) return;
      model = asset.object.clone();
    }
    // Centered and about 1.3 long, whatever the gun.
    const box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.sub(c);
    const holder = new THREE.Group();
    holder.add(model);
    holder.scale.setScalar(1.3 / Math.max(0.2, box.max.z - box.min.z));
    this.pivot.clear();
    this.pivot.add(holder);
    this.model = model;
    this.dress();
  }

  private dress(): void {
    if (!this.model) return;
    const skin = skinById(this.skinId);
    applySkin(this.model, skin.id);
    setKit(this.model, skin);
  }

  private tick(dt: number): void {
    const r = this.renderer;
    if (!r) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      r.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    tickSkins(dt);

    // Swings between the two sides instead of a full turn, so the gun never shows its end on.
    this.spin += dt;
    this.holder.rotation.y = Math.sin(this.spin * 0.6) * 0.7;
    this.holder.position.y = Math.sin(this.spin * 1.3) * 0.02;

    const shown = skinById(this.skinId);
    const fx = shown.fx;
    let p = -1;
    if (this.inspectT >= 0) {
      this.inspectT += dt;
      p = this.inspectT / INSPECT_S;
      if (p > 1) {
        this.inspectT = -1;
        p = -1;
      }
    }
    // Skins without a trick of their own get a plain turn, so the button always does something.
    const pose = inspectPose(shown.knife?.inspect ?? fx?.inspect ?? 'twirl', p);
    if (!fx && !shown.knife && p >= 0) pose.ry /= 2;
    setKnifeInspect(this.knife, p);
    this.pivot.rotation.set(pose.rx, pose.ry, pose.rz);
    this.pivot.position.y = pose.dy * 2;
    if (this.model) setKitInspect(this.model, pose.amount);
    r.render(this.scene, this.camera);
  }
}
