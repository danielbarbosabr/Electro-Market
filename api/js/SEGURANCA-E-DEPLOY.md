# ElectroMarket — integração Supabase/Vercel e troca de senha

## Variáveis da integração
O frontend recebe somente a URL e a chave pública. `api/config.js` reconhece os nomes criados pela integração Vercel:
- `ELECTRO_MARKET_SUPABASE_URL` ou `NEXT_PUBLIC_ELECTRO_MARKET_SUPABASE_URL`
- `ELECTRO_MARKET_SUPABASE_ANON_KEY`, `ELECTRO_MARKET_SUPABASE_PUBLISHABLE_KEY` ou `NEXT_PUBLIC_ELECTRO_MARKET_SUPABASE_PUBLISHABLE_KEY`

As funções serverless usam `ELECTRO_MARKET_SUPABASE_SERVICE_ROLE_KEY` (preferencial), `SUPABASE_SERVICE_ROLE_KEY` ou `ELECTRO_MARKET_SUPABASE_SECRET_KEY`. Cadastre a chave administrativa nova somente como variável de ambiente server-side na Vercel, sem prefixo `NEXT_PUBLIC_`.

## Troca de senha no perfil
A seção Segurança e senha pede CPF, senha atual, nova senha e confirmação. A validação e a gravação são feitas em `/api/auth` no servidor. A senha é armazenada com scrypt. A conta precisa ter `senha_hash` preenchido com hash scrypt válido; contas antigas com hashes em formato legado precisam de migração/reset seguro antes de usar a troca de senha. Não copie senha em texto puro para `senha_hash`.

Execute `api/password_migration.sql` no SQL Editor para criar a coluna caso não exista. O script é aditivo e não apaga dados.

## Deploy
1. Rotacione imediatamente todas as credenciais que foram expostas (service role/secret, senha PostgreSQL e JWT secret conforme o procedimento do Supabase). Não reutilize os valores publicados em chats/imagens.
2. Na Vercel, confirme a URL e a chave pública da integração; adicione a nova chave administrativa como `ELECTRO_MARKET_SUPABASE_SERVICE_ROLE_KEY` em Production, Preview e Development conforme necessário.
3. Execute `api/password_migration.sql` no Supabase.
4. Faça commit/push do projeto completo. A pasta `api/` deve estar no Git.
5. Faça redeploy e teste `GET /api/config`: a resposta pode conter somente `SUPABASE_URL`, `SUPABASE_KEY` (publicável/anon) e `GOOGLE_CLIENT_ID`. Nunca pode conter `service_role`, `secret`, senha PostgreSQL ou JWT secret.
6. Teste a troca de senha com uma conta de teste e CPF válido. Verifique também que usuário não consegue alterar senha de outra conta mudando `userId`.

## Limitação importante de segurança
Esta atualização corrige a exposição de segredos em `/api/config`, adapta os nomes das variáveis e adiciona o fluxo server-side de troca de senha. Ela NÃO conclui a auditoria de autorização do restante do marketplace. As operações antigas do frontend ainda usam a chave pública diretamente; é obrigatório habilitar RLS e criar políticas específicas para cada tabela/ação antes de produção. Não execute uma política genérica permissiva. Revise também autorização de admin/vendedor, CORS, CSP, validação/sanitização de anúncios e logs.
