// Função serverless (Vercel) que devolve a config do Supabase. A chave
// fica aqui no servidor (nunca no front-end) — o fetch do site só recebe
// os valores via esta função.

const SUPABASE_URL = 'https://pjisiqvaulgoikaitmaj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqaXNpcXZhdWxnb2lrYWl0bWFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjI5ODAsImV4cCI6MjA5MjYzODk4MH0.vq69kmmYdr2aBePlxwVcO3QhUtbp5dtx-pZxRXgEkV8';

module.exports = (req, res) => {
    // Nunca deixa isso em cache (nem no navegador, nem em CDN) — é só pra
    // esse fetch interno do próprio site.
    res.setHeader('Cache-Control', 'no-store');

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        res.status(500).json({
            error: 'SUPABASE_URL/SUPABASE_KEY não configuradas.'
        });
        return;
    }

    res.status(200).json({ SUPABASE_URL, SUPABASE_KEY });
};
