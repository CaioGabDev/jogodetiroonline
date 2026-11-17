-- Amigos, convites, grupo (party) e fila ranqueada pelo elo.
-- Nada aqui tem grant de tabela: tudo passa pelas funções abaixo, que sempre usam auth.uid().
-- O jogo chama social_poll a cada poucos segundos para saber quem está online, convites e o grupo.

create table public.friendships (
  a uuid not null references auth.users (id) on delete cascade,
  b uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);

create table public.presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen timestamptz not null default now(),
  room text
);

create table public.parties (
  id uuid primary key default gen_random_uuid(),
  leader uuid not null references auth.users (id) on delete cascade,
  room text,
  updated_at timestamptz not null default now()
);

create table public.party_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  party uuid not null references public.parties (id) on delete cascade
);

create table public.invites (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('room', 'party')),
  room text,
  party uuid references public.parties (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index invites_to on public.invites (to_user, created_at);

create table public.mm_queue (
  user_id uuid primary key references auth.users (id) on delete cascade,
  rating integer not null,
  joined_at timestamptz not null default now(),
  match uuid
);

create table public.mm_matches (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  host uuid not null,
  map text not null,
  players uuid[] not null,
  created_at timestamptz not null default now()
);

alter table public.friendships enable row level security;
alter table public.presence enable row level security;
alter table public.parties enable row level security;
alter table public.party_members enable row level security;
alter table public.invites enable row level security;
alter table public.mm_queue enable row level security;
alter table public.mm_matches enable row level security;
revoke all on public.friendships, public.presence, public.parties, public.party_members, public.invites, public.mm_queue, public.mm_matches from anon, authenticated;

-- Código de sala: 6 letras/números maiúsculos, como no jogo.
create or replace function public.valid_room(p_room text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_room is not null and p_room ~ '^[A-Z0-9]{6}$'
$$;

create or replace function public.are_friends(p_x uuid, p_y uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.a = least(p_x, p_y) and f.b = greatest(p_x, p_y) and f.status = 'accepted'
  )
$$;
revoke execute on function public.are_friends(uuid, uuid) from public, anon, authenticated;

-- Tudo de uma vez: marca você como online (na sala p_room, se tiver) e devolve amigos, convites e grupo.
-- Se você lidera um grupo, a sala vai para o grupo, e os outros membros entram nela.
create or replace function public.social_poll(p_room text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_room text := case when public.valid_room(p_room) then p_room end;
  v_party uuid;
  v_friends jsonb;
  v_invites jsonb;
  v_party_json jsonb;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  insert into public.presence (user_id, last_seen, room) values (uid, now(), v_room)
  on conflict (user_id) do update set last_seen = now(), room = v_room;

  select party into v_party from public.party_members where user_id = uid;
  if v_party is not null then
    update public.parties set room = v_room, updated_at = now() where id = v_party and leader = uid and room is distinct from v_room;
  end if;

  delete from public.invites where created_at < now() - interval '2 minutes';

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'avatar', p.avatar_url,
      'status', case when f.status = 'accepted' then 'accepted' when f.requested_by = uid then 'outgoing' else 'incoming' end,
      'online', coalesce(pr.last_seen > now() - interval '40 seconds', false),
      'room', case when pr.last_seen > now() - interval '40 seconds' then pr.room end
    ) order by (pr.last_seen > now() - interval '40 seconds') desc nulls last, lower(p.username)), '[]'::jsonb)
  into v_friends
  from public.friendships f
  join public.profiles p on p.id = case when f.a = uid then f.b else f.a end
  left join public.presence pr on pr.user_id = p.id
  where f.a = uid or f.b = uid;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'kind', i.kind, 'room', i.room, 'from', i.from_user, 'name', p.username
    ) order by i.created_at), '[]'::jsonb)
  into v_invites
  from public.invites i
  join public.profiles p on p.id = i.from_user
  where i.to_user = uid;

  if v_party is not null then
    select jsonb_build_object(
      'id', pa.id,
      'leader', pa.leader,
      'room', pa.room,
      'members', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'id', pm.user_id,
            'username', p.username,
            'online', coalesce(pr.last_seen > now() - interval '40 seconds', false)
          ) order by p.username), '[]'::jsonb)
        from public.party_members pm
        join public.profiles p on p.id = pm.user_id
        left join public.presence pr on pr.user_id = pm.user_id
        where pm.party = pa.id
      )
    ) into v_party_json
    from public.parties pa where pa.id = v_party;
  end if;

  return jsonb_build_object('friends', v_friends, 'invites', v_invites, 'party', v_party_json);
