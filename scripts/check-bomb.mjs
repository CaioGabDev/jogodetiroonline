// Bomb mode check: `npm run check`. Plays rounds on the real host, with four players and a fake clock.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// All the host needs from a browser.
globalThis.window = { setTimeout, clearTimeout, setInterval, clearInterval };

// The players connect in memory, so the WebRTC library is never used.
const noPeerjs = {
  name: 'no-peerjs',
  enforce: 'pre',
  resolveId: (id) => (id === 'peerjs' ? '\0peerjs' : null),
  load: (id) => (id === '\0peerjs' ? 'export class Peer {}' : null),
};
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  plugins: [noPeerjs],
  ssr: { noExternal: ['peerjs'] },
});
const { HostServer } = await vite.ssrLoadModule('/src/net/host.ts');
const { PROTOCOL_VERSION, MAX_HP, DEFAULT_CONFIG } = await vite.ssrLoadModule('/src/game/constants.ts');
const { ITEM, ROUND, SHOP, SHOP_MENU, gunHit, lossBonus } = await vite.ssrLoadModule('/src/game/bomb.ts');
const { W, WEAPONS } = await vite.ssrLoadModule('/src/game/weapons.ts');
await vite.close();

let clock = 1000;
performance.now = () => clock;

// Damage: what makes the mode play the way it should.
{
  const shots = (w, armor, helmet, head = false, dist = 10) => Math.ceil(MAX_HP / gunHit(WEAPONS[w], dist, head, armor, helmet).hp);
  assert.equal(shots(W.RIFLE, 0, false), 4, 'rifle, body');
  assert.equal(shots(W.RIFLE, 100, true), 4, 'rifle, body through armor');
  assert.equal(shots(W.RIFLE, 100, true, true), 1, 'a rifle headshot beats a helmet');
  assert.equal(shots(W.PISTOL, 0, false, true), 1, 'pistol headshot, no helmet');
  assert.equal(shots(W.PISTOL, 100, true, true), 2, 'pistol headshot, helmet');
  assert.equal(shots(W.PISTOL, 100, false, true), 1, 'a vest does nothing for the head');
  assert.equal(shots(W.SNIPER, 100, true), 1, 'sniper, body through armor');
  assert.equal(shots(W.KNIFE, 0, false), 2, 'the knife takes two');
  assert.ok(gunHit(WEAPONS[W.RIFLE], 10, false, 100, true).armor > 0, 'armor wears');
  assert.equal(gunHit(WEAPONS[W.RIFLE], 10, false, 0, false).armor, 0);
  assert.equal(lossBonus(1), 1400);
  assert.equal(lossBonus(5), 3400);
  assert.equal(lossBonus(9), 3400);
  // Everything in the menu has a price.
  for (const { items } of SHOP_MENU) for (const item of items) assert.ok(SHOP[item]?.price > 0, `sem preço: ${item}`);
  assert.equal(SHOP[W.LAUNCHER], undefined, 'explosive launcher stays out of the shop');
}

const flush = () => new Promise((r) => setImmediate(r));

function join(host, name) {
  const conn = host.connectLocal();
  const c = { conn, id: 0, got: [] };
  conn.onMessage = (m) => {
    c.got.push(m);
    if (m.type === 'welcome') c.id = m.id;
  };
  conn.send({ type: 'hello', name, color: '#f94144', v: PROTOCOL_VERSION });
  return c;
}

/** A match with two against two: a and c on red, b and d on blue. */
async function match(rounds = 7, map = 'usina') {
  const host = new HostServer(false);
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((n) => join(host, n));
  await flush();
  await flush();
  host.setConfig({ mode: 'bomb', map, rounds });
  host.startMatch();
  await flush();
  const pl = (x) => host.players.get(x.id);
  const advance = async (ms) => {
    for (let t = 0; t < ms; t += 50) {
      clock += 50;
      host.tick();
      await flush();
    }
  };
  const unfreeze = () => advance(ROUND.freezeMs + 100);
  const carrierOf = () => [a, c].find((x) => host.round.carrier === pl(x));
  const killSide = (team) => {
    const killer = [...host.players.values()].find((p) => p.info.team !== team);
    for (const p of [...host.players.values()]) if (p.info.team === team && p.alive) host.kill(killer, p, W.RIFLE, false);
  };
  return { host, a, b, c, d, pl, advance, unfreeze, carrierOf, killSide };
}

const buy = async (x, item) => {
  x.conn.send({ type: 'buy', item });
  await flush();
};
const site = (host, i = 0) => {
  const [x0, z0, x1, z1] = host.map.bomb.sites[i].rect;
  return [(x0 + x1) / 2, (z0 + z1) / 2];
};
const putOn = (p, x, z, y = 0) => Object.assign(p, { x, y, z, onGround: true });

