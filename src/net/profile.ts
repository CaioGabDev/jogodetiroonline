import { settings } from '../core/settings';
import { account } from './account';
import { supabase } from './supabase';

const AVATAR_SIZE = 256;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/** Waits for the player to stop moving a slider before saving. */
const SETTINGS_SAVE_DELAY_MS = 1500;

/** Both return an error message, or null when it worked. */
export async function saveUsername(username: string): Promise<string | null> {
  const profile = account.profile;
  if (!supabase || !profile) return null;
  const { error } = await supabase.from('profiles').update({ username }).eq('id', profile.id);
  if (error?.code === '23505') return 'Esse nome já está em uso.';
  if (error?.code === '23514') return 'Use de 3 a 16 caracteres, sem símbolos invisíveis.';
  if (error) return 'Não foi possível salvar o nome.';
  account.setProfile({ ...profile, username });
  return null;
}

/** Crops the center to a square and shrinks it, so what gets stored is always small and a real image. */
async function resizeAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d indisponível');
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('falha ao gerar a imagem'))), 'image/webp', 0.85);
  });
}

export async function saveAvatar(file: File): Promise<string | null> {
  const profile = account.profile;
  if (!supabase || !profile) return null;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return 'Escolha uma imagem PNG, JPG ou WebP.';
  if (file.size > AVATAR_MAX_BYTES) return 'A imagem pode ter no máximo 2 MB.';

  let image: Blob;
  try {
    image = await resizeAvatar(file);
  } catch (e) {
    console.error('Falha ao ler a imagem', e);
    return 'Não foi possível ler essa imagem.';
  }
  const path = `${profile.id}/avatar`;
  const bucket = supabase.storage.from('avatars');
  const sent = await bucket.upload(path, image, { upsert: true, contentType: image.type, cacheControl: '3600' });
  if (sent.error) {
    console.error('Falha no upload do avatar', sent.error);
    return 'Não foi possível enviar a imagem.';
  }
  // The file keeps its name, so the version in the address is what makes browsers load the new one.
  const avatar_url = `${bucket.getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
  const { error } = await supabase.from('profiles').update({ avatar_url }).eq('id', profile.id);
  if (error) return 'Não foi possível salvar a foto no perfil.';
  account.setProfile({ ...profile, avatar_url });
  return null;
}

async function pushSettings(userId: string): Promise<void> {
  const { error } = await supabase!.from('user_settings').upsert({ user_id: userId, settings: settings.get(), updated_at: new Date().toISOString() });
  if (error) console.error('Falha ao salvar as configurações', error);
}

/**
 * Logged in, the account holds the settings and follows the player between devices.
 * localStorage keeps working the same for guests and as the offline copy.
 */
export function initSettingsSync(): void {
  if (!supabase) return;
  const client = supabase;
  let userId: string | null = null;
  let applying = false;
  let timer = 0;

  const pull = async (id: string): Promise<void> => {
    const { data, error } = await client.from('user_settings').select('settings').eq('user_id', id).maybeSingle();
    if (id !== userId) return;
    if (error) {
      console.error('Falha ao carregar as configurações', error);
      return;
    }
    // First login: what the player already set up as a guest becomes the account's settings.
    if (!data) {
      await pushSettings(id);
      return;
    }
    applying = true;
    settings.apply(data.settings);
    applying = false;
  };

  account.onChange(() => {
    const id = account.profile?.id ?? null;
    if (id === userId) return;
    userId = id;
    clearTimeout(timer);
    if (id) void pull(id);
  });
  settings.onChange(() => {
    const id = userId;
    if (applying || !id) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => void pushSettings(id), SETTINGS_SAVE_DELAY_MS);
  });
}
