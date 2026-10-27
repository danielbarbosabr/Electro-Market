const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

module.exports = (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    // Permite apenas requisições feitas pelo próprio site
    const referer = req.headers.referer || '';
    const host = req.headers.host || '';

    if (
        !referer.startsWith(`https://${host}`) &&
        !referer.startsWith(`http://${host}`)
    ) {
        return res.status(404).end();
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(500).json({
            error: 'Configuração indisponível.'
        });
    }

    res.status(200).json({
        SUPABASE_URL,
        SUPABASE_KEY,
        GOOGLE_CLIENT_ID
    });
};
