import './style.css';
import { audio } from './core/audio';
import { input } from './core/input';
import { GameLoop } from './core/loop';
import { normalizeCode } from './core/util';
import { Game } from './game/game';
import { HostServer } from './net/host';
import { RoomBrowser } from './net/directory';
import { NetClient, joinRemote, type DisconnectReason } from './net/client';
import { describeError } from './net/peer';
import type { HostMsg, LobbyState, MatchInfo, WelcomeMsg } from './net/protocol';
import { SceneManager } from './render/scene';
import { Chat } from './ui/chat';
import { Hud } from './ui/hud';
import { Inventory } from './ui/inventory';
import { LoadoutPicker } from './ui/loadout';
import { Lobby } from './ui/lobby';
import { MainMenu } from './ui/menu';
import { PauseMenu } from './ui/pause';
import { Results } from './ui/results';
import { Scoreboard } from './ui/scoreboard';
import { SettingsUI } from './ui/settingsUI';
import { initToasts, toast } from './ui/toast';

type Screen = 'menu' | 'lobby' | 'game';

class App {
  private sm: SceneManager;
  private hud: Hud;
  private chat: Chat;
  private scoreboard: Scoreboard;
  private menu: MainMenu;
  private lobby: Lobby;
  private pause: PauseMenu;
  private results: Results;
  private settingsUI: SettingsUI;
  private roomBrowser: RoomBrowser;
  private loadout: LoadoutPicker;
  private inventory: Inventory;
  private unhookInventory: (() => void) | null = null;
  private loop: GameLoop;

  private screen: Screen = 'menu';
  private host: HostServer | null = null;
  private net: NetClient | null = null;
  private game: Game | null = null;
  private lobbyState: LobbyState | null = null;
  private busy = false;
  private idleT = 0;

  constructor() {
    const viewport = document.getElementById('viewport')!;
    const ui = document.getElementById('ui')!;
    this.sm = new SceneManager(viewport);
    input.init(viewport);
    initToasts(ui);

    this.hud = new Hud(ui);
    this.chat = new Chat(ui);
    this.scoreboard = new Scoreboard(ui);
    this.menu = new MainMenu(ui, {
      onCreate: (n, c) => void this.createRoom(n, c),
      onJoin: (n, c, code) => void this.joinRoom(n, c, code),
      onPractice: (n, c) => void this.practice(n, c),
      onSettings: () => this.settingsUI.open(),
    });
    this.lobby = new Lobby(ui, {
      onStart: () => {
        if (!this.host) return;
        this.host.startMatch();
        this.lockForMatch();
      },
      onLeave: () => this.leave(),
      onTeam: (team) => this.net?.send({ type: 'setTeam', team }),
      onColor: (color) => this.net?.send({ type: 'setColor', color }),
      onConfig: (patch) => this.host?.setConfig(patch),
      onBalance: () => this.host?.autoBalance(),
    });
    this.results = new Results(ui, {
      onRematch: () => {
        this.host?.startMatch();
        this.lockForMatch();
      },
      onLobby: () => this.host?.backToLobby(),
      onLeave: () => this.leave(),
    });
    this.pause = new PauseMenu(ui, {
      onResume: () => input.requestLock(),
      onSettings: () => {
        this.pause.show(false);
        this.settingsUI.open(() => {
          if (this.screen === 'game' && !input.locked && !this.results.visible) this.pause.show(true);
        });
      },
      onLeave: () => this.leave(),
      onTeam: (team) => {
        this.net?.send({ type: 'setTeam', team });
        input.requestLock();
      },
    });
    this.settingsUI = new SettingsUI(ui);
    this.roomBrowser = new RoomBrowser((rooms) => this.menu.setRooms(rooms));
    this.loadout = new LoadoutPicker(ui, (w, go) => {
      this.net?.send({ type: 'loadout', w, go });
      // The click on Confirmar is what lets the browser capture the mouse again.
      if (go) input.requestLock();
    });

    this.inventory = new Inventory(
      ui,
      (w) => {
        this.net?.send({ type: 'loadout', w, go: false });
        this.game?.setLoadout(w);
      },
      () => this.closeInventory(true),
    );

    this.chat.onClose = () => this.updateGameInput();
    input.onLockChange((locked) => this.onLockChange(locked));
    // Clicking the 3D view during a match re-captures the mouse.
    viewport.addEventListener('click', () => {
      audio.unlock();
      if (this.screen === 'game' && !this.results.visible) input.requestLock();
    });
    document.addEventListener('pointerdown', () => audio.unlock(), { once: true });
    // Asks before closing mid-match. Cleanup waits for pagehide so that cancelling keeps the room alive.
    window.addEventListener('beforeunload', (e) => {
      if (this.screen === 'game' && !this.results.visible) e.preventDefault();
    });
    window.addEventListener('pagehide', () => {
      this.host?.destroy();
      this.net?.close();
    });

    this.loop = new GameLoop({
      fixed: (dt) => {
        this.game?.fixed(dt);
        input.endFrame();
      },
      render: (alpha, dt) => {
        if (this.game) {
          this.game.render(alpha, dt, this.loop.fps);
          this.watchFps(dt);
        }
        else this.idleCamera(dt);
        this.sm.render();
      },
    });

    this.showScreen('menu');
    const code = normalizeCode(new URLSearchParams(location.search).get('sala') ?? '');
    if (code.length === 6) {
      this.menu.setCode(code);
      toast(`Convite para a sala ${code}: digite seu nickname e clique em "Entrar na Sala".`, 'info', 6000);
    }
    this.loop.start();

    if (this.sm.softwareRenderer()) {
      toast(
        'Seu navegador está sem aceleração de vídeo, então o jogo vai travar. Ative em Configurações do navegador → ' +
          'Sistema → "Usar aceleração gráfica quando disponível" e reinicie o navegador.',
        'error',
        15000,
      );
    }
  }

