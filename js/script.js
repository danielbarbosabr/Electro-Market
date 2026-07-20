// ============================================
// ELECTROMARKET - SCRIPT PRINCIPAL
// Melhorias: Toast system, Yeti corrigido,
//            debounce na busca, skeleton loading,
//            toggle tema global, melhor gestão de estado
// ============================================

let allProductsCache = [];
let cart              = JSON.parse(localStorage.getItem('electroCart'))    || [];
let likedProducts     = JSON.parse(localStorage.getItem('electroLiked'))   || [];
let accessHistory     = JSON.parse(localStorage.getItem('electroHistory')) || [];
let currentChat       = null;
let adminOrdersCache  = [];
let currentOrderViewType = 'buyer';
let ordersCache       = [];
let currentReplyIndex   = null;
let editingMessageIndex = null;
let riveInstance      = null;
let chatsCache        = [];
let notificationsCache = JSON.parse(localStorage.getItem('electroNotifs')) || [];
let chatPollInterval  = null;
let ordersPollInterval = null;
let lastChatSignature = null;
let productsFetchToken = 0;

// Formata um valor em reais; se for 0 (ou vazio), mostra "GRÁTIS"
function formatPreco(valor, opts = {}) {
    const v = parseFloat(valor) || 0;
    if (v === 0) return opts.htmlGratis !== false ? '<span class="text-success fw-bold">GRÁTIS</span>' : 'GRÁTIS';
    return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

const ORDER_STATUS_MAP = {
    'pending':         { text: 'Em Aprovação',             class: 'bg-warning text-dark' },
    'offer_pending':   { text: 'Oferta Enviada',            class: 'bg-info text-dark' },
    'accepted':        { text: 'Aprovado (Chat Liberado)', class: 'bg-success' },
    'agreement':       { text: 'Combinando Entrega',       class: 'bg-info' },
    'shipping':        { text: 'Em Rota de Entrega',       class: 'bg-primary' },
    'awaiting_pickup': { text: 'Aguardando Retirada',      class: 'bg-primary' },
    'finished':        { text: 'Finalizado',               class: 'bg-dark' },
    'cancelled':       { text: 'Cancelado',                class: 'bg-danger' },
    'dispute':         { text: 'Em Disputa',               class: 'bg-danger' }
};

const CONDICOES_PRODUTO = ['Novo', 'Usado - Como novo', 'Usado - Bom estado', 'Usado - Estado regular', 'Para peças ou não funciona', 'Recondicionado'];
const REGEX_CONDICAO = new RegExp(`^\\[(${CONDICOES_PRODUTO.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\]\\s*`);
function condToClass(c) {
    return c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function renderCondicoesOptions(selected) {
    let h = '<option value="">Selecione a condição</option>';
    CONDICOES_PRODUTO.forEach(c => {
        h += `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`;
    });
    return h;
}

function renderRatingStars(level) {
    const r = Math.max(0, Math.min(5, Math.round(level || 0)));
    let s = '';
    for (let i = 1; i <= 5; i++) {
        s += `<i class="bi bi-star${i <= r ? '-fill' : ''}" style="color:#FFC107;font-size:inherit;"></i>`;
    }
    return s;
}

// ============================================
// SISTEMA DE TOAST (substitui alerts)
// ============================================

/**
 * Cria uma notificação persistente no Banco de Dados e mostra o Toast na tela
 */
async function createPersistentNotification(message, type = 'info', userId = null) {
    const targetId = userId || getSavedUser()?.id;
    const newNotif = { 
        id: crypto.randomUUID(),
        message, 
        type, 
        read: false, 
        created_at: new Date().toISOString() 
    };
    
    // 1. Mostra o feedback visual (Toast) imediatamente
    showToast(message, type);

    // 2. Salva localmente (Log de no máximo 10 itens)
    notificationsCache.unshift(newNotif);
    if (notificationsCache.length > 10) notificationsCache.pop();
    localStorage.setItem('electroNotifs', JSON.stringify(notificationsCache));

    // 3. Se houver um usuário e banco, tenta salvar remotamente
    if (targetId) {
        try {
            await supabaseFetch('notifications', { method: 'POST', body: JSON.stringify({ user_id: targetId, ...newNotif, id: undefined }) });
        } catch (e) { console.error("Erro ao salvar log:", e); }
    }
    loadNotifications();
}

/**
 * Busca a quantidade de pedidos pendentes de aprovação do vendedor
 * e sincroniza os badges (nav desktop, menu mobile e dock inferior).
 */
async function updateSellerPendingBadge(sellerId) {
    try {
        const pending = await supabaseFetch(`orders?select=id,status&seller_id=eq.${sellerId}&status=in.(pending,offer_pending)`);
        const count = pending?.length || 0;
        document.querySelectorAll('#pendingBadgeNav, #pendingBadgeMobile, #pendingBadgeDock').forEach(el => {
            el.textContent = count > 9 ? '9+' : String(count);
            el.classList.toggle('d-none', count === 0);
        });
    } catch (e) {
        console.error('Erro ao verificar pedidos pendentes:', e);
    }
}

function showToast(message, type = 'info', duration = 3500) {
    let container = document.getElementById('toastContainerCustom');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainerCustom';
        container.className = 'toast-container-custom';
        document.body.appendChild(container);
    }

    const icons = { success: 'bi-check-circle-fill', error: 'bi-x-circle-fill', info: 'bi-info-circle-fill', warning: 'bi-exclamation-triangle-fill' };
    const toast = document.createElement('div');
    toast.className = `toast-custom ${type}`;
    toast.innerHTML = `
        <i class="bi ${icons[type] || icons.info} fs-4"></i>
        <div class="flex-grow-1">${message}</div>
        <i class="bi bi-x fs-4 cursor-pointer opacity-50" onclick="this.parentElement.classList.add('fade-out'); setTimeout(()=>this.parentElement.remove(), 300)"></i>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 320);
    }, duration);
}

// ============================================
// FETCH SUPABASE
// ============================================

async function supabaseFetch(path, options = {}) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${path}`, {
        ...options,
        headers: {
            'apikey': CONFIG.SUPABASE_KEY,
            'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    if (!res.ok) throw await res.json().catch(() => ({ message: 'Erro na requisição' }));
    if (options.method === 'DELETE' || res.status === 204) return true;
    const text = await res.text();
    return text ? JSON.parse(text) : [];
}

// ============================================
// CARREGAR PRODUTOS (com skeleton)
// ============================================

/**
 * Sai da tela de pedidos estilo WhatsApp (Minhas Vendas/Compras/Solicitações) e
 * devolve a página ao estado normal de rolagem. Chamada sempre que o usuário
 * navega pra qualquer outra área do site (produtos, meus produtos, etc.).
 */
window.exitWaOrdersView = function() {
    stopOrdersPolling();
    document.getElementById('whatsappOrdersView')?.classList.add('d-none');
    document.getElementById('productGridMain')?.classList.remove('d-none');
    document.body.classList.remove('wa-locked', 'admin-chat-fullscreen');
    document.body.style.overflow = '';
    if (typeof window.closeWaChat === 'function') window.closeWaChat();
};

async function loadPage(query = 'eletronicos', forceRefresh = false) {
    // Limpa hash de produto ao navegar
    if (window.location.hash.startsWith('#/produto/')) {
        history.pushState(null, '', window.location.pathname + window.location.search);
    }
    const grid = document.getElementById('productsGrid');
    const user = getSavedUser();
    const role = user?.tipo || 'CLIENTE';
    const hero = document.getElementById('heroSection');

    window.exitWaOrdersView();
    hideAdminTopNavTabs();
    if (grid) grid.style.display = '';

    // Usa o cache já carregado para buscas/filtragens (evita ida à rede a cada letra digitada).
    // Só busca no servidor na primeira carga, quando o papel do usuário muda, quando forçado,
    // ou ao entrar em Ofertas (preços/descontos podem ter sido alterados por outros vendedores
    // depois que esta página já tinha carregado o cache).
    const isOfertas = typeof query === 'string' && query.toLowerCase() === 'ofertas';
    const needsFetch = forceRefresh || isOfertas || allProductsCache.length === 0 || loadPage._lastRole !== role;

    if (needsFetch) {
        // Skeleton loading - muito mais suave que um spinner central
        grid.style.display = 'grid';
        grid.classList.remove('order-view-active');
        grid.innerHTML = Array(12).fill(0).map(() => `
            <div class="card border-0" style="border-radius: 10px; overflow: hidden;">
                <div class="skeleton" style="height: 160px;"></div>
                <div style="padding: 12px;">
                    <div class="skeleton mb-2" style="height: 14px; width: 80%;"></div>
                    <div class="skeleton mb-1" style="height: 14px; width: 60%;"></div>
                    <div class="skeleton" style="height: 22px; width: 50%;"></div>
                </div>
            </div>`).join('');
    }

    // Token de requisição: evita que uma resposta antiga (de uma busca anterior)
    // sobrescreva o resultado de uma busca mais recente (condição de corrida).
    const myToken = ++productsFetchToken;

    try {
        let path = 'products?select=*';
        if (user && user.tipo === 'VENDEDOR') {
            path += `&vendedor_id=eq.${user.id}`;
        }

        if (needsFetch) {
            const data = await supabaseFetch(path);
            if (myToken !== productsFetchToken) return; // resposta obsoleta, ignora
            allProductsCache = data || [];
            loadPage._lastRole = role;
        }

        if (hero) {
            hero.classList.toggle('d-none', role === 'VENDEDOR' || query !== 'eletronicos');
        }

        let products = allProductsCache;
        let matchedStores = [];
        if (query !== 'eletronicos' && query !== '') {
            const term = query.toLowerCase();
            if (term === 'ofertas') {
                products = products.filter(p => parseFloat(p.preco_original || 0) > parseFloat(p.preco || 0));
                document.getElementById('gridTitle').textContent = 'Ofertas Imperdíveis';
            } else {
                // Além de título/categoria, a busca também encontra lojas (vendedores) pelo
                // nome — assim dá pra digitar o nome de uma loja e já ver os anúncios dela,
                // igual Mercado Livre/Shopee.
                products = products.filter(p =>
                    (p.titulo    || '').toLowerCase().includes(term) ||
                    (p.categoria || '').toLowerCase().includes(term) ||
                    (p.loja      || '').toLowerCase().includes(term)
                );
                document.getElementById('gridTitle').textContent = `Resultados para "${query}"`;

                // Identifica lojas cujo NOME bate com o termo buscado, pra mostrar um
                // atalho de "loja encontrada" acima dos resultados de produto.
                const storesMap = new Map(); // vendedor_id -> {loja, vendedor_id}
                allProductsCache.forEach(p => {
                    if (p.loja && p.vendedor_id && p.loja.toLowerCase().includes(term)) {
                        storesMap.set(p.vendedor_id, { loja: p.loja, vendedor_id: p.vendedor_id });
                    }
                });
                matchedStores = [...storesMap.values()];
            }
        } else {
            document.getElementById('gridTitle').textContent = 'Recomendados para você';
        }

        await renderStorefrontBanner(matchedStores);
        renderGrid(products);
        updateStoreFilterUI();
        updateCategoryFilterUI();
    } catch (e) {
        if (myToken !== productsFetchToken) return;
        console.error(e);
        grid.innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="bi bi-wifi-off fs-1 text-muted d-block mb-3"></i>
                <h5>Erro ao carregar produtos</h5>
                <button class="btn btn-primary mt-3" onclick="loadPage(undefined, true)">Tentar novamente</button>
            </div>`;
    }
}

/** "Início" universal: pro admin, início é literalmente o painel administrativo — não existe
 *  mais uma vitrine separada pra ele "voltar". Pra cliente/vendedor, início continua sendo a
 *  vitrine normal de produtos. Use isso em vez de chamar loadPage('eletronicos') direto em
 *  qualquer botão/link que signifique "voltar pro início". */
/** Busca do admin: em vez de levar pra vitrine de cliente com produtos aleatórios,
 *  filtra Publicações E Usuários juntos, dentro da aba única "Conteúdo", e mostra
 *  o resultado ali (as duas tabelas são atualizadas ao mesmo tempo). */
window.adminSearchProducts = async function(term) {
    term = (term || '').trim();

    // Painel ainda não está montado na tela (ex: admin estava em "Todos os Produtos"
    // ou noutra tela) — carrega o painel primeiro e reaplica a busca quando terminar.
    if (!document.querySelector('.admin-dash')) {
        window._pendingAdminSearch = term;
        await window.renderAdminPanel();
        return;
    }

    const allProds = window._adminProductsCache || [];
    const allUsers = window._adminUsersCache || [];
    const t = term.toLowerCase();

    const filteredProds = term
        ? allProds.filter(p =>
            (p.titulo    || '').toLowerCase().includes(t) ||
            (p.loja      || '').toLowerCase().includes(t) ||
            (p.categoria || '').toLowerCase().includes(t))
        : allProds;

    const filteredUsers = term
        ? allUsers.filter(u =>
            (u.nome  || '').toLowerCase().includes(t) ||
            (u.email || '').toLowerCase().includes(t))
        : allUsers;

    const currentUser = getSavedUser();
    const prodsBody = document.getElementById('adminProdsTableBody');
    if (prodsBody) prodsBody.innerHTML = buildAdminProductsRows(filteredProds);
    const usersBody = document.getElementById('adminUsersTableBody');
    if (usersBody) usersBody.innerHTML = buildAdminUsersRows(filteredUsers, currentUser?.id);

    const prodsCount = document.getElementById('adminContentProdsCount');
    if (prodsCount) prodsCount.textContent = filteredProds.length;
    const usersCount = document.getElementById('adminContentUsersCount');
    if (usersCount) usersCount.textContent = filteredUsers.length;

    const navBtn = document.querySelector('.admin-nav-link[data-tab="admin-content"]');
    if (navBtn) window.switchAdminTab(navBtn);
    window.updateMobileNavActive('admin-content');

    const titleEl = document.getElementById('adminPanelTitle');
    if (titleEl) titleEl.textContent = term ? `Conteúdo — resultados para "${term}"` : 'Conteúdo';
};

window.goHome = function() {
    const user = getEffectiveUser();
    if (window.location.hash.startsWith('#/produto/')) {
        history.pushState(null, '', window.location.pathname + window.location.search);
    }
    if (user?.tipo === 'ADMIN') {
        window.renderAdminPanel();
    } else {
        loadPage('eletronicos');
    }
};

/** Navega direto pra uma aba do painel admin a partir do dock mobile (barra de baixo).
 *  Se o painel ainda não estiver montado na tela, renderiza ele já abrindo na aba pedida;
 *  se já estiver montado, só troca de aba sem recarregar tudo de novo. */
window.goToAdminTab = function(tabId) {
    window._adminActiveTab = tabId;
    const navBtn = document.querySelector(`.admin-nav-link[data-tab="${tabId}"]`);
    if (document.querySelector('.admin-dash') && navBtn) {
        window.switchAdminTab(navBtn);
    } else {
        window.renderAdminPanel();
    }
    window.updateMobileNavActive(tabId);
};

// ============================================
// PRESENÇA ONLINE/OFFLINE
// ============================================

const PRESENCE_ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // considera "online" se visto há menos de 2 min

/**
 * A cada 60s, se houver alguém logado, atualiza users.last_seen no Supabase.
 * Requer a coluna 'last_seen' (timestamptz) na tabela users — se ela ainda
 * não existir, falha silenciosamente (não quebra o resto do site).
 */
window.startPresenceHeartbeat = function() {
    const beat = async () => {
        const user = getSavedUser();
        if (!user) return;
        try {
            await supabaseFetch(`users?id=eq.${user.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ last_seen: new Date().toISOString() })
            });
        } catch (e) { /* coluna ainda não existe no banco — ignora silenciosamente */ }
    };
    beat();
    setInterval(beat, 60000);
};

function isRecentlyOnline(lastSeen) {
    if (!lastSeen) return false;
    return (Date.now() - new Date(lastSeen).getTime()) < PRESENCE_ONLINE_THRESHOLD_MS;
}

/**
 * Efeito 3D no modal de detalhe: passar o mouse sobre a foto principal dá um
 * leve "relevo", e clicar nas bordas laterais troca pra próxima/anterior
 * imagem — substitui a fileira de miniaturas embaixo da foto.
 */
window.tiltDetailImage = function(e, container) {
    const img = container.querySelector('#mainDetailImg');
    if (!img) return;
    const rect = container.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const rotateY = (x - 0.5) * 12;
    const rotateX = (0.5 - y) * 8;
    img.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.03,1.03,1.03)`;
};

window.resetDetailImage = function(container) {
    const img = container.querySelector('#mainDetailImg');
    if (img) img.style.transform = '';
};

window.cycleDetailImage = function(pid, container, dir) {
    if (!container) return;
    const product = allProductsCache.find(p => p.id === pid);
    const imgs = safeParseImages(product?.img);
    if (imgs.length < 2) return;

    let idx = parseInt(container.dataset.idx || '0', 10);
    idx = (idx + dir + imgs.length) % imgs.length;
    container.dataset.idx = idx;

    const imgEl = container.querySelector('#mainDetailImg');
    if (imgEl) {
        imgEl.style.opacity = '0';
        setTimeout(() => {
            imgEl.src = normalizeImageUrl(imgs[idx]) || imgs[idx];
            imgEl.style.opacity = '1';
        }, 130);
    }
    container.querySelectorAll('.card-img-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
};

window.refreshDetailLikeBtn = function(pid) {
    const btn = document.getElementById('detailLikeBtn');
    if (!btn) return;
    const liked   = likedProducts.includes(pid);
    const product = allProductsCache.find(p => p.id == pid);
    btn.classList.toggle('text-danger', liked);
    btn.classList.toggle('text-muted', !liked);
    btn.innerHTML = `<i class="bi ${liked ? 'bi-heart-fill' : 'bi-heart'} me-2"></i>${liked ? 'Curtido' : 'Curtir'}`;

    const barEl  = document.getElementById('detailLikesBar');
    const textEl = document.getElementById('detailLikesText');
    if (barEl && textEl && product) {
        const n = product.likes || 0;
        const level = n === 0 ? 0 : Math.min(5, Math.ceil(n / 10));
        barEl.querySelectorAll('.flex-grow-1').forEach((seg, i) => {
            seg.style.backgroundColor = level >= (i + 1) ? colorScale[i] : '#eee';
        });
        textEl.innerHTML = n > 0
            ? `<i class="bi bi-heart-fill" style="color:#ff4d6d;"></i> ${n} curtida${n === 1 ? '' : 's'}`
            : 'Ainda sem curtidas';
    }
};

const colorScale = ['#F23D35', '#FF8900', '#FFE600', '#ADE07E', '#00A650'];

function formatSoldCount(count) {
    if (count >= 100000) return '+100 mil';
    if (count >= 10000) return `+${Math.floor(count / 1000)} mil`;
    if (count >= 1000) return `${(count / 1000).toFixed(1).replace('.0', '')} mil`;
    return count.toString();
}

function renderCard(item) {
    if (!item?.titulo) return '';
    const preco    = item.preco || 0;
    const pid      = item.id;
    const isLiked  = likedProducts.includes(pid);
    const realizaEntrega = !!(item.realiza_entrega ?? item.realizaEntrega ?? item.realizaentrega ?? true);
    const cidade   = item.cidade || 'Não informada';
    const imgs = safeParseImages(item.img);
    const thumb = (imgs.length > 0 ? imgs[0] : null) || 'https://placehold.co/400';

    const precoFormatado = preco === 0
        ? '<span class="text-success fw-bold">GRÁTIS</span>'
        : `R$ ${Math.floor(preco).toLocaleString('pt-BR')}<small style="font-size:0.6em">,${((preco % 1).toFixed(2)).slice(1)}</small>`;

    const temOferta   = !!(item.preco_original && parseFloat(item.preco_original) > parseFloat(preco));
    const descontoPct = temOferta ? Math.round(100 - (preco / parseFloat(item.preco_original)) * 100) : 0;

    const condMatch = (item.descricao || '').match(REGEX_CONDICAO);

    return `
        <div class="card product-card-ml" onclick="window.showDetail('${pid}')">
            ${temOferta ? `<div class="offer-badge-ml">${descontoPct}% OFF</div>` : ''}
            <div class="overlay">
                <button class="btn btn-action" onclick="event.stopPropagation();window.toggleLike('${pid}')" title="Curtir">
                    <i class="bi ${isLiked ? 'bi-heart-fill text-danger' : 'bi-heart'}"></i>
                </button>
                <button class="btn btn-action" onclick="event.stopPropagation();window.shareProduct('${pid}')" title="Compartilhar">
                    <i class="bi bi-share"></i>
                </button>
            </div>
            <div class="product-card-img-container">
                ${thumb
                    ? `<img src="${thumb}" alt="${item.titulo}" loading="lazy" referrerpolicy="no-referrer"
                           onerror="this.onerror=null;this.parentElement.innerHTML='<i class=\\'bi bi-box-seam text-secondary\\' style=\\'font-size:2.5rem;\\'></i>'">`
                    : `<i class="bi bi-box-seam text-secondary" style="font-size:2.5rem;"></i>`
                }
            </div>
            <div class="card-body product-card-body">
                <h6 class="product-title-grid">${item.titulo}</h6>
                ${condMatch ? `<span class="ml-cond-badge ml-cond-${condToClass(condMatch[1])}">${condMatch[1]}</span>` : ''}
                <div class="current-price">
                    ${temOferta
                        ? `<div class="price-old-line text-muted text-decoration-line-through" style="font-size:0.75rem;font-weight:normal;">
                               R$ ${parseFloat(item.preco_original).toLocaleString('pt-BR', {minimumFractionDigits:2})}
                           </div>`
                        : ''
                    }
                    <div class="price-main-line">
                        <span class="price-main-text">${precoFormatado}</span>
                    </div>
                </div>
                <div class="${realizaEntrega ? 'text-success' : 'text-muted'} delivery-line fw-bold mt-2">
                    <i class="bi ${realizaEntrega ? 'bi-truck' : 'bi-geo-alt'}"></i>
                    ${realizaEntrega ? 'Entrega disponível' : 'Retirada no local'}
                </div>
                <div class="text-muted city-line mt-1">
                    <i class="bi bi-geo-alt"></i> ${cidade}
                </div>
                <div class="product-card-sold mt-1">
                    ${item.vendas && parseInt(item.vendas) > 0
                        ? `<i class="bi bi-bag-check-fill me-1"></i>${parseInt(item.vendas)} vendido${parseInt(item.vendas) > 1 ? 's' : ''}`
                        : `<span class="text-muted">Novo anúncio</span>`}
                </div>
                <div class="d-flex justify-content-between align-items-center mt-auto pt-2">
                    <small class="text-muted text-truncate" style="max-width:60%">${item.loja || 'Vendedor'}</small>
                    <span class="badge bg-light text-dark border" style="font-size:0.58rem;">${(item.categoria || 'Geral').split(' > ').pop()}</span>
                </div>
            </div>
        </div>`;
}

function renderGrid(products) {
    const grid = document.getElementById('productsGrid');
    grid.classList.remove('order-view-active');
    grid.style.display = 'grid';

    if (!products?.length) {
        grid.innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="bi bi-search fs-1 text-muted d-block mb-3"></i>
                <h5>Nenhum produto encontrado</h5>
            </div>`;
        return;
    }
    grid.innerHTML = products.map(renderCard).join('');
}

function updateStoreFilterUI() {
    const container = document.getElementById('storeFilters');
    if (!container) return;
    const stores = [...new Set(allProductsCache.map(p => p.loja).filter(Boolean))];
    container.innerHTML = stores.map(store => `
        <div class="form-check mb-2">
            <input class="form-check-input store-checkbox" type="checkbox" value="${store}" checked onchange="applyFilters()">
            <label class="form-check-label small">${store}</label>
        </div>`).join('');
}

