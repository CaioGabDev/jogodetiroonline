-- Configurações do jogo (privadas, por isso fora de profiles) e bucket de avatares.

create table public.user_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  settings jsonb not null,
  updated_at timestamptz not null default now(),
  constraint user_settings_size check (pg_column_size(settings) < 16384)
);

alter table public.user_settings enable row level security;

create policy "cada um lê as próprias configurações" on public.user_settings
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "cada um cria as próprias configurações" on public.user_settings
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "cada um altera as próprias configurações" on public.user_settings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.user_settings from anon, authenticated;
grant select, insert, update on public.user_settings to authenticated;

-- O próprio Storage recusa o que passar de 2 MB ou não for imagem, mesmo que o cliente seja modificado.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Cada usuário só mexe na pasta com o próprio id. A leitura pública é pela URL do bucket.
create policy "avatar: ver a própria pasta" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatar: enviar na própria pasta" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatar: trocar na própria pasta" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatar: apagar na própria pasta" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
