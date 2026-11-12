-- Progressão da conta: XP, nível (patente), moedas e skins de arma.
-- Os números são os mesmos de src/game/progression.ts (scripts/check-progression.mjs confere o catálogo).
-- O cliente nunca escreve nada disso: as recompensas saem do submit_match, que já valida a partida,
-- e comprar ou equipar skin passa por funções que conferem nível, moedas e posse.

alter table public.player_stats
  add column xp integer not null default 0 check (xp >= 0),
  add column coins integer not null default 0 check (coins >= 0),
  add column wins integer not null default 0 check (wins >= 0),
  add column headshots integer not null default 0 check (headshots >= 0),
  add column bought_skins text[] not null default '{}',
  add column equipped_skin text not null default 'padrao';

-- XP e skin equipada são públicos, como o resto do ranking. Moedas e compras, só pelo my_progress().
grant select (xp, wins, equipped_skin) on public.player_stats to anon, authenticated;

-- Catálogo: nível mínimo e preço (0 = grátis ao chegar no nível).
create table public.skins (
  id text primary key,
  level integer not null check (level between 1 and 55),
  price integer not null check (price >= 0)
);
alter table public.skins enable row level security;
create policy "catálogo é público" on public.skins for select to anon, authenticated using (true);
revoke all on public.skins from anon, authenticated;
grant select on public.skins to anon, authenticated;

insert into public.skins (id, level, price) values
  ('padrao', 1, 0),
  ('floresta', 3, 0),
  ('deserto', 6, 0),
  ('urbano', 10, 0),
  ('artico', 15, 0),
  ('tigre', 1, 600),
  ('oceano', 1, 800),
  ('carmesim', 4, 1200),
  ('neon', 8, 1800),
  ('cerejeira', 12, 2200),
  ('lava', 20, 3500),
  ('galaxia', 26, 4500),
  ('ouro', 33, 6000),
  ('diamante', 50, 10000);

