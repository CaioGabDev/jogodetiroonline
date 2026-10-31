import { settings } from './settings';

export const FIXED_DT = 1 / 60;

export interface LoopCallbacks {
  /** Physics/simulation step at a fixed 60 Hz. */
  fixed(dt: number): void;
  /** Render with interpolation factor alpha in [0,1) between the last two fixed steps. */
  render(alpha: number, frameDt: number): void;
}

/** Fixed-timestep loop (60 Hz simulation) with interpolated rendering and an optional FPS cap. */
export class GameLoop {
  private acc = 0;
  private last = 0;
  private lastRender = 0;
  private running = false;
  private frames = 0;
  private fpsTimer = 0;
  fps = 0;

  constructor(private cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.lastRender = this.last;
    requestAnimationFrame(this.frame);
  }

  private frame = (t: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);

    const limit = settings.get().fpsLimit;
    if (limit > 0) {
      const minDelta = 1000 / limit;
      // Small tolerance so a 60 cap on a 60 Hz display does not drop to 30.
      if (t - this.lastRender < minDelta - 1.5) return;
    }

    let dt = (t - this.last) / 1000;
    this.last = t;
    if (dt > 0.25) dt = 0.25; // tab was suspended
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 8) {
      this.cb.fixed(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps >= 8) this.acc = 0;

    const frameDt = (t - this.lastRender) / 1000;
    this.lastRender = t;
    this.cb.render(this.acc / FIXED_DT, frameDt);

    this.frames++;
    this.fpsTimer += frameDt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }
  };
}
