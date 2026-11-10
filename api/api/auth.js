// api/auth.js — cadastro, login, troca/recuperação de senha. Tudo que envolve senha e CPF fica AQUI (servidor).
//
// Variáveis na Vercel (Settings > Environment Variables), todas SÓ no servidor (sem prefixo NEXT_PUBLIC_):
//   ELECTRO_MARKET_SUPABASE_URL (ou NEXT_PUBLIC_..._SUPABASE_URL)  e  ELECTRO_MARKET_SUPABASE_SERVICE_ROLE_KEY (chave NOVA, rotacionada)
//   SESSION_SECRET   (openssl rand -hex 32)
//   RESEND_API_KEY, RESET_EMAIL_FROM, APP_URL   (e-mail de recuperação)

const crypto = require('crypto');
const L = require('./_lib');

const RESEND_API_KEY = L.env('RESEND_API_KEY');
const RESET_EMAIL_FROM = L.env('RESET_EMAIL_FROM') || 'ElectroMarket <onboarding@resend.dev>';
const APP_URL = L.env('APP_URL');
const MAX_TENTATIVAS_CODIGO = 5;
const MAX_CODIGOS_POR_HORA = 3;
const q = encodeURIComponent;
const agoraIso = () => new Date().toISOString();

// HMAC com segredo do servidor: o hash do código não pode ser "descoberto" por força bruta se alguém ler a tabela
const codeHash = (userId, code) => crypto.createHmac('sha256', L.SESSION_SECRET).update(`code:${userId}:${code}`).digest('hex');
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function enviarEmail(para, assunto, html) {
    if (!RESEND_API_KEY) throw new Error('Envio de e-mail não configurado (RESEND_API_KEY).');
    const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: RESET_EMAIL_FROM, to: [para], subject: assunto, html })
    });
    if (!r.ok) { console.error('Resend:', await r.text()); throw new Error('Não foi possível enviar o e-mail agora. Tente novamente em instantes.'); }
}