// Start of a match.
{
  const { host, a, b, c, pl, advance, unfreeze, carrierOf } = await match();
  assert.equal(host.round.phase, 'freeze');
  assert.equal(host.round.attackers, 'red');
  assert.ok(carrierOf(), 'an attacker has the bomb');
  for (const p of host.players.values()) {
    assert.equal(p.money, ROUND.startMoney);
    assert.deepEqual(p.loadout, [W.PISTOL]);
    assert.equal(p.mag[W.FRAG], 0, 'no free grenades');
    assert.ok(host.map.bomb.buy[p.info.team === 'red' ? 'attack' : 'defend']);
  }

  // Buying: pays, respects the money, the zone, the side and the time.
  await buy(a, W.RIFLE);
  assert.deepEqual(pl(a).loadout, [W.PISTOL], 'not enough money');
  await buy(a, ITEM.KEVLAR);
  assert.equal(pl(a).armor, 100);
  assert.equal(pl(a).money, 150);
  pl(a).money = 1000;
  await buy(a, ITEM.KIT);
  assert.equal(pl(a).defuseKit, false, 'attackers have no use for a kit');
  assert.equal(pl(a).money, 1000);
  await buy(b, ITEM.KIT);
  assert.equal(pl(b).defuseKit, true);
  await buy(b, W.KNIFE);
  await buy(b, W.BOMB);
  await buy(b, W.THROWING_KNIFE);
  await buy(b, W.LAUNCHER);
  assert.equal(pl(b).money, 400, 'what is not for sale costs nothing');
  await buy(b, W.FLASHBANG);
  await buy(b, W.FLASHBANG);
  await buy(b, W.FLASHBANG);
  assert.equal(pl(b).mag[W.FLASHBANG], 2, 'two flashbangs at most');
  assert.equal(pl(b).money, 0);
  pl(c).money = 16000;
  putOn(pl(c), 0, 0);
  await buy(c, W.RIFLE);
  assert.deepEqual(pl(c).loadout, [W.PISTOL], 'outside the buy zone');
  putOn(pl(c), 0, 47);
  await buy(c, W.RIFLE);
  assert.deepEqual(pl(c).loadout, [W.RIFLE, W.PISTOL]);
  await buy(c, W.SMG);
  assert.deepEqual(pl(c).loadout, [W.SMG, W.PISTOL], 'one primary at a time');
  await buy(c, W.FLASHBANG);
  await buy(c, W.SMOKE);
  await buy(c, W.FRAG);
  await buy(c, W.MOLOTOV);
  await buy(c, W.CONCUSSION);
  assert.equal(pl(c).equip.reduce((n, w) => n + pl(c).mag[w], 0), 4, 'four grenades at most');

  // The freeze holds everyone.
  const shots = pl(c).mag[W.SMG];
  c.conn.send({ type: 'shoot', s: 1, w: W.SMG, o: [pl(c).x, 1.65, pl(c).z], d: [0, 0, -1], rt: 0 });
  await flush();
  assert.equal(pl(c).mag[W.SMG], shots, 'no shots during the freeze');
  await unfreeze();
  assert.equal(host.round.phase, 'live');
  assert.equal(Math.round(host.round.endsAt - clock), ROUND.roundMs - 100, 'the clock starts after the freeze');
  await advance(ROUND.buyMs);
  pl(a).money = 16000;
  putOn(pl(a), 0, 47);
  await buy(a, W.RIFLE);
  assert.deepEqual(pl(a).loadout, [W.PISTOL], 'buy time is over');

  // Time runs out: defenders win, and attackers still alive get nothing.
  pl(a).money = 1000;
  pl(c).money = 1000;
  pl(b).money = 0;
  await advance(ROUND.roundMs - ROUND.buyMs);
  assert.equal(host.round.why, 'time');
  assert.equal(host.round.winner, 'blue');
  assert.equal(pl(b).money, ROUND.winElimination);
  assert.equal(pl(a).money, 1000, 'no pay for hiding');

  // Survivors keep what they carry.
  const smg = pl(c).loadout[0];
  const armor = pl(a).armor;
  await advance(ROUND.overMs + 100);
  assert.equal(host.round.n, 2);
  assert.equal(pl(c).loadout[0], smg);
  assert.equal(pl(a).armor, armor);
  host.destroy();
}

