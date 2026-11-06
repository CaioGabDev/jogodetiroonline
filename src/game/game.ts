import * as THREE from 'three';
import { audio } from '../core/audio';
import { input } from '../core/input';
import { keyLabel, settings } from '../core/settings';
import { clamp, damp, now, r2, r3 } from '../core/util';
import { ARSENAL_NAMES, INPUT_RATE, MAX_HP, MOVE, RESPAWN_MS, TEAM_COLORS, type MatchConfig } from './constants';
import { rayPlayer } from './hitbox';
import { MAPS, type MapDef } from './mapData';
import { CollisionWorld, eyeHeight, type PState } from './physics';
import { RemotePlayer } from './player';
import { DEFAULT_LOADOUT, GUN_GAME_LADDER, RECOIL_PATTERN, W, WEAPONS, WEAPON_COUNT, allowedWeapons, fullAmmo, spawnEquipment } from './weapons';
import type { NetClient } from '../net/client';
import { F_PROTECTED, type HostMsg, type LobbyState, type MatchInfo, type PlayerInfo, type ProjEndMsg, type ProjMsg } from '../net/protocol';
import type { SceneManager } from '../render/scene';
import { Effects } from '../render/effects';
import { Viewmodel } from '../render/viewmodel';
import type { Hud } from '../ui/hud';
import type { Chat } from '../ui/chat';
import type { Scoreboard, ScoreEntry } from '../ui/scoreboard';

export interface GameDeps {
  sm: SceneManager;
  net: NetClient;
  hud: Hud;
  chat: Chat;
  scoreboard: Scoreboard;
}

const LOOK_SCALE = 0.0005;
const SWITCH_MS = 380;
/** How long the knife stays out after a quick melee. */
const MELEE_MS = 450;
/** Camera roll during a slide, in radians. */
const SLIDE_ROLL = 0.06;
/** Longest wait after a shot before recoil starts to recover, whatever the weapon's fire rate. */
const RECOVER_DELAY_MS = 300;
const SLOT_ACTIONS = ['weapon1', 'weapon2', 'weapon3', 'weapon4'] as const;
const EQUIP_ACTIONS = ['lethal', 'tactical'] as const;
/** While concussed: share of movement speed and of mouse sensitivity, and how far the view sways in radians. */
const CONCUSSED_SPEED = 0.55;
const CONCUSSED_LOOK = 0.4;
const CONCUSSED_SWAY = 0.05;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

/** Client-side match: local prediction, weapons, remote interpolation, effects and HUD. */
export class Game {
  readonly localId: number;
  private sm: SceneManager;
  private net: NetClient;
  private hud: Hud;
  private chat: Chat;
  private scoreboard: Scoreboard;
  private map: MapDef;
  private world: CollisionWorld;
  private effects = new Effects();
  private viewmodel: Viewmodel;
  private remotes = new Map<number, RemotePlayer>();
  private infos = new Map<number, PlayerInfo>();
  private config: MatchConfig;

