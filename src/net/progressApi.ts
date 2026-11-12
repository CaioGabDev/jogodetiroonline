import { sanitizeProgress, type BuyResult, type ProgressBackend } from '../core/progress';
import { supabase } from './supabase';

const BUY_RESULTS: BuyResult[] = ['ok', 'owned', 'level', 'coins'];

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
  async buy(id) {
    if (!supabase) return 'error';
    const { data, error } = await supabase.rpc('buy_skin', { p_skin: id });
    if (error) console.warn('Compra recusada', error.message);
    return !error && BUY_RESULTS.includes(data as BuyResult) ? (data as BuyResult) : 'error';
  },
  async equip(id) {
    if (!supabase) return false;
    const { data, error } = await supabase.rpc('equip_skin', { p_skin: id });
    if (error) console.warn('Não deu para equipar', error.message);
    return !error && data === true;
  },
};
