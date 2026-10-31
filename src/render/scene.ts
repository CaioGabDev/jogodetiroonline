import * as THREE from 'three';
import { settings, type Settings } from '../core/settings';
import { buildMap, buildSky, PickupView } from './map';

const QUALITY = {
  low: { pixelRatioCap: 1, antialias: false, shadowSize: 512, shadowType: THREE.BasicShadowMap, anisotropy: 1 },
  medium: { pixelRatioCap: 1.25, antialias: true, shadowSize: 1024, shadowType: THREE.PCFShadowMap, anisotropy: 4 },
  high: { pixelRatioCap: 2, antialias: true, shadowSize: 2048, shadowType: THREE.PCFSoftShadowMap, anisotropy: 8 },
};

/** Owns the WebGL renderer, world scene, camera and the separate viewmodel (first-person weapon) scene. */
export class SceneManager {
  renderer!: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly vmScene = new THREE.Scene();
  readonly vmCamera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly pickups: PickupView;
  private mapMaterials: THREE.Material[] = [];
  private antialias: boolean | null = null;
  private appliedKey = '';
  /** Extra FOV multiplier applied for ADS zoom (1 = none). */
  zoom = 1;
  showViewmodel = true;

  constructor(private container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(settings.get().fov, 16 / 9, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
    this.vmCamera = new THREE.PerspectiveCamera(70, 16 / 9, 0.01, 10);

    this.scene.fog = new THREE.Fog(0xbcd3e6, 70, 260);
    this.scene.background = new THREE.Color(0xbcd3e6);
    this.scene.add(buildSky());

    const hemi = new THREE.HemisphereLight(0xdce8ff, 0x5a5048, 1.1);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    this.sun.position.set(36, 60, 28);
    this.sun.target.position.set(0, 0, 0);
    const sc = this.sun.shadow.camera;
    sc.left = -52;
    sc.right = 52;
    sc.top = 52;
    sc.bottom = -52;
    sc.near = 10;
    sc.far = 160;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    // Viewmodel lighting
    this.vmScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
    const vmSun = new THREE.DirectionalLight(0xffffff, 1.6);
    vmSun.position.set(1, 2, 1);
    this.vmScene.add(vmSun);

    this.createRenderer();
    const map = buildMap(QUALITY[settings.get().quality].anisotropy);
    this.mapMaterials = map.materials;
    this.scene.add(map.group);
    this.pickups = new PickupView();
    this.scene.add(this.pickups.group);

    this.applySettings(settings.get());
    settings.onChange((s) => this.applySettings(s));
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  private createRenderer(): void {
    const q = QUALITY[settings.get().quality];
    const old = this.renderer;
    this.renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance' });
    this.antialias = q.antialias;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.tabIndex = -1;
    if (old) {
      const oldCanvas = old.domElement;
      oldCanvas.replaceWith(this.renderer.domElement);
      old.dispose();
      this.onCanvasReplaced?.(this.renderer.domElement);
    } else {
      this.container.appendChild(this.renderer.domElement);
    }
  }

  /** Called when the renderer had to be re-created (antialias change). */
  onCanvasReplaced: ((c: HTMLCanvasElement) => void) | null = null;

  private applySettings(s: Settings): void {
    // Only rebuild render state when something visual changed (sliders fire many updates).
    const key = `${s.quality}|${s.shadows}|${s.resolutionScale}`;
    if (key === this.appliedKey) return;
    this.appliedKey = key;
    const q = QUALITY[s.quality];
    if (this.antialias !== null && this.antialias !== q.antialias) {
      this.createRenderer();
    }
    const r = this.renderer;
    const shadows = s.shadows;
    r.shadowMap.enabled = shadows;
    r.shadowMap.type = q.shadowType;
    this.sun.castShadow = shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowSize) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.mapMaterials.forEach((m) => {
      const mm = m as THREE.MeshStandardMaterial;
      if (mm.map) mm.map.anisotropy = Math.min(q.anisotropy, r.capabilities.getMaxAnisotropy());
      m.needsUpdate = true;
    });
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => (m.needsUpdate = true));
      }
    });
    this.resize();
  }

  resize(): void {
    const s = settings.get();
    const q = QUALITY[s.quality];
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatioCap) * s.resolutionScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.vmCamera.aspect = w / h;
    this.updateProjection();
    this.vmCamera.updateProjectionMatrix();
  }

  updateProjection(): void {
    const base = settings.get().fov;
    // Settings FOV is horizontal-ish feel; convert to vertical for a 16:9 reference.
    const vfov = (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base) / 2) / (16 / 9)) * 180) / Math.PI;
    const z = (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(vfov) / 2) / this.zoom) * 180) / Math.PI;
    if (Math.abs(this.camera.fov - z) > 1e-3) {
      this.camera.fov = z;
      this.camera.updateProjectionMatrix();
    }
  }

  render(): void {
    const r = this.renderer;
    this.updateProjection();
    r.autoClear = true;
    r.render(this.scene, this.camera);
    if (this.showViewmodel) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
    }
  }
}
