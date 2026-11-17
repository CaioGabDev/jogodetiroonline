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

console.log('votação ok');
