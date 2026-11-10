// api/_lib.js — utilidades compartilhadas pelas funções serverless (arquivos com "_" não viram rota).
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const env = (...n) => { for (const k of n) if (process.env[k]) return process.env[k]; return ''; };

const SUPABASE_URL = env('ELECTRO_MARKET_SUPABASE_URL', 'NEXT_PUBLIC_ELECTRO_MARKET_SUPABASE_URL', 'SUPABASE_URL');
const SERVICE_KEY  = env('ELECTRO_MARKET_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ELECTRO_MARKET_SUPABASE_SECRET_KEY', 'SUPABASE_SECRET_KEY');
const SESSION_SECRET = env('SESSION_SECRET');   // openssl rand -hex 32  (NUNCA reutilizar outras chaves aqui)
const SESSION_TTL = 7 * 24 * 3600;

function readBody(req) {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
    return b && typeof b === 'object' ? b : {};
}

// ---------- senha: mesmo formato "salt:hash" que já existe no banco (scrypt) ----------
async function hashSenha(senha) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}:${(await scrypt(String(senha), salt, 64)).toString('hex')}`;
}
async function confereSenha(senha, armazenado) {
    if (!armazenado || typeof armazenado !== 'string' || !armazenado.includes(':')) return false; // Base64 antigo nunca vale
    const [salt, hash] = armazenado.split(':');
    if (!salt || !hash) return false;
    const t = (await scrypt(String(senha), salt, 64)).toString('hex');
    const a = Buffer.from(hash, 'hex'), b = Buffer.from(t, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const senhaLegada = (u) => !u.senha_hash || !u.senha_hash.includes(':');
function senhaForte(s) {
    return typeof s === 'string' && s.length >= 10 && s.length <= 128 &&
        /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && /[^A-Za-z0-9]/.test(s);
}
const MSG_SENHA = 'Use de 10 a 128 caracteres, incluindo letra maiúscula, minúscula, número e símbolo.';

// ---------- sessão assinada. O token só vale enquanto a senha não mudar (pv) ----------
const pvOf = (senhaHash) => crypto.createHash('sha256').update(String(senhaHash || '')).digest('hex').slice(0, 16);
function signSession(user) {
    if (!SESSION_SECRET) throw new Error('SESSION_SECRET não configurada');
    const payload = Buffer.from(JSON.stringify({ sub: String(user.id), pv: pvOf(user.senha_hash), exp: Math.floor(Date.now() / 1000) + SESSION_TTL })).toString('base64url');
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}
function parseSession(token) {
    if (!token || !SESSION_SECRET || typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const exp = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(exp);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try { const d = JSON.parse(Buffer.from(payload, 'base64url').toString()); return d.sub && d.exp > Date.now() / 1000 ? d : null; } catch { return null; }
}
const tokenFromReq = (req) => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : ''; };

// ---------- banco (chave de serviço: existe SÓ aqui, no servidor) ----------
function dbFetch(path, options = {}) {
    const headers = { apikey: SERVICE_KEY, 'Content-Type': 'application/json', ...options.headers };
    if (SERVICE_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SERVICE_KEY}`;
    return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers }).then(async (res) => {
        const text = await res.text();
        let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
        if (!res.ok) { const e = new Error((data && data.message) || 'Erro no banco'); e.status = res.status; throw e; }
        return data;
    });
}
// usuário da sessão: o papel (tipo) SEMPRE vem do banco, nunca do token
async function currentUser(req) {
    const s = parseSession(tokenFromReq(req));
    if (!s) return null;
    const rows = await dbFetch(`users?select=id,tipo,email,nome,senha_hash&id=eq.${encodeURIComponent(s.sub)}&limit=1`);
    const u = rows && rows[0];
    if (!u || pvOf(u.senha_hash) !== s.pv) return null; // senha trocada => sessões antigas morrem
    delete u.senha_hash;
    return u;
}

// ---------- CPF / util ----------
function validarCPF(cpf) {
    cpf = String(cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    for (let t = 9; t < 11; t++) { let s = 0; for (let i = 0; i < t; i++) s += Number(cpf[i]) * (t + 1 - i); if (((s * 10) % 11) % 10 !== Number(cpf[t])) return false; }
    return true;
}
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
const escHtml = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const publicUser = (u) => { const c = { ...u }; delete c.senha_hash; delete c.senha; return c; };

// ---------- limite de tentativas (memória da instância: freia o básico; o forte fica no banco) ----------
const hits = new Map();
function rateLimit(key, max, windowMs) {
    const now = Date.now(); const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(now); hits.set(key, arr); if (hits.size > 5000) hits.clear(); return true;
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

module.exports = { env, SUPABASE_URL, SERVICE_KEY, SESSION_SECRET, readBody, hashSenha, confereSenha, senhaLegada, senhaForte, MSG_SENHA,
    signSession, parseSession, tokenFromReq, dbFetch, currentUser, validarCPF, onlyDigits, escHtml, publicUser, rateLimit, clientIp, pvOf };