/** Preenche o filtro de categorias com base nas categorias realmente presentes nos anúncios */
function updateCategoryFilterUI() {
    const select = document.getElementById('filterCategory');
    if (!select) return;
    const current = select.value;

    // O primeiro nível da categoria ("Eletrônicos") é igual pra todo produto, então não serve
    // pra filtrar nada — por isso o menu ficava praticamente vazio. Usamos o segundo nível
    // (Games, Informática, Celulares e Tablets, etc.), guardando como valor o caminho completo
    // até ali (ex: "Eletrônicos > Games") pra continuar batendo com o startsWith() do applyFilters.
    const catMap = new Map(); // rótulo exibido -> valor salvo na option
    allProductsCache.forEach(p => {
        const parts = (p.categoria || '').split(' > ').map(s => s.trim()).filter(Boolean);
        if (!parts.length) return;
        const label = parts.length > 1 ? parts[1] : parts[0];
        const value = parts.length > 1 ? `${parts[0]} > ${parts[1]}` : parts[0];
        if (label) catMap.set(label, value);
    });

    const sortedLabels = [...catMap.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    select.innerHTML = '<option value="">Todas as categorias</option>' +
        sortedLabels.map(label => `<option value="${catMap.get(label)}">${label}</option>`).join('');

    // Preserva a seleção anterior, se ela ainda existir na lista atualizada
    if ([...catMap.values()].includes(current)) select.value = current;
}

/**
 * Mostra o cartão de loja encontrada na busca: banner, foto e dados do
 * vendedor. Ao clicar leva para os anúncios dele (showSellerProfile).
 */
async function renderStorefrontBanner(stores) {
    const container = document.getElementById('storefrontBanner');
    if (!container) return;
    if (!stores || stores.length === 0) { container.innerHTML = ''; return; }

    const storeIds = stores.map(s => s.vendedor_id).join(',');
    let usersMap = {};
    try {
        const usersData = await supabaseFetch(`users?select=id,avatar,vendedor_rating,rating_count&id=in.(${storeIds})`);
        if (usersData) {
            usersData.forEach(u => {
                const { avatar, banner } = splitAvatarField(u.avatar);
                usersMap[u.id] = { avatar, banner, rating: parseFloat(u.vendedor_rating) || 0, ratingCount: parseInt(u.rating_count) || 0 };
            });
        }
    } catch(e) {}

    container.innerHTML = stores.map(s => {
        const user   = usersMap[s.vendedor_id] || {};
        const banner = user.banner || '';
        const avatar = user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((s.loja||'L').slice(0,2))}&background=2dcc71&color=fff&size=80`;
        const rating = user.rating || 0;
        const ratingCount = user.ratingCount || 0;
        return `
        <div class="storefront-banner" onclick="window.showSellerProfile('${s.vendedor_id}', '${(s.loja||'').replace(/'/g,"\\'")}')">
            ${banner ? `<div class="storefront-banner-bg"><img src="${banner}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'"></div>` : ''}
            <div class="storefront-banner-content">
                <img src="${avatar}" class="storefront-banner-avatar" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=2dcc71&color=fff&size=80'">
                <div class="storefront-banner-info">
                    <strong class="storefront-banner-name">${s.loja}</strong>
                    <span class="storefront-banner-badge">${ratingCount > 0 ? renderRatingStars(rating) : 'Sem avaliações'}</span>
                </div>
                <div class="storefront-banner-actions">
                    <span class="storefront-banner-visit-btn">Visitar Loja <i class="bi bi-arrow-right"></i></span>
                </div>
            </div>
        </div>`;
    }).join('');
}

/**
 * Página (tela cheia, mesmo padrão da página de detalhes do produto) com o
 * perfil público de um vendedor: nome, reputação e todos os anúncios ativos
 * dele — como a página de loja do Mercado Livre/Shopee.
 */
window.showSellerProfile = async function(sellerId, sellerNameFallback = '') {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    if (!grid.classList.contains('product-detail-active') && !grid.classList.contains('profile-page-active') && !grid.classList.contains('seller-profile-active')) {
        window._preDetailState = {
            html: grid.innerHTML,
            gridClass: grid.className,
            gridDisplay: grid.style.display,
            title: document.getElementById('gridTitle')?.textContent || '',
            heroHidden: document.getElementById('heroSection')?.classList.contains('d-none') ?? true
        };
    }

    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    const gridTitleEl = document.getElementById('gridTitle');
    if (gridTitleEl) gridTitleEl.textContent = '';
    document.getElementById('storefrontBanner')?.replaceChildren();

    grid.className = 'seller-profile-active';
    grid.style.display = 'block';
    grid.innerHTML = '<div class="text-center py-5"><div class="spinner-border" style="color:var(--market-color);"></div><p class="mt-2">Carregando loja...</p></div>';

    try {
        const [sellerData, products, salesData] = await Promise.all([
            supabaseFetch(`users?select=nome,avatar,cidade,estado,vendedor_rating,rating_count,created_at&id=eq.${sellerId}&limit=1`),
            supabaseFetch(`products?select=*&vendedor_id=eq.${sellerId}&order=created_at.desc`),
            supabaseFetch(`orders?select=id&seller_id=eq.${sellerId}&status=eq.finished`)
        ]);
        const seller = sellerData?.[0] || {};
        const nome = seller.nome || sellerNameFallback || 'Loja';
        const ratingAvg   = parseFloat(seller.vendedor_rating) || 0;
        const ratingCount = parseInt(seller.rating_count) || 0;
        const localizacao = [seller.cidade, seller.estado].filter(Boolean).join(' - ');
        const membroDesde = seller.created_at ? new Date(seller.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';
        const totalVendas = salesData?.length || 0;
        const { avatar: sellerAvatar, banner: sellerBanner } = splitAvatarField(seller.avatar);

        grid.innerHTML = `
            <div class="detail-page">
                <button type="button" class="detail-back-btn" onclick="window.closeProductDetail()">
                    <i class="bi bi-arrow-left"></i> Voltar
                </button>

                <div class="ml-store-card">
                    <div class="ml-store-banner"${sellerBanner ? ` style="background-image:url('${sellerBanner}');"` : ''}>
                        <div class="ml-store-banner-overlay">
                            <div class="ml-store-header">
                                <div class="ml-store-brand">
                                    <div class="ml-store-avatar-wrap">
                                        ${sellerAvatar
                                            ? `<img src="${sellerAvatar}" class="ml-store-avatar" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=2dcc71&color=fff&size=80'">`
                                            : `<div class="ml-store-avatar-placeholder"><i class="bi bi-shop"></i></div>`
                                        }
                                    </div>
                                        <div class="ml-store-brand-info">
                                            <h1 class="ml-store-name">${nome}</h1>
                                        <div class="ml-store-badge">
                                            ${ratingCount > 0
                                                ? `${renderRatingStars(ratingAvg)} <span style="font-size:0.7rem;opacity:0.7;margin-left:4px;">${ratingAvg.toFixed(1)} (${ratingCount})</span>`
                                                : '<span style="font-size:0.7rem;opacity:0.7;">Sem avaliações</span>'}
                                        </div>
                                        <div class="ml-store-meta">
                                            <span><i class="bi bi-geo-alt"></i> ${localizacao || 'Brasil'}</span>
                                            <span><i class="bi bi-calendar3"></i> ${membroDesde ? `Desde ${membroDesde}` : ''}</span>
                                            <span><i class="bi bi-bag-check"></i> ${totalVendas} venda${totalVendas === 1 ? '' : 's'}</span>
                                        </div>
                                    </div>
                                </div>
                                <div class="ml-store-actions">
                                    <button class="ml-store-btn ml-store-btn-share" onclick="window.shareSeller('${sellerId}', '${(nome || '').replace(/'/g, "\\'")}')" title="Compartilhar loja"><i class="bi bi-share me-1"></i></button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="ml-store-nav">
                        <span class="ml-store-nav-item-text">${products.length} anúncio${products.length === 1 ? '' : 's'}</span>
                    </div>
                </div>

                <h6 class="fw-bold mt-4 mb-3">Todos os anúncios</h6>
                <div class="products-grid-uniform" id="sellerProfileProductsGrid"></div>
            </div>`;

        const sellerGrid = document.getElementById('sellerProfileProductsGrid');
        if (products.length === 0) {
            sellerGrid.innerHTML = '<p class="text-muted text-center py-4 w-100">Esta loja ainda não tem anúncios ativos.</p>';
        } else {
            sellerGrid.innerHTML = products.map(p => renderCard(p)).join('');
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
        console.error(e);
        grid.innerHTML = '<div class="alert alert-danger m-3">Erro ao carregar o perfil da loja.</div>';
    }
};

const CATEGORIAS_BASE = [
    { label: 'Games', options: [
        'Eletrônicos > Games > Consoles > PlayStation',
        'Eletrônicos > Games > Consoles > Xbox',
        'Eletrônicos > Games > Consoles > Nintendo',
        'Eletrônicos > Games > Consoles > Portáteis',
        'Eletrônicos > Games > Jogos > Mídia Física',
        'Eletrônicos > Games > Jogos > Digital',
        'Eletrônicos > Games > Acessórios > Controles',
        'Eletrônicos > Games > Acessórios > Headsets',
        'Eletrônicos > Games > Acessórios > Volantes',
        'Eletrônicos > Games > Acessórios > Suportes e Bases',
        'Eletrônicos > Games > PC Gamer > PCs Montados',
        'Eletrônicos > Games > PC Gamer > Periféricos Gamer',
        'Eletrônicos > Games > Realidade Virtual (VR)'
    ]},
    { label: 'Informática', options: [
        'Eletrônicos > Informática > Notebooks > Básico',
        'Eletrônicos > Informática > Notebooks > Gamer',
        'Eletrônicos > Informática > Notebooks > Profissional',
        'Eletrônicos > Informática > Computadores > Desktop',
        'Eletrônicos > Informática > Computadores > All-in-One',
        'Eletrônicos > Informática > Computadores > Mini PC',
        'Eletrônicos > Informática > Componentes > Placa de Vídeo',
        'Eletrônicos > Informática > Componentes > Processador',
        'Eletrônicos > Informática > Componentes > Memória RAM',
        'Eletrônicos > Informática > Componentes > SSD / HD',
        'Eletrônicos > Informática > Componentes > Placa-mãe',
        'Eletrônicos > Informática > Componentes > Fonte',
        'Eletrônicos > Informática > Periféricos > Teclado',
        'Eletrônicos > Informática > Periféricos > Mouse',
        'Eletrônicos > Informática > Periféricos > Monitor',
        'Eletrônicos > Informática > Periféricos > Webcam',
        'Eletrônicos > Informática > Periféricos > Headset',
        'Eletrônicos > Informática > Impressão > Impressoras',
        'Eletrônicos > Informática > Impressão > Multifuncionais',
        'Eletrônicos > Informática > Impressão > Suprimentos'
    ]},
    { label: 'Celulares e Tablets', options: [
        'Eletrônicos > Celulares e Tablets > Smartphones',
        'Eletrônicos > Celulares e Tablets > Tablets',
        'Eletrônicos > Celulares e Tablets > Smartwatches',
        'Eletrônicos > Celulares e Tablets > Acessórios > Capas',
        'Eletrônicos > Celulares e Tablets > Acessórios > Películas',
        'Eletrônicos > Celulares e Tablets > Acessórios > Carregadores',
        'Eletrônicos > Celulares e Tablets > Acessórios > Cabos',
        'Eletrônicos > Celulares e Tablets > Fones de Ouvido'
    ]},
    { label: 'TVs e Áudio', options: [
        'Eletrônicos > TVs e Áudio > TVs > LED',
        'Eletrônicos > TVs e Áudio > TVs > OLED',
        'Eletrônicos > TVs e Áudio > TVs > QLED',
        'Eletrônicos > TVs e Áudio > Áudio > Soundbar',
        'Eletrônicos > TVs e Áudio > Áudio > Caixa de Som',
        'Eletrônicos > TVs e Áudio > Áudio > Home Theater',
        'Eletrônicos > TVs e Áudio > Projetores'
    ]},
    { label: 'Eletrodomésticos', options: [
        'Eletrônicos > Eletrodomésticos > Geladeiras',
        'Eletrônicos > Eletrodomésticos > Fogões',
        'Eletrônicos > Eletrodomésticos > Cooktops',
        'Eletrônicos > Eletrodomésticos > Micro-ondas',
        'Eletrônicos > Eletrodomésticos > Lava e Seca',
        'Eletrônicos > Eletrodomésticos > Lava-louças'
    ]},
    { label: 'Eletroportáteis', options: [
        'Eletrônicos > Eletroportáteis > Cozinha > Air Fryer',
        'Eletrônicos > Eletroportáteis > Cozinha > Liquidificador',
        'Eletrônicos > Eletroportáteis > Cozinha > Cafeteira',
        'Eletrônicos > Eletroportáteis > Cozinha > Batedeira',
        'Eletrônicos > Eletroportáteis > Limpeza > Aspirador',
        'Eletrônicos > Eletroportáteis > Limpeza > Robô Aspirador',
        'Eletrônicos > Eletroportáteis > Cuidados Pessoais > Secador',
        'Eletrônicos > Eletroportáteis > Cuidados Pessoais > Chapinha',
        'Eletrônicos > Eletroportáteis > Cuidados Pessoais > Barbeador'
    ]},
    { label: 'Climatização', options: [
        'Eletrônicos > Climatização > Ar-condicionado',
        'Eletrônicos > Climatização > Ventiladores',
        'Eletrônicos > Climatização > Aquecedores',
        'Eletrônicos > Climatização > Umidificadores'
    ]},
    { label: 'Segurança e Automação', options: [
        'Eletrônicos > Segurança e Automação > Câmeras',
        'Eletrônicos > Segurança e Automação > Alarmes',
        'Eletrônicos > Segurança e Automação > Sensores',
        'Eletrônicos > Segurança e Automação > Fechaduras Digitais',
        'Eletrônicos > Segurança e Automação > Casa Inteligente > Alexa / Google Home',
        'Eletrônicos > Segurança e Automação > Casa Inteligente > Lâmpadas Smart',
        'Eletrônicos > Segurança e Automação > Casa Inteligente > Tomadas Inteligentes'
    ]},
    { label: 'Automotivo', options: [
        'Eletrônicos > Automotivo > Som Automotivo',
        'Eletrônicos > Automotivo > Multimídia',
        'Eletrônicos > Automotivo > Câmeras Veiculares',
        'Eletrônicos > Automotivo > Carregadores'
    ]},
    { label: 'Câmeras e Drones', options: [
        'Eletrônicos > Câmeras e Drones > Câmeras DSLR',
        'Eletrônicos > Câmeras e Drones > Mirrorless',
        'Eletrônicos > Câmeras e Drones > Drones',
        'Eletrônicos > Câmeras e Drones > Acessórios'
    ]},
    { label: 'Redes e Conectividade', options: [
        'Eletrônicos > Redes e Conectividade > Roteadores',
        'Eletrônicos > Redes e Conectividade > Modems',
        'Eletrônicos > Redes e Conectividade > Repetidores',
        'Eletrônicos > Redes e Conectividade > Switches'
    ]},
    { label: 'Armazenamento', options: [
        'Eletrônicos > Armazenamento > HD Externo',
        'Eletrônicos > Armazenamento > SSD',
        'Eletrônicos > Armazenamento > Pen Drive',
        'Eletrônicos > Armazenamento > Cartão de Memória'
    ]},
    { label: 'Cabos e Energia', options: [
        'Eletrônicos > Cabos e Energia > Cabos (HDMI, USB)',
        'Eletrônicos > Cabos e Energia > Adaptadores',
        'Eletrônicos > Cabos e Energia > Extensões',
        'Eletrônicos > Cabos e Energia > Filtros de Linha'
    ]}
];

/** Retorna todas as categorias (base + aprovadas) */
function getCategorias() {
    const aprovadas = JSON.parse(localStorage.getItem('emCategoriasAprovadas') || '[]');
    const todas = [];
    CATEGORIAS_BASE.forEach(g => {
        todas.push(...g.options);
    });
    aprovadas.forEach(c => {
        if (!todas.includes(c)) todas.push(c);
    });
    return todas;
}

/** Gera HTML do select de categorias */
function renderCategoriaOptions(selected) {
    const todas = getCategorias();
    const grupos = {};
    CATEGORIAS_BASE.forEach(g => { grupos[g.label] = [...g.options]; });
    // Adiciona categorias aprovadas que não estão em nenhum grupo
    const aprovadas = JSON.parse(localStorage.getItem('emCategoriasAprovadas') || '[]');
    if (aprovadas.length) {
        const extras = aprovadas.filter(c => !todas.some(t => t === c));
        if (extras.length) grupos['Categorias Customizadas'] = extras;
    }
    let html = '<option value="" selected disabled>Selecione a categoria</option>';
    Object.entries(grupos).forEach(([label, opts]) => {
        html += `<optgroup label="${label}">`;
        opts.forEach(o => {
            html += `<option value="${o}"${o === selected ? ' selected' : ''}>${o.split(' > ').pop()}</option>`;
        });
        html += '</optgroup>';
    });
    return html;
}

// Handler do novo formulário fullscreen de criar anúncio
async function handleCreateAdSubmit(e) {
    e.preventDefault();
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    const orig = btn.textContent;

    const titulo = document.getElementById('caTitle').value.trim();
    if (!titulo) { showToast('O título do anúncio é obrigatório.', 'warning'); return; }

    const condicao = document.getElementById('caCondition').value;
    if (!condicao) { showToast('Selecione a condição do produto.', 'warning'); return; }

    const descricao = document.getElementById('caDescription').value.trim();
    if (!descricao) { showToast('A descrição do produto é obrigatória.', 'warning'); return; }

    const precoInput = document.getElementById('caPrice').value;
    const preco = parseFloat(precoInput);
    const PRECO_MAXIMO = 10000000;
    if (isNaN(preco) || preco < 0) { showToast('Preço inválido!', 'warning'); return; }
    if (preco > PRECO_MAXIMO) { showToast(`Preço máximo é R$ ${PRECO_MAXIMO.toLocaleString('pt-BR')}.`, 'warning'); return; }

    const quantidadeInput = document.getElementById('caQuantity').value;
    const quantidade = parseInt(quantidadeInput);
    if (isNaN(quantidade) || quantidade < 1) { showToast('Quantidade inválida!', 'warning'); return; }

    const categoria = document.getElementById('caCategory').value;
    if (!categoria) { showToast('Selecione uma categoria.', 'warning'); return; }

    try {
        btn.disabled = true;
        btn.textContent = 'Publicando...';

        const now = new Date().toISOString();
        const form = document.getElementById('createAdForm');
        const editingId = form.dataset.editingId;
        const isAdminEdit = form.dataset.adminEdit === 'true';
        const produtoOriginal = editingId
            ? (allProductsCache.find(p => p.id === editingId) || window._adminProductsCache?.find(p => p.id === editingId))
            : null;

        let imgsArray = [];
        for (let n = 0; n <= 3; n++) {
            const lInput = document.getElementById(`caFoto${n}`);
            if (lInput && lInput.value.trim()) {
                imgsArray.push(normalizeImageUrl(lInput.value.trim()));
            }
        }
        if (imgsArray.length === 0 && editingId) {
            imgsArray = safeParseImages(produtoOriginal?.img);
        }

        let precoOriginal = null;
        if (editingId && produtoOriginal) {
            const precoAnterior = parseFloat(produtoOriginal.preco);
            if (precoAnterior && preco < precoAnterior) {
                precoOriginal = precoAnterior;
            }
        }

        const productData = {
            titulo,
            descricao: condicao ? `[${condicao}] ${descricao}` : descricao,
            preco,
            preco_original: precoOriginal,
            quantidade, categoria,
            img: JSON.stringify(imgsArray),
            loja: isAdminEdit ? (produtoOriginal?.loja || user.nome) : user.nome,
            vendedor_id: isAdminEdit ? (produtoOriginal?.vendedor_id || user.id) : user.id,
            cidade: isAdminEdit ? (produtoOriginal?.cidade || '') : (user.cidade || ''),
            realizaentrega: document.getElementById('caDelivery')?.checked ?? true,
            updated_at: now
        };

        if (editingId) {
            await supabaseFetch(`products?id=eq.${editingId}`, { method: 'PATCH', body: JSON.stringify(productData) });
        } else {
            productData.id = `prod_${Date.now()}`;
            productData.created_at = now;
            await supabaseFetch('products', { method: 'POST', body: JSON.stringify(productData) });
        }

        window.closeProductDetail();
        if (isAdminEdit) {
            delete form.dataset.adminEdit;
            createPersistentNotification('Anúncio atualizado pelo administrador.', 'success');
            window.renderAdminPanel();
        } else {
            await loadPage(undefined, true);
            createPersistentNotification(editingId ? 'Seu anúncio foi atualizado.' : 'Novo anúncio publicado com sucesso!', 'success');
        }
    } catch (err) {
        console.error(err);
        const errorMsg = err.message || (typeof err === 'string' ? err : 'Verifique os campos e a conexão.');
        showToast(`Erro ao publicar: ${errorMsg}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

window.showCreateAdPage = function(editingId, isAdminEdit) {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    if (!grid.classList.contains('product-detail-active') && !grid.classList.contains('profile-page-active') && !grid.classList.contains('seller-profile-active') && !grid.classList.contains('create-ad-active') && !grid.classList.contains('offer-page-active')) {
        window._preDetailState = {
            html: grid.innerHTML,
            gridClass: grid.className,
            gridDisplay: grid.style.display,
            title: document.getElementById('gridTitle')?.textContent || '',
            heroHidden: document.getElementById('heroSection')?.classList.contains('d-none') ?? true
        };
    }

    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    const gridTitleEl = document.getElementById('gridTitle');
    if (gridTitleEl) gridTitleEl.textContent = '';
    document.getElementById('storefrontBanner')?.replaceChildren();

    grid.className = 'create-ad-active';
    grid.style.display = 'block';

    const user = getSavedUser();
    const isEditing = !!editingId;
    const editLabel = isEditing ? 'Editar Anúncio' : 'Publicar Anúncio';

    grid.innerHTML = `
    <div class="detail-page">
        <button type="button" class="detail-back-btn" onclick="window.closeProductDetail()">
            <i class="bi bi-arrow-left"></i> Voltar
        </button>

        <div class="create-ad-wrap">
            <div class="create-ad-header">
                <div>
                    <h4>${isEditing ? 'Editar Anúncio' : 'Criar Anúncio'}</h4>
                    <p class="text-muted small mb-0">Preencha os dados do produto para publicar na loja</p>
                </div>
            </div>

            <form id="createAdForm" class="create-ad-form">
                <!-- INFORMAÇÕES -->
                <div class="create-ad-section">
                    <div class="create-ad-section-title">
                        <i class="bi bi-info-circle-fill"></i>
                        <span>Informações do Produto</span>
                    </div>
                    <div class="create-ad-section-body">
                        <div class="mb-3">
                            <label class="create-ad-label">Título do anúncio <span class="text-danger">*</span></label>
                            <input type="text" class="create-ad-input" id="caTitle" placeholder="Ex: iPhone 14 128GB Novo Lacrado" required>
                        </div>
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <label class="create-ad-label">Condição <span class="text-danger">*</span></label>
                                <select class="create-ad-input" id="caCondition" required>
                                    ${renderCondicoesOptions()}
                                </select>
                            </div>
                        </div>
                        <div class="mb-3">
                            <label class="create-ad-label">Descrição <span class="text-danger">*</span></label>
                            <textarea class="create-ad-input create-ad-textarea" id="caDescription" placeholder="Descreva o produto com detalhes" rows="4" required></textarea>
                        </div>
                    </div>
                </div>

                <!-- PREÇO -->
                <div class="create-ad-section">
                    <div class="create-ad-section-title">
                        <i class="bi bi-cash-coin"></i>
                        <span>Preço e Quantidade</span>
                    </div>
                    <div class="create-ad-section-body">
                        <div class="create-ad-price-row">
                            <div class="mb-3">
                                <label class="create-ad-label">Preço (R$) <span class="text-danger">*</span></label>
                                <input type="number" class="create-ad-input" id="caPrice" placeholder="0,00" min="0" step="0.01" required>
                            </div>
                            <div class="mb-3">
                                <label class="create-ad-label">Quantidade <span class="text-danger">*</span></label>
                                <input type="number" class="create-ad-input" id="caQuantity" placeholder="1" min="1" required>
                            </div>
                            <div class="d-flex align-items-center" style="padding-bottom:1px;">
                                <div class="form-check form-switch mb-0">
                                    <input class="form-check-input" type="checkbox" id="caDelivery" checked onchange="document.getElementById('caDeliveryLabel').textContent=this.checked?'Faço entrega':'Não realizo entregas'">
                                    <label class="form-check-label small" for="caDelivery" id="caDeliveryLabel">Faço entrega</label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- CATEGORIA -->
                <div class="create-ad-section">
                    <div class="create-ad-section-title">
                        <i class="bi bi-tags-fill"></i>
                        <span>Categoria</span>
                    </div>
                    <div class="create-ad-section-body">
                        <div class="mb-3">
                            <label class="create-ad-label">Categoria <span class="text-danger">*</span></label>
                            <div class="ca-cat-search-wrap">
                                <input type="text" class="create-ad-input" id="caCatSearch" placeholder="Digite para buscar uma categoria..." autocomplete="off">
                                <i class="bi bi-search ca-cat-search-icon"></i>
                            </div>
                            <div class="ca-cat-list-wrap">
                                <select class="create-ad-input" id="caCategory" size="6" required>
                                    ${renderCategoriaOptions()}
                                </select>
                            </div>
                            <div id="caSuggestCatWrap" class="ca-suggest-cat-wrap d-none">
                                <hr class="my-2">
                                <p class="small text-muted mb-1">Não encontrou a categoria ideal?</p>
                                <div class="input-group input-group-sm">
                                    <input type="text" class="form-control" id="caSuggestCatInput" placeholder="Digite o nome da nova categoria">
                                    <button type="button" class="btn btn-sm btn-ml-secondary" onclick="window.suggestCategory()">Sugerir</button>
                                </div>
                                <small class="text-muted">Sua sugestão será analisada pelo administrador.</small>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- FOTOS -->
                <div class="create-ad-section">
                    <div class="create-ad-section-title">
                        <i class="bi bi-images"></i>
                        <span>Fotos do Produto</span>
                    </div>
                        <div class="create-ad-section-body">
                            <div class="ca-fotos-info mb-2">
                                <small class="text-muted">Envie imagens do seu computador (automático) ou cole um link. A primeira será a foto principal.</small>
                            </div>
                            <div id="caFotosContainer">
                                <div class="ca-foto-row profile-link-inline mb-2" data-idx="0">
                                    <button type="button" class="profile-link-icon profile-link-icon-ghost" onclick="abrirUploadExterno()" title="Subir no Imgur">
                                        <i class="bi bi-box-arrow-up-right"></i>
                                    </button>
                                    <label class="profile-link-icon profile-link-icon-ghost" style="cursor:pointer;" title="Escolher do PC">
                                        <i class="bi bi-cloud-upload"></i>
                                        <input type="file" accept="image/*" hidden onchange="window.handleFotoFiles(this)">
                                    </label>
                                    <input type="url" class="create-ad-input ca-foto-input" id="caFoto0" placeholder="Link da imagem principal">
                                    <div class="ca-foto-preview" id="caFotoPreview0"></div>
                                </div>
                                <div class="ca-foto-row profile-link-inline mb-2" data-idx="1">
                                    <button type="button" class="profile-link-icon profile-link-icon-ghost" onclick="abrirUploadExterno()" title="Subir no Imgur">
                                        <i class="bi bi-box-arrow-up-right"></i>
                                    </button>
                                    <label class="profile-link-icon profile-link-icon-ghost" style="cursor:pointer;" title="Escolher do PC">
                                        <i class="bi bi-cloud-upload"></i>
                                        <input type="file" accept="image/*" hidden onchange="window.handleFotoFiles(this)">
                                    </label>
                                    <input type="url" class="create-ad-input ca-foto-input" id="caFoto1" placeholder="Link da imagem 2">
                                    <div class="ca-foto-preview" id="caFotoPreview1"></div>
                                </div>
                                <div class="ca-foto-row profile-link-inline mb-2" data-idx="2">
                                    <button type="button" class="profile-link-icon profile-link-icon-ghost" onclick="abrirUploadExterno()" title="Subir no Imgur">
                                        <i class="bi bi-box-arrow-up-right"></i>
                                    </button>
                                    <label class="profile-link-icon profile-link-icon-ghost" style="cursor:pointer;" title="Escolher do PC">
                                        <i class="bi bi-cloud-upload"></i>
                                        <input type="file" accept="image/*" hidden onchange="window.handleFotoFiles(this)">
                                    </label>
                                    <input type="url" class="create-ad-input ca-foto-input" id="caFoto2" placeholder="Link da imagem 3">
                                    <div class="ca-foto-preview" id="caFotoPreview2"></div>
                                </div>
                                <div class="ca-foto-row profile-link-inline" data-idx="3">
                                    <button type="button" class="profile-link-icon profile-link-icon-ghost" onclick="abrirUploadExterno()" title="Subir no Imgur">
                                        <i class="bi bi-box-arrow-up-right"></i>
                                    </button>
                                    <label class="profile-link-icon profile-link-icon-ghost" style="cursor:pointer;" title="Escolher do PC">
                                        <i class="bi bi-cloud-upload"></i>
                                        <input type="file" accept="image/*" hidden onchange="window.handleFotoFiles(this)">
                                    </label>
                                    <input type="url" class="create-ad-input ca-foto-input" id="caFoto3" placeholder="Link da imagem 4">
                                    <div class="ca-foto-preview" id="caFotoPreview3"></div>
                                </div>
                            </div>
                        </div>
                </div>

                <!-- BOTÃO FIXO -->
                <div class="create-ad-footer">
                    <button type="button" class="ml-btn ml-btn-outline" onclick="window.closeProductDetail()">
                        <i class="bi bi-x-lg me-2"></i>Cancelar
                    </button>
                    <button type="submit" class="ml-btn ml-btn-primary">
                        <i class="bi bi-check-lg me-2"></i>${editLabel}
                    </button>
                </div>
            </form>
        </div>
    </div>`;

    // Inputs de foto com preview automático
    document.querySelectorAll('.ca-foto-input').forEach(input => {
        input.addEventListener('input', function() {
            const idx = this.closest('.ca-foto-row').dataset.idx;
            const preview = document.getElementById(`caFotoPreview${idx}`);
            const url = this.value.trim();
            if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                preview.innerHTML = `<img src="${normalizeImageUrl(url)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.closest('.ca-foto-preview').innerHTML='<i class=\\'bi bi-image text-muted\\' style=\\'font-size:1.5rem;\\'></i>'">`;
            } else {
                preview.innerHTML = '';
            }
        });
    });

    // Busca de categorias
    const catSearch = document.getElementById('caCatSearch');
    const catSelect = document.getElementById('caCategory');
    if (catSearch && catSelect) {
        catSearch.addEventListener('input', function() {
            const term = this.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            Array.from(catSelect.options).forEach(opt => {
                if (!opt.value) return;
                const text = opt.text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const val = opt.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const match = text.includes(term) || val.includes(term);
                opt.style.display = term ? (match ? '' : 'none') : '';
            });
            // Mostra/esconde o link "sugerir categoria"
            const suggestWrap = document.getElementById('caSuggestCatWrap');
            const visibleCount = Array.from(catSelect.options).filter(o => o.style.display !== 'none' && o.value).length;
            suggestWrap.classList.toggle('d-none', visibleCount > 0 || !term);
        });
    }

    // Se for edição, carrega os dados
    if (isEditing) {
        const item = (allProductsCache.find(p => p.id === editingId) || window._adminProductsCache?.find(p => p.id === editingId));
        if (item) {
            document.getElementById('caTitle').value = item.titulo || '';
            // Extrai condição do início da descrição: "[Novo] descricao..."
            const descMatch = (item.descricao || '').match(REGEX_CONDICAO);
            // Produtos antigos (criados antes desse campo existir) não têm a condição
            // salva na descrição. Sem um valor padrão aqui, o <select> ficava vazio e o
            // atributo "required" bloqueava o envio do formulário silenciosamente,
            // impedindo a edição. Usamos "Novo" como padrão, e o vendedor pode ajustar.
            document.getElementById('caCondition').value = descMatch ? descMatch[1] : 'Novo';
            document.getElementById('caDescription').value = descMatch ? item.descricao.slice(descMatch[0].length) : (item.descricao || '');
            document.getElementById('caPrice').value = item.preco || '';
            document.getElementById('caQuantity').value = item.quantidade || '';
            document.getElementById('caDelivery').checked = !!(item.realiza_entrega ?? item.realizaEntrega ?? item.realizaentrega ?? true);
            if (item.categoria) {
                const opt = catSelect.querySelector(`option[value="${item.categoria}"]`);
                if (opt) { opt.selected = true; opt.scrollIntoView?.(); }
            }
            const imgs = safeParseImages(item.img);
            imgs.forEach((url, i) => {
                const el = document.getElementById(`caFoto${i}`);
                if (el) {
                    el.value = url;
                    el.dispatchEvent(new Event('input'));
                }
            });
        }
        document.getElementById('createAdForm').dataset.editingId = editingId;
        if (isAdminEdit) {
            document.getElementById('createAdForm').dataset.adminEdit = 'true';
        }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Garante que o submit handler está atrelado ao formulário
    document.getElementById('createAdForm')?.addEventListener('submit', handleCreateAdSubmit);
};

/** Vendedor sugere uma nova categoria (vai para análise do admin) */
window.suggestCategory = function() {
    const input = document.getElementById('caSuggestCatInput');
    const nome = input?.value.trim();
    if (!nome) { showToast('Digite o nome da categoria.', 'warning'); return; }
    const pendentes = JSON.parse(localStorage.getItem('emCategoriasPendentes') || '[]');
    if (pendentes.some(p => p.nome.toLowerCase() === nome.toLowerCase())) {
        showToast('Essa categoria já foi sugerida.', 'info');
        input.value = '';
        return;
    }
    const todas = getCategorias();
    if (todas.some(c => c.toLowerCase() === nome.toLowerCase())) {
        showToast('Essa categoria já existe!', 'info');
        input.value = '';
        return;
    }
    pendentes.push({ nome, data: new Date().toISOString(), sugeridoPor: getSavedUser()?.nome || 'Anônimo' });
    localStorage.setItem('emCategoriasPendentes', JSON.stringify(pendentes));
    showToast('Categoria sugerida! O administrador irá analisar.', 'success');
    input.value = '';
};

function normalizeStr(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const ESTADOS_BR = [
    ['AC','Acre'], ['AL','Alagoas'], ['AP','Amapá'], ['AM','Amazonas'], ['BA','Bahia'],
    ['CE','Ceará'], ['DF','Distrito Federal'], ['ES','Espírito Santo'], ['GO','Goiás'],
    ['MA','Maranhão'], ['MT','Mato Grosso'], ['MS','Mato Grosso do Sul'], ['MG','Minas Gerais'],
    ['PA','Pará'], ['PB','Paraíba'], ['PR','Paraná'], ['PE','Pernambuco'], ['PI','Piauí'],
    ['RJ','Rio de Janeiro'], ['RN','Rio Grande do Norte'], ['RS','Rio Grande do Sul'],
    ['RO','Rondônia'], ['RR','Roraima'], ['SC','Santa Catarina'], ['SP','São Paulo'],
    ['SE','Sergipe'], ['TO','Tocantins']
];

let guestDetectedRegion = null; // { cidade, estado } detectado pelo IP do visitante

/**
 * Para quem não está logado, detecta a região aproximada (cidade/estado) a partir
 * do IP do dispositivo, e mostra isso no "Receber em:" do cabeçalho — útil pra
 * visitante já ver a própria região sem precisar criar conta.
 */
async function detectGuestRegion() {
    if (getSavedUser()) return; // Usuário logado já tem cidade/estado cadastrados, não precisa disso

    const label = document.getElementById('shippingLabel');
    try {
        const res  = await fetch('https://ipapi.co/json/');
        const data = await res.json();
        if (!data || data.error || !data.city) throw new Error('Sem dados de localização');

        guestDetectedRegion = { cidade: data.city, estado: data.region_code };
        if (label && !getSavedUser()) label.textContent = `${data.city} - ${data.region_code}`;
    } catch (e) {
        console.error('Não foi possível detectar a região pelo IP:', e);
        if (label && !getSavedUser()) label.textContent = 'Faça login';
    }
}

/** Clique em "Receber em:" no cabeçalho: visitante filtra pela região detectada, logado edita o endereço */
window.handleShippingInfoClick = function() {
    if (getSavedUser()) {
        window.showProfileEdit();
    } else {
        window.applyGuestRegionFilter();
    }
};

/** Aplica a região detectada pelo IP como filtro de localização e abre o painel de filtros */
window.applyGuestRegionFilter = async function() {
    const offcanvasEl = document.getElementById('filterOffcanvas');
    if (!offcanvasEl) return;

    if (guestDetectedRegion?.estado) {
        document.getElementById('filterEstado').value = guestDetectedRegion.estado;
        await window.onFilterEstadoChange(guestDetectedRegion.cidade);
    } else {
        showToast('Não foi possível detectar sua região automaticamente.', 'warning');
    }

    bootstrap.Offcanvas.getOrCreateInstance(offcanvasEl).show();
};

/**
 * Preenche o select de Estado (UF) do filtro de localização
 */
function populateFilterEstados() {
    const select = document.getElementById('filterEstado');
    if (!select) return;
    select.innerHTML = '<option value="">UF</option>' +
        ESTADOS_BR.map(([sigla, nome]) => `<option value="${sigla}">${sigla} - ${nome}</option>`).join('');
}

/**
 * Preenche qualquer <select> de Estado (UF) com a lista completa dos 27
 * estados + DF — usado no cadastro e na edição de perfil, que antes só
 * tinham uma lista parcial (poucos estados) copiada manualmente no HTML.
 */
function populateEstadoSelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const current = select.value;
    select.innerHTML = ESTADOS_BR.map(([sigla, nome]) => `<option value="${sigla}">${sigla} - ${nome}</option>`).join('');
    if (current) select.value = current;
}

/**
 * Ao escolher o Estado no filtro, busca a lista oficial de cidades daquele
 * estado (API do IBGE) e preenche o select de Cidade — assim o vendedor/cliente
 * nunca digita errado o nome da cidade, só escolhe de uma lista pronta.
 */
window.onFilterEstadoChange = async function(preSelectCity) {
    const ufSelect   = document.getElementById('filterEstado');
    const citySelect = document.getElementById('filterCidade');
    const uf = ufSelect?.value;

    if (!uf) {
        citySelect.innerHTML = '<option value="">Selecione o estado</option>';
        citySelect.disabled = true;
        applyFilters();
        return;
    }

    citySelect.disabled = true;
    citySelect.innerHTML = '<option value="">Carregando cidades...</option>';

    try {
        const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`);
        const municipios = await res.json();
        citySelect.innerHTML = '<option value="">Todas as cidades</option>' +
            municipios.map(m => `<option value="${m.nome}">${m.nome}</option>`).join('');
        citySelect.disabled = false;

        if (preSelectCity) {
            const match = municipios.find(m => normalizeStr(m.nome) === normalizeStr(preSelectCity));
            if (match) citySelect.value = match.nome;
        }
    } catch (e) {
        console.error('Erro ao buscar cidades do IBGE:', e);
        citySelect.innerHTML = '<option value="">Erro ao carregar — tente novamente</option>';
    }

    applyFilters();
};

function applyFilters() {
    const min      = parseFloat(document.getElementById('minPrice')?.value)  || 0;
    const max      = parseFloat(document.getElementById('maxPrice')?.value)  || Infinity;
    const sort     = document.getElementById('sortOrder')?.value;
    const stores   = Array.from(document.querySelectorAll('.store-checkbox:checked')).map(cb => cb.value);
    const cidade   = document.getElementById('filterCidade')?.value || '';
    const categoria = document.getElementById('filterCategory')?.value || '';
    const deliveryMode = document.getElementById('filterDelivery')?.value || 'all';

    let filtered = allProductsCache.filter(p =>
        p.preco >= min && p.preco <= max &&
        (!stores.length || stores.includes(p.loja)) &&
        (!cidade || normalizeStr(p.cidade) === normalizeStr(cidade)) &&
        (!categoria || (p.categoria || '').startsWith(categoria)) &&
        (deliveryMode === 'all' ||
            (deliveryMode === 'delivery' && !!(p.realizaentrega ?? p.realiza_entrega ?? p.realizaEntrega)) ||
            (deliveryMode === 'pickup' && !(p.realizaentrega ?? p.realiza_entrega ?? p.realizaEntrega)))
    );

    if (sort === 'priceAsc')  filtered.sort((a, b) => a.preco - b.preco);
    if (sort === 'priceDesc') filtered.sort((a, b) => b.preco - a.preco);
    // "Mais curtidos": ordena pela quantidade de curtidas do produto — diferente da
    // reputação do vendedor (que é uma métrica separada, ligada às avaliações).
    if (sort === 'likes')     filtered.sort((a, b) => (b.likes || 0) - (a.likes || 0));

    renderGrid(filtered);
}

function clearFilters() {
    ['minPrice', 'maxPrice'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const s = document.getElementById('sortOrder');
    if (s) s.value = 'default';
    const cat = document.getElementById('filterCategory');
    if (cat) cat.value = '';
    const uf = document.getElementById('filterEstado');
    if (uf) uf.value = '';
    const cidade = document.getElementById('filterCidade');
    if (cidade) { cidade.innerHTML = '<option value="">Selecione o estado</option>'; cidade.disabled = true; }
    const delivery = document.getElementById('filterDelivery');
    if (delivery) delivery.value = 'all';
    document.querySelectorAll('.store-checkbox').forEach(cb => cb.checked = true);
    renderGrid(allProductsCache);
}

// ============================================
// DETALHE DO PRODUTO
// ============================================

window.showDetail = async function(pid) {
    const item = allProductsCache.find(x => x.id == pid || x.id === pid);
    if (!item) return;

    window._detailQty = 1; // reseta o seletor de quantidade a cada novo produto aberto

    const user    = getSavedUser();
    const isOwner = user && (item.vendedor_id == user.id);
    // Admin olhando o anúncio de outra pessoa: não faz sentido oferecer "comprar"
    // pra quem administra a plataforma — no lugar disso, ação rápida de excluir.
    // Enquanto uma simulação de Cliente/Vendedor estiver ativa, o admin vê a
    // tela normal de compra, como parte da própria simulação.
    const isAdminViewing = user && getEffectiveUser()?.tipo === 'ADMIN' && !isOwner;

    // Histórico
    accessHistory = accessHistory.filter(id => id != pid);
    accessHistory.unshift(pid);
    if (accessHistory.length > 20) accessHistory.pop();
    localStorage.setItem('electroHistory', JSON.stringify(accessHistory));

    if (isOwner) {
        document.getElementById('prodTitle').value       = item.titulo;
        const prodDescMatch = (item.descricao || '').match(REGEX_CONDICAO);
        // Mesmo motivo do handleCreateAdSubmit: produto antigo sem condição salva
        // deixava o select vazio e o "required" bloqueava o salvamento sem aviso nenhum.
        document.getElementById('prodCondition').value = prodDescMatch ? prodDescMatch[1] : 'Novo';
        document.getElementById('prodDescription').value = prodDescMatch ? item.descricao.slice(prodDescMatch[0].length) : (item.descricao || '');
        document.getElementById('prodPrice').value       = item.preco;
        document.getElementById('prodQuantity').value    = item.quantidade;
        // O campo de "preço original" não é mais preenchido manualmente pelo vendedor:
        // a oferta é detectada automaticamente ao salvar, comparando com o preço anterior.
        document.getElementById('prodPrecoOriginal').value = '';
        document.getElementById('prodCategory').value    = item.categoria;
        document.getElementById('prodDelivery').checked  = !!(item.realiza_entrega ?? item.realizaEntrega ?? item.realizaentrega ?? true);
        document.getElementById('announceForm').dataset.editingId = item.id;

        // Limpa e popula os campos de link de imagem no formulário de edição
        for (let n = 1; n <= 3; n++) {
            const el = document.getElementById(`prodLink${n}`);
            if (el) el.value = '';
        }
        const imgs = safeParseImages(item.img);
        imgs.forEach((url, i) => {
            const el = document.getElementById(`prodLink${i+1}`);
            if (el) el.value = url;
        });

        const modalTitle = document.querySelector('#announceModal .modal-title');
        const submitBtn  = document.querySelector('#announceForm button[type="submit"]');
        if (modalTitle) modalTitle.textContent = 'Editar Anúncio';
        if (submitBtn)  submitBtn.textContent  = 'Salvar Alterações';
    }

    let sellerAddress = 'A combinar com o vendedor';
    let sellerAddressRaw = '';
    let sellerCidade = '';
    let sellerRatingAvg = 0;
    let sellerRatingCount = 0;
    let sellerSalesCount = 0;
    try {
        const [sellerInfo, salesData] = await Promise.all([
            supabaseFetch(`users?select=endereco,cidade,estado,vendedor_rating,rating_count&id=eq.${item.vendedor_id}`),
            supabaseFetch(`orders?select=id&seller_id=eq.${item.vendedor_id}&status=eq.finished`)
        ]);
        if (sellerInfo?.length > 0) {
            const s = sellerInfo[0];
            sellerAddressRaw = s.endereco || '';
            sellerAddress = `${s.endereco || ''}, ${s.cidade || ''} - ${s.estado || ''}`.replace(/^, /, '');
            sellerCidade  = s.cidade || '';
            sellerRatingAvg   = parseFloat(s.vendedor_rating) || 0;
            sellerRatingCount = parseInt(s.rating_count) || 0;
        }
        sellerSalesCount = salesData?.length || 0;
    } catch (e) {}

    const realizaEntrega  = !!(item.realiza_entrega ?? item.realizaEntrega ?? item.realizaentrega ?? true);
    // Prioriza a cidade atual cadastrada pelo vendedor (mais confiável); só usa a do
    // anúncio como reserva, e se nenhuma existir, simplesmente omite essa parte do texto.
    const cidadeVendedor  = sellerCidade || item.cidade || '';
    const regiaoEntrega   = [enderecoSemNumero(sellerAddressRaw), cidadeVendedor].filter(Boolean).join(' - ') || 'Consulte o vendedor';
    const images = safeParseImages(item.img);
    const mainImg         = images[0] || '';
    const hasMultipleImgs = images.length > 1;

    const level          = sellerRatingCount > 0 ? Math.round(sellerRatingAvg) : 0;
    const colors         = ['#F23D35', '#FF8900', '#FFE600', '#ADE07E', '#00A650'];
    const likesCount     = item.likes || 0;
    // Nível de 0 a 5 pra desenhar a barra de "Interesse no produto", igual ao estilo
    // da barra de reputação — mas essa aqui é baseada só na quantidade de curtidas do
    // produto, sem nenhuma relação com a nota/reputação do vendedor.
    const likesLevel      = likesCount === 0 ? 0 : Math.min(5, Math.ceil(likesCount / 10));

    // Guarda o estado atual do grid (lista/pedidos/curtidos etc.) pra poder voltar
    // exatamente pra onde o usuário estava, sem precisar recarregar nada da rede.
    const grid = document.getElementById('productsGrid');
    if (!grid.classList.contains('product-detail-active')) {
        window._preDetailState = {
            html: grid.innerHTML,
            gridClass: grid.className,
            gridDisplay: grid.style.display,
            title: document.getElementById('gridTitle')?.textContent || '',
            heroHidden: document.getElementById('heroSection')?.classList.contains('d-none') ?? true
        };
    }

    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    const gridTitleEl = document.getElementById('gridTitle');
    if (gridTitleEl) gridTitleEl.textContent = '';

    grid.className = 'product-detail-active';
    grid.style.display = 'block';

    const precoNum = parseFloat(item.preco) || 0;
    const installmentValue = precoNum / 3;
    const installmentStr = installmentValue.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    // Total de vendas: prioriza o campo do produto (vendas/soldCount) e, se
    // não houver, conta os pedidos deste product_id (qualquer status de venda
    // concluída/andamento, exceto cancelado/disputa).
    let totalSold = parseInt(item.vendas ?? item.soldCount ?? 0) || 0;
    if (!totalSold && item.id) {
        try {
            const rows = await supabaseFetch(`orders?product_id=eq.${encodeURIComponent(item.id)}&select=status`);
            const soldStatuses = new Set(['finished', 'accepted', 'agreement', 'shipping', 'awaiting_pickup', 'offer_pending']);
            totalSold = Array.isArray(rows) ? rows.filter(o => soldStatuses.has(o.status)).length : 0;
            // Persiste no produto para próximas aberturas (campo opcional)
            if (totalSold > 0) {
                supabaseFetch(`products?id=eq.${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ vendas: totalSold }) }).catch(() => {});
            }
        } catch (e) { totalSold = 0; }
    }

    grid.innerHTML = `
        <div class="detail-page">
            <button type="button" class="detail-back-btn" onclick="window.closeProductDetail()">
                <i class="bi bi-arrow-left"></i> Voltar
            </button>

            <div class="ml-panel">
                <div class="ml-panel-left">
                    <div class="text-center bg-light rounded p-3 d-flex align-items-center justify-content-center position-relative${hasMultipleImgs ? ' product-3d-img' : ''}"
                         style="min-height:260px;" data-pid="${pid}" data-idx="0"
                         ${hasMultipleImgs ? `onmousemove="window.tiltDetailImage(event, this)" onmouseleave="window.resetDetailImage(this)"` : ''}>
                        ${mainImg
                            ? `<img id="mainDetailImg" src="${mainImg}" class="img-fluid" style="max-height:420px;object-fit:contain;transition:transform 0.15s ease-out, opacity 0.15s ease;" referrerpolicy="no-referrer"
                                   onerror="this.onerror=null;this.parentElement.innerHTML='<i class=\\'bi bi-box-seam text-secondary\\' style=\\'font-size:4rem;\\'></i>'">`
                            : `<i class="bi bi-box-seam text-secondary" style="font-size:4rem;"></i>`
                        }
                        ${hasMultipleImgs ? `
                            <div class="card-img-edge card-img-edge-left" onclick="event.stopPropagation(); window.cycleDetailImage('${pid}', this.parentElement, -1)"><i class="bi bi-chevron-left"></i></div>
                            <div class="card-img-edge card-img-edge-right" onclick="event.stopPropagation(); window.cycleDetailImage('${pid}', this.parentElement, 1)"><i class="bi bi-chevron-right"></i></div>
                            <div class="card-img-dots">${images.map((_, i) => `<span class="card-img-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>
                        ` : ''}
                    </div>
                </div>

                <div class="ml-panel-right">
                    <div class="ml-category">${item.categoria || 'Produto'}</div>
                    <div class="ml-condition">
                    ${(() => {
                        const cm = (item.descricao || '').match(REGEX_CONDICAO);
                        return cm ? `<span class="ml-cond-badge ml-cond-${condToClass(cm[1])} me-2">${cm[1]}</span>` : '';
                    })()}
                    <span class="ml-meta-sep">|</span> <span class="ml-sold-count">${totalSold > 0 ? `${formatSoldCount(totalSold)} vendidos` : 'Nenhum vendido'}</span>
                </div>

                    <div class="ml-title-row">
                        <h1 class="ml-title">${item.titulo}</h1>
                        <div class="ml-like-share">
                            <i class="bi bi-heart${likedProducts.includes(pid) ? '-fill text-danger' : ''} ml-heart" onclick="window.toggleLike('${pid}')" title="Curtir"></i>
                            <i class="bi bi-share ml-share-icon" onclick="window.shareProduct('${pid}')" title="Compartilhar"></i>
                        </div>
                    </div>


                    <div class="ml-price-card">
                        <div class="ml-price">
                            ${precoNum === 0
                                ? `<span class="ml-price-gratis">GRÁTIS</span>`
                                : `R$ <span class="ml-price-int">${Math.floor(precoNum).toLocaleString('pt-BR')}</span><span class="ml-price-cents">,${((precoNum % 1).toFixed(2)).slice(1)}</span>`
                            }
                        </div>
                        ${item.preco_original && parseFloat(item.preco_original) > precoNum ? `
                            <div class="ml-old-price">R$ ${parseFloat(item.preco_original).toLocaleString('pt-BR', {minimumFractionDigits:2})} <span class="ml-discount">${Math.round(100 - (precoNum / parseFloat(item.preco_original)) * 100)}% OFF</span></div>
                        ` : ''}
                        ${precoNum > 0 ? `<div class="ml-installments">em <strong>3x de R$ ${installmentStr}</strong> sem juros</div>` : ''}
                    </div>

                    <div class="ml-stock-status">Estoque disponível</div>

                    ${realizaEntrega ? `
                    <div class="ml-shipping-card">
                        <i class="bi bi-truck ml-shipping-check" style="color:#3483fa;"></i>
                        <div>
                            <span class="ml-shipping-title">Entrega disponível</span>
                            <span class="ml-shipping-detail"><a href="#" class="text-muted text-decoration-none" onclick="event.preventDefault();event.stopPropagation();window.openAddressMap('${regiaoEntrega.replace(/'/g, "\\'")}')">Entrega em <strong>${regiaoEntrega}</strong></a></span>
                        </div>
                    </div>
                    ` : `
                    <div class="ml-shipping-card ml-shipping-pickup">
                        <i class="bi bi-geo-alt-fill" style="color:#e67e22;font-size:1.3rem;"></i>
                        <div>
                            <span class="ml-shipping-title" style="color:#e67e22;">Retirada no local</span>
                            <span class="ml-shipping-detail"><a href="#" class="text-decoration-none" style="color:#e67e22;" onclick="event.preventDefault();event.stopPropagation();window.openAddressMap('${sellerAddress.replace(/'/g, "\\'")}')">${sellerAddress}</a></span>
                        </div>
                    </div>
                    `}

                    ${!isOwner && !isAdminViewing ? `
                    <div class="ml-qty-picker mb-3" id="mlQtyPicker" style="margin-top:12px;">
                        <button type="button" class="ml-qty-picker-btn" onclick="window.toggleQtyDropdown(event)">
                            <span>Quantidade: <strong id="detailQtyValue">1</strong> <span class="ml-qty-picker-avail">(${item.quantidade || 1} disponíve${item.quantidade === 1 ? 'l' : 'is'})</span></span>
                            <i class="bi bi-chevron-down"></i>
                        </button>
                        <div class="ml-qty-dropdown" id="qtyDropdownList">
                            ${Array.from({ length: Math.max(1, item.quantidade || 1) }, (_, i) => i + 1).map(n => `
                                <div class="ml-qty-option" onclick="window.selectDetailQty(${n})">${n}</div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="ml-actions">
                        <button class="ml-btn ml-btn-primary" onclick="window.addToCart('${pid}', {openCart:false, silent:true, qty:window._detailQty || 1});window.buyItem(cart.length-1);">
                            <i class="bi bi-lightning me-2"></i>Comprar agora
                        </button>
                        ${precoNum > 0 ? `
                        <button class="ml-btn ml-btn-outline" onclick="window.openOfferModal('${pid}')">
                            <i class="bi bi-tag me-2"></i>Fazer Oferta
                        </button>` : ''}
                        <button class="ml-btn ml-btn-outline" onclick="window.addToCart('${pid}', {qty:window._detailQty || 1});">
                            <i class="bi bi-cart-plus me-2"></i>Adicionar ao carrinho
                        </button>
                    </div>
                    ` : isOwner ? `
                    <div class="ml-actions">
                        <button class="ml-btn ml-btn-primary" onclick="window.prepareEditProduct('${item.id}')"><i class="bi bi-pencil me-2"></i>Editar Anúncio</button>
                        <button class="ml-btn ml-btn-danger" onclick="window.deleteProduct('${item.id}')"><i class="bi bi-trash me-2"></i>Excluir</button>
                    </div>
                    ` : `
                    <div class="ml-actions">
                        <button class="ml-btn ml-btn-primary" onclick="window.adminEditProduct('${item.id}')"><i class="bi bi-pencil me-2"></i>Editar (Admin)</button>
                        <button class="ml-btn ml-btn-danger" onclick="window.adminDeleteProduct('${item.id}', '${(item.titulo || '').replace(/'/g, "\\'")}')"><i class="bi bi-trash me-2"></i>Excluir</button>
                    </div>
                    `}

                    <div class="ml-seller-section">
                        <h4 class="ml-seller-title">Reputação do vendedor</h4>
                        <p class="ml-seller-name"><strong>${item.loja || 'Vendedor'}</strong></p>
                        <div class="ml-reputation-stars">${sellerRatingCount > 0
                            ? `${renderRatingStars(sellerRatingAvg)} <span style="margin-left:6px;font-size:0.85em;">${sellerRatingAvg.toFixed(1)} · ${sellerRatingCount} avaliaç${sellerRatingCount === 1 ? 'ão' : 'ões'}</span>`
                            : 'Ainda sem avaliações'}</div>
                         <a href="javascript:void(0)" class="ml-more-link" onclick="event.preventDefault(); window.showSellerProfile('${item.vendedor_id}', '${(item.loja||'').replace(/'/g,"\\'")}');">Ver mais dados do vendedor</a>
                    </div>
                </div>

                <div class="ml-panel-desc">
                    <h5 class="fw-bold">Descrição</h5>
                    <p class="text-muted" style="line-height:1.7;white-space:pre-line;">${(item.descricao || '').replace(REGEX_CONDICAO, '') || 'Sem descrição detalhada.'}</p>
                </div>
            </div>

            <div class="product-opinions-section">
                <div class="product-opinions-header">
                    <h5 class="fw-bold mb-0">Opiniões do produto</h5>
                    <span class="text-muted small" id="opinionsCount"></span>
                </div>
                <div id="productReviewsList" class="text-muted small">Carregando avaliações...</div>
            </div>
        </div>`;

    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Carrega avaliações do produto
    window.loadProductReviews(pid);
    // Atualiza a URL para permitir compartilhamento
    if (window.location.hash !== '#/produto/' + pid) {
        history.pushState(null, '', '#/produto/' + pid);
    }
};

