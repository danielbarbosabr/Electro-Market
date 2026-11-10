# ElectroMarket — segurança e deploy

## Como funciona agora
```
Navegador ──(token de sessão)──▶ /api/db   ──▶ Supabase (chave service_role, só no servidor)
          ──────────────────────▶ /api/auth ──▶ login, cadastro, troca e recuperação de senha
```
- O navegador **não tem chave do Supabase**. `/api/config` foi removido (quem rodar o `curl` antigo recebe 404).
- `/api/db` confere a sessão e aplica regras por tabela (quem vê/edita o quê, validação e moderação de anúncios, preço do pedido conferido contra o produto, etc.).
- No banco, **RLS ligado e sem policies**: a chave pública não lê nem grava nada.
- Senhas: scrypt com salt. Sessão: token assinado (HMAC) de 7 dias que **morre quando a senha muda**.

## Passo a passo (nesta ordem)
1. **Supabase → Settings → API / JWT**: gere novas chaves (service_role e secret) e **rotacione o JWT secret**. Troque a senha do banco (Database → Reset password). Tudo que foi colado em prints/chats está comprometido.
2. **Supabase → SQL Editor**: rode `api/security_fix.sql` inteiro. Confira o `select` de ADMINs que ele mostra.
3. **Vercel → Settings → Environment Variables** (Production + Preview):
   - `ELECTRO_MARKET_SUPABASE_URL` e `ELECTRO_MARKET_SUPABASE_SERVICE_ROLE_KEY` (a chave **nova**) — a integração Vercel↔Supabase pode recriá-las; confira os valores.
   - `SESSION_SECRET` = saída de `openssl rand -hex 32`
   - `RESEND_API_KEY`, `RESET_EMAIL_FROM`, `APP_URL=https://mercado-elecmarket.vercel.app`
   - **Apague** `SUPABASE_KEY` e `GOOGLE_CLIENT_ID` se existirem.
4. Suba **todo o conteúdo** desta pasta para a raiz do repositório (o `index.html` precisa ficar na raiz, e a pasta `api/` precisa ir junto) e faça o deploy.
5. Promova para Production (veja "Deploy não muda" abaixo).

## Site em branco? Abra /api/health
`https://SEU-SITE/api/health` mostra (só com sim/não, sem valores) o que falta: URL do Supabase, chave do servidor (e se é mesmo `service_role`), `SESSION_SECRET`, e-mail e se o banco respondeu. Apague `api/health.js` quando tudo estiver ok.

## Testes depois do deploy
```bash
# 1) deve dar 404 (a rota que vazava a chave não existe mais)
curl -i https://mercado-elecmarket.vercel.app/api/config

# 2) deve mostrar os headers novos (X-Frame-Options: DENY ...) => é a versão nova que está no ar
curl -sI https://mercado-elecmarket.vercel.app/ | grep -i -E "x-frame|content-security|x-vercel-id|age"

# 3) com a chave ANON do Supabase o banco tem que estar fechado: [] ou erro, nunca dados
curl 'https://SEU-PROJETO.supabase.co/rest/v1/users?select=*' -H 'apikey: SUA_ANON_KEY'

# 4) anônimo não pode ver pedidos nem e-mails/CPF
curl -s https://mercado-elecmarket.vercel.app/api/db -H 'content-type: application/json' -d '{"method":"GET","path":"orders?select=*"}'
curl -s https://mercado-elecmarket.vercel.app/api/db -H 'content-type: application/json' -d '{"method":"GET","path":"users?select=*"}'
```
Depois entre com uma conta de teste e confira: cadastro, login, criar anúncio, comprar, chat, perfil, trocar senha, "Esqueceu sua senha?".

## Contas antigas
As senhas antigas (Base64) foram invalidadas e apagadas. Quem já tinha conta usa **"Esqueceu sua senha?"** (CPF + código enviado ao e-mail). A conta **ADMIN** também: o código vai para o e-mail dela.

## Recuperação de senha
CPF válido + conta existente → código de 6 dígitos por e-mail (10 min, uso único, bloqueado após 5 erros, máx. 3 pedidos/hora, só o código mais novo vale). Sem o e-mail da conta não há como redefinir, então saber só o CPF não basta. Na tela de login **não há link**, só o código. Se a pessoa não souber o CPF (cancelar/deixar em branco), errar o CPF, o CPF não tiver conta, ou o código falhar/expirar/for bloqueado, a tela oferece abrir o e-mail ao suporte.
Troca no perfil: CPF da própria conta → link por e-mail (30 min, uso único). `alterar_senha` (CPF + senha atual + sessão) também existe na API.

## Limites conhecidos (seja honesto com a banca)
- A tela de resposta "CPF não encontrado" permite descobrir se um CPF está cadastrado. É o comportamento pedido (cair no suporte); o limite de tentativas por IP reduz abuso, mas na Vercel esse limite é por instância. Para algo mais forte use Upstash/Vercel KV.
- O estoque é baixado pelo navegador do comprador (a API só deixa **diminuir**). O ideal é baixar no servidor ao criar o pedido.
- Posts/likes da comunidade ficam na tabela `chats`; qualquer usuário logado ainda consegue editar posts de outros. Mover a comunidade para tabela própria resolve.
- Médias de nota (`vendedor_rating`) ainda são calculadas no navegador; a API só aceita valores entre 0 e 5.
- O site tem ~300 usos de `innerHTML`. A API remove `<` e `>` dos campos que grava, mas o ideal é escapar toda saída (`escapeHTML`).
- CSP: a política completa está em modo **Report-Only** (não quebra o site). Abra o console, use o site, e se não aparecer violação importante, troque `Content-Security-Policy-Report-Only` por `Content-Security-Policy` no `vercel.json`. Depois: fixe versões e adicione SRI (`@rive-app/canvas@latest` ainda é flutuante).
- CORS `*` em arquivos estáticos é padrão da Vercel e não expõe dados (os dados só saem pelas APIs com token).

## Deploy não muda?
Causas mais comuns (confira em Vercel → projeto → Deployments):
1. **Rollback/pin**: se alguém fez "Instant Rollback", o domínio fica preso no deploy antigo até você clicar **Promote to Production** no deploy novo.
2. **Branch errada**: Settings → Git → *Production Branch* precisa ser a branch onde você dá push (ex.: `main`). Push em outra branch gera só Preview.
3. **Pasta aninhada**: o zip do GitHub cria `Electro-Market-main/`. Se subiu a pasta inteira, o `index.html` ficou em subpasta; copie o conteúdo para a raiz (ou ajuste *Root Directory*).
4. **Outro projeto/domínio**: Settings → Domains no projeto certo deve listar `mercado-elecmarket.vercel.app`; se estiver em outro projeto, o site que abre é o de lá.
5. **Build com erro**: abra o deploy e leia Build Logs; um deploy "Error" não vira Production.
6. **Cache**: teste em aba anônima e com `curl -sI` (item 2 dos testes acima).

## Estrutura correta no repositório (raiz)
```
api/ (auth.js, db.js, _lib.js, health.js, schema.sql, security_fix.sql)
css/  js/  index.html  vercel.json  .env.example  .gitignore
```
- Só 3 funções (auth, db, health): o plano Hobby da Vercel aceita até 12.
- **Apague do repositório** `api/config.js`, `api/password_migration.sql` e `api/password_reset_migration.sql` (versões antigas) e qualquer pasta duplicada (ex.: `Electro-Market/`).
