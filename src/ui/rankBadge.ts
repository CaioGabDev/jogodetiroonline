import type { Rank } from '../game/ranks';
import { el } from './dom';

/** Hexagon in the tier's color with the division inside. */
export function rankBadge(rank: Rank): HTMLElement {
  return el('span', { class: 'rank-badge', title: rank.label, text: rank.division || '★', style: { background: rank.color } });
}
