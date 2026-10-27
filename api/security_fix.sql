-- ============================================================
-- CORREÇÕES DE SEGURANÇA — ElectroMarket
-- Rode no Supabase: Project > SQL Editor > New query > cole tudo > Run
-- ============================================================

-- ----------------------------------------------------------------
-- PARTE 1 — Invalida senhas antigas (eram só Base64, não um hash
-- de verdade). Força todo mundo a cadastrar uma senha nova e segura
-- na próxima vez que tentar entrar (via "Esqueci minha senha" ou
-- recriando a conta). Troque 'INVALIDA_REFAZER_CADASTRO' por um
-- valor que o /api/auth.js nunca vai aceitar como válido.
-- ----------------------------------------------------------------
update public.users
set senha_hash = 'INVALIDA_REFAZER_CADASTRO'
where senha_hash is not null;

-- ----------------------------------------------------------------
-- PARTE 2 — Corrige qualquer conta que tenha virado ADMIN sem
-- autorização (verifique a lista antes de confirmar o update).
-- Rode primeiro o SELECT abaixo pra ver quem está como ADMIN hoje:
-- ----------------------------------------------------------------
-- select id, nome, email, tipo, created_at from public.users where tipo = 'ADMIN';

-- Se aparecer alguém que você não criou como admin manualmente,
-- rode (trocando o id) para rebaixar:
-- update public.users set tipo = 'CLIENTE' where id = 'COLOQUE_O_ID_AQUI';

-- ----------------------------------------------------------------
-- PARTE 3 — Liga Row Level Security em todas as tabelas.
-- A partir daqui, a chave pública (anon key) só consegue o que for
-- explicitamente liberado pelas policies abaixo. Qualquer escrita
-- (insert/update/delete) passa a precisar ser feita pelo backend
-- (pasta /api, usando a service_role key), não mais direto do navegador.
-- ----------------------------------------------------------------
alter table public.users               enable row level security;
alter table public.products            enable row level security;
alter table public.orders              enable row level security;
alter table public.chats               enable row level security;
alter table public.notifications       enable row level security;
alter table public.avaliacoes          enable row level security;
alter table public.group_invites       enable row level security;
alter table public.group_join_requests enable row level security;

-- Produtos continuam públicos pra leitura (vitrine do site funciona sem login)
drop policy if exists "produtos sao publicos para leitura" on public.products;
create policy "produtos sao publicos para leitura"
on public.products for select
using (true);

-- Nenhuma outra policy é criada de propósito: sem policy de insert/update/
-- delete em products, e sem NENHUMA policy em users/orders/chats/etc, o
-- acesso via chave pública fica negado por padrão. Escrever nessas tabelas
-- passa a exigir a service_role key, usada só dentro de /api/*.js.
