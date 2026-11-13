-- Estatísticas do perfil: precisão, acertos na cabeça, dano, MVPs e melhor partida.
-- Mesma limitação do ranking: os números vêm do navegador, e o banco só recusa os impossíveis.

alter table public.player_stats
  add column damage bigint not null default 0 check (damage >= 0),
  add column shots integer not null default 0 check (shots >= 0),
  add column hits integer not null default 0 check (hits >= 0),
  add column head_hits integer not null default 0 check (head_hits >= 0),
  add column mvps integer not null default 0 check (mvps >= 0),
  add column best_kills integer not null default 0 check (best_kills >= 0);

-- O ranking já é público; estes números vão junto.
grant select (headshots, damage, shots, hits, head_hits, mvps, best_kills) on public.player_stats to anon, authenticated;

-- Parâmetros novos mudam a assinatura, então a antiga sai (com ela, chamadas com nome ficariam ambíguas).
drop function public.submit_match(integer, integer, text, text, integer, integer, boolean);

create function public.submit_match(
  p_kills integer,
  p_deaths integer,
  p_mode text,
  p_result text,
  p_headshots integer default 0,
  p_damage integer default 0,
  p_mvp boolean default false,
  p_shots integer default 0,
  p_hits integer default 0,
  p_head_hits integer default 0
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
  -- A arma mais rápida dispara uns 15 tiros por segundo.
  if p_shots is null or p_hits is null or p_head_hits is null
    or p_shots < 0 or p_shots > elapsed * 16
    or p_hits < 0 or p_hits > p_shots
    or p_head_hits < 0 or p_head_hits > p_hits then
    raise exception 'invalid_accuracy';
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
      damage = damage + p_damage,
      shots = shots + p_shots,
      hits = hits + p_hits,
      head_hits = head_hits + p_head_hits,
      mvps = mvps + case when coalesce(p_mvp, false) then 1 else 0 end,
      best_kills = greatest(best_kills, p_kills),
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

-- O Postgres dá EXECUTE para todo mundo por padrão.
revoke execute on function public.submit_match(integer, integer, text, text, integer, integer, boolean, integer, integer, integer) from public, anon;
grant execute on function public.submit_match(integer, integer, text, text, integer, integer, boolean, integer, integer, integer) to authenticated;