/** Fecha a página de detalhes em tela cheia e restaura exatamente a tela anterior
 *  (grid de produtos, curtidos, histórico etc.) sem precisar buscar nada de novo. */
window.closeProductDetail = function() {
    const grid  = document.getElementById('productsGrid');
    const state = window._preDetailState;
    if (!grid || !state) { loadPage(undefined, true); return; }

    grid.className     = state.gridClass;
    grid.style.display = state.gridDisplay;
    grid.innerHTML      = state.html;

    const gridTitleEl = document.getElementById('gridTitle');
    if (gridTitleEl) gridTitleEl.textContent = state.title;

    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.toggle('d-none', state.heroHidden);

    window._preDetailState = null;
    // Limpa a URL
    if (window.location.hash.startsWith('#/produto/')) {
        history.pushState(null, '', window.location.pathname + window.location.search);
    }
};

window.prepareEditProduct = function(pid) {
    window.showCreateAdPage(pid);
};

// ============================================
// AUTH / USUÁRIO
// ============================================

function getSavedUser() {
    try { return JSON.parse(localStorage.getItem('electroUser')) || null; }
    catch { return null; }
}

// ============================================
// SIMULAÇÃO DE PAPEL (só para Administradores)
// ============================================
// Como não existe cadastro de conta Administrador pelo site (é sempre uma
// conta "de verdade" configurada por fora), o admin não tem como ver a
// plataforma como Cliente ou Vendedor sem sair da própria conta. A simulação
// resolve isso: guarda só localmente (localStorage) qual papel o admin quer
// "ver como" no momento — NUNCA grava isso no banco, e o id da conta continua
// sendo o mesmo o tempo todo. É só trocar de volta pra "Administrador" (ou
// deslogar) pra sair da simulação a qualquer momento.