-- Nível a partir do XP: do nível L para o L+1 são 800 + 150 * (L - 1) XP, até o 55.
create function public.level_for_xp(p_xp integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  lvl integer := 1;
  rest bigint := greatest(0, coalesce(p_xp, 0));
begin
  while lvl < 55 and rest >= 800 + 150 * (lvl - 1) loop
    rest := rest - (800 + 150 * (lvl - 1));
    lvl := lvl + 1;
  end loop;
  return lvl;
end;
$$;

-- Tudo o que o próprio jogador precisa para a tela do Arsenal.
create function public.my_progress()
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
    return jsonb_build_object('xp', 0, 'coins', 0, 'wins', 0, 'matches', 0, 'kills', 0, 'bought', '[]'::jsonb, 'equipped', 'padrao', 'rating', 0);
  end if;
  return jsonb_build_object(
    'xp', s.xp, 'coins', s.coins, 'wins', s.wins, 'matches', s.matches, 'kills', s.kills,
    'bought', to_jsonb(s.bought_skins), 'equipped', s.equipped_skin, 'rating', s.rating
  );
end;
$$;

-- O submit_match ganha headshots, dano e MVP, e passa a devolver a recompensa junto com o elo.
-- Os parâmetros novos têm padrão, então quem chama com os 4 antigos continua funcionando.
drop function public.submit_match(integer, integer, text, text);

create function public.submit_match(
  p_kills integer,
  p_deaths integer,
  p_mode text,
  p_result text,
  p_headshots integer default 0,
  p_damage integer default 0,
  p_mvp boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  stats public.player_stats%rowtype;
  elapsed numeric;
  kill_cap integer;
  max_seconds integer;
  base integer;
  new_rating integer;
  r_kills integer;
  r_hs integer;
  r_dmg integer;
  xp_gain integer;
  coin_gain integer;
  level_before integer;
  level_after integer;
  level_coins integer;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- O lock impede dois envios simultâneos da mesma partida.
  select * into stats from public.player_stats where user_id = uid for update;
  if not found or stats.match_started_at is null then
    raise exception 'no_open_match';
  end if;

  -- Maior limite de kills do lobby é 50. No Gun Game as kills de faca não contam para o limite.
  kill_cap := case p_mode
    when 'ffa' then 50
    when 'tdm' then 50
    when 'gungame' then 60
    when 'bomb' then 125
  end;
  if kill_cap is null then
    raise exception 'invalid_mode';
  end if;
  max_seconds := case when p_mode = 'bomb' then 5400 else 1800 end;

  elapsed := extract(epoch from now() - stats.match_started_at);
  if elapsed < 30 or elapsed > max_seconds then
    raise exception 'invalid_duration';
  end if;
  if stats.last_match_at is not null and now() - stats.last_match_at < interval '30 seconds' then
    raise exception 'too_soon';
  end if;

  base := case p_result
    when 'win' then 20
    when 'draw' then 0
    when 'loss' then -20
  end;
  if base is null then
    raise exception 'invalid_result';
  end if;
  if p_kills is null or p_kills < 0 or p_kills > least(kill_cap, floor(elapsed / 1.5)) then
    raise exception 'invalid_kills';
  end if;
  -- O respawn leva 3 s.
  if p_deaths is null or p_deaths < 0 or p_deaths > floor(elapsed / 3) then
    raise exception 'invalid_deaths';
  end if;
  if p_headshots is null or p_headshots < 0 or p_headshots > p_kills then
    raise exception 'invalid_headshots';
  end if;
  -- 100 de vida por kill, mais dano em quem não morreu: 400 por segundo já é folga de sobra.
  if p_damage is null or p_damage < 0 or p_damage > elapsed * 400 then
    raise exception 'invalid_damage';
  end if;

  -- Desempenho vale de -5 a +10: vitória dá de 15 a 30 pontos, e derrota tira de 10 a 25.
  new_rating := greatest(0, stats.rating + base + greatest(-5, least(10, p_kills - p_deaths)));

  -- Recompensa: igual a matchReward() em src/game/progression.ts.
  r_kills := least(60, p_kills);
  r_hs := least(r_kills, p_headshots);
  r_dmg := least(8000, p_damage);
  xp_gain := 150 + r_kills * 50 + r_hs * 25 + case when r_dmg >= 10 then r_dmg / 10 else 0 end
    + case when p_result = 'win' then 300 else 0 end
    + case when coalesce(p_mvp, false) then 150 else 0 end;
  coin_gain := 25 + r_kills * 5 + r_hs * 2
    + case when p_result = 'win' then 40 else 0 end
    + case when coalesce(p_mvp, false) then 20 else 0 end;
  level_before := public.level_for_xp(stats.xp);
  level_after := public.level_for_xp(stats.xp + xp_gain);
  level_coins := (level_after - level_before) * 100;

  update public.player_stats
  set kills = kills + p_kills,
      deaths = deaths + p_deaths,
      headshots = headshots + p_headshots,
      matches = matches + 1,
      wins = wins + case when p_result = 'win' then 1 else 0 end,
      rating = new_rating,
      xp = xp + xp_gain,
      coins = coins + coin_gain + level_coins,
      match_started_at = null,
      last_match_at = now(),
      updated_at = now()
  where user_id = uid;

  return jsonb_build_object(
    'rating', new_rating,
    'xp', stats.xp + xp_gain,
    'coins', stats.coins + coin_gain + level_coins,
    'xp_gain', xp_gain,
    'coin_gain', coin_gain,
    'level_coins', level_coins
  );
end;
$$;

revoke execute on function public.submit_match(integer, integer, text, text, integer, integer, boolean) from public, anon;
grant execute on function public.submit_match(integer, integer, text, text, integer, integer, boolean) to authenticated;

-- Compra e já equipa. Devolve 'ok', 'owned', 'level', 'coins' ou 'unknown'.
create function public.buy_skin(p_skin text)
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
  if public.level_for_xp(s.xp) < sk.level then
    return 'level';
  end if;
  if s.coins < sk.price then
    return 'coins';
  end if;
  update public.player_stats
  set coins = coins - sk.price,
      bought_skins = array_append(bought_skins, sk.id),
      equipped_skin = sk.id,
      updated_at = now()
  where user_id = uid;
  return 'ok';
end;
$$;

-- Equipa uma skin que o jogador tem: comprada, ou grátis e com o nível alcançado.
create function public.equip_skin(p_skin text)
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
  if not ((sk.price = 0 and public.level_for_xp(s.xp) >= sk.level) or sk.id = any (s.bought_skins)) then
    return false;
  end if;
  update public.player_stats set equipped_skin = sk.id, updated_at = now() where user_id = uid;
  return true;
end;
$$;

revoke execute on function public.level_for_xp(integer) from public, anon, authenticated;
revoke execute on function public.my_progress() from public, anon;
revoke execute on function public.buy_skin(text) from public, anon;
revoke execute on function public.equip_skin(text) from public, anon;
grant execute on function public.my_progress() to authenticated;
grant execute on function public.buy_skin(text) to authenticated;
grant execute on function public.equip_skin(text) to authenticated;
