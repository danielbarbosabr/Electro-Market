-- ============================================================
-- Correção de schema para o app funcionar (oferta, chamado, etc.)
-- Cole e execute no Supabase -> SQL Editor (uma única vez).
-- ============================================================

-- ---------- ORDERS: garante TODAS as colunas que o front envia ----------
alter table public.orders
  add column if not exists offer_amount         numeric,
  add column if not exists offer_original_price numeric,
  add column if not exists quantity             integer     default 1,
  add column if not exists realiza_entrega      boolean     default true,
  add column if not exists agree_buyer          boolean     default false,
  add column if not exists agree_seller         boolean     default false,
  add column if not exists logistics_type       text,
  add column if not exists logistics_method     text,
  add column if not exists updated_at           timestamptz default now(),
  add column if not exists buyer_reviewed       boolean     default false,
  add column if not exists seller_reviewed      boolean     default false;

-- ---------- CHATS: garante colunas usadas pelo chamado ----------
alter table public.chats
  add column if not exists closed               boolean     default false;

-- ---------- USERS: tabela usada no cadastro/login ----------
create table if not exists public.users (
  id              uuid primary key default gen_random_uuid(),
  tipo            text,
  nome            text,
  cpf             text,
  email           text,
  telefone        text,
  senha           text,
  avatar          text,
  cidade          text,
  estado          text,
  endereco        text,
  vendedor_rating numeric     default 0,
  rating_count    integer     default 0,
  comprador_rating      numeric     default 0,
  comprador_rating_count integer     default 0,
  created_at      timestamptz  default now(),
  updated_at      timestamptz  default now()
);

-- ---------- NOTIFICATIONS ----------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  message    text,
  type       text,
  read       boolean default false,
  created_at timestamptz default now()
);

-- ---------- AVALIACOES ----------
create table if not exists public.avaliacoes (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid,
  tipo           text,
  avaliador_id   uuid,
  avaliador_nome text,
  avaliado_id    uuid,
  rating         numeric,
  comment        text,
  created_at     timestamptz default now()
);
alter table public.avaliacoes add column if not exists avaliado_id uuid;
alter table public.avaliacoes add column if not exists images jsonb default '[]'::jsonb;
alter table public.avaliacoes add column if not exists videos jsonb default '[]'::jsonb;

-- ---------- ÍNDICES ----------
create index if not exists idx_users_email        on public.users (email);
create index if not exists idx_notifications_user on public.notifications (user_id);
