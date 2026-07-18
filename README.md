# 🛒 ElectroMarket

**Marketplace de Eletrônicos – Projeto Acadêmico**

![Badge](https://img.shields.io/badge/status-em%20desenvolvimento-green)
![Badge](https://img.shields.io/badge/versão-2.0.0-blue)
![Badge](https://img.shields.io/badge/licença-MIT-yellow)

---

## 📋 Sobre o Projeto

O **ElectroMarket** é uma plataforma web de compra e venda de produtos eletrônicos, desenvolvida como projeto integrador do curso de graduação. A aplicação simula um marketplace completo, permitindo que usuários se cadastrem como **clientes** ou **vendedores**, anunciem produtos, realizem pedidos e negociem entregas através de um **chat em tempo real**.

O sistema foi construído com foco em:
- Arquitetura **serverless** (front-end + Backend as a Service)
- Experiência de usuário rica com **animações interativas**
- Design responsivo (mobile-first) com scrollbar customizada estilo Mercado Livre
- Gerenciamento real de estado via **Supabase**

---

## 🚀 Funcionalidades

### 🔐 Autenticação
- Cadastro com validação de CPF e busca automática de endereço por **CEP (ViaCEP)**
- Login com senha (hash) ou por telefone
- Tela de autenticação interativa com o mascote **"Yeti"** que reage aos campos (piscar, cobrir os olhos na senha, seguir o texto)
- Recuperação de senha via chamado de suporte

### 🏪 Marketplace
- Listagem de produtos em grid responsivo (6 colunas desktop, 2 mobile)
- Filtros por preço, categoria, loja, forma de recebimento e localização do vendedor
- Ordenação por destaque, recentes, mais curtidos, menor/maior preço
- Detalhes do produto com galeria de imagens, seção de avaliações e reputação do vendedor
- Sistema de **ofertas**: vendedor pode fazer uma oferta com preço especial

### 🛍️ Carrinho de Compras
- Adicionar/remover itens, alterar quantidade (respeita estoque)
- Finalização de compra que gera um **pedido** automático
- Proteção: exige login para acessar o carrinho

### 📦 Gestão de Pedidos
- **Cliente**: acompanha status (`Em Aprovação → Preparando → Enviado → Entregue`), pode solicitar compra
- **Vendedor**: aceita/recusa pedidos, gerencia ofertas, visualiza vendas
- **Chat integrado** entre comprador e vendedor para negociar logística, fotos e arquivos
- Sistema de **avaliações** após a conclusão do pedido

### 💬 Chat em Tempo Real
- Envio de mensagens de texto, imagens e arquivos
- Sistema de resposta (reply), edição e exclusão de mensagens
- Reações com emojis
- Links detectados automaticamente e clicáveis
- Transcrição de voz para texto (Web Speech API)
- Área de logística: combinar retirada, entrega pelo vendedor ou app externo
- **Suporte**: chat de atendimento com categorias (esqueci senha, problema com pedido, etc.)

### 👤 Perfil do Usuário
- Edição de dados pessoais, avatar e banner da loja
- Modo escuro (dark theme) persistente
- Cores por tipo de conta: Cliente=azul, Vendedor=amarelo, Admin=vermelho
- Painel administrativo completo (gerenciar usuários, produtos, pedidos, chats, suporte)

### 🛠️ Admin
- Painel com abas: Dashboard, Usuários, Produtos, Pedidos, Chats, Suporte, Conteúdo
- Editar/apagar produtos, gerenciar pedidos, responder chamados de suporte
- Visualizar estatísticas (totais, receita, gráficos)
- Sincronizar banco de dados e atualizar schema

---

## 🛠️ Tecnologias Utilizadas

| Camada | Tecnologia |
|--------|------------|
| **Front-end** | HTML5, CSS3, JavaScript (Vanilla) |
| **Estilização** | Bootstrap 5.3, Bootstrap Icons, CSS Custom Properties |
| **Animações** | GSAP (TweenMax + MorphSVGPlugin) para o mascote Yeti |
| **Backend / Banco** | [Supabase](https://supabase.com/) (PostgreSQL + API REST) |
| **APIs externas** | ViaCEP (busca de endereço por CEP), Web Speech API (transcrição de voz) |
| **Hospedagem** | Vercel (sugestão) ou qualquer servidor estático |

---

## 📁 Estrutura do Projeto

```
electromarket/
├── index.html                # Página principal (SPA única)
├── css/
│   ├── style.desktop.css     # Estilos desktop (5780+ linhas)
│   └── style.mobile.css      # Estilos mobile responsivos
├── js/
│   ├── script.js             # Lógica principal (autenticação, marketplace, chat, admin)
│   ├── admin.js              # Funções do painel administrativo
│   ├── seller.js             # Funções do vendedor (produtos, pedidos, chat)
│   ├── client.js             # Funções específicas do cliente
│   └── config.local.js       # Configurações locais (credenciais)
├── api/
│   ├── fix_schema.sql        # Script SQL para criar/corrigir schema
│   └── config.js             # Configuração da API
├── products.json             # Dados de exemplo (fallback)
└── README.md                 # Documentação do projeto
```

---

## 🗄️ Schema do Banco (Supabase/PostgreSQL)

Execute no **SQL Editor** do Supabase:

```sql
-- ============================================================
-- Users
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo                   TEXT,
    nome                   TEXT,
    cpf                    TEXT,
    email                  TEXT,
    telefone               TEXT,
    senha                  TEXT,
    avatar                 TEXT,
    cidade                 TEXT,
    estado                 TEXT,
    endereco               TEXT,
    vendedor_rating        NUMERIC DEFAULT 0,
    rating_count           INTEGER DEFAULT 0,
    comprador_rating       NUMERIC DEFAULT 0,
    comprador_rating_count INTEGER DEFAULT 0,
    created_at             TIMESTAMPTZ DEFAULT NOW(),
    updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Products
-- ============================================================
CREATE TABLE IF NOT EXISTS public.products (
    id              TEXT PRIMARY KEY,
    titulo          TEXT NOT NULL,
    descricao       TEXT,
    preco           NUMERIC NOT NULL DEFAULT 0,
    preco_original  NUMERIC,
    quantidade      INTEGER DEFAULT 1,
    categoria       TEXT DEFAULT 'Geral',
    realizaentrega  BOOLEAN DEFAULT FALSE,
    img             TEXT,
    loja            TEXT,
    cidade          TEXT,
    vendas          INTEGER DEFAULT 0,
    vendedor_id     TEXT,
    likes           INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Orders
-- ============================================================
CREATE TABLE IF NOT EXISTS public.orders (
    id                   TEXT PRIMARY KEY,
    seller_id            TEXT,
    seller_name          TEXT,
    buyer_id             TEXT,
    buyer_name           TEXT,
    product_id           TEXT,
    product_title        TEXT,
    product_img          TEXT,
    total                NUMERIC DEFAULT 0,
    quantity             INTEGER DEFAULT 1,
    status               TEXT DEFAULT 'pending',
    realiza_entrega      BOOLEAN DEFAULT TRUE,
    agree_buyer          BOOLEAN DEFAULT FALSE,
    agree_seller         BOOLEAN DEFAULT FALSE,
    logistics_type       TEXT,
    logistics_method     TEXT,
    offer_amount         NUMERIC,
    offer_original_price NUMERIC,
    buyer_reviewed       BOOLEAN DEFAULT FALSE,
    seller_reviewed      BOOLEAN DEFAULT FALSE,
    dispute_reason       TEXT,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Chats (também usado para chamados de suporte)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chats (
    id               TEXT PRIMARY KEY,
    order_id         TEXT,
    seller_id        TEXT,
    buyer_id         TEXT,
    seller_name      TEXT,
    buyer_name       TEXT,
    participants     TEXT[],
    messages         JSONB DEFAULT '[]'::JSONB,
    logistics_agreed BOOLEAN DEFAULT FALSE,
    closed           BOOLEAN DEFAULT FALSE,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID,
    message    TEXT,
    type       TEXT,
    read       BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Avaliações (reviews)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.avaliacoes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       UUID,
    tipo           TEXT,
    avaliador_id   UUID,
    avaliador_nome TEXT,
    avaliado_id    UUID,
    rating         NUMERIC,
    comment        TEXT,
    images         JSONB DEFAULT '[]'::JSONB,
    videos         JSONB DEFAULT '[]'::JSONB,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_users_email        ON public.users (email);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id);
```

### RLS (desenvolvimento)

```sql
ALTER TABLE public.users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avaliacoes    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all_users"         ON public.users         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_products"      ON public.products      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_orders"        ON public.orders        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_chats"         ON public.chats         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_notifications" ON public.notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_avaliacoes"    ON public.avaliacoes    FOR ALL USING (true) WITH CHECK (true);
```

### Configurar credenciais

Edite `js/config.local.js` ou o início do `js/script.js`:

```javascript
const SUPABASE_URL = 'https://SEU_PROJETO.supabase.co';
const SUPABASE_KEY = 'SUA_CHAVE_ANON';
```

---

## 🖥️ Como Executar Localmente

1. Clone o repositório:

```bash
git clone https://github.com/seuusuario/electromarket.git
cd electromarket
```

2. Abra o arquivo `index.html` no navegador ou use **Live Server** no VS Code.

3. Execute o script `api/fix_schema.sql` no SQL Editor do Supabase.

4. Configure as credenciais do Supabase no `js/config.local.js`.

---

## 🌐 Demonstração Online

[https://eletromarket-pi.vercel.app/](https://eletromarket-pi.vercel.app/)

---

## 👥 Equipe

| Nome | Função |
|------|--------|
| Daniel Barbosa de Lima | Desenvolvedor Full Stack |
| Colega 1 | Documentação / Testes |
| Colega 2 | Design / UI/UX |

---

## 📄 Licença

Este projeto é parte de um trabalho acadêmico sob licença MIT.

---

## 🙏 Agradecimentos

- [Supabase](https://supabase.com/) pelo backend gratuito
- [GSAP](https://gsap.com/) pelas animações
- [ViaCEP](https://viacep.com.br/) pela API de CEP
- CodePen pelo SVG do Yeti original

---

Feito com 💚 para a disciplina de Projeto Integrador
