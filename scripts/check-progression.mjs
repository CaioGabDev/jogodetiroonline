// Progression check: `npm run check`. Levels, ranks, rewards, the skin catalog and the saved progress.
import assert from 'node:assert/strict';
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
const { progress } = await vite.ssrLoadModule('/src/core/progress.ts');
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
  assert.ok(s.id === P.DEFAULT_SKIN || s.colors.length >= 1, `${s.id} colors`);
  for (const c of s.colors) assert.match(c, /^#[0-9a-f]{6}$/, `${s.id} color ${c}`);
}
assert.equal(P.skinById('nao-existe').id, P.DEFAULT_SKIN);

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
assert.equal(progress.buy('tigre'), 'coins');
assert.equal(progress.equip('tigre'), false);

const before = progress.coins;
const sum = progress.addMatch({ kills: 30, deaths: 5, headshots: 10, damage: 5000, won: true, mvp: true });
assert.ok(sum.levelAfter > sum.levelBefore, 'a big match levels up');
assert.equal(progress.coins, before + sum.reward.coins + sum.levelCoins);
assert.ok(sum.levelAfter >= 3 && progress.owns('floresta'), 'Floresta comes with level 3');
assert.ok(sum.unlocked.some((s) => s.id === 'floresta'));

while (progress.coins < 600) progress.addMatch({ kills: 10, deaths: 5, headshots: 2, damage: 1500, won: false, mvp: false });
const coins = progress.coins;
assert.equal(progress.buy('tigre'), 'ok');
assert.equal(progress.coins, coins - 600);
assert.equal(progress.buy('tigre'), 'owned');
assert.equal(progress.equip('tigre'), true);
assert.equal(progress.buy('diamante'), 'level', 'General skin needs level 50');

const saved = JSON.parse(store.get('arenafps.progress.v1'));
assert.equal(saved.equipped, 'tigre');
assert.deepEqual(saved.bought, ['tigre']);
assert.equal(saved.coins, progress.coins);

console.log(`progressão ok: nível 10 em ~${matches} partidas, partida típica = ${typical.xp} XP e ${typical.coins} moedas`);
