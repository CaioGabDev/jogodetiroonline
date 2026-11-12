// Reads the triangles of a .glb file in Node (no browser needed) and turns a model into solid voxels and boxes.
// Used by scripts/gen-prop-shapes.mjs to give each map prop a collision that follows its real shape.
import { readFileSync } from 'node:fs';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const READERS = {
  5120: (dv, o) => dv.getInt8(o),
  5121: (dv, o) => dv.getUint8(o),
  5122: (dv, o) => dv.getInt16(o, true),
  5123: (dv, o) => dv.getUint16(o, true),
  5125: (dv, o) => dv.getUint32(o, true),
  5126: (dv, o) => dv.getFloat32(o, true),
};
const SIZES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function accessor(json, bin, index) {
  const a = json.accessors[index];
  const view = json.bufferViews[a.bufferView];
  const n = COMPONENTS[a.type];
  const size = SIZES[a.componentType];
  const stride = view.byteStride || n * size;
  const base = (view.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read = READERS[a.componentType];
  const out = new Array(a.count * n);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = read(dv, base + i * stride + c * size);
  return out;
}

function nodeMatrix(node) {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  const t = new Vector3(...(node.translation ?? [0, 0, 0]));
  const r = new Quaternion(...(node.rotation ?? [0, 0, 0, 1]));
  const s = new Vector3(...(node.scale ?? [1, 1, 1]));
  return new Matrix4().compose(t, r, s);
}

/** Every triangle of the default scene, in model space, as flat [ax, ay, az, bx, ..., cz] arrays. */
export function readTriangles(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: não é GLB`);
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  const tris = [];
  const v = [new Vector3(), new Vector3(), new Vector3()];
  const visit = (index, parent) => {
    const node = json.nodes[index];
    const m = new Matrix4().multiplyMatrices(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue;
        const pos = accessor(json, bin, prim.attributes.POSITION);
        const idx = prim.indices !== undefined ? accessor(json, bin, prim.indices) : [...Array(pos.length / 3).keys()];
        for (let i = 0; i + 2 < idx.length; i += 3) {
          for (let k = 0; k < 3; k++) v[k].fromArray(pos, idx[i + k] * 3).applyMatrix4(m);
          tris.push([v[0].x, v[0].y, v[0].z, v[1].x, v[1].y, v[1].z, v[2].x, v[2].y, v[2].z]);
        }
      }
    }
    for (const c of node.children ?? []) visit(c, m);
  };
  const scene = json.scenes[json.scene ?? 0];
  for (const n of scene.nodes) visit(n, new Matrix4());
  return tris;
}

export function boundsOf(tris) {
  const b = new Box3();
  const p = new Vector3();
  for (const t of tris) for (let k = 0; k < 9; k += 3) b.expandByPoint(p.set(t[k], t[k + 1], t[k + 2]));
  return b;
}

/**
 * Solid voxels of a model in a grid of nx × ny × nz over its bounding box. Surfaces are marked by sampling
 * each triangle, then everything the outside can't reach is filled, so closed shapes come out solid.
 */
export function voxelize(tris, nx, ny, nz) {
  const b = boundsOf(tris);
  const size = b.getSize(new Vector3());
  const cell = [size.x / nx, size.y / ny, size.z / nz];
  const grid = new Uint8Array(nx * ny * nz);
  const at = (i, j, k) => i + nx * (j + ny * k);
  const mark = (x, y, z) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - b.min.x) / cell[0])));
    const j = Math.min(ny - 1, Math.max(0, Math.floor((y - b.min.y) / cell[1])));
    const k = Math.min(nz - 1, Math.max(0, Math.floor((z - b.min.z) / cell[2])));
    grid[at(i, j, k)] = 1;
  };
  const step = Math.min(...cell) * 0.4;
  for (const t of tris) {
    const e = Math.max(Math.hypot(t[3] - t[0], t[4] - t[1], t[5] - t[2]), Math.hypot(t[6] - t[0], t[7] - t[1], t[8] - t[2]), Math.hypot(t[6] - t[3], t[7] - t[4], t[8] - t[5]));
    const n = Math.max(1, Math.ceil(e / step));
    for (let a = 0; a <= n; a++) {
      for (let c = 0; c <= n - a; c++) {
        const u = a / n;
        const w = c / n;
        const s = 1 - u - w;
        mark(t[0] * s + t[3] * u + t[6] * w, t[1] * s + t[4] * u + t[7] * w, t[2] * s + t[5] * u + t[8] * w);
      }
    }
  }
  // Flood the empty space from the grid's border; whatever it doesn't reach is inside the model.
  const outside = new Uint8Array(grid.length);
  const stack = [];
  const push = (i, j, k) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
    const id = at(i, j, k);
    if (grid[id] || outside[id]) return;
    outside[id] = 1;
    stack.push(i, j, k);
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) push(i, j, k);
  while (stack.length) {
    const k = stack.pop();
    const j = stack.pop();
    const i = stack.pop();
    push(i + 1, j, k);
    push(i - 1, j, k);
    push(i, j + 1, k);
    push(i, j - 1, k);
    push(i, j, k + 1);
    push(i, j, k - 1);
  }
  for (let id = 0; id < grid.length; id++) if (!outside[id]) grid[id] = 1;
  return { grid, nx, ny, nz, bounds: b };
}

/** Merges solid voxels into as few boxes as it can (greedy: along x, then y, then z). In voxel units. */
export function mergeBoxes({ grid, nx, ny, nz }) {
  const at = (i, j, k) => i + nx * (j + ny * k);
  const used = new Uint8Array(grid.length);
  const free = (i, j, k) => grid[at(i, j, k)] && !used[at(i, j, k)];
  const boxes = [];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!free(i, j, k)) continue;
        let i1 = i;
        while (i1 + 1 < nx && free(i1 + 1, j, k)) i1++;
        let j1 = j;
        grow: while (j1 + 1 < ny) {
          for (let x = i; x <= i1; x++) if (!free(x, j1 + 1, k)) break grow;
          j1++;
        }
        let k1 = k;
        growZ: while (k1 + 1 < nz) {
          for (let y = j; y <= j1; y++) for (let x = i; x <= i1; x++) if (!free(x, y, k1 + 1)) break growZ;
          k1++;
        }
        for (let z = k; z <= k1; z++) for (let y = j; y <= j1; y++) for (let x = i; x <= i1; x++) used[at(x, y, z)] = 1;
        boxes.push([i, j, k, i1 + 1, j1 + 1, k1 + 1]);
      }
    }
  }
  return boxes;
}
