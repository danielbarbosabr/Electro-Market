// api/auth.js
// Substitui o cadastro/login que antes era feito direto do navegador contra o
// Supabase (sem hash de senha real e deixando o cliente escolher o "tipo").
//
// Precisa de duas variáveis de ambiente na Vercel (Project Settings > Environment Variables):
//   SUPABASE_URL                -> mesma que já existe
//   SUPABASE_SERVICE_ROLE_KEY   -> pegue em Supabase > Project Settings > API > service_role
//                                   (NUNCA coloque essa chave no front-end, só aqui no servidor)

const crypto = require('crypto');

const SUPABASE_URL = process.env.ELECTRO_MARKET_SUPABASE_URL || process.env.NEXT_PUBLIC_ELECTRO_MARKET_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SERVICE_KEY  = process.env.ELECTRO_MARKET_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ELECTRO_MARKET_SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESET_EMAIL_FROM = process.env.RESET_EMAIL_FROM || 'ElectroMarket <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || ''; 

function hashSenha(senha) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function confereSenha(senha, armazenado) {
    if (!armazenado || !armazenado.includes(':')) return false;
    const [salt, hash] = armazenado.split(':');
    const tentativa = crypto.scryptSync(senha, salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(tentativa, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

async function supaFetch(path, options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...options,
        headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw data;
    return data;
}

function validarCPF(cpf) {
    cpf = (cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += Number(cpf[i]) * (10 - i);
    let dig = (soma * 10) % 11; if (dig === 10) dig = 0;
    if (dig !== Number(cpf[9])) return false;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += Number(cpf[i]) * (11 - i);
    dig = (soma * 10) % 11; if (dig === 10) dig = 0;
    return dig === Number(cpf[10]);
}

async function alterarSenha(body, res) {
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    const senhaAtual = String(body.senhaAtual || '');
    const novaSenha = String(body.novaSenha || '');
    const userId = String(body.userId || '');
    if (!userId || !validarCPF(cpf) || !senhaAtual || novaSenha.length < 8 || novaSenha.length > 128) {
        return res.status(400).json({ error: 'Informe CPF válido, senha atual e uma nova senha com pelo menos 8 caracteres.' });
    }
    const users = await supaFetch(`users?select=id,cpf,senha_hash&id=eq.${encodeURIComponent(userId)}&cpf=eq.${encodeURIComponent(cpf)}&limit=1`);
    const user = users && users[0];
    if (!user || !confereSenha(senhaAtual, user.senha_hash)) {
        return res.status(401).json({ error: 'CPF ou senha atual incorretos. Se sua conta for antiga, solicite a migração segura da senha ao suporte.' });
    }
    if (senhaAtual === novaSenha) return res.status(400).json({ error: 'A nova senha deve ser diferente da senha atual.' });
    await supaFetch(`users?id=eq.${encodeURIComponent(userId)}&cpf=eq.${encodeURIComponent(cpf)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ senha_hash: hashSenha(novaSenha), updated_at: new Date().toISOString() })
    });
    return res.status(200).json({ success: true, message: 'Senha alterada com sucesso.' });
}



function senhaForte(senha) {
    return typeof senha === 'string' && senha.length >= 10 && senha.length <= 128 &&
        /[a-z]/.test(senha) && /[A-Z]/.test(senha) && /\d/.test(senha) && /[^A-Za-z0-9]/.test(senha);
}

async function enviarEmail(destinatario, assunto, html) {
    if (!RESEND_API_KEY) throw new Error('Envio de e-mail não configurado no servidor (RESEND_API_KEY).');
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: RESET_EMAIL_FROM, to: [destinatario], subject: assunto, html })
    });
    if (!response.ok) {
        const detail = await response.text();
        console.error('Falha ao enviar e-mail de recuperação:', detail);
        throw new Error('Não foi possível enviar o e-mail de recuperação. Verifique a configuração de e-mail.');
    }
}

async function solicitarRedefinicao(body, req, res) {
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    if (!validarCPF(cpf)) return res.status(400).json({ error: 'CPF inválido. Confira os números e tente novamente.' });
    // Resposta genérica para não revelar se um CPF possui conta cadastrada.
    const users = await supaFetch(`users?select=id,email,nome&cpf=eq.${encodeURIComponent(cpf)}&limit=1`);
    const user = users && users[0];
    if (user && user.email) {
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await supaFetch('password_reset_tokens', {
            method: 'POST', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ user_id: user.id, token_hash: tokenHash, expires_at: expiresAt })
        });
        const host = req.headers['x-forwarded-host'] || req.headers.host || '';
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const baseUrl = APP_URL || `${proto}://${host}`;
        const resetUrl = `${baseUrl}/?resetToken=${encodeURIComponent(token)}`;
        const safeName = String(user.nome || 'cliente').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        await enviarEmail(user.email, 'Redefinição de senha — ElectroMarket', `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>Redefinição de senha</h2><p>Olá, ${safeName}.</p><p>Recebemos uma solicitação para criar uma nova senha para sua conta ElectroMarket.</p><p><a href="${resetUrl}" style="display:inline-block;background:#f0b400;color:#111;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">CRIAR NOVA SENHA</a></p><p>O link expira em 30 minutos e só pode ser usado uma vez. Se você não solicitou isso, ignore este e-mail.</p></div>`);
    }
    return res.status(200).json({ success: true, message: 'Se os dados corresponderem a uma conta, enviaremos um link de recuperação ao e-mail cadastrado.' });
}

async function redefinirSenha(body, res) {
    const token = String(body.token || '');
    const novaSenha = String(body.novaSenha || '');
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'Link de recuperação inválido ou expirado.' });
    if (!senhaForte(novaSenha)) return res.status(400).json({ error: 'Use de 10 a 128 caracteres, incluindo letra maiúscula, minúscula, número e símbolo.' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const rows = await supaFetch(`password_reset_tokens?select=id,user_id,expires_at,used_at&token_hash=eq.${tokenHash}&limit=1`);
    const record = rows && rows[0];
    if (!record || record.used_at || new Date(record.expires_at).getTime() < Date.now()) {
        return res.status(400).json({ error: 'Link de recuperação inválido, já utilizado ou expirado. Solicite outro.' });
    }
    await supaFetch(`users?id=eq.${encodeURIComponent(record.user_id)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ senha_hash: hashSenha(novaSenha), updated_at: new Date().toISOString() })
    });
    await supaFetch(`password_reset_tokens?id=eq.${encodeURIComponent(record.id)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ used_at: new Date().toISOString() })
    });
    return res.status(200).json({ success: true, message: 'Senha redefinida com sucesso. Entre com sua nova senha.' });
}


async function iniciarRedefinicaoPorCodigo(body, res) {
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    if (!validarCPF(cpf)) return res.status(400).json({ error: 'CPF inválido. Confira os números e tente novamente.' });
    const users = await supaFetch(`users?select=id,email,nome&cpf=eq.${encodeURIComponent(cpf)}&limit=1`);
    const user = users && users[0];
    if (!user || !user.email) return res.status(200).json({ found: false });
    if (!RESEND_API_KEY) throw new Error('Envio de e-mail não configurado no servidor (RESEND_API_KEY).');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = crypto.createHash('sha256').update(`${user.id}:${code}`).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await supaFetch('password_reset_codes', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: user.id, code_hash: codeHash, expires_at: expiresAt })
    });
    const safeName = String(user.nome || 'cliente').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    await enviarEmail(user.email, 'Código para redefinir sua senha — ElectroMarket', `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2>Redefinição de senha</h2><p>Olá, ${safeName}.</p><p>Seu código de verificação é:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${code}</p><p>O código expira em 10 minutos e só pode ser usado uma vez. Se você não solicitou isso, ignore este e-mail.</p></div>`);
    return res.status(200).json({ found: true, message: 'Enviamos um código de 6 dígitos ao e-mail cadastrado. O código expira em 10 minutos.' });
}

