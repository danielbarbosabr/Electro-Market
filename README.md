# ElectroMarket

![Status](https://img.shields.io/badge/status-em%20desenvolvimento-yellow)
![Licença](https://img.shields.io/badge/licença-privado-lightgrey)

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white)

Marketplace para compra e venda de produtos eletrônicos, com chat entre comprador e vendedor, sistema de pedidos, avaliações, grupos e painel administrativo.

---

## 📌 Status do projeto

🚧 Em desenvolvimento — funcionalidades principais já funcionando (produtos, pedidos, chat, avaliações, painel admin), com ajustes contínuos de schema e infraestrutura.

## 🛠️ Tecnologias usadas

- **Front-end:** HTML5, CSS3, JavaScript (vanilla, sem framework)
- **Ícones:** Bootstrap Icons
- **Back-end / Banco de dados:** [Supabase](https://supabase.com/) (PostgreSQL)
- **Funções serverless:** Vercel (Node.js) — expõem a configuração do Supabase sem hardcode
- **Agendamento de tarefas:** `pg_cron` (limpeza automática de chats antigos)
- **Deploy:** Vercel

## 📁 Estrutura principal

| Arquivo | Descrição |
|---|---|
| `script.js` | Lógica principal do front-end (produtos, pedidos, chat, carrinho, etc.) |
| `admin.js` | Painel administrativo |
| `style_mobile.css` | Estilos responsivos para mobile |
| `config.js` | Função serverless (Vercel) que expõe a config do Supabase via variáveis de ambiente |
| `config_local.js` | Fallback só para testes locais (fora do Git) |
| `fix_schema_completo.sql` | Script único com todo o schema do banco + limpeza automática de chats |

## ⚙️ Configuração

As credenciais do Supabase **não ficam no código** — são lidas de variáveis de ambiente configuradas na Vercel:

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `GOOGLE_CLIENT_ID`

Configure em **Vercel → Settings → Environment Variables**.

## 🗄️ Banco de dados

Rode o `fix_schema_completo.sql` uma única vez no **Supabase → SQL Editor** para criar/atualizar todas as tabelas e agendar a limpeza automática de chats com mais de 14 dias de inatividade.
