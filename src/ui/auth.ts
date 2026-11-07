import { sanitizeText } from '../core/util';
import { NAME_MAX } from '../game/constants';
import { account } from '../net/account';
import { el, show } from './dom';
import { toast } from './toast';

/** Login and signup, opened from the main menu. Closing it keeps the player as a guest. */
export class AuthScreen {
  readonly root: HTMLElement;
  private signup = false;
  private title: HTMLElement;
  private email: HTMLInputElement;
  private password: HTMLInputElement;
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
      onClick: () => this.setMode(!this.signup),
    });
    this.google = el('button', {
      class: 'btn',
      text: 'Entrar com Google',
      attrs: { type: 'button' },
      onClick: () => void this.run(() => account.signInWithGoogle()),
    });

    const form = el('form', { class: 'auth-form' }, [
      this.usernameRow,
      el('label', { class: 'field-label', text: 'E-mail' }),
      this.email,
      el('label', { class: 'field-label', text: 'Senha' }),
      this.password,
      this.error,
      this.submit,
    ]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.send();
    });

    const panel = el('div', { class: 'panel auth-panel' }, [
      this.title,
      form,
      this.google,
      this.toggle,
      el('button', { class: 'btn ghost', text: 'Continuar como convidado', onClick: () => this.close() }),
    ]);
    this.root = el('div', { class: 'overlay auth hidden' }, [panel]);
    parent.append(this.root);
    this.setMode(false);
  }

  open(): void {
    this.setError('');
    this.password.value = '';
    show(this.root, true);
    this.email.focus();
  }

  close(): void {
    show(this.root, false);
  }

  private setMode(signup: boolean): void {
    this.signup = signup;
    this.title.textContent = signup ? 'Criar conta' : 'Entrar';
    this.submit.textContent = signup ? 'Criar conta' : 'Entrar';
    this.toggle.textContent = signup ? 'Já tenho conta' : 'Criar uma conta';
    this.password.autocomplete = signup ? 'new-password' : 'current-password';
    show(this.usernameRow, signup);
    this.setError('');
  }

  private setError(msg: string): void {
    this.error.textContent = msg;
    show(this.error, !!msg);
  }

  private async send(): Promise<void> {
    const email = this.email.value.trim();
    const password = this.password.value;
    if (!this.signup) {
      await this.run(() => account.signIn(email, password));
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
    const buttons = [this.submit, this.google, this.toggle];
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
