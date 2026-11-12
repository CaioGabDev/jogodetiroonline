import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, '');
// The dashboard now calls it the publishable key (sb_publishable_…); the old anon key name still works.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Null when the site was built without Supabase: everything keeps working, with guests only. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { auth: { flowType: 'pkce' } }) : null;

/** Avatars only load from this project's bucket, so a profile can't make viewers request another site. */
export function safeAvatarUrl(avatar: string | null): string | null {
  return avatar?.startsWith(`${url}/storage/v1/object/public/avatars/`) ? avatar : null;
}
