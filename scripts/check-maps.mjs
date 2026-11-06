// Map balance check: `npm run check`. Measures what makes a map fair, and fails when a limit is broken.
// `node scripts/check-maps.mjs vila` also draws that map as text, one character per 2 m.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { MAPS } = await vite.ssrLoadModule('/src/game/mapData.ts');
const { CollisionWorld } = await vite.ssrLoadModule('/src/game/physics.ts');
const { MOVE, PLAYER } = await vite.ssrLoadModule('/src/game/constants.ts');
await vite.close();

/** Limits per map. The older maps only need valid spawns: they were tuned by playing. */
const LIMITS = {
  vila: { sight: 46, safe: 7 },
  centro: { sight: 62, safe: 8 },
  patio: { sight: 52, safe: 7 },
};
const STEP = 1;
const EYE = PLAYER.eye;
/** Width in meters a line of sight must keep clear to count. */
const SIGHT_WIDTH = 1;
/** Cover hides a standing body. */
const COVER_H = 1.1;

function reachable(world, def, starts) {
  const half = def.size / 2;
  const key = (x, z, y) => `${x},${z},${Math.round(y * 10)}`;
  const seen = new Map();
  const queue = [];
  for (const [x, y, z] of starts) {
    const cell = { x: Math.round(x), z: Math.round(z), y, d: 0 };
    seen.set(key(cell.x, cell.z, y), cell);
    queue.push(cell);
  }
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx * STEP;
      const z = c.z + dz * STEP;
      if (Math.abs(x) > half - 0.5 || Math.abs(z) > half - 0.5) continue;
      for (const reach of [MOVE.step, MOVE.mantleReach]) {
        // groundHeight allows 5 cm over the feet, which the mantle in physics.ts doesn't.
        const y = world.groundHeight(x, z, c.y + reach - 0.05, 40);
        if (y === -Infinity || world.overlapsSolid(x, y + 0.03, z, PLAYER.height, PLAYER.radius * 0.9)) continue;
        const k = key(x, z, y);
        if (!seen.has(k)) {
          const cell = { x, z, y, d: c.d + STEP + (reach > MOVE.step ? 1 : 0) };
          seen.set(k, cell);
          queue.push(cell);
        }
        break;
      }
    }
  }
  return [...seen.values()];
}

/** Longest clear shot between places a player can stand. */
function longestSight(world, cells) {
  let best = 0;
  let where = '';
  const dirs = Array.from({ length: 48 }, (_, i) => (i / 48) * Math.PI * 2);
  for (const c of cells) {
    if ((c.x + c.z) % 2) continue;
    for (const a of dirs) {
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      // Two rays a body's width apart: a gap only one of them fits through is not a firing lane.
      const left = world.raycast(c.x - dz * SIGHT_WIDTH / 2, c.y + EYE, c.z + dx * SIGHT_WIDTH / 2, dx, 0, dz, 200);
      const right = world.raycast(c.x + dz * SIGHT_WIDTH / 2, c.y + EYE, c.z - dx * SIGHT_WIDTH / 2, dx, 0, dz, 200);
      const dist = Math.min(left?.dist ?? 0, right?.dist ?? 0);
      if (dist > best) {
        best = dist;
        where = `(${c.x}, ${c.z}, altura ${c.y.toFixed(1)}) para (${(c.x + dx * best).toFixed(0)}, ${(c.z + dz * best).toFixed(0)})`;
      }
    }
  }
  return [best, where];
}

/** Distance from each standing spot to the nearest thing to hide behind. */
function coverGaps(world, cells) {
  return cells.map((c) => {
    for (let r = 1; r <= 16; r++) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const h = world.raycast(c.x, c.y + COVER_H - 0.1, c.z, Math.cos(a), 0, Math.sin(a), r);
        if (h) return h.dist;
      }
    }
    return 16;
  });
}

const near = (cells, x, y, z) => cells.some((c) => Math.hypot(c.x - x, c.z - z) <= 1.5 && Math.abs(c.y - y) < 0.6);

