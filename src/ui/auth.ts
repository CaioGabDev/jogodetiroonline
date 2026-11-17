import { sanitizeText } from '../core/util';
import { NAME_MAX } from '../game/constants';
import { account } from '../net/account';
import { el, show } from './dom';
import { toast } from './toast';

/** login, signup, forgot (asks for the reset link) and reset (new password, after the link). */
type Mode = 'login' | 'signup' | 'forgot' | 'reset';

/** Login and signup, opened from the main menu. Closing it keeps the player as a guest. */
export class AuthScreen {
  readonly root: HTMLElement;
  private mode: Mode = 'login';
  private title: HTMLElement;
  private info: HTMLElement;
  private email: HTMLInputElement;
  private emailRow: HTMLElement;
  private password: HTMLInputElement;
  private passwordRow: HTMLElement;
  private forgot: HTMLButtonElement;
  private guest: HTMLButtonElement;
  private username: HTMLInputElement;
  private usernameRow: HTMLElement;
  private submit: HTMLButtonElement;
  private toggle: HTMLButtonElement;
  private google: HTMLButtonElement;
  private error: HTMLElement;

  constructor(parent: HTMLElement) {
    this.title = el('h2');
    this.email = el('input', { class: 'input', attrs: { type: 'email', autocomplete: 'email', placeholder: 'voce@email.com', required: '' } });
    this.password = el('input', { class: 'input', attrs: { type: 'password', minlength: '6', placeholder: 'Pelo menos 6 caracteres', required: '' } });
    this.username = el('input', { class: 'input', attrs: { maxlength: String(NAME_MAX), autocomplete: 'off', spellcheck: 'false', placeholder: 'Nome no jogo e no ranking' } });
    this.usernameRow = el('div', {}, [el('label', { class: 'field-label', text: 'Nome de jogador' }), this.username]);
    this.submit = el('button', { class: 'btn primary big', attrs: { type: 'submit' } });
    this.error = el('div', { class: 'error hidden' });
    this.toggle = el('button', {
      class: 'btn ghost',
      attrs: { type: 'button' },
      onClick: () => this.setMode(this.mode === 'login' ? 'signup' : 'login'),
    });
    this.forgot = el('button', {
      class: 'btn ghost',
      text: 'Esqueci a senha',
      attrs: { type: 'button' },
      onClick: () => this.setMode('forgot'),
    });
    this.info = el('p', { class: 'hint hidden' });
    this.emailRow = el('div', {}, [el('label', { class: 'field-label', text: 'E-mail' }), this.email]);
    this.google = el('button', {
      class: 'btn',
      text: 'Entrar com Google',
      attrs: { type: 'button' },
      onClick: () => void this.run(() => account.signInWithGoogle()),
    });

    // The Google button stays off until the provider is set up (setMode), or it would only lead to an error.

    this.passwordRow = el('div', {}, [el('label', { class: 'field-label', text: 'Senha' }), this.password]);
    const form = el('form', { class: 'auth-form' }, [this.info, this.usernameRow, this.emailRow, this.passwordRow, this.error, this.submit]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.send();
    });

