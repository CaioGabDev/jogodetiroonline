-- Missões diárias e semanais: o banco paga cada missão uma vez por dia/semana (horário de Brasília).
-- Mesmos ids, recompensas e períodos de src/game/missions.ts.
-- O progresso (quantos alvos, abates...) é contado no navegador, já que o treino é offline;
-- o banco garante que cada missão só paga uma vez por período, então o máximo por dia/semana é fixo.

create table public.mission_claims (
  user_id uuid not null references auth.users (id) on delete cascade,
  mission_id text not null,
  period date not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, mission_id, period)
);
alter table public.mission_claims enable row level security;
-- Sem policy nem grant: só a função abaixo mexe aqui.
revoke all on public.mission_claims from anon, authenticated;

create or replace function public.claim_mission(p_mission text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_reward integer;
  v_period text;
  v_key date;
  v_rows integer;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select m.reward, m.period into v_reward, v_period
  from (values
    ('d_alvos', 300, 'daily'),
    ('d_alvos_hs', 200, 'daily'),
    ('d_mira', 200, 'daily'),
    ('d_abates', 250, 'daily'),
    ('d_vitoria', 300, 'daily'),
    ('w_alvos', 1500, 'weekly'),
    ('w_mira', 1000, 'weekly'),
    ('w_abates', 1500, 'weekly'),
    ('w_hs', 1000, 'weekly'),
    ('w_vitorias', 2000, 'weekly')
  ) as m (id, reward, period)
  where m.id = p_mission;
  if not found then
    return 'unknown';
  end if;

  v_key := case when v_period = 'daily'
    then (now() at time zone 'America/Sao_Paulo')::date
    else date_trunc('week', now() at time zone 'America/Sao_Paulo')::date
  end;

  insert into public.mission_claims (user_id, mission_id, period) values (uid, p_mission, v_key)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'claimed';
  end if;

  insert into public.player_stats (user_id) values (uid) on conflict (user_id) do nothing;
  update public.player_stats set coins = coins + v_reward, updated_at = now() where user_id = uid;
  return 'ok';
end;
$$;

revoke execute on function public.claim_mission(text) from public, anon;
grant execute on function public.claim_mission(text) to authenticated;