function getSimulatedRole() {
    try { return localStorage.getItem('electroSimRole') || null; } catch { return null; }
}

/** Ativa/desativa a simulação. `role` deve ser 'CLIENTE', 'VENDEDOR' ou null (desativa). */
window.setAdminSimulation = function(role) {
    const real = getSavedUser();
    if (!real || real.tipo !== 'ADMIN') return; // só administradores de verdade podem simular
    try {
        if (role) localStorage.setItem('electroSimRole', role);
        else localStorage.removeItem('electroSimRole');
    } catch (e) {}
    const label = role === 'VENDEDOR' ? 'Vendedor' : (role === 'CLIENTE' ? 'Cliente' : 'Administrador');
    showToast(role ? `Agora você está vendo a plataforma como ${label}.` : 'Voltando ao modo Administrador normal.', 'info');
    updateUI();
    window.renderSimulationBanner();
    window.goHome();
};

/** Usuário "efetivo" pra fins de exibição/navegação (menus, home, badges).
 *  Se o real for Administrador e houver uma simulação ativa, devolve uma
 *  cópia com o tipo trocado — mesmo id, mesmo nome, mesma conta; só o papel
 *  exibido muda. Ações realmente privilegiadas (painel admin, apagar
 *  conta/produto de terceiro etc.) continuam checando o tipo REAL
 *  (getSavedUser()), não este. */
function getEffectiveUser() {
    const user = getSavedUser();
    if (!user || user.tipo !== 'ADMIN') return user;
    const sim = getSimulatedRole();
    if (!sim) return user;
    return { ...user, tipo: sim };
}

/** Mostra (ou esconde) a faixa fixa "Simulando: Cliente/Vendedor — Voltar ao Admin",
 *  visível em qualquer tela enquanto a simulação estiver ativa, já que o menu de
 *  administrador some da navegação nesse modo. */
window.renderSimulationBanner = function() {
    const real = getSavedUser();
    const sim  = real?.tipo === 'ADMIN' ? getSimulatedRole() : null;
    let bar = document.getElementById('adminSimBanner');
    if (!sim) { bar?.remove(); return; }

    const label = sim === 'VENDEDOR' ? 'Vendedor' : 'Cliente';
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'adminSimBanner';
        document.body.prepend(bar);
    }
    bar.innerHTML = `
        <i class="bi bi-eye-fill"></i>
        <span>Simulando: <strong>${label}</strong></span>
        <button type="button" onclick="window.setAdminSimulation(null)">
            <i class="bi bi-shield-lock-fill me-1"></i>Voltar ao Admin
        </button>`;
};

function updateUI() {
    const user   = getSavedUser();
    const logged = !!user;
    const effUser = getEffectiveUser();
    const role   = effUser?.tipo || 'CLIENTE';

    document.querySelectorAll('.role-guest').forEach(el     => el.classList.toggle('d-none', logged));
    document.querySelectorAll('.role-logged-in').forEach(el => el.classList.toggle('d-none', !logged));
    document.querySelectorAll('.role-client').forEach(el    => el.classList.toggle('d-none', role === 'VENDEDOR' || role === 'ADMIN'));
    document.querySelectorAll('.role-seller').forEach(el    => el.classList.toggle('d-none', role !== 'VENDEDOR'));
    document.querySelectorAll('.role-admin').forEach(el     => el.classList.toggle('d-none', role !== 'ADMIN'));
    window.renderSimulationBanner();

    if (role === 'VENDEDOR') {
        updateSellerPendingBadge(user.id);
    }

    const heroSection = document.getElementById('heroSection');
    if (heroSection) heroSection.classList.toggle('d-none', role === 'VENDEDOR');

    const shippingLabel = document.getElementById('shippingLabel');
    if (shippingLabel) {
        shippingLabel.textContent = logged
            ? (user.endereco?.substring(0, 20) + '...') || user.cidade || 'Endereço'
            : (guestDetectedRegion ? `${guestDetectedRegion.cidade} - ${guestDetectedRegion.estado}` : 'Detectando local...');
    }

    // Sync tema
    const modoEscuro  = document.body.classList.contains('dark-theme');
    const themeSwitch = document.getElementById('themeSwitchMobile');
    if (themeSwitch) themeSwitch.checked = modoEscuro;

    const desktopIcon = document.querySelector('#themeToggle i');
    if (desktopIcon) {
        desktopIcon.className = modoEscuro ? 'bi bi-sun' : 'bi bi-moon-stars';
    }

    const navName = document.getElementById('navUserName');
    const navAvatar = document.getElementById('navUserAvatar');
    const navIcon = document.getElementById('navUserIcon');
    const mobileUserName = document.getElementById('mobileUserName');
    const mobileTrigger = document.getElementById('mobileUserTrigger');
    const mobileMenuAvatar = document.getElementById('mobileProfileHeader');
    const mobileWelcomeName = document.getElementById('mobileWelcomeName');

    if (logged) {
        const firstNome = user.nome ? user.nome.split(' ')[0] : 'Usuário';
        if (navName) navName.textContent = firstNome;
        if (mobileUserName) mobileUserName.textContent = firstNome;
        if (mobileWelcomeName) mobileWelcomeName.textContent = `Olá, ${firstNome}`;

        const avatarLinks = safeParseImages(user.avatar);
        const userAvatarLink = avatarLinks.length > 0 ? avatarLinks[0] : null;
        const hasAvatar = userAvatarLink && userAvatarLink.startsWith('http');

        if (navAvatar && navIcon) {
            navAvatar.src = hasAvatar ? userAvatarLink : '';
            navAvatar.style.display = hasAvatar ? 'block' : 'none';
            navIcon.style.display = hasAvatar ? 'none' : 'block';
        }

        if (mobileTrigger) {
            mobileTrigger.innerHTML = hasAvatar
                ? `<img src="${userAvatarLink}" style="width:100%;height:100%;object-fit:cover;" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://placehold.co/100'">`
                : `<i class="bi bi-person-circle fs-5 text-white"></i>`;
        }

        if (mobileMenuAvatar) {
            mobileMenuAvatar.innerHTML = hasAvatar
                ? `<img src="${userAvatarLink}" style="width:100%;height:100%;object-fit:cover;" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://placehold.co/100'">`
                : user.nome ? `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:bold;color:var(--primary-blue);">${user.nome.charAt(0).toUpperCase()}</div>`
                : `<i class="bi bi-person-fill fs-3" style="color: var(--primary-blue);"></i>`;
        }
        loadNotifications();
    } else {
        if (navName) navName.textContent = 'Usuário';
        if (mobileUserName) mobileUserName.textContent = 'Usuário';
        if (mobileWelcomeName) mobileWelcomeName.textContent = 'Olá, visitante';

        if (navAvatar && navIcon) {
            navAvatar.style.display = 'none';
            navIcon.style.display = 'block';
        }
        if (mobileTrigger) {
            mobileTrigger.innerHTML = `<i class="bi bi-person-circle fs-5 text-white"></i>`;
        }
        if (mobileMenuAvatar) {
            mobileMenuAvatar.innerHTML = `<i class="bi bi-person-fill fs-3" style="color: var(--primary-blue);"></i>`;
        }
    }
    // Preview em tempo real do Avatar no Perfil
    document.getElementById('editAvatarLink')?.addEventListener('input', (e) => {
        const preview = document.getElementById('profilePreview');
        const url = e.target.value.trim();
        if (preview) {
            preview.src = url.startsWith('http') ? url : 'https://placehold.co/100';
        }
    });

    updateCartBadge();
}

async function loadNotifications() {
    const user = getSavedUser();
    const container = document.getElementById('notificacoesList');
    const badge = document.getElementById('notifBadgeDesktop');
    
    let displayNotifs = notificationsCache;

    try {
        if (user) {
            const dbNotifs = await supabaseFetch(`notifications?user_id=eq.${user.id}&order=created_at.desc&limit=10`);
            if (dbNotifs && dbNotifs.length > 0) {
                displayNotifs = dbNotifs;
                // Sincroniza cache local com o banco para manter atualizado
                notificationsCache = dbNotifs;
                localStorage.setItem('electroNotifs', JSON.stringify(notificationsCache));
            }
        }
    } catch (e) { console.error("Erro ao carregar do banco, usando cache local:", e); }

    if (container) {
        const notifs = displayNotifs;
            if (notifs.length === 0) {
                container.innerHTML = '<div class="notif-empty"><i class="bi bi-bell-slash"></i><span>Nenhuma notificação</span></div>';
            } else {
                const icons = {
                    success: { icon: 'bi-check-lg', bg: '#28a745' },
                    error:   { icon: 'bi-x', bg: '#dc3545' },
                    info:    { icon: 'bi-info', bg: '#3483fa' },
                    warning: { icon: 'bi-exclamation', bg: '#e67e22' }
                };

                container.innerHTML = notifs.map((n, idx) => {
                    const ico = icons[n.type] || icons.info;
                    const lines = (n.message || '').split('\n');
                    const title = lines[0] || '';
                    const desc = lines.slice(1).join(' ') || '';
                    const isUnread = !n.read;
                    return `
                    <div class="notif-item${isUnread ? ' notif-item-unread' : ''}" style="animation-delay:${idx * 0.03}s">
                        <div class="notif-item-icon" style="background:${ico.bg};color:#fff">
                            <i class="bi ${ico.icon}" style="color:#fff"></i>
                        </div>
                        <div class="notif-item-content">
                            <div class="notif-item-title">${title || 'Notificação'}</div>
                            ${desc ? `<div class="notif-item-desc">${desc}</div>` : ''}
                            <div class="notif-item-time">${n.created_at ? new Date(n.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</div>
                        </div>
                        <button type="button" class="notif-item-close" onclick="event.stopPropagation();window.deleteSingleNotif(${idx})" title="Remover">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>`;
                }).join('');
            }
    }
    
    updateNotifBadges();
}

/**
 * Abre/fecha o dropdown de notificações
 */
window.showNotifications = async function() {
    const dropdown = document.getElementById('notifDropdown');
    if (!dropdown) return;
    const isOpen = dropdown.classList.contains('notif-open');
    if (isOpen) {
        window.closeNotifications();
        return;
    }
    dropdown.classList.add('notif-open');
    await loadNotifications();
    const user = getSavedUser();
    if (user && notificationsCache.length) {
        const unread = notificationsCache.filter(n => !n.read);
        if (unread.length) {
            try {
                await supabaseFetch(`notifications?user_id=eq.${user.id}&read=eq.false`, { method: 'PATCH', body: JSON.stringify({ read: true }) });
            } catch(e) {}
        }
        notificationsCache.forEach(n => n.read = true);
        localStorage.setItem('electroNotifs', JSON.stringify(notificationsCache));
        updateNotifBadges();
    }
};

window.closeNotifications = function() {
    const dropdown = document.getElementById('notifDropdown');
    if (dropdown) dropdown.classList.remove('notif-open');
};

        // Fecha o dropdown ao clicar fora
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('notifDropdown');
    const bells = document.querySelectorAll('[onclick*="showNotifications"]');
    if (dropdown && dropdown.classList.contains('notif-open') && !dropdown.contains(e.target) && !Array.from(bells).some(b => b.contains(e.target))) {
        window.closeNotifications();
    }
});

// Swipe gestures em mobile
document.addEventListener('touchstart', function(e) {
    const item = e.target.closest('.notif-item');
    if (!item || window.innerWidth > 576) return;
    const touch = e.changedTouches[0];
    item._swipe = { startX: touch.clientX, startY: touch.clientY, currentX: touch.clientX, moved: false };
}, { passive: true });

document.addEventListener('touchmove', function(e) {
    const item = e.target.closest('.notif-item');
    if (!item || !item._swipe) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - item._swipe.startX;
    const dy = touch.clientY - item._swipe.startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        e.preventDefault();
        item._swipe.moved = true;
        item._swipe.currentX = touch.clientX;
        item.style.transform = `translateX(${dx}px)`;
        item.style.transition = 'none';
        if (dx < -60) {
            item.style.background = dx < -120 ? '#f8d7da' : 'var(--card-bg)';
        } else if (dx > 60) {
            item.style.background = dx > 120 ? '#d4edda' : 'var(--card-bg)';
        } else {
            item.style.background = 'var(--card-bg)';
        }
    }
}, { passive: false });