// Kills: pay by weapon, nothing regenerates, nobody comes back, and the bomb falls with its carrier.
{
  const { host, a, b, c, d, pl, advance, unfreeze, carrierOf, killSide } = await match();
  await unfreeze();
  const carrier = carrierOf();
  const mate = carrier === a ? c : a;
  pl(b).money = 0;
  pl(b).hp = 40;
  pl(b).lastHurtAt = clock;
  await advance(8000);
  assert.equal(pl(b).hp, 40, 'no health regeneration');
  putOn(pl(carrier), 5, 20);
  host.kill(pl(b), pl(carrier), W.SMG, false);
  assert.equal(pl(b).money, 600, 'SMG pays double');
  assert.equal(host.round.carrier, null);
  assert.deepEqual(host.round.spot.slice(0, 1), [5]);
  await advance(4000);
  assert.equal(pl(carrier).alive, false, 'no respawn inside a round');

  // Defenders can't take it; an attacker picks it up by walking over it.
  putOn(pl(d), 5, 20);
  await advance(100);
  assert.equal(host.round.carrier, null);
  putOn(pl(mate), 5, 20);
  await advance(100);
  assert.equal(host.round.carrier, pl(mate));

  // A team kill fines, and doesn't score.
  pl(d).money = 1000;
  const before = pl(d).kills;
  host.kill(pl(d), pl(b), W.RIFLE, false);
  assert.equal(pl(d).money, 700);
  assert.equal(pl(d).kills, before - 1);
  assert.deepEqual(host.teamScore, [0, 0]);

  // Last attacker down, no bomb planted: defenders win.
  killSide('red');
  assert.equal(host.round.why, 'elimination');
  assert.equal(host.round.winner, 'blue');
  host.destroy();
}

// Planting: only on a site, standing still, for the whole time.
{
  const { host, a, c, b, d, pl, advance, unfreeze, carrierOf } = await match();
  await unfreeze();
  const p = pl(carrierOf());
  const [sx, sz] = site(host);
  putOn(p, 0, 0);
  p.using = true;
  await advance(ROUND.plantMs + 200);
  assert.equal(host.round.planted, false, 'off site');
  putOn(p, sx, sz);
  await advance(ROUND.plantMs - 500);
  assert.equal(host.round.planted, false, 'still planting');
  p.using = false;
  await advance(100);
  assert.equal(host.round.worker, null, 'letting go cancels');
  p.using = true;
  await advance(1000);
  putOn(p, sx + 2, sz);
  await advance(ROUND.plantMs - 400);
  assert.equal(host.round.planted, false, 'moving restarts it');
  await advance(800);
  assert.equal(host.round.planted, true);
  assert.equal(p.money, ROUND.startMoney + ROUND.objectiveBonus);
  p.using = false;

  // With the bomb down, the clock is the bomb's: losing the attackers doesn't end the round.
  await advance(1000);
  for (const x of [a, c]) if (pl(x).alive) host.kill(pl(b), pl(x), W.RIFLE, false);
  assert.equal(host.round.phase, 'live', 'dead attackers leave the bomb ticking');

  // Defuse: no kit takes 10 s, and letting go restarts it.
  const defuser = pl(b);
  putOn(defuser, sx + 1, sz);
  defuser.using = true;
  await advance(ROUND.defuseMs - 2000);
  defuser.using = false;
  await advance(100);
  defuser.using = true;
  await advance(ROUND.defuseMs - 2000);
  assert.equal(host.round.phase, 'live', 'restarted');
  await advance(2300);
  assert.equal(host.round.why, 'defused');
  assert.equal(host.round.winner, 'blue');
  const mate = [a, c].map(pl).find((x) => x !== p);
  assert.equal(mate.money, ROUND.startMoney + lossBonus(1) + ROUND.plantedLossBonus, 'a planted bomb pays the losers more');
  assert.ok(pl(d).money >= ROUND.winObjective);
  host.destroy();
}

// Explosion: 40 s after planting, attackers win, and it reaches far enough to matter.
{
  const { host, b, d, pl, advance, unfreeze, carrierOf } = await match();
  await buy(b, ITEM.KEVLAR);
  await unfreeze();
  const p = pl(carrierOf());
  const [sx, sz] = site(host, 1);
  putOn(p, sx, sz);
  p.using = true;
  await advance(ROUND.plantMs + 200);
  p.using = false;
  assert.equal(host.round.planted, true);
  putOn(p, 0, 47);
  putOn(pl(b), sx + 3, sz);
  putOn(pl(d), sx, 45);
  await advance(ROUND.bombMs - 500);
  assert.equal(host.round.phase, 'live', 'not yet');
  pl(d).money = 0;
  await advance(800);
  assert.equal(host.round.why, 'exploded');
  assert.equal(host.round.winner, 'red');
  assert.equal(pl(b).alive, false, 'next to the bomb');
  assert.equal(pl(d).alive, true, 'far from the bomb');
  assert.equal(pl(d).money, lossBonus(1));
  assert.ok(p.money >= ROUND.winObjective);
  host.destroy();
}