  private lowFpsTime = 0;
  private lowFpsWarned = false;

  /** Suggests lowering quality once if the match runs below 30 FPS for a while. */
  private watchFps(dt: number): void {
    if (this.lowFpsWarned || !this.game || !input.locked) return;
    const fps = this.loop.fps;
    this.lowFpsTime = fps > 0 && fps < 30 ? this.lowFpsTime + dt : 0;
    if (this.lowFpsTime > 6) {
      this.lowFpsWarned = true;
      toast(`FPS baixo (${fps}). Em Configurações → Vídeo, use qualidade Baixa, desligue sombras e reduza a escala de resolução.`, 'warn', 9000);
    }
  }

  // ------------------------------------------------------------------ screens

  private showScreen(s: Screen): void {
    this.screen = s;
    this.menu.show(s === 'menu');
    if (s === 'menu') this.roomBrowser.start();
    else this.roomBrowser.stop();
    this.lobby.show(s === 'lobby');
    if (s !== 'game') {
      this.pause.show(false);
      this.results.show(false);
      this.hud.show(false);
      this.chat.show(false);
      this.scoreboard.show(false);
    }
    this.updateGameInput();
  }

  private updateGameInput(): void {
    input.gameEnabled = this.screen === 'game' && input.locked && !this.chat.isOpen && !this.settingsUI.isOpen;
  }

  private onLockChange(locked: boolean): void {
    if (this.screen === 'game') {
      if (locked) {
        this.pause.show(false);
      } else {
        this.chat.close();
        this.game?.resetInputState();
        if (!this.results.visible && !this.settingsUI.isOpen && !this.loadout.visible && !this.inventory.visible) this.pause.show(true);
      }
    }
    this.updateGameInput();
  }

  private idleCamera(dt: number): void {
    this.idleT += dt * 0.05;
    const cam = this.sm.camera;
    cam.position.set(Math.sin(this.idleT) * 46, 24, Math.cos(this.idleT) * 46);
    cam.lookAt(0, 0, 0);
    this.sm.zoom = 1;
  }

  // ------------------------------------------------------------------ connection flows

  private async createRoom(nick: string, color: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    audio.unlock();
    this.menu.setBusy('Criando sala…');
    const host = new HostServer(false, { onStatus: (t) => toast(t, 'warn') });
    try {
      await host.start();
    } catch (e) {
      host.destroy();
      this.menu.setBusy(null);
      this.menu.setError(describeError(e));
      this.busy = false;
      return;
    }
    this.host = host;
    await this.connectLocal(host, nick, color);
    this.busy = false;
  }

  private async practice(nick: string, color: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    audio.unlock();
    const host = new HostServer(true);
    await host.start();
    this.host = host;
    const ok = await this.connectLocal(host, nick, color);
    this.busy = false;
    if (ok) {
      host.startMatch();
      this.lockForMatch();
    }
  }

  private async connectLocal(host: HostServer, nick: string, color: string): Promise<boolean> {
    const net = new NetClient(host.connectLocal(), null);
    try {
      const welcome = await net.handshake(nick, color);
      this.attach(net, welcome);
      return true;
    } catch (e) {
      net.close();
      host.destroy();
      this.host = null;
      this.menu.setBusy(null);
      this.menu.setError(e instanceof Error ? e.message : 'Falha ao criar a sala.');
      return false;
    }
  }

  private async joinRoom(nick: string, color: string, code: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    audio.unlock();
    this.menu.setBusy(`Conectando à sala ${code}…`);
    let net: NetClient | null = null;
    try {
      net = await joinRemote(code);
      const welcome = await net.handshake(nick, color);
      this.attach(net, welcome);
      history.replaceState(null, '', location.pathname);
      const joined = net;
      window.setTimeout(() => {
        void joined.route().then((r) => {
          if (r === 'relay' && this.net === joined) {
            toast('Conectado via servidor TURN (relay). A latência fica maior que numa conexão direta.', 'info', 7000);
          }
        });
      }, 3000);
    } catch (e) {
      net?.close();
      this.menu.setBusy(null);
      this.menu.setError(describeError(e));
    }
    this.busy = false;
  }

