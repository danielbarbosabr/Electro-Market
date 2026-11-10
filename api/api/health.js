// api/health.js — diagnóstico de configuração. Mostra SÓ sim/não (nunca valores de chaves).
// Abra https://SEU-SITE/api/health depois do deploy. Pode apagar este arquivo quando tudo estiver funcionando.
const crypto = require('crypto');
const L = require('./_lib');

// Impressões digitais (SHA-256) das chaves que VAZARAM em 09/11/2026. Só o hash fica aqui, nunca a chave.
const CHAVES_VAZADAS = new Set(["96fa2b080fd2c2a97072408ea33e45e5867d1ae2cd839924118c630e330f0283", "271ff77ec9eb7e39d7b5e5b91d955ea64858429b9d06ac2d2edf389977f59afd"]);
const sha = (s) => crypto.createHash('sha256').update(String(s || '')).digest('hex');
const anonKey = () => L.env('ELECTRO_MARKET_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_ELECTRO_MARKET_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'ELECTRO_MARKET_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_ELECTRO_MARKET_SUPABASE_PUBLISHABLE_KEY');

// Tenta ler com a chave PÚBLICA. Se vier dado, o banco está aberto (RLS desligado).
async function testeChavePublica(tabela) {
    const k = anonKey();
    if (!k) return 'sem chave pública configurada (nada a testar)';
    const headers = { apikey: k }; if (k.startsWith('eyJ')) headers.Authorization = `Bearer ${k}`;
    try {
        const r = await fetch(`${L.SUPABASE_URL}/rest/v1/${tabela}?select=id&limit=1`, { headers });
        if (!r.ok) return 'fechado (ok)';
        const rows = await r.json();
        return Array.isArray(rows) && rows.length ? 'ABERTO — qualquer pessoa lê esta tabela! Rode api/security_fix.sql' : 'fechado (ok)';
    } catch { return 'não foi possível testar'; }
}

function roleOf(key) {
    if (!key) return 'ausente';
    if (key.startsWith('sb_secret_')) return 'secret (ok)';
    if (key.startsWith('sb_publishable_')) return 'publishable (ERRADA: não serve para o servidor)';
    try {
        const r = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
        return r === 'service_role' ? 'service_role (ok)' : `${r} (ERRADA: precisa ser service_role)`;
    } catch { return 'formato desconhecido'; }
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const checks = {
        supabase_url: !!L.SUPABASE_URL,
        chave_do_servidor: roleOf(L.SERVICE_KEY),
        SESSION_SECRET: !!L.SESSION_SECRET,
        RESEND_API_KEY: !!L.env('RESEND_API_KEY'),
        RESET_EMAIL_FROM: !!L.env('RESET_EMAIL_FROM'),
        APP_URL: !!L.env('APP_URL'),
        SUPABASE_KEY_antiga_ainda_existe: !!process.env.SUPABASE_KEY,
        chave_do_servidor_VAZADA: CHAVES_VAZADAS.has(sha(L.SERVICE_KEY)) ? 'SIM — esta chave está pública. Rotacione no Supabase e atualize na Vercel AGORA' : 'não'
    };
    let banco = 'não testado';
    if (checks.supabase_url && L.SERVICE_KEY) {
        try { await L.dbFetch('products?select=id&limit=1'); banco = 'conectou e leu a tabela products (ok)'; }
        catch (e) { banco = `falhou (HTTP ${e.status || '?'}) — chave errada, projeto errado ou tabela inexistente`; }
    }
    const banco_fechado_para_chave_publica = {};
    if (checks.supabase_url) for (const t of ['users', 'orders', 'chats']) banco_fechado_para_chave_publica[t] = await testeChavePublica(t);
    const faltando = [];
    if (checks.chave_do_servidor_VAZADA.startsWith('SIM')) faltando.unshift('ROTACIONAR as chaves do Supabase (a chave em uso é a que vazou)');
    if (!checks.supabase_url) faltando.push('URL do Supabase (ELECTRO_MARKET_SUPABASE_URL ou NEXT_PUBLIC_ELECTRO_MARKET_SUPABASE_URL)');
    if (!L.SERVICE_KEY) faltando.push('ELECTRO_MARKET_SUPABASE_SERVICE_ROLE_KEY');
    if (!checks.SESSION_SECRET) faltando.push('SESSION_SECRET (login não funciona sem ela)');
    if (!checks.RESEND_API_KEY || !checks.RESET_EMAIL_FROM) faltando.push('RESEND_API_KEY / RESET_EMAIL_FROM (só a recuperação de senha por e-mail depende disso)');
    res.status(200).json({ checks, banco, banco_fechado_para_chave_publica, faltando });
};