// With a kit the defuse takes half the time.
{
  const { host, b, pl, advance, unfreeze, carrierOf } = await match();
  await buy(b, ITEM.KIT);
  await unfreeze();
  const p = pl(carrierOf());
  const [sx, sz] = site(host);
  putOn(p, sx, sz);
  p.using = true;
  await advance(ROUND.plantMs + 200);
  p.using = false;
  putOn(pl(b), sx, sz + 1);
  pl(b).using = true;
  await advance(ROUND.defuseKitMs + 200);
  assert.equal(host.round.why, 'defused');
  host.destroy();
}

// Economy over rounds, the swap at the half, and the end of the match.
{
  const { host, a, b, pl, advance, unfreeze, killSide } = await match();
  const nextRound = () => advance(ROUND.overMs + 100);
  // Red loses three in a row: the bonus grows, and a win steps it back.
  for (const pay of [1400, 1900, 2400]) {
    await unfreeze();
    const before = pl(a).money;
    killSide('red');
    assert.equal(pl(a).money - before, pay, `loss bonus ${pay}`);
    await nextRound();
  }
  await unfreeze();
  killSide('blue');
  assert.equal(host.round.lossStreak.red, 2, 'a win takes one step back');
  await nextRound();
  await unfreeze();
  const before = pl(a).money;
  killSide('red');
  assert.equal(pl(a).money - before, 2400);
  await nextRound();

  // Round 6 of a match to 7 is the last before the half.
  await buy(a, ITEM.KEVLAR);
  await unfreeze();
  assert.equal(host.round.n, 6);
  killSide('blue');
  await nextRound();
  assert.equal(host.round.n, 7);
  assert.equal(host.round.attackers, 'blue', 'sides swap');
  assert.equal(pl(a).money, ROUND.startMoney);
  assert.deepEqual(pl(a).loadout, [W.PISTOL]);
  assert.equal(pl(a).armor, 0);
  assert.deepEqual(host.teamScore, [2, 4], 'the score stays with the teams');
  assert.ok(host.teamScore[0] + host.teamScore[1] === 6);

  // Blue takes the three it needs.
  for (let i = 0; i < 3; i++) {
    await unfreeze();
    killSide('red');
    await nextRound();
  }
  assert.equal(host.phase, 'ended');
  const end = b.got.find((m) => m.type === 'end');
  assert.equal(end.winnerTeam, 'blue');
  host.destroy();
}

// A tie at the end of both halves is a draw, and money never passes the cap.
{
  const { host, b, pl, advance, unfreeze, killSide } = await match();
  pl(b).money = ROUND.maxMoney - 100;
  for (let i = 0; i < 12; i++) {
    await unfreeze();
    // Team sides swap after six: three wins each per half gives 6 x 6.
    killSide(i % 2 ? 'red' : 'blue');
    await advance(ROUND.overMs + 100);
    if (i === 0) assert.equal(pl(b).money, ROUND.maxMoney, 'money cap');
  }
  assert.equal(host.phase, 'ended');
  assert.deepEqual(host.teamScore, [6, 6]);
  assert.equal(b.got.find((m) => m.type === 'end').winnerTeam, null);
  host.destroy();
}