    const panel = el('div', { class: 'panel auth-panel' }, [
      this.title,
      form,
      this.google,
      this.forgot,
      this.toggle,
      (this.guest = el('button', { class: 'btn ghost', text: 'Continuar como convidado', onClick: () => this.close() })),
    ]);
    this.root = el('div', { class: 'overlay auth hidden' }, [panel]);
    parent.append(this.root);
    this.setMode('login');
  }

  open(): void {
    if (this.mode !== 'login' && this.mode !== 'signup') this.setMode('login');
    this.setError('');
    this.password.value = '';
    show(this.root, true);
    this.email.focus();
  }

  /** Opened by the reset link: the player is already signed in and picks a new password. */
  openReset(): void {
    this.setMode('reset');
    this.password.value = '';
    show(this.root, true);
    this.password.focus();
  }

  close(): void {
    show(this.root, false);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    const titles: Record<Mode, string> = { login: 'Entrar', signup: 'Criar conta', forgot: 'Recuperar senha', reset: 'Nova senha' };
    const submits: Record<Mode, string> = { login: 'Entrar', signup: 'Criar conta', forgot: 'Enviar link', reset: 'Salvar senha' };
    this.title.textContent = titles[mode];
    this.submit.textContent = submits[mode];
    this.toggle.textContent = mode === 'signup' ? 'Já tenho conta' : mode === 'login' ? 'Criar uma conta' : 'Voltar para o login';
    this.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    this.password.placeholder = mode === 'reset' ? 'Nova senha, pelo menos 6 caracteres' : 'Pelo menos 6 caracteres';
    this.info.textContent =
      mode === 'forgot' ? 'Digite o e-mail da conta. Vamos mandar um link para você criar uma senha nova.' : mode === 'reset' ? 'Escolha a nova senha da sua conta.' : '';
    show(this.info, mode === 'forgot' || mode === 'reset');
    show(this.usernameRow, mode === 'signup');
    show(this.emailRow, mode !== 'reset');
    show(this.passwordRow, mode !== 'forgot');
    // Only required where it shows, or the browser blocks the form.
    this.email.required = mode !== 'reset';
    this.password.required = mode !== 'forgot';
    show(this.forgot, mode === 'login');
    show(this.google, mode !== 'forgot' && mode !== 'reset' && import.meta.env.VITE_GOOGLE_LOGIN === 'true');
    show(this.toggle, mode !== 'reset');
    show(this.guest, mode !== 'reset');
    this.setError('');
  }

  private get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  private setError(msg: string): void {
    this.error.textContent = msg;
    show(this.error, !!msg);
  }

  private async send(): Promise<void> {
    const email = this.email.value.trim();
    const password = this.password.value;
    if (this.mode === 'login') {
      await this.run(() => account.signIn(email, password));
      return;
    }
    if (this.mode === 'forgot') {
      await this.run(async () => {
        const error = await account.resetPassword(email);
        // Same message whether or not the e-mail has an account, so nobody can probe for accounts.
        if (!error) toast('Se existir uma conta com esse e-mail, o link para trocar a senha chegou lá. Confira também o spam.', 'ok', 9000);
        return error;
      });
      if (!this.visible) this.setMode('login');
      return;
    }
    if (this.mode === 'reset') {
      if (password.length < 6) {
        this.setError('A senha precisa de pelo menos 6 caracteres.');
        return;
      }
      await this.run(async () => {
        const error = await account.updatePassword(password);
        if (!error) {
          toast('Senha trocada! Você já está conectado.', 'ok', 6000);
          // Drops the code from the address, so a reload doesn't try the used link again.
          history.replaceState(null, '', location.pathname + location.search.replace(/([?&])code=[^&]*&?/, '$1').replace(/[?&]$/, ''));
          this.setMode('login');
        }
        return error;
      });
      return;
    }
    const name = sanitizeText(this.username.value, NAME_MAX);
    if (name.length < 3) {
      this.setError('O nome de jogador precisa de pelo menos 3 caracteres.');
      return;
    }
    await this.run(async () => {
      const { error, confirm } = await account.signUp(email, password, name);
      if (!error && confirm) toast('Conta criada! Confirme pelo link enviado ao seu e-mail e depois entre.', 'ok', 9000);
      return error;
    });
  }

  /** Runs a login attempt with the buttons locked. A network failure counts as an error, not a crash. */
  private async run(attempt: () => Promise<string | null>): Promise<void> {
    const buttons = [this.submit, this.google, this.toggle, this.forgot];
    buttons.forEach((b) => (b.disabled = true));
    this.setError('');
    let error: string | null;
    try {
      error = await attempt();
    } catch (e) {
      console.error('Falha no login', e);
      error = 'Sem conexão com o servidor de contas. Tente de novo.';
    }
    buttons.forEach((b) => (b.disabled = false));
    if (error) this.setError(error);
    else this.close();
  }
}
