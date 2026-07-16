// Função serverless (Vercel) que devolve a config do Supabase lida das
// variáveis de ambiente do SERVIDOR — assim a chave nunca fica escrita
// no código do front-end, só existe aqui e nas envs do projeto.
//
// Em produção (Vercel): configure SUPABASE_URL e SUPABASE_KEY em
// Project Settings → Environment Variables.
// Em desenvolvimento local (`vercel dev`): a Vercel CLI já lê o arquivo
// `.env` da raiz do projeto automaticamente, sem precisar de nada extra.

module.exports = (req, res) => {
    // Nunca deixa isso em cache (nem no navegador, nem em CDN) — é só pra
    // esse fetch interno do próprio site.
    res.setHeader('Cache-Control', 'no-store');

    const { SUPABASE_URL, SUPABASE_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        res.status(500).json({
            error: 'SUPABASE_URL/SUPABASE_KEY não configuradas nas variáveis de ambiente do servidor.'
        });
        return;
    }

    res.status(200).json({ SUPABASE_URL, SUPABASE_KEY });
};
