// Generates src/game/propShapes.ts: the collision of each map model, from its real geometry.
// Run after adding or changing a model: `node scripts/gen-prop-shapes.mjs`.
// Each model becomes a few boxes in normalized coordinates (0..1 over its bounding box), which mapData.ts
// stretches and turns exactly like render/map.ts stretches and turns the model.
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { boundsOf, mergeBoxes, readTriangles, voxelize } from './lib/glb.mjs';

const ROOT = fileURLToPath(new URL('../public/models/map/', import.meta.url));
const OUT = new URL('../src/game/propShapes.ts', import.meta.url);

/**
 * Voxels along the longest side: a car's collision sits within ~0.2 m of its paint, a building's within a few
 * dozen centimeters. Fences keep the simple collision mapData gives them.
 */
const RESOLUTION = { cars: 24, commercial: 20, industrial: 20, suburban: 20, roads: 12 };
const SKIP = new Set(['suburban/fence']);
/** Filled from the ground up to their top, column by column: a car is cover in profile, with no ledge under it to stand on. */
const PROFILE = new Set(['cars']);

const shapes = {};
let total = 0;
for (const kit of readdirSync(ROOT).sort()) {
  let files;
  try {
    files = readdirSync(join(ROOT, kit)).filter((f) => f.endsWith('.glb')).sort();
  } catch {
    continue;
  }
  for (const f of files) {
    const name = `${kit}/${f.replace(/\.glb$/, '')}`;
    if (SKIP.has(name)) continue;
    const tris = readTriangles(join(ROOT, kit, f));
    const size = boundsOf(tris).getSize(new Vector3());
    const n = RESOLUTION[kit] ?? 12;
    const m = Math.max(size.x, size.y, size.z);
    const nx = Math.max(2, Math.round((n * size.x) / m));
    const ny = Math.max(2, Math.round((n * size.y) / m));
    const nz = Math.max(2, Math.round((n * size.z) / m));
    // Every voxel the surface touches is solid: the collision is never smaller than what is drawn, at most a voxel bigger.
    const vox = voxelize(tris, nx, ny, nz);
    if (PROFILE.has(kit)) {
      for (let k = 0; k < nz; k++) {
        for (let i = 0; i < nx; i++) {
          let top = -1;
          for (let j = 0; j < ny; j++) if (vox.grid[i + nx * (j + ny * k)]) top = j;
          for (let j = 0; j < top; j++) vox.grid[i + nx * (j + ny * k)] = 1;
        }
      }
    }
    const r = (v) => Math.round(v * 1000) / 1000;
    shapes[name] = mergeBoxes(vox).map(([i0, j0, k0, i1, j1, k1]) => [r(i0 / nx), r(j0 / ny), r(k0 / nz), r(i1 / nx), r(j1 / ny), r(k1 / nz)]);
    total += shapes[name].length;
    console.log(`${name.padEnd(34)} ${nx}×${ny}×${nz}  ${shapes[name].length} caixas`);
  }
}

const lines = Object.entries(shapes).map(([name, boxes]) => `  '${name}': [\n${boxes.map((b) => `    [${b.join(', ')}],`).join('\n')}\n  ],`);
writeFileSync(
  OUT,
  `// Gerado por scripts/gen-prop-shapes.mjs a partir dos modelos em public/models/map. Não edite à mão.

/** [x0, y0, z0, x1, y1, z1], from 0 to 1 over the model's bounding box, before it is turned. */
export type ShapeBox = [number, number, number, number, number, number];

/** Collision of each map model, following its real shape. */
export const PROP_SHAPES: Record<string, ShapeBox[]> = {
${lines.join('\n')}
};
`,
);
console.log(`${Object.keys(shapes).length} modelos, ${total} caixas`);
