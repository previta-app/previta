-- Contador de usuários do PREVITA: cada aparelho conta UMA vez.
-- O total antigo (contador de acessos do Worker) é guardado como base e não muda;
-- a partir daí só somam aparelhos novos. Abrir o app de novo, ou entrar logado, não soma.
create table if not exists public.previta_contador(id int primary key default 1 check (id=1), base bigint not null, definida_em timestamptz not null default now());
create table if not exists public.previta_dispositivos(id uuid primary key, novo boolean not null, criado_em timestamptz not null default now());
alter table public.previta_contador enable row level security;
alter table public.previta_dispositivos enable row level security;
revoke all on public.previta_contador, public.previta_dispositivos from anon, authenticated;

-- p_novo = aparelho que nunca tinha aberto o app (os antigos já estão dentro da base)
create or replace function public.previta_contar(p_id uuid, p_novo boolean) returns jsonb
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare b bigint;
begin
  if p_id is not null then
    insert into public.previta_dispositivos(id, novo) values (p_id, coalesce(p_novo,false)) on conflict (id) do nothing;
  end if;
  select base into b from public.previta_contador where id=1;
  return jsonb_build_object('base_definida', b is not null,
    'total', coalesce(b,0) + (select count(*) from public.previta_dispositivos where novo));
end $$;

-- Grava o total antigo uma única vez (a primeira chamada vale; as outras são ignoradas)
create or replace function public.previta_definir_base(p_total bigint) returns jsonb
language plpgsql volatile security definer set search_path=public,pg_temp as $$
begin
  if p_total is not null and p_total >= 0 then
    insert into public.previta_contador(id, base) values (1, p_total) on conflict (id) do nothing;
  end if;
  return public.previta_contar(null, false);
end $$;

revoke all on function public.previta_contar(uuid,boolean), public.previta_definir_base(bigint) from public;
grant execute on function public.previta_contar(uuid,boolean), public.previta_definir_base(bigint) to anon, authenticated;
