// api/db.js — ÚNICO caminho do navegador até o banco. O front-end NÃO tem mais nenhuma chave do Supabase:
// ele chama POST /api/db com o token de sessão, e AQUI as regras de quem pode o quê são aplicadas no servidor.
//
// Envelope: { method: 'GET'|'POST'|'PATCH'|'DELETE', path: 'tabela?filtros', body?: {...} }
const L = require('./_lib');

const RESERVED = new Set(['select', 'order', 'limit', 'offset']);
const COL = /^[a-z_][a-z0-9_]*$/;
const ID_RE = /^[A-Za-z0-9_\-:.]{1,120}$/;
const TABLES = new Set(['users', 'products', 'orders', 'chats', 'notifications', 'avaliacoes']);
const COMMUNITY_PREFIXES = ['community_post_', 'community_follow_'];
const isCommunity = (id) => typeof id === 'string' && COMMUNITY_PREFIXES.some(p => id.startsWith(p));
const strip = (s, max) => String(s ?? '').replace(/[<>]/g, '').slice(0, max);
const bad = (status, error) => { const e = new Error(error); e.http = status; return e; };
const isAdmin = (me) => !!me && me.tipo === 'ADMIN';

// ---------------------------------------------------------------- moderação / validação de anúncio (RT-06)
const PROIBIDOS = /(?:^|[^a-z0-9])(ak[\s-]?47|ar[\s-]?15|fuzil|pistola|rev[o]lver|metralhadora|municao|maconha|erva|cocaina|crack|haxixe|lsd|ecstasy|skunk|cigarro eletronico|vape|pod descartavel)(?:$|[^a-z0-9])/;
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const PRODUCT_KEYS = new Set(['id', 'titulo', 'descricao', 'preco', 'preco_original', 'quantidade', 'categoria', 'img', 'loja', 'vendedor_id', 'cidade', 'realizaentrega', 'likes', 'vendas', 'created_at', 'updated_at']);

