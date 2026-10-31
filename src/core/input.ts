import { settings, type Action } from './settings';

type KeyHook = (code: string, e: KeyboardEvent) => boolean;

/**
 * Tracks keyboard/mouse state using physical key codes. Mouse buttons are
 * represented as "Mouse0".."Mouse4" so they can be bound like keys.
 */
class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** When false (menus, chat), game actions read as released. */
  gameEnabled = true;
  private target: HTMLElement | null = null;
  private keyHooks: KeyHook[] = [];
  private lockListeners = new Set<(locked: boolean) => void>();

  init(target: HTMLElement): void {
    this.target = target;
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const code = 'Mouse' + e.button;
      this.down.add(code);
      this.pressed.add(code);
    });
    window.addEventListener('mouseup', (e) => {
      this.down.delete('Mouse' + e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Guard against occasional huge spikes some browsers emit on lock.
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    window.addEventListener('contextmenu', (e) => {
      if (this.locked || (e.target as HTMLElement | null)?.tagName === 'CANVAS') e.preventDefault();
    });
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) this.clear();
      this.lockListeners.forEach((l) => l(this.locked));
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this.lockListeners.forEach((l) => l(false));
    });
  }

  /** Hooks run before game handling; returning true swallows the key. */
  addKeyHook(h: KeyHook): () => void {
    this.keyHooks.push(h);
    return () => {
      this.keyHooks = this.keyHooks.filter((x) => x !== h);
    };
  }

  onLockChange(l: (locked: boolean) => void): () => void {
    this.lockListeners.add(l);
    return () => this.lockListeners.delete(l);
  }

  private onKeyDown(e: KeyboardEvent): void {
    for (let i = this.keyHooks.length - 1; i >= 0; i--) {
      if (this.keyHooks[i](e.code, e)) return;
    }
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (this.locked) {
      // Avoid browser shortcuts (Tab focus, Space scroll, Ctrl+key) while playing.
      if (e.code !== 'Escape' && e.code !== 'F11' && e.code !== 'F12') e.preventDefault();
    }
    if (!e.repeat) this.pressed.add(e.code);
    this.down.add(e.code);
  }

  requestLock(): void {
    if (!this.target || this.locked) return;
    try {
      const res = this.target.requestPointerLock() as unknown;
      if (res && typeof (res as Promise<void>).catch === 'function') {
        (res as Promise<void>).catch(() => {
          /* browser refused (cooldown after ESC); user can click again */
        });
      }
    } catch {
      /* ignore */
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clear(): void {
    this.down.clear();
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  isDown(a: Action): boolean {
    if (!this.gameEnabled) return false;
    const [p, s] = settings.get().binds[a];
    return (p !== '' && this.down.has(p)) || (s !== '' && this.down.has(s));
  }

  /** True once per physical press of any key bound to the action. */
  consume(a: Action): boolean {
    const [p, s] = settings.get().binds[a];
    let hit = false;
    if (p !== '' && this.pressed.has(p)) {
      this.pressed.delete(p);
      hit = true;
    }
    if (s !== '' && this.pressed.has(s)) {
      this.pressed.delete(s);
      hit = true;
    }
    return hit && this.gameEnabled;
  }

  /** Drops stale press edges (called at the end of each frame). */
  endFrame(): void {
    this.pressed.clear();
  }

  takeMouse(): [number, number] {
    const r: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return this.gameEnabled ? r : [0, 0];
  }

  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return this.gameEnabled ? w : 0;
  }
}

export const input = new Input();
