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
        return res.status(400).json({ error: 'Ação inválida.' });
    } catch (err) {
        console.error('Erro em /api/auth:', err);
        res.status(500).json({ error: 'Erro no servidor. Tente novamente.' });
    }
};
