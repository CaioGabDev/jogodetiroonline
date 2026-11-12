// Gameplay self-check: `npm run check`. Fails when movement or weapon balance stops doing what the README says.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { CollisionWorld } = await vite.ssrLoadModule('/src/game/physics.ts');
const { MAX_HP, MOVE } = await vite.ssrLoadModule('/src/game/constants.ts');
const { W, WEAPONS, damageAt } = await vite.ssrLoadModule('/src/game/weapons.ts');
await vite.close();

const DT = 1 / 60;
const floor = { min: [-50, -1, -50], max: [50, 0, 50], mat: 'floor' };
const world = (...boxes) => new CollisionWorld({ boxes: [floor, ...boxes], ramps: [] });
const player = () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false, slide: 0, mantle: null });
const input = (o = {}) => ({ fwd: 0, side: 0, jump: false, crouch: false, sprint: false, slide: false, speedMul: 1, ads: false, yaw: 0, ...o });
const run = (w, s, inp, seconds) => {
  for (let i = 0; i < seconds / DT; i++) w.step(s, inp, DT);
};
const speed = (s) => Math.hypot(s.vx, s.vz);

// Shots to kill, from hits on the body.
const stk = (w, dist) => Math.ceil(MAX_HP / damageAt(WEAPONS[w], dist, false));
const ttk = (w, dist) => (stk(w, dist) - 1) * WEAPONS[w].interval;
assert.equal(stk(W.RIFLE, 10), 4);
assert.equal(stk(W.RIFLE, 60), 4);
assert.equal(stk(W.SMG, 10), 4);
assert.equal(stk(W.SMG, 30), 6);
assert.equal(stk(W.SNIPER, 100), 1);
assert.equal(stk(W.KNIFE, 1), 1);
// Desert Eagle: one headshot kills up to 15 m, the body takes two.
const headStk = (w, dist) => Math.ceil(MAX_HP / damageAt(WEAPONS[w], dist, true));
assert.equal(headStk(W.DEAGLE, 2), 1);
assert.equal(headStk(W.DEAGLE, 15), 1);
assert.equal(headStk(W.DEAGLE, 30), 2);
assert.equal(stk(W.DEAGLE, 10), 2);
assert.ok(ttk(W.SMG, 10) < ttk(W.RIFLE, 10), 'SMG wins up close');
assert.ok(ttk(W.RIFLE, 30) < ttk(W.SMG, 30), 'rifle wins at range');
assert.ok(WEAPONS.filter((d) => !d.melee).every((d) => d.adsTime >= 0.12 && d.adsTime <= 0.35));

// Jump: about a meter high. A jump out of a sprint gives a push (MOVE.sprintJump), and hops don't stack it.
{
  const w = world();
  const s = player();
  run(w, s, input({ fwd: 1, sprint: true }), 1);
  const before = speed(s);
  let top = 0;
  w.step(s, input({ fwd: 1, sprint: true, jump: true }), DT);
  for (let i = 0; i < 60 && !s.onGround; i++) {
    w.step(s, input({ fwd: 1, sprint: true }), DT);
    top = Math.max(top, s.y);
  }
  assert.ok(top > 0.9 && top < 1.1, `jump height ${top}`);
  const cap = MOVE.sprint * MOVE.sprintJump + 0.01;
  assert.ok(speed(s) > before + 0.5 && speed(s) <= cap, `sprint jump push: ${before} -> ${speed(s)}`);
  for (let hop = 0; hop < 5; hop++) {
    w.step(s, input({ fwd: 1, sprint: true, jump: true }), DT);
    for (let i = 0; i < 60 && !s.onGround; i++) w.step(s, input({ fwd: 1, sprint: true }), DT);
  }
  assert.ok(speed(s) <= cap, `hops don't stack: ${speed(s)}`);
}

// Slide: faster than a sprint, keeps going without input, ends crouched and slow.
{
  const w = world();
  const s = player();
  run(w, s, input({ fwd: 1, sprint: true }), 1);
  const z = s.z;
  const r = w.step(s, input({ crouch: true, slide: true }), DT);
  assert.ok(r.slid && s.crouch);
  assert.ok(speed(s) > MOVE.sprint);
  run(w, s, input({ crouch: true, side: 1 }), MOVE.slideTime / 2);
  assert.ok(s.slide > 0 && Math.abs(s.x) < 0.01, 'no steering during a slide');
  run(w, s, input({ crouch: true }), 1);
  assert.equal(s.slide, 0);
  assert.ok(z - s.z > 3, 'covers ground');
  assert.ok(speed(s) < MOVE.crouch + 0.01);
}

// Mantle: climbs what a jump can't quite reach, nothing taller, and only going forward.
{
  const ledge = (top) => ({ min: [-2, 0, -3], max: [2, top, -1], mat: 'crate' });
  const climb = (top, fwd = 1) => {
    const w = world(ledge(top));
    const s = player();
    s.z = -0.5;
    run(w, s, input({ fwd, jump: true }), 0.1);
    run(w, s, input(), 1);
    return s;
  };
  const low = climb(1.4);
  assert.ok(Math.abs(low.y - 1.4) < 0.05 && low.z < -1, `mantled to ${low.y}, ${low.z}`);
  assert.ok(climb(2.5).y < 1, 'too tall');
  assert.ok(climb(1.4, 0).y < 1.1, 'needs forward');
  // A wall right behind the ledge leaves nowhere to stand.
  const w = world(ledge(1.2), { min: [-2, 0, -3], max: [2, 4, -1.3], mat: 'wall' });
  const s = player();
  s.z = -0.5;
  run(w, s, input({ fwd: 1, jump: true }), 1);
  assert.ok(s.y < 1.15 && s.mantle === null, 'no room on top');
}

console.log('gameplay ok');
