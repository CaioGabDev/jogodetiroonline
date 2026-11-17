// Progression check: `npm run check`. Levels, ranks, rewards, the skin catalog and the saved progress.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'vite';

// The store saves to localStorage: a map stands in for it.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const P = await vite.ssrLoadModule('/src/game/progression.ts');
const { parseClientMsg } = await vite.ssrLoadModule('/src/net/protocol.ts');
const { progress, sanitizeProgress } = await vite.ssrLoadModule('/src/core/progress.ts');
const C = await vite.ssrLoadModule('/src/game/cases.ts');
await vite.close();

// Level curve.
assert.equal(P.levelFromXp(0).level, 1);
assert.equal(P.levelFromXp(P.xpForLevel(1) - 1).level, 1);
assert.equal(P.levelFromXp(P.xpForLevel(1)).level, 2);
assert.equal(P.levelFromXp(P.totalXpFor(10)).level, 10);
assert.equal(P.levelFromXp(1e12).level, P.MAX_LEVEL);
assert.equal(P.levelFromXp(1e12).need, 0);

// Ranks start where the table says and only go up.
assert.equal(P.rankFor(1).name, 'Recruta');
assert.equal(P.rankFor(10).name, 'Sargento');
assert.equal(P.rankFor(P.MAX_LEVEL).name, 'General');
for (let i = 1; i < P.RANKS.length; i++) assert.ok(P.RANKS[i].level > P.RANKS[i - 1].level, 'ranks in order');

// Rewards: a typical match, and the caps.
const typical = P.matchReward({ kills: 15, deaths: 10, headshots: 5, damage: 2200, won: true, mvp: false });
assert.equal(typical.xp, 150 + 750 + 125 + 220 + 300);
assert.equal(typical.coins, 25 + 75 + 10 + 40);
const farm = P.matchReward({ kills: 9999, deaths: 0, headshots: 9999, damage: 1e9, won: true, mvp: true });
assert.ok(farm.xp < 6000, `capped reward: ${farm.xp}`);
const empty = P.matchReward({ kills: 0, deaths: 3, headshots: 0, damage: 0, won: false, mvp: false });
assert.equal(empty.xp, 150);
assert.equal(empty.coins, 25);
const bad = P.matchReward({ kills: -5, deaths: 0, headshots: NaN, damage: -1, won: false, mvp: false });
assert.equal(bad.xp, 150, 'negative or broken stats pay only the match');

// About 10 typical matches reach Sargento.
let xp = 0;
let matches = 0;
while (P.levelFromXp(xp).level < 10) {
  xp += typical.xp;
  matches++;
}
assert.ok(matches >= 8 && matches <= 16, `matches to level 10: ${matches}`);

