// Configuração pública do frontend. Nunca retornar service_role, secret key,
// JWT secret ou credenciais PostgreSQL neste endpoint.
const SUPABASE_URL = process.env.ELECTRO_MARKET_SUPABASE_URL || process.env.NEXT_PUBLIC_ELECTRO_MARKET_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.ELECTRO_MARKET_SUPABASE_ANON_KEY || process.env.ELECTRO_MARKET_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_ELECTRO_MARKET_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

module.exports = (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Configuração pública do Supabase indisponível.' });
    return res.status(200).json({ SUPABASE_URL, SUPABASE_KEY, GOOGLE_CLIENT_ID });
};
