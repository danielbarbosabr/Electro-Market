# ElectroMarket

**Marketplace de Eletrônicos**

![Badge](https://img.shields.io/badge/status-em%20desenvolvimento-green)
![Badge](https://img.shields.io/badge/versão-2.0.0-blue)

---

## Sobre o Projeto

O **ElectroMarket** é uma plataforma web de compra e venda de produtos eletrônicos. A aplicação funciona como um marketplace completo, permitindo cadastro de **clientes** e **vendedores**, anúncio de produtos, pedidos, chat entre as partes e painel administrativo.

O sistema foi construído com:
- Arquitetura **serverless** (front-end estático + Supabase como BaaS)
- Design responsivo (mobile-first) estilo Mercado Livre
- Chat em tempo real com suporte a texto, imagens, arquivos e grupos

---

## Funcionalidades

### Autenticação
- Cadastro com validação de CPF e busca de endereço por CEP (ViaCEP)
- Login com senha ou Google
- Tela interativa com mascote **Yeti** (SVG animado que reage aos campos)
- Recuperação de senha via chamado de suporte

### Marketplace
- Grid de produtos responsivo
- Filtros por preço, categoria, loja, localização e forma de recebimento
- Ordenação por destaque, recentes, mais curtidos, menor/maior preço
- Detalhes do produto com galeria de imagens, reputação do vendedor e avaliações
- Sistema de **ofertas** (comprador propõe valor diferente)

### Carrinho
- Adicionar/remover itens com controle de quantidade e estoque
- Finalização que gera pedido automático no banco

### Gestão de Pedidos
- **Cliente**: acompanha status, solicita compra, confirma recebimento
- **Vendedor**: aceita/recusa pedidos e ofertas, gerencia vendas
- **Chat integrado** entre comprador e vendedor com área de logística
- **Avaliações** bidirecionais (comprador avalia vendedor e vice-versa)

### Chat
- Mensagens de texto, imagem, arquivo e localização
- Resposta, edição e exclusão de mensagens
- Reações com emojis
- Transcrição de voz para texto (Web Speech API)
- **Conversas diretas** (sem pedido) entre usuários
- **Grupos** com participantes, avatar, nome e convites por link
- **Suporte**: chamados com categorias e atendimento por admin

### Perfil
- Edição de dados pessoais, avatar e banner da loja
- Modo escuro persistente
- Avatar armazena foto + banner no mesmo campo (JSON)

### Admin
- Painel com abas: Início, Conteúdo, Categorias, Suporte
- Gerenciar usuários, produtos, pedidos e conversas
- Gráficos (Chart.js) de usuários por tipo, chats abertos/encerrados, pedidos por status, publicações por mês
- Simulação de papel (admin pode ver o site como Cliente ou Vendedor)

### Comunidade
- Posts e seguidores usando a própria tabela `chats` (sem tabela extra)
- Posts: `order_id = 'community_post_<id>'`
- Seguir: `order_id = 'community_follow_<id>'`

---

## Tecnologias Utilizadas

| Camada | Tecnologia |
|--------|------------|
| **Front-end** | HTML5, CSS3, JavaScript (Vanilla, ~10k linhas) |
| **Estilização** | Bootstrap 5.3, Bootstrap Icons, CSS Custom Properties |
| **Banco** | [Supabase](https://supabase.com/) (PostgreSQL + API REST) |
| **Gráficos** | Chart.js 4.4 |
| **APIs externas** | ViaCEP, IBGE (cidades), Nominatim/OpenStreetMap (geolocalização), ipapi.co (IP), Web Speech API |
| **Hospedagem** | Vercel (função serverless em `api/config.js`) |

---

## Estrutura do Projeto

```
C2/
├── index.html                # Página principal (SPA)
├── css/
│   ├── style.desktop.css     # Estilos desktop
│   └── style.mobile.css      # Estilos mobile
├── js/
│   ├── script.js             # Lógica principal (~10k linhas)
│   ├── admin.js              # Painel administrativo
│   ├── seller.js             # Funções do vendedor
│   ├── cliente.js            # Funções do comprador
│   └── config.local.js       # Credenciais de dev (gitignorado)
├── api/
│   ├── fix_schema.sql        # Schema completo do banco
│   └── config.js             # Função serverless (credenciais)
└── README.md
```

---

## Schema do Banco (Supabase/PostgreSQL)

Execute `api/fix_schema.sql` no SQL Editor do Supabase. O schema completo contém 8 tabelas:

| Tabela | Finalidade |
|--------|------------|
| `users` | Usuários (cliente, vendedor, admin) |
| `products` | Anúncios de produtos |
| `orders` | Pedidos e ofertas |
| `chats` | Conversas (pedido, direto, grupo, suporte, comunidade) |
| `notifications` | Notificações do sistema |
| `avaliacoes` | Avaliações de vendedor, comprador e produto |
| `group_invites` | Links de convite para grupos |
| `group_join_requests` | Solicitações de entrada em grupos |

### RLS (desenvolvimento)

```sql
ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avaliacoes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_invites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_join_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all" ON public.users              FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all" ON public.products           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all" ON public.orders             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all" ON public.chats              FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all" ON public.notifications      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all" ON public.avaliacoes         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all" ON public.group_invites      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all" ON public.group_join_requests FOR ALL USING (true) WITH CHECK (true);
```

---

## Como Executar Localmente

1. Abra o arquivo `index.html` no navegador ou use **Live Server** no VS Code.
2. Execute `api/fix_schema.sql` no SQL Editor do Supabase.
3. (Opcional) Execute `api/chat_ttl_2_semanas.sql` para limpeza automática de chats antigos.
4. As credenciais do Supabase vêm da função serverless (`api/config.js`). Em dev local, o fallback `js/config.local.js` é usado automaticamente.

---

## Demonstração Online

[https://eletromarket-pi.vercel.app/](https://eletromarket-pi.vercel.app/)

---

## Licença

Projeto acadêmico sob licença MIT.
