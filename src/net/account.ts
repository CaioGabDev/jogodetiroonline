import type { AuthError } from '@supabase/supabase-js';
import { toast } from '../ui/toast';
import { supabase } from './supabase';

export interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
}

const AUTH_ERRORS: Record<string, string> = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_not_confirmed: 'Confirme seu e-mail antes de entrar: o link está na sua caixa de entrada.',
  user_already_exists: 'Já existe uma conta com esse e-mail.',
  email_exists: 'Já existe uma conta com esse e-mail.',
  weak_password: 'Senha fraca: use pelo menos 6 caracteres.',
  validation_failed: 'Confira o e-mail e a senha.',
  email_address_invalid: 'Esse e-mail não é válido.',
  over_email_send_rate_limit: 'Muitas tentativas. Espere alguns minutos e tente de novo.',
  over_request_rate_limit: 'Muitas tentativas. Espere alguns minutos e tente de novo.',
  signup_disabled: 'O cadastro está desativado no momento.',
  provider_disabled: 'Esse tipo de login não está ativo no momento.',
};

function authMessage(e: AuthError): string {
  return AUTH_ERRORS[e.code ?? ''] ?? 'Não foi possível completar o login. Tente de novo.';
}

/** Signed-in player. Without an account the game runs as a guest, and nothing here is required to play. */
class Account {
  profile: Profile | null = null;
  private userId: string | null = null;
  private listeners = new Set<() => void>();

  get available(): boolean {
    return supabase !== null;
  }

  init(): void {
    supabase?.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null;
      if (id === this.userId) return;
      this.userId = id;
      // Supabase calls made inside this callback can deadlock, so the work waits for the next tick.
      window.setTimeout(() => void this.load(id), 0);
    });
  }

  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  setProfile(p: Profile | null): void {
    this.profile = p;
    this.listeners.forEach((l) => l());
  }

  private async load(id: string | null): Promise<void> {
    if (!supabase || !id) {
      this.setProfile(null);
      return;
    }
    const { data, error } = await supabase.from('profiles').select('id, username, avatar_url').eq('id', id).single();
    if (id !== this.userId) return;
    if (error) {
      console.error('Falha ao carregar o perfil', error);
      toast('Não foi possível carregar seu perfil. Você continua como convidado.', 'error', 6000);
    }
    this.setProfile(error ? null : (data as Profile));
  }

  /** Each of these returns an error message, or null when it worked. */
  async signIn(email: string, password: string): Promise<string | null> {
    if (!supabase) return null;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? authMessage(error) : null;
  }

  /** `confirm` means the project requires a click on the e-mail link before the first login. */
  async signUp(email: string, password: string, username: string): Promise<{ error: string | null; confirm: boolean }> {
    if (!supabase) return { error: null, confirm: false };
    // The database would rename a duplicate to keep the signup working; asking first lets the player choose.
    const pattern = username.replace(/[\\%_]/g, '\\$&');
    const taken = await supabase.from('profiles').select('id').ilike('username', pattern).limit(1);
    if (taken.data?.length) return { error: 'Esse nome já está em uso.', confirm: false };
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
    if (error) return { error: authMessage(error), confirm: false };
    return { error: null, confirm: data.session === null };
  }

  /** Leaves the page for Google and comes back to the same address, keeping an invite link. */
  async signInWithGoogle(): Promise<string | null> {
    if (!supabase) return null;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname + location.search },
    });
    return error ? authMessage(error) : null;
  }

  async signOut(): Promise<void> {
    const res = await supabase?.auth.signOut();
    if (res?.error) toast('Não foi possível sair da conta.', 'error');
  }
}

export const account = new Account();