end;
$$;

-- Pedido de amizade pelo nome. Se a outra pessoa já tinha pedido, vira amizade.
create or replace function public.friend_request(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_other uuid;
  f public.friendships%rowtype;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select id into v_other from public.profiles where lower(username) = lower(btrim(p_username));
  if v_other is null then
    return 'not_found';
  end if;
  if v_other = uid then
    return 'self';
  end if;
  select * into f from public.friendships where a = least(uid, v_other) and b = greatest(uid, v_other);
  if found then
    if f.status = 'accepted' then
      return 'exists';
    end if;
    if f.requested_by <> uid then
      update public.friendships set status = 'accepted' where a = f.a and b = f.b;
      return 'accepted';
    end if;
    return 'exists';
  end if;
  if (select count(*) from public.friendships where (a = uid or b = uid)) >= 200 then
    return 'full';
  end if;
  insert into public.friendships (a, b, status, requested_by) values (least(uid, v_other), greatest(uid, v_other), 'pending', uid);
  return 'ok';
end;
$$;

-- Aceita ou recusa um pedido recebido.
create or replace function public.friend_respond(p_user uuid, p_accept boolean)
returns boolean
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
  if p_accept then
    update public.friendships set status = 'accepted'
    where a = least(uid, p_user) and b = greatest(uid, p_user) and status = 'pending' and requested_by = p_user;
  else
    delete from public.friendships
    where a = least(uid, p_user) and b = greatest(uid, p_user) and status = 'pending' and requested_by = p_user;
  end if;
  return found;
end;
$$;

-- Desfaz a amizade (ou cancela o pedido enviado).
create or replace function public.friend_remove(p_user uuid)
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
  delete from public.friendships where a = least(uid, p_user) and b = greatest(uid, p_user);
end;
$$;

-- Convida um amigo para a sala em que você está, ou para o seu grupo (que é criado se ainda não existir).
create or replace function public.invite_friend(p_user uuid, p_kind text, p_room text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_party uuid;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.are_friends(uid, p_user) then
    return 'not_friends';
  end if;
  if exists (select 1 from public.invites where from_user = uid and to_user = p_user and created_at > now() - interval '10 seconds') then
    return 'wait';
  end if;
  if p_kind = 'room' then
    if not public.valid_room(p_room) then
      return 'no_room';
    end if;
    insert into public.invites (from_user, to_user, kind, room) values (uid, p_user, 'room', p_room);
    return 'ok';
  elsif p_kind = 'party' then
    select party into v_party from public.party_members where user_id = uid;
    if v_party is null then
      insert into public.parties (leader) values (uid) returning id into v_party;
      insert into public.party_members (user_id, party) values (uid, v_party);
    end if;
    if (select count(*) from public.party_members where party = v_party) >= 5 then
      return 'full';
    end if;
    insert into public.invites (from_user, to_user, kind, party) values (uid, p_user, 'party', v_party);
    return 'ok';
  end if;
  return 'unknown';
end;
$$;

-- Aceitar (entrar no grupo do convite) ou descartar um convite.
create or replace function public.invite_answer(p_invite bigint, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  i public.invites%rowtype;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  delete from public.invites where id = p_invite and to_user = uid returning * into i;
  if not found then
    return 'gone';
  end if;
  if not p_accept or i.kind <> 'party' then
    return 'ok';
  end if;
  if not exists (select 1 from public.parties where id = i.party) then
    return 'gone';
  end if;
  perform public.party_leave();
  if (select count(*) from public.party_members where party = i.party) >= 5 then
    return 'full';
  end if;
  insert into public.party_members (user_id, party) values (uid, i.party);
  return 'ok';
end;
$$;

-- Sai do grupo. Se era o líder, o próximo vira líder; o último a sair desfaz o grupo.
create or replace function public.party_leave()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_party uuid;
  v_next uuid;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  delete from public.party_members where user_id = uid returning party into v_party;
  if v_party is null then
    return;
  end if;
  select user_id into v_next from public.party_members where party = v_party order by user_id limit 1;
  if v_next is null then
    delete from public.parties where id = v_party;
  else
    update public.parties set leader = v_next where id = v_party and leader = uid;
  end if;
end;
$$;

-- Fila ranqueada: entra com o seu elo.
create or replace function public.mm_join()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_rating integer;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select coalesce(rating, 0) into v_rating from public.player_stats where user_id = uid;
  insert into public.mm_queue (user_id, rating) values (uid, coalesce(v_rating, 0))
  on conflict (user_id) do update set rating = excluded.rating, joined_at = now(), match = null;
end;
$$;

create or replace function public.mm_leave()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.mm_queue where user_id = auth.uid() and match is null;
end;
$$;

-- Procura partida. A janela de elo começa em ±150 e abre 15 por segundo de espera (até ±1000).
-- Com 6 jogadores na janela, ou 2 ou mais depois de 40 s, forma a partida: quem formou é o host.
create or replace function public.mm_poll()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me public.mm_queue%rowtype;
  m public.mm_matches%rowtype;
  v_window integer;
  v_wait double precision;
  v_players uuid[];
  v_code text;
  v_map text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  select * into me from public.mm_queue where user_id = uid;
  if not found then
    return jsonb_build_object('state', 'idle');
  end if;
  delete from public.mm_queue where joined_at < now() - interval '15 minutes';
  delete from public.mm_matches where created_at < now() - interval '10 minutes';

  if me.match is null then
    v_wait := extract(epoch from now() - me.joined_at);
    v_window := least(1000, 150 + floor(v_wait * 15)::integer);
    select array_agg(q.user_id order by q.joined_at) into v_players
    from (
      select user_id, joined_at from public.mm_queue
      where match is null and abs(rating - me.rating) <= v_window
      order by (user_id = uid) desc, joined_at
      limit 6
      for update skip locked
    ) q;
    if coalesce(array_length(v_players, 1), 0) >= 6 or (coalesce(array_length(v_players, 1), 0) >= 2 and v_wait >= 40) then
      v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      v_map := (array['arena', 'mirante', 'galpao', 'vila', 'centro', 'patio'])[1 + floor(random() * 6)::integer];
      insert into public.mm_matches (code, host, map, players) values (v_code, uid, v_map, v_players) returning * into m;
      update public.mm_queue set match = m.id where user_id = any (v_players);
    else
      return jsonb_build_object('state', 'searching', 'window', v_window,
        'nearby', (select count(*) from public.mm_queue where match is null and abs(rating - me.rating) <= v_window));
    end if;
  else
    select * into m from public.mm_matches where id = me.match;
    if not found then
      update public.mm_queue set match = null, joined_at = now() where user_id = uid;
      return jsonb_build_object('state', 'searching', 'window', 150, 'nearby', 1);
    end if;
  end if;

  -- Achou: sai da fila e recebe a sala.
  delete from public.mm_queue where user_id = uid;
  return jsonb_build_object('state', 'found', 'code', m.code, 'host', m.host = uid, 'map', m.map, 'players', array_length(m.players, 1));
end;
$$;

revoke execute on function public.social_poll(text), public.friend_request(text), public.friend_respond(uuid, boolean),
  public.friend_remove(uuid), public.invite_friend(uuid, text, text), public.invite_answer(bigint, boolean),
  public.party_leave(), public.mm_join(), public.mm_leave(), public.mm_poll() from public, anon;
grant execute on function public.social_poll(text), public.friend_request(text), public.friend_respond(uuid, boolean),
  public.friend_remove(uuid), public.invite_friend(uuid, text, text), public.invite_answer(bigint, boolean),
  public.party_leave(), public.mm_join(), public.mm_leave(), public.mm_poll() to authenticated;