function draw(def, world, cells, name) {
  const half = def.size / 2;
  const standing = new Set(cells.map((c) => `${c.x},${c.z}`));
  const spawns = new Map();
  for (const s of def.teamSpawns.red) spawns.set(`${Math.round(s.pos[0] / 2)},${Math.round(s.pos[2] / 2)}`, 'R');
  for (const s of def.teamSpawns.blue) spawns.set(`${Math.round(s.pos[0] / 2)},${Math.round(s.pos[2] / 2)}`, 'B');
  console.log(`\n${name}  # alto  + cobertura baixa  . andável  R/B spawn  ~ fora de alcance`);
  for (let z = -half; z <= half; z += 2) {
    let row = '';
    for (let x = -half; x <= half; x += 2) {
      const tall = world.overlapsSolid(x, 1.3, z, 0.4, 0.3);
      const low = world.overlapsSolid(x, 0.3, z, 0.4, 0.3);
      const walk = standing.has(`${x},${z}`) || standing.has(`${x + 1},${z}`) || standing.has(`${x},${z + 1}`);
      row += spawns.get(`${x / 2},${z / 2}`) ?? (tall ? '#' : low ? '+' : walk ? '.' : '~');
    }
    console.log(row);
  }
}

const only = process.argv[2];
const table = [];
const problems = [];
for (const [name, def] of Object.entries(MAPS)) {
  if (only && name !== only) continue;
  const world = new CollisionWorld(def);
  const allSpawns = [...def.ffaSpawns, ...def.teamSpawns.red, ...def.teamSpawns.blue];
  for (const s of allSpawns) {
    const [x, y, z] = s.pos;
    assert.ok(!world.overlapsSolid(x, y + 0.05, z, PLAYER.height), `${name}: spawn dentro de sólido em ${x},${z}`);
    assert.ok(world.groundHeight(x, z, y + 0.1, 0.3) > -Infinity, `${name}: spawn sem chão em ${x},${z}`);
  }
  const limit = LIMITS[name];
  if (!limit) continue;

  const redStart = def.teamSpawns.red.map((s) => s.pos);
  const blueStart = def.teamSpawns.blue.map((s) => s.pos);
  const fromRed = reachable(world, def, redStart);
  const fromBlue = reachable(world, def, blueStart);
  if (only) draw(def, world, fromRed, name);

  for (const s of allSpawns) assert.ok(near(fromRed, ...s.pos), `${name}: spawn inalcançável em ${s.pos}`);
  for (const p of def.pickups) assert.ok(near(fromRed, ...p.pos), `${name}: munição inalcançável em ${p.pos}`);
  assert.equal(fromRed.length, fromBlue.length, `${name}: os times não alcançam a mesma área`);

  // Fairness: each team gets to the same places in the same time.
  const blueD = new Map(fromBlue.map((c) => [`${c.x},${c.z},${c.y.toFixed(1)}`, c.d]));
  let redFirst = 0;
  let blueFirst = 0;
  for (const c of fromRed) {
    const d = blueD.get(`${c.x},${c.z},${c.y.toFixed(1)}`);
    if (d === undefined) continue;
    if (c.d < d) redFirst++;
    else if (d < c.d) blueFirst++;
  }
  const share = redFirst / (redFirst + blueFirst);
  assert.ok(Math.abs(share - 0.5) < 0.02, `${name}: território desigual, ${(share * 100).toFixed(1)}% vermelho`);

  // No spawn shoots straight into the enemy's.
  for (const a of redStart) {
    for (const b of blueStart) {
      assert.ok(!world.lineOfSight(a[0], a[1] + EYE, a[2], b[0], b[1] + EYE, b[2]), `${name}: spawns se enxergam: ${a} e ${b}`);
    }
  }

  const center = fromRed.filter((c) => Math.hypot(c.x, c.z) < 4 && c.y < 1).sort((a, b) => a.d - b.d)[0];
  const contact = center ? center.d / MOVE.sprint : NaN;
  const [sight, where] = longestSight(world, fromRed);
  const gaps = coverGaps(world, fromRed).sort((a, b) => a - b);
  const p95 = gaps[Math.floor(gaps.length * 0.95)];
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  table.push({ mapa: name, 'área (m²)': fromRed.length, 'maior visão (m)': +sight.toFixed(1), 'cobertura média (m)': +avg.toFixed(1), 'cobertura p95 (m)': +p95.toFixed(1), 'ao centro (s)': +contact.toFixed(1), 'território': `${(share * 100).toFixed(0)}/${(100 - share * 100).toFixed(0)}` });
  if (sight > limit.sight) problems.push(`${name}: linha de visão de ${sight.toFixed(1)} m, ${where}, passa do limite de ${limit.sight} m`);
  if (p95 > limit.safe) problems.push(`${name}: 5% do mapa fica a mais de ${limit.safe} m de cobertura (${p95.toFixed(1)} m)`);
}
if (table.length) console.table(table);
assert.deepEqual(problems, []);
console.log('maps ok');
