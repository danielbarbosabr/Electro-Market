-- Migração aditiva para armazenamento seguro de senhas.
-- Execute no Supabase SQL Editor. Não apaga nem sobrescreve senhas existentes.
alter table public.users add column if not exists senha_hash text;