  private attach(net: NetClient, welcome: WelcomeMsg): void {
    this.net = net;
    this.lobbyState = welcome.lobby;
    net.onDisconnect = (r) => this.onHostLost(r);
    this.pause.setRoom(welcome.lobby.code, welcome.lobby.offline);
    if (welcome.match) {
      this.startGame(welcome.match);
    } else if (!welcome.lobby.offline) {
      this.showScreen('lobby');
      this.lobby.update(welcome.lobby, net.localId);
    }
    // Attach after the game exists so queued messages (spawn, snapshots) reach it.
    net.setHandler((m) => this.onHostMsg(m));
  }

  private onHostMsg(m: HostMsg): void {
    const net = this.net;
    if (!net) return;
    switch (m.type) {
      case 'lobby': {
        this.lobbyState = m.lobby;
        if (m.lobby.phase === 'lobby' && this.screen === 'game') {
          this.stopGame();
          input.exitLock();
          this.showScreen('lobby');
        }
        if (this.screen === 'lobby') this.lobby.update(m.lobby, net.localId);
        this.game?.onMessage(m);
        this.syncTeamButton();
        break;
      }
      case 'start':
        this.startGame(m.match);
        break;
      case 'pick':
        // Choosing needs the cursor.
        this.closeInventory(false);
        input.exitLock();
        this.pause.show(false);
        this.loadout.open(m.ms);
        break;
      case 'spawn':
        this.game?.onMessage(m);
        if (m.full && this.loadout.visible) {
          this.loadout.close();
          if (!input.locked) this.pause.show(true, true);
        }
        break;
      case 'end': {
        if (!this.game) break;
        this.game.end();
        this.closeInventory(false);
        input.exitLock();
        const mode = this.lobbyState?.config.mode ?? 'ffa';
        const isHost = this.lobbyState?.hostId === net.localId;
        this.pause.show(false);
        this.results.render(m, mode, net.localId, isHost, !!this.lobbyState?.offline, this.game.myTeam);
        this.results.show(true);
        const won = mode === 'tdm' ? m.winnerTeam === this.game.myTeam : m.winnerId === net.localId;
        audio.matchEnd(won);
        break;
      }
      case 'sys':
        toast(m.text, 'info');
        this.game?.onMessage(m);
        break;
      default:
        this.game?.onMessage(m);
    }
  }

  private startGame(match: MatchInfo): void {
    if (!this.net || !this.lobbyState) return;
    this.stopGame();
    this.results.show(false);
    this.chat.clearLog();
    this.game = new Game(
      { sm: this.sm, net: this.net, hud: this.hud, chat: this.chat, scoreboard: this.scoreboard },
      this.lobbyState,
      match,
    );
    this.showScreen('game');
    this.game.onInventory = (loadout) => this.openInventory(loadout);
    this.syncTeamButton();
    if (!input.locked) this.pause.show(true, true);
  }

  private openInventory(loadout: number[]): void {
    this.inventory.open(loadout);
    input.releaseMouse();
    this.unhookInventory = input.addKeyHook((code, e) => {
      if (code !== 'KeyB' && code !== 'Escape') return false;
      e.preventDefault();
      this.closeInventory(code === 'KeyB');
      return true;
    });
  }

  /** The match goes on while it's open. Esc closes it and lands on the pause menu instead of the game. */
  private closeInventory(resume: boolean): void {
    if (!this.inventory.visible) return;
    this.inventory.close();
    this.unhookInventory?.();
    this.unhookInventory = null;
    if (resume) input.requestLock();
    else if (this.screen === 'game' && !this.results.visible) this.pause.show(true);
  }

  private syncTeamButton(): void {
    const lobby = this.lobbyState;
    const me = lobby?.players.find((p) => p.id === this.net?.localId);
    this.pause.setOtherTeam(lobby?.config.mode === 'tdm' && me ? (me.team === 'red' ? 'blue' : 'red') : null);
  }

  /** With the spawn screen open the mouse stays free; confirming captures it. */
  private lockForMatch(): void {
    if (this.host?.lobbyState().config.arsenal !== 'all') input.requestLock();
  }

  private stopGame(): void {
    this.loadout.close();
    this.closeInventory(false);
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
  }

  private onHostLost(r: DisconnectReason): void {
    const wasClient = !this.host;
    this.leave();
    if (wasClient) {
      const msg = r === 'timeout' ? 'Conexão com o host perdida (tempo esgotado).' : 'Host saiu da partida.';
      this.menu.setError(msg);
      toast(msg, 'error', 5000);
    }
  }

  private leave(): void {
    this.stopGame();
    const net = this.net;
    this.net = null;
    if (net) {
      net.onDisconnect = null;
      net.close();
    }
    this.host?.destroy();
    this.host = null;
    this.lobbyState = null;
    input.exitLock();
    this.settingsUI.close();
    this.showScreen('menu');
  }
}

const app = new App();
// Debug handle for automated tests (dev server only, stripped from production builds).
if (import.meta.env.DEV) (window as unknown as { __arena: unknown }).__arena = { app, input };
