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
- Design responsivo (mobile-first)
- Gerenciamento real de estado via **Supabase**

---

## 🚀 Funcionalidades

### 🔐 Autenticação
- Cadastro com validação de CPF e busca automática de endereço por **CEP (ViaCEP)**
- Login com senha criptografada (hash)
- Tela de autenticação interativa com o mascote **"Yeti"** que reage aos campos (piscar, cobrir os olhos na senha, seguir o texto)

### 🏪 Marketplace
- Listagem de produtos em grid responsivo (6 colunas desktop, 2 mobile)
- Filtros por preço, loja e cidade do vendedor
- Ordenação por menor/maior preço
- Detalhes do produto com galeria de imagens e barra de reputação do vendedor

### 🛍️ Carrinho de Compras
- Adicionar/remover itens, alterar quantidade
- Finalização de compra que gera um **pedido** automático

### 📦 Gestão de Pedidos
- Cliente: acompanha status da compra (`Em Aprovação → Entregue`)
- Vendedor: aceita/recusa pedidos, visualiza histórico de vendas
- **Chat integrado** entre comprador e vendedor para negociar detalhes (logística, fotos, arquivos)

### 💬 Chat em Tempo Real
- Envio de mensagens de texto, imagens e arquivos
- Sistema de resposta e edição de mensagens
- Links são automaticamente detectados e clicáveis
- Área de logística: combinar retirada, entrega pelo vendedor ou app externo (Uber Flash, 99 Entrega, Loggi)

### 👤 Perfil do Usuário
- Edição de dados pessoais, avatar e endereço
- Modo escuro (dark theme) persistente
- Painel administrativo (sincronizar banco de dados)

---

## 🛠️ Tecnologias Utilizadas

| Camada | Tecnologia |
|--------|------------|
| **Front-end** | HTML5, CSS3, JavaScript (Vanilla) |
| **Estilização** | Bootstrap 5.3, Bootstrap Icons, CSS Custom Properties (variáveis) |
| **Animações** | GSAP (TweenMax + MorphSVGPlugin) para o mascote Yeti |
| **Backend / Banco** | [Supabase](https://supabase.com/) (PostgreSQL + API REST) |
| **APIs externas** | ViaCEP (busca de endereço por CEP) |
| **Hospedagem** | Vercel (sugestão) ou qualquer servidor estático |

---

## 📁 Estrutura do Projeto

```

electromarket/
├── index.html          # Página principal (única - SPA)
├── style.css           # Estilos customizados e temas
├── script.js           # Lógica completa do front-end
├── products.json       # Dados de exemplo (fallback)
└── README.md           # Documentação do projeto

```

---

## ⚙️ Configuração do Supabase

O projeto utiliza o **Supabase** como backend. Para rodar localmente, você precisa configurar um projeto no Supabase e executar o script SQL abaixo no **SQL Editor**:

### 1. Criar tabelas

```sql
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tipo TEXT DEFAULT 'CLIENTE',
    nome TEXT NOT NULL,
    cpf TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    endereco TEXT,
    cep TEXT,
    cidade TEXT,
    estado TEXT,
    pagamento TEXT DEFAULT 'pix',
    senha_hash TEXT NOT NULL,
    avatar TEXT,
    vendedor_rating NUMERIC DEFAULT 5.0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    titulo TEXT NOT NULL,
    descricao TEXT,
    preco NUMERIC NOT NULL DEFAULT 0,
    quantidade INTEGER DEFAULT 1,
    categoria TEXT DEFAULT 'Geral',
    realizaEntrega BOOLEAN DEFAULT false,
    img TEXT,
    loja TEXT,
    vendedor_id TEXT,
    likes INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    seller_id TEXT,
    seller_name TEXT,
    buyer_id TEXT,
    buyer_name TEXT,
    product_id TEXT,
    product_title TEXT,
    product_img TEXT,
    total NUMERIC DEFAULT 0,
    quantity INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending',
    realiza_entrega BOOLEAN DEFAULT false,
    agree_buyer BOOLEAN DEFAULT false,
    agree_seller BOOLEAN DEFAULT false,
    logistics_type TEXT,
    dispute_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    order_id TEXT,
    seller_id TEXT,
    buyer_id TEXT,
    participants TEXT[],
    messages JSONB DEFAULT '[]'::jsonb,
    logistics_agreed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

2. Habilitar RLS e políticas públicas (desenvolvimento)

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all_users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_products" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_orders" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_chats" ON chats FOR ALL USING (true) WITH CHECK (true);
```

3. Configurar credenciais no script.js

```javascript
const SUPABASE_URL = 'https://SEU_PROJETO.supabase.co';
const SUPABASE_KEY = 'SUA_CHAVE_ANON';
```

---

🖥️ Como Executar Localmente

1. Clone o repositório:

```bash
git clone https://github.com/seuusuario/electromarket.git
cd electromarket
```

1. Abra o arquivo index.html em seu navegador ou utilize a extensão Live Server no VS Code.
2. Certifique-se de que as credenciais do Supabase estão configuradas corretamente no arquivo script.js.

---

🌐 Demonstração Online

O projeto está disponível em: https://eletromarket-pi.vercel.app/ (substitua pelo seu link)

---

👥 Equipe

Nome Função
Daniel Barbosa de Lima Desenvolvedor Full Stack
Colega 1 Documentação / Testes
Colega 2 Design / UI/UX

---

📄 Licença

Este projeto é parte de um trabalho acadêmico e está sob a licença MIT. Veja o arquivo LICENSE para mais detalhes.

---

🙏 Agradecimentos

· Supabase pelo backend gratuito
· GSAP pelas animações
· ViaCEP pela API de CEP
· CodePen pelo SVG do Yeti original

---

Feito com 💚 para a disciplina de Projeto Integrador

```
