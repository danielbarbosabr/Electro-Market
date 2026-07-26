// Função serverless (Vercel) que devolve a config do Supabase. A chave
// fica aqui no servidor (nunca no front-end) — o fetch do site só recebe
// os valores via esta função.
//
// SUPABASE_URL, SUPABASE_KEY e GOOGLE_CLIENT_ID vêm das variáveis de
// ambiente da Vercel (Settings -> Environment Variables). Nada disso
// fica escrito no código, então pode subir pro GitHub sem problema.

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

module.exports = (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        res.status(500).json({
            error: 'SUPABASE_URL/SUPABASE_KEY não configuradas.'
        });
        return;
    }

    res.status(200).json({ SUPABASE_URL, SUPABASE_KEY, GOOGLE_CLIENT_ID });
};