async function findByEmail(email) {
    const e = String(email || '').trim();
    for (const v of [e, e.toLowerCase()]) {
        const rows = await L.dbFetch(`users?select=*&email=eq.${q(v)}&limit=1`);
        if (rows && rows[0]) return rows[0];
    }
    return null;
}
async function findUniqueByCpf(cpf, cols = 'id,email,nome') {
    const rows = await L.dbFetch(`users?select=${cols}&cpf=eq.${q(cpf)}&limit=2`);
    return rows && rows.length === 1 ? rows[0] : null; // CPF repetido => ambíguo => não envia para ninguém
}
async function invalidarRecuperacao(userId) {
    const body = JSON.stringify({ used_at: agoraIso() });
    const h = { Prefer: 'return=minimal' };
    await L.dbFetch(`password_reset_codes?user_id=eq.${q(userId)}&used_at=is.null`, { method: 'PATCH', headers: h, body });
    await L.dbFetch(`password_reset_tokens?user_id=eq.${q(userId)}&used_at=is.null`, { method: 'PATCH', headers: h, body });
}
async function gravarSenha(userId, novaSenha) {
    await L.dbFetch(`users?id=eq.${q(userId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ senha_hash: await L.hashSenha(novaSenha), updated_at: agoraIso() }) });
    await invalidarRecuperacao(userId);
}
const limitado = (res) => res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });

// ------------------------------------------------------------------ cadastro / login
async function registrar(b, res, req) {
    if (!L.rateLimit('reg:' + L.clientIp(req), 10, 15 * 60 * 1000)) return limitado(res);
    const { nome, cpf, email, telefone, senha, endereco, cep, cidade, estado, pagamento, avatar, tipoConta } = b;
    if (!nome || !cpf || !email || !senha) return res.status(400).json({ error: 'Preencha nome, CPF, e-mail e senha.' });
    if (!L.validarCPF(cpf)) return res.status(400).json({ error: 'CPF inválido.' });
    if (!L.senhaForte(String(senha))) return res.status(400).json({ error: L.MSG_SENHA });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) return res.status(400).json({ error: 'E-mail inválido.' });
    const cpfDig = L.onlyDigits(cpf);
    if (await findByEmail(email)) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    const dup = await L.dbFetch(`users?select=id&cpf=eq.${cpfDig}&limit=1`);
    if (dup && dup.length) return res.status(409).json({ error: 'Este CPF já está cadastrado.' });

    const payload = {
        id: crypto.randomUUID(),
        tipo: tipoConta === 'VENDEDOR' ? 'VENDEDOR' : 'CLIENTE', // nunca ADMIN por aqui
        nome: String(nome).replace(/[<>]/g, '').slice(0, 120), cpf: cpfDig, email: String(email).trim().toLowerCase(),
        telefone: L.onlyDigits(telefone), senha_hash: await L.hashSenha(String(senha)),
        endereco: String(endereco || '').replace(/[<>]/g, '').slice(0, 250), cep: L.onlyDigits(cep),
        cidade: String(cidade || '').replace(/[<>]/g, '').slice(0, 80), estado: String(estado || '').slice(0, 2),
        pagamento: String(pagamento || '').slice(0, 30), avatar: String(avatar || '[]').slice(0, 2000)
    };
    const [user] = await L.dbFetch('users', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload) });
    res.status(200).json({ user: L.publicUser(user), token: L.signSession(user) });
}

async function login(b, res, req) {
    const { identifier, senha } = b;
    if (!identifier || !senha) return res.status(400).json({ error: 'Informe e-mail/telefone e senha.' });
    if (!L.rateLimit('login:ip:' + L.clientIp(req), 25, 15 * 60 * 1000) ||
        !L.rateLimit('login:id:' + String(identifier).toLowerCase(), 8, 15 * 60 * 1000)) return limitado(res);
    const id = String(identifier).trim();
    let user = null;
    if (id.includes('@')) user = await findByEmail(id);
    else { const rows = await L.dbFetch(`users?select=*&telefone=eq.${L.onlyDigits(id)}&limit=2`); user = rows && rows.length === 1 ? rows[0] : null; }

    if (user && L.senhaLegada(user)) {
        return res.status(403).json({ code: 'RESET_REQUIRED', error: 'Por segurança, sua senha antiga foi invalidada. Clique em "Esqueceu sua senha?" para criar uma nova.' });
    }
    if (!user || !(await L.confereSenha(String(senha), user.senha_hash))) {
        return res.status(401).json({ error: 'E-mail/telefone ou senha incorretos.' });
    }
    res.status(200).json({ user: L.publicUser(user), token: L.signSession(user) });
}

async function verificarEmail(b, res, req) {
    if (!L.rateLimit('chk:' + L.clientIp(req), 30, 10 * 60 * 1000)) return limitado(res);
    res.status(200).json({ exists: !!(b.email && await findByEmail(b.email)) });
}

// ------------------------------------------------------------------ troca de senha (logada)
// Exige: sessão válida + CPF DA PRÓPRIA CONTA + senha atual. O userId do corpo é ignorado.
async function alterarSenha(b, res, req) {
    const me = await L.currentUser(req);
    if (!me) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    if (!L.rateLimit('pw:' + me.id, 5, 15 * 60 * 1000)) return limitado(res);
    const cpf = L.onlyDigits(b.cpf), senhaAtual = String(b.senhaAtual || ''), novaSenha = String(b.novaSenha || '');
    if (!L.validarCPF(cpf) || !senhaAtual) return res.status(400).json({ error: 'Informe CPF válido, senha atual e a nova senha.' });
    if (!L.senhaForte(novaSenha)) return res.status(400).json({ error: L.MSG_SENHA });
    if (senhaAtual === novaSenha) return res.status(400).json({ error: 'A nova senha deve ser diferente da atual.' });
    const [u] = await L.dbFetch(`users?select=id,cpf,senha_hash&id=eq.${q(me.id)}&limit=1`);
    if (!u.cpf || L.onlyDigits(u.cpf) !== cpf || !(await L.confereSenha(senhaAtual, u.senha_hash))) {
        return res.status(403).json({ error: 'CPF ou senha atual incorretos.' });
    }
    await gravarSenha(me.id, novaSenha);
    res.status(200).json({ success: true, message: 'Senha alterada. Entre novamente com a nova senha.' });
}

// ------------------------------------------------------------------ link por e-mail (a partir do perfil, logado)
async function solicitarRedefinicao(b, req, res) {
    const me = await L.currentUser(req);
    if (!me) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    if (!L.rateLimit('lnk:' + me.id, 3, 60 * 60 * 1000)) return limitado(res);
    const cpf = L.onlyDigits(b.cpf);
    if (!L.validarCPF(cpf)) return res.status(400).json({ error: 'CPF inválido. Confira os números e tente novamente.' });
    const [u] = await L.dbFetch(`users?select=id,cpf,email,nome&id=eq.${q(me.id)}&limit=1`);
    // o CPF informado PRECISA ser o da conta logada
    if (u && u.email && u.cpf && L.onlyDigits(u.cpf) === cpf) {
        const token = crypto.randomBytes(32).toString('hex');
        await invalidarRecuperacao(u.id);
        await L.dbFetch('password_reset_tokens', { method: 'POST', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ user_id: u.id, token_hash: tokenHash(token), expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() }) });
        const base = APP_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
        await enviarEmail(u.email, 'Redefinição de senha — ElectroMarket',
            `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>Redefinição de senha</h2><p>Olá, ${L.escHtml(u.nome || 'cliente')}.</p><p><a href="${base}/?resetToken=${token}" style="display:inline-block;background:#f0b400;color:#111;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">CRIAR NOVA SENHA</a></p><p>O link expira em 30 minutos e só funciona uma vez. Se não foi você, ignore este e-mail.</p></div>`);
    }
    res.status(200).json({ success: true, message: 'Se os dados corresponderem à sua conta, enviamos um link ao e-mail cadastrado.' });
}

async function redefinirSenha(b, res, req) {
    if (!L.rateLimit('tok:' + L.clientIp(req), 20, 15 * 60 * 1000)) return limitado(res);
    const token = String(b.token || ''), novaSenha = String(b.novaSenha || '');
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'Link inválido ou expirado.' });
    if (!L.senhaForte(novaSenha)) return res.status(400).json({ error: L.MSG_SENHA });
    const rows = await L.dbFetch(`password_reset_tokens?select=id,user_id,expires_at,used_at&token_hash=eq.${tokenHash(token)}&limit=1`);
    const r = rows && rows[0];
    if (!r || r.used_at || new Date(r.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'Link inválido, já usado ou expirado. Solicite outro.' });
    await gravarSenha(r.user_id, novaSenha);
    res.status(200).json({ success: true, message: 'Senha redefinida. Entre com a nova senha.' });
}

// ------------------------------------------------------------------ "Esqueceu sua senha?" (tela de login): CPF + CÓDIGO NO E-MAIL
// O CPF sozinho NUNCA troca a senha: quem não tem acesso à caixa de e-mail da conta não consegue o código.
async function iniciarCodigo(b, res, req) {
    if (!L.rateLimit('cod:ip:' + L.clientIp(req), 10, 15 * 60 * 1000)) return limitado(res);
    const cpf = L.onlyDigits(b.cpf);
    if (!L.validarCPF(cpf)) return res.status(400).json({ error: 'CPF inválido. Confira os números e tente novamente.' });
    const user = await findUniqueByCpf(cpf);
    if (!user || !user.email) return res.status(200).json({ found: false });

    const umaHoraAtras = new Date(Date.now() - 3600 * 1000).toISOString();
    const recentes = await L.dbFetch(`password_reset_codes?select=id&user_id=eq.${q(user.id)}&created_at=gte.${q(umaHoraAtras)}`);
    if (recentes && recentes.length >= MAX_CODIGOS_POR_HORA) {
        return res.status(429).json({ error: 'Você já pediu códigos demais. Aguarde 1 hora ou fale com o suporte.' });
    }
    await invalidarRecuperacao(user.id); // só o código mais novo vale
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await L.dbFetch('password_reset_codes', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: user.id, code_hash: codeHash(user.id, code), attempts: 0, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }) });
    await enviarEmail(user.email, 'Código para redefinir sua senha — ElectroMarket',
        `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>Redefinição de senha</h2><p>Olá, ${L.escHtml(user.nome || 'cliente')}.</p><p>Seu código de verificação:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${code}</p><p>Expira em 10 minutos, vale uma vez e é bloqueado após ${MAX_TENTATIVAS_CODIGO} erros. Se não foi você, ignore este e-mail.</p></div>`);
    res.status(200).json({ found: true, message: 'Enviamos um código de 6 dígitos ao e-mail cadastrado. Ele expira em 10 minutos.' });
}

async function redefinirComCodigo(b, res, req) {
    if (!L.rateLimit('cod2:ip:' + L.clientIp(req), 30, 15 * 60 * 1000)) return limitado(res);
    const cpf = L.onlyDigits(b.cpf), code = String(b.codigo || '').trim(), novaSenha = String(b.novaSenha || '');
    if (!L.validarCPF(cpf)) return res.status(400).json({ error: 'CPF inválido.' });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Informe o código de 6 dígitos recebido por e-mail.' });
    if (!L.senhaForte(novaSenha)) return res.status(400).json({ error: L.MSG_SENHA });
    const generico = { error: 'Código inválido ou expirado. Solicite outro.' };

    const user = await findUniqueByCpf(cpf, 'id');
    if (!user) return res.status(400).json(generico);
    const rows = await L.dbFetch(`password_reset_codes?select=id,code_hash,attempts,expires_at&user_id=eq.${q(user.id)}&used_at=is.null&order=created_at.desc&limit=1`);
    const rec = rows && rows[0];
    if (!rec || new Date(rec.expires_at).getTime() < Date.now()) return res.status(400).json(generico);
    if ((rec.attempts || 0) >= MAX_TENTATIVAS_CODIGO) {
        await invalidarRecuperacao(user.id);
        return res.status(400).json({ error: 'Código bloqueado por excesso de tentativas. Solicite outro.' });
    }
    const a = Buffer.from(rec.code_hash, 'hex'), c = Buffer.from(codeHash(user.id, code), 'hex');
    if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) {
        await L.dbFetch(`password_reset_codes?id=eq.${q(rec.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ attempts: (rec.attempts || 0) + 1 }) });
        return res.status(400).json(generico);
    }
    await gravarSenha(user.id, novaSenha);
    res.status(200).json({ success: true, message: 'Senha redefinida. Entre com a nova senha.' });
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
    if (!L.SUPABASE_URL || !L.SERVICE_KEY || !L.SESSION_SECRET) {
        console.error('Faltam variáveis de ambiente: URL do Supabase, SERVICE_ROLE_KEY e/ou SESSION_SECRET');
        return res.status(500).json({ error: 'Configuração do servidor incompleta.' });
    }
    const b = L.readBody(req);
    try {
        switch (b.action) {
            case 'registrar': return await registrar(b, res, req);
            case 'login': return await login(b, res, req);
            case 'verificar_email': return await verificarEmail(b, res, req);
            case 'alterar_senha': return await alterarSenha(b, res, req);
            case 'solicitar_redefinicao': return await solicitarRedefinicao(b, req, res);
            case 'redefinir_senha': return await redefinirSenha(b, res, req);
            case 'iniciar_redefinicao_codigo': return await iniciarCodigo(b, res, req);
            case 'redefinir_com_codigo': return await redefinirComCodigo(b, res, req);
            default: return res.status(400).json({ error: 'Ação inválida.' });
        }
    } catch (err) {
        console.error('Erro em /api/auth:', err);
        res.status(500).json({ error: err.message && /e-mail/i.test(err.message) ? err.message : 'Erro no servidor. Tente novamente.' });
    }
};
