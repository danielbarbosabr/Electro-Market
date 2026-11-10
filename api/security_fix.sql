-- ============================================================================
-- ElectroMarket — CORREÇÕES DE SEGURANÇA (rode UMA vez no Supabase > SQL Editor)
-- Pode rodar de novo sem problema: tudo aqui é idempotente.
-- ============================================================================

-- ---------------------------------------------------------------- 1) Colunas / tabelas usadas pela API
alter table public.users add column if not exists senha_hash text;

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_tokens_user_idx on public.password_reset_tokens(user_id);

create table if not exists public.password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.password_reset_codes add column if not exists attempts integer not null default 0;
create index if not exists password_reset_codes_user_idx on public.password_reset_codes(user_id);

-- Se as tabelas acima já existiam com user_id do tipo uuid e a sua coluna users.id for texto (ex.: "user_1784..."),
-- troque o tipo para text:
-- alter table public.password_reset_codes  alter column user_id type text using user_id::text;
-- alter table public.password_reset_tokens alter column user_id type text using user_id::text;

-- ---------------------------------------------------------------- 2) Apagar senhas antigas (Base64 = "senha" legível)
-- Os hashes Base64 vazaram. Eles já não funcionam para entrar; aqui eles são APAGADOS do banco.
-- Quem tinha conta antiga usa "Esqueceu sua senha?" (CPF + código no e-mail) para criar uma senha nova.
-- Contas criadas depois (formato "salt:hash") NÃO são tocadas.
-- a coluna pode ter sido criada como NOT NULL; contas antigas ficam sem senha até redefinirem
alter table public.users alter column senha_hash drop not null;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='senha') then
    execute 'alter table public.users alter column senha drop not null';
  end if;
end $$;
update public.users set senha_hash = null where senha_hash is not null and senha_hash not like '%:%';
-- se existir a coluna antiga "senha" com texto/Base64, esvazie também:
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='senha') then
    execute 'update public.users set senha = null where senha is not null';
  end if;
end $$;

-- ---------------------------------------------------------------- 3) Quem é ADMIN? Confira e rebaixe quem não deveria
select id, nome, email, tipo, created_at from public.users where tipo = 'ADMIN';
-- update public.users set tipo = 'CLIENTE' where id = 'COLOQUE_O_ID_AQUI';

-- ---------------------------------------------------------------- 4) Limpar HTML/JS já gravado em anúncios e perfis (XSS armazenado)
update public.products set
  titulo    = regexp_replace(coalesce(titulo,''),    '[<>]', '', 'g'),
  descricao = regexp_replace(coalesce(descricao,''), '[<>]', '', 'g'),
  loja      = regexp_replace(coalesce(loja,''),      '[<>]', '', 'g')
where titulo ~ '[<>]' or descricao ~ '[<>]' or loja ~ '[<>]';
update public.users set nome = regexp_replace(nome, '[<>]', '', 'g') where nome ~ '[<>]';
-- Anúncios inválidos (preço nulo ou negativo). Preço 0 é permitido: é doação.
select id, titulo, preco, vendedor_id from public.products where preco is null or preco < 0;

-- ---------------------------------------------------------------- 5) O PASSO MAIS IMPORTANTE: RLS ligado e NENHUMA policy
-- Com RLS ligado e sem policies, as chaves públicas (anon/publishable) NÃO leem nem gravam nada.
-- Só o servidor (/api/*, que usa a chave service_role guardada na Vercel) acessa o banco.
alter table public.users                enable row level security;
alter table public.products             enable row level security;
alter table public.orders               enable row level security;
alter table public.chats                enable row level security;
alter table public.notifications        enable row level security;
alter table public.avaliacoes           enable row level security;
alter table public.password_reset_tokens enable row level security;
alter table public.password_reset_codes  enable row level security;
do $$ begin
  if to_regclass('public.group_invites') is not null then execute 'alter table public.group_invites enable row level security'; end if;
  if to_regclass('public.group_join_requests') is not null then execute 'alter table public.group_join_requests enable row level security'; end if;
end $$;

-- Remove policies antigas permissivas que possam existir (ex.: "using (true)"):
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Teste: com a chave ANON, isto deve devolver [] (ou erro de permissão), nunca os dados:
--   curl 'https://SEU-PROJETO.supabase.co/rest/v1/users?select=*' -H 'apikey: SUA_ANON_KEY'
