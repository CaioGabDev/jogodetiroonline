// Map vote check: `npm run check`. A real host with three players in memory votes for the next map.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

globalThis.window = { setTimeout, clearTimeout, setInterval, clearInterval };
const noPeerjs = {
  name: 'no-peerjs',
  enforce: 'pre',
  resolveId: (id) => (id === 'peerjs' ? '\0peerjs' : null),
  load: (id) => (id === '\0peerjs' ? 'export class Peer {}' : null),
};
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', plugins: [noPeerjs], ssr: { noExternal: ['peerjs'] } });
const { HostServer } = await vite.ssrLoadModule('/src/net/host.ts');
const { PROTOCOL_VERSION, BOMB_MAPS } = await vite.ssrLoadModule('/src/game/constants.ts');
await vite.close();

const flush = () => new Promise((r) => setImmediate(r));
function join(host, name, rid) {
  const conn = host.connectLocal();
  const c = { conn, id: 0, got: [] };
  conn.onMessage = (m) => {
    c.got.push(m);
    if (m.type === 'welcome') c.id = m.id;
  };
  conn.send({ type: 'hello', name, color: '#f94144', v: PROTOCOL_VERSION, ...(rid ? { rid } : {}) });
  return c;
}
const lastVote = (c) => c.got.filter((m) => m.type === 'vote').at(-1);

const host = new HostServer(false);
const [a, b, c] = ['A', 'B', 'C'].map((n) => join(host, n));
await flush();
await flush();
host.setConfig({ mode: 'ffa', map: 'arena' });
host.startMatch();
await flush();
host.endMatch('kills');
await flush();

const v = lastVote(a);
assert.ok(v, 'the vote opens when the match ends');
assert.equal(v.options.length, 3);
assert.equal(v.options[0], 'arena', 'the current map is an option');
assert.equal(new Set(v.options).size, 3, 'three different maps');
assert.ok(v.options.every((m) => !BOMB_MAPS.includes(m)), 'no bomb maps outside the bomb mode');

a.conn.send({ type: 'vote', i: 1 });
b.conn.send({ type: 'vote', i: 1 });
c.conn.send({ type: 'vote', i: 2 });
c.conn.send({ type: 'vote', i: 9 });
await flush();
assert.deepEqual(lastVote(b).counts, [0, 2, 1], 'one vote each, changes count, bad index ignored');

host.startMatch();
await flush();
assert.equal(host.config.map, v.options[1], 'the rematch is on the most voted map');
assert.equal(lastVote(c).winner, v.options[1]);
host.destroy();

// Reconnect: a player who drops and comes back with the same rid gets the team and score back.
{
  const host = new HostServer(false);
  const a = join(host, 'A', 'aaaaaaaa1');
  const b = join(host, 'B', 'bbbbbbbb1');
  await flush();
  await flush();
  host.setConfig({ mode: 'tdm', map: 'arena' });
  host.startMatch();
  await flush();
  const pb = host.players.get(b.id);
  Object.assign(pb, { kills: 7, deaths: 3, damage: 900 });
  const team = pb.info.team;
  b.conn.close();
  await flush();
  await flush();
  assert.equal(host.players.has(b.id), false);
  const b2 = join(host, 'B', 'bbbbbbbb1');
  await flush();
  await flush();
  const back = host.players.get(b2.id);
  assert.equal(back.kills, 7, 'kills come back');
  assert.equal(back.deaths, 3);
  assert.equal(back.info.team, team, 'same team');
  const c = join(host, 'C', 'cccccccc1');
  await flush();
  await flush();
  assert.equal(host.players.get(c.id).kills, 0, 'a new player starts at zero');
  host.destroy();
}

// Host migration: the new host carries on with the old settings, team score and everyone's score.
{
  const host = new HostServer(false);
  host.adopt({
    config: { ...host.config, mode: 'tdm', map: 'vila', killLimit: 50 },
    playing: true,
    teams: [12, 9],
    stash: [['aaaaaaaa1', { team: 'blue', kills: 5, deaths: 2, damage: 0, headshots: 0, shots: 0, hits: 0, headHits: 0, level: 0, at: 0 }]],
  });
  host.startMatch();
  const a = join(host, 'A', 'aaaaaaaa1');
  await flush();
  await flush();
  assert.equal(host.config.map, 'vila');
  assert.deepEqual(host.teamScore, [12, 9], 'team score carried on');
  const pa = host.players.get(a.id);
  assert.equal(pa.kills, 5);
  assert.equal(pa.info.team, 'blue');
  host.startMatch();
  assert.deepEqual(host.teamScore, [0, 0], 'a rematch starts clean');
  host.destroy();
}

console.log('votação, reconexão e troca de host ok');