// Catalog.
const ids = new Set(P.SKINS.map((s) => s.id));
assert.equal(ids.size, P.SKINS.length, 'skin ids are unique');
assert.ok(ids.has(P.DEFAULT_SKIN));
for (const s of P.SKINS) {
  assert.ok(s.level >= 1 && s.level <= P.MAX_LEVEL, `${s.id} level`);
  assert.ok(s.id === P.DEFAULT_SKIN || s.id === P.DEFAULT_KNIFE || s.colors.length >= 1, `${s.id} colors`);
  for (const c of s.colors) assert.match(c, /^#[0-9a-f]{6}$/, `${s.id} color ${c}`);
}
assert.equal(P.skinById('nao-existe').id, P.DEFAULT_SKIN);
for (const s of P.SKINS.filter((x) => x.fx)) {
  assert.ok(s.price >= 5000, `${s.id}: premium costs more`);
  for (const c of [s.fx.tracer, s.fx.flash, s.fx.kill]) assert.match(c, /^#[0-9a-f]{6}$/, `${s.id} fx color`);
}

// The database has its own copy of the catalog, which decides what can be bought.
const dir = new URL('../supabase/migrations/', import.meta.url);
const sql = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(new URL(f, dir), 'utf8'))
  .join(' ');
const rows = [...sql.matchAll(/\('([a-z_]+)', (\d+), (\d+)(?:, '[a-z]+')?\)/g)].map((m) => ({ id: m[1], level: Number(m[2]), price: Number(m[3]) }));
assert.deepEqual(rows, P.SKINS.map((s) => ({ id: s.id, level: s.level, price: s.price })), 'catalog in the migration matches progression.ts');

// Hello: skin and level are checked by the host.
const hello = { type: 'hello', name: 'A', color: '#f94144', v: 1 };
assert.ok(parseClientMsg(hello), 'hello without profile');
assert.ok(parseClientMsg({ ...hello, skin: 'ouro', lv: 33 }));
assert.equal(parseClientMsg({ ...hello, skin: 'hack' }), null);
assert.equal(parseClientMsg({ ...hello, lv: 9999 }), null);
assert.equal(parseClientMsg({ ...hello, lv: 1.5 }), null);

// Store: starts empty, pays, buys, equips and saves.
assert.equal(progress.level, 1);
assert.equal(progress.coins, 0);
assert.equal(progress.equipped, P.DEFAULT_SKIN);
assert.equal(progress.owns('floresta'), false, 'level skin locked at level 1');
assert.equal((await progress.openCase('armas')).result, 'coins');
assert.equal(await progress.equip('tigre'), false);
assert.equal((await progress.openCase('nao-existe')).result, 'error');

// Cases: odds add up, every special skin is in exactly one case, level skins in none, and the draw follows the odds.
for (const c of C.CASES) {
  assert.equal(Object.values(c.odds).reduce((a, b) => a + b, 0), 100, `${c.id} odds`);
  for (const t of Object.keys(c.odds)) assert.ok(C.caseItems(c).some((s) => C.tierOf(s) === t), `${c.id} has ${t}`);
}
for (const s of P.SKINS) {
  const inCases = C.CASES.filter((c) => C.caseItems(c).includes(s)).length;
  assert.equal(inCases, s.price > 0 ? 1 : 0, `${s.id} cases`);
}
{
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const armas = C.caseById('armas');
  const n = 20000;
  const got = {};
  for (let i = 0; i < n; i++) {
    const t = C.tierOf(C.rollCase(armas, rand));
    got[t] = (got[t] ?? 0) + 1;
  }
  for (const [t, p] of Object.entries(armas.odds)) assert.ok(Math.abs((got[t] / n) * 100 - p) < 1.5, `${t}: ${(got[t] / n) * 100}% vs ${p}%`);
  assert.equal(C.rollCase(C.caseById('facas'), () => 0.999).slot, 'faca');
}

const before = progress.coins;
const sum = progress.addMatch({ kills: 30, deaths: 5, headshots: 10, damage: 5000, won: true, mvp: true });
assert.ok(sum.levelAfter > sum.levelBefore, 'a big match levels up');
assert.equal(progress.coins, before + sum.reward.coins + sum.levelCoins);
assert.ok(sum.levelAfter >= 3 && progress.owns('floresta'), 'Floresta comes with level 3');
assert.ok(sum.unlocked.some((s) => s.id === 'floresta'));

while (progress.coins < 1200) progress.addMatch({ kills: 10, deaths: 5, headshots: 2, damage: 1500, won: false, mvp: false });
const coins = progress.coins;
const opened = await progress.openCase('armas');
assert.equal(opened.result, 'ok');
const won = opened.skin;
assert.ok(C.tierOf(P.skinById(won)), 'a case gives a special skin');
assert.equal(opened.dup, false);
assert.equal(progress.coins, coins - 1200);
assert.ok(progress.owns(won), 'the skin is kept');
assert.equal(progress.equipped, P.DEFAULT_SKIN, 'opening does not equip');
assert.equal(await progress.equip(won), true);
assert.equal(await progress.equip('padrao'), true);
assert.equal(await progress.equip(won), true);
// A skin already owned gives half the price back.
while (progress.coins < 1200) progress.addMatch({ kills: 10, deaths: 5, headshots: 2, damage: 1500, won: false, mvp: false });
{
  const real = Math.random;
  const before = progress.coins;
  const tierPos = { lendario: 0, epico: 4, raro: 14, comum: 40 }[C.tierOf(P.skinById(won))];
  const pool = C.caseItems(C.caseById('armas')).filter((s) => C.tierOf(s) === C.tierOf(P.skinById(won)));
  let k = 0;
  Math.random = () => (k++ === 0 ? (tierPos + 0.5) / 100 : (pool.indexOf(P.skinById(won)) + 0.5) / pool.length);
  const again = await progress.openCase('armas');
  Math.random = real;
  assert.equal(again.skin, won);
  assert.equal(again.dup, true);
  assert.equal(again.refund, 600);
  assert.equal(progress.coins, before - 600);
}

const saved = JSON.parse(store.get('arenafps.progress.v1'));
assert.equal(saved.equipped, won);
assert.deepEqual(saved.bought, [won]);
assert.equal(saved.coins, progress.coins);

// Logged in: the account's data replaces the browser's, purchases go to the server, and nothing is saved locally.
const calls = [];
const account = { xp: P.totalXpFor(12), coins: 5000, bought: ['neon'], equipped: 'neon', matches: 40, wins: 20, kills: 500 };
await progress.useBackend({
  load: async () => sanitizeProgress({ ...account, bought: [...account.bought] }),
  openCase: async (id) => {
    calls.push(['case', id]);
    account.coins -= 1200;
    account.bought.push('cerejeira');
    return { result: 'ok', skin: 'cerejeira', dup: false, refund: 0 };
  },
  equip: async (id) => {
    calls.push(['equip', id]);
    return true;
  },
});
const localSaved = store.get('arenafps.progress.v1');
assert.equal(progress.remote, true);
assert.equal(progress.level, 12);
assert.equal(progress.equipped, 'neon');
assert.equal(progress.owns('tigre'), false, 'the browser purchase is not in the account');
assert.equal((await progress.openCase('armas')).skin, 'cerejeira');
assert.equal(progress.coins, 5000 - 1200, 'reloaded from the server after opening');
assert.ok(progress.owns('cerejeira'));
assert.equal(await progress.equip('urbano'), true);
assert.deepEqual(calls, [['case', 'armas'], ['equip', 'urbano']]);
const paid = progress.applyServerMatch(
  { kills: 10, deaths: 4, headshots: 3, damage: 1500, won: true, mvp: false },
  { xp: account.xp + 1525, coins: 9999, xpGain: 1525, coinGain: 131, levelCoins: 100 },
);
assert.equal(progress.coins, 9999, 'the server total wins');
assert.equal(paid.reward.xp, 1525);
assert.equal(store.get('arenafps.progress.v1'), localSaved, 'account progress never touches localStorage');
await progress.useBackend(null);
assert.equal(progress.remote, false);
assert.equal(progress.equipped, won, 'logging out brings the browser progress back');

console.log(`progressão ok: nível 10 em ~${matches} partidas, partida típica = ${typical.xp} XP e ${typical.coins} moedas`);
