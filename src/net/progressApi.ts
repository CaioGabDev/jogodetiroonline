import { sanitizeProgress, type CaseResult, type ProgressBackend } from '../core/progress';
import { isSkinId } from '../game/progression';
import { supabase } from './supabase';

/** The logged-in player's XP, coins and skins, kept in player_stats and changed only by database functions. */
export const accountProgress: ProgressBackend = {
  async load() {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc('my_progress');
    if (error) {
      console.warn('Falha ao carregar o progresso da conta', error.message);
      return null;
    }
    return sanitizeProgress(data);
  },
  async openCase(id) {
    if (!supabase) return { result: 'error' };
    const { data, error } = await supabase.rpc('open_case', { p_case: id });
    if (error) {
      console.warn('Não deu para abrir a caixa', error.message);
      return { result: 'error' };
    }
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.result === 'coins') return { result: 'coins' };
    if (r.result !== 'ok' || !isSkinId(r.skin)) return { result: 'error' };
    const refund = typeof r.refund === 'number' && r.refund > 0 ? Math.floor(r.refund) : 0;
    return { result: 'ok', skin: r.skin, dup: r.dup === true, refund } satisfies CaseResult;
  },
  async equip(id) {
    if (!supabase) return false;
    const { data, error } = await supabase.rpc('equip_skin', { p_skin: id });
    if (error) console.warn('Não deu para equipar', error.message);
    return !error && data === true;
  },
};