// Weapons on the ground.
{
  const { host, a, b, c, d, pl, advance, unfreeze } = await match();
  for (const x of [a, c]) pl(x).money = 16000;
  await buy(a, W.RIFLE);
  await buy(c, W.SMG);
  await unfreeze();
  Object.assign(pl(a).mag, { [W.RIFLE]: 7 });
  Object.assign(pl(a).reserve, { [W.RIFLE]: 20 });
  putOn(pl(a), 10, 23);
  host.kill(pl(b), pl(a), W.RIFLE, false);
  assert.deepEqual(host.drops.map((x) => x.w), [W.RIFLE], 'the primary falls');
  assert.deepEqual(pl(a).loadout, [W.PISTOL]);
  await flush();
  assert.ok(b.got.some((m) => m.type === 'drops' && m.list.length === 1), 'everyone hears about it');

  // No primary: walking over it is enough, and it keeps its ammo. Either side can take it.
  putOn(pl(d), 10, 23);
  await advance(100);
  assert.deepEqual(pl(d).loadout, [W.RIFLE, W.PISTOL]);
  assert.equal(pl(d).mag[W.RIFLE], 7);
  assert.equal(pl(d).reserve[W.RIFLE], 20);
  assert.equal(host.drops.length, 0);

  // With a primary it takes a press, and swaps. Holding the key doesn't swap back and forth.
  putOn(pl(c), 10, 23);
  host.kill(pl(b), pl(c), W.SMG, false);
  await advance(200);
  assert.deepEqual(pl(d).loadout, [W.RIFLE, W.PISTOL], 'no swap without asking');
  pl(d).using = true;
  await advance(500);
  assert.deepEqual(pl(d).loadout, [W.SMG, W.PISTOL]);
  assert.deepEqual(host.drops.map((x) => x.w), [W.RIFLE], 'the old one stays there');
  assert.equal(host.drops[0].mag, 7);
  pl(d).using = false;
  await advance(100);
  pl(d).using = true;
  await advance(100);
  assert.deepEqual(pl(d).loadout, [W.RIFLE, W.PISTOL], 'a new press swaps back');
  pl(d).using = false;

  // Pistols fall when there is no primary, and swap the same way.
  pl(b).loadout = [W.DEAGLE];
  putOn(pl(b), 10, 22);
  host.kill(pl(d), pl(b), W.RIFLE, false);
  assert.ok(host.drops.some((x) => x.w === W.DEAGLE));
  pl(d).using = true;
  await advance(100);
  assert.deepEqual(pl(d).loadout.length, 2);
  pl(d).using = false;

  // The next round starts with a clean floor.
  await advance(ROUND.overMs + 200);
  assert.equal(host.round.n, 2);
  assert.equal(host.drops.length, 0);
  assert.ok(a.got.some((m) => m.type === 'drops' && m.list.length === 0));
  host.destroy();
}

// The bomb comes first: on a site, the use key plants even with a weapon at the feet.
{
  const { host, a, c, b, pl, advance, unfreeze, carrierOf } = await match();
  const carrier = carrierOf();
  const mate = carrier === a ? c : a;
  for (const x of [carrier, mate]) pl(x).money = 16000;
  await buy(carrier, W.RIFLE);
  await buy(mate, W.SMG);
  await unfreeze();
  const [sx, sz] = site(host);
  putOn(pl(mate), sx, sz);
  host.kill(pl(b), pl(mate), W.SMG, false);
  putOn(pl(carrier), sx, sz);
  pl(carrier).using = true;
  await advance(ROUND.plantMs + 300);
  assert.equal(host.round.planted, true);
  assert.deepEqual(pl(carrier).loadout, [W.RIFLE, W.PISTOL]);
  host.destroy();
}

// Money: your own team's, and nobody else's.
{
  const { host, a, b, c, d, advance, pl } = await match();
  await advance(600);
  const rows = (x) => x.got.filter((m) => m.type === 'score').at(-1).ps;
  const row = (x, of) => rows(x).find((r) => r.i === of.id);
  assert.equal(row(a, c).m, pl(c).money, 'teammate');
  assert.equal(row(a, a).m, pl(a).money);
  assert.equal(row(a, b).m, undefined, 'enemy');
  assert.equal(row(b, d).m, pl(d).money);
  assert.equal(row(b, c).m, undefined);
  host.destroy();
}

// The other modes stay as they were.
{
  const host = new HostServer(false);
  host.setConfig({ mode: 'bomb' });
  assert.equal(host.config.arsenal, 'shop');
  assert.equal(host.config.map, 'usina', 'the mode picks one of its maps');
  host.setConfig({ map: 'arena' });
  assert.equal(host.config.map, 'usina', 'and refuses the others');
  host.setConfig({ mode: 'tdm' });
  assert.equal(host.config.arsenal, 'all');
  assert.equal(host.config.map, 'arena');
  host.setConfig({ map: 'usina' });
  assert.equal(host.config.map, 'arena');
  assert.equal(DEFAULT_CONFIG.mode, 'ffa');
  host.destroy();
}

// Practice on a bomb map is the real mode, with targets on the other side.
{
  const host = new HostServer(true, {}, 'mercado');
  const a = join(host, 'A');
  await flush();
  await flush();
  host.startMatch();
  await flush();
  assert.equal(host.config.mode, 'bomb');
  const me = host.players.get(a.id);
  assert.equal(me.info.team, 'red');
  assert.equal(host.round.carrier, me);
  const bots = [...host.players.values()].filter((p) => p.bot);
  assert.ok(bots.length > 0 && bots.every((p) => p.alive && p.info.team === 'blue'));
  host.destroy();
}

console.log('bomb ok');
process.exit(0);
