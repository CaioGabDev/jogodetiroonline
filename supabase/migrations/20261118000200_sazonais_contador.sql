-- Caixas sazonais (Natal e Halloween) e o contador de abates nas skins.
-- Mesmas skins, caixas, janelas e chances de src/game/progression.ts e src/game/cases.ts.

alter table public.skins
  add column season text check (season in ('natal', 'halloween'));

insert into public.skins (id, level, price, slot) values
  ('natal_bengala', 1, 900, 'arma'),
  ('natal_neve', 1, 2600, 'arma'),
  ('natal_pinheiro', 1, 4200, 'arma'),
  ('natal_estrela', 1, 9500, 'arma'),
  ('faca_natal', 1, 9000, 'faca'),
  ('hallo_abobora', 1, 900, 'arma'),
  ('hallo_teia', 1, 2600, 'arma'),
  ('hallo_cripta', 1, 4200, 'arma'),
  ('hallo_fantasma', 1, 9500, 'arma'),
  ('faca_ceifadora', 1, 9000, 'faca');

update public.skins set season = 'natal' where id in ('natal_bengala', 'natal_neve', 'natal_pinheiro', 'natal_estrela', 'faca_natal');
update public.skins set season = 'halloween' where id in ('hallo_abobora', 'hallo_teia', 'hallo_cripta', 'hallo_fantasma', 'faca_ceifadora');

-- Skins com contador e os abates de cada uma.
alter table public.player_stats
  add column counters text[] not null default '{}',
  add column counter_kills jsonb not null default '{}'::jsonb;

-- Janela da caixa sazonal, que pode virar o ano (Natal: 15/11 a 15/01). Horário de Brasília.
create or replace function public.case_open(p_from integer, p_to integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  with d as (
    select (extract(month from now() at time zone 'America/Sao_Paulo') * 100
          + extract(day from now() at time zone 'America/Sao_Paulo'))::integer as v
  )
  select case when p_from <= p_to then d.v between p_from and p_to else d.v >= p_from or d.v <= p_to end from d
$$;

-- Abre uma caixa: cobra, sorteia aqui no banco e guarda a skin. Repetida devolve metade do preço,
-- a não ser que venha com contador: aí a skin que você já tem ganha o contador.
create or replace function public.open_case(p_case text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s public.player_stats%rowtype;
  v_price integer;
  v_slot text;
  v_season text;
  v_roll double precision;
  v_tier text;
  v_skin text;
  v_dup boolean;
  v_counter boolean;
  v_refund integer := 0;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_case = 'armas' then
    v_price := 1200; v_slot := 'arma';
  elsif p_case = 'facas' then
    v_price := 2500; v_slot := 'faca';
  elsif p_case = 'natal' then
    v_price := 1800; v_slot := 'misto'; v_season := 'natal';
    if not public.case_open(1115, 115) then return jsonb_build_object('result', 'closed'); end if;
  elsif p_case = 'halloween' then
    v_price := 1800; v_slot := 'misto'; v_season := 'halloween';
    if not public.case_open(1001, 1107) then return jsonb_build_object('result', 'closed'); end if;
  else
    return jsonb_build_object('result', 'unknown');
  end if;

  insert into public.player_stats (user_id) values (uid) on conflict (user_id) do nothing;
  select * into s from public.player_stats where user_id = uid for update;
  if not s.dev and s.coins < v_price then
    return jsonb_build_object('result', 'coins');
  end if;

  v_roll := random() * 100;
  if v_slot = 'arma' then
    v_tier := case when v_roll < 4 then 'lendario' when v_roll < 14 then 'epico' when v_roll < 40 then 'raro' else 'comum' end;
  elsif v_slot = 'faca' then
    v_tier := case when v_roll < 7 then 'lendario' when v_roll < 30 then 'epico' else 'raro' end;
  else
    v_tier := case when v_roll < 5 then 'lendario' when v_roll < 17 then 'epico' when v_roll < 45 then 'raro' else 'comum' end;
  end if;

  select sk.id into v_skin
  from public.skins sk
  where public.skin_tier(sk.slot, sk.price) = v_tier
    and sk.season is not distinct from v_season
    and (v_slot = 'misto' or sk.slot = v_slot)
  order by random()
  limit 1;
  if v_skin is null then
    raise exception 'empty_case';
  end if;

  v_dup := v_skin = any (s.bought_skins);
  v_counter := random() * 100 < 10 and not (v_skin = any (s.counters));
  if v_dup and not v_counter and not s.dev then
    v_refund := v_price / 2;
  end if;

  update public.player_stats
  set coins = case when s.dev then coins else coins - v_price + v_refund end,
      bought_skins = case when v_dup then bought_skins else array_append(bought_skins, v_skin) end,
      counters = case when v_counter then array_append(counters, v_skin) else counters end,
      counter_kills = case when v_counter then counter_kills || jsonb_build_object(v_skin, 0) else counter_kills end,
      updated_at = now()
  where user_id = uid;

  return jsonb_build_object('result', 'ok', 'skin', v_skin, 'dup', v_dup, 'refund', v_refund, 'counter', v_counter);
end;
$$;

revoke execute on function public.open_case(text) from public, anon;
grant execute on function public.open_case(text) to authenticated;

-- Soma abates no contador de uma skin que tem contador. É só visual; o limite por chamada evita absurdos.
create or replace function public.add_counter_kills(p_skin text, p_kills integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_kills is null or p_kills < 1 or p_kills > 60 then
    return;
  end if;
  update public.player_stats
  set counter_kills = counter_kills || jsonb_build_object(p_skin, coalesce((counter_kills ->> p_skin)::integer, 0) + p_kills),
      updated_at = now()
  where user_id = uid and p_skin = any (counters);
end;
$$;

revoke execute on function public.add_counter_kills(text, integer) from public, anon;
grant execute on function public.add_counter_kills(text, integer) to authenticated;

-- O progresso agora também traz os contadores.
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
      'equipped', 'padrao', 'equipped_knife', 'faca_padrao', 'rating', 0, 'counters', '[]'::jsonb, 'counter_kills', '{}'::jsonb);
  end if;
  return jsonb_build_object(
    'xp', s.xp, 'coins', s.coins, 'wins', s.wins, 'matches', s.matches, 'kills', s.kills,
    'bought', to_jsonb(s.bought_skins), 'equipped', s.equipped_skin, 'equipped_knife', s.equipped_knife,
    'rating', s.rating, 'dev', s.dev, 'counters', to_jsonb(s.counters), 'counter_kills', s.counter_kills
  );
end;
$$;
