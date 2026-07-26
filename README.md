# <img src="https://static.vecteezy.com/system/resources/previews/073/450/732/non_2x/bold-yellow-lightning-bolt-symbol-integrated-with-stylized-black-letter-e-isolated-on-white-background-vector.jpg" width="32" height="32" valign="middle"> ElectroMarket

**Marketplace de Eletrônicos – Projeto Acadêmico**

![Status](https://img.shields.io/badge/status-alpha-green)
![Versão](https://img.shields.io/badge/versão-2.0.0-blue)
![Licença](https://img.shields.io/badge/licença-MIT-yellow)

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Bootstrap](https://img.shields.io/badge/Bootstrap-7952B3?logo=bootstrap&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white)

---

## <img src="https://api.iconify.design/bi/info-circle-fill.svg?color=%234FC3F7" width="20" height="20"> Sobre o Projeto

O **ElectroMarket** é uma plataforma web de compra e venda de produtos eletrônicos, desenvolvida como projeto integrador do curso de graduação. A aplicação simula um marketplace completo, permitindo que usuários se cadastrem como **clientes** ou **vendedores**, anunciem produtos, realizem pedidos, avaliem uns aos outros e negociem entregas através de um **chat em tempo real** — incluindo chats individuais, chats em grupo e um canal de suporte com a administração.

O sistema foi construído com foco em:
- Arquitetura **serverless** (front-end + Backend as a Service)
- Experiência de usuário rica com **animações interativas**
- Design responsivo (mobile-first)
- Gerenciamento real de estado via **Supabase**
- Credenciais nunca expostas no código-fonte (config via variáveis de ambiente)

---

## <img src="https://api.iconify.design/bi/rocket-takeoff-fill.svg?color=%234FC3F7" width="20" height="20"> Funcionalidades

### <img src="https://api.iconify.design/bi/shield-lock-fill.svg?color=%234FC3F7" width="18" height="18"> Autenticação
- Cadastro com validação de CPF (com busca automática de estado) e busca de endereço por **CEP (ViaCEP)**
- Login com senha criptografada (hash) e login social via **Google OAuth**
- Tela de autenticação interativa com o mascote **"Yeti"**, que reage aos campos (piscar, cobrir os olhos na senha, seguir o cursor)
- Detecção de região do visitante (guest) para sugerir cidade/estado automaticamente

### <img src="https://api.iconify.design/bi/shop.svg?color=%234FC3F7" width="18" height="18"> Marketplace
- Listagem de produtos em grid responsivo (múltiplas colunas no desktop, 2 no mobile)
- Filtros por preço, categoria, loja, cidade e estado do vendedor
- Ordenação por menor/maior preço e mais vendidos
- Busca com autocomplete e debounce
- Detalhes do produto com galeria de imagens, condição do item e reputação do vendedor (avaliações em estrelas)
- Upload de imagens via Imgur

### <img src="https://api.iconify.design/bi/cart-fill.svg?color=%234FC3F7" width="18" height="18"> Carrinho de Compras
- Adicionar/remover itens, alterar quantidade
- Finalização de compra que gera um **pedido** automático

### <img src="https://api.iconify.design/bi/box-seam-fill.svg?color=%234FC3F7" width="18" height="18"> Gestão de Pedidos
- Cliente: acompanha status da compra (`Em Aprovação → Combinando entrega → Entregue`)
- Vendedor: aceita/recusa pedidos, visualiza histórico de vendas e badge de pendências
- Acordo mútuo de logística (retirada, entrega pelo vendedor ou apps externos como Uber Flash, 99 Entrega, Loggi)
- Avaliação mútua (comprador ↔ vendedor) ao final do pedido, com nota, comentário, fotos e vídeos

### <img src="https://api.iconify.design/bi/chat-dots-fill.svg?color=%234FC3F7" width="18" height="18"> Chat em Tempo Real
- Chat de pedido, chat direto (usuário-a-usuário) e **chats em grupo** (com admin de grupo, convites por código e pedidos de entrada)
- Envio de mensagens de texto, imagens, arquivos e **localização**
- Reações a mensagens, resposta citando mensagem anterior, indicador de "digitando..."
- Marcação de mensagens como vistas, badge de não lidas
- Links detectados automaticamente e clicáveis
- Chats expiram automaticamente após **14 dias de inatividade** (limpeza agendada via `pg_cron`)

### <img src="https://api.iconify.design/bi/globe2.svg?color=%234FC3F7" width="18" height="18"> Feed da Comunidade
- Mural estilo rede social entre usuários (posts, seguir/deixar de seguir outros usuários, contagem de seguidores)

### <img src="https://api.iconify.design/bi/tools.svg?color=%234FC3F7" width="18" height="18"> Painel Administrativo
- Visão geral, gestão de conteúdo (usuários/produtos), categorias pendentes de aprovação
- Chat de **suporte** dedicado entre usuário e administração, com o mesmo sistema de mensagens/anexos do chat comum
- Sincronização e verificação do banco de dados

### <img src="https://api.iconify.design/bi/person-circle.svg?color=%234FC3F7" width="18" height="18"> Perfil do Usuário
- Edição de dados pessoais, avatar e endereço
- Modo escuro (dark theme) persistente
- Notificações persistentes (pedidos, mensagens, avaliações)
- Indicador de "online há pouco tempo" (`last_seen`)

---

## <img src="https://api.iconify.design/bi/cpu-fill.svg?color=%234FC3F7" width="20" height="20"> Tecnologias Utilizadas

| Camada | Tecnologia |
|--------|------------|
| **Front-end** | HTML5, CSS3, JavaScript (Vanilla, sem framework) |
| **Estilização** | Bootstrap 5.3, Bootstrap Icons, CSS Custom Properties (variáveis) |
| **Animações** | GSAP (TweenMax + MorphSVGPlugin) para o mascote Yeti |
| **Backend / Banco** | [Supabase](https://supabase.com/) (PostgreSQL + API REST) |
| **Tarefas agendadas** | `pg_cron` (limpeza automática de chats inativos) |
| **Funções serverless** | Vercel (Node.js) — entrega a config do Supabase sem expor credenciais no front-end |
| **APIs externas** | ViaCEP (endereço por CEP), Google OAuth (login social), Imgur (upload de imagens) |
| **Hospedagem** | Vercel |

---

## <img src="https://api.iconify.design/bi/folder2-open.svg?color=%234FC3F7" width="20" height="20"> Estrutura do Projeto

```
electromarket/
├── index.html                 # Página principal (SPA)
├── js/
│   ├── script.js               # Lógica principal do front-end (produtos, pedidos, chat, feed, carrinho...)
│   ├── admin.js                 # Painel administrativo e chat de suporte
│   ├── seller.js                 # Funções exclusivas do vendedor
│   ├── cliente.js                # Funções exclusivas do comprador
│   └── config.local.js           # Fallback só para testes locais (fora do Git, veja .gitignore)
├── css/
│   ├── style.desktop.css        # Estilos para desktop
│   └── style.mobile.css         # Estilos e ajustes responsivos para mobile
├── api/
│   ├── config.js                # Função serverless (Vercel) que expõe a config do Supabase via env vars
│   └── schema.sql                # Schema completo do banco de dados
├── .gitignore
└── README.md                   # Documentação do projeto
```

---

## <img src="https://api.iconify.design/bi/gear-fill.svg?color=%234FC3F7" width="20" height="20"> Configuração do Supabase

O projeto utiliza o **Supabase** como backend (PostgreSQL). Para rodar, crie um projeto no Supabase e execute o `api/schema.sql` uma única vez em **SQL Editor** — ele cria/ajusta todas as tabelas necessárias:

- `users` — clientes e vendedores, avaliações, endereço
- `products` — anúncios
- `orders` — pedidos e status de logística
- `chats` — mensagens, grupos, convites e pedidos de entrada em grupo
- `notifications` — notificações do usuário
- `avaliacoes` — avaliações entre comprador e vendedor
- `group_invites` / `group_join_requests` — convites e solicitações de entrada em grupos

O mesmo script também configura o trigger e o job do `pg_cron` que apagam automaticamente chats com 14+ dias sem atividade.

### Credenciais (sem hardcode)

As credenciais **não ficam escritas no código**. Elas são lidas via variáveis de ambiente na função serverless `api/config.js`:

```bash
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_KEY=SUA_CHAVE_ANON
GOOGLE_CLIENT_ID=SEU_CLIENT_ID_GOOGLE
```

Configure-as em **Vercel → Settings → Environment Variables**. Para testes locais sem a função serverless, use o `js/config.local.js` (mantido fora do Git via `.gitignore`).

---

## <img src="https://api.iconify.design/bi/display.svg?color=%234FC3F7" width="20" height="20"> Como Executar Localmente

1. Clone o repositório:

```bash
git clone https://github.com/seuusuario/electromarket.git
cd electromarket
```

2. Configure o `js/config.local.js` com suas próprias credenciais de teste (esse arquivo não vai para o GitHub).

3. Abra o `index.html` com a extensão **Live Server** do VS Code (ou qualquer servidor estático).

4. Para simular o ambiente de produção (com a função serverless), use a CLI da Vercel:

```bash
vercel dev
```

---

## <img src="https://api.iconify.design/bi/globe.svg?color=%234FC3F7" width="20" height="20"> Demonstração Online

O projeto está disponível em: [https://eletromarket-pi.vercel.app/](https://eletromarket-pi.vercel.app/)

---

## <img src="https://api.iconify.design/bi/people-fill.svg?color=%234FC3F7" width="20" height="20"> Equipe

| Nome | Função |
|------|--------|
| Daniel Barbosa de Lima | Desenvolvedor Full Stack |
| Deep Seek | Documentação / Testes |
| Claude | Design / UI/UX |

---

## <img src="https://api.iconify.design/bi/file-earmark-text-fill.svg?color=%234FC3F7" width="20" height="20"> Licença

Este projeto é parte de um trabalho acadêmico e está sob a licença MIT. Veja o arquivo LICENSE para mais detalhes.

---

## <img src="https://api.iconify.design/bi/heart-fill.svg?color=%234FC3F7" width="20" height="20"> Agradecimentos

- [Supabase](https://supabase.com/) pelo backend gratuito
- [GSAP](https://gsap.com/) pelas animações
- [ViaCEP](https://viacep.com.br/) pela API de CEP
- CodePen pelo SVG do Yeti original

---

Feito para a disciplina de Projeto Integrador