document.addEventListener('touchend', function(e) {
    const item = e.target.closest('.notif-item');
    if (!item || !item._swipe) return;
    const dx = (e.changedTouches[0].clientX - item._swipe.startX);
    item._swipe = null;
    item.style.transition = 'transform .3s ease, background .3s ease';
    item.style.transform = '';
    item.style.background = '';
    const idx = Array.from(item.parentNode.children).indexOf(item);
    if (idx === -1) return;
    if (dx < -100) {
        item.style.transform = 'translateX(-120%)';
        item.style.opacity = '0';
        setTimeout(() => { window.deleteSingleNotif(idx); }, 250);
    } else if (dx > 100) {
        item.style.transform = 'translateX(120%)';
        item.style.opacity = '0';
        setTimeout(() => { window.toggleNotifRead(idx); }, 250);
    }
}, { passive: true });

/** Alterna o menu de ações de uma notificação */
window.toggleNotifMenu = function(btn) {
    const menu = btn.nextElementSibling;
    if (menu) menu.classList.toggle('open');
};

window.closeNotifMenu = function(el) {
    const menu = el.closest('.notif-item-actions-menu');
    if (menu) menu.classList.remove('open');
};

/** Marca/desmarca uma notificação como lida */
window.toggleNotifRead = function(idx) {
    const n = notificationsCache[idx];
    if (!n) return;
    n.read = !n.read;
    localStorage.setItem('electroNotifs', JSON.stringify(notificationsCache));
    loadNotifications();
    updateNotifBadges();
};

/** Exclui uma notificação individual */
window.deleteSingleNotif = function(idx) {
    const n = notificationsCache[idx];
    if (!n) return;
    notificationsCache.splice(idx, 1);
    localStorage.setItem('electroNotifs', JSON.stringify(notificationsCache));
    // Tenta excluir do banco se tiver ID
    const user = getSavedUser();
    if (user && n.id) {
        supabaseFetch(`notifications?id=eq.${n.id}`, { method: 'DELETE' }).catch(() => {});
    }
    loadNotifications();
    updateNotifBadges();
};

/** Marca todas como lidas */
window.markAllRead = function() {
    const user = getSavedUser();
    if (user && notificationsCache.length) {
        const unread = notificationsCache.filter(n => !n.read);
        if (unread.length) {
            supabaseFetch(`notifications?user_id=eq.${user.id}&read=eq.false`, { method: 'PATCH', body: JSON.stringify({ read: true }) }).catch(() => {});
        }
    }
    notificationsCache.forEach(n => n.read = true);
    localStorage.setItem('electroNotifs', JSON.stringify(notificationsCache));
    loadNotifications();
    updateNotifBadges();
    showToast('Todas as notificações marcadas como lidas.', 'success');
};

/** Exclui todas as notificações com confirmação */
window.deleteAllNotifs = function() {
    if (notificationsCache.length === 0) return;
    if (!confirm('Tem certeza que deseja excluir todas as notificações?')) return;
    const user = getSavedUser();
    if (user) {
        supabaseFetch(`notifications?user_id=eq.${user.id}`, { method: 'DELETE' }).catch(() => {});
    }
    notificationsCache = [];
    localStorage.setItem('electroNotifs', JSON.stringify(notificationsCache));
    loadNotifications();
    updateNotifBadges();
    showToast('Todas as notificações foram excluídas.', 'info');
};

function updateNotifBadges() {
    const unread = notificationsCache.filter(n => !n.read).length;
    const badge = document.getElementById('notifBadgeDesktop');
    if (badge) { badge.textContent = unread; badge.classList.toggle('d-none', unread === 0); }
    const mobileBadge = document.getElementById('mobileNotifBadge');
    if (mobileBadge) { mobileBadge.textContent = unread; mobileBadge.classList.toggle('d-none', unread === 0); }
}

function updateCartBadge() {
    const count = cart.reduce((a, i) => a + (i.qtd || 1), 0);
    document.querySelectorAll('#cartBadgeDesktop, #cartBadgeMobile').forEach(el => {
        if (el) { el.textContent = count; el.classList.toggle('d-none', count === 0); }
    });
}

window.openAddressMap = function(location) {
    if (!location) {
        showToast('Endereço não disponível para este anúncio.', 'info');
        return;
    }
    window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(location), '_blank');
};

window.sendChatLocation = async function() {
    const user = getSavedUser();
    const addr = user?.endereco || user?.cidade;
    if (!addr) {
        showToast('Cadastre um endereço no seu perfil para compartilhar.', 'info');
        return;
    }
    if (!window.currentChat) { showToast('Nenhum chat aberto.', 'warning'); return; }
    const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);
    try {
        const chatResult = await supabaseFetch(`chats?order_id=eq.${window.currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Chat não encontrado.', 'error'); return; }
        chat.messages.push({
            senderId: user.id, senderName: user.nome,
            text: `📍 ${addr}\n${mapsUrl}`,
            timestamp: new Date().toISOString(), type: 'location'
        });
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        if (typeof loadChatMessages === 'function') loadChatMessages(window.currentChat);
        showToast('Localização enviada!', 'success');
    } catch (e) { showToast('Erro ao enviar localização.', 'error'); }
};

window.sendSupportChatLocation = async function() {
    const user = getSavedUser();
    const addr = user?.endereco || user?.cidade;
    if (!addr) { showToast('Cadastre um endereço no seu perfil.', 'info'); return; }
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) { showToast('Nenhum chamado aberto.', 'warning'); return; }
    const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = result?.[0];
        if (!ticket) { showToast('Chamado não encontrado.', 'error'); return; }
        ticket.messages.push({
            senderId: user.id, senderName: user.nome,
            text: `📍 ${addr}\n${mapsUrl}`,
            timestamp: new Date().toISOString(), type: 'location'
        });
        await supabaseFetch(`chats?id=eq.${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ messages: ticket.messages }) });
        if (typeof loadMySupportTicket === 'function') loadMySupportTicket(ticketId);
        showToast('Localização enviada!', 'success');
    } catch (e) { showToast('Erro ao enviar localização.', 'error'); }
};

// ============================================
// CARRINHO
// ============================================

function renderCart() {
    const list    = document.getElementById('cartItemsList');
    const totalEl = document.getElementById('cartTotalValue');
    if (!list) return;

    if (!cart.length) {
        list.innerHTML = `
            <div class="text-center py-5 text-muted">
                <i class="bi bi-cart-x fs-1 d-block mb-3"></i>
                Seu carrinho está vazio
            </div>`;
        if (totalEl) totalEl.textContent = 'R$ 0,00';
        updateCartBadge();
        return;
    }

    let total = 0;
    list.innerHTML = cart.map((item, i) => {
        total += (item.preco || 0) * (item.qtd || 1);
        const thumb = safeParseImages(item.img)[0];
        return `
        <div class="cart-item">
            <div class="d-flex gap-2 align-items-start">
                <img src="${thumb || 'https://placehold.co/60'}" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/60/e9ecef/6c757d?text=%20'">
                <div class="flex-grow-1" style="min-width:0">
                    <div class="cart-item-title text-truncate">${item.titulo}</div>
                    <div class="cart-item-price">${(item.preco || 0) === 0 ? 'GRÁTIS' : `R$ ${(item.preco || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}`}</div>
                    <div class="d-flex align-items-center gap-2 mt-2">
                        <button class="btn btn-outline-secondary" onclick="window.updateCartQty(${i}, -1)">−</button>
                        <span class="small fw-bold">${item.qtd || 1}</span>
                        <button class="btn btn-outline-secondary" onclick="window.updateCartQty(${i}, +1)">+</button>
                    </div>
                </div>
            </div>
            <div class="d-flex gap-1 mt-2">
                <button class="btn btn-sm btn-outline-danger flex-grow-1" onclick="removeFromCart(${i})">
                    <i class="bi bi-trash"></i>
                </button>
                <button class="btn btn-sm btn-outline-primary flex-grow-1" onclick="buyItem(${i})">
                    Solicitar Compra
                </button>
            </div>
        </div>`;
    }).join('');

    if (totalEl) totalEl.textContent = formatPreco(total, {htmlGratis:false});
    updateCartBadge();
    localStorage.setItem('electroCart', JSON.stringify(cart));
}

/** Esvazia o carrinho por completo, com confirmação pra evitar clique acidental */
window.esvaziarCarrinho = function() {
    if (cart.length === 0) { showToast('Seu carrinho já está vazio.', 'info'); return; }
    if (!confirm('Tem certeza que deseja remover todos os itens do carrinho?')) return;
    cart.length = 0;
    localStorage.setItem('electroCart', JSON.stringify(cart));
    renderCart();
    showToast('Carrinho esvaziado.', 'info');
};

/** Seletor de quantidade estilo Mercado Livre: botão abre uma lista com todas
 *  as quantidades disponíveis (1 até o estoque do produto) */
window.toggleQtyDropdown = function(evt) {
    if (evt) evt.stopPropagation();
    const list = document.getElementById('qtyDropdownList');
    if (!list) return;
    const isOpen = list.classList.contains('show');
    list.classList.toggle('show', !isOpen);
    document.getElementById('mlQtyPicker')?.classList.toggle('open', !isOpen);
};

window.selectDetailQty = function(n) {
    window._detailQty = n;
    const valueEl = document.getElementById('detailQtyValue');
    if (valueEl) valueEl.textContent = n;
    document.getElementById('qtyDropdownList')?.classList.remove('show');
    document.getElementById('mlQtyPicker')?.classList.remove('open');
};

// Fecha o dropdown de quantidade ao clicar fora dele
document.addEventListener('click', (evt) => {
    const picker = document.getElementById('mlQtyPicker');
    if (picker && !picker.contains(evt.target)) {
        document.getElementById('qtyDropdownList')?.classList.remove('show');
        picker.classList.remove('open');
    }
});

document.getElementById('cartOffcanvas')?.addEventListener('show.bs.offcanvas', function(e) {
    if (!getSavedUser()) {
        e.preventDefault();
        window.showAuthScreen?.();
        showToast('Faça login para acessar o carrinho!', 'warning');
    }
});

window.addToCart = function(productId, options = {}) {
    if (!getSavedUser()) {
        window.showAuthScreen?.();
        return showToast('Faça login para adicionar ao carrinho!', 'warning');
    }
    const { openCart = true, silent = false, qty = 1 } = options;
    const p = allProductsCache.find(x => x.id === productId);
    if (!p) return;
    const stock  = Math.max(1, parseInt(p.quantidade) || 1);
    const addQty = Math.max(1, qty);
    const exist = cart.find(i => i.id === productId);
    if (exist) {
        if (exist.qtd + addQty > stock) return showToast(`Limite de ${stock} unidade${stock === 1 ? '' : 's'} em estoque!`, 'warning');
        exist.qtd += addQty;
    } else {
        if (addQty > stock) return showToast(`Limite de ${stock} unidade${stock === 1 ? '' : 's'} em estoque!`, 'warning');
        cart.push({ ...p, qtd: addQty });
    }
    renderCart();
    if (!silent) showToast(`"${p.titulo.substring(0,30)}..." adicionado ao carrinho!`, 'success');

    if (openCart) bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('cartOffcanvas')).show();
};

window.removeFromCart = function(i) {
    cart.splice(i, 1);
    renderCart();
};

window.updateCartQty = function(i, delta) {
    const item = cart[i];
    if (!item) return;
    const stock  = Math.max(1, parseInt(item.quantidade) || 1);
    const newQty = (item.qtd || 1) + delta;
    if (newQty > stock) {
        showToast(`Máximo de ${stock} unidade${stock === 1 ? '' : 's'} em estoque!`, 'warning');
        return;
    }
    newQty < 1 ? window.removeFromCart(i) : (item.qtd = newQty, renderCart());
};

window.toggleLike = async function(pid) {
    const idx     = likedProducts.indexOf(pid);
    const product = allProductsCache.find(p => p.id == pid);
    if (!product) return;

    if (idx > -1) {
        likedProducts.splice(idx, 1);
        product.likes = Math.max(0, (product.likes || 0) - 1);
        showToast('Removido dos curtidos', 'info', 2000);
    } else {
        likedProducts.push(pid);
        product.likes = (product.likes || 0) + 1;
        showToast('Adicionado aos seus curtidos!', 'success', 2000);
    }

    localStorage.setItem('electroLiked', JSON.stringify(likedProducts));
    try {
        await supabaseFetch(`products?id=eq.${pid}`, {
            method: 'PATCH',
            body: JSON.stringify({ likes: product.likes })
        });
    } catch (e) {}

    // Se a página de detalhes em tela cheia estiver aberta, não sobrescreve ela com o
    // grid de novo — só atualiza o botão/contador de curtidas ali mesmo.
    const grid = document.getElementById('productsGrid');
    if (grid?.classList.contains('product-detail-active')) {
        window.refreshDetailLikeBtn(pid);
    } else {
        renderGrid(allProductsCache);
    }
};

