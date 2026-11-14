-- Skins de faca (equipadas à parte), skins premium novas e conta de dev.
-- Mesmos números de src/game/progression.ts.

alter table public.skins
  add column slot text not null default 'arma' check (slot in ('arma', 'faca'));

insert into public.skins (id, level, price, slot) values
  ('tempestade', 16, 9000, 'arma'),
  ('holograma', 22, 11000, 'arma'),
  ('aurora', 30, 14000, 'arma'),
  ('faca_padrao', 1, 0, 'faca'),
  ('faca_tanto', 1, 1500, 'faca'),
  ('faca_cutelo', 5, 2500, 'faca'),
  ('faca_karambit', 10, 4500, 'faca'),
  ('faca_borboleta', 15, 7000, 'faca'),
  ('faca_dragao', 24, 9500, 'faca'),
  ('faca_plasma', 35, 15000, 'faca');

alter table public.player_stats
  add column equipped_knife text not null default 'faca_padrao',
  -- Conta de dev: compra tudo de graça. Só muda pela função make_dev, rodada no SQL Editor.
  add column dev boolean not null default false;

-- Quem joga junto vê a faca.
grant select (equipped_knife) on public.player_stats to anon, authenticated;

create or replace function public.my_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s public.player_stats%rowtype;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into s from public.player_stats where user_id = uid;
  if not found then
    return jsonb_build_object('xp', 0, 'coins', 0, 'wins', 0, 'matches', 0, 'kills', 0, 'bought', '[]'::jsonb,
      'equipped', 'padrao', 'equipped_knife', 'faca_padrao', 'rating', 0);
  end if;
  return jsonb_build_object(
    'xp', s.xp, 'coins', s.coins, 'wins', s.wins, 'matches', s.matches, 'kills', s.kills,
    'bought', to_jsonb(s.bought_skins), 'equipped', s.equipped_skin, 'equipped_knife', s.equipped_knife,
    'rating', s.rating, 'dev', s.dev
  );
end;
$$;

-- Compra e já equipa no espaço certo (arma ou faca). A conta de dev não paga e não precisa de nível.
create or replace function public.buy_skin(p_skin text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sk public.skins%rowtype;
  s public.player_stats%rowtype;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into sk from public.skins where id = p_skin;
  if not found then
    return 'unknown';
  end if;
  insert into public.player_stats (user_id) values (uid) on conflict (user_id) do nothing;
  select * into s from public.player_stats where user_id = uid for update;
  if sk.price = 0 or sk.id = any (s.bought_skins) then
    return 'owned';
  end if;
  if not s.dev and public.level_for_xp(s.xp) < sk.level then
    return 'level';
  end if;
  if not s.dev and s.coins < sk.price then
    return 'coins';
  end if;
  update public.player_stats
  set coins = case when s.dev then coins else coins - sk.price end,
      bought_skins = array_append(bought_skins, sk.id),
      equipped_skin = case when sk.slot = 'arma' then sk.id else equipped_skin end,
      equipped_knife = case when sk.slot = 'faca' then sk.id else equipped_knife end,
      updated_at = now()
  where user_id = uid;
  return 'ok';
end;
$$;

create or replace function public.equip_skin(p_skin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sk public.skins%rowtype;
  s public.player_stats%rowtype;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into sk from public.skins where id = p_skin;
  if not found then
    return false;
  end if;
  insert into public.player_stats (user_id) values (uid) on conflict (user_id) do nothing;
  select * into s from public.player_stats where user_id = uid for update;
  if not (s.dev or (sk.price = 0 and public.level_for_xp(s.xp) >= sk.level) or sk.id = any (s.bought_skins)) then
    return false;
  end if;
  update public.player_stats
  set equipped_skin = case when sk.slot = 'arma' then sk.id else equipped_skin end,
      equipped_knife = case when sk.slot = 'faca' then sk.id else equipped_knife end,
      updated_at = now()
  where user_id = uid;
  return true;
end;
$$;

-- Liga a conta de dev de um e-mail: todas as skins, nível máximo e moedas sem fim.
-- Uso, no SQL Editor do Supabase:  select public.make_dev('seu@email.com');
-- Ninguém chama isso pelo site: o EXECUTE fica só com o dono do banco.
create or replace function public.make_dev(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then
    return 'Nenhuma conta com esse e-mail. Crie a conta no jogo primeiro.';
  end if;
  insert into public.player_stats (user_id) values (uid) on conflict (user_id) do nothing;
  update public.player_stats
  set dev = true,
      coins = 999999999,
      -- Bem acima do XP do nível 55, que é o máximo.
      xp = greatest(xp, 10000000),
      bought_skins = (select coalesce(array_agg(id order by id), '{}') from public.skins where price > 0),
      updated_at = now()
  where user_id = uid;
  return 'Conta de dev ligada.';
end;
$$;

revoke execute on function public.make_dev(text) from public, anon, authenticated;