async function redefinirComCodigo(body, res) {
    const cpf = String(body.cpf || '').replace(/\D/g, '');
    const code = String(body.codigo || '').trim();
    const novaSenha = String(body.novaSenha || '');
    if (!validarCPF(cpf)) return res.status(400).json({ error: 'CPF inválido.' });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Informe o código de 6 dígitos recebido por e-mail.' });
    if (!senhaForte(novaSenha)) return res.status(400).json({ error: 'Use de 10 a 128 caracteres, incluindo letra maiúscula, minúscula, número e símbolo.' });
    const users = await supaFetch(`users?select=id&cpf=eq.${encodeURIComponent(cpf)}&limit=1`);
    const user = users && users[0];
    if (!user) return res.status(400).json({ error: 'Código inválido ou expirado. Solicite outro.' });
    const codeHash = crypto.createHash('sha256').update(`${user.id}:${code}`).digest('hex');
    const rows = await supaFetch(`password_reset_codes?select=id,expires_at,used_at&user_id=eq.${encodeURIComponent(user.id)}&code_hash=eq.${codeHash}&used_at=is.null&order=created_at.desc&limit=1`);
    const record = rows && rows[0];
    if (!record || new Date(record.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'Código inválido ou expirado. Solicite outro.' });
    await supaFetch(`users?id=eq.${encodeURIComponent(user.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ senha_hash: hashSenha(novaSenha), updated_at: new Date().toISOString() }) });
    await supaFetch(`password_reset_codes?id=eq.${encodeURIComponent(record.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: new Date().toISOString() }) });
    return res.status(200).json({ success: true, message: 'Senha redefinida com sucesso. Entre com sua nova senha.' });
}