window.buyItem = async function(i) {
    const item = cart[i];
    const user = getSavedUser();
    if (!user) { showToast('Faça login para comprar!', 'warning'); return; }

    const btn          = document.querySelector(`button[onclick="buyItem(${i})"]`);
    const originalText = btn?.textContent || 'Solicitar Compra';
    if (btn) { btn.disabled = true; btn.textContent = 'Processando...'; }

    try {
        const orderId = `ord_${Date.now()}`;
        const imgs = safeParseImages(item.img);
        const order   = {
            id:             orderId,
            seller_id:      item.vendedor_id || 'system',
            seller_name:    item.loja || 'Vendedor',
            buyer_id:       user.id,
            buyer_name:     user.nome,
            product_id:     item.id,
            product_title:  item.titulo,
            product_img:    (imgs.length > 0 ? imgs[0] : ''),
            total:          (item.preco || 0) * (item.qtd || 1),
            quantity:       item.qtd || 1,
            status:         'pending',
            // Tabela orders usa realiza_entrega (snake_case) no SQL fornecido
            realiza_entrega: !!(item.realizaEntrega ?? item.realiza_entrega ?? true),
            agree_buyer:    false,
            agree_seller:   false,
            created_at:     new Date().toISOString(),
            updated_at:     new Date().toISOString()
        };

        await supabaseFetch('orders', { method: 'POST', body: JSON.stringify(order) });

        await supabaseFetch('chats', {
            method: 'POST',
            body: JSON.stringify({
                id:           crypto.randomUUID(),
                order_id:     orderId,
                seller_id:    order.seller_id,
                seller_name:  order.seller_name,
                buyer_id:     order.buyer_id,
                buyer_name:   order.buyer_name,
                participants: [order.seller_id, order.buyer_id],
                logistics_agreed: false,
                messages: [{
                    senderId:  'system',
                    text:      `Pedido #${orderId.slice(-8).toUpperCase()} criado!\n${item.titulo}\n${formatPreco(order.total, {htmlGratis:false})}\nAguardando aprovação do vendedor...`,
                    timestamp: new Date().toISOString()
                }]
            })
        });

        cart.splice(i, 1);
        renderCart();
        ordersCache.push(order);
        bootstrap.Offcanvas.getInstance(document.getElementById('cartOffcanvas'))?.hide();

        createPersistentNotification(`Pedido #${orderId.slice(-6).toUpperCase()} realizado com sucesso!`, 'success');
        window.renderOrderManagement('buyer');

    } catch (err) {
        console.error(err);
        showToast('Erro ao processar pedido: ' + (err.message || 'Tente novamente.'), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
};

// ============================================
// FAZER OFERTA (estilo eBay: comprador propõe um
// valor ao vendedor, que aparece em "Solicitações
// Pendentes" pra ser aceito ou recusado)
// ============================================

/** Abre a página fullscreen de fazer oferta (mesmo estilo do Criar Anúncio) */
window.showOfferPage = function(pid) {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    const gridTitleEl = document.getElementById('gridTitle');
    if (gridTitleEl) gridTitleEl.textContent = '';
    document.getElementById('storefrontBanner')?.replaceChildren();

    if (!grid.classList.contains('product-detail-active') && !grid.classList.contains('profile-page-active') && !grid.classList.contains('seller-profile-active') && !grid.classList.contains('create-ad-active') && !grid.classList.contains('offer-page-active')) {
        window._preDetailState = {
            html: grid.innerHTML,
            gridClass: grid.className,
            gridDisplay: grid.style.display,
            title: document.getElementById('gridTitle')?.textContent || '',
            heroHidden: document.getElementById('heroSection')?.classList.contains('d-none') ?? true
        };
    }

    grid.className = 'offer-page-active';
    grid.style.display = 'block';

    const user = getSavedUser();
    if (!user) { showToast('Faça login para enviar uma oferta!', 'warning'); window.closeProductDetail(); return; }

    const item = allProductsCache.find(x => x.id == pid || x.id === pid);
    if (!item) { showToast('Produto não encontrado.', 'error'); window.closeProductDetail(); return; }
    if (user.id === item.vendedor_id) { showToast('Você não pode fazer uma oferta no seu próprio anúncio.', 'warning'); window.closeProductDetail(); return; }

    const preco = parseFloat(item.preco) || 0;

    grid.innerHTML = `
    <div class="detail-page">
        <button type="button" class="detail-back-btn" onclick="window.closeProductDetail()">
            <i class="bi bi-arrow-left"></i> Voltar
        </button>

        <div class="create-ad-wrap">
            <div class="create-ad-header">
                <div>
                    <h4>Fazer Oferta</h4>
                    <p class="text-muted small mb-0">Proponha um valor para este produto</p>
                </div>
            </div>

            <form id="offerForm" class="create-ad-form" onsubmit="window.submitOffer(event)">
                <div class="create-ad-section">
                    <div class="create-ad-section-title">
                        <i class="bi bi-box-seam-fill"></i>
                        <span>Produto</span>
                    </div>
                    <div class="create-ad-section-body">
                        <div class="d-flex align-items-center gap-3 mb-3 pb-3 border-bottom">
                            <img id="offerProductImg" src="${safeParseImages(item.img)[0] || 'https://placehold.co/60'}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://placehold.co/60'"
                                 style="width:60px;height:60px;object-fit:cover;border-radius:8px;flex-shrink:0;">
                            <div class="flex-grow-1">
                                <h6 class="fw-bold mb-1">${item.titulo}</h6>
                                <small class="text-muted">Preço anunciado: <strong>${formatPreco(preco)}</strong></small>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="create-ad-section">
                    <div class="create-ad-section-title">
                        <i class="bi bi-tag-fill"></i>
                        <span>Sua Oferta</span>
                    </div>
                    <div class="create-ad-section-body">
                        <div class="mb-3">
                            <label class="create-ad-label">Seu valor (R$) <span class="text-danger">*</span></label>
                            <input type="number" class="create-ad-input" id="offerAmount" step="0.01" min="0.01"${preco > 0 ? ` max="${preco - 0.01}"` : ''} placeholder="Ex: 150.00" required>
                            <small class="text-muted">O valor deve ser menor que o preço anunciado.</small>
                        </div>
                        <div class="mb-3">
                            <label class="create-ad-label">Quantidade <span class="text-danger">*</span></label>
                            <input type="number" class="create-ad-input" id="offerQty" min="1" value="1" max="${Math.max(1, item.quantidade ?? 9999)}" required>
                        </div>
                        <p class="small text-muted mb-0"><i class="bi bi-info-circle me-1"></i>O vendedor pode aceitar ou recusar sua oferta em até alguns dias. Você será avisado assim que ele responder.</p>
                    </div>
                </div>

                <div class="create-ad-footer">
                    <button type="button" class="ml-btn ml-btn-outline" onclick="window.closeProductDetail()">
                        <i class="bi bi-x-lg me-2"></i>Cancelar
                    </button>
                    <button type="submit" class="ml-btn ml-btn-primary">
                        <i class="bi bi-send me-2"></i>Enviar Oferta
                    </button>
                </div>
            </form>
        </div>
    </div>`;

    document.getElementById('offerForm').dataset.pid = pid;
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.openOfferModal = function(pid) { window.showOfferPage(pid); };

/** Envia a oferta como um pedido com status especial (offer_pending), reaproveitando
 *  toda a estrutura de pedidos/chat já existente — o vendedor decide em "Solicitações
 *  Pendentes", igual ao fluxo de aceitar/recusar uma compra normal. */
window.submitOffer = async function(event) {
    event.preventDefault();
    const user = getSavedUser();
    if (!user) { showToast('Faça login para enviar uma oferta!', 'warning'); return; }

    const form = document.getElementById('offerForm');
    const pid  = form.dataset.pid;
    const item = allProductsCache.find(x => x.id == pid || x.id === pid);
    if (!item) { showToast('Produto não encontrado.', 'error'); return; }

    const preco      = parseFloat(item.preco) || 0;
    const offerValue = parseFloat(document.getElementById('offerAmount').value);
    const qty        = parseInt(document.getElementById('offerQty').value) || 1;

    if (!offerValue || offerValue <= 0) { showToast('Informe um valor de oferta válido.', 'warning'); return; }
    if (preco > 0 && offerValue >= preco) {
        showToast('A oferta deve ser menor que o preço anunciado. Pra pagar o valor cheio, use "Solicitar Compra".', 'warning');
        return;
    }

    const btn          = form.querySelector('button[type="submit"]');
    const originalText = btn?.textContent || 'Enviar Oferta';
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

    try {
        const orderId = `ord_${Date.now()}`;
        const imgs = safeParseImages(item.img);
        const order = {
            id:                   orderId,
            seller_id:            item.vendedor_id || 'system',
            seller_name:          item.loja || 'Vendedor',
            buyer_id:             user.id,
            buyer_name:           user.nome,
            product_id:           item.id,
            product_title:        item.titulo,
            product_img:          (imgs.length > 0 ? imgs[0] : ''),
            total:                offerValue * qty,
            quantity:             qty,
            status:               'offer_pending',
            realiza_entrega:      !!(item.realiza_entrega ?? item.realizaEntrega ?? true),
            agree_buyer:          false,
            agree_seller:         false,
            created_at:           new Date().toISOString(),
            updated_at:           new Date().toISOString()
        };

        await supabaseFetch('orders', { method: 'POST', body: JSON.stringify(order) });

        await supabaseFetch('chats', {
            method: 'POST',
            body: JSON.stringify({
                id:           crypto.randomUUID(),
                order_id:     orderId,
                seller_id:    order.seller_id,
                seller_name:  order.seller_name,
                buyer_id:     order.buyer_id,
                buyer_name:   order.buyer_name,
                participants: [order.seller_id, order.buyer_id],
                logistics_agreed: false,
                messages: [{
                    senderId:  'system',
                    text:      `Oferta enviada para "${item.titulo}"!\nValor oferecido: ${formatPreco(offerValue, {htmlGratis:false})} (preço anunciado: ${formatPreco(preco, {htmlGratis:false})})\nAguardando resposta do vendedor...`,
                    timestamp: new Date().toISOString()
                }]
            })
        });

        ordersCache.push(order);
        window.closeProductDetail();

        createPersistentNotification(`Oferta enviada para "${item.titulo}"!`, 'success');
        showToast('Oferta enviada ao vendedor!', 'success');
        window.renderOrderManagement('buyer');

    } catch (err) {
        console.error(err);
        showToast('Erro ao enviar oferta: ' + (err.message || 'Tente novamente.'), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
};

// ============================================
// TEMA (função global para o switch mobile)
// ============================================

window.toggleTema = function() {
    document.body.classList.toggle('dark-theme');
    const modoEscuro = document.body.classList.contains('dark-theme');
    localStorage.setItem('modoEscuro', modoEscuro);
    
    const themeSwitch = document.getElementById('themeSwitchMobile');
    if (themeSwitch) themeSwitch.checked = modoEscuro;

    const desktopIcon = document.querySelector('#themeToggle i');
    if (desktopIcon) {
        desktopIcon.className = modoEscuro ? 'bi bi-sun' : 'bi bi-moon-stars';
    }
};

// ============================================
// INICIALIZAÇÃO
// ============================================

/**
 * Mede a altura real do header (que muda de tamanho conforme a tela/estado)
 * e guarda numa CSS var — usada pra encaixar a sidebar fixa do Painel Admin
 * exatamente embaixo do header, em qualquer resolução.
 */
function syncHeaderHeightVar() {
    const header = document.querySelector('.header-main');
    if (header) {
        document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`);
    }
}

function bootstrapApp() {
    // Aplicar tema salvo
    if (localStorage.getItem('modoEscuro') === 'true') {
        document.body.classList.add('dark-theme');
    }

    syncHeaderHeightVar();
    window.addEventListener('resize', syncHeaderHeightVar);
    // O header pode mudar de altura ao logar/deslogar (linha extra de endereço, etc.)
    new ResizeObserver(syncHeaderHeightVar).observe(document.querySelector('.header-main'));

    populateFilterEstados();
    populateEstadoSelect('v2CadUF');
    populateEstadoSelect('editEstado');
    detectGuestRegion();
    window.startPresenceHeartbeat();

    // Anunciar
    document.getElementById('announceForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user  = getSavedUser();
        if (!user) { showToast('Faça login!', 'warning'); return; }

        // Validação de campos obrigatórios e numéricos
        const btn  = e.target.querySelector('button[type="submit"]');
        const orig = btn.textContent;

        const titulo = document.getElementById('prodTitle').value.trim();
        if (!titulo) { showToast('O título do anúncio é obrigatório.', 'warning'); return; }

        const condicao = document.getElementById('prodCondition').value;
        if (!condicao) { showToast('Selecione a condição do produto.', 'warning'); return; }

        const descricao = document.getElementById('prodDescription').value.trim();
        if (!descricao) { showToast('A descrição do produto é obrigatória.', 'warning'); return; }

        const precoInput = document.getElementById('prodPrice').value;
        const preco = parseFloat(precoInput);
        const PRECO_MAXIMO = 10000000; // R$ 10 milhões - teto sensato pra evitar erro de digitação (ex: zeros a mais)
        if (isNaN(preco) || preco < 0) { showToast('Preço inválido! Digite um número maior ou igual a zero.', 'warning'); return; }
        if (preco > PRECO_MAXIMO) { showToast(`Preço muito alto! O valor máximo permitido é R$ ${PRECO_MAXIMO.toLocaleString('pt-BR')}. Confira se não digitou zeros a mais.`, 'warning'); return; }

        const quantidadeInput = document.getElementById('prodQuantity').value;
        const quantidade = parseInt(quantidadeInput);
        if (isNaN(quantidade) || quantidade < 1) { showToast('Quantidade inválida! Digite um número inteiro maior ou igual a um.', 'warning'); return; }

        // Preço original (para oferta com desconto, igual Mercado Livre) - campo opcional
        const precoOriginalInput = document.getElementById('prodPrecoOriginal').value;
        let precoOriginal = null;
        if (precoOriginalInput.trim() !== '') {
            precoOriginal = parseFloat(precoOriginalInput);
            if (isNaN(precoOriginal) || precoOriginal < 0) { showToast('Preço original inválido! Digite um número maior ou igual a zero.', 'warning'); return; }
            if (precoOriginal > PRECO_MAXIMO) { showToast(`Preço original muito alto! O valor máximo permitido é R$ ${PRECO_MAXIMO.toLocaleString('pt-BR')}.`, 'warning'); return; }
            if (precoOriginal <= preco) { showToast('O preço original deve ser maior que o preço com desconto para virar uma oferta.', 'warning'); return; }
        }

        const categoria = document.getElementById('prodCategory').value.trim();
        if (!categoria) { showToast('A categoria do produto é obrigatória.', 'warning'); return; }

        try {
            btn.disabled    = true;
            btn.textContent = 'Publicando...';
                
            const now = new Date().toISOString();
            const editingId  = e.target.dataset.editingId;
            const isAdminEdit = e.target.dataset.adminEdit === 'true';
            // Quando é o admin editando o anúncio de outra pessoa, o produto pode não
            // estar no cache normal da grade (que é escopado à categoria/busca atual),
            // então também procura no cache carregado pelo painel administrativo.
            const produtoOriginal = editingId
                ? (allProductsCache.find(p => p.id === editingId) || window._adminProductsCache?.find(p => p.id === editingId))
                : null;

            let imgsArray = [];
            for (let n = 1; n <= 3; n++) {
                const lInput = document.getElementById(`prodLink${n}`);
                if (lInput && lInput.value.trim()) {
                    const rawUrl = lInput.value.trim();
                    const normalized = normalizeImageUrl(rawUrl);
                    imgsArray.push(normalized);
                    lInput.value = normalized; // Atualiza visualmente o campo para o link normalizado
                }
            }

            if (imgsArray.length === 0 && editingId) {
                imgsArray = safeParseImages(produtoOriginal?.img);
            }

            // OFERTA AUTOMÁTICA (estilo Mercado Livre): se o vendedor está editando
            // um anúncio já existente e simplesmente baixou o preço, sem preencher
            // manualmente o campo "preço original", usamos o preço anterior como
            // preço "de" automaticamente — o anúncio já nasce como oferta, sem o
            // vendedor precisar digitar nada a mais.
            if (editingId && precoOriginal === null) {
                const precoAnterior = produtoOriginal ? parseFloat(produtoOriginal.preco) : null;
                if (precoAnterior && preco < precoAnterior) {
                    precoOriginal = precoAnterior;
                }
            }

            const productData = {
                titulo:       document.getElementById('prodTitle').value,
                descricao:    condicao ? `[${condicao}] ${descricao}` : descricao,
                preco:        preco, // Usar o valor validado
                preco_original: precoOriginal, // null se não houver oferta/desconto
                quantidade:   quantidade, // Usar o valor validado
                categoria:    document.getElementById('prodCategory').value, // Usar o valor validado
                img:          JSON.stringify(imgsArray),
                // Se for o admin editando o anúncio de outra pessoa, mantém o vendedor
                // e a cidade originais — não deve "roubar" o anúncio pro admin.
                loja:         isAdminEdit ? (produtoOriginal?.loja || user.nome)       : user.nome,
                vendedor_id:  isAdminEdit ? (produtoOriginal?.vendedor_id || user.id)  : user.id,
                cidade:       isAdminEdit ? (produtoOriginal?.cidade || '')            : (user.cidade || ''),
                // Padronizando para minúsculo para bater com o Postgres/Supabase
                realizaentrega: document.getElementById('prodDelivery')?.checked ?? true,
                updated_at:   now
            };

            if (editingId) {
                await supabaseFetch(`products?id=eq.${editingId}`, { method: 'PATCH', body: JSON.stringify(productData) });
            } else {
                productData.id = `prod_${Date.now()}`;
                productData.created_at = now;
                await supabaseFetch('products', { method: 'POST', body: JSON.stringify(productData) });
            }

            bootstrap.Modal.getInstance(document.getElementById('announceModal'))?.hide();
            e.target.reset();
            if (isAdminEdit) {
                delete e.target.dataset.adminEdit;
                createPersistentNotification('Anúncio atualizado pelo administrador.', 'success');
                window.renderAdminPanel();
            } else {
                await loadPage(undefined, true);
                createPersistentNotification(editingId ? 'Seu anúncio foi atualizado.' : 'Novo anúncio publicado com sucesso!', 'success');
            }
        } catch (err) {
            console.error(err);
            // Mostra o erro real retornado pelo banco (ex: coluna faltando ou tipo errado)
            const errorMsg = err.message || (typeof err === 'string' ? err : 'Verifique os campos e a conexão.');
            showToast(`Erro ao publicar: ${errorMsg}`, 'error');
        } finally {
            btn.disabled    = false;
            btn.textContent = orig;
        }
    });
    // Perfil
    document.getElementById('supportRequestModal')?.addEventListener('hidden.bs.modal', () => {
        stopSupportChatPolling();
        document.body.classList.remove('support-chat-fullscreen');
    });

    document.getElementById('profileEditForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = getSavedUser();
        if (!user) return;

        // Captura apenas o valor do campo de link (URL)
        const novoAvatarRaw = document.getElementById('editAvatarLink')?.value.trim();
        const novoAvatar = normalizeImageUrl(novoAvatarRaw);
        if (document.getElementById('editAvatarLink')) {
            document.getElementById('editAvatarLink').value = novoAvatar;
        }

        // Junta Rua/Número/Bairro de volta no mesmo formato usado no cadastro
        // ("Rua X, 123 - Bairro Y"), já que o banco guarda tudo numa única coluna.
        const rua     = document.getElementById('editRua').value.trim();
        const numero  = document.getElementById('editNumero').value.trim();
        const bairro  = document.getElementById('editBairro').value.trim();
        const enderecoCompleto = [rua, numero].filter(Boolean).join(', ') + (bairro ? ` - ${bairro}` : '');

        const novoTipo = user.tipo === 'ADMIN' ? 'ADMIN' : (document.getElementById('editTipo')?.value || user.tipo);

        // Rebaixar de Vendedor pra Cliente apaga tudo que ele publicou (produtos,
        // pedidos como vendedor e as conversas ligadas a eles) — ação destrutiva,
        // então pede confirmação explícita antes de continuar.
        if (user.tipo === 'VENDEDOR' && novoTipo === 'CLIENTE') {
            const confirmado = confirm(
                'Mudar para Cliente vai APAGAR PERMANENTEMENTE todos os seus anúncios ' +
                'publicados, os pedidos de venda e as conversas ligadas a eles.\n\n' +
                'Essa ação não pode ser desfeita. Deseja continuar?'
            );
            if (!confirmado) {
                document.getElementById('editTipo').value = 'VENDEDOR'; // reverte a seleção
                return;
            }
            const btnSubmit = document.querySelector('#profileEditForm button[type="submit"]');
            if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = 'Removendo anúncios...'; }
            try {
                await excluirDadosDeVendedor(user.id);
            } catch (err) {
                console.error('Erro ao remover dados de vendedor:', err);
                showToast('Erro ao remover seus anúncios. Tente novamente.', 'error');
                if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'SALVAR ALTERAÇÕES'; }
                return;
            }
            if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'SALVAR ALTERAÇÕES'; }
        }

        const updated = {
            ...user,
            nome:      document.getElementById('editNome').value.trim(),
            telefone:  document.getElementById('editTelefone')?.value.replace(/\D/g, '') || '',
            cep:       document.getElementById('editCEP')?.value.replace(/\D/g, '') || '',
            endereco:  enderecoCompleto,
            cidade:    document.getElementById('editCidade').value.trim(),
            estado:    document.getElementById('editEstado').value,
            pagamento: document.getElementById('editPagamento').value,
            tipo:      novoTipo,
            avatar:    JSON.stringify([
                normalizeImageUrl(document.getElementById('editAvatarLink')?.value.trim()) || '',
                normalizeImageUrl(document.getElementById('editBannerLink')?.value.trim()) || ''
            ].filter(Boolean))
        };
        // Se ambos estiverem vazios, mantém o avatar original
        if (JSON.parse(updated.avatar).length === 0) {
            updated.avatar = user.avatar;
        }

        try {
            await supabaseFetch(`users?id=eq.${user.id}`, { method: 'PATCH', body: JSON.stringify(updated) });
        } catch (err) {
            console.error('Erro ao salvar perfil:', err);
            showToast('Erro ao salvar. Verifique se a coluna "banner" existe no banco.', 'error');
            if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = 'SALVAR ALTERAÇÕES'; }
            return;
        }
        localStorage.setItem('electroUser', JSON.stringify(updated));
        window.hideProfileEditScreen();
        updateUI();
        createPersistentNotification('Suas informações de perfil foram atualizadas.', 'success');

        // Se o tipo de conta mudou, recarrega a página pra garantir que todo o
        // menu/navegação (que depende do papel do usuário) se ajuste corretamente.
        if (novoTipo !== user.tipo) {
            const tipoLabel = novoTipo === 'VENDEDOR' ? 'Vendedor' : (novoTipo === 'ADMIN' ? 'Administrador (simulação)' : 'Cliente');
            showToast(`Sua conta agora é do tipo ${tipoLabel}.`, 'success');
            setTimeout(() => location.reload(), 900);
        }
    });

    // Busca com debounce
    let searchTimeout;
    const searchInput = document.getElementById('searchInput');
    const btnSearch   = document.getElementById('btnSearch');

    // Ponto único da busca do topo: admin nunca deve cair na vitrine de cliente vendo
    // produtos sem relação nenhuma — pra ele, buscar filtra as Publicações do próprio painel.
    function performTopSearch(term) {
        const user = getEffectiveUser();
        if (user?.tipo === 'ADMIN') {
            window.adminSearchProducts(term);
        } else {
            loadPage(term || 'eletronicos');
        }
    }

    btnSearch?.addEventListener('click', () => {
        performTopSearch(searchInput?.value?.trim());
    });

    searchInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performTopSearch(e.target.value.trim());
    });

    // Busca ao digitar (debounce 500ms)
    searchInput?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const val = e.target.value.trim();
        if (val.length >= 3) {
            searchTimeout = setTimeout(() => performTopSearch(val), 500);
        } else if (val.length === 0) {
            performTopSearch('');
        }
    });

    // Tema desktop
    document.getElementById('themeToggle')?.addEventListener('click', window.toggleTema);

    // Pausa o polling quando a aba fica em segundo plano e retoma ao voltar (economiza requisições/bateria)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopChatPolling();
        } else if (currentChat && !document.getElementById('waChatActive')?.classList.contains('d-none')) {
            startChatPolling(currentChat);
        }
    });

    // Navegação por hash (#/produto/xxx ou #/vendedor/yyy)
    function navigateByHash() {
        const prodMatch = window.location.hash.match(/^#\/produto\/(.+)/);
        if (prodMatch) {
            const pid = prodMatch[1];
            // Aguarda o cache de produtos carregar antes de abrir
            const tryOpen = () => {
                if (allProductsCache.find(x => x.id == pid || x.id === pid)) {
                    window.showDetail(pid);
                } else {
                    // Tenta buscar o produto específico
                    supabaseFetch(`products?id=eq.${encodeURIComponent(pid)}&limit=1`).then(rows => {
                        if (rows && rows.length > 0) {
                            if (!allProductsCache.find(x => x.id == rows[0].id)) allProductsCache.push(rows[0]);
                            window.showDetail(rows[0].id);
                        } else {
                            showToast('Produto não encontrado.', 'error');
                            history.replaceState(null, '', window.location.pathname + window.location.search);
                        }
                    });
                }
            };
            if (allProductsCache.length > 0) {
                tryOpen();
            } else {
                // Espera o loadPage terminar
                const check = setInterval(() => {
                    if (allProductsCache.length > 0) { clearInterval(check); tryOpen(); }
                }, 100);
                setTimeout(() => clearInterval(check), 10000);
            }
            return;
        }

        const sellerMatch = window.location.hash.match(/^#\/vendedor\/(.+)/);
        if (sellerMatch) {
            const sid = sellerMatch[1];
            // Abre o perfil do vendedor direto, sem recarregar o site
            window.showSellerProfile(sid, '');
        }
    }
    window.addEventListener('hashchange', navigateByHash);
    // Verifica hash na inicialização (depois que o app carregar)
    setTimeout(navigateByHash, 500);

    // Init
    updateUI();
    renderCart();
    window.setupAutoComplete();

    const user = getEffectiveUser();
    if (user?.tipo === 'VENDEDOR') {
        window.renderSellerPanel();
    } else if (user?.tipo === 'ADMIN') {
        window.renderAdminPanel();
    } else {
        loadPage();
    }
}

// window.CONFIG e carregado de forma assincrona (fetch em /api/config ou,
// no dev local com Live Server, fallback em js/config.local.js — ver o
// loader inline em index.html). Por isso esperamos a Promise
// window._configReady terminar antes de inicializar o app, garantindo que
// CONFIG.SUPABASE_URL/KEY ja estejam definidos quando o app comecar a
// fazer chamadas pro Supabase. Se a config falhar, o proprio loader ja
// mostra uma tela de erro, entao nem tentamos inicializar o app.
(function startWhenReady() {
    function start() {
        Promise.resolve(window._configReady).then(function () {
            if (window.CONFIG) bootstrapApp();
        });
    }
    if (document.readyState !== 'loading') {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start);
    }
})();
// OBS: esse bloco de inicialização estava duplicado no final do arquivo,
// fazendo bootstrapApp() (e todos os listeners que ele registra, incluindo
// o de publicar/editar produto) rodar duas vezes — por isso os produtos
// saíam duplicados ao publicar. A segunda cópia foi removida.

// ============================================
// UTILITÁRIOS
// ============================================

/**
 * Utilitário para extrair links de imagens de forma robusta.
 * Aceita Array, String JSON ou link direto.
 */
function safeParseImages(imgData) {
    if (!imgData) return [];
    let arr = [];
    if (Array.isArray(imgData)) {
        arr = imgData.filter(Boolean);
    } else if (typeof imgData === 'string') {
        const trimmed = imgData.trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            try {
                const parsed = JSON.parse(trimmed);
                arr = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
            } catch (e) {
                arr = [trimmed].filter(Boolean);
            }
        } else {
            arr = [trimmed].filter(Boolean);
        }
    }
    // Retorna os links normalizados (Imgur direto)
    return arr.map(normalizeImageUrl);
}

/**
 * Converte links do Imgur (página ou galeria) em links diretos (i.imgur.com).
 * Ex: "https://imgur.com/abc" -> "https://i.imgur.com/abc.jpg"
 */
/**
 * Remove o número da casa de um endereço salvo no formato "Rua, Número - Bairro",
 * deixando só "Rua - Bairro". Usado para mostrar a região de entrega sem
 * expor o número exato da residência do vendedor.
 */
function enderecoSemNumero(endereco) {
    if (!endereco) return '';
    const [ruaNumero, ...resto] = endereco.split(' - ');
    const rua = (ruaNumero || '').split(',')[0].trim(); // descarta o número, mantém a rua
    const bairro = resto.join(' - ').trim();
    return [rua, bairro].filter(Boolean).join(' - ');
}

function normalizeImageUrl(url) {
    if (!url || typeof url !== 'string') return url;
    const trimmed = url.trim();

    // Se for link do Imgur, forçamos o formato direto da CDN
    if (trimmed.includes('imgur.com')) {
        // Captura o ID da imagem ignorando pastas como /a/ ou /gallery/ e extensões já existentes
        const match = trimmed.match(/imgur\.com\/(?:gallery\/|a\/)?([a-zA-Z0-9]+)/);
        if (match) {
            // Usar .jpg é universal no Imgur para links diretos i.imgur.com/ID.jpg
            return `https://i.imgur.com/${match[1]}.jpg`;
        }
    }
    return trimmed;
}

/** Abre site externo para upload de imagens */
window.abrirUploadExterno = function() {
    window.open('https://imgur.com/upload', '_blank');
};

window.uploadProfilePhoto = async function(input) {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const link = document.getElementById('editAvatarLink');
    if (link) link.value = 'Enviando...';
    const url = await uploadImageToHost(file);
    if (link) link.value = url || '';
    if (url) showToast('Foto enviada! Clique em SALVAR.', 'success');
};

window.uploadProfileBanner = async function(input) {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const link = document.getElementById('editBannerLink');
    if (link) link.value = 'Enviando...';
    const url = await uploadImageToHost(file);
    if (link) link.value = url || '';
    if (url) showToast('Banner enviado! Clique em SALVAR.', 'success');
};

window.uploadCadPhoto = async function(input) {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const link = document.getElementById('v2CadAvatarLink');
    if (link) link.value = 'Enviando...';
    const url = await uploadImageToHost(file);
    if (link) link.value = url || '';
    if (url) showToast('Foto enviada!', 'success');
};

window.uploadCadBanner = async function(input) {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const link = document.getElementById('v2CadBannerLink');
    if (link) link.value = 'Enviando...';
    const url = await uploadImageToHost(file);
    if (link) link.value = url || '';
    if (url) showToast('Banner enviado!', 'success');
};

window.uploadProdPhoto = async function(input, n) {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const link = document.getElementById('prodLink' + n);
    if (link) link.value = 'Enviando...';
    const url = await uploadImageToHost(file);
    if (link) link.value = url || '';
    if (url) showToast('Imagem ' + n + ' enviada!', 'success');
};

/** Faz upload de um arquivo de imagem no Imgur (anonymous) e retorna a URL
 *  direta. Não usa Base64 e não exige cadastro seu (usa Client ID padrão ou
 *  o configurado em IMGUR_CLIENT_ID). */
async function uploadImageToHost(file) {
    if (!file) return null;
    const clientId = window.CONFIG?.IMGUR_CLIENT_ID || window.CONFIG_LOCAL_FALLBACK?.IMGUR_CLIENT_ID || '546c25a59c58ad7';
    try {
        const fd = new FormData();
        fd.append('image', file, file.name || 'imagem.jpg');
        const res = await fetch('https://api.imgur.com/3/image', {
            method: 'POST',
            headers: { Authorization: `Client-ID ${clientId}` },
            body: fd
        });
        const json = await res.json();
        if (json?.success && json?.data?.link) return json.data.link;
        showToast('Falha ao enviar imagem no Imgur.', 'error');
        return null;
    } catch (e) {
        showToast('Erro ao enviar imagem no Imgur.', 'error');
        return null;
    }
}

/** Lê os arquivos selecionados e preenche os campos de foto (caFoto0..3),
 *  pulando os já preenchidos. Mostra preview e estado de carregamento. */
window.handleFotoFiles = async function(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    let slot = 0;
    // acha o primeiro slot vazio
    while (slot <= 3 && document.getElementById(`caFoto${slot}`).value.trim()) slot++;
    for (const file of files) {
        if (slot > 3) break;
        const field = document.getElementById(`caFoto${slot}`);
        const preview = document.getElementById(`caFotoPreview${slot}`);
        field.value = 'Enviando...';
        const url = await uploadImageToHost(file);
        if (url) {
            field.value = url;
            if (preview) preview.style.backgroundImage = `url('${url}')`;
        } else {
            field.value = '';
            showToast('Falha ao enviar imagem.', 'error');
        }
        slot++;
    }
    input.value = '';
};

/**
 * Extrai foto de perfil e banner do campo avatar (que pode ser string única
 * ou array JSON com [avatarUrl, bannerUrl]).
 */
function splitAvatarField(avatar) {
    const arr = safeParseImages(avatar);
    return { avatar: arr[0] || '', banner: arr[1] || '' };
}

// ============================================
// SISTEMA DE AUTOMAÇÃO - CPF, CEP E VALIDAÇÕES
// ============================================

/** Formata CPF: 000.000.000-00 */
function formatarCPF(input) {
    let v = input.value.replace(/\D/g, '');
    if (v.length > 11) v = v.substring(0, 11);
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    if (input.value !== v) input.value = v; // Evita loop de input
    return v.replace(/\D/g, '');
}

/** Valida dígitos verificadores do CPF */
function validarCPF(cpf) {
    cpf = cpf.replace(/\D/g, '');
    // Validação matemática real dos dígitos verificadores (sem API externa).
    if (cpf.length !== 11) return false;
    // Rejeita CPFs com todos os dígitos iguais (ex: 111.111.111-11).
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
    let resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== parseInt(cpf[9])) return false;

    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== parseInt(cpf[10])) return false;

    return true;
}

/** Formata CEP: 00000-000 */
function formatarCEP(input) {
    let valor = input.value.replace(/\D/g, '');
    if (valor.length > 8) valor = valor.substring(0, 8);
    valor = valor.replace(/(\d{5})(\d)/, '$1-$2');
    input.value = valor;
    return valor.replace(/\D/g, '');
}

/** Formata Telefone: (00) 00000-0000 ou (00) 0000-0000 */
function formatarTelefone(input) {
    let v = input.value.replace(/\D/g, '');
    if (v.length > 11) v = v.substring(0, 11);
    if (v.length > 10) {
        v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
    } else if (v.length > 5) {
        v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
    } else if (v.length > 2) {
        v = v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
    } else if (v.length > 0) {
        v = v.replace(/(\d{0,2})/, '($1');
    }
    if (input.value !== v) input.value = v;
    return v.replace(/\D/g, '');
}

/** Busca endereço pelo CEP (ViaCEP) */
async function buscarEnderecoPorCep(cep) {
    cep = cep.replace(/\D/g, '');
    if (cep.length !== 8) return null;
    try {
        const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await res.json();
        if (data.erro) { showToast('CEP não encontrado!', 'error'); return null; }
        return { logradouro: data.logradouro, bairro: data.bairro, cidade: data.localidade, estado: data.uf };
    } catch { showToast('Erro ao buscar CEP.', 'error'); return null; }
}

/** Inferência de estado pelo 9º dígito do CPF */
function buscarEstadoPorCPF(cpf) {
    cpf = cpf.replace(/\D/g, '');
    if (cpf.length < 9) return null;
    const nono = parseInt(cpf.charAt(8));
    const map = { 0:'RS', 1:'DF', 2:'AM', 3:'CE', 4:'PE', 5:'BA', 6:'MG', 7:'RJ', 8:'SP', 9:'PR' };
    return map[nono] || 'SP';
}

/** Configura Listeners de Automação */
function setupAutoComplete() {
    // CPF Automático
    ['v2CadCPF', 'cadastroCPF', 'editCPF'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => formatarCPF(e.target));
        el.addEventListener('blur', async (e) => {
            const clean = e.target.value.replace(/\D/g, '');
            
            // Limpa estados se o campo for esvaziado
            if (!clean) {
                el.classList.remove('cpf-invalido', 'cpf-valido');
                return;
            }
            
            if (!validarCPF(clean)) {
                el.classList.add('cpf-invalido');
                el.classList.remove('cpf-valido');
                showToast('CPF Inválido!', 'error', 2000);
            } else {
                el.classList.add('cpf-valido');
                el.classList.remove('cpf-invalido');
                const uf = buscarEstadoPorCPF(clean);
                const ufField = document.getElementById('v2CadUF') || document.getElementById('cadastroEstado') || document.getElementById('editEstado');
                if (ufField && !ufField.value) {
                    ufField.value = uf;
                    showToast(`Estado ${uf} detectado pelo CPF`, 'info', 2000);
                }
            }
        });
    });

    // Telefone Automático
    ['v2CadTelefone', 'editTelefone'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => formatarTelefone(e.target));
    });

    // CEP Automático
    ['v2CadCEP', 'cadastroCEP', 'editCEP'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => formatarCEP(e.target));
        
        const handler = async () => {
            const clean = el.value.replace(/\D/g, '');
            if (clean.length !== 8) return;
            
            el.classList.add('buscando-cep');
            const data = await buscarEnderecoPorCep(clean);
            el.classList.remove('buscando-cep');
            
            if (data) {
                el.classList.add('cep-valido');
                preencherCamposEndereco(data, id);
            }
        };

        el.addEventListener('blur', handler);
        el.addEventListener('keypress', (e) => e.key === 'Enter' && (e.preventDefault(), handler()));
    });
}