  // Local player
  private me: PState = { x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false, slide: 0, mantle: null };
  private prev = { x: 0, y: -50, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private alive = false;
  private hp = MAX_HP;
  private protected = false;
  private tp = 0;
  private eyeH = eyeHeight(false);
  private crouchToggled = false;
  private adsToggled = false;
  private sprinting = false;
  /** Sprint key was tapped; stays on until forward is released. */
  private sprintLatched = false;
  private wasForward = false;
  /** Seconds of sprint left. */
  private stamina: number = MOVE.sprintTime;
  /** Weapon can't fire or aim until this time, after a sprint. */
  private sprintOutUntil = 0;
  /** A semi-auto shot pressed during that delay, fired when it ends. */
  private shotQueued = false;
  private wasCrouching = false;
  private roll = 0;
  /** Weapon to go back to after a quick melee, or -1. */
  private meleeBack = -1;
  private meleeBackAt = 0;
  private stepAcc = 0;
  private bobPhase = 0;
  private landDip = 0;
  private shake = 0;
  private frameLookX = 0;
  private frameLookY = 0;

  // Weapons
  private weapon = 0;
  private mag: number[];
  private reserve: number[];
  private reloadW = -1;
  private reloadStart = 0;
  private reloadUntil = 0;
  private switchUntil = 0;
  private lastShot = 0;
  private lastDry = 0;
  private aimT = 0;
  private recoilP = 0;
  private recoilY = 0;
  private bloom = 0;
  private burst = 0;
  /** Shots left in the current burst of a burst-fire weapon. */
  private burstLeft = 0;
  /** Primaries and pistol confirmed by the host. */
  private ld: number[] = [...DEFAULT_LOADOUT];
  /** What this life can throw: lethal, then tactical. Empty where the mode has no equipment. */
  private equip: number[] = [];
  /** Slowed and with heavy aim until this time, after a concussion. */
  private dazedUntil = 0;
  /** Asks the app to open the inventory with the current weapons. */
  onInventory: ((loadout: number[]) => void) | null = null;
  private shotSeq = 0;
  private pendingShots: Array<{ s: number; w: number }> = [];
  /** Simulation clock (ms) advanced by the fixed step; weapon timing uses it so fire rate is exact at any FPS. */
  private simT = 0;
  // Values from the previous fixed step, for smooth rendering on >60 Hz displays.
  private prevRecoilP = 0;
  private prevRecoilY = 0;
  private prevAimT = 0;
  private jumpQueued = false;

  // Net / match
  private inputAcc = 0;
  private scores = new Map<number, { k: number; d: number; pg: number; lv: number }>();
  private teams: [number, number] = [0, 0];
  private timeLeft = -1;
  private timeRecvAt = 0;
  private ended = false;

  // Death cam
  private killerId = -1;
  private deathAt = 0;
  private deathPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();

  private labelTimer = 0;
  private sbTimer = 0;

  constructor(deps: GameDeps, lobby: LobbyState, match: MatchInfo) {
    this.sm = deps.sm;
    this.net = deps.net;
    this.hud = deps.hud;
    this.chat = deps.chat;
    this.scoreboard = deps.scoreboard;
    this.localId = deps.net.localId;
    this.config = match.config;
    this.map = MAPS[match.config.map];
    this.world = new CollisionWorld(this.map);
    this.sm.setMap(match.config.map);
    const ammo = fullAmmo();
    this.mag = ammo.mag;
    this.reserve = ammo.reserve;
    this.viewmodel = new Viewmodel(this.sm.vmScene);
    this.viewmodel.visible = false;
    this.sm.scene.add(this.effects.group);
    this.sm.pickups.setAll(match.pickups);
    this.updateLobby(lobby);
    this.hud.reset();
    this.hud.show(true);
    this.chat.show(true);
    this.chat.onSend = (text, team) => this.net.send({ type: 'chat', text, team });
  }

  dispose(): void {
    this.remotes.forEach((r) => r.dispose());
    this.remotes.clear();
    this.effects.group.removeFromParent();
    this.viewmodel.root.removeFromParent();
    this.sm.zoom = 1;
    this.sm.showViewmodel = true;
    this.hud.show(false);
    this.hud.reset();
    this.scoreboard.show(false);
    this.chat.show(false);
    this.chat.close();
    this.chat.onSend = null;
  }

  // ------------------------------------------------------------------ players

  private teamOf(id: number): string | undefined {
    return this.infos.get(id)?.team;
  }

  private isTeammate(id: number): boolean {
    return this.config.mode === 'tdm' && this.teamOf(id) === this.teamOf(this.localId);
  }

  displayColor(id: number): string {
    const info = this.infos.get(id);
    if (!info) return '#ffffff';
    return this.config.mode === 'tdm' ? TEAM_COLORS[info.team] : info.color;
  }

  private nameOf(id: number): string {
    return this.infos.get(id)?.name ?? '???';
  }

  updateLobby(lobby: LobbyState): void {
    this.config = lobby.config;
    this.infos.clear();
    for (const p of lobby.players) this.infos.set(p.id, p);
    for (const p of lobby.players) {
      if (p.id === this.localId) continue;
      let r = this.remotes.get(p.id);
      if (!r) {
        r = new RemotePlayer(p.id, this.displayColor(p.id));
        this.remotes.set(p.id, r);
        this.sm.scene.add(r.model.root);
      }
      r.model.setColor(this.displayColor(p.id));
      r.model.setLabel(p.name, this.displayColor(p.id));
    }
    for (const [id, r] of this.remotes) {
      if (!this.infos.has(id)) {
        r.dispose();
        this.remotes.delete(id);
      }
    }
  }

  // ------------------------------------------------------------------ network

  onMessage(m: HostMsg): void {
    switch (m.type) {
      case 'snap':
        for (const s of m.ps) {
          if (s.i === this.localId) {
            this.hp = s.hp;
            this.protected = (s.f & F_PROTECTED) !== 0;
            continue;
          }
          this.remotes.get(s.i)?.push(m.t, s);
        }
        break;
      case 'spawn':
        this.onSpawn(m.p, m.yw, m.tp, m.full, m.ld);
        break;
      case 'ammo':
        this.onAmmo(m.mag, m.res, m.ack);
        break;
      case 'hit': {
        const kind = m.kill ? 'kill' : m.hs ? 'head' : 'hit';
        this.hud.hitmarker(kind);
        audio.hitmarker(kind);
        // A tactical hits for 0: the marker says it caught someone, without a number.
        if (settings.get().showDamage && m.dmg > 0) this.hud.addDamageNumber(m.dmg, kind, m.p[0], m.p[1], m.p[2]);
        break;
      }
      case 'dmg':
        if (!this.alive) break;
        this.hud.damageFrom(m.src[0], m.src[2], m.amt);
        audio.hurt();
        this.shake = Math.min(1, this.shake + m.amt / 60);
        // Flinch: being shot throws the aim off, and recoil recovery brings it back.
        this.recoilP += 0.004 + Math.random() * 0.006;
        this.recoilY += (Math.random() - 0.5) * 0.012;
        break;
      case 'kill':
        this.onKill(m.k, m.v, m.w, m.hs);
        break;
      case 'shot':
        this.onRemoteShot(m.i, m.w, m.o, m.e, m.h, m.n);
        break;
      case 'proj':
        this.onProjectile(m);
        break;
      case 'pimp':
        this.onProjectileEnd(m);
        break;
      case 'stun':
        if (!this.alive) break;
        if (WEAPONS[m.w]?.stun?.blind) this.hud.stun(true, m.ms);
        else {
          this.dazedUntil = this.simT + m.ms;
          this.hud.stun(false, m.ms);
        }
        audio.stunned(m.ms);
        break;
      case 'pickup':
        this.sm.pickups.setActive(m.idx, m.on);
        if (!m.on && m.by === this.localId) {
          audio.pickup();
          this.hud.notify('ARMA RECARREGADA');
          if (this.reloadW === this.weapon) this.reloadW = -1;
        }
        break;
      case 'score':
        const level = this.scores.get(this.localId)?.lv;
        this.scores.clear();
        for (const r of m.ps) this.scores.set(r.i, { k: r.k, d: r.d, pg: r.pg, lv: r.lv });
        this.announceLevel(level);
        this.teams = m.teams;
        this.timeLeft = m.tl;
        this.timeRecvAt = now();
        break;
      case 'chat': {
        const info = this.infos.get(m.from);
        this.chat.add(info?.name ?? '???', this.displayColor(m.from), m.text, m.team);
        audio.chat();
        break;
      }
      case 'sys':
        this.chat.add(null, '', m.text, false, true);
        break;
      case 'lobby':
        this.updateLobby(m.lobby);
        break;
      default:
        break;
    }
  }

  private onSpawn(p: [number, number, number], yaw: number, tp: number, full: boolean, ld?: number[]): void {
    this.tp = tp;
    this.me.x = this.prev.x = p[0];
    this.me.y = this.prev.y = p[1];
    this.me.z = this.prev.z = p[2];
    this.me.vx = this.me.vy = this.me.vz = 0;
    if (!full) return;
    if (ld) this.ld = ld;
    this.me.onGround = true;
    this.me.crouch = false;
    this.me.slide = 0;
    this.me.mantle = null;
    this.equip = spawnEquipment(this.config.arsenal, this.ld);
    this.dazedUntil = 0;
    this.hud.clearStun();
    this.stamina = MOVE.sprintTime;
    this.sprintOutUntil = 0;
    this.shotQueued = false;
    this.meleeBack = -1;
    this.crouchToggled = false;
    this.adsToggled = false;
    this.sprintLatched = false;
    this.alive = true;
    this.hp = MAX_HP;
    this.yaw = yaw;
    this.pitch = 0;
    this.recoilP = this.recoilY = 0;
    const ammo = fullAmmo();
    this.mag = ammo.mag;
    this.reserve = ammo.reserve;
    this.reloadW = -1;
    this.pendingShots = [];
    this.setWeapon(this.allowed()[0], true);
    this.killerId = -1;
    this.aimT = 0;
    this.viewmodel.visible = true;
    this.hud.setDeath(null, '', 0);
    this.hud.clearIndicators();
  }

  private onAmmo(mag: number[], res: number[], ack: number): void {
    this.pendingShots = this.pendingShots.filter((s) => s.s > ack);
    for (let i = 0; i < WEAPON_COUNT; i++) {
      if (this.reloadW === i) continue;
      const pending = this.pendingShots.filter((s) => s.w === i).length;
      this.mag[i] = Math.max(0, mag[i] - pending);
      this.reserve[i] = res[i];
    }
  }

  private onKill(k: number, v: number, w: number, hs: boolean): void {
    const killer = { name: this.nameOf(k), color: this.displayColor(k) };
    const victim = { name: this.nameOf(v), color: this.displayColor(v) };
    this.hud.addKill(killer, victim, w, hs, k === this.localId || v === this.localId);
    if (v === this.localId) {
      this.alive = false;
      this.hp = 0;
      this.killerId = k;
      this.deathAt = now();
      this.deathPos.set(this.me.x, this.me.y + this.eyeH, this.me.z);
      this.camLook.copy(this.deathPos).add(_v1.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)));
      this.reloadW = -1;
      this.aimT = 0;
      this.viewmodel.visible = false;
      audio.death();
    } else if (k === this.localId) {
      this.hud.notify(`Você eliminou ${victim.name}${hs ? ' (HEADSHOT)' : ''}`);
    }
  }

  private onRemoteShot(id: number, w: number, o: number[], e: number[], h: number[], n: number[]): void {
    const r = this.remotes.get(id);
    const muzzle = new THREE.Vector3(o[0], o[1], o[2]);
    if (r && r.model.root.visible) r.model.muzzle.getWorldPosition(muzzle);
    const def = WEAPONS[w];
    const melee = def?.melee === true;
    const pellets = h.length;
    for (let i = 0; i < pellets; i++) {
      const end = new THREE.Vector3(e[i * 3], e[i * 3 + 1], e[i * 3 + 2]);
      if (!melee && (pellets === 1 || i % 3 === 0)) this.effects.tracer(muzzle, end, def?.tracer ?? 0xffd27a);
      if (h[i] === 1) {
        const normal = new THREE.Vector3(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
        this.effects.decal(end, normal);
        this.effects.impact(end, normal, 'world', pellets > 1 ? 3 : 7);
      } else if (h[i] === 2) {
        this.effects.impact(end, null, 'player', 6);
      }
    }
    if (!melee) this.effects.muzzleFlash(muzzle, 0.55, true);
    audio.shot(def?.sound ?? 'rifle', muzzle);
  }

  private onProjectile(m: ProjMsg): void {
    const def = WEAPONS[m.w];
    if (!def?.projectile) return;
    const pos = new THREE.Vector3(m.o[0], m.o[1], m.o[2]);
    const vel = new THREE.Vector3(m.v[0], m.v[1], m.v[2]);
    // Bouncing to a stop: without gravity it stays where the host put it.
    this.effects.addProjectile(m.id, pos, vel, vel.lengthSq() > 0 ? def.projectile.gravity : 0, def.projectile.kind);
    if (m.b) {
      audio.clink(pos);
      return;
    }
    if (m.i === this.localId) return;
    if (!def.silent) this.effects.muzzleFlash(pos, 0.55, true);
    audio.shot(def.sound, pos);
  }

  private onProjectileEnd(m: ProjEndMsg): void {
    this.effects.removeProjectile(m.id);
    const def = WEAPONS[m.w];
    if (!def || m.h === 0) return;
    const pos = new THREE.Vector3(m.p[0], m.p[1], m.p[2]);
    if (def.splash) {
      this.effects.explosion(pos, def.splash.radius);
      audio.explosion(pos);
      const dist = Math.hypot(pos.x - this.me.x, pos.y - this.me.y, pos.z - this.me.z);
      this.shake = Math.min(1, this.shake + Math.max(0, 1 - dist / (def.splash.radius * 3)));
    } else if (def.fire) {
      this.effects.fire(pos, def.fire.radius, def.fire.ms);
      audio.ignite(pos);
    } else if (def.stun) {
      this.effects.muzzleFlash(pos, def.stun.blind ? 7 : 3.5, true, 0.12);
      audio.bang(pos);
    } else if (m.h === 2) {
      this.effects.impact(pos, null, 'player', 6);
    } else {
      const normal = new THREE.Vector3(m.n[0], m.n[1], m.n[2]);
      this.effects.decal(pos, normal);
      this.effects.impact(pos, normal, 'world', 7);
    }
  }

  // ------------------------------------------------------------------ input / weapons

  private get canAct(): boolean {
    return this.alive && !this.ended && input.gameEnabled;
  }

  /** Tells the player when a Gun Game level changed. */
  private announceLevel(before: number | undefined): void {
    const now = this.scores.get(this.localId)?.lv;
    if (this.config.arsenal !== 'gungame' || before === undefined || now === undefined || now === before) return;
    const weapon = WEAPONS[GUN_GAME_LADDER[Math.min(now, GUN_GAME_LADDER.length - 1)]].name.toUpperCase();
    this.hud.notify(now > before ? `SUBIU: ${weapon}` : `VOLTOU PARA: ${weapon}`);
  }

  /** The weapon check in updateWeapons switches away if the one in hand left the loadout. */
  setLoadout(weapons: number[]): void {
    this.ld = weapons;
  }

  /** Weapons in number key order: 1 and 2 primaries, 3 pistol, 4 knife. The host enforces the same list. */
  private keySlots(): number[] {
    return allowedWeapons(this.config.arsenal, this.scores.get(this.localId)?.lv ?? 0, this.ld);
  }

  /** Same weapons in the order of the player's wheel, which only applies with every weapon enabled. */
  private allowed(): number[] {
    const keys = this.keySlots();
    return this.config.arsenal === 'all' ? settings.get().wheel.map((slot) => keys[slot]) : keys;
  }

  /** The knife comes out, strikes and goes away again, whatever was in hand. */
  private quickMelee(): void {
    if (this.simT - this.lastShot < WEAPONS[W.KNIFE].interval) return;
    if (this.weapon !== W.KNIFE) {
      this.meleeBack = this.weapon;
      this.setWeapon(W.KNIFE, true);
    }
    this.switchUntil = this.simT;
    this.meleeBackAt = this.simT + MELEE_MS;
    this.fire();
  }

  /** Goes out at once, with the gun dipping as if swapped. The host flies it and decides what it does. */
  private throwEquipment(w: number | undefined): void {
    const def = w === undefined ? undefined : WEAPONS[w];
    if (w === undefined || !def?.projectile || this.mag[w] <= 0) return;
    this.mag[w]--;
    this.reloadW = -1;
    this.burstLeft = 0;
    this.adsToggled = false;
    this.switchUntil = this.simT + SWITCH_MS;
    this.protected = false;
    this.viewDir(_fwd, this.yaw, this.pitch + (def.projectile.loft ?? 0));
    this.shotSeq++;
    this.pendingShots.push({ s: this.shotSeq, w });
    const eye = this.me.y + this.eyeH;
    this.net.send({ type: 'shoot', s: this.shotSeq, w, o: [r2(this.me.x), r2(eye), r2(this.me.z)], d: [r3(_fwd.x), r3(_fwd.y), r3(_fwd.z)], rt: 0 });
    audio.shot(def.sound);
  }

  private setWeapon(w: number, instant = false): void {
    if (w === this.weapon && !instant) return;
    this.weapon = w;
    this.reloadW = -1;
    this.adsToggled = false;
    this.burst = 0;
    this.burstLeft = 0;
    this.switchUntil = instant ? this.simT + 250 : this.simT + SWITCH_MS;
    this.viewmodel.setWeapon(w);
    if (!instant) audio.switchWeapon();
  }

  private startReload(): void {
    if (WEAPONS[this.weapon].melee) return;
    const w = this.weapon;
    const def = WEAPONS[w];
    const t = this.simT;
    if (this.reloadW >= 0 || t < this.switchUntil || this.mag[w] >= def.mag) return;
    if (!def.infiniteReserve && this.reserve[w] <= 0) return;
    this.reloadW = w;
    this.reloadStart = t;
    this.reloadUntil = t + def.reloadTime * 1000;
    this.adsToggled = false;
    this.net.send({ type: 'reload', w });
    audio.reload(def.reloadTime);
  }

  private finishReload(): void {
    const w = this.reloadW;
    const def = WEAPONS[w];
    const need = def.mag - this.mag[w];
    const take = def.infiniteReserve ? need : Math.min(need, this.reserve[w]);
    this.mag[w] += take;
    if (!def.infiniteReserve) this.reserve[w] -= take;
    this.reloadW = -1;
  }

  private viewDir(out: THREE.Vector3, yaw: number, pitch: number): THREE.Vector3 {
    const cp = Math.cos(pitch);
    return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  }

  private currentSpread(): number {
    const def = WEAPONS[this.weapon];
    const speed = Math.hypot(this.me.vx, this.me.vz);
    let s = def.spreadHip + (def.spreadAds - def.spreadHip) * this.aimT;
    s += Math.min(1, speed / 6) * def.spreadMove * (1 - this.aimT * 0.5);
    if (!this.me.onGround) s += def.spreadAir;
    if (this.me.crouch && this.me.onGround) s *= 0.75;
    return s + this.bloom;
  }

  private fire(): void {
    const w = this.weapon;
    const def = WEAPONS[w];
    const t = this.simT;
    this.lastShot = t;
    if (!def.melee) this.mag[w]--;
    if (this.burstLeft > 0) this.burstLeft--;
    this.sprinting = false;

    const eye = this.me.y + this.eyeH;
    const origin = _v1.set(this.me.x, eye, this.me.z);
    const aimYaw = this.yaw + this.recoilY;
    const aimPitch = this.pitch + this.recoilP;
    this.viewDir(_fwd, aimYaw, aimPitch);
    _right.set(Math.cos(aimYaw), 0, -Math.sin(aimYaw));
    _up.crossVectors(_right, _fwd).normalize();
    const spread = this.currentSpread();
    const dirs: number[] = [];
    const muzzleCam = this.viewmodel.muzzleCameraSpace(new THREE.Vector3());
    const muzzleWorld = this.sm.camera.localToWorld(muzzleCam.clone());
    const rt = this.net.renderTime();
    for (let i = 0; i < def.pellets; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = spread * Math.sqrt(Math.random());
      const d = _v2
        .copy(_fwd)
        .addScaledVector(_right, Math.cos(a) * r)
        .addScaledVector(_up, Math.sin(a) * r)
        .normalize();
      dirs.push(r3(d.x), r3(d.y), r3(d.z));
      // The host flies projectiles and tells everyone, the shooter included, what to draw.
      if (def.projectile) continue;

      // Local prediction of the impact (visual only; the host decides damage).
      const wh = this.world.raycast(origin.x, origin.y, origin.z, d.x, d.y, d.z, def.range);
      let dist = wh ? wh.dist : def.range;
      let playerHit = false;
      for (const rp of this.remotes.values()) {
        if (!rp.alive || (this.isTeammate(rp.id) && !this.config.friendlyFire)) continue;
        const h = rayPlayer(origin.x, origin.y, origin.z, d.x, d.y, d.z, rp, dist);
        if (h && h.dist < dist) {
          dist = h.dist;
          playerHit = true;
        }
      }
      const end = origin.clone().addScaledVector(d, dist);
      if (!def.melee && (def.pellets === 1 || i % 3 === 0)) this.effects.tracer(muzzleWorld, end, def.tracer);
      if (playerHit) {
        this.effects.impact(end, null, 'player', 6);
      } else if (wh) {
        const n = new THREE.Vector3(wh.nx, wh.ny, wh.nz);
        this.effects.decal(end, n);
        this.effects.impact(end, n, 'world', def.pellets > 1 ? 3 : 7);
      }
    }
    this.shotSeq++;
    this.pendingShots.push({ s: this.shotSeq, w });
    this.net.send({ type: 'shoot', s: this.shotSeq, w, o: [r2(origin.x), r2(origin.y), r2(origin.z)], d: dirs, rt: Math.round(rt) });

    // Recoil
    const adsMul = 1 - this.aimT * 0.35;
    this.recoilP += def.kick * (0.85 + Math.random() * 0.3) * adsMul;
    const pat = RECOIL_PATTERN[this.burst % RECOIL_PATTERN.length];
    this.recoilY += (def.pattern ? pat : (Math.random() - 0.5) * 2) * def.kickYaw * adsMul;
    this.burst++;
    this.bloom = Math.min(0.03, this.bloom + def.kick * 0.25);

    if (def.melee) {
      this.viewmodel.swing();
    } else {
      this.viewmodel.fire(def.fireKick);
      const scoped = def.scoped && this.aimT > 0.85;
      if (!scoped && !def.silent) this.effects.muzzleFlash(muzzleWorld, 0.35, true);
    }
    audio.shot(def.sound);
    this.protected = false;

    if (this.mag[w] === 0) window.setTimeout(() => this.alive && this.weapon === w && this.startReload(), 250);
  }

  private updateWeapons(dt: number): void {
    const t = this.simT;
    const def = WEAPONS[this.weapon];
    if (this.reloadW >= 0 && t >= this.reloadUntil) this.finishReload();

    // Recoil recovery after the weapon stops firing.
    if (t - this.lastShot > Math.min(def.interval * 1.4, RECOVER_DELAY_MS)) {
      const k = damp(def.recover, dt);
      this.recoilP -= this.recoilP * k;
      this.recoilY -= this.recoilY * k;
      this.burst = 0;
    }
    this.bloom -= this.bloom * damp(5, dt);

    // Covers Gun Game level-ups and settings changed mid-match.
    const allowed = this.allowed();
    if (!allowed.includes(this.weapon)) this.setWeapon(allowed[0]);

    if (!this.canAct) {
      input.consume('fire');
      return;
    }

    // Weapon switching
    const keys = this.keySlots();
    SLOT_ACTIONS.forEach((action, i) => {
      if (input.consume(action) && keys[i] !== undefined) this.setWeapon(keys[i]);
    });
    if (input.consume('melee')) this.quickMelee();
    if (this.meleeBack >= 0 && t >= this.meleeBackAt) {
      if (this.weapon === W.KNIFE && allowed.includes(this.meleeBack)) this.setWeapon(this.meleeBack);
      this.meleeBack = -1;
    }
    const wheel = input.takeWheel();
    if (wheel !== 0) {
      const next = allowed.indexOf(this.weapon) + (wheel > 0 ? 1 : -1) + allowed.length;
      this.setWeapon(allowed[next % allowed.length]);
    }
    if (input.consume('reload')) this.startReload();
    EQUIP_ACTIONS.forEach((action, i) => {
      if (input.consume(action)) this.throwEquipment(this.equip[i]);
    });

    const wd = WEAPONS[this.weapon];
    const pressed = input.consume('fire');
    if (pressed && wd.burst && this.burstLeft === 0 && t - this.lastShot >= (wd.burstPause ?? 0)) this.burstLeft = wd.burst;
    if (pressed && t < this.sprintOutUntil) this.shotQueued = true;
    const want = wd.burst ? this.burstLeft > 0 : wd.auto ? input.isDown('fire') : pressed || this.shotQueued;
    if (!want) return;
    if (t < this.switchUntil || t < this.sprintOutUntil || this.reloadW >= 0) return;
    this.shotQueued = false;
    if (t - this.lastShot < wd.interval - 1) return;
    if (!wd.melee && this.mag[this.weapon] <= 0) {
      this.burstLeft = 0;
      if (t - this.lastDry > 300) {
        audio.dryFire();
        this.lastDry = t;
        this.startReload();
      }
      return;
    }
    this.fire();
  }

  // ------------------------------------------------------------------ simulation

  fixed(dt: number): void {
    this.simT += dt * 1000;
    this.prevRecoilP = this.recoilP;
    this.prevRecoilY = this.recoilY;
    this.prevAimT = this.aimT;
    const act = this.canAct;
    const s = settings.get();

    if (act) {
      if (input.consume('chat')) this.openChat(false);
      else if (input.consume('teamChat')) this.openChat(this.config.mode === 'tdm');
      else if (input.consume('inventory') && this.config.arsenal === 'all') this.onInventory?.(this.ld);
    }

    let fwd = 0;
    let side = 0;
    let jump = false;
    let wantCrouch = false;
    let ads = false;
    if (act) {
      fwd = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
      side = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
      // Edge press is kept so a quick tap between fixed steps isn't lost.
      if (input.consume('jump')) this.jumpQueued = true;
      jump = input.isDown('jump') || this.jumpQueued;
      if (this.me.onGround || !this.alive) this.jumpQueued = false;
      if (s.crouchMode === 'toggle') {
        if (input.consume('crouch')) this.crouchToggled = !this.crouchToggled;
        wantCrouch = this.crouchToggled;
      } else wantCrouch = input.isDown('crouch');
      if (s.adsMode === 'toggle') {
        if (input.consume('aim')) this.adsToggled = !this.adsToggled;
        ads = this.adsToggled;
      } else ads = input.isDown('aim');
    }
    const t = this.simT;
    const def = WEAPONS[this.weapon];
    const dazed = t < this.dazedUntil;
    const wantAds = ads;
    const busy = this.reloadW >= 0 || t < this.switchUntil || t < this.sprintOutUntil;
    if (busy || def.melee) ads = false;
    const shotPause = !def.melee && t - this.lastShot <= 300;
    // One tap is enough: many keyboards drop Space while Shift and W are both held,
    // so jumping out of a run can't depend on holding all three keys.
    if (input.consume('sprint')) this.sprintLatched = true;
    if (this.wasForward && fwd <= 0) this.sprintLatched = false;
    this.wasForward = fwd > 0;
    const wantSprint = input.isDown('sprint') || this.sprintLatched;
    const fuel = this.sprinting ? this.stamina > 0 : this.stamina >= MOVE.sprintMin;
    const wasSprinting = this.sprinting;
    // Pressing the crouch key out of a sprint slides. Comes first: crouching ends the sprint.
    const slide = wantCrouch && !this.wasCrouching && wasSprinting;
    this.wasCrouching = wantCrouch;
    const moving = this.me.slide <= 0 && this.me.mantle === null;
    this.sprinting = act && wantSprint && fwd > 0 && !wantAds && !wantCrouch && !shotPause && !input.isDown('fire') && fuel && moving && !dazed;
    this.stamina = this.sprinting ? Math.max(0, this.stamina - dt) : Math.min(MOVE.sprintTime, this.stamina + dt * MOVE.sprintRecover);
    if (this.stamina <= 0) this.sprintLatched = false;
    if (wasSprinting && !this.sprinting) this.sprintOutUntil = t + def.sprintOut;

    const aimTarget = ads && this.alive ? 1 : 0;
    const aStep = dt / def.adsTime;
    if (aimTarget > this.aimT) this.aimT = Math.min(1, this.aimT + aStep);
    else if (aimTarget < this.aimT) this.aimT = Math.max(0, this.aimT - aStep * 1.5);

    if (this.alive) {
      this.prev.x = this.me.x;
      this.prev.y = this.me.y;
      this.prev.z = this.me.z;
      const res = this.world.step(
        this.me,
        { fwd, side, jump, crouch: wantCrouch, sprint: this.sprinting, slide, speedMul: (def.moveMul ?? 1) * (dazed ? CONCUSSED_SPEED : 1), ads: this.aimT > 0.3, yaw: this.yaw },
        dt,
      );
      if (res.jumped || res.mantled) audio.jump();
      if (res.slid) audio.land();
      if (res.landed && res.fallSpeed > 4) {
        audio.land();
        this.landDip = Math.min(0.25, this.landDip + res.fallSpeed * 0.012);
        this.viewmodel.land(res.fallSpeed);
      }
      const speed = Math.hypot(this.me.vx, this.me.vz);
      if (this.me.onGround && speed > 1.5 && !this.me.crouch) {
        this.stepAcc += speed * dt;
        const stride = this.sprinting ? 2.9 : 2.3;
        if (this.stepAcc > stride) {
          this.stepAcc = 0;
          audio.footstep(undefined, this.sprinting ? 1.3 : 1);
        }
      }
    }

    this.updateWeapons(dt);

    // Send state to the host at INPUT_RATE.
    this.inputAcc += dt;
    if (this.inputAcc >= 1 / INPUT_RATE) {
      this.inputAcc %= 1 / INPUT_RATE;
      this.net.send({
        type: 'input',
        tp: this.tp,
        ct: Math.round(this.simT),
        p: [r2(this.me.x), r2(this.me.y), r2(this.me.z)],
        yw: r3(this.yaw),
        pt: r3(this.pitch),
        c: this.me.crouch,
        w: this.weapon,
        a: this.aimT > 0.5,
        g: this.me.onGround,
      });
    }
  }

  private openChat(team: boolean): void {
    input.clear();
    this.chat.open(team);
    input.gameEnabled = false;
  }

  end(): void {
    this.ended = true;
    this.aimT = 0;
    this.scoreboard.show(false);
  }

  // ------------------------------------------------------------------ rendering

  render(alpha: number, dt: number, fps: number): void {
    const s = settings.get();
    const cam = this.sm.camera;
    const def = WEAPONS[this.weapon];
    const recoilP = this.prevRecoilP + (this.recoilP - this.prevRecoilP) * alpha;
    const recoilY = this.prevRecoilY + (this.recoilY - this.prevRecoilY) * alpha;
    const aimT = this.prevAimT + (this.aimT - this.prevAimT) * alpha;

    // Mouse look (per frame for responsiveness)
    const [mdx, mdy] = input.takeMouse();
    const dazed = this.simT < this.dazedUntil;
    this.frameLookX = mdx;
    this.frameLookY = mdy;
    if (this.alive && !this.ended) {
      const zoom = 1 + (def.zoom - 1) * this.aimT;
      const sens = (this.aimT > 0.5 ? s.adsSensitivity / zoom : s.sensitivity) * (dazed ? CONCUSSED_LOOK : 1);
      this.yaw -= mdx * sens * LOOK_SCALE;
      this.pitch -= mdy * sens * LOOK_SCALE * (s.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.55, 1.55);
    }

    const rt = this.net.tickRenderClock();
    for (const r of this.remotes.values()) {
      const moved = r.interpolate(rt, dt);
      r.model.root.visible = r.hasData && r.y > -20;
      r.model.setWeapon(r.weapon);
      r.model.update(
        {
          x: r.x,
          y: r.y,
          z: r.z,
          yaw: r.yaw,
          pitch: r.pitch,
          crouch: r.crouch,
          alive: r.alive,
          protected: r.protected,
          weapon: r.weapon,
          speed: r.speed,
        },
        dt,
      );
      if (r.alive && r.onGround && !r.crouch && moved > 0) {
        r.stepAcc += moved;
        if (r.stepAcc > (r.speed > 7 ? 2.9 : 2.3)) {
          r.stepAcc = 0;
          audio.footstep({ x: r.x, y: r.y, z: r.z }, r.speed > 7 ? 1.3 : 1);
        }
      }
    }

    if (this.alive) {
      // Eye height smoothing (crouch), bob and landing dip.
      const targetEye = eyeHeight(this.me.crouch);
      this.eyeH += (targetEye - this.eyeH) * damp(14, dt);
      const px = this.prev.x + (this.me.x - this.prev.x) * alpha;
      const py = this.prev.y + (this.me.y - this.prev.y) * alpha;
      const pz = this.prev.z + (this.me.z - this.prev.z) * alpha;
      const speed = Math.hypot(this.me.vx, this.me.vz);
      const bobOn = this.me.onGround && speed > 1;
      // Capped so a slide doesn't turn the head bob into a shake.
      if (bobOn) this.bobPhase += dt * Math.min(speed, MOVE.sprint) * 1.45;
      const bobAmt = bobOn ? Math.min(1, speed / 6) * (1 - this.aimT) : 0;
      const bobY = Math.sin(this.bobPhase * 2) * 0.035 * bobAmt;
      const bobX = Math.cos(this.bobPhase) * 0.025 * bobAmt;
      this.landDip -= this.landDip * damp(9, dt);
      // Looking through the scope the view holds still: no landing dip or flinch.
      const steady = def.scoped ? 1 - aimT : 1;
      cam.position.set(px + Math.cos(this.yaw) * bobX, py + this.eyeH + bobY - this.landDip * steady, pz - Math.sin(this.yaw) * bobX);
      this.shake -= this.shake * damp(8, dt);
      const sh = this.shake * 0.02 * steady;
      const sway = dazed ? Math.sin(this.simT / 400) * CONCUSSED_SWAY : 0;
      this.roll += ((this.me.slide > 0 ? SLIDE_ROLL : 0) + sway - this.roll) * damp(10, dt);
      cam.rotation.set(
        this.pitch + recoilP + (Math.random() - 0.5) * sh,
        this.yaw + recoilY + (Math.random() - 0.5) * sh,
        this.roll,
      );
    } else {
      this.renderDeathCam(dt);
    }

    // Zoom & scope
    this.sm.zoom = 1 + (def.zoom - 1) * aimT;
    const scoped = this.alive && def.scoped === true && aimT > 0.85;
    this.hud.setScope(scoped);
    this.sm.showViewmodel = this.alive && !scoped;
    this.hud.setCrosshairVisible(this.alive && aimT < 0.5 && !this.ended);

    // Viewmodel
    const t = this.simT;
    this.viewmodel.update(dt, {
      aim: aimT,
      speed: Math.min(Math.hypot(this.me.vx, this.me.vz), MOVE.sprint),
      onGround: this.me.onGround,
      sprint: this.sprinting,
      reload: this.reloadW >= 0 ? (t - this.reloadStart) / (this.reloadUntil - this.reloadStart) : -1,
      raise: t < this.switchUntil ? 1 - (this.switchUntil - t) / SWITCH_MS : 1,
      lookDX: this.frameLookX,
      lookDY: this.frameLookY,
      crouch: this.me.crouch,
    });

    this.effects.update(dt);
    this.sm.pickups.update(t / 1000);
    this.updateLabels(dt);

    // Audio listener follows the camera.
    cam.getWorldDirection(_v1);
    audio.setListener(cam.position, _v1);

    this.updateHud(dt, fps);
  }

  private renderDeathCam(dt: number): void {
    const cam = this.sm.camera;
    const killer = this.remotes.get(this.killerId);
    const target = _v2.copy(this.deathPos);
    if (killer && killer.alive && killer.model.root.visible) target.set(killer.x, killer.y + 1.5, killer.z);
    const elapsed = (now() - this.deathAt) / 1000;
    const rise = Math.min(1, elapsed * 1.5);
    const desired = _v1.copy(this.deathPos).add(new THREE.Vector3(0, 1.2 * rise, 0));
    cam.position.lerp(desired, damp(4, dt));
    this.camLook.lerp(target, damp(5, dt));
    cam.lookAt(this.camLook);
  }

  private updateLabels(dt: number): void {
    this.labelTimer -= dt;
    if (this.labelTimer > 0) return;
    this.labelTimer = 0.15;
    const cam = this.sm.camera.position;
    for (const r of this.remotes.values()) {
      let vis = r.alive && r.model.root.visible;
      if (vis && !this.isTeammate(r.id)) {
        const hx = r.x;
        const hy = r.y + (r.crouch ? 1.2 : 1.65);
        const hz = r.z;
        const dist = Math.hypot(hx - cam.x, hy - cam.y, hz - cam.z);
        vis = dist < 60 && this.world.lineOfSight(cam.x, cam.y, cam.z, hx, hy, hz);
        if (vis) {
          // Must also be in front of the camera.
          this.sm.camera.getWorldDirection(_v1);
          vis = _v1.dot(_v2.set(hx - cam.x, hy - cam.y, hz - cam.z)) > 0;
        }
      }
      r.model.setLabelVisible(vis);
    }
  }

  private updateHud(dt: number, fps: number): void {
    const s = settings.get();
    const t = now();
    this.hud.setHealth(this.alive ? this.hp : 0);
    const reload = this.reloadW >= 0 ? (this.simT - this.reloadStart) / (this.reloadUntil - this.reloadStart) : -1;
    this.hud.setAmmo(this.weapon, this.mag[this.weapon], this.reserve[this.weapon], reload);
    this.hud.setSlots(this.allowed(), this.keySlots());
    this.hud.setEquipment(this.equip.map((w, i) => ({ key: keyLabel(s.binds[EQUIP_ACTIONS[i]][0]), name: WEAPONS[w].short, left: this.mag[w] })));
    this.hud.setProtected(this.alive && this.protected);
    const tl = this.timeLeft < 0 ? -1 : Math.max(0, this.timeLeft - (t - this.timeRecvAt));
    this.hud.setTimer(tl);

    const { arsenal, killLimit } = this.config;
    const killsText = killLimit > 0 ? `Limite: ${killLimit} kills` : 'Treino livre';
    const gunGame = arsenal === 'gungame';
    const levels = GUN_GAME_LADDER.length;
    const myLevel = this.scores.get(this.localId)?.lv ?? 0;
    const level = Math.min(myLevel + 1, levels);
    const next = GUN_GAME_LADDER[myLevel + 1];
    const goal = next === undefined ? 'mate com a faca para vencer' : `próxima: ${WEAPONS[next].name}`;
    const limit =
      gunGame
        ? `Gun Game: nível ${level} de ${levels} · ${goal}`
        : arsenal === 'all'
          ? killsText
          : `${ARSENAL_NAMES[arsenal]} · ${killsText}`;
    if (this.config.mode === 'tdm') {
      this.hud.setScore(
        { text: `VERMELHO ${this.teams[0]}`, color: TEAM_COLORS.red },
        { text: `${this.teams[1]} AZUL`, color: TEAM_COLORS.blue },
        limit,
      );
    } else {
      // Right side: best opponent (so you always see who you're racing against).
      // Gun Game is decided by level, not kills.
      const rank = (sc?: { k: number; lv: number }): number => (gunGame ? (sc?.lv ?? 0) : (sc?.k ?? 0));
      const show = (v: number): string => (gunGame ? `${Math.min(v + 1, levels)}/${levels}` : String(v));
      const mine = rank(this.scores.get(this.localId));
      let bestId = -1;
      let bestK = -Infinity;
      for (const [id, sc] of this.scores) {
        if (id === this.localId || this.infos.get(id)?.bot) continue;
        if (rank(sc) > bestK) {
          bestK = rank(sc);
          bestId = id;
        }
      }
      const label = bestId < 0 ? '' : bestK > mine ? 'LÍDER ' : '2º ';
      this.hud.setScore(
        { text: `VOCÊ ${show(mine)}`, color: this.displayColor(this.localId) },
        { text: bestId >= 0 ? `${label}${this.nameOf(bestId)} ${show(bestK)}` : '—', color: bestId >= 0 ? this.displayColor(bestId) : '#fff' },
        limit,
      );
    }

    // Crosshair spread in pixels
    const vfov = THREE.MathUtils.degToRad(this.sm.camera.fov);
    const spreadPx = (Math.tan(this.currentSpread()) / Math.tan(vfov / 2)) * (window.innerHeight / 2);
    this.hud.redrawCrosshair(clamp(spreadPx * 0.6, 0, 60));

    // Death overlay
    if (!this.alive && this.killerId >= 0 && !this.ended) {
      const left = Math.max(0, RESPAWN_MS - (t - this.deathAt)) / 1000;
      this.hud.setDeath(this.nameOf(this.killerId), this.displayColor(this.killerId), left);
    } else {
      this.hud.setDeath(null, '', 0);
    }

    this.hud.updateIndicators(dt, this.me.x, this.me.z, this.yaw);
    this.hud.updateDamageNumbers(dt, (x, y, z) => {
      const p = _v1.set(x, y, z).project(this.sm.camera);
      return p.z > 1 ? null : [((p.x + 1) / 2) * window.innerWidth, ((1 - p.y) / 2) * window.innerHeight];
    });
    this.hud.setStats(s.showFps ? fps : null, s.showPing ? (this.scores.get(this.localId)?.pg ?? 0) : null);

    // Scoreboard (hold Tab)
    const showSb = !this.ended && input.locked && input.isDown('scoreboard');
    this.scoreboard.show(showSb);
    if (showSb) {
      this.sbTimer -= dt;
      if (this.sbTimer <= 0) {
        this.sbTimer = 0.25;
        this.renderScoreboard();
      }
    } else this.sbTimer = 0;
  }

  private renderScoreboard(): void {
    const entries: ScoreEntry[] = [];
    for (const info of this.infos.values()) {
      const sc = this.scores.get(info.id) ?? { k: 0, d: 0, pg: 0, lv: 0 };
      const alive = info.id === this.localId ? this.alive : (this.remotes.get(info.id)?.alive ?? false);
      entries.push({
        id: info.id,
        name: info.name,
        color: this.displayColor(info.id),
        team: info.team,
        kills: sc.k,
        deaths: sc.d,
        ping: sc.pg,
        bot: info.bot,
        host: info.host,
        alive,
      });
    }
    const sub = this.timeLeft >= 0 ? '' : 'sem limite de tempo';
    this.scoreboard.render(this.config.mode, entries, this.localId, this.teams, sub);
  }

  /** Called by the app when the ESC menu opens/closes so stale input doesn't stick. */
  resetInputState(): void {
    if (settings.get().adsMode === 'hold') this.adsToggled = false;
  }

  get myTeam(): string {
    return this.teamOf(this.localId) ?? 'red';
  }
}
