import * as THREE from 'three';
import { settings, type Settings } from '../core/settings';
import type { MapId } from '../game/constants';
import { MAPS } from '../game/mapData';
import { buildMap, buildSky, PickupView } from './map';

const QUALITY = {
  low: { pixelRatioCap: 1, antialias: false, shadowSize: 512, shadowType: THREE.BasicShadowMap, anisotropy: 1 },
  medium: { pixelRatioCap: 1, antialias: true, shadowSize: 1024, shadowType: THREE.PCFShadowMap, anisotropy: 4 },
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
  pickups!: PickupView;
  private mapMaterials: THREE.Material[] = [];
  private mapGroup: THREE.Group | null = null;
  private mapId: MapId | null = null;
  private fog = new THREE.Fog(0xbcd3e6, 70, 260);
  private antialias: boolean | null = null;
  private appliedKey = '';
  /** Extra FOV multiplier applied for ADS zoom (1 = none). */
  zoom = 1;
  showViewmodel = true;

  constructor(private container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(settings.get().fov, 16 / 9, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
    this.vmCamera = new THREE.PerspectiveCamera(70, 16 / 9, 0.01, 10);

    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0xbcd3e6);
    this.scene.add(buildSky());

    const hemi = new THREE.HemisphereLight(0xdce8ff, 0x5a5048, 1.1);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    this.sun.target.position.set(0, 0, 0);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    // Viewmodel lighting
    this.vmScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
    const vmSun = new THREE.DirectionalLight(0xffffff, 1.6);
    vmSun.position.set(1, 2, 1);
    this.vmScene.add(vmSun);

    this.createRenderer();
    this.setMap('arena');

    this.applySettings(settings.get());
    settings.onChange((s) => this.applySettings(s));
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Swaps the world to another map. Fog and the sun's shadow area follow its size. */
  setMap(id: MapId): void {
    if (id === this.mapId) return;
    this.mapId = id;
    const def = MAPS[id];

    // Textures are shared between maps, so only geometry and materials go away.
    this.mapGroup?.removeFromParent();
    this.mapGroup?.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.pickups?.dispose();

    const map = buildMap(def, QUALITY[settings.get().quality].anisotropy);
    this.mapGroup = map.group;
    this.mapMaterials = map.materials;
    this.scene.add(map.group);
    this.pickups = new PickupView(def);
    this.scene.add(this.pickups.group);

    [this.fog.near, this.fog.far] = def.fog;
    // Values are tuned for an 80 m map and scale with its size.
    const k = def.size / 80;
    this.sun.position.set(36 * k, 60 * k, 28 * k);
    const sc = this.sun.shadow.camera;
    sc.left = -52 * k;
    sc.right = 52 * k;
    sc.top = 52 * k;
    sc.bottom = -52 * k;
    sc.near = 10 * k;
    sc.far = 160 * k;
    sc.updateProjectionMatrix();
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

  /** GPU name when WebGL is running in software (no hardware acceleration), else null. */
  softwareRenderer(): string | null {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) ? name : null;
    } catch {
      return null;
    }
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
