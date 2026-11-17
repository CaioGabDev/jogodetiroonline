-- Caixas: as skins especiais (as que tinham preço) agora só saem de caixas; não se compram mais direto.
-- As de patente (preço 0) continuam grátis ao chegar no nível.
-- Mesmas caixas, preços e chances de src/game/cases.ts.

-- Raridade pelo preço antigo da skin. Mesma regra de tierOf em src/game/cases.ts.
create or replace function public.skin_tier(p_slot text, p_price integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_price <= 0 then null
    when p_slot = 'faca' then
      case when p_price < 3000 then 'raro' when p_price < 8000 then 'epico' else 'lendario' end
    else
      case when p_price < 2000 then 'comum' when p_price < 5000 then 'raro' when p_price < 10000 then 'epico' else 'lendario' end
  end
$$;

-- Abre uma caixa: cobra, sorteia aqui no banco e guarda a skin. Repetida devolve metade do preço.
-- A conta de dev não paga.
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
  v_roll double precision;
  v_tier text;
  v_skin text;
  v_dup boolean;
  v_refund integer := 0;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_case = 'armas' then
    v_price := 1200;
    v_slot := 'arma';
  elsif p_case = 'facas' then
    v_price := 2500;
    v_slot := 'faca';
  else
    return jsonb_build_object('result', 'unknown');
  end if;

  insert into public.player_stats (user_id) values (uid) on conflict (user_id) do nothing;
  select * into s from public.player_stats where user_id = uid for update;
  if not s.dev and s.coins < v_price then
    return jsonb_build_object('result', 'coins');
  end if;

  -- Chances em %, da mais rara para a mais comum.
  v_roll := random() * 100;
  if v_slot = 'arma' then
    v_tier := case when v_roll < 4 then 'lendario' when v_roll < 14 then 'epico' when v_roll < 40 then 'raro' else 'comum' end;
  else
    v_tier := case when v_roll < 7 then 'lendario' when v_roll < 30 then 'epico' else 'raro' end;
  end if;

  select sk.id into v_skin
  from public.skins sk
  where sk.slot = v_slot and public.skin_tier(sk.slot, sk.price) = v_tier
  order by random()
  limit 1;
  if v_skin is null then
    raise exception 'empty_case';
  end if;

  v_dup := v_skin = any (s.bought_skins);
  if v_dup and not s.dev then
    v_refund := v_price / 2;
  end if;

  update public.player_stats
  set coins = case when s.dev then coins else coins - v_price + v_refund end,
      bought_skins = case when v_dup then bought_skins else array_append(bought_skins, v_skin) end,
      updated_at = now()
  where user_id = uid;

  return jsonb_build_object('result', 'ok', 'skin', v_skin, 'dup', v_dup, 'refund', v_refund);
end;
$$;

revoke execute on function public.open_case(text) from public, anon;
grant execute on function public.open_case(text) to authenticated;

-- Compra direta acabou: as skins especiais só vêm das caixas.
revoke execute on function public.buy_skin(text) from public, anon, authenticated;
