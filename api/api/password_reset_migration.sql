-- Execute no Supabase SQL Editor antes de habilitar a recuperação de senha.
create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_tokens_user_id_idx on public.password_reset_tokens(user_id);
create index if not exists password_reset_tokens_expires_at_idx on public.password_reset_tokens(expires_at);
alter table public.password_reset_tokens enable row level security;
-- A tabela é acessada exclusivamente pela API usando a service role no servidor.


-- Códigos numéricos de recuperação enviados ao e-mail cadastrado.
create table if not exists public.password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_codes_user_id_idx on public.password_reset_codes(user_id);
create index if not exists password_reset_codes_expires_at_idx on public.password_reset_codes(expires_at);
alter table public.password_reset_codes enable row level security;