/** Distribui dados de endereço nos campos corretos */
function preencherCamposEndereco(data, sourceId) {
    if (sourceId === 'v2CadCEP') {
        document.getElementById('v2CadEnd').value = data.logradouro;
        document.getElementById('v2CadBairro').value = data.bairro || '';
        document.getElementById('v2CadCid').value = data.cidade;
        document.getElementById('v2CadUF').value = data.estado;
        document.getElementById('v2CadNum')?.focus();
    } else {
        const end = document.getElementById('cadastroEndereco') || document.getElementById('editEndereco');
        const cid = document.getElementById('cadastroCidade') || document.getElementById('editCidade');
        const est = document.getElementById('cadastroEstado') || document.getElementById('editEstado');
        
        if (end) end.value = data.logradouro + (data.bairro ? ` - ${data.bairro}` : '');
        if (cid) cid.value = data.cidade;
        if (est) est.value = data.estado;
    }
    showToast('Endereço preenchido via CEP!', 'success', 2000);
}

// ============================================
// EXPORTS GLOBAIS
// ============================================

window.loadPage          = loadPage;
window.applyFilters      = applyFilters;
window.clearFilters      = clearFilters;
window.renderCart        = renderCart;
window.showToast         = showToast;
window.logout            = () => {
    localStorage.removeItem('electroUser');
    showToast('Sessão encerrada com sucesso', 'info', 2000);
    setTimeout(() => location.reload(), 600);
};

window.showProfileEdit = () => {
    const user = getSavedUser();
    if (!user) { window.showAuthScreen('login'); return; }
    
    const editNome = document.getElementById('editNome');
    if (editNome) editNome.value = user.nome || '';

    document.getElementById('editEmail').value    = user.email    || '';
    document.getElementById('editCPF').value      = user.cpf      || '';
    document.getElementById('editTelefone').value = user.telefone || '';
    document.getElementById('editCEP').value      = user.cep      || '';

    // O endereço é salvo como uma string única ("Rua X, 123 - Bairro Y"), então
    // aqui a gente tenta separar de volta em Rua/Número/Bairro pra edição mais
    // organizada — se não encaixar nesse padrão (endereços antigos digitados
    // livremente), cai tudo no campo "Rua" mesmo, sem perder informação.
    const enderecoMatch = (user.endereco || '').match(/^(.*?),\s*([^-]*?)\s*-\s*(.*)$/);
    if (enderecoMatch) {
        document.getElementById('editRua').value     = enderecoMatch[1].trim();
        document.getElementById('editNumero').value  = enderecoMatch[2].trim();
        document.getElementById('editBairro').value  = enderecoMatch[3].trim();
    } else {
        document.getElementById('editRua').value    = user.endereco || '';
        document.getElementById('editNumero').value = '';
        document.getElementById('editBairro').value = '';
    }

    document.getElementById('editCidade').value   = user.cidade   || '';
    populateEstadoSelect('editEstado');
    document.getElementById('editEstado').value   = user.estado   || '';
    document.getElementById('editPagamento').value = user.pagamento || 'pix';
    const tipoSelect = document.getElementById('editTipo');
    if (tipoSelect) tipoSelect.value = user.tipo === 'VENDEDOR' ? 'VENDEDOR' : 'CLIENTE';
    // Administrador de verdade não troca o próprio tipo por aqui (isso mudaria
    // o registro no banco); ele usa a Simulação de Papel no Painel Admin, que
    // não altera nada — só muda o que aparece na tela.
    document.getElementById('editTipoWrap')?.classList.toggle('d-none', user.tipo === 'ADMIN');
    document.getElementById('editTipoAdminNote')?.classList.toggle('d-none', user.tipo !== 'ADMIN');

    const linkInput = document.getElementById('editAvatarLink');
    if (linkInput) {
        const { avatar: avatarUrl } = splitAvatarField(user.avatar);
        linkInput.value = avatarUrl;
    }

    const bannerInput = document.getElementById('editBannerLink');
    if (bannerInput) {
        const { banner: bannerUrl } = splitAvatarField(user.avatar);
        bannerInput.value = bannerUrl;
    }

    const preview = document.getElementById('profilePreview');
    if (preview) {
        const { avatar: avatarUrl } = splitAvatarField(user.avatar);
        preview.src = avatarUrl || 'https://placehold.co/100';
    }

    document.getElementById('profileLinksName').textContent = user.nome || 'Meu Perfil';
    const badgeEl = document.getElementById('profileLinksTypeBadge');
    badgeEl.textContent =
        user.tipo === 'ADMIN' ? 'Administrador' : (user.tipo === 'VENDEDOR' ? 'Vendedor' : 'Cliente');
    badgeEl.className = 'profile-links-badge tipo-' + (user.tipo === 'ADMIN' ? 'admin' : (user.tipo === 'VENDEDOR' ? 'vendedor' : 'cliente'));

    // Marca campos já preenchidos (label flutuante sobe)
    document.querySelectorAll('#profileEditForm .ml-field input, #profileEditForm .ml-field select').forEach(el => {
        if (el.value && el.value.trim() !== '') el.closest('.ml-field')?.classList.add('filled');
    });

    document.getElementById('profileEditScreen').classList.remove('d-none');
    document.body.style.overflow = 'hidden';

    // Banner como fundo da tela de edição
    const screen = document.getElementById('profileEditScreen');
    const { banner: editBanner } = splitAvatarField(user.avatar);
    if (screen) {
        if (editBanner) {
            screen.style.setProperty('--banner-bg', `url('${editBanner}')`);
            screen.classList.add('has-banner');
        } else {
            screen.style.removeProperty('--banner-bg');
            screen.classList.remove('has-banner');
        }
    }
};

window.hideProfileEditScreen = function() {
    document.getElementById('profileEditScreen').classList.add('d-none');
    document.body.style.overflow = '';
};

/**
 * Abre/fecha cada seção em pílula da tela de perfil (estilo link-in-bio),
 * uma de cada vez pra manter a tela organizada.
 */
window.toggleProfileSection = function(headerBtn) {
    const section = headerBtn.closest('.profile-link-section');
    const wasOpen = section.classList.contains('open');
    document.querySelectorAll('.profile-link-section.open').forEach(s => s.classList.remove('open'));
    if (!wasOpen) section.classList.add('open');
};

/**
 * Apaga tudo que um vendedor publicou/vendeu: primeiro as conversas (chats),
 * depois os pedidos onde ele era o vendedor, e por fim os próprios anúncios.
 * A ordem importa por causa de restrições de chave estrangeira no banco.
 * Usado ao rebaixar a conta de Vendedor pra Cliente, e também na exclusão total da conta.
 */
async function excluirDadosDeVendedor(userId) {
    // 1) Pedidos em que este usuário era o vendedor
    const ordersComoVendedor = await supabaseFetch(`orders?select=id&seller_id=eq.${userId}`);
    const orderIds = (ordersComoVendedor || []).map(o => o.id);

    // 2) Chats ligados a esses pedidos (precisam ser removidos antes dos pedidos)
    if (orderIds.length) {
        await supabaseFetch(`chats?order_id=in.(${orderIds.join(',')})`, { method: 'DELETE' });
    }

    // 3) Os pedidos em si
    if (orderIds.length) {
        await supabaseFetch(`orders?seller_id=eq.${userId}`, { method: 'DELETE' });
    }

    // 4) Os anúncios publicados
    await supabaseFetch(`products?vendedor_id=eq.${userId}`, { method: 'DELETE' });
}

/**
 * Exclusão total e definitiva da conta: remove anúncios/vendas (se for
 * vendedor), pedidos feitos como comprador, conversas ligadas a eles, e por
 * fim o próprio usuário. Pede confirmação dupla por ser irreversível.
 */
window.deleteAccount = async function() {
    const user = getSavedUser();
    if (!user) return;

    const confirmado = confirm(
        'Isso vai apagar sua conta e TUDO relacionado a ela: anúncios publicados, ' +
        'compras, vendas e conversas. Essa ação é IRREVERSÍVEL.\n\n' +
        'Deseja continuar?'
    );
    if (!confirmado) return;

    const digitado = prompt('Pra confirmar, digite EXCLUIR (em maiúsculas):');
    if (digitado !== 'EXCLUIR') {
        showToast('Exclusão cancelada.', 'info');
        return;
    }

    try {
        showToast('Excluindo sua conta...', 'info');

        // Anúncios, vendas e conversas de vendas (se for vendedor)
        await excluirDadosDeVendedor(user.id);

        // Pedidos feitos como comprador + conversas ligadas a eles
        const ordersComoComprador = await supabaseFetch(`orders?select=id&buyer_id=eq.${user.id}`);
        const buyerOrderIds = (ordersComoComprador || []).map(o => o.id);
        if (buyerOrderIds.length) {
            await supabaseFetch(`chats?order_id=in.(${buyerOrderIds.join(',')})`, { method: 'DELETE' });
            await supabaseFetch(`orders?buyer_id=eq.${user.id}`, { method: 'DELETE' });
        }

        // Por fim, o próprio usuário
        await supabaseFetch(`users?id=eq.${user.id}`, { method: 'DELETE' });

        localStorage.removeItem('electroUser');
        showToast('Conta excluída. Sentiremos sua falta!', 'success');
        setTimeout(() => location.reload(), 1200);
    } catch (err) {
        console.error('Erro ao excluir conta:', err);
        showToast('Erro ao excluir a conta. Tente novamente ou contate o suporte.', 'error');
    }
};

/** Busca o endereço pelo CEP digitado na edição de perfil e preenche Rua/Bairro/Cidade/Estado automaticamente */
window.buscarCepPerfil = async function() {
    const cepInput = document.getElementById('editCEP');
    const endereco = await buscarEnderecoPorCep(cepInput.value);
    if (!endereco) return;

    document.getElementById('editRua').value    = endereco.logradouro || document.getElementById('editRua').value;
    document.getElementById('editBairro').value = endereco.bairro     || document.getElementById('editBairro').value;
    document.getElementById('editCidade').value = endereco.cidade    || document.getElementById('editCidade').value;
    if (endereco.estado) {
        populateEstadoSelect('editEstado');
        document.getElementById('editEstado').value = endereco.estado;
    }
    showToast('Endereço encontrado!', 'success', 1500);
};

window.showAuthScreen = function(mode = 'login', autoCloseMenu = true) {
  const overlay = document.getElementById('authScreen');
  if (!overlay) return;
  overlay.classList.remove('d-none');
  window.toggleAuthMode(mode);
  window.mlCadGoToStep(1); // sempre reinicia o cadastro no passo 1 ao abrir a tela

  // Foca automaticamente o primeiro campo relevante, melhorando a usabilidade no desktop e no mobile
  setTimeout(() => {
      const targetId = mode === 'login' ? 'v2LogEmail' : 'v2CadNome';
      document.getElementById(targetId)?.focus();
  }, 350);
};

// ============================================
// PASSO A PASSO DO CADASTRO (ESTILO MERCADO LIVRE)
// ============================================

window.mlCadGoToStep = function(step) {
    document.querySelectorAll('[data-step-panel]').forEach(panel => {
        panel.classList.toggle('d-none', Number(panel.dataset.stepPanel) !== step);
    });
    document.querySelectorAll('[data-step-indicator]').forEach(indicator => {
        const indicatorStep = Number(indicator.dataset.stepIndicator);
        indicator.classList.toggle('active', indicatorStep === step);
        indicator.classList.toggle('done', indicatorStep < step);
    });
};

window.mlCadNextStep = function() {
    // Valida os campos obrigatórios do passo 1 antes de avançar
    const requiredIds = ['v2CadNome', 'v2CadCPF', 'v2CadTelefone', 'v2CadEmail', 'v2CadPass'];
    for (const id of requiredIds) {
        const el = document.getElementById(id);
        if (el && !el.reportValidity()) return;
    }
    // Valida CPF antes de avançar
    const cpfInput = document.getElementById('v2CadCPF');
    if (cpfInput) {
        const cpf = cpfInput.value.replace(/\D/g, '');
        if (!validarCPF(cpf)) {
            showToast('CPF inválido! Verifique os números.', 'error');
            cpfInput.focus();
            return;
        }
    }
    window.mlCadGoToStep(2);
    setTimeout(() => document.getElementById('v2CadCEP')?.focus(), 250);
};

window.mlCadPrevStep = function() {
    window.mlCadGoToStep(1);
};

window.forgotPassword = function(event) {
  event?.preventDefault();
  // Abre um chamado de suporte de recuperação de senha — cai direto na aba
  // "Suporte" do administrador, que passa a acompanhar e resolver o caso.
  window.openSupportRequestModal('esqueci_senha');
};

window.hideAuthScreen = function() {
  const overlay = document.getElementById('authScreen');
  if (overlay) overlay.classList.add('d-none');
};

window.toggleAuthMode = function(mode) {
    const body = document.body;
    
    // Remove classes anteriores
    body.classList.remove('sign-in-js', 'sign-up-js');
    
    // Força reflow para reiniciar animações
    void body.offsetWidth;
    
    // Aplica nova classe
    if (mode === 'login') {
        body.classList.add('sign-in-js');
    } else {
        body.classList.add('sign-up-js');
    }
};

window.toggleAuthPass = function(inputId, iconEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  if (iconEl) {
      iconEl.classList.toggle('bi-eye', !isPass);
      iconEl.classList.toggle('bi-eye-slash', isPass);
  }
  // Avisa o mascote Yeti (se existir) que a senha ficou visível/escondida,
  // para ele "espiar" com a mão em vez de tapar o rosto por completo.
  if (typeof window.yetiSetPeeking === 'function') {
      window.yetiSetPeeking(inputId, isPass); // isPass=true => senha acabou de ficar visível
  }
  // Mantém o foco no campo para o usuário continuar digitando
  input.focus();
};

// ============================================
// MASCOTE YETI ANIMADO (login)
// Inspirado em khuddus7815/yeti-login-page (Yeti Login, Darin S.)
// 100% JavaScript + CSS puro (sem GSAP/MorphSVGPlugin, que exige licença paga
// e não fica hospedado de graça no cdnjs — por isso a animação não rodava).
// ============================================
(function initYetiMascot() {
    const yetiRoot = document.getElementById('yetiMascot');
    const emailInput = document.getElementById('v2LogEmail');
    const passInput = document.getElementById('v2LogPass');
    if (!yetiRoot || !emailInput || !passInput) return;

    const $ = (sel) => yetiRoot.querySelector(sel);
    const eyeL = $('.eyeL'), eyeR = $('.eyeR'),
          nose = $('.nose'), mouth = $('.mouth'), face = $('.face');

    const EYE_MAX_X = 6, EYE_MAX_Y = 3;
    const NOSE_MAX_X = 4, NOSE_MAX_Y = 2;
    const MOUTH_MAX_X = 3;

    function look(ratio) {
        // ratio vai de -1 (olhando para a esquerda) a 1 (olhando para a direita)
        const r = Math.max(-1, Math.min(1, ratio));
        eyeL.style.transform = `translate(${(-r * EYE_MAX_X).toFixed(1)}px, ${EYE_MAX_Y}px)`;
        eyeR.style.transform = `translate(${(-r * EYE_MAX_X).toFixed(1)}px, ${EYE_MAX_Y}px)`;
        nose.style.transform = `translate(${(-r * NOSE_MAX_X).toFixed(1)}px, 0px)`;
        mouth.style.transform = `translate(${(-r * MOUTH_MAX_X).toFixed(1)}px, 0px)`;
        face.style.transform = `translate(${(-r * 2).toFixed(1)}px, 0px)`;
    }

    function resetFace() {
        eyeL.style.transform = 'translate(0px, 0px)';
        eyeR.style.transform = 'translate(0px, 0px)';
        nose.style.transform = 'translate(0px, 0px)';
        mouth.style.transform = 'translate(0px, 0px)';
        face.style.transform = 'translate(0px, 0px)';
    }

    function onEmailActivity() {
        const val = emailInput.value;
        const caret = emailInput.selectionStart || 0;
        if (val.length === 0) { resetFace(); return; }
        // posição relativa do cursor dentro do texto (0 a 1), convertida para -1..1
        const ratio = (caret / Math.max(val.length, 1)) * 2 - 1;
        look(ratio);
    }

    let passwordVisible = false; // true = usuário clicou no olho e a senha está em texto puro

    function applyPassState() {
        if (passwordVisible) {
            yetiRoot.classList.add('yeti-peeking');
            yetiRoot.classList.remove('yeti-covering');
        } else {
            yetiRoot.classList.add('yeti-covering');
            yetiRoot.classList.remove('yeti-peeking');
        }
    }
    function coverEyes() {
        applyPassState();
    }
    function uncoverEyes() {
        yetiRoot.classList.remove('yeti-covering');
        yetiRoot.classList.remove('yeti-peeking');
    }

    // Chamado pelo toggleAuthPass() quando o usuário clica no ícone do olho
    window.yetiSetPeeking = function(inputId, isNowVisible) {
        if (inputId !== 'v2LogPass') return;
        passwordVisible = isNowVisible;
        applyPassState();
    };

    emailInput.addEventListener('focus', onEmailActivity);
    emailInput.addEventListener('input', onEmailActivity);
    emailInput.addEventListener('keyup', onEmailActivity);
    emailInput.addEventListener('click', onEmailActivity);
    emailInput.addEventListener('blur', resetFace);
    passInput.addEventListener('focus', coverEyes);
    passInput.addEventListener('blur', () => { passwordVisible = false; uncoverEyes(); });

    // Sempre que a tela de login for reaberta, garante que o Yeti volta ao estado normal
    const authScreen = document.getElementById('authScreen');
    if (authScreen && 'MutationObserver' in window) {
        const observer = new MutationObserver(() => {
            if (!authScreen.classList.contains('d-none')) {
                passwordVisible = false;
                uncoverEyes();
                resetFace();
            }
        });
        observer.observe(authScreen, { attributes: true, attributeFilter: ['class'] });
    }
})();

// Formulários da tela de auth
document.addEventListener('submit', async (e) => {
    if (e.target.id === 'cadFormAnim') {
        e.preventDefault();
        const btn  = e.target.querySelector('button[type="submit"]');
        const orig = btn?.textContent;
        if (btn) { btn.disabled = true; btn.textContent = 'Criando conta...'; }

        const inputAvatar = document.getElementById('v2CadAvatarLink');
        let avatarUrl = '';

        if (inputAvatar && inputAvatar.value.trim()) {
            avatarUrl = normalizeImageUrl(inputAvatar.value.trim());
            inputAvatar.value = avatarUrl;
        }

        const inputBanner = document.getElementById('v2CadBannerLink');
        let bannerUrl = '';
        if (inputBanner && inputBanner.value.trim()) {
            bannerUrl = normalizeImageUrl(inputBanner.value.trim());
            inputBanner.value = bannerUrl;
        }

        const payload = {
            id:       crypto.randomUUID(),
            tipo:     document.getElementById('v2CadTipo').value,
            nome:     document.getElementById('v2CadNome').value,
            cpf:      document.getElementById('v2CadCPF').value.replace(/\D/g, ''),
            email:    document.getElementById('v2CadEmail').value,
            telefone: document.getElementById('v2CadTelefone').value.replace(/\D/g, ''),
            senha_hash: btoa(document.getElementById('v2CadPass').value),
            endereco: `${document.getElementById('v2CadEnd').value}, ${document.getElementById('v2CadNum').value} - ${document.getElementById('v2CadBairro').value}`,
            cep:      document.getElementById('v2CadCEP').value.replace(/\D/g, ''),
            cidade:   document.getElementById('v2CadCid').value,
            estado:   document.getElementById('v2CadUF').value,
            avatar:   JSON.stringify([avatarUrl, bannerUrl].filter(Boolean)),
            pagamento: document.getElementById('v2CadPagamento').value
        };

        // Validação de segurança do CPF antes de enviar ao banco
        if (!validarCPF(payload.cpf)) {
            showToast('CPF inválido! Por favor, verifique os números.', 'error');
            if (btn) { btn.disabled = false; btn.textContent = orig; }
            return;
        }

        try {
            await supabaseFetch('users', { method: 'POST', body: JSON.stringify(payload) });
            
            // LOGIN AUTOMÁTICO: Salva o novo usuário localmente
            localStorage.setItem('electroUser', JSON.stringify(payload));
            
            // Atualiza a interface imediatamente e fecha a tela de auth
            updateUI();
            window.hideAuthScreen();

            await createPersistentNotification(`Bem-vindo à ElectroMarket, ${payload.nome.split(' ')[0]}!`, 'success', payload.id);
            setTimeout(() => location.reload(), 1000);
        } catch (err) {
            console.error("Erro no cadastro:", err);
            // Mostra o motivo real devolvido pelo Supabase/Postgres (ex: coluna
            // inexistente, CPF/e-mail duplicado, campo obrigatório faltando etc.)
            // em vez de um texto genérico, para facilitar o diagnóstico.
            const motivo = err?.message || err?.hint || err?.details || err?.error_description || 'Verifique os dados e tente novamente.';
            showToast(`Erro no cadastro: ${motivo}`, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = orig; }
        }
    }

    if (e.target.id === 'loginFormAnimV2') {
        e.preventDefault();
        const btn  = e.target.querySelector('button[type="submit"]');
        const orig = btn?.textContent;
        if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }

        const emailInput = document.getElementById('v2LogEmail');
        const passInput  = document.getElementById('v2LogPass');
        emailInput?.classList.remove('input-error');
        passInput?.classList.remove('input-error');

        const identifier = emailInput.value.trim();
        const hash        = btoa(passInput.value);

        // Detecta se o usuário digitou e-mail ou telefone e monta a consulta certa
        const isEmail   = identifier.includes('@');
        const loginField = isEmail
            ? `email=eq.${encodeURIComponent(identifier)}`
            : `telefone=eq.${encodeURIComponent(identifier.replace(/\D/g, ''))}`;

        try {
            const users = await supabaseFetch(`users?select=*&${loginField}&senha_hash=eq.${hash}&limit=1`);
            if (users?.length) {
                localStorage.setItem('electroUser', JSON.stringify(users[0]));
                window.hideAuthScreen();
                
                await createPersistentNotification(`Novo acesso detectado em sua conta.`, 'info', users[0].id);
                setTimeout(() => location.reload(), 400);
            } else {
                showToast('E-mail/telefone ou senha incorretos.', 'error');
                emailInput?.classList.add('input-error');
                passInput?.classList.add('input-error');
                e.target.classList.add('form-shake');
                setTimeout(() => e.target.classList.remove('form-shake'), 400);
                passInput?.focus();
                passInput?.select();
            }
        } catch { showToast('Erro de conexão.', 'error'); }
        finally {
            if (btn) { btn.disabled = false; btn.textContent = orig; }
        }
    }
});

