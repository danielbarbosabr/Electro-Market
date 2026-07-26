-- ============================================================
-- ESQUEMA COMPLETO — ElectroMarket (gerado a partir do uso real)
-- Execute no Supabase -> SQL Editor (uma única vez).
-- ============================================================

-- ==================== USERS ====================
create table if not exists public.users (
  id                   uuid primary key default gen_random_uuid(),
  tipo                 text,
  nome                 text,
  cpf                  text,
  email                text,
  telefone             text,
  senha                text,
  avatar               text,
  cidade               text,
  estado               text,
  endereco             text,
  cep                  text,
  vendedor_rating      numeric     default 0,
  rating_count         integer     default 0,
  comprador_rating           numeric     default 0,
  comprador_rating_count     integer     default 0,
  last_seen            timestamptz,
  created_at           timestamptz  default now(),
  updated_at           timestamptz  default now()
);

-- Garante colunas que podem ter sido adicionadas depois
alter table public.users add column if not exists comprador_rating      numeric default 0;
alter table public.users add column if not exists comprador_rating_count integer default 0;
alter table public.users add column if not exists last_seen             timestamptz;
alter table public.users add column if not exists cep                   text;

-- ==================== PRODUCTS ====================
create table if not exists public.products (
  id               text primary key,
  titulo           text,
  descricao        text,
  preco            numeric,
  preco_original   numeric,
  quantidade       integer,
  categoria        text,
  img              text,
  loja             text,
  vendedor_id      text,
  cidade           text,
  realizaentrega   boolean default true,
  likes            integer default 0,
  vendas           integer default 0,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- ==================== ORDERS ====================
create table if not exists public.orders (
  id                   text primary key,
  seller_id            text,
  seller_name          text,
  buyer_id             text,
  buyer_name           text,
  product_id           text,
  product_title        text,
  product_img          text,
  total                numeric,
  quantity             integer     default 1,
  status               text,
  offer_amount         numeric,
  offer_original_price numeric,
  realiza_entrega      boolean     default true,
  agree_buyer          boolean     default false,
  agree_seller         boolean     default false,
  logistics_type       text,
  logistics_method     text,
  buyer_reviewed       boolean     default false,
  seller_reviewed      boolean     default false,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

-- ==================== CHATS ====================
create table if not exists public.chats (
  id               text primary key,
  order_id         text,
  seller_id        text,
  seller_name      text,
  buyer_id         text,
  buyer_name       text,
  participants     jsonb default '[]'::jsonb,
  messages         jsonb default '[]'::jsonb,
  closed           boolean default false,
  is_group         boolean default false,
  group_name       text,
  group_avatar     text,
  logistics_agreed boolean default false,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- ==================== NOTIFICATIONS ====================
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  message    text,
  type       text,
  read       boolean default false,
  created_at timestamptz default now()
);

-- ==================== AVALIACOES ====================
create table if not exists public.avaliacoes (
  id               text primary key,
  order_id         text,
  product_id       text,
  seller_id        text,
  buyer_id         text,
  buyer_name       text,
  tipo             text,
  avaliador_nome   text,
  avaliado_id      text,
  rating           numeric,
  comentario       text,
  images           jsonb default '[]'::jsonb,
  videos           jsonb default '[]'::jsonb,
  avaliador_avatar text default '',
  created_at       timestamptz default now()
);

-- ==================== GROUP INVITES ====================
create table if not exists public.group_invites (
  id         text primary key,
  group_id   text,
  code       text,
  created_by text,
  created_at timestamptz default now(),
  max_uses   integer default 0,
  use_count  integer default 0,
  revoked    boolean default false
);

-- ==================== GROUP JOIN REQUESTS ====================
create table if not exists public.group_join_requests (
  id         text primary key,
  group_id   text,
  user_id    text,
  status     text,
  created_at timestamptz default now()
);

-- ==================== ÍNDICES ====================
create index if not exists idx_users_email             on public.users (email);
create index if not exists idx_notifications_user      on public.notifications (user_id);
create index if not exists idx_chats_order_id          on public.chats (order_id);
create index if not exists idx_chats_seller_id         on public.chats (seller_id);
create index if not exists idx_chats_buyer_id          on public.chats (buyer_id);
create index if not exists idx_products_vendedor_id    on public.products (vendedor_id);
create index if not exists idx_orders_seller_id        on public.orders (seller_id);
create index if not exists idx_orders_buyer_id         on public.orders (buyer_id);
create index if not exists idx_avaliacoes_avaliado_id  on public.avaliacoes (avaliado_id);
