-- Perfis públicos, criados automaticamente no cadastro.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  -- Mesmo limite de nick do jogo (NAME_MAX), sem caracteres de controle, invisíveis ou de direção de texto.
  constraint profiles_username_format check (
    char_length(username) between 3 and 16
    and username = btrim(username)
    and username !~ '[\u0001-\u001F\u007F​-‏‪-‮⁠-⁤﻿]'
  ),
  -- Só aceita um arquivo do próprio usuário no bucket de avatares, nunca um link qualquer.
  constraint profiles_avatar_owner check (
    avatar_url is null
    or (
      avatar_url ~ '^https?://[^/]+/storage/v1/object/public/avatars/'
      and position('/avatars/' || id::text || '/' in avatar_url) > 0
    )
  )
);

create unique index profiles_username_unique on public.profiles (lower(username));

alter table public.profiles enable row level security;

create policy "perfis são públicos" on public.profiles
  for select to anon, authenticated
  using (true);

create policy "cada um altera o próprio perfil" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Sem insert nem delete pelo cliente: o gatilho cria o perfil e o cascade remove.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (username, avatar_url) on public.profiles to authenticated;

-- Roda dentro do cadastro: se falhar, ninguém consegue criar conta. Por isso nunca desiste de achar um nome.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  attempt int := 0;
begin
  -- O e-mail fica de fora de propósito: o nome é público. Do Google vem só o primeiro nome.
  base := coalesce(
    new.raw_user_meta_data ->> 'username',
    split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ' ', 1)
  );
  base := btrim(left(regexp_replace(coalesce(base, ''), '[\u0001-\u001F\u007F​-‏‪-‮⁠-⁤﻿]', '', 'g'), 16));
  if char_length(base) < 3 then
    base := 'jogador';
  end if;
  candidate := base;

  loop
    begin
      insert into public.profiles (id, username) values (new.id, candidate);
      return new;
    exception when unique_violation then
      attempt := attempt + 1;
      candidate := case
        when attempt <= 10 then btrim(left(base, 11)) || '_' || (1000 + floor(random() * 9000))::int
        else 'p_' || left(replace(new.id::text, '-', ''), 14)
      end;
    end;
  end loop;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