// Remove o destaque de erro assim que o usuário começa a corrigir os campos de login
document.getElementById('v2LogEmail')?.addEventListener('input', (e) => e.target.classList.remove('input-error'));
document.getElementById('v2LogPass')?.addEventListener('input', (e) => e.target.classList.remove('input-error'));

// ============================================
// FAVORITOS E HISTÓRICO
// ============================================

window.renderLikedProducts = () => {
    window.exitWaOrdersView();
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    document.getElementById('gridTitle').textContent = 'Seus Curtidos';
    renderGrid(allProductsCache.filter(p => likedProducts.includes(p.id)));
    window.closeMobileMenu();
};

window.renderAccessHistory = () => {
    window.exitWaOrdersView();
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    document.getElementById('gridTitle').textContent = 'Vistos Recentemente';
    const historyProducts = accessHistory.map(id => allProductsCache.find(p => p.id == id)).filter(Boolean);
    renderGrid(historyProducts);
    window.closeMobileMenu();
};

window.closeMobileMenu = () =>
    bootstrap.Offcanvas.getInstance(document.getElementById('mobileMenu'))?.hide();

// ============================================
// GESTÃO DE PEDIDOS
// ============================================

// ============================================
// AUTO-ATUALIZAÇÃO DA LISTA DE PEDIDOS (POLLING)
// ============================================

/**
 * Enquanto a lista "Minhas Compras" / "Minhas Vendas" estiver aberta, busca
 * pedidos atualizados periodicamente — assim, se a outra parte aceitar/recusar
 * um pedido enquanto esta tela está aberta, ela atualiza sozinha, sem precisar
 * sair e voltar pra essa aba manualmente.
 */

/** Inicia transcrição por voz usando Web Speech API */
window.startVoiceInput = function(inputId) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('Seu navegador não suporta transcrição por voz.', 'warning');
        return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const input = document.getElementById(inputId);
    if (!input) return;

    const btn = document.querySelector(`[data-voice-input="${inputId}"]`);
    if (btn) {
        btn.classList.add('recording');
        btn.innerHTML = '<i class="bi bi-mic-fill"></i>';
    }

    recognition.onresult = function(event) {
        const transcript = Array.from(event.results)
            .map(r => r[0].transcript)
            .join('');
        input.value = transcript;
        if (btn && event.results[event.results.length - 1].isFinal) {
            btn.classList.remove('recording');
            btn.innerHTML = '<i class="bi bi-mic"></i>';
            input.dispatchEvent(new Event('input'));
        }
    };

    recognition.onerror = function() {
        if (btn) { btn.classList.remove('recording'); btn.innerHTML = '<i class="bi bi-mic"></i>'; }
        showToast('Erro ao acessar o microfone.', 'error');
    };

    recognition.onend = function() {
        if (btn) { btn.classList.remove('recording'); btn.innerHTML = '<i class="bi bi-mic"></i>'; }
    };

    try { recognition.start(); } catch (e) {
        showToast('Permissão do microfone negada.', 'error');
    }
};

/**
 * Função unificada de renderização de bolha de mensagem — usada em TODOS os
 * chats (cliente↔vendedor, admin, suporte). Garante o mesmo visual e
 * comportamento em qualquer lugar.
 *
 * @param {Object} msg       – objeto da mensagem
 * @param {number} index     – índice no array de mensagens (para ações)
 * @param {Object} opts
 * @param {string} opts.userId          – ID do usuário logado (pra saber se é "eu")
 * @param {string} opts.myAvatar        – URL do avatar do usuário logado
 * @param {string} opts.partnerAvatar   – URL do avatar da outra parte
 * @param {string} [opts.supportAvatar] – URL do avatar da equipe de suporte
 * @param {Function} [opts.resolveSenderName] – fn(msg) → nome do remetente
 * @param {Object} [opts.actions] – mapeamento de nomes de ação → nome da função
 *   ex: { reply:'startReply', copy:'copyMessageText', edit:'startEdit', delete:'deleteMessage' }
 *   Passe false para ocultar ações.
 * @param {boolean} [opts.useDropdown=true] – true=dropdown ▾, false=ícones visíveis
 * @param {boolean} [opts.enableGrouping=false] – agrupa msgs seguidas do mesmo remetente
 * @param {Array} [opts.allMessages] – array completo de mensagens (pra agrupamento)
 */
window.renderMsgBubble = function(msg, index, opts = {}) {
    const {
        userId, myAvatar, partnerAvatar,
        supportAvatar = 'https://ui-avatars.com/api/?name=Suporte&background=ffc107&color=1c1c1c&size=40',
        resolveSenderName,
        actions = { reply:'startReply', copy:'copyMessageText', edit:'startEdit', delete:'deleteMessage' },
        useDropdown = true, enableGrouping = false, allMessages = []
    } = opts;

    if (msg.type === 'system' || msg.senderId === 'system') {
        return `<div class="text-center my-3"><span class="system-chip"><i class="bi bi-info-circle-fill"></i>${window.stripLegacyEmoji?.(msg.text) ?? msg.text}</span></div>`;
    }

    if (msg.type === 'review') {
        const lines = (msg.text || '').split('\n');
        const ratingLine = lines.find(l => l.includes('/5'));
        const rating = ratingLine ? parseInt(ratingLine.match(/(\d+)\/5/)?.[1] || 0) : 0;
        const starsHtml = rating > 0 ? Array.from({length:5}, (_,i) => `<i class="bi ${i < rating ? 'bi-star-fill text-warning' : 'bi-star text-muted'} me-1"></i>`).join('') : '';
        const commentText = lines.filter(l => !l.startsWith('Nota:') && !l.startsWith('Avaliação') && !l.startsWith('—')).join('\n').trim();
        const isMe = msg.senderId === userId;
        return `
        <div class="msg-row ${isMe ? 'is-me' : 'is-them'}">
            ${!isMe ? `<img class="msg-avatar" src="${partnerAvatar || ''}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">` : ''}
            <div class="msg-bubble ${isMe ? 'is-me' : 'is-them'}" style="background:${isMe ? '#d9fdd3' : '#fff5f5'};border:1px solid #ffd1d1;">
                <div class="d-flex align-items-center gap-1 mb-1">
                    <i class="bi bi-patch-check-fill" style="color:#22c98e;font-size:1rem;"></i>
                    <span class="fw-bold small" style="color:#22c98e;">Avaliação ${isMe ? 'enviada' : 'recebida'}</span>
                </div>
                <div class="mb-1">${starsHtml}</div>
                ${commentText ? `<p class="mb-1 small" style="white-space:pre-wrap;">${window.formatLinks?.(commentText) ?? commentText}</p>` : ''}
                ${msg.image ? `<img src="${msg.image}" class="img-fluid rounded mb-1" referrerpolicy="no-referrer" style="max-width:200px;cursor:pointer;" onclick="window.openImageFull('${msg.image}')" onerror="this.onerror=null;this.style.display='none'">` : ''}
                ${msg.reviewImages && msg.reviewImages.length > 1 ? `<div class="small text-muted">+${msg.reviewImages.length - 1} foto${msg.reviewImages.length > 2 ? 's' : ''}</div>` : ''}
                ${msg.reviewVideo ? `<a href="${msg.reviewVideo}" target="_blank" class="small text-decoration-none d-block"><i class="bi bi-play-circle-fill me-1" style="color:#ff0000;"></i>Ver vídeo</a>` : ''}
                <div class="msg-time">${new Date(msg.timestamp).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</div>
            </div>
        ${isMe ? `<img class="msg-avatar" src="${myAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">` : ''}
    </div>`;
    }

    const isMe = msg.senderId === userId;
    const isStaff = !!msg.isStaff;
    const senderLabel = msg.senderName || (resolveSenderName?.(msg) ?? '') || (isStaff ? 'Suporte' : 'Usuário');
    const avatarForThem = isStaff ? supportAvatar : (partnerAvatar || '');
    const prevMsg = enableGrouping && allMessages[index - 1];
    const isGrouped = prevMsg && prevMsg.senderId === msg.senderId && prevMsg.type !== 'system' && !!prevMsg.isStaff === isStaff;

    if (msg.deleted) {
        return `
        <div class="msg-row ${isMe ? 'is-me' : 'is-them'}"${isGrouped ? ' style="margin-top:-4px;"' : ''}>
            ${!isMe ? `<img class="msg-avatar" src="${avatarForThem}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">` : ''}
            <div class="msg-bubble ${isMe ? 'is-me' : 'is-them'} msg-deleted">
                <i class="bi bi-slash-circle me-1"></i><em>Mensagem apagada</em>
            </div>
            ${isMe ? `<img class="msg-avatar" src="${myAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">` : ''}
        </div>`;
    }

    const cleanText = window.stripLegacyEmoji?.(msg.text || '') ?? (msg.text || '');
    const replyHtml = msg.replyTo ? `
        <div class="p-2 mb-2 rounded ${isMe ? 'bg-white bg-opacity-25' : 'bg-secondary bg-opacity-10'} small border-start border-4 border-info">
            <div class="fw-bold" style="font-size: 0.7rem;">${msg.replyTo.senderName}</div>
            <div class="text-truncate chat-reply-preview">${window.stripLegacyEmoji?.(msg.replyTo.text) ?? msg.replyTo.text}</div>
        </div>` : '';

    const fileChipHtml = (msg.type === 'file' && msg.file) ? `
        <a href="${msg.file.url}" target="_blank" rel="noopener" class="chat-file-chip mb-2">
            <i class="bi bi-file-earmark-arrow-down-fill"></i>
            <span class="chat-file-name">${cleanText.replace(/^Arquivo:\s*/, '') || msg.file.name || 'Arquivo'}</span>
        </a>` : '';

    const locationChipHtml = (msg.type === 'location') ? `
        <a href="${msg.location || '#'}" target="_blank" rel="noopener" class="chat-location-chip mb-2" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;background:rgba(230,126,34,0.12);color:#e67e22;padding:6px 10px;border-radius:8px;font-weight:600;">
            <i class="bi bi-geo-alt-fill"></i>
            <span>${window.escapeHtml?.(cleanText || 'Localização compartilhada') ?? (cleanText || 'Localização compartilhada')}</span>
        </a>` : '';

    const showTextCaption = cleanText && !(msg.type === 'image' && (cleanText === 'Imagem' || cleanText === 'GIF')) && !(msg.type === 'file' && msg.file) && !(msg.type === 'video');

    // Reação
    const reaction = msg.reaction || null;
    const reactionBadgeHtml = reaction ? `<span class="msg-reaction-badge" onclick="window.toggleReaction(${index}, ${isMe}, '${reaction}')">${reaction}</span>` : '';

    // Ações
    const buildActions = () => {
        if (!actions) return '';
        const a = actions;
        if (useDropdown) {
            return `
                <div class="dropdown">
                    <i class="bi bi-chevron-down cursor-pointer opacity-50" data-bs-toggle="dropdown" style="font-size:0.8rem;"></i>
                    <ul class="dropdown-menu dropdown-menu-end shadow-sm">
                        <li><a class="dropdown-item py-1 small" href="javascript:void(0)" onclick="event.stopPropagation();window.reactToMessage(${index}, ${isMe})"><i class="bi bi-emoji-smile me-2"></i>Reagir</a></li>
                        ${a.reply ? `<li><a class="dropdown-item py-1 small" href="javascript:void(0)" onclick="window.${a.reply}(${index})"><i class="bi bi-reply me-2"></i>Responder</a></li>` : ''}
                        ${a.copy ? `<li><a class="dropdown-item py-1 small" href="javascript:void(0)" onclick="window.${a.copy}(${index})"><i class="bi bi-clipboard me-2"></i>Copiar</a></li>` : ''}
                        ${a.edit && isMe ? `<li><a class="dropdown-item py-1 small" href="javascript:void(0)" onclick="window.${a.edit}(${index})"><i class="bi bi-pencil me-2"></i>Editar</a></li>` : ''}
                        ${a.delete && isMe ? `<li><a class="dropdown-item py-1 small text-danger" href="javascript:void(0)" onclick="window.${a.delete}(${index})"><i class="bi bi-trash me-2"></i>Apagar</a></li>` : ''}
                    </ul>
                </div>`;
        }
        return `
            <div class="msg-actions-visible">
                <i class="bi bi-emoji-smile" onclick="event.stopPropagation();window.showReactionPicker(event, ${index}, ${isMe})" title="Reagir"></i>
                ${a.reply ? `<i class="bi bi-reply" onclick="window.${a.reply}(${index})" title="Responder"></i>` : ''}
                ${a.copy ? `<i class="bi bi-clipboard" onclick="window.${a.copy}(${index})" title="Copiar"></i>` : ''}
                ${a.edit && (isMe || isStaff) ? `<i class="bi bi-pencil" onclick="window.${a.edit}(${index})" title="Editar"></i>` : ''}
                ${a.delete && (isMe || isStaff) ? `<i class="bi bi-trash text-danger" onclick="window.${a.delete}(${index})" title="Apagar"></i>` : ''}
            </div>`;
    };

    return `
    <div class="msg-row ${isMe ? 'is-me' : 'is-them'}"${isGrouped ? ' style="margin-top:-4px;"' : ''}>
        ${!isMe ? `<img class="msg-avatar" src="${avatarForThem}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">` : ''}
        <div class="msg-bubble ${isMe ? 'is-me' : 'is-them'}${isStaff ? ' is-staff' : ''}" style="margin-bottom:${reaction ? '10px' : '0'}">
            <div class="d-flex justify-content-between align-items-center mb-1 gap-2">
                ${!isGrouped ? `<span class="msg-sender">${senderLabel}${isStaff ? ' <i class="bi bi-patch-check-fill" title="Suporte"></i>' : ''}</span>` : '<span></span>'}
                ${buildActions()}
            </div>
            ${replyHtml}
            ${msg.image ? `
                <img src="${msg.image}" class="img-fluid rounded mb-2" referrerpolicy="no-referrer"
                     style="max-width:220px;cursor:pointer;"
                     onclick="window.openImageFull('${msg.image}')" onerror="this.onerror=null;this.style.display='none'">` : ''}
            ${msg.video ? `
                <video src="${msg.video}" class="img-fluid rounded mb-2" controls
                       style="max-width:220px;max-height:200px;background:#000;border-radius:8px;"
                       onerror="this.outerHTML='<a href=\\'${msg.video.replace(/'/g, "\\'")}\\' target=\\'_blank\\' class=\\'small text-break\\'>${msg.video}</a>'"></video>` : ''}
            ${fileChipHtml}
            ${locationChipHtml}
            ${showTextCaption ? `<div class="chat-bubble-text" style="white-space:pre-wrap;">${window.formatLinks?.(cleanText) ?? cleanText}</div>` : ''}
            <div class="msg-time">
                ${isMe ? `<span class="msg-status me-1">${msg.visto ? '<span class="text-info"><i class="bi bi-check-all"></i> Visto</span>' : '<span class="text-muted"><i class="bi bi-check"></i> Entregue</span>'}</span>` : ''}
                ${msg.edited ? '<span>(editada)</span>' : ''}
                ${new Date(msg.timestamp).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}
            </div>
            ${reactionBadgeHtml}
        </div>
            ${isMe ? `<img class="msg-avatar" src="${myAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">` : ''}
        </div>`;
};

/* ---------- Reactions ---------- */
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉', '💯', '😍', '🤣', '😡', '👏', '💀', '🥰', '🤔', '😎', '✨', '💪', '🤡'];

window.reactToMessage = function(msgIndex, isMe) {
    const btn = document.querySelector(`.msg-row:nth-child(${msgIndex + 1}) .dropdown [data-bs-toggle="dropdown"]`);
    if (btn) {
        const rect = btn.getBoundingClientRect();
        showReactionPickerAt(rect.left, rect.top, msgIndex, isMe);
    }
};

window.showReactionPicker = function(e, msgIndex, isMe) {
    e.stopPropagation();
    const rect = e.target.getBoundingClientRect();
    showReactionPickerAt(rect.left, rect.top, msgIndex, isMe);
};

function showReactionPickerAt(x, y, msgIndex, isMe) {
    const old = document.querySelector('.reaction-picker');
    if (old) old.remove();

    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    picker.innerHTML = REACTION_EMOJIS.map(e => `<span data-emoji="${e}">${e}</span>`).join('');

    picker.style.top = (y - 50) + 'px';
    picker.style.left = Math.max(8, Math.min(x, window.innerWidth - 240)) + 'px';

    picker.querySelectorAll('span').forEach(el => {
        el.addEventListener('click', function(ev) {
            ev.stopPropagation();
            const emoji = this.dataset.emoji;
            picker.remove();
            window.__toggleReaction(msgIndex, isMe, emoji);
        });
    });

    document.body.appendChild(picker);

    setTimeout(() => {
        document.addEventListener('click', function dismiss(e) {
            if (!e.target.closest('.reaction-picker')) {
                const p = document.querySelector('.reaction-picker');
                if (p) p.remove();
                document.removeEventListener('click', dismiss);
            }
        });
    }, 0);
}

window.toggleReaction = function(msgIndex, isMe, currentEmoji) {
    window.__toggleReaction(msgIndex, isMe, currentEmoji, true);
};

window.__toggleReaction = function(msgIndex, isMe, emoji, isRemove = false) {
    const data = window.__getActiveChatData?.();
    if (!data) return;
    const { chat, save, render } = data;
    if (!chat || !chat.messages?.[msgIndex]) return;

    const msg = chat.messages[msgIndex];
    if (isRemove && msg.reaction === emoji) {
        delete msg.reaction;
    } else {
        msg.reaction = (msg.reaction === emoji) ? null : emoji;
    }

    save(chat);
    render();
};

window.__setupReactionHooks = function(chat, saveFn, renderFn) {
    window.__getActiveChatData = () => ({ chat, save: saveFn, render: renderFn });
};

/* ---------- Product Reviews ---------- */
window.loadProductReviews = async function(productId) {
    const container = document.getElementById('productReviewsList');
    if (!container) return;
    try {
        const orders = await supabaseFetch(`orders?product_id=eq.${productId}&status=eq.finished&select=id`);
        if (!orders || orders.length === 0) {
            container.innerHTML = '<div class="text-center py-5"><p class="text-muted mb-0">Nenhuma opinião ainda.</p></div>';
            const countEl = document.getElementById('opinionsCount');
            if (countEl) countEl.textContent = '';
            return;
        }
        const orderIds = orders.map(o => o.id);
        const avaliacoes = await supabaseFetch(`avaliacoes?order_id=in.(${orderIds.join(',')})&order=created_at.desc&limit=20`);
        if (!avaliacoes || avaliacoes.length === 0) {
            container.innerHTML = '<div class="text-center py-5"><p class="text-muted mb-0">Nenhuma opinião ainda.</p></div>';
            const countEl = document.getElementById('opinionsCount');
            if (countEl) countEl.textContent = '';
            return;
        }
        const countEl = document.getElementById('opinionsCount');
        if (countEl) countEl.textContent = `(${avaliacoes.length})`;

        // Sumário geral: média + distribuição de estrelas
        const total = avaliacoes.length;
        const avg = (avaliacoes.reduce((s, a) => s + (a.rating || 0), 0) / total).toFixed(1);
        const dist = [0,0,0,0,0];
        avaliacoes.forEach(a => { const r = Math.round(a.rating || 0); if (r >= 1 && r <= 5) dist[r-1]++; });

        let summaryHtml = `
            <div class="opinions-summary">
                <div class="opinions-summary-score">
                    <span class="opinions-avg">${avg}</span>
                    <div class="opinions-avg-stars">${Array.from({length:5}, (_,i) => `<i class="bi ${i < Math.round(parseFloat(avg)) ? 'bi-star-fill' : 'bi-star'}" style="color:#3483fa;"></i>`).join('')}</div>
                    <span class="opinions-total">${total} opini${total === 1 ? 'ão' : 'ões'}</span>
                </div>
                <div class="opinions-summary-bars">
                    ${[5,4,3,2,1].map(n => {
                        const pct = total > 0 ? Math.round((dist[n-1] / total) * 100) : 0;
                        return `
                            <div class="opinions-bar-row">
                                <span class="opinions-bar-label">${n}</span>
                                <div class="opinions-bar-track"><div class="opinions-bar-fill" style="width:${pct}%"></div></div>
                                <span class="opinions-bar-pct">${pct}%</span>
                            </div>`;
                    }).join('')}
                </div>
            </div>`;

        container.innerHTML = summaryHtml + avaliacoes.map(a => {
            const stars = Array.from({length:5}, (_,i) => `<i class="bi ${i < (a.rating || 0) ? 'bi-star-fill' : 'bi-star'}" style="color:#3483fa;font-size:0.85rem;"></i>`).join('');
            const images = a.images && Array.isArray(a.images) && a.images.length > 0
                ? `<div class="opinion-images">${a.images.slice(0,4).map(url => `<img src="${url}" referrerpolicy="no-referrer" onclick="window.openImageFull('${url}')" onerror="this.onerror=null;this.style.display='none'">`).join('')}</div>` : '';
            const video = a.videos && Array.isArray(a.videos) && a.videos[0]
                ? `<a href="${a.videos[0]}" target="_blank" class="opinion-video-link"><i class="bi bi-play-circle-fill me-1" style="color:#ff0000;"></i>Ver vídeo</a>` : '';
            const date = new Date(a.created_at).toLocaleDateString('pt-BR');
            return `
                <div class="opinion-card">
                    <div class="opinion-card-header">
                        <span class="opinion-author">${a.avaliador_nome || 'Anônimo'}</span>
                        <span class="opinion-stars">${stars}</span>
                    </div>
                    <div class="opinion-date">${date}</div>
                    ${a.comment ? `<p class="opinion-comment">${a.comment}</p>` : ''}
                    ${images}
                    ${video}
                </div>`;
        }).join('');
    } catch (e) {
        console.error('Erro ao carregar avaliações:', e);
        container.innerHTML = '<div class="text-center py-5"><p class="text-muted mb-0">Erro ao carregar opiniões.</p></div>';
    }
};