function validarProduto(b, parcial) {
    for (const k of Object.keys(b)) if (!PRODUCT_KEYS.has(k)) delete b[k];
    const out = {};
    const need = (k) => { if (!parcial && (b[k] === undefined || b[k] === null || b[k] === '')) throw bad(400, `Campo obrigatório ausente: ${k}.`); return b[k] !== undefined; };
    if (b.id !== undefined) { if (!ID_RE.test(String(b.id))) throw bad(400, 'ID de produto inválido.'); out.id = String(b.id); }
    if (need('titulo')) { out.titulo = strip(b.titulo, 120).trim(); if (out.titulo.length < 3) throw bad(400, 'Título muito curto.'); }
    if (b.descricao !== undefined) out.descricao = strip(b.descricao, 5000);
    if (need('preco')) { const p = Number(b.preco); if (!Number.isFinite(p) || p < 0.01 || p > 1000000) throw bad(400, 'Preço inválido (use um valor maior que zero).'); out.preco = Math.round(p * 100) / 100; }
    if (b.preco_original !== undefined) { if (b.preco_original === null) out.preco_original = null; else { const p = Number(b.preco_original); if (!Number.isFinite(p) || p < 0 || p > 1000000) throw bad(400, 'Preço original inválido.'); out.preco_original = p; } }
    if (need('quantidade')) { const q = Number(b.quantidade); if (!Number.isInteger(q) || q < 0 || q > 100000) throw bad(400, 'Quantidade inválida.'); out.quantidade = q; }
    if (b.categoria !== undefined) out.categoria = strip(b.categoria, 250);
    if (b.img !== undefined) {
        let arr; const raw = String(b.img);
        if (raw.length > 8000) throw bad(400, 'Imagens demais.');
        try { arr = JSON.parse(raw); } catch { arr = /^https?:\/\//i.test(raw) ? [raw] : null; }
        if (!Array.isArray(arr) || arr.length > 8 || arr.some(u => typeof u !== 'string' || !/^https?:\/\//i.test(u))) throw bad(400, 'Links de imagem inválidos (use http/https).');
        out.img = b.img;
    }
    if (b.loja !== undefined) out.loja = strip(b.loja, 120);
    if (b.cidade !== undefined) out.cidade = strip(b.cidade, 80);
    if (b.realizaentrega !== undefined) out.realizaentrega = !!b.realizaentrega;
    if (b.vendedor_id !== undefined) out.vendedor_id = String(b.vendedor_id);
    for (const k of ['likes', 'vendas']) if (b[k] !== undefined) { const n = Number(b[k]); if (!Number.isInteger(n) || n < 0) throw bad(400, `${k} inválido.`); out[k] = n; }
    for (const k of ['created_at', 'updated_at']) if (b[k] !== undefined) out[k] = new Date(b[k]).toISOString();
    if (out.titulo !== undefined || out.descricao !== undefined) {
        if (PROIBIDOS.test(norm(`${out.titulo || ''} ${out.descricao || ''}`))) throw bad(422, 'Este tipo de anúncio não é permitido na plataforma.');
    }
    return out;
}

// ---------------------------------------------------------------- usuários: o que cada um pode ver
const USER_PUBLIC = ['id', 'tipo', 'nome', 'avatar', 'cidade', 'estado', 'vendedor_rating', 'rating_count', 'comprador_rating', 'comprador_rating_count', 'created_at'];
const USER_LOGGED = [...USER_PUBLIC, 'last_seen', 'telefone', 'endereco'];
const USER_DENY_FILTER_ANON = new Set(['cpf', 'email', 'cep', 'pagamento', 'telefone', 'endereco']); // evita "oráculo" de busca
const SELF_FIELDS = ['nome', 'telefone', 'avatar', 'cidade', 'estado', 'endereco', 'cep', 'pagamento', 'last_seen', 'updated_at'];
const RATING_KEYS = ['vendedor_rating', 'rating_count', 'comprador_rating', 'comprador_rating_count'];
const pick = (row, cols) => { const o = {}; for (const c of cols) if (c in row) o[c] = row[c]; return o; };

function projectUser(row, me, wanted) {
    let o;
    if (isAdmin(me) || (me && row.id === me.id)) { o = { ...row }; delete o.senha_hash; delete o.senha; }
    else o = pick(row, me ? USER_LOGGED : USER_PUBLIC);
    return wanted ? pick(o, wanted) : o;
}

// ---------------------------------------------------------------- escopo das demais tabelas
const inList = (v, id) => {
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return false; } }
    return Array.isArray(v) && v.some(x => String(x) === String(id));
};
const orderScope = (r, me) => isAdmin(me) || (me && (r.buyer_id === me.id || r.seller_id === me.id));
const chatScope = (r, me) => isAdmin(me) || (me && (isCommunity(r.id) || r.seller_id === me.id || r.buyer_id === me.id || inList(r.participants, me.id)));
const chatOwn = (r, me) => isAdmin(me) || (me && (r.seller_id === me.id || r.buyer_id === me.id || inList(r.participants, me.id)));
const notifScope = (r, me) => isAdmin(me) || (me && String(r.user_id) === String(me.id));
const avalScope = (r, me) => isAdmin(me) || (me && (r.buyer_id === me.id || r.seller_id === me.id));

// ---------------------------------------------------------------- núcleo
function parseQuery(path, me) {
    const i = path.indexOf('?');
    const table = (i < 0 ? path : path.slice(0, i)).trim();
    if (!TABLES.has(table)) throw bad(404, 'Recurso não encontrado.');
    const params = new URLSearchParams(i < 0 ? '' : path.slice(i + 1));
    const admin = isAdmin(me);
    for (const [k, v] of params) {
        if (!COL.test(k) && !['or', 'and'].includes(k)) throw bad(400, 'Parâmetro inválido.');
        if (['or', 'and', 'not'].includes(k) && !admin) throw bad(403, 'Filtro não permitido.');
        if (k === 'select' && /[()!:]/.test(v) && !admin) throw bad(403, 'Seleção não permitida.');
        if (k === 'senha_hash' || k === 'senha') throw bad(403, 'Filtro não permitido.');
        if (k === 'order' && /senha/.test(v)) throw bad(403, 'Ordenação não permitida.');
        if (table === 'users' && !admin && USER_DENY_FILTER_ANON.has(k)) throw bad(403, 'Filtro não permitido.');
        if (table === 'users' && !admin && k === 'order' && /(cpf|email|cep|pagamento)/.test(v)) throw bad(403, 'Ordenação não permitida.');
    }
    return { table, params };
}
const filterKeys = (params) => [...params.keys()].filter(k => !RESERVED.has(k));
const eqValue = (params, key) => { const v = params.get(key); return v && v.startsWith('eq.') ? v.slice(3) : null; };

async function rawGet(table, params, keepOrder) {
    const p = new URLSearchParams(params);
    p.set('select', '*'); p.delete('limit'); p.delete('offset');
    if (!keepOrder) p.delete('order');
    return L.dbFetch(`${table}?${p.toString()}`);
}
// aplica escopo -> ordem já veio do banco -> offset/limit -> colunas pedidas
function finishGet(rows, params, scopeFn, me) {
    let out = scopeFn ? rows.filter(r => scopeFn(r, me)) : rows;
    const off = Number(params.get('offset')) || 0, lim = Number(params.get('limit')) || 0;
    if (off) out = out.slice(off);
    if (lim) out = out.slice(0, lim);
    const sel = (params.get('select') || '*').split(',').map(x => x.trim()).filter(Boolean);
    return sel.includes('*') ? out : out.map(r => pick(r, sel.filter(c => COL.test(c))));
}
async function targets(table, params, scopeFn, me) {
    if (!filterKeys(params).length) throw bad(400, 'Operação sem filtro não é permitida.');
    const rows = await rawGet(table, params, false);
    if (!rows.every(r => scopeFn(r, me))) throw bad(403, 'Você não tem permissão para esta operação.');
    return rows;
}
async function write(table, params, method, body, prefer) {
    const p = new URLSearchParams(params); p.delete('select'); p.delete('order'); p.delete('limit'); p.delete('offset');
    const headers = {}; if (['return=minimal', 'return=representation'].includes(prefer)) headers.Prefer = prefer;
    const qs = p.toString();
    return L.dbFetch(`${table}${qs ? '?' + qs : ''}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const needLogin = (me) => { if (!me) throw bad(401, 'Faça login para continuar.'); };
const objBody = (b) => { if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad(400, 'Corpo inválido.'); if (JSON.stringify(b).length > 400000) throw bad(413, 'Conteúdo grande demais.'); return b; };

// ---------------------------------------------------------------- handlers por tabela
async function handle(table, method, params, body, me, prefer) {
    const admin = isAdmin(me);

    // ---------------- USERS
    if (table === 'users') {
        if (method === 'GET') {
            const sel = (params.get('select') || '*').split(',').map(s => s.trim()).filter(Boolean);
            const wanted = sel.includes('*') ? null : sel.filter(c => COL.test(c));
            const rows = await rawGet('users', params, true);
            let out = rows.map(r => projectUser(r, me, wanted));
            const off = Number(params.get('offset')) || 0, lim = Number(params.get('limit')) || 0;
            if (off) out = out.slice(off);
            if (lim) out = out.slice(0, lim);
            return out;
        }
        if (method === 'POST') throw bad(403, 'Cadastro é feito por /api/auth.');
        needLogin(me);
        const id = eqValue(params, 'id');
        if (!id || filterKeys(params).length !== 1) throw bad(400, 'Use apenas o filtro id=eq.<id>.');
        if (method === 'DELETE') { if (!(admin || id === me.id)) throw bad(403, 'Sem permissão.'); return write('users', params, 'DELETE'); }
        if (method === 'PATCH') {
            const b = objBody(body); let out = {};
            if (id === me.id || admin) {
                const cur = (await L.dbFetch(`users?select=id,tipo,cpf&id=eq.${encodeURIComponent(id)}&limit=1`))[0];
                if (!cur) throw bad(404, 'Usuário não encontrado.');
                for (const k of SELF_FIELDS) if (b[k] !== undefined) out[k] = typeof b[k] === 'string' ? strip(b[k], k === 'avatar' ? 3000 : 250) : b[k];
                for (const k of ['last_seen', 'updated_at']) {
                    delete out[k];
                    if (b[k]) { const d = new Date(b[k]); if (!isNaN(d)) out[k] = d.toISOString(); }
                }
                if (b.tipo !== undefined && cur.tipo !== 'ADMIN') {
                    if (['CLIENTE', 'VENDEDOR'].includes(b.tipo)) out.tipo = b.tipo;
                    else if (b.tipo === 'ADMIN' && !admin) throw bad(403, 'Sem permissão.');
                }
                if (admin && ['CLIENTE', 'VENDEDOR', 'ADMIN'].includes(b.tipo)) out.tipo = b.tipo;
                // o CPF só pode ser PREENCHIDO uma vez (nunca trocado): ele protege a troca de senha
                if (b.cpf !== undefined && !cur.cpf) {
                    if (!L.validarCPF(b.cpf)) throw bad(400, 'CPF inválido.');
                    const dup = await L.dbFetch(`users?select=id&cpf=eq.${L.onlyDigits(b.cpf)}&limit=1`);
                    if (dup.length) throw bad(409, 'Este CPF já está cadastrado.');
                    out.cpf = L.onlyDigits(b.cpf);
                }
                if (admin) for (const k of RATING_KEYS) if (b[k] !== undefined) out[k] = Number(b[k]);
            } else {
                // avaliar outra pessoa atualiza a média dela: só os campos de nota, com limites
                for (const k of RATING_KEYS) if (b[k] !== undefined) {
                    const n = Number(b[k]);
                    if (!Number.isFinite(n) || n < 0 || n > (k.endsWith('count') ? 1e6 : 5)) throw bad(400, 'Nota inválida.');
                    out[k] = n;
                }
                if (!Object.keys(out).length || Object.keys(b).some(k => !RATING_KEYS.includes(k) && k !== 'updated_at')) throw bad(403, 'Sem permissão.');
            }
            if (!Object.keys(out).length) return [];
            return write('users', params, 'PATCH', out, prefer);
        }
    }

    // ---------------- PRODUCTS
    if (table === 'products') {
        if (method === 'GET') return L.dbFetch(`products?${new URLSearchParams(params)}`);
        needLogin(me);
        if (method === 'POST') {
            if (!['VENDEDOR', 'ADMIN'].includes(me.tipo)) throw bad(403, 'Apenas vendedores podem anunciar.');
            const b = validarProduto(objBody(body), false);
            if (!b.id) b.id = `prod_${Date.now()}_${require('crypto').randomBytes(3).toString('hex')}`;
            if (!admin) { b.vendedor_id = me.id; b.likes = 0; b.vendas = 0; b.loja = b.loja || strip(me.nome, 120); }
            else b.vendedor_id = b.vendedor_id || me.id;
            return write('products', params, 'POST', b, prefer);
        }
        const rows = await rawGet('products', params, false);
        if (!filterKeys(params).length) throw bad(400, 'Operação sem filtro não é permitida.');
        const owns = (r) => admin || r.vendedor_id === me.id;
        if (method === 'DELETE') { if (!rows.every(owns)) throw bad(403, 'Sem permissão.'); return write('products', params, 'DELETE'); }
        if (method === 'PATCH') {
            const b = objBody(body);
            if (rows.every(owns)) {
                const v = validarProduto(b, true);
                if (!admin) { delete v.vendedor_id; delete v.id; }
                if (v.preco !== undefined && rows.length === 1 && rows[0].preco != null && Number(rows[0].preco) !== v.preco) { /* preço editado pelo dono: ok */ }
                return write('products', params, 'PATCH', v, prefer);
            }
            // quem não é dono: só curtir, contar venda ou BAIXAR estoque (nunca aumentar)
            if (rows.length !== 1) throw bad(403, 'Sem permissão.');
            const r = rows[0], out = {};
            for (const k of Object.keys(b)) {
                if (k === 'updated_at') continue;
                const n = Number(b[k]);
                if (k === 'likes' && Number.isInteger(n) && Math.abs(n - (r.likes || 0)) <= 1 && n >= 0) out.likes = n;
                else if (k === 'vendas' && Number.isInteger(n) && n >= (r.vendas || 0)) out.vendas = n;
                else if (k === 'quantidade' && Number.isInteger(n) && n >= 0 && n <= (r.quantidade ?? 0)) out.quantidade = n;
                else throw bad(403, 'Sem permissão.');
            }
            return Object.keys(out).length ? write('products', params, 'PATCH', out, prefer) : [];
        }
    }

    // ---------------- ORDERS
    if (table === 'orders') {
        needLogin(me);
        if (method === 'GET') return finishGet(await rawGet('orders', params, true), params, orderScope, me);
        if (method === 'POST') {
            const b = objBody(body);
            if (admin === false && b.buyer_id && b.buyer_id !== me.id) throw bad(403, 'Sem permissão.');
            b.buyer_id = me.id; b.buyer_name = strip(me.nome, 120);
            if (!b.id || !ID_RE.test(String(b.id))) throw bad(400, 'ID de pedido inválido.');
            if (b.seller_id === me.id) throw bad(400, 'Você não pode comprar o próprio produto.');
            const qtd = Number(b.quantity ?? 1);
            if (!Number.isInteger(qtd) || qtd < 1 || qtd > 1000) throw bad(400, 'Quantidade inválida.');
            if (!['pending', 'offer_pending'].includes(b.status)) throw bad(400, 'Status inicial inválido.');
            const total = Number(b.total);
            if (!Number.isFinite(total) || total <= 0) throw bad(400, 'Valor inválido.');
            if (b.product_id) {
                const [p] = await L.dbFetch(`products?select=vendedor_id,preco,quantidade&id=eq.${encodeURIComponent(b.product_id)}&limit=1`);
                if (!p) throw bad(400, 'Produto não encontrado.');
                if (b.seller_id !== 'system' && b.seller_id !== p.vendedor_id) throw bad(400, 'Vendedor não confere com o produto.');
                if (p.quantidade != null && qtd > p.quantidade) throw bad(400, 'Quantidade acima do estoque.');
                const cheio = Number(p.preco) * qtd;
                if (total > cheio + 0.01) throw bad(400, 'Valor acima do preço do produto.');
                if ((b.offer_amount === undefined || b.offer_amount === null) && Math.abs(total - cheio) > 0.01) throw bad(400, 'Valor não confere com o preço do produto.');
            }
            for (const k of ['seller_name', 'buyer_name', 'product_title']) if (b[k] !== undefined) b[k] = strip(b[k], 200);
            return write('orders', params, 'POST', b, prefer);
        }
        const rows = await targets('orders', params, orderScope, me);
        if (method === 'DELETE') return write('orders', params, 'DELETE');
        if (method === 'PATCH') {
            const b = objBody(body);
            if (!admin) for (const k of ['id', 'buyer_id', 'seller_id', 'product_id', 'buyer_name', 'seller_name']) delete b[k];
            const soComprador = rows.every(r => r.buyer_id === me.id && r.seller_id !== me.id);
            const soVendedor = rows.every(r => r.seller_id === me.id && r.buyer_id !== me.id);
            if (!admin && soComprador) { delete b.agree_seller; delete b.seller_reviewed; }
            if (!admin && soVendedor) { delete b.agree_buyer; delete b.buyer_reviewed; }
            if (b.total !== undefined && !admin) {
                const t = Number(b.total);
                for (const r of rows) {
                    const [p] = r.product_id ? await L.dbFetch(`products?select=preco&id=eq.${encodeURIComponent(r.product_id)}&limit=1`) : [];
                    if (!Number.isFinite(t) || t <= 0 || (p && t > Number(p.preco) * (r.quantity || 1) + 0.01)) throw bad(400, 'Valor inválido.');
                }
            }
            return write('orders', params, 'PATCH', b, prefer);
        }
    }

    // ---------------- CHATS (inclui posts/follows da comunidade)
    if (table === 'chats') {
        needLogin(me);
        if (method === 'GET') return finishGet(await rawGet('chats', params, true), params, chatScope, me);
        if (method === 'POST') {
            const b = objBody(body);
            if (!admin && !isCommunity(b.id) && !(b.seller_id === me.id || b.buyer_id === me.id || inList(b.participants, me.id))) throw bad(403, 'Sem permissão.');
            return write('chats', params, 'POST', b, prefer);
        }
        const rows = await targets('chats', params, chatScope, me);
        if (method === 'DELETE') { if (!rows.every(r => chatOwn(r, me))) throw bad(403, 'Sem permissão.'); return write('chats', params, 'DELETE'); }
        if (method === 'PATCH') {
            const b = objBody(body);
            if (!admin) {
                delete b.id;
                // quem só participa da comunidade (não é dono/participante) não mexe em donos nem em participantes
                if (!rows.every(r => chatOwn(r, me))) for (const k of ['seller_id', 'buyer_id', 'order_id', 'participants']) delete b[k];
            }
            return write('chats', params, 'PATCH', b, prefer);
        }
    }

    // ---------------- NOTIFICATIONS
    if (table === 'notifications') {
        needLogin(me);
        if (method === 'GET') return finishGet(await rawGet('notifications', params, true), params, notifScope, me);
        if (method === 'POST') {
            const b = objBody(body);
            if (!ID_RE.test(String(b.user_id || ''))) throw bad(400, 'Destinatário inválido.');
            return write('notifications', params, 'POST', { user_id: b.user_id, message: strip(b.message, 500), type: strip(b.type || 'info', 30), read: false }, prefer);
        }
        await targets('notifications', params, notifScope, me);
        if (method === 'DELETE') return write('notifications', params, 'DELETE');
        if (method === 'PATCH') { const b = objBody(body); return write('notifications', params, 'PATCH', { read: !!b.read }, prefer); }
    }

    // ---------------- AVALIACOES (leitura pública)
    if (table === 'avaliacoes') {
        if (method === 'GET') return L.dbFetch(`avaliacoes?${new URLSearchParams(params)}`);
        needLogin(me);
        if (method === 'POST') {
            const b = objBody(body);
            const r = Number(b.rating);
            if (!Number.isFinite(r) || r < 0 || r > 5) throw bad(400, 'Nota inválida.');
            if (b.order_id) {
                const [o] = await L.dbFetch(`orders?select=buyer_id,seller_id&id=eq.${encodeURIComponent(b.order_id)}&limit=1`);
                if (!o || !orderScope(o, me)) throw bad(403, 'Você não participou deste pedido.');
            } else if (!admin) throw bad(400, 'Pedido obrigatório.');
            b.comentario = strip(b.comentario, 2000); b.avaliador_nome = strip(me.nome, 120);
            for (const k of ['images', 'videos']) if (b[k] !== undefined && (!Array.isArray(b[k]) || b[k].length > 10 || b[k].some(u => !/^https?:\/\//i.test(String(u))))) throw bad(400, 'Mídia inválida.');
            return write('avaliacoes', params, 'POST', b, prefer);
        }
        const rows = await rawGet('avaliacoes', params, false);
        if (!filterKeys(params).length) throw bad(400, 'Operação sem filtro não é permitida.');
        for (const r of rows) {
            if (avalScope(r, me)) continue;
            const [o] = r.order_id ? await L.dbFetch(`orders?select=buyer_id,seller_id&id=eq.${encodeURIComponent(r.order_id)}&limit=1`) : [];
            if (!o || !orderScope(o, me)) throw bad(403, 'Sem permissão.');
        }
        if (method === 'DELETE') return write('avaliacoes', params, 'DELETE');
        if (method === 'PATCH') { const b = objBody(body); if (b.comentario !== undefined) b.comentario = strip(b.comentario, 2000); delete b.id; return write('avaliacoes', params, 'PATCH', b, prefer); }
    }
    throw bad(405, 'Operação não suportada.');
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ message: 'Método não permitido.' });
    if (!L.SUPABASE_URL || !L.SERVICE_KEY || !L.SESSION_SECRET) { console.error('Variáveis de ambiente incompletas'); return res.status(500).json({ message: 'Configuração do servidor incompleta.' }); }
    const env = L.readBody(req);
    const method = String(env.method || 'GET').toUpperCase();
    try {
        if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw bad(405, 'Método inválido.');
        if (typeof env.path !== 'string' || env.path.length > 4000) throw bad(400, 'Caminho inválido.');
        const me = await L.currentUser(req);
        if (!L.rateLimit('db:' + (me ? me.id : L.clientIp(req)), me ? 600 : 240, 60 * 1000)) throw bad(429, 'Muitas requisições. Aguarde um instante.');
        const { table, params } = parseQuery(env.path, me);
        const data = await handle(table, method, params, env.body, me, env.prefer);
        if (method === 'DELETE') return res.status(200).json({ ok: true });
        return res.status(200).json(data === undefined || data === null ? [] : data);
    } catch (err) {
        if (err.http) return res.status(err.http).json({ message: err.message });
        console.error('Erro em /api/db:', err.message);
        return res.status(err.status && err.status < 500 ? 400 : 500).json({ message: 'Não foi possível concluir a operação.' });
    }
};
