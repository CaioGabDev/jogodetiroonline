-- Ranking por kills.
--
-- LIMITAÇÃO: o jogo é P2P e nenhum servidor vê a partida, então estes números vêm do navegador do
-- jogador e não dá para provar que são reais. As regras abaixo só limitam o estrago de quem mente:
-- ninguém escreve na tabela direto, e o relógio usado é o do banco, que o cliente não controla.

create table public.player_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  kills integer not null default 0 check (kills >= 0),
  deaths integer not null default 0 check (deaths >= 0),
  matches integer not null default 0 check (matches >= 0),
  -- Início da partida em aberto, marcado por begin_match().
  match_started_at timestamptz,
  last_match_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.player_stats enable row level security;

create policy "ranking é público" on public.player_stats
  for select to anon, authenticated
  using (true);

-- Sem policy nem grant de escrita: só as funções abaixo alteram esta tabela.
revoke all on public.player_stats from anon, authenticated;
grant select (user_id, kills, deaths, matches, updated_at) on public.player_stats to anon, authenticated;

create view public.leaderboard
with (security_invoker = true) as
select
  rank() over (order by s.kills desc, s.deaths asc) as place,
  s.user_id,
  p.username,
  p.avatar_url,
  s.kills,
  s.deaths,
  s.matches
from public.player_stats s
join public.profiles p on p.id = s.user_id
where s.matches > 0;

revoke all on public.leaderboard from anon, authenticated;
grant select on public.leaderboard to anon, authenticated;

create function public.begin_match()
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
  insert into public.player_stats (user_id, match_started_at)
  values (uid, now())
  on conflict (user_id) do update set match_started_at = now(), updated_at = now();
end;
$$;

create function public.submit_match(p_kills integer, p_deaths integer, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  stats public.player_stats%rowtype;
  elapsed numeric;
  kill_cap integer;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- O lock impede dois envios simultâneos da mesma partida.
  select * into stats from public.player_stats where user_id = uid for update;
  if not found or stats.match_started_at is null then
    raise exception 'no_open_match';
  end if;

  elapsed := extract(epoch from now() - stats.match_started_at);
  -- O tempo máximo de partida é 20 min; a folga cobre a tela de armas e os resultados.
  if elapsed < 30 or elapsed > 1800 then
    raise exception 'invalid_duration';
  end if;
  if stats.last_match_at is not null and now() - stats.last_match_at < interval '30 seconds' then
    raise exception 'too_soon';
  end if;

  -- Maior limite de kills do lobby é 50. No Gun Game as kills de faca não contam para o limite.
  kill_cap := case p_mode
    when 'ffa' then 50
    when 'tdm' then 50
    when 'gungame' then 60
  end;
  if kill_cap is null then
    raise exception 'invalid_mode';
  end if;
  if p_kills is null or p_kills < 0 or p_kills > least(kill_cap, floor(elapsed / 1.5)) then
    raise exception 'invalid_kills';
  end if;
  -- O respawn leva 3 s.
  if p_deaths is null or p_deaths < 0 or p_deaths > floor(elapsed / 3) then
    raise exception 'invalid_deaths';
  end if;

  update public.player_stats
  set kills = kills + p_kills,
      deaths = deaths + p_deaths,
      matches = matches + 1,
      match_started_at = null,
      last_match_at = now(),
      updated_at = now()
  where user_id = uid;
end;
$$;

-- O Postgres dá EXECUTE para todo mundo por padrão.
revoke execute on function public.begin_match() from public, anon;
revoke execute on function public.submit_match(integer, integer, text) from public, anon;
grant execute on function public.begin_match() to authenticated;
grant execute on function public.submit_match(integer, integer, text) to authenticated;
