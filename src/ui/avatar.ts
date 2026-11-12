import { safeAvatarUrl } from '../net/supabase';
import { el } from './dom';

/** The player's picture, or the first letter of the name when there is none. */
export function avatar(name: string, url: string | null, cls = ''): HTMLElement {
  const src = safeAvatarUrl(url);
  if (src) return el('img', { class: `avatar ${cls}`, attrs: { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' } });
  return el('span', { class: `avatar ${cls}`, text: Array.from(name)[0]?.toUpperCase() ?? '?' });
}