async function registrar(body, res) {
    const {
        nome, cpf, email, telefone, senha,
        endereco, cep, cidade, estado, pagamento, avatar, tipoConta
    } = body;

    if (!nome || !cpf || !email || !senha) {
        return res.status(400).json({ error: 'Preencha nome, CPF, e-mail e senha.' });
    }
    if (!validarCPF(cpf)) {
        return res.status(400).json({ error: 'CPF inválido.' });
    }
    if (senha.length < 6) {
        return res.status(400).json({ error: 'Senha precisa ter ao menos 6 caracteres.' });
    }

    // Confere e-mail duplicado
    const existentes = await supaFetch(`users?select=id&email=eq.${encodeURIComponent(email)}&limit=1`);
    if (existentes && existentes.length) {
        return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    }

    const payload = {
        id: crypto.randomUUID(),
        // "tipo" é decidido AQUI, nunca pelo que o cliente mandar.
        // Só aceita CLIENTE ou VENDEDOR; nunca ADMIN por este caminho.
        tipo: tipoConta === 'VENDEDOR' ? 'VENDEDOR' : 'CLIENTE',
        nome, cpf: cpf.replace(/\D/g, ''), email,
        telefone: (telefone || '').replace(/\D/g, ''),
        senha_hash: hashSenha(senha),
        endereco: endereco || '',
        cep: (cep || '').replace(/\D/g, ''),
        cidade: cidade || '',
        estado: estado || '',
        pagamento: pagamento || '',
        avatar: avatar || '[]'
    };

    const [user] = await supaFetch('users', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload)
    });

    delete user.senha_hash;
    res.status(200).json({ user });
}

async function login(body, res) {
    const { identifier, senha } = body;
    if (!identifier || !senha) {
        return res.status(400).json({ error: 'Informe e-mail/telefone e senha.' });
    }

    const isEmail = identifier.includes('@');
    const campo = isEmail
        ? `email=eq.${encodeURIComponent(identifier.trim())}`
        : `telefone=eq.${identifier.replace(/\D/g, '')}`;

    const users = await supaFetch(`users?select=*&${campo}&limit=1`);
    const user = users && users[0];

    if (!user || !confereSenha(senha, user.senha_hash)) {
        return res.status(401).json({ error: 'E-mail/telefone ou senha incorretos.' });
    }

    delete user.senha_hash;
    res.status(200).json({ user });
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido.' });
    }
    if (!SUPABASE_URL || !SERVICE_KEY) {
        return res.status(500).json({ error: 'Configuração do servidor incompleta.' });
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
    }

    try {
        if (body.action === 'registrar') return await registrar(body, res);
        if (body.action === 'login') return await login(body, res);
        if (body.action === 'alterar_senha') return await alterarSenha(body, res);
        if (body.action === 'solicitar_redefinicao') return await solicitarRedefinicao(body, req, res);
        if (body.action === 'iniciar_redefinicao_codigo') return await iniciarRedefinicaoPorCodigo(body, res);
        if (body.action === 'redefinir_com_codigo') return await redefinirComCodigo(body, res);
        if (body.action === 'redefinir_senha') return await redefinirSenha(body, res);
        return res.status(400).json({ error: 'Ação inválida.' });
    } catch (err) {
        console.error('Erro em /api/auth:', err);
        res.status(500).json({ error: 'Erro no servidor. Tente novamente.' });
    }
};
