-- O modo Bomba entra no ranking. Uma partida pode ter até 25 rodadas de quase 3 min, bem mais que os
-- 20 min dos outros modos, e cada rodada pode ter 5 kills.

create or replace function public.submit_match(p_kills integer, p_deaths integer, p_mode text, p_result text)
returns integer
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

  -- Desempenho vale de -5 a +10: vitória dá de 15 a 30 pontos, e derrota tira de 10 a 25.
  new_rating := greatest(0, stats.rating + base + greatest(-5, least(10, p_kills - p_deaths)));

  update public.player_stats
  set kills = kills + p_kills,
      deaths = deaths + p_deaths,
      matches = matches + 1,
      rating = new_rating,
      match_started_at = null,
      last_match_at = now(),
      updated_at = now()
  where user_id = uid;

  return new_rating;
end;
$$;

-- "create or replace" mantém as permissões da função, mas aqui fica explícito.
revoke execute on function public.submit_match(integer, integer, text, text) from public, anon;
grant execute on function public.submit_match(integer, integer, text, text) to authenticated;
