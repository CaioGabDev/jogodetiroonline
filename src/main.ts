import './style.css';
import { audio } from './core/audio';
import { input } from './core/input';
import { progress } from './core/progress';
import type { MatchStats } from './game/progression';
import { accountProgress, claimMission } from './net/progressApi';
import { missions } from './core/missions';
import { GameLoop } from './core/loop';
import { normalizeCode } from './core/util';
import { teamMode, type GameMode, type MapId } from './game/constants';
import { Game } from './game/game';
import type { PracticeSetup } from './game/practice';
import { rankOf } from './game/ranks';
import { HostServer, type MigrationSeed } from './net/host';
import { RoomBrowser } from './net/directory';
import { NetClient, joinRemote, type DisconnectReason } from './net/client';
import { account } from './net/account';
import { describeError } from './net/peer';
import { initSettingsSync } from './net/profile';
import { beginMatch, loadMyRating, submitMatch, type MatchResult } from './net/ranking';
import type { EndMsg, HostMsg, LobbyState, MatchInfo, WelcomeMsg } from './net/protocol';
import { SceneManager } from './render/scene';
import { Armory } from './ui/armory';
import { AuthScreen } from './ui/auth';
import { Chat } from './ui/chat';
import { Hud } from './ui/hud';
import { BuyMenu } from './ui/buyMenu';
import { Inventory } from './ui/inventory';
import { LoadoutPicker } from './ui/loadout';
import { Lobby } from './ui/lobby';
import { MainMenu } from './ui/menu';
import { PauseMenu } from './ui/pause';
import { ProfileScreen } from './ui/profile';
import { RankingScreen } from './ui/ranking';
import { MissionsScreen } from './ui/missions';
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
  private armory: Armory;
  private auth: AuthScreen;
  private profile: ProfileScreen;
  private ranking: RankingScreen;
  private missions: MissionsScreen;
  private roomBrowser: RoomBrowser;
  private loadout: LoadoutPicker;
  private inventory: Inventory;
  private buyMenu: BuyMenu;
  private unhookInventory: (() => void) | null = null;
  private loop: GameLoop;

  private screen: Screen = 'menu';
  private host: HostServer | null = null;
  private net: NetClient | null = null;
  private game: Game | null = null;
  private lobbyState: LobbyState | null = null;
  private busy = false;
  /** The match on screen already paid its reward. */
  private rewarded = false;
  /** This match was opened on the ranking and still has to be reported. */
  private ranked = false;
  /** Last known rating of the logged-in player. */
  private rating: number | null = null;
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
      onPractice: (n, c, map, setup) => void this.practice(n, c, map, setup),
      onSettings: () => this.settingsUI.open(),
      onArmory: () => this.armory.open(),
      onLogin: () => this.auth.open(),
      onLogout: () => void account.signOut(),
      onProfile: () => this.profile.open(),
      onRanking: () => this.ranking.open(),
      onMissions: () => this.missions.open(),
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
      onVote: (i) => this.net?.send({ type: 'vote', i }),
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
    this.armory = new Armory(ui);
    this.auth = new AuthScreen(ui);
    account.onRecovery(() => this.auth.openReset());
    this.profile = new ProfileScreen(ui);
    this.ranking = new RankingScreen(ui);
    this.missions = new MissionsScreen(ui);
    missions.onChange(() => this.menu.setMissionsReady(missions.ready));
    this.menu.setMissionsReady(missions.ready);
    account.onChange(() => {
      void progress.useBackend(account.profile ? accountProgress : null);
      missions.use(account.profile?.id ?? null, account.profile ? claimMission : null);
      this.menu.setAccount(account.profile, account.available);
      void this.refreshRating();
    });
    this.menu.setAccount(null, account.available);
    initSettingsSync();
    account.init();
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

    this.buyMenu = new BuyMenu(
      ui,
      (item) => this.net?.send({ type: 'buy', item }),
      () => this.closeBuyMenu(true),
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
    const last = lastRoom();
    if (code.length === 6) {
      this.menu.setCode(code);
      toast(`Convite para a sala ${code}: digite seu nickname e clique em "Entrar na Sala".`, 'info', 6000);
    } else if (last) {
      // Reloaded the page in the middle of a match: the code is there, and the score comes back on joining.
      this.menu.setCode(last);
      toast(`Você estava na sala ${last}. Clique em "Entrar" para voltar com o seu placar.`, 'info', 8000);
    }
    this.loop.start();
    // Closing or reloading the tab mid-match keeps the room on offer for a quick way back.
    window.addEventListener('pagehide', () => {
      if (this.net && this.lobbyState && !this.lobbyState.offline) rememberRoom(this.lobbyState.code);
    });

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
        if (!this.results.visible && !this.settingsUI.isOpen && !this.loadout.visible && !this.inventory.visible && !this.buyMenu.visible) this.pause.show(true);
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

  /** What the others see of this player's progress, and the id that brings their score back on a reconnect. */
  private helloProfile(): { skin: string; knife: string; lv: number; rid: string } {
    return { skin: progress.equipped, knife: progress.equippedKnife, lv: progress.level, rid: rejoinId() };
  }

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

  private async practice(nick: string, color: string, map: MapId, setup: PracticeSetup): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    audio.unlock();
    const host = new HostServer(true, {}, map, setup);
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
      const welcome = await net.handshake(nick, color, this.helloProfile());
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
      const welcome = await net.handshake(nick, color, this.helloProfile());
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
    if (!welcome.lobby.offline) rememberRoom(welcome.lobby.code);
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
        this.loadout.open(m.ms, this.lobbyState?.config.grenades !== false);
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
        this.closeBuyMenu(false);
        input.exitLock();
        const mode = this.lobbyState?.config.mode ?? 'ffa';
        const isHost = this.lobbyState?.hostId === net.localId;
        this.pause.show(false);
        const won = teamMode(mode) ? m.winnerTeam === this.game.myTeam : m.winnerId === net.localId;
        this.results.render(m, mode, net.localId, isHost, !!this.lobbyState?.offline, this.game.myTeam);
        this.results.show(true);
        audio.matchEnd(won);
        this.reportMatch(m, net.localId, won);
        break;
      }
      case 'sys':
        toast(m.text, 'info');
        this.game?.onMessage(m);
        break;
      case 'kill':
        this.countKill(m.k, m.v, m.hs, net.localId);
        this.game?.onMessage(m);
        break;
      case 'vote':
        this.results.setVote(m);
        break;
      case 'drill':
        if (m.mode === 'mira' && this.lobbyState?.offline) missions.record('aimRun');
        break;
      case 'kit':
      case 'round':
      case 'score':
        this.game?.onMessage(m);
        if (this.buyMenu.visible && this.game) {
          if (this.game.canBuy()) this.buyMenu.update(this.game.buyState());
          else this.closeBuyMenu(true);
        }
        break;
      default:
        this.game?.onMessage(m);
    }
  }

  private startGame(match: MatchInfo): void {
    if (!this.net || !this.lobbyState) return;
    this.stopGame();
    this.rewarded = false;
    this.results.show(false);
    this.chat.clearLog();
    this.game = new Game(
      { sm: this.sm, net: this.net, hud: this.hud, chat: this.chat, scoreboard: this.scoreboard },
      this.lobbyState,
      match,
    );
    this.showScreen('game');
    this.ranked = account.profile !== null && !this.lobbyState.offline;
    if (this.ranked) void beginMatch();
    this.game.onInventory = (loadout) => this.openInventory(loadout);
    this.game.onBuyMenu = () => this.openBuyMenu();
    this.syncTeamButton();
    if (!input.locked) this.pause.show(true, true);
  }

  /**
   * Pays the match once. Practice targets and empty rooms don't count: XP, coins and rating need another human.
   * With an account the database validates the match and pays it; a guest is paid in this browser.
   */
  /** Kills for the missions: targets in practice, players online. */
  private countKill(killer: number, victim: number, hs: boolean, localId: number): void {
    if (killer !== localId || victim === localId || !this.lobbyState) return;
    if (this.lobbyState.offline) {
      missions.record('practiceKill');
      if (hs) missions.record('practiceHeadshot');
    } else {
      missions.record('kill');
      if (hs) missions.record('headshot');
    }
  }

  private reportMatch(m: EndMsg, localId: number, won: boolean): void {
    const lobby = this.lobbyState;
    const row = m.results.find((r) => r.id === localId);
    const ranked = this.ranked;
    this.ranked = false;
    if (!lobby || !row || this.rewarded) return;
    this.rewarded = true;
    if (lobby.offline) return this.results.setRewards(null, 'Treino offline não dá XP nem moedas.');
    missions.addHistory({
      t: Date.now(),
      map: lobby.config.map,
      mode: lobby.config.arsenal === 'gungame' ? 'gungame' : lobby.config.mode,
      kills: row.kills,
      deaths: row.deaths,
      headshots: row.headshots,
      damage: row.damage,
      won,
      mvp: m.mvp === localId,
    });
    if (lobby.players.filter((p) => !p.bot).length < 2) {
      return this.results.setRewards(null, 'Só partidas com outro jogador dão XP e moedas.');
    }
    missions.record('match');
    if (won) missions.record('win');
    const stats: MatchStats = { kills: row.kills, deaths: row.deaths, headshots: row.headshots, damage: row.damage, won, mvp: m.mvp === localId, shots: row.shots, hits: row.hits, headHits: row.headHits };
    if (!account.profile) {
      const note = account.available ? 'Entre numa conta para guardar o progresso e aparecer no ranking.' : '';
      return this.results.setRewards(progress.addMatch(stats), note);
    }
    if (!ranked) return this.results.setRewards(null, 'Você entrou na conta durante a partida: ela não conta.');

    this.results.setRewards(null, 'Calculando as recompensas…');
    const mode = lobby.config.arsenal === 'gungame' ? 'gungame' : lobby.config.mode;
    const result = matchResult(m, localId, lobby.config.mode);
    void submitMatch({ ...stats, mode, result })
      .catch(() => null)
      .then((pay) => {
        if (!pay) {
          this.results.setRewards(null, 'Esta partida não contou: curta demais (menos de 30 s) ou com números impossíveis.');
          return;
        }
        this.results.setRewards(progress.applyServerMatch(stats, pay), '');
        this.showRating(pay.rating);
      });
  }

  private showRating(rating: number | null): void {
    if (rating === null) {
      toast('Esta partida não entrou no ranking.', 'warn');
      return;
    }
    const before = this.rating ?? 0;
    const rank = rankOf(rating);
    const delta = rating - before;
    const promoted = delta > 0 && rankOf(before).label !== rank.label;
    toast(promoted ? `Subiu para ${rank.label}! (+${delta})` : `${delta >= 0 ? '+' : ''}${delta} pontos · ${rank.label}`, delta >= 0 ? 'ok' : 'warn', 6000);
    this.rating = rating;
    this.menu.setRating(rating);
  }

  private async refreshRating(): Promise<void> {
    this.rating = await loadMyRating().catch(() => null);
    this.menu.setRating(this.rating);
  }

  private openInventory(loadout: number[]): void {
    this.inventory.open(loadout, this.lobbyState?.config.grenades !== false);
    input.releaseMouse();
    this.unhookInventory = input.addKeyHook((code, e) => {
      if (code !== 'KeyB' && code !== 'Escape') return false;
      e.preventDefault();
      this.closeInventory(code === 'KeyB');
      return true;
    });
  }

  private openBuyMenu(): void {
    if (!this.game) return;
    this.buyMenu.open(this.game.buyState());
    input.releaseMouse();
    this.unhookInventory = input.addKeyHook((code, e) => {
      if (code !== 'KeyB' && code !== 'Escape') return false;
      e.preventDefault();
      this.closeBuyMenu(code === 'KeyB');
      return true;
    });
  }

  private closeBuyMenu(resume: boolean): void {
    if (!this.buyMenu.visible) return;
    this.buyMenu.close();
    this.unhookInventory?.();
    this.unhookInventory = null;
    if (resume) input.requestLock();
    else if (this.screen === 'game' && !this.results.visible) this.pause.show(true);
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
    this.closeBuyMenu(false);
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
  }

  private onHostLost(r: DisconnectReason): void {
    const wasClient = !this.host;
    const lobby = this.lobbyState;
    const nick = lobby?.players.find((p) => p.id === this.net?.localId);
    const scores = this.game?.scoreSnapshot() ?? null;
    const localId = this.net?.localId ?? -1;
    this.leave();
    if (!wasClient || !lobby || lobby.offline || !nick) return;
    void this.recover(r, lobby, localId, nick.name, nick.color, scores);
  }

  /**
   * After losing the host: the player with the lowest id left takes over the same room code with everyone's
   * score, and the others reconnect to it. If the host only dropped for a moment, they reconnect to it instead.
   */
  private async recover(r: DisconnectReason, lobby: LobbyState, localId: number, nick: string, color: string, scores: ReturnType<Game['scoreSnapshot']> | null): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const successor = lobby.players.filter((p) => !p.bot && p.id !== lobby.hostId).reduce((a, p) => (p.id < a ? p.id : a), Infinity);
    const mine = successor === localId;
    const why = r === 'timeout' ? 'Conexão com o host perdida.' : 'O host saiu.';
    toast(mine ? `${why} Você vai assumir a sala…` : `${why} Reconectando…`, 'warn', 5000);
    let ok = false;
    for (let attempt = 1; attempt <= 12 && !ok && !this.net; attempt++) {
      this.menu.setBusy(mine ? `Assumindo a sala ${lobby.code}… (${attempt}/12)` : `Reconectando à sala ${lobby.code}… (${attempt}/12)`);
      // The successor first gives the old host a moment to come back; the others give the successor time to take over.
      await new Promise((res) => window.setTimeout(res, attempt === 1 ? (mine ? 2500 : 4000) : 2500));
      ok = mine ? await this.takeOver(lobby, nick, color, scores) : await this.rejoin(lobby.code, nick, color);
      // Someone else holds the code (the old host came back): join it instead.
      if (!ok && mine && attempt >= 3) ok = await this.rejoin(lobby.code, nick, color);
    }
    this.busy = false;
    if (ok) {
      toast(mine ? 'Você é o novo host. A partida continua!' : 'Reconectado!', 'ok', 4000);
      return;
    }
    this.menu.setBusy(null);
    const msg = 'Não deu para voltar para a sala.';
    this.menu.setError(msg);
    toast(msg, 'error', 5000);
  }

  private async rejoin(code: string, nick: string, color: string): Promise<boolean> {
    let net: NetClient | null = null;
    try {
      net = await joinRemote(code);
      const welcome = await net.handshake(nick, color, this.helloProfile());
      this.menu.setBusy(null);
      this.attach(net, welcome);
      if (welcome.match) this.lockForMatch();
      return true;
    } catch {
      net?.close();
      return false;
    }
  }

  /** Opens the old room's code as its host, with its settings and everyone's score. */
  private async takeOver(lobby: LobbyState, nick: string, color: string, scores: ReturnType<Game['scoreSnapshot']> | null): Promise<boolean> {
    const host = new HostServer(false, { onStatus: (t) => toast(t, 'warn') });
    // Bomb rounds can't be rebuilt: that match goes back to the lobby.
    const playing = lobby.phase === 'playing' && lobby.config.mode !== 'bomb';
    const seed: MigrationSeed = {
      config: lobby.config,
      playing,
      teams: scores?.teams ?? [0, 0],
      stash: lobby.players
        .filter((p) => !p.bot && p.rid)
        .map((p) => {
          const sc = scores?.rows.get(p.id);
          return [p.rid, { team: p.team, kills: sc?.k ?? 0, deaths: sc?.d ?? 0, damage: 0, headshots: 0, shots: 0, hits: 0, headHits: 0, level: sc?.lv ?? 0, at: 0 }];
        }),
    };
    host.adopt(seed);
    try {
      await host.start(lobby.code);
    } catch {
      host.destroy();
      return false;
    }
    this.host = host;
    // The match goes on before anyone arrives, so each player's score is restored as they come in.
    if (playing) host.startMatch();
    this.menu.setBusy(null);
    const ok = await this.connectLocal(host, nick, color);
    if (ok && playing) this.lockForMatch();
    return ok;
  }

  private leave(): void {
    forgetRoom();
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

/** In a free-for-all the top half of the table wins, so a good match still pays when someone else came first. */
function matchResult(m: EndMsg, localId: number, mode: GameMode): MatchResult {
  if (teamMode(mode)) {
    if (m.winnerTeam === null) return 'draw';
    return m.results.find((r) => r.id === localId)?.team === m.winnerTeam ? 'win' : 'loss';
  }
  const place = m.results.findIndex((r) => r.id === localId) + 1;
  const middle = (m.results.length + 1) / 2;
  return place < middle ? 'win' : place === middle ? 'draw' : 'loss';
}

const LAST_ROOM = 'arenafps.lastroom';

/** The room this tab is in, so a reload can offer to go back. */
function rememberRoom(code: string): void {
  try {
    sessionStorage.setItem(LAST_ROOM, JSON.stringify({ code, at: Date.now() }));
  } catch {
    /* storage unavailable */
  }
}

function forgetRoom(): void {
  try {
    sessionStorage.removeItem(LAST_ROOM);
  } catch {
    /* storage unavailable */
  }
}

/** Code of the room this tab was in during the last 2 minutes, or null. */
function lastRoom(): string | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(LAST_ROOM) ?? 'null') as { code?: unknown; at?: unknown } | null;
    return r && typeof r.code === 'string' && typeof r.at === 'number' && Date.now() - r.at < 120000 ? r.code : null;
  } catch {
    return null;
  }
}

/** This tab's id in rooms, kept across reconnects and reloads so the host can give the score back. */
function rejoinId(): string {
  try {
    let id = sessionStorage.getItem('arenafps.rid');
    if (!id || !/^[a-z0-9]{8,24}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
      sessionStorage.setItem('arenafps.rid', id);
    }
    return id;
  } catch {
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
  }
}

const app = new App();
// Debug handle for automated tests (dev server only, stripped from production builds).
if (import.meta.env.DEV) (window as unknown as { __arena: unknown }).__arena = { app, input };
