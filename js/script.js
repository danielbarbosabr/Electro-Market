// ============================================
// ELECTROMARKET - SCRIPT PRINCIPAL
// Melhorias: Toast system, Yeti corrigido,
//            debounce na busca, skeleton loading,
//            toggle tema global, melhor gestão de estado
// ============================================

window.allProductsCache = [];
window.cart              = JSON.parse(localStorage.getItem('electroCart'))    || [];
window.likedProducts     = JSON.parse(localStorage.getItem('electroLiked'))   || [];
window.accessHistory     = JSON.parse(localStorage.getItem('electroHistory')) || [];
window.currentChat       = null;
window.adminOrdersCache  = [];
window.currentOrderViewType = 'buyer';
window.ordersCache       = [];
window.currentReplyIndex   = null;
window.editingMessageIndex = null;
window.riveInstance      = null;
window.chatsCache        = [];
window.notificationsCache = JSON.parse(localStorage.getItem('electroNotifs')) || [];
window.chatPollInterval  = null;
window.ordersPollInterval = null;
window.lastChatSignature = null;
window.productsFetchToken = 0;

// Formata um valor em reais; se for 0 (ou vazio), mostra "GRÁTIS"
function formatPreco(valor, opts = {}) {
    const v = parseFloat(valor) || 0;
    if (v === 0) return opts.htmlGratis !== false ? '<span class="text-success fw-bold">GRÁTIS</span>' : 'R$ 0,00';
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

function statusToAlertClass(status) {
    if (status === 'finished') return 'success';
    if (status === 'cancelled' || status === 'dispute') return 'danger';
    if (status === 'pending') return 'warning';
    return 'info';
}
window.statusToAlertClass = statusToAlertClass;

const STATUS_BAR_MAP = {
    'pending':         '<i class="bi bi-hourglass-split me-1"></i>Aguardando Aprovação',
    'offer_pending':   '<i class="bi bi-tag me-1"></i>Oferta Enviada',
    'accepted':        '<i class="bi bi-check-circle-fill me-1"></i>Aprovado - Combinar Entrega',
    'agreement':       '<i class="bi bi-people-fill me-1"></i>Definindo Logística',
    'shipping':        '<i class="bi bi-truck me-1"></i>Em Transporte',
    'awaiting_pickup': '<i class="bi bi-geo-alt-fill me-1"></i>Aguardando Retirada',
    'finished':        '<i class="bi bi-patch-check-fill me-1"></i>Finalizado',
    'cancelled':       '<i class="bi bi-x-circle-fill me-1"></i>Cancelado',
    'dispute':         '<i class="bi bi-exclamation-triangle-fill me-1"></i>Em Disputa'
};
window.STATUS_BAR_MAP = STATUS_BAR_MAP;

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
    stopDirectChatPolling();
    document.getElementById('whatsappOrdersView')?.classList.add('d-none');
    document.getElementById('productGridMain')?.classList.remove('d-none');
    document.body.classList.remove('wa-locked', 'admin-chat-fullscreen');
    document.body.style.overflow = '';
    if (typeof window.closeWaChat === 'function') window.closeWaChat();
    if (typeof window.closeDirectChat === 'function') window.closeDirectChat();
};

async function loadPage(query = 'eletronicos', forceRefresh = false) {
    // Se já está exibindo um produto via hash, não sobrescreve
    if (document.querySelector('.detail-page')) return;
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
                            <div class="ml-field">
                                <input type="text" id="caTitle" placeholder=" " required>
                                <label for="caTitle">Título do anúncio *</label>
                            </div>
                        </div>
                        <div class="mb-3">
                            <div class="ml-field">
                                <select id="caCondition" required>
                                    ${renderCondicoesOptions()}
                                </select>
                                <label for="caCondition">Condição *</label>
                            </div>
                        </div>
                        <div class="mb-3">
                            <div class="ml-field">
                                <textarea id="caDescription" placeholder=" " rows="4" required></textarea>
                                <label for="caDescription">Descrição *</label>
                            </div>
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
                        <div class="mb-3">
                            <div class="ml-field">
                                <input type="number" id="caPrice" placeholder=" " min="0" step="0.01" required>
                                <label for="caPrice">Preço (R$) *</label>
                            </div>
                        </div>
                        <div class="mb-3">
                            <div class="ml-field">
                                <input type="number" id="caQuantity" placeholder=" " min="1" required>
                                <label for="caQuantity">Quantidade *</label>
                            </div>
                        </div>
                        <div class="create-ad-toggle-row">
                            <span id="caDeliveryLabel">Faço entrega</span>
                            <div class="form-check form-switch mb-0">
                                <input class="form-check-input" type="checkbox" id="caDelivery" checked onchange="document.getElementById('caDeliveryLabel').textContent=this.checked?'Faço entrega':'Não realizo entregas'">
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
                            <div class="ml-field">
                                <input type="text" class="create-ad-input" id="caCatSearch" placeholder=" " autocomplete="off">
                                <label for="caCatSearch">Categoria *</label>
                                <i class="bi bi-search ca-cat-search-icon"></i>
                            </div>
                            <select id="caCategory" class="d-none" required>
                                ${renderCategoriaOptions()}
                            </select>
                            <div id="caCatList" class="ca-cat-list"></div>
                            <div id="caSuggestCatWrap" class="ca-suggest-cat-wrap d-none">
                                <p class="small text-muted mb-2">Não encontrou? Crie uma nova categoria:</p>
                                <div class="ca-suggest-row">
                                    <div class="ml-field flex-grow-1 mb-0">
                                        <input type="text" id="caSuggestCatInput" placeholder=" ">
                                        <label for="caSuggestCatInput">Nome da nova categoria</label>
                                    </div>
                                    <button type="button" class="ml-btn ml-btn-primary" onclick="window.suggestCategory()">Adicionar</button>
                                </div>
                                <small class="text-muted">A categoria será criada e já vinculada a este anúncio.</small>
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
                                    <div class="ml-field flex-grow-1 mb-0">
                                        <input type="url" id="caFoto0" placeholder=" ">
                                        <label for="caFoto0">Link da imagem principal (opcional)</label>
                                    </div>
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
                                    <div class="ml-field flex-grow-1 mb-0">
                                        <input type="url" id="caFoto1" placeholder=" ">
                                        <label for="caFoto1">Link da imagem 2 (opcional)</label>
                                    </div>
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
                                    <div class="ml-field flex-grow-1 mb-0">
                                        <input type="url" id="caFoto2" placeholder=" ">
                                        <label for="caFoto2">Link da imagem 3 (opcional)</label>
                                    </div>
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
                                    <div class="ml-field flex-grow-1 mb-0">
                                        <input type="url" id="caFoto3" placeholder=" ">
                                        <label for="caFoto3">Link da imagem 4 (opcional)</label>
                                    </div>
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
    ['0','1','2','3'].forEach(n => {
        const input = document.getElementById(`caFoto${n}`);
        if (!input) return;
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
        // Category list: render filtered items, click to select
        const catList = document.getElementById('caCatList');
        function renderCatList(filter) {
            const term = (filter || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            let html = '';
            Array.from(catSelect.options).forEach(opt => {
                if (!opt.value) return;
                const text = opt.text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const val = opt.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (!term || text.includes(term) || val.includes(term)) {
                    const sel = opt.value === catSelect.value ? ' ca-cat-list-item-selected' : '';
                    html += `<div class="ca-cat-list-item${sel}" data-value="${opt.value}">${opt.text}</div>`;
                }
            });
            catList.innerHTML = html;
            const suggestWrap = document.getElementById('caSuggestCatWrap');
            suggestWrap.classList.toggle('d-none', html.length > 0 || !term);
        }
        catSearch.addEventListener('input', function() { renderCatList(this.value); });
        catList.addEventListener('click', function(e) {
            const item = e.target.closest('.ca-cat-list-item');
            if (item) {
                catSelect.value = item.dataset.value;
                catSearch.value = item.textContent;
                renderCatList(catSearch.value);
            }
        });
        renderCatList('');
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
    const todas = getCategorias();
    if (todas.some(c => c.toLowerCase() === nome.toLowerCase())) {
        showToast('Essa categoria já existe!', 'info');
        input.value = '';
        return;
    }
    // Cria a nova categoria e já vincula ao anúncio atual
    const sel = document.getElementById('caCategory');
    if (sel) {
        const opt = document.createElement('option');
        opt.value = nome;
        opt.textContent = nome;
        sel.appendChild(opt);
        sel.value = nome;
    }
    const search = document.getElementById('caCatSearch');
    if (search) { search.value = nome; search.dispatchEvent(new Event('input')); }
    // Persiste para aparecer no select em anúncios futuros
    try {
        const aprovadas = JSON.parse(localStorage.getItem('emCategoriasAprovadas') || '[]');
        if (!aprovadas.includes(nome)) aprovadas.push(nome);
        localStorage.setItem('emCategoriasAprovadas', JSON.stringify(aprovadas));
    } catch (e) {}
    showToast('Categoria "' + nome + '" adicionada ao anúncio!', 'success');
    input.value = '';
    const wrap = document.getElementById('caSuggestCatWrap');
    if (wrap) wrap.classList.add('d-none');
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
    if (label && !getSavedUser()) label.textContent = 'Detectando local...';

    // 1) Tenta geolocalização do navegador (mais precisa que IP)
    if (navigator.geolocation) {
        await new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(async (pos) => {
                try {
                    const { latitude, longitude } = pos.coords;
                    const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=pt-BR`, { headers: { 'Accept': 'application/json' } });
                    const data = await res.json();
                    const city = data?.address?.city || data?.address?.town || data?.address?.municipality || '';
                    const state = data?.address?.state || '';
                    if (city && state) {
                        guestDetectedRegion = { cidade: city, estado: state };
                        if (label && !getSavedUser()) label.textContent = `${city} - ${state}`;
                        resolve();
                        return;
                    }
                } catch (e) { /* cai no fallback de IP */ }
                // fallback: IP
                await fallbackDetectByIp(label);
                resolve();
            }, async () => {
                // usuário negou ou falhou: tenta IP, senão "Faça login"
                await fallbackDetectByIp(label);
                resolve();
            }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
        });
    } else {
        await fallbackDetectByIp(label);
    }
}

/** Detecção de região via IP (fallback quando a geolocalização não funciona) */
async function fallbackDetectByIp(label) {
    try {
        const res  = await fetch('https://ipapi.co/json/');
        const data = await res.json();
        if (!data || data.error || !data.city) throw new Error('Sem dados de localização');
        guestDetectedRegion = { cidade: data.city, estado: data.region_code };
        if (label && !getSavedUser()) label.textContent = `${data.city} - ${data.region_code}`;
    } catch (e) {
        console.error('Não foi possível detectar a região:', e);
        if (label && !getSavedUser()) label.textContent = 'Faça login';
    }
}

/** Clique em "Receber em:" no cabeçalho: visitante filtra pela região detectada, logado edita o endereço */
window.handleShippingInfoClick = function() {
    if (getSavedUser()) {
        window.showProfileEdit();
    } else if (document.getElementById('shippingLabel')?.textContent.trim() === 'Faça login') {
        window.showAuthScreen('login');
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

    // Se veio da tela de cadastro, volta pra ela
    if (window._authReturn) {
        const mode = window._authReturn;
        window._authReturn = null;
        window.showAuthScreen(mode);
    }

    // Limpa a URL
    if (window.location.hash.startsWith('#/produto/')) {
        history.pushState(null, '', window.location.pathname + window.location.search);
    }
};

window.prepareEditProduct = function(pid) {
    window.showCreateAdPage(pid);
};

const TERMS_SECTIONS = [
    { icon: 'file-text',     title: '01. Termos Gerais', id: 'ts1', html: '<p>Ao acessar ou utilizar a plataforma <strong>ElectroMarket</strong> (doravante "plataforma"), você concorda com estes Termos de Uso. Caso não concorde, não utilize o serviço.</p><p>Estes Termos aplicam-se a todos os usuários da plataforma, sejam eles compradores, vendedores ou visitantes. O uso implica na aceitação integral e irretratável destes Termos.</p><p>A ElectroMarket reserva-se o direito de alterar estes Termos a qualquer momento, sendo responsabilidade do usuário verificar periodicamente as atualizações.</p>' },
    { icon: 'shop',          title: '02. Sobre a ElectroMarket', id: 'ts2', html: '<p>A ElectroMarket é uma plataforma digital de classificados que funciona como um <strong>marketplace de anúncios</strong>, semelhante ao Facebook Marketplace e a OLX.</p><div class="hl"><strong>Importante:</strong> A ElectroMarket não processa pagamentos, não vende produtos e não intermedia transações financeiras. A plataforma apenas facilita o contato entre compradores e vendedores.</div><p>Funcionamento básico:</p><ul><li>Vendedores anunciam seus produtos ou serviços na plataforma;</li><li>Compradores encontram os anúncios por meio de busca e filtros;</li><li>A negociação acontece diretamente entre comprador e vendedor por meio do chat da plataforma;</li><li>Pagamento, entrega, garantia, troca e demais condições são definidos exclusivamente entre as partes;</li><li>A plataforma apenas facilita o contato entre os usuários.</li></ul>' },
    { icon: 'person-plus',   title: '03. Cadastro de Usuários', id: 'ts3', html: '<p>Para utilizar determinadas funcionalidades da plataforma, é necessário realizar cadastro. Ao se cadastrar, você declara que:</p><ul><li>É maior de 18 anos ou está devidamente autorizado por responsável legal;</li><li>As informações fornecidas são verdadeiras, completas e atualizadas;</li><li>É responsável pela guarda e sigilo de sua senha de acesso;</li><li>Notificará imediatamente a plataforma em caso de uso não autorizado de sua conta.</li></ul><p>É vedada a criação de múltiplas contas por mesma pessoa, bem como a transferência de contas entre usuários.</p>' },
    { icon: 'megaphone',     title: '04. Publicação de Anúncios', id: 'ts4', html: '<p>Ao publicar um anúncio, o vendedor declara e garante que:</p><ul><li>É titular ou possui autorização legal para comercializar o produto ou serviço anunciado;</li><li>As informações do anúncio (título, descrição, preço, fotos) são fieis e não enganosas;</li><li>O produto ou serviço atende à legislação vigente;</li><li>As fotos são reais e representam fielmente o item anunciado.</li></ul><p>A ElectroMarket não se responsabiliza pela veracidade dos anúncios, cabendo aos usuários avaliar as condições de cada oferta antes de fechar negócio.</p><p>É proibido publicar anúncios duplicados, com preços manipulados ou com intenção de spam.</p>' },
    { icon: 'chat-dots',     title: '05. Chat entre Comprador e Vendedor', id: 'ts5', html: '<p>O chat da plataforma é o canal oficial de comunicação entre compradores e vendedores. Ao utilizar o chat, os usuários concordam em:</p><ul><li>Manter comunicação respeitosa e profissional;</li><li>Não utilizar o chat para envio de spam, correntes ou mensagens em massa;</li><li>Não compartilhar dados pessoais sensíveis por meio do chat;</li><li>Compreender que a plataforma não se responsabiliza por acordos feitos entre as partes via chat.</li></ul><div class="hl"><strong>Lembre-se:</strong> Toda negociação, combinando preço, forma de pagamento, prazo de entrega e condições de garantia, é de responsabilidade exclusiva do comprador e do vendedor.</div>' },
    { icon: 'shield-check',  title: '06. Responsabilidades do Anunciante', id: 'ts6', html: '<p>O anunciante (vendedor) é responsável por:</p><ul><li>Garantir que o produto ou serviço esteja disponível conforme descrito no anúncio;</li><li>Responder às mensagens dos potenciais compradores em prazo razoável;</li><li>Informar condições de pagamento, entrega e garantia de forma clara;</li><li>Cumprir os termos acordados diretamente com o comprador;</li><li>Manter seu anúncio atualizado, removendo-o caso o produto não esteja mais disponível.</li></ul><p>A ElectroMarket não é responsável por descumprimentos de acordos entre comprador e vendedor.</p>' },
    { icon: 'person',        title: '07. Responsabilidades do Comprador', id: 'ts7', html: '<p>O comprador é responsável por:</p><ul><li>Avaliar cuidadosamente as condições do anúncio antes de efetuar qualquer negócio;</li><li>Entrar em contato com o vendedor para esclarecer dúvidas sobre o produto;</li><li>Verificar a reputação e histórico do vendedor quando disponível;</li><li>Compreender que a plataforma não garante a qualidade, segurança ou legalidade dos produtos anunciados;</li><li>Realizar pagamentos e combinar entregas diretamente com o vendedor.</li></ul>' },
    { icon: 'exclamation-triangle', title: '08. Conteúdos Proibidos', id: 'ts8', html: '<p>É terminantemente proibido na plataforma a publicação de:</p><ul><li>Produtos ilegais, roubados ou contrabandeados;</li><li>Armas, drogas, substâncias controladas ou materiais que violem a legislação;</li><li>Produtos falsificados ou que infrinjam propriedade intelectual;</li><li>Conteúdo discriminatório, ofensivo, pornográfico ou que incite à violência;</li><li>Spam, correntes, golpes ou qualquer forma de fraude;</li><li>Dados pessoais de terceiros sem autorização;</li><li>Anúncios com preços simbólicos para fins de manipulação ou engano.</li></ul><p>A violação desta cláusula poderá resultar em remoção imediata do conteúdo, suspensão ou banimento da conta.</p>' },
    { icon: 'lock',          title: '09. Segurança da Conta', id: 'ts9', html: '<p>Cada usuário é responsável por manter a segurança de sua conta. Recomendamos:</p><ul><li>Utilizar senhas fortes e únicas para a plataforma;</li><li>Não compartilhar credenciais de acesso com terceiros;</li><li>Verificar regularmente a atividade da conta;</li><li>Sair da sessão em dispositivos públicos ou compartilhados.</li></ul><p>A ElectroMarket não se responsabiliza por acessos não autorizados decorrentes de negligência do titular da conta.</p>' },
    { icon: 'flag',          title: '10. Denúncias e Moderação', id: 'ts10', html: '<p>A ElectroMarket disponibiliza mecanismos para que os usuários reportem conteúdos ou comportamentos que violem estes Termos.</p><p>A equipe de moderação analisará as denúncias em prazo razoável e tomará as providências cabíveis, que podem incluir:</p><ul><li>Remoção do conteúdo denunciado;</li><li>Aviso ao usuário infrator;</li><li>Suspensão temporária da conta;</li><li>Banimento permanente da plataforma.</li></ul><p>A decisão de moderação será comunicada ao usuário denunciante quando pertinente.</p>' },
    { icon: 'x-octagon',     title: '11. Suspensão ou Banimento de Contas', id: 'ts11', html: '<p>A ElectroMarket reserva-se o direito de suspender ou banir contas que:</p><ul><li>Violem qualquer cláusula destes Termos de Uso;</li><li>Apresentem comportamento fraudulento, enganoso ou prejudicial a outros usuários;</li><li>Recebam múltiplas denúncias fundamentadas;</li><li>Utilizem a plataforma para atividades ilegais.</li></ul><p>Em caso de banimento, o usuário não poderá criar nova conta na plataforma. A ElectroMarket não é obrigada a fornecer justificativa detalhada em cada caso.</p>' },
    { icon: 'shield-lock',   title: '12. Privacidade e LGPD', id: 'ts12', html: '<p>A coleta e o tratamento de dados pessoais seguem a <strong>Lei Geral de Proteção de Dados (LGPD - Lei 13.709/2018)</strong>.</p><p>Os dados coletados são utilizados exclusivamente para:</p><ul><li>Funcionamento da plataforma (cadastro, anúncios, chat);</li><li>Comunicação entre a plataforma e os usuários;</li><li>Melhoria da experiência de uso;</li><li>Cumprimento de obrigações legais.</li></ul><p>Para mais detalhes, consulte nossa <a href="#" onclick="event.preventDefault();window.showPrivacyPage()" style="color:var(--market-color);text-decoration:underline;">Política de Privacidade</a>.</p>' },
    { icon: 'shield-exclamation', title: '13. Limitação de Responsabilidade', id: 'ts13', html: '<div class="hl"><strong>Atenção:</strong> A ElectroMarket atua exclusivamente como intermediária tecnológica. A plataforma <strong>não participa</strong> das negociações, pagamentos, entregas ou quaisquer transações entre compradores e vendedores.</div><p>Portanto, a ElectroMarket <strong>não se responsabiliza</strong> por:</p><ul><li>Qualidade, segurança ou legalidade dos produtos anunciados;</li><li>Cumprimento dos acordos entre comprador e vendedor;</li><li>Pagamentos, reembolsos ou estornos;</li><li>Entregas, atrasos ou danos durante o transporte;</li><li>Garantias, trocas ou devoluções de produtos;</li><li>Veracidade das informações prestadas pelos usuários;</li><li>Perdas ou danos diretos ou indiretos decorrentes do uso da plataforma.</li></ul><p>O uso da plataforma é por conta e risco do usuário.</p>' },
    { icon: 'arrow-repeat',  title: '14. Alterações dos Termos', id: 'ts14', html: '<p>A ElectroMarket poderá alterar estes Termos de Uso a qualquer momento, sem aviso prévio obrigatório.</p><p>As alterações entram em vigor a partir da data de publicação na plataforma. O uso continuado da plataforma após as alterações implica na aceitação das novas condições.</p><p>Recomendamos que os usuários revisem periodicamente esta página.</p>' },
    { icon: 'headset',       title: '15. Contato e Suporte', id: 'ts15', html: '<p>Em caso de dúvidas, sugestões ou solicitações relacionadas a estes Termos de Uso, entre em contato conosco:</p><ul><li><strong>E-mail:</strong> dannybarbosadelimabr@gmail.com</li><li><strong>Suporte na plataforma:</strong> utilize a seção "Falar com o Suporte" disponível no menu</li></ul><p>Nosso time responderá em até 48 horas úteis.</p>' }
];

const PRIVACY_SECTIONS = [
    { icon: 'database',     title: '01. Dados Coletados', id: 'ps1', html: '<p>A ElectroMarket coleta os seguintes dados pessoais durante o uso da plataforma:</p><ul><li><strong>Dados de cadastro:</strong> nome completo, CPF, e-mail, telefone, endereço (rua, número, bairro, cidade, UF, CEP);</li><li><strong>Dados de perfil:</strong> foto de perfil, banner, tipo de conta (comprador/vendedor);</li><li><strong>Dados de uso:</strong> histórico de buscas, anúncios visualizados, mensagens enviadas no chat;</li><li><strong>Dados técnicos:</strong> endereço IP, tipo de navegador, sistema operacional, dispositivo.</li></ul>' },
    { icon: 'bullseye',     title: '02. Finalidade da Coleta', id: 'ps2', html: '<p>Os dados são coletados para:</p><ul><li>Viabilizar o cadastro e o funcionamento da plataforma;</li><li>Exibir anúncios e facilitar o contato entre compradores e vendedores;</li><li>Processar mensagens enviadas pelo chat interno;</li><li>Melhorar a experiência de navegação e personalizar conteúdos;</li><li>Enviar notificações relevantes ao usuário;</li><li>Cumprir obrigações legais e regulatórias.</li></ul><div class="hl" style="background:#e8f4fd;border-left-color:var(--market-color);color:#1a4a7a;">Não utilizamos seus dados para fins de marketing externo sem o seu consentimento explícito.</div>' },
    { icon: 'share',        title: '03. Compartilhamento de Dados', id: 'ps3', html: '<p>A ElectroMarket <strong>não vende</strong> dados pessoais de usuários a terceiros.</p><p>Os dados podem ser compartilhados apenas nas seguintes situações:</p><ul><li>Quando exigido por lei ou ordem judicial;</li><li>Para fins de segurança e prevenção de fraudes;</li><li>Com prestadores de serviços essenciais (hospedagem, infraestrutura) sob acordos de confidencialidade.</li></ul>' },
    { icon: 'lock',         title: '04. Armazenamento e Segurança', id: 'ps4', html: '<p>Seus dados são armazenados em servidores seguros com criptografia e proteção contra acessos não autorizados. Adotamos medidas técnicas e administrativas para proteger suas informações, incluindo:</p><ul><li>Criptografia em trânsito (HTTPS/SSL);</li><li>Controle de acesso restrito aos dados;</li><li>Monitoramento regular de segurança;</li><li>Backups periódicos.</li></ul>' },
    { icon: 'file-earmark-text', title: '05. Seus Direitos (LGPD)', id: 'ps5', html: '<p>Conforme a Lei Geral de Proteção de Dados, você tem direito a:</p><ul><li><strong>Confirmação</strong> da existência de tratamento de dados;</li><li><strong>Acesso</strong> aos seus dados pessoais;</li><li><strong>Correção</strong> de dados incompletos ou desatualizados;</li><li><strong>Anonimização, bloqueio ou eliminação</strong> de dados desnecessários;</li><li><strong>Portabilidade</strong> dos dados;</li><li><strong>Eliminação</strong> dos dados tratados com consentimento;</li><li><strong>Informação</strong> sobre compartilhamento de dados;</li><li><strong>Revogação</strong> do consentimento.</li></ul><p>Para exercer esses direitos, entre em contato pelo e-mail: <strong>dannybarbosadelimabr@gmail.com</strong></p>' },
    { icon: 'cookie',       title: '06. Cookies', id: 'ps6', html: '<p>A plataforma utiliza cookies para:</p><ul><li>Manter a sessão do usuário ativa;</li><li>Lembrar preferências de navegação e tema;</li><li>Coletar estatísticas de uso para melhoria do serviço.</li></ul><p>Você pode gerenciar as preferências de cookies diretamente nas configurações do seu navegador.</p>' },
    { icon: 'clock-history', title: '07. Retenção de Dados', id: 'ps7', html: '<p>Os dados pessoais são mantidos enquanto a conta do usuário estiver ativa. Após a exclusão da conta, os dados serão removidos ou anonimizados em até 90 dias, exceto quando exigido por obrigação legal.</p>' },
    { icon: 'person-x',     title: '08. Menores de Idade', id: 'ps8', html: '<p>A plataforma não é direcionada a menores de 18 anos. Caso um menor seja identificado, sua conta será suspensa e os dados removidos imediatamente.</p>' },
    { icon: 'arrow-repeat', title: '09. Alterações nesta Política', id: 'ps9', html: '<p>Esta Política de Privacidade pode ser atualizada periodicamente. As alterações serão publicadas nesta página com a data de última atualização.</p>' },
    { icon: 'envelope',     title: '10. Contato', id: 'ps10', html: '<p>Em caso de dúvidas sobre esta Política de Privacidade ou sobre o tratamento dos seus dados:</p><ul><li><strong>E-mail:</strong> dannybarbosadelimabr@gmail.com</li><li><strong>Suporte:</strong> utilize a seção "Falar com o Suporte" na plataforma</li></ul>' }
];

function renderTermsPrivacy(sections, title, subtitle) {
    const toc = sections.map((s, i) =>
        `<div class="col-6">${String(i + 1).padStart(2, '0')}. <a href="#${s.id}" style="color:var(--market-color);text-decoration:none;">${s.title.replace(/^\d+\.\s*/, '')}</a></div>`
    ).join('');
    const body = sections.map(s =>
        `<div class="create-ad-section" id="${s.id}"><div class="create-ad-section-title"><i class="bi bi-${s.icon}"></i> ${s.title}</div><div class="create-ad-section-body">${s.html}</div></div>`
    ).join('');
    return `
    <div class="detail-page">
        <button type="button" class="detail-back-btn" onclick="window.closeProductDetail()">
            <i class="bi bi-arrow-left"></i> Voltar
        </button>
        <div class="create-ad-wrap">
            <div class="create-ad-header">
                <div>
                    <h4>${title}</h4>
                    <p class="text-muted small mb-0">${subtitle}</p>
                </div>
            </div>
            <div class="create-ad-form">
                <div class="create-ad-section">
                    <div class="create-ad-section-title"><i class="bi bi-list-ul"></i> Sumário</div>
                    <div class="create-ad-section-body"><div class="row g-2">${toc}</div></div>
                </div>
                ${body}
            </div>
        </div>
    </div>`;
}

window.showTermsPage = function() {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;
    if (!grid.classList.contains('create-ad-active') && !grid.classList.contains('product-detail-active') && !grid.classList.contains('offer-page-active')) {
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
    grid.className = 'offer-page-active';
    grid.style.display = 'block';
    grid.innerHTML = renderTermsPrivacy(TERMS_SECTIONS, 'Termos de Uso', 'Última atualização: julho de 2026 · Versão 1.0');
};

window.showPrivacyPage = function() {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;
    if (!grid.classList.contains('create-ad-active') && !grid.classList.contains('product-detail-active') && !grid.classList.contains('offer-page-active')) {
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
    grid.className = 'offer-page-active';
    grid.style.display = 'block';
    grid.innerHTML = renderTermsPrivacy(PRIVACY_SECTIONS, 'Política de Privacidade', 'Última atualização: julho de 2026 · Versão 1.0');
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

    window.updateCartBadge();
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
    /* Posiciona o rabicho dinamicamente apontando para o sino clicado */
    const bells = document.querySelectorAll('[onclick*="showNotifications"]');
    let activeBell = null;
    bells.forEach(b => { if (b.offsetParent !== null) activeBell = b; });
    if (activeBell) {
        const r = activeBell.getBoundingClientRect();
        const ddWidth = 430;
        const ddRight = 24;
        const bellCenterX = r.left + r.width / 2;
        const ddLeft = window.innerWidth - ddRight - ddWidth;
        let arrowRight = window.innerWidth - bellCenterX - 8;
        arrowRight = Math.max(16, Math.min(arrowRight, ddWidth - 24));
        dropdown.style.setProperty('--notif-arrow-right', arrowRight + 'px');
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

window.updateChatBadge = async function() {
    try {
        const user = getSavedUser();
        if (!user) return;
        const chats = await supabaseFetch('chats?order_id=is.null&select=messages,participants');
        let totalUnread = 0;
        chats.forEach(c => {
            if (!c.participants || !c.participants.includes(user.id)) return;
            if (c.messages && c.messages[0]?.type === 'ticket_meta') return;
            const un = c.messages?.filter(m => m.senderId !== user.id && !m.visto).length || 0;
            totalUnread += un;
        });
        const ids = ['chatBadgeDesktop', 'chatBadgeMobile', 'chatBadgeSellerMobile', 'chatBadgeAdminMobile'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent = totalUnread; el.classList.toggle('d-none', totalUnread === 0); }
        });
    } catch (e) {}
};

window.openAddressMap = function(location) {
    if (!location) {
        showToast('Endereço não disponível para este anúncio.', 'info');
        return;
    }
    window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(location), '_blank');
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
// CHAT UNIFICADO (cliente, vendedor, admin, suporte)
// ============================================

let chatAttachType = 'image';

window.showChat = async function(orderId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }
    let order = ordersCache.find(o => o.id === orderId);
    if (!order) {
        const result = await supabaseFetch(`orders?id=eq.${orderId}&limit=1`);
        order = result[0];
    }
    if (!order) { showToast('Pedido não encontrado.', 'error'); return; }
    if (window.currentChat !== orderId) window.lastChatSignature = null;
    window.currentChat = orderId;

    const isBuyerHere  = user.id === order.buyer_id;
    const isSellerHere = user.id === order.seller_id;
    const otherId      = isBuyerHere ? order.seller_id : (isSellerHere ? order.buyer_id : null);
    const otherName    = isBuyerHere ? order.seller_name : (isSellerHere ? order.buyer_name : `${order.buyer_name || 'Comprador'} ↔ ${order.seller_name || 'Vendedor'}`);

    let partnerAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(otherName || 'User')}&background=random&size=40`;
    let partnerDotClass = '';
    try {
        if (otherId) {
            const partnerData = await supabaseFetch(`users?select=avatar,last_seen&id=eq.${otherId}&limit=1`);
            const realAvatar = normalizeImageUrl(safeParseImages(partnerData?.[0]?.avatar)[0]);
            if (realAvatar) partnerAvatar = realAvatar;
            partnerDotClass = isRecentlyOnline(partnerData?.[0]?.last_seen) ? 'online' : 'offline';
        }
    } catch (e) {}

    const msgsId       = `msgs_${orderId}`;
    const inputId      = `input_${orderId}`;
    const previewId    = `preview_${orderId}`;
    const attachId     = `attachPanel_${orderId}`;
    const attachLinkId = `attachLink_${orderId}`;
    const statusId     = `statusBar_${orderId}`;
    const logisticsId  = `logistics_${orderId}`;
    const logisticsBtnsId = `logisticsBtns_${orderId}`;

    const logisticsAreaHtml = `
    <div id="${logisticsId}" class="logistics-agreement-area">
        <div id="${logisticsBtnsId}" class="logistics-buttons"></div>
    </div>`;

    const html = window.renderChatContainer({
        chatId: orderId,
        chat: order,
        order,
        partner: { name: otherName, avatar: partnerAvatar },
        msgsId,
        inputId,
        previewId,
        attachPanelId: attachId,
        attachLinkId,
        statusBarId: statusId,
        onSend: 'window.sendChatMessage(event)',
        onBack: 'window.closeWaChat()',
        onClose: 'window.closeWaChat()',
        onViewProfile: 'window.viewChatPartnerProfile()',
        onCancelOrder: `window.chatCancelOrder('${orderId}')`,
        onToggleAttachPanel: 'window.toggleChatAttachPanel()',
        onConfirmAttach: `window.confirmChatAttach()`,
        onSendLocation: 'window.sendChatLocation',
        onSendFile: 'window.sendChatImageFile',
        onChatActions: 'window.toggleChatActions()',
        showBackBtn: true,
        showCloseBtn: true,
        showProductSummary: true,
        showAttach: true,
        extraBeforeInput: logisticsAreaHtml
    });

    const panel = document.getElementById('waChatActive');
    if (panel) {
        panel.innerHTML = html;
        panel.classList.remove('d-none');
        panel.classList.add('d-flex');
    }

    if (partnerDotClass) {
        document.getElementById(`${msgsId}Dot`)?.classList.add(partnerDotClass);
    }

    window._chatActiveElements = {
        input:       document.getElementById(inputId),
        container:   document.getElementById(msgsId),
        statusBar:   document.getElementById(statusId),
        logistics:   document.getElementById(logisticsId),
        logisticsBtns: document.getElementById(logisticsBtnsId),
        attachPanel: document.getElementById(attachId),
        preview:     document.getElementById(previewId)
    };

    document.getElementById('waEmptyState')?.classList.add('d-none');
    document.getElementById('whatsappOrdersView')?.classList.add('wa-chat-open');
    document.querySelectorAll('#waContactList .wa-contact').forEach(el => {
        el.classList.toggle('active-chat', el.dataset.orderId === orderId);
    });
    await loadChatMessages(orderId);
    if (typeof setupPullToRefresh === 'function') setupPullToRefresh();
    startChatPolling(orderId);
};

window.closeWaChat = function() {
    stopChatPolling();
    window.currentChat = null;
    window.lastChatSignature = null;
    window._chatActiveElements = null;
    const panel = document.getElementById('waChatActive');
    if (panel) { panel.innerHTML = ''; panel.classList.add('d-none'); panel.classList.remove('d-flex'); }
    document.getElementById('waEmptyState')?.classList.remove('d-none');
    document.getElementById('whatsappOrdersView')?.classList.remove('wa-chat-open');
    document.querySelectorAll('#waContactList .wa-contact').forEach(el => el.classList.remove('active-chat'));
};

function startChatPolling(orderId) {
    stopChatPolling();
    window.chatPollInterval = setInterval(() => {
        const panel = document.getElementById('waChatActive');
        if (!panel || panel.classList.contains('d-none') || window.currentChat !== orderId) {
            stopChatPolling();
            return;
        }
        loadChatMessages(orderId, true);
    }, 4000);
}

function stopChatPolling() {
    if (window.chatPollInterval) {
        clearInterval(window.chatPollInterval);
        window.chatPollInterval = null;
    }
}

async function loadChatMessages(orderId, silent = false) {
    const container = window._chatActiveElements?.container || document.getElementById('chatMessagesContainer');
    if (!container) return;
    if (!silent) {
        container.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div><p class="small mt-2">Carregando mensagens...</p></div>';
    }
    try {
        const user = getSavedUser();
        let order = null;
        try {
            const r = await supabaseFetch(`orders?id=eq.${orderId}&limit=1`);
            order = r?.[0] || null;
        } catch (e) {}
        if (order) {
            const idx = ordersCache.findIndex(o => o.id === orderId);
            if (idx >= 0) ordersCache[idx] = order; else ordersCache.push(order);
        } else {
            order = ordersCache.find(o => o.id === orderId) || null;
        }
        let chatResult = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        let chat       = chatResult?.[0];
        if (!chat && order) {
            const newChat = {
                id: crypto.randomUUID(),
                order_id: orderId,
                seller_id: order.seller_id,
                seller_name: order.seller_name,
                buyer_id: order.buyer_id,
                buyer_name: order.buyer_name,
                participants: [order.seller_id, order.buyer_id],
                messages: [{senderId: 'system', text: `Pedido #${orderId.slice(-8).toUpperCase()}`, timestamp: new Date().toISOString(), type: 'system'}],
                logistics_agreed: false
            };
            await supabaseFetch('chats', {method: 'POST', body: JSON.stringify(newChat)});
            chat = newChat;
        }
        if (!chat?.messages) {
            if (!silent) container.innerHTML = '<div class="text-center py-4 text-muted">Nenhuma mensagem ainda.</div>';
            return;
        }
        window.__setupReactionHooks(chat,
            (c) => supabaseFetch(`chats?order_id=eq.${orderId}`, {method: 'PATCH', body: JSON.stringify({messages: c.messages})}),
            () => loadChatMessages(orderId, true)
        );
        let changed = false;
        const otherSenderIds = chat.participants.filter(id => id !== user.id);
        chat.messages.forEach(msg => {
            if (msg.senderId && otherSenderIds.includes(msg.senderId) && !msg.visto) {
                msg.visto = true; changed = true;
            }
        });
        if (changed) {
            supabaseFetch(`chats?order_id=eq.${orderId}`, {method: 'PATCH', body: JSON.stringify({messages: chat.messages})}).catch(() => {});
        }
        const signature = JSON.stringify(chat.messages);
        if (silent && signature === window.lastChatSignature) {
            updateChatLogistics(order, user);
            return;
        }
        const isNewIncoming = silent && window.lastChatSignature !== null && chat.messages.length > (JSON.parse(window.lastChatSignature || '[]').length || 0);
        window.lastChatSignature = signature;
        const wasNearBottom = !silent || (container.scrollHeight - container.scrollTop - container.clientHeight < 120);
        const myAvatar = normalizeImageUrl(safeParseImages(user.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.nome||'Você')}&background=22c98e&color=fff&size=40`;
        const partnerAvatarSrc = document.getElementById(`msgs_${orderId}Avatar`)?.src || window._chatActiveElements?.container?.closest('.chat-container')?.querySelector('.chat-header-avatar-wrap img')?.src || '';
        const supportAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent('Suporte')}&background=ffc107&color=1c1c1c&size=40`;
        container.innerHTML = chat.messages.map((msg, index) => {
            return window.renderMsgBubble(msg, index, {
                userId: user.id, myAvatar, partnerAvatar: partnerAvatarSrc, supportAvatar,
                resolveSenderName: () => msg.senderName || '',
                actions: {reply: 'startReply', copy: 'copyMessageText', edit: 'startEdit', delete: 'deleteMessage'},
                useDropdown: true, enableGrouping: true, allMessages: chat.messages
            });
        }).join('');
        if (wasNearBottom) {
            container.scrollTop = container.scrollHeight;
        } else if (isNewIncoming) {
            showToast('Nova mensagem recebida.', 'info', 2000);
        }
        updateChatLogistics(order, user);
    } catch (e) {
        if (silent) { console.error('Falha ao atualizar mensagens (silencioso):', e); return; }
        console.error(e);
        container.innerHTML = `<div class="text-center py-4 text-danger"><i class="bi bi-exclamation-triangle fs-1 d-block mb-2"></i><p>Erro ao carregar mensagens</p><button class="btn btn-primary btn-sm" onclick="loadChatMessages('${orderId}')">Tentar novamente</button></div>`;
    }
}

function stripLegacyEmoji(text) {
    if (!text) return '';
    return text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '').replace(/[ \t]{2,}/g, ' ').trim();
}
window.stripLegacyEmoji = stripLegacyEmoji;

function formatLinks(text) {
    if (!text) return '';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, url =>
        `<a href="${url}" target="_blank" class="text-info text-decoration-underline small"><i class="bi bi-link-45deg"></i>${url.substring(0,40)}${url.length>40?'...':''}</a>`
    );
}
window.formatLinks = formatLinks;

function updateChatLogistics(order, user) {
    const logisticsArea = window._chatActiveElements?.logistics || document.getElementById('logisticsAgreementArea');
    const logisticsButtons = window._chatActiveElements?.logisticsBtns || document.getElementById('logisticsButtons');
    if (!logisticsArea || !logisticsButtons) return;
    const isBuyer = user.id === order.buyer_id;
    const isSeller = user.id === order.seller_id;
    let buttonsHtml = '';
    if (['accepted', 'agreement'].includes(order.status)) {
        const userAgreed = isBuyer ? order.agree_buyer : order.agree_seller;
        const otherAgreed = isBuyer ? order.agree_seller : order.agree_buyer;
        if (order.agree_buyer && order.agree_seller) {
            if (isSeller) {
                    buttonsHtml += `${order.logistics_type === 'pickup'
                        ? `<button class="ml-attach w-100 mb-2" onclick="window.advanceLogisticsStatus('${order.id}','awaiting_pickup')"><i class="bi bi-check2-circle me-1"></i>Marcar como Pronto p/ Retirada</button>`
                        : order.logistics_type === 'external_app'
                        ? `<div class="external-delivery-section"><p class="fw-bold text-center mb-2" style="font-size:0.82rem;">Solicitar entrega via app</p><div class="d-flex gap-2 mb-2"><button class="ml-attach flex-grow-1" onclick="window.requestExternalDelivery('uber','${order.id}')"><i class="bi bi-uber"></i>Uber</button><button class="ml-attach flex-grow-1" onclick="window.requestExternalDelivery('99','${order.id}')"><i class="bi bi-phone"></i>99</button></div><div class="input-group input-group-sm"><input type="text" id="trackingInput_${order.id}" class="form-control" placeholder="Cole o código de rastreio..."><button class="ml-attach" onclick="window.sendTrackingCode('${order.id}')"><i class="bi bi-send"></i></button></div></div><button class="ml-attach w-100 mt-2" onclick="window.advanceLogisticsStatus('${order.id}','shipping')"><i class="bi bi-truck me-1"></i>Já solicitei — Marcar que Saiu p/ Entrega</button>`
                        : `<button class="ml-attach w-100 mb-2" onclick="window.advanceLogisticsStatus('${order.id}','shipping')"><i class="bi bi-truck me-1"></i>Marcar que Saiu p/ Entrega</button>`
                    }`;
            } else {
                buttonsHtml += `<div class="alert alert-success rounded-pill text-center small mb-2"><i class="bi bi-people-fill me-1"></i>Aguardando envio/retirada pelo vendedor</div>`;
            }
        } else if (!userAgreed) {
            if (otherAgreed && order.logistics_type) {
                const typeText = getLogisticsTypeText(order.logistics_type);
                buttonsHtml += `<p class="text-center small mb-2">A outra parte propôs: <strong>${typeText}</strong></p><div class="d-flex gap-2 mb-2"><button class="ml-attach ml-attach-success flex-grow-1" onclick="window.setLogistics('${order.id}','${order.logistics_type}')"><i class="bi bi-check-lg me-1"></i>Aceitar</button><button class="ml-attach ml-attach-danger flex-grow-1" onclick="window.resetLogistics('${order.id}')"><i class="bi bi-x-lg me-1"></i>Recusar</button></div>`;
            } else {
                buttonsHtml += `<div class="logistics-section"><p class="logistics-section-title">Como vai funcionar a entrega?</p><div class="logistics-options-row"><button class="logistics-option-btn" onclick="window.setLogistics('${order.id}','pickup')"><span class="icon-circle" style="background:#6f42c1;"><i class="bi bi-shop"></i></span><span class="option-label">Retirada no Local</span></button><button class="logistics-option-btn" onclick="window.setLogistics('${order.id}','seller_delivery')"><span class="icon-circle" style="background:#198754;"><i class="bi bi-truck"></i></span><span class="option-label">Entrega pelo Vendedor</span></button><button class="logistics-option-btn" onclick="window.setLogistics('${order.id}','external_app')"><span class="icon-circle" style="background:#fd7e14;"><i class="bi bi-phone"></i></span><span class="option-label">App de Entrega</span></button></div></div>`;
            }
        } else {
            buttonsHtml += `<div class="alert alert-info rounded-pill text-center small mb-2"><i class="bi bi-hourglass-split me-1"></i>Proposta enviada! Aguardando o outro lado...</div>`;
        }
    } else if (['shipping', 'awaiting_pickup'].includes(order.status)) {
        if (isBuyer) {
            buttonsHtml += `<button class="ml-attach ml-attach-success w-100 mb-2" onclick="window.confirmReceipt('${order.id}')"><i class="bi bi-box-seam-fill me-1"></i>Confirmar Recebimento</button><button class="ml-attach ml-attach-danger w-100 mb-2" onclick="window.requestOrderSupport('${order.id}','produto_nao_recebido')"><i class="bi bi-headset me-1"></i>Não recebi o produto</button>`;
        } else {
            buttonsHtml += `<div class="alert alert-primary rounded-pill text-center small mb-2">Aguardando o comprador confirmar recebimento</div><button class="ml-attach ml-attach-danger w-100 mb-2" onclick="window.requestOrderSupport('${order.id}','entrega_sem_confirmacao')"><i class="bi bi-headset me-1"></i>Já entreguei, mas o comprador não confirmou</button>`;
        }
    } else if (order.status === 'finished') {
        const reviewedLocal = (uid) => { try { return !!localStorage.getItem(`reviewed_${order.id}_${uid}`); } catch (e) { return false; } };
        if (isBuyer) {
            buttonsHtml += (order.buyer_reviewed || reviewedLocal(user.id))
                ? `<div class="alert alert-success rounded-pill text-center small mb-2"><i class="bi bi-patch-check-fill me-1"></i>Avaliação recebida pelo vendedor</div>`
                : `<button class="ml-attach ml-attach-warning w-100 mb-2" onclick="window.openReviewModal('${order.id}','buyer_rates_seller')"><i class="bi bi-star-fill me-1"></i>Avaliar Vendedor</button>`;
        } else {
            buttonsHtml += (order.seller_reviewed || reviewedLocal(user.id))
                ? `<div class="alert alert-success rounded-pill text-center small mb-2"><i class="bi bi-patch-check-fill me-1"></i>Avaliação recebida pelo comprador</div>`
                : `<button class="ml-attach ml-attach-warning w-100 mb-2" onclick="window.openReviewModal('${order.id}','seller_rates_buyer')"><i class="bi bi-star-fill me-1"></i>Avaliar Comprador</button>`;
        }
    }
    logisticsButtons.innerHTML = buttonsHtml;
    const statusBar = window._chatActiveElements?.statusBar || document.getElementById('orderStatusBar');
    if (statusBar && order) {
        const statusMap = {
            'pending': '<i class="bi bi-hourglass-split me-1"></i>Aguardando Aprovação',
            'accepted': '<i class="bi bi-check-circle-fill me-1"></i>Aprovado - Combinar Entrega',
            'agreement': '<i class="bi bi-people-fill me-1"></i>Definindo Logística',
            'shipping': '<i class="bi bi-truck me-1"></i>Em Transporte',
            'awaiting_pickup': '<i class="bi bi-geo-alt-fill me-1"></i>Aguardando Retirada',
            'finished': '<i class="bi bi-patch-check-fill me-1"></i>Finalizado',
            'cancelled': '<i class="bi bi-x-circle-fill me-1"></i>Cancelado',
            'dispute': '<i class="bi bi-exclamation-triangle-fill me-1"></i>Em Disputa'
        };
        const alertClass = order.status === 'finished' ? 'success' : order.status === 'cancelled' ? 'danger' : 'info';
        statusBar.innerHTML = `<div class="alert alert-${alertClass} mb-0 py-2 text-center small">${statusMap[order.status] || order.status}</div>`;
    }
}

window.sendChatMessage = async function(event) {
    if (event?.preventDefault) event.preventDefault();
    const input = window._chatActiveElements?.input || document.getElementById('chatMessageInput');
    const text = input?.value?.trim();
    const user = getSavedUser();
    if ((!text && window.editingMessageIndex === null) || !user || !window.currentChat) return;
    try {
        const chatResult = await supabaseFetch(`chats?order_id=eq.${window.currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Chat não encontrado.', 'error'); return; }
        if (window.editingMessageIndex !== null) {
            chat.messages[window.editingMessageIndex].text = text;
            chat.messages[window.editingMessageIndex].edited = true;
        } else {
            const newMessage = {senderId: user.id, senderName: user.nome, text, timestamp: new Date().toISOString(), type: 'message'};
            if (window.currentReplyIndex !== null) {
                const repliedMsg = chat.messages[window.currentReplyIndex];
                newMessage.replyTo = {text: repliedMsg.text, senderName: repliedMsg.senderName};
            }
            chat.messages.push(newMessage);
        }
        await supabaseFetch(`chats?id=eq.${chat.id}`, {method: 'PATCH', body: JSON.stringify({messages: chat.messages})});
        input.value = '';
        window.cancelReplyOrEdit();
        await loadChatMessages(window.currentChat);
    } catch (e) { showToast('Erro ao enviar mensagem.', 'error'); }
};

window.sendChatImageFile = async function(input) {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const btn = input?.closest('.chat-container')?.querySelector('label') || document.querySelector('#chatAttachPanel label');
    const original = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Enviando...';
    const clientId = window.CONFIG?.IMGUR_CLIENT_ID || window.CONFIG_LOCAL_FALLBACK?.IMGUR_CLIENT_ID || '546c25a59c58ad7';
    try {
        const fd = new FormData();
        fd.append('image', file, file.name || 'imagem.jpg');
        const res = await fetch('https://api.imgur.com/3/image', {method: 'POST', headers: {Authorization: `Client-ID ${clientId}`}, body: fd});
        const json = await res.json().catch(() => null);
        if (btn) btn.innerHTML = original;
        if (json?.success && json?.data?.link) {
            await window.sendChatImage(json.data.link);
            window._chatActiveElements?.attachPanel?.classList.add('d-none');
            document.getElementById('chatAttachPanel')?.classList.add('d-none');
        } else {
            showToast('Falha ao enviar imagem (tente um link).', 'error');
        }
    } catch (e) { if (btn) btn.innerHTML = original; showToast('Erro ao enviar imagem.', 'error'); }
};

window.sendChatImage = async function(urlParam) {
    const rawUrl = urlParam;
    if (!rawUrl || !(rawUrl.startsWith('http') || rawUrl.startsWith('data:'))) { showToast('Link inválido!', 'warning'); return; }
    const url = normalizeImageUrl(rawUrl);
    const user = getSavedUser();
    if (!user || !window.currentChat) return;
    const isVideo = /\.(mp4|webm|ogg|mov)$/i.test(url) || /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
    const isGif = /\.gif$/i.test(url);
    try {
        const chatResult = await supabaseFetch(`chats?order_id=eq.${window.currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Chat não encontrado.', 'error'); return; }
        const msg = {senderId: user.id, senderName: user.nome, text: isVideo ? 'Vídeo' : (isGif ? 'GIF' : 'Imagem'), timestamp: new Date().toISOString()};
        if (isVideo) { msg.type = 'video'; msg.video = url; }
        else { msg.type = 'image'; msg.image = url; }
        chat.messages.push(msg);
        await supabaseFetch(`chats?id=eq.${chat.id}`, {method: 'PATCH', body: JSON.stringify({messages: chat.messages})});
        await loadChatMessages(window.currentChat);
    } catch (e) { showToast('Erro ao processar o link.', 'error'); }
};

window.sendChatFile = async function(urlParam) {
    const url = urlParam;
    if (!url || !url.startsWith('http')) { showToast('Link inválido!', 'warning'); return; }
    const user = getSavedUser();
    if (!user || !window.currentChat) return;
    try {
        const chatResult = await supabaseFetch(`chats?order_id=eq.${window.currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) return;
        chat.messages.push({senderId: user.id, senderName: user.nome, text: `Arquivo: ${url.split('/').pop()}`, file: {name:'Arquivo Externo', url, size:0}, timestamp: new Date().toISOString(), type:'file'});
        await supabaseFetch(`chats?id=eq.${chat.id}`, {method: 'PATCH', body: JSON.stringify({messages: chat.messages})});
        await loadChatMessages(window.currentChat);
    } catch { showToast('Erro ao enviar arquivo.', 'error'); }
};

window.toggleChatAttachPanel = function() {
    const panel = window._chatActiveElements?.attachPanel || document.getElementById('chatAttachPanel');
    if (!panel) return;
    const logistics = window._chatActiveElements?.logistics || document.getElementById('logisticsAgreementArea');
    if (logistics) logistics.classList.remove('show-menu');
    panel.classList.toggle('d-none');
    if (!panel.classList.contains('d-none')) {
        const orderId = window.currentChat;
        (document.getElementById(`attachLink_${orderId}`) || document.getElementById('chatAttachLinkInput'))?.focus();
    }
};

window.setChatAttachType = function(type, panelId) {
    chatAttachType = type;
    const panel = panelId ? document.getElementById(panelId) : null;
    const tabs = panel ? panel.querySelectorAll('.chat-attach-tab') : document.querySelectorAll('.chat-attach-tab');
    tabs.forEach(btn => btn.classList.toggle('active', btn.dataset.attachType === type));
    if (panel) {
        const mapping = { image: `${panelId}ImageBox`, file: `${panelId}FileBox`, location: `${panelId}LocationBox` };
        Object.entries(mapping).forEach(([t, id]) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('d-none', type !== t);
        });
    }
};

window.abrirDocHost = function(host) {
    const url = host === 'Google Drive' ? 'https://drive.google.com/u/0/?usp=upload' : 'https://onedrive.live.com/?auth=1&id=root&cid=&action=upload';
    window.open(url, '_blank', 'noopener');
    showToast(`Abra o ${host}, copie o link e cole em Documentos.`, 'info');
};

window.sendChatLocation = async function(kind) {
    const user = getSavedUser();
    if (!user || !window.currentChat) return;
    if (kind === 'current') {
        if (!navigator.geolocation) { showToast('Geolocalização não suportada.', 'error'); return; }
        showToast('Obtendo sua localização...', 'info');
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const {latitude, longitude} = pos.coords;
            const maps = `https://www.google.com/maps?q=${latitude},${longitude}`;
            await sendLocationMessage(maps, `Localização atual: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        }, () => showToast('Não foi possível obter a localização.', 'error'), {enableHighAccuracy: true, timeout: 10000});
        return;
    }
    if (kind === 'stored') {
        const u = getSavedUser() || {};
        const endereco = [u.endereco, u.cidade, u.estado, u.cep].filter(Boolean).join(', ');
        const maps = u.maps || (endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}` : '');
        if (!maps) { showToast('Você não tem endereço cadastrado no perfil.', 'warning'); return; }
        sendLocationMessage(maps, `📍 Meu endereço cadastrado: ${endereco || maps}`);
        return;
    }
    const input = document.getElementById(`attachLink_${window.currentChat}Loc`) || document.getElementById('chatAttachLinkInputLoc');
    const url = input?.value?.trim();
    if (!url || !url.startsWith('http')) { showToast('Cole um link de endereço válido.', 'warning'); return; }
    sendLocationMessage(url, `Endereço (link): ${url}`);
    input.value = '';
    (window._chatActiveElements?.attachPanel || document.getElementById('chatAttachPanel'))?.classList.add('d-none');
};

async function sendLocationMessage(mapsUrl, text) {
    const user = getSavedUser();
    if (!user || !window.currentChat) return;
    try {
        const chatResult = await supabaseFetch(`chats?order_id=eq.${window.currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) return;
        chat.messages.push({senderId: user.id, senderName: user.nome, text, location: mapsUrl, timestamp: new Date().toISOString(), type:'location'});
        await supabaseFetch(`chats?id=eq.${chat.id}`, {method:'PATCH', body: JSON.stringify({messages: chat.messages})});
        await loadChatMessages(window.currentChat);
        (window._chatActiveElements?.attachPanel || document.getElementById('chatAttachPanel'))?.classList.add('d-none');
    } catch { showToast('Erro ao enviar localização.', 'error'); }
}

window.setChatDocType = function(docType) {
    const orderId = window.currentChat;
    const input = document.getElementById(`attachLink_${orderId}File`) || document.getElementById('chatAttachLinkInputFile');
    if (!input) return;
    const prefixo = docType ? `[${docType}] ` : '';
    if (!input.value.startsWith('[')) input.value = prefixo + input.value;
    input.focus();
};

window.confirmChatAttach = async function() {
    if (chatAttachType === 'location') { window.sendChatLocation('other'); return; }
    const orderId = window.currentChat;
    const suffix = chatAttachType === 'file' ? 'File' : '';
    const input = document.getElementById(`attachLink_${orderId}${suffix}`) || document.getElementById(chatAttachType === 'file' ? 'chatAttachLinkInputFile' : 'chatAttachLinkInput');
    const url = input?.value?.trim();
    if (!url || !url.startsWith('http')) { showToast('Cole um link válido (começando com http).', 'warning'); return; }
    if (chatAttachType === 'image') await window.sendChatImage(url);
    else await window.sendChatFile(url);
    input.value = '';
    (window._chatActiveElements?.attachPanel || document.getElementById('chatAttachPanel'))?.classList.add('d-none');
};

window.openImageFull = function(src) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
    modal.innerHTML = `<img src="${src}" style="max-width:90%;max-height:90%;border-radius:8px;" onerror="this.onerror=null;this.style.display='none'">`;
    modal.onclick = () => modal.remove();
    document.body.appendChild(modal);
};

function getLogisticsTypeText(type) {
    if (type === 'pickup') return 'Retirada no Local';
    if (type === 'seller_delivery') return 'Entrega pelo Vendedor';
    if (type === 'external_app') return 'App de Entrega';
    return type;
}

window.requestExternalDelivery = async function(app, orderId) {
    try {
        const data = await supabaseFetch(`orders?id=eq.${orderId}&limit=1`);
        const order = data?.[0];
        if (!order) return showToast('Pedido não encontrado', 'danger');
        const sellerData = await supabaseFetch(`users?id=eq.${order.seller_id}&limit=1`);
        const buyerData = await supabaseFetch(`users?id=eq.${order.buyer_id}&limit=1`);
        const seller = sellerData?.[0];
        const buyer = buyerData?.[0];
        const pickup = seller?.endereco || 'Endereço do vendedor';
        const dropoff = buyer?.endereco || 'Endereço do comprador';
        const text = `Retirada: ${pickup}\nEntrega: ${dropoff}`;
        await navigator.clipboard.writeText(text);
        showToast('Endereços copiados!', 'success');
        if (app === 'uber') {
            window.open('https://m.uber.com/', '_blank');
        } else {
            window.open('https://99app.com/', '_blank');
        }
    } catch (e) {
        showToast('Erro ao abrir app de entrega', 'danger');
    }
};

window.sendTrackingCode = async function(orderId) {
    const input = document.getElementById(`trackingInput_${orderId}`);
    if (!input || !input.value.trim()) return showToast('Cole o código de rastreio', 'warning');
    const user = getSavedUser();
    if (!user) return;
    const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
    const chat = chatData?.[0];
    if (!chat) return;
    const msg = {
        senderId: user.id,
        senderName: user.nome,
        text: `🔗 Código de rastreio: ${input.value.trim()}`,
        timestamp: new Date().toISOString(),
        type: 'tracking'
    };
    chat.messages.push(msg);
    await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
    input.value = '';
    showToast('Código de rastreio enviado!', 'success');
    loadChatMessages(orderId);
};

// ============================================
// AÇÕES COMPARTILHADAS DE CHAT (reply, edit, delete, copy)
// ============================================

window.startReply = async function(index) {
    const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
    const msg = chatResult?.[0]?.messages[index];
    if (!msg) return;

    currentReplyIndex = index;
    editingMessageIndex = null;
    
    const preview = window._chatActiveElements?.preview || document.getElementById('chatInputPreview');
    preview.classList.remove('d-none');
    preview.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
            <div class="small text-truncate" style="max-width: 85%;">
                <strong class="text-primary d-block">Respondendo a ${msg.senderName}</strong>
                <span class="text-muted">${msg.text}</span>
            </div>
            <i class="bi bi-x-lg cursor-pointer" onclick="window.cancelReplyOrEdit()"></i>
        </div>`;
    (window._chatActiveElements?.input || document.getElementById('chatMessageInput'))?.focus();
};

window.startEdit = async function(index) {
    const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
    const msg = chatResult?.[0]?.messages[index];
    if (!msg) return;

    editingMessageIndex = index;
    currentReplyIndex = null;

    const input = window._chatActiveElements?.input || document.getElementById('chatMessageInput');
    input.value = msg.text;
    
    const preview = window._chatActiveElements?.preview || document.getElementById('chatInputPreview');
    preview.classList.remove('d-none');
    preview.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
            <div class="small"><strong class="text-warning">Editando mensagem...</strong></div>
            <i class="bi bi-x-lg cursor-pointer" onclick="window.cancelReplyOrEdit()"></i>
        </div>`;
    input.focus();
};

window.cancelReplyOrEdit = function() {
    currentReplyIndex = null;
    editingMessageIndex = null;
    const preview = window._chatActiveElements?.preview || document.getElementById('chatInputPreview');
    if (preview) {
        preview.classList.add('d-none');
        preview.innerHTML = '';
    }
    const input = window._chatActiveElements?.input || document.getElementById('chatMessageInput');
    if (input && !currentReplyIndex) input.value = '';
};

window.copyMessageText = async function(index) {
    try {
        const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
        const msg = chatResult?.[0]?.messages[index];
        if (!msg?.text) return;
        await navigator.clipboard.writeText(msg.text);
        showToast('Mensagem copiada!', 'success', 1500);
    } catch (e) {
        showToast('Não foi possível copiar.', 'error');
    }
};

window.deleteMessage = async function(index) {
    if (!confirm('Apagar esta mensagem para todos?')) return;
    try {
        const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat?.messages[index]) return;
        chat.messages[index].text = '';
        chat.messages[index].image = null;
        chat.messages[index].file = null;
        chat.messages[index].deleted = true;
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        loadChatMessages(currentChat);
    } catch (e) {
        showToast('Erro ao apagar mensagem.', 'error');
    }
};

// ============================================
// AÇÕES DE CHAT DO CLIENTE (pull-to-refresh, chat actions toggle)
// ============================================

function setupPullToRefresh() {
    const container = window._chatActiveElements?.container || document.getElementById('chatMessagesContainer');
    if (!container) return;
    let startY = 0;
    
    container.addEventListener('touchstart', e => startY = e.touches[0].pageY, {passive: true});
    container.addEventListener('touchend', e => {
        const moveY = e.changedTouches[0].pageY - startY;
        if (container.scrollTop === 0 && moveY > 100) {
            loadChatMessages(currentChat);
            showToast('Atualizando...', 'info', 1000);
        }
    }, {passive: true});
}

/**
 * Abre/Fecha a aba superior de processos de entrega
 */
window.toggleChatActions = function() {
    const area = window._chatActiveElements?.logistics || document.getElementById('logisticsAgreementArea');
    if (area) {
        const attachPanel = window._chatActiveElements?.attachPanel || document.getElementById('chatAttachPanel');
        if (attachPanel) attachPanel.classList.add('d-none');
        area.classList.toggle('show-menu');
    }
};

window.viewChatPartnerProfile = async function() {
    const user = getSavedUser();
    let order = ordersCache.find(o => o.id === currentChat);
    if (!order) {
        const r = await supabaseFetch(`orders?id=eq.${currentChat}&limit=1`);
        order = r?.[0];
    }
    if (!order) return;
    const isBuyer = user.id === order.buyer_id;
    const partnerId = isBuyer ? order.seller_id : order.buyer_id;
    const partnerName = isBuyer ? order.seller_name : order.buyer_name;
    let partner = null;
    try {
        const r = await supabaseFetch(`users?select=nome,avatar,vendedor_rating,rating_count,created_at,last_seen&id=eq.${partnerId}&limit=1`);
        partner = r?.[0];
    } catch (e) {}
    const avatar = normalizeImageUrl(safeParseImages(partner?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(partnerName || 'User')}&background=random&size=100`;
    const rating = partner?.vendedor_rating ? parseFloat(partner.vendedor_rating).toFixed(1) : '—';
    const ratingCount = partner?.rating_count || 0;
    const memberSince = partner?.created_at ? new Date(partner.created_at).toLocaleDateString('pt-BR', {month:'long', year:'numeric'}) : '—';
    const online = isRecentlyOnline(partner?.last_seen);
    let modalEl = document.getElementById('partnerProfileModal');
    if (!modalEl) {
        modalEl = document.createElement('div');
        modalEl.id = 'partnerProfileModal';
        modalEl.className = 'modal fade';
        modalEl.tabIndex = -1;
        document.body.appendChild(modalEl);
    }
    modalEl.innerHTML = `
        <div class="modal-dialog modal-dialog-centered modal-sm">
            <div class="modal-content border-0 shadow-lg" style="border-radius:16px;">
                <div class="modal-body text-center p-4">
                    <button type="button" class="ml-auth-close" data-bs-dismiss="modal" aria-label="Fechar" style="border-radius:50%;width:34px;height:34px;font-size:0.9rem;"><i class="bi bi-x-lg"></i></button>
                    <div class="position-relative d-inline-block mb-3">
                        <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;" class="border" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&size=80'">
                        <span class="presence-dot ${online ? 'online' : 'offline'}" style="width:16px;height:16px;border:2px solid #fff;"></span>
                    </div>
                    <h5 class="fw-bold mb-1">${partner?.nome || partnerName || 'Usuário'}</h5>
                    <p class="small mb-2 fw-bold ${online ? 'text-success' : 'text-muted'}">${online ? '● Online agora' : '○ Offline'}</p>
                    <p class="text-muted small mb-3"><i class="bi bi-calendar3 me-1"></i>Na plataforma desde ${memberSince}</p>
                    <div class="d-flex justify-content-center align-items-center gap-2 mb-3">
                        <i class="bi bi-star-fill text-warning"></i>
                        <span class="fw-bold">${rating}</span>
                        <span class="text-muted small">(${ratingCount} avaliações)</span>
                    </div>
                    <button class="ml-attach w-100 mb-2" onclick="window.showUserReviews('${partnerId}','${partner?.nome || partnerName || 'Usuário'}')">
                        <i class="bi bi-star me-1"></i>Ver avaliações
                    </button>
                    <button class="ml-attach ml-attach-secondary w-100" onclick="bootstrap.Modal.getInstance(document.getElementById('partnerProfileModal'))?.hide(); window.startDirectChat('${partnerId}');">
                        <i class="bi bi-chat-dots me-1"></i>Conversar
                    </button>
                </div>
            </div>
        </div>`;
    new bootstrap.Modal(modalEl).show();
};

window.chatCancelOrder = async function(orderId) {
    if (!confirm('Tem certeza que deseja cancelar este pedido?')) return;
    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'cancelled', updated_at: new Date().toISOString() })
        });
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = chatData[0];
        if (chat) {
            chat.messages.push({ senderId: 'system', text: 'O pedido foi cancelado por uma das partes.', timestamp: new Date().toISOString(), type: 'system' });
            await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        }
        showToast('Pedido cancelado!', 'info');
        window.toggleChatActions();
        loadChatMessages(orderId);
    } catch { showToast('Erro ao cancelar.', 'error'); }
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

    const themeSwitchProfile = document.getElementById('themeSwitchProfile');
    if (themeSwitchProfile) themeSwitchProfile.checked = modoEscuro;

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
    // OAuth callback: se a URL contiver access_token, processa login Google
    if (window.location.hash && window.location.hash.includes('access_token')) {
        handleGoogleOAuthCallback();
        return;
    }

    // Aplicar tema salvo
    if (localStorage.getItem('modoEscuro') === 'true') {
        document.body.classList.add('dark-theme');
    }
    // Sincronizar toggle do perfil com estado atual
    const themeProfileCheck = document.getElementById('themeSwitchProfile');
    if (themeProfileCheck) themeProfileCheck.checked = document.body.classList.contains('dark-theme');

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
            const cached = allProductsCache.find(x => x.id == pid || x.id === pid);
            if (cached) {
                window.showDetail(pid);
            } else {
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
            return;
        }

        const sellerMatch = window.location.hash.match(/^#\/vendedor\/(.+)/);
        if (sellerMatch) {
            const sid = sellerMatch[1];
            window.showSellerProfile(sid, '');
        }
    }
    window.addEventListener('hashchange', navigateByHash);
    // Verifica hash na inicialização — ANTES de loadPage
    window._hashNavigation = window.location.hash.startsWith('#/produto/') || window.location.hash.startsWith('#/vendedor/');
    if (window._hashNavigation) navigateByHash();

    // Init
    updateUI();
    window.renderCart();
    window.setupAutoComplete();
    window.updateChatBadge();

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

window.mlCadNextStep = async function() {
    // Valida os campos obrigatórios do passo 1 antes de avançar
    const requiredIds = ['v2CadNome', 'v2CadCPF', 'v2CadTelefone', 'v2CadEmail', 'v2CadPass'];
    for (const id of requiredIds) {
        const el = document.getElementById(id);
        if (el && !el.reportValidity()) return;
    }
    // Valida CPF
    const cpfInput = document.getElementById('v2CadCPF');
    if (cpfInput) {
        const cpf = cpfInput.value.replace(/\D/g, '');
        if (!validarCPF(cpf)) {
            showToast('CPF inválido! Verifique os números.', 'error');
            cpfInput.focus();
            return;
        }
    }
    // Verifica se o e-mail já está cadastrado
    const emailInput = document.getElementById('v2CadEmail');
    if (emailInput) {
        const r = await window.checkEmailExists(emailInput.value);
        if (r.exists) {
            showToast('Este e-mail já está cadastrado. Use outro e-mail ou faça login.', 'error');
            emailInput.classList.add('is-invalid');
            emailInput.focus();
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
  const user = getSavedUser();
  const nome = user?.nome || 'Usuário';
  const userEmail = user?.email || '';
  const body = `
Nova solicitação de suporte:

━━━━ DADOS DO SOLICITANTE ━━━━
Nome: ${nome}
E-mail: ${userEmail || 'não informado'}
Tipo: ${user?.tipo || 'Visitante'}

━━━━ SOLICITAÇÃO ━━━━
Assunto: Esqueci minha senha
Mensagem: Olá, esqueci minha senha e preciso de ajuda para recuperar o acesso à minha conta.

━━━━━━━━━━━━━━━━━━━━━━
ElectroMarket - Plataforma de E-commerce
  `.trim();
  const mailto = `mailto:dannybarbosadelimabr@gmail.com?subject=${encodeURIComponent('[Suporte ElectroMarket] Esqueci minha senha')}&body=${encodeURIComponent(body)}`;
  window.location.href = mailto;
  showToast('E-mail aberto no seu programa de e-mail para solicitar recuperação de senha.', 'success');
};

// ============================================
// GOOGLE LOGIN (via Supabase OAuth)
// ============================================

window.loginWithGoogle = function() {
    const redirectTo = window.location.origin + window.location.pathname;
    window.location.href =
        `${CONFIG.SUPABASE_URL}/auth/v1/authorize` +
        `?provider=google` +
        `&redirect_to=${encodeURIComponent(redirectTo)}`;
};

/** Processa o retorno do OAuth do Google (access_token na hash da URL) */
async function handleGoogleOAuthCallback() {
    const params = new URLSearchParams(window.location.hash.replace('#', '?'));
    const accessToken = params.get('access_token');
    if (!accessToken) return;

    try {
        const res = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/user`, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': CONFIG.SUPABASE_KEY }
        });
        const authUser = await res.json();
        if (!authUser?.email) return;

        const existing = await supabaseFetch(`users?email=eq.${encodeURIComponent(authUser.email)}&limit=1`);
        if (existing?.length) {
            localStorage.setItem('electroUser', JSON.stringify(existing[0]));
        } else {
            const newUser = {
                id: crypto.randomUUID(),
                tipo: 'CLIENTE',
                nome: authUser.user_metadata?.full_name || authUser.email,
                email: authUser.email,
                avatar: JSON.stringify([authUser.user_metadata?.avatar_url || '', '']),
                telefone: '',
                senha_hash: '',
                created_at: new Date().toISOString()
            };
            await supabaseFetch('users', { method: 'POST', body: JSON.stringify(newUser) });
            localStorage.setItem('electroUser', JSON.stringify(newUser));
        }

        history.replaceState(null, '', window.location.pathname + window.location.search);
        updateUI();
        showToast('Login com Google realizado!', 'success');
        setTimeout(() => location.reload(), 500);
    } catch {
        showToast('Erro ao autenticar com Google.', 'error');
        setTimeout(() => location.reload(), 1500);
    }
}

// ============================================
// IA — ASSISTENTE DE SUPORTE (Transformers.js — 100% local, sem API key)
// ============================================

/**
 * Carrega o Transformers.js dinamicamente via esm.sh e cria o pipeline.
 * O modelo (LaMini-Flan-T5-77M) é baixado uma vez do Hugging Face Hub
 * e cacheado no IndexedDB do navegador.
 */
let _aiPipeline = null;
let _aiStatus = 'idle';

async function _getAiPipeline() {
    if (_aiPipeline) return _aiPipeline;
    if (_aiStatus === 'loading') return null;
    if (_aiStatus === 'error') return null;

    _aiStatus = 'loading';
    showToast('Carregando IA local... (primeira vez baixa o modelo, pode demorar)', 'info', 5000);

    try {
        const { pipeline } = await import('https://esm.sh/@xenova/transformers@2.17.1');
        _aiPipeline = await pipeline('text2text-generation', 'Xenova/LaMini-Flan-T5-77M', {
            progress_callback: (p) => {
                if (p.status === 'progress' && p.progress != null) {
                    const pct = Math.round(p.progress * 100);
                    if (pct % 20 === 0 || pct === 100) {
                        showToast(`Baixando modelo IA: ${pct}%`, 'info', 3000);
                    }
                }
            }
        });
        _aiStatus = 'ready';
        showToast('IA local carregada!', 'success', 2000);
        return _aiPipeline;
    } catch (e) {
        _aiStatus = 'error';
        showToast('Erro ao carregar IA: ' + (e.message || e), 'error', 5000);
        return null;
    }
}

window.callAI = async function(messages, options = {}) {
    const pipe = await _getAiPipeline();
    if (!pipe) { showToast('IA indisponível no momento.', 'warning'); return null; }

    const lastMsgs = messages.slice(-4);
    const context = lastMsgs.map(m => `${m.role === 'user' ? 'Cliente' : 'Atendente'}: ${m.content}`).join('\n');

    const prompt = `Gere uma resposta de suporte educada e útil em português para esta conversa:\n${context}\n\nResposta:`;

    try {
        const result = await pipe(prompt, { max_new_tokens: 150, temperature: 0.7, do_sample: true });
        const text = result?.[0]?.generated_text || '';
        return text.replace(prompt, '').trim() || null;
    } catch (e) {
        showToast('Erro ao gerar resposta: ' + (e.message || e), 'error');
        return null;
    }
};

window.suggestSupportReply = async function() {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) { showToast('Nenhum chamado ativo.', 'warning'); return; }

    const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
    const ticket = result?.[0];
    if (!ticket) return;

    const msgs = (ticket.messages || []).filter(m => m.type !== 'system' && !m.deleted);
    const lastMsgs = msgs.slice(-8).map(m => ({
        role: m.isStaff ? 'assistant' : 'user',
        content: `${m.senderName || 'Usuário'}: ${m.text || ''}`
    }));

    const reply = await window.callAI(lastMsgs, { temperature: 0.5, max_tokens: 200 });
    if (reply) {
        const input = window._chatActiveElements?.input;
        if (input) { input.value = reply; input.focus(); }
    }
};

// ============================================
// VERIFICAÇÃO DE E-MAIL DUPLICADO
// ============================================

window.checkEmailExists = async function(email) {
    if (!email) return { exists: false };
    try {
        const data = await supabaseFetch(`users?select=id&email=eq.${encodeURIComponent(email)}&limit=1`);
        return { exists: data && data.length > 0 };
    } catch { return { exists: false }; }
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

        // Verifica se o e-mail já está cadastrado
        const emailExiste = await window.checkEmailExists(payload.email);
        if (emailExiste.exists) {
            showToast('Este e-mail já está cadastrado. Faça login ou use outro e-mail.', 'error');
            document.getElementById('v2CadEmail')?.classList.add('is-invalid');
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

// Verificação de e-mail duplicado ao sair do campo
document.getElementById('v2CadEmail')?.addEventListener('blur', async function() {
    const msgEl = document.getElementById('v2CadEmailMsg');
    if (!this.value) { this.classList.remove('is-valid', 'is-invalid'); if (msgEl) msgEl.textContent = ''; return; }
    const r = await window.checkEmailExists(this.value);
    this.classList.toggle('is-invalid', r.exists);
    this.classList.toggle('is-valid', !r.exists);
    if (msgEl) {
        msgEl.textContent = r.exists ? 'Este e-mail já está cadastrado.' : '';
        msgEl.className = 'ml-field-msg' + (r.exists ? ' is-invalid' : ' is-valid');
    }
});

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
    const nextMsg = enableGrouping && allMessages[index + 1];
    const isGrouped = prevMsg && prevMsg.senderId === msg.senderId && prevMsg.type !== 'system' && !!prevMsg.isStaff === isStaff;
    const isGroupContinuation = nextMsg && nextMsg.senderId === msg.senderId && nextMsg.type !== 'system' && !!nextMsg.isStaff === isStaff;

    let bubblePosition = 'msg-single';
    if (isGrouped && isGroupContinuation) bubblePosition = 'msg-middle';
    else if (isGrouped) bubblePosition = 'msg-last';
    else if (isGroupContinuation) bubblePosition = 'msg-first';

    const showAvatar = !isGroupContinuation;

    if (msg.deleted) {
        return `
        <div class="msg-row ${isMe ? 'is-me' : 'is-them'}${isGrouped ? ' msg-grouped' : ''}">
            ${!isMe && !isGrouped ? `<img class="msg-avatar" src="${avatarForThem}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">` : ''}
            ${!isMe && isGrouped ? '<div class="msg-avatar-spacer"></div>' : ''}
            <div class="msg-bubble ${isMe ? 'is-me' : 'is-them'} msg-deleted ${bubblePosition}">
                <i class="bi bi-slash-circle me-1"></i><em>Mensagem apagada</em>
            </div>
            ${isMe && showAvatar ? `<img class="msg-avatar" src="${myAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">` : ''}
            ${isMe && !showAvatar ? '<div class="msg-avatar-spacer"></div>' : ''}
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
    <div class="msg-row ${isMe ? 'is-me' : 'is-them'}${isGrouped ? ' msg-grouped' : ''}">
        ${!isMe && !isGrouped ? `<img class="msg-avatar" src="${avatarForThem}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">` : ''}
        ${!isMe && isGrouped ? '<div class="msg-avatar-spacer"></div>' : ''}
        <div class="msg-bubble ${isMe ? 'is-me' : 'is-them'}${isStaff ? ' is-staff' : ''} ${bubblePosition}" style="margin-bottom:${reaction ? '10px' : '0'}">
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
            ${isMe && showAvatar ? `<img class="msg-avatar" src="${myAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">` : ''}
            ${isMe && !showAvatar ? '<div class="msg-avatar-spacer"></div>' : ''}
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
        let avaliacoes = [];

        // 1) Pega os pedidos deste produto
        const orders = await supabaseFetch(`orders?product_id=eq.${productId}&select=id`);
        const orderIds = orders && orders.length > 0 ? orders.map(o => o.id) : [];

        // 2) Tenta ler da tabela avaliacoes primeiro (persistente)
        if (orderIds.length > 0) {
            try {
                const rows = await supabaseFetch(`avaliacoes?order_id=in.(${orderIds.join(',')})&select=*`);
                if (rows && rows.length > 0) {
                    avaliacoes = rows.map(r => ({
                        rating:          r.rating || 0,
                        comment:         r.comment || '',
                        images:          (typeof r.images === 'string' ? JSON.parse(r.images) : r.images) || [],
                        videos:          (typeof r.videos === 'string' ? JSON.parse(r.videos) : r.videos) || [],
                        avaliador_nome:  r.avaliador_nome || 'Anônimo',
                        avaliador_avatar: r.avaliador_avatar || '',
                        avaliador_id:    r.avaliador_id || '',
                        created_at:      r.created_at
                    }));
                }
            } catch (e) {
                // Tabela não disponível — fallback para chat
            }
        }

        // 3) Fallback: ler dos chats.messages (pra avaliações antigas que não foram pra tabela)
        if (avaliacoes.length === 0 && orderIds.length > 0) {
            try {
                const chats = await supabaseFetch(`chats?order_id=in.(${orderIds.join(',')})&select=messages`);
                (chats || []).forEach(chat => {
                    (chat.messages || []).forEach(m => {
                        if (m.type === 'review') {
                            avaliacoes.push({
                                rating:         m.rating || 0,
                                comment:        m.reviewComment || m.text?.split('\n\n')[1]?.trim() || '',
                                images:         m.reviewImages || (m.image ? [m.image] : []),
                                avaliador_nome: m.senderName || 'Anônimo',
                                avaliador_avatar: m.avaliadorAvatar || '',
                                created_at:     m.timestamp || chat.created_at
                            });
                        }
                    });
                });
            } catch (e) {}
        }

        if (avaliacoes.length === 0) {
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
            const avatarUrl = a.avaliador_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((a.avaliador_nome||'U').slice(0,2))}&background=3483fa&color=fff&size=36`;
            return `
                <div class="opinion-card">
                    <div class="opinion-card-header">
                        <img src="${avatarUrl}" class="opinion-avatar" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent((a.avaliador_nome||'U').slice(0,2))}&background=3483fa&color=fff&size=36'">
                        <div class="opinion-author-info">
                            <span class="opinion-author">${a.avaliador_nome || 'Anônimo'}</span>
                            <span class="opinion-stars">${stars}</span>
                        </div>
                    </div>
                    <div class="opinion-date">${date}</div>
                    ${a.comment ? `<p class="opinion-comment">${a.comment}</p>` : ''}
                    ${images}
                </div>`;
        }).join('');
    } catch (e) {
        console.error('Erro ao carregar avaliações:', e);
        container.innerHTML = '<div class="text-center py-5"><p class="text-muted mb-0">Erro ao carregar opiniões.</p></div>';
    }
};

window.showUserReviews = async function(userId, userName) {
    try {
        const chats = await supabaseFetch(`chats?participants=cs.{${userId}}&select=messages,created_at&limit=100`);
        const avaliacoes = [];
        (chats || []).forEach(chat => {
            (chat.messages || []).forEach(m => {
                if (m.type === 'review' && m.avaliadoId === userId) {
                    avaliacoes.push({
                        rating:         m.rating || 0,
                        comment:        m.reviewComment || '',
                        images:         m.reviewImages || [],
                        avaliador_nome: m.senderName || 'Anônimo',
                        created_at:     m.timestamp || chat.created_at
                    });
                }
            });
        });
        avaliacoes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const total = avaliacoes.length;
        const avg = total > 0 ? (avaliacoes.reduce((s, a) => s + (a.rating || 0), 0) / total).toFixed(1) : '—';
        let modalEl = document.getElementById('userReviewsModal');
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.id = 'userReviewsModal';
            modalEl.className = 'modal fade';
            modalEl.tabIndex = -1;
            document.body.appendChild(modalEl);
        }
        const starsHtml = (n) => Array.from({length:5}, (_,i) => `<i class="bi ${i < n ? 'bi-star-fill' : 'bi-star'}" style="color:#3483fa;font-size:0.85rem;"></i>`).join('');
        modalEl.innerHTML = `
            <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content border-0 shadow-lg" style="border-radius:16px;max-height:80vh;">
                    <div class="modal-header border-0 pb-0 position-relative">
                        <h5 class="modal-title fw-bold" style="font-size:1.05rem;">Avaliações de ${userName}</h5>
                        <button type="button" class="ml-auth-close" data-bs-dismiss="modal" aria-label="Fechar" style="border-radius:50%;width:34px;height:34px;font-size:0.9rem;"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="modal-body pt-2">
                        ${total > 0 ? `
                        <div class="text-center mb-3 pb-2 border-bottom">
                            <span class="fw-bold" style="font-size:1.5rem;color:#3483fa;">${avg}</span>
                            <div class="my-1">${starsHtml(Math.round(parseFloat(avg)))}</div>
                            <span class="text-muted small">${total} avaliaç${total === 1 ? 'ão' : 'ões'}</span>
                        </div>
                        ${avaliacoes.map(a => {
                            const date = new Date(a.created_at).toLocaleDateString('pt-BR');
                            const imgs = a.images && Array.isArray(a.images) && a.images.length > 0
                                ? `<div class="d-flex gap-1 mt-1">${a.images.slice(0,3).map(url => `<img src="${url}" style="width:48px;height:48px;border-radius:6px;object-fit:cover;cursor:pointer;" onclick="window.openImageFull('${url}')" onerror="this.style.display='none'">`).join('')}</div>` : '';
                            return `
                            <div class="mb-3 pb-2 ${a !== avaliacoes[avaliacoes.length-1] ? 'border-bottom' : ''}">
                                <div class="d-flex align-items-center gap-2 mb-1">
                                    <span class="fw-bold small">${a.avaliador_nome || 'Anônimo'}</span>
                                    <span class="text-muted" style="font-size:0.7rem;">${date}</span>
                                </div>
                                <div class="mb-1">${starsHtml(Math.round(a.rating || 0))}</div>
                                ${a.comment ? `<p class="small mb-1" style="color:var(--text-color);">${a.comment}</p>` : ''}
                                ${imgs}
                            </div>`;
                        }).join('')}
                        ` : `<div class="text-center py-4"><p class="text-muted mb-0">Nenhuma avaliação ainda.</p></div>`}
                    </div>
                </div>
            </div>`;
        new bootstrap.Modal(modalEl).show();
    } catch (e) {
        console.error('Erro ao carregar avaliações do usuário:', e);
        showToast('Erro ao carregar avaliações.', 'error');
    }
};

// ============================================
// CONTAINER DE CHAT UNIFICADO
// Uma única função que gera toda a estrutura HTML
// do chat (header, mensagens, input, anexos).
// Admin, vendedor, cliente e suporte usam a mesma.
//
// Todos os callbacks são STRINGS de onclick:
//   onSend: "window.adminChatsTabSend('${orderId}')"
// ============================================

window.renderChatContainer = function(opts) {
    const {
        chatId,
        chat = {},
        order = null,
        partner = {},
        msgsId,
        inputId,
        previewId,
        attachPanelId,
        attachLinkId,
        participantsId,
        statusBarId,
        onSend = '',
        onBack = '',
        onClose = '',
        onDelete = '',
        onToggleParticipants = '',
        onToggleAttachPanel = '',
        onConfirmAttach = '',
        onSendLocation = '',
        onSendFile = '',
        onViewProfile = '',
        onCancelOrder = '',
        onChatActions = '',
        onMute = '',
        onArchive = '',
        onBlock = '',
        onCloseTicket = '',
        onChangeStatus = '',
        onDeleteAccounts = '',
        onDeleteRequester = '',
        onDeleteOtherAccount = '',
        onVoiceInput = 'window.startVoiceInput',
        openImgurFn = 'window.abrirUploadExterno',
        openDocHostFn = 'window.abrirDocHost',
        docHostBtn1 = 'Google Drive',
        docHostBtn2 = 'OneDrive',
        statusInfo = null,
        statusText = '',
        showBackBtn = false,
        showCloseBtn = false,
        showAttach = true,
        showProductSummary = true,
        showDeleteBtn = false,
        extraHeaderHtml = '',
        extraBeforeMessages = '',
        extraBeforeInput = ''
    } = opts;

    const bothReviewed = order?.buyer_reviewed && order?.seller_reviewed;
    const isClosed = !!(chat.closed || (order?.status === 'finished' && bothReviewed) || order?.status === 'cancelled');
    const msgCount = (chat.messages || []).filter(m => m.type !== 'system').length;
    const partnerName = partner.name || '';
    const partnerAvatar = partner.avatar || '';

    const closeBtnHtml = (showCloseBtn && onClose)
        ? `<button type="button" class="ml-auth-close chat-header-x" onclick="${onClose}" aria-label="Fechar" style="position:static;border-radius:50%;width:34px;height:34px;font-size:0.9rem;flex-shrink:0;"><i class="bi bi-x-lg"></i></button>`
        : '';

    const backBtnHtml = showBackBtn && onBack
        ? `<button type="button" class="chat-header-close chat-header-back" onclick="${onBack}" style="margin-right:4px;"><i class="bi bi-arrow-left"></i></button>`
        : '';

    const participantsBtnHtml = onToggleParticipants
        ? `<button type="button" class="chat-header-close" onclick="${onToggleParticipants}" title="Participantes"><i class="bi bi-people-fill"></i></button>`
        : '';

    const dropdownItems = [];
    if (onViewProfile) dropdownItems.push(`<li><a class="dropdown-item small" href="javascript:void(0)" onclick="${onViewProfile}"><i class="bi bi-person-circle me-2"></i>Ver perfil</a></li>`);
    if (!isClosed && onCancelOrder) dropdownItems.push(`<li><a class="dropdown-item small text-danger" href="javascript:void(0)" onclick="${onCancelOrder}"><i class="bi bi-x-circle me-2"></i>Cancelar pedido</a></li>`);
    if (onMute) dropdownItems.push(`<li><a class="dropdown-item small" href="javascript:void(0)" onclick="${onMute}"><i class="bi bi-bell-slash me-2"></i>Silenciar notificações</a></li>`);
    if (onArchive) dropdownItems.push(`<li><a class="dropdown-item small" href="javascript:void(0)" onclick="${onArchive}"><i class="bi bi-archive me-2"></i>Arquivar conversa</a></li>`);
    if (showDeleteBtn && onDelete) dropdownItems.push(`<li><a class="dropdown-item small text-danger" href="javascript:void(0)" onclick="${onDelete}"><i class="bi bi-trash me-2"></i>Apagar conversa</a></li>`);
    if (onCloseTicket) dropdownItems.push(`<li><a class="dropdown-item small" href="javascript:void(0)" onclick="${onCloseTicket}"><i class="bi bi-lock me-2"></i>Encerrar chamado</a></li>`);
    if (onChangeStatus) dropdownItems.push(`<li><a class="dropdown-item small" href="javascript:void(0)" onclick="${onChangeStatus}"><i class="bi bi-arrow-repeat me-2"></i>Alterar status</a></li>`);
    if (onBlock) dropdownItems.push(`<li><hr class="dropdown-divider my-1"></li><li><a class="dropdown-item small text-danger" href="javascript:void(0)" onclick="${onBlock}"><i class="bi bi-slash-circle me-2"></i>Bloquear usuário</a></li>`);
    if (onDeleteAccounts) dropdownItems.push(`<li><a class="dropdown-item small text-danger" href="javascript:void(0)" onclick="${onDeleteAccounts}"><i class="bi bi-person-x-fill me-2"></i>Deletar contas</a></li>`);
    if (onDeleteRequester) dropdownItems.push(`<li><a class="dropdown-item small text-danger" href="javascript:void(0)" onclick="${onDeleteRequester}"><i class="bi bi-person-x-fill me-2"></i>Deletar conta do solicitante</a></li>`);
    if (onDeleteOtherAccount) dropdownItems.push(`<li><a class="dropdown-item small text-danger" href="javascript:void(0)" onclick="${onDeleteOtherAccount}"><i class="bi bi-person-x-fill me-2"></i>Deletar conta do outro participante</a></li>`);

    const dropdownHtml = dropdownItems.length > 0
        ? `<div class="dropdown">
            <button type="button" class="chat-header-close" data-bs-toggle="dropdown" aria-label="Opções" style="margin-right:4px;"><i class="bi bi-three-dots-vertical"></i></button>
            <ul class="dropdown-menu dropdown-menu-end shadow-sm">${dropdownItems.join('')}</ul>
           </div>`
        : '';

    const productSummaryHtml = (showProductSummary && order)
        ? (() => {
            const imgs = typeof safeParseImages === 'function' ? safeParseImages(order.images) : [];
            const imgSrc = typeof normalizeImageUrl === 'function' ? normalizeImageUrl(imgs[0]) || '' : '';
            const title = order.product_title || order.title || '';
            const price = order.total != null ? formatPreco(order.total) : '';
            return `<div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
                <img src="${imgSrc}" style="width:18px;height:18px;border-radius:4px;object-fit:cover;flex-shrink:0;" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">
                <span style="font-size:0.65rem;color:#667781;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</span>
                ${price ? `<span style="font-size:0.65rem;font-weight:600;color:#00A884;flex-shrink:0;">${price}</span>` : ''}
            </div>`;
          })()
        : '';

    const headerHtml = `
    <div class="chat-header-pro">
        ${backBtnHtml}
        <div class="chat-header-avatar-wrap">
            <img id="${msgsId}Avatar" src="${partnerAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(partnerName || 'User')}'">
            <span id="${msgsId}Dot" class="presence-dot"></span>
        </div>
        <div class="chat-header-info" style="min-width:0;flex:1;">
            <span class="chat-header-name">${partnerName}</span>
            <span class="chat-header-order-id" style="display:block;font-size:0.65rem;color:#667781;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                #${String(chatId).slice(-6).toUpperCase()} · ${msgCount} mensagem${msgCount === 1 ? '' : 's'}${isClosed ? ' · <i class="bi bi-lock-fill"></i> Encerrado' : ''}
            </span>
            ${extraHeaderHtml ? `<div class="mt-1">${extraHeaderHtml}</div>` : ''}
            ${productSummaryHtml}
        </div>
        ${participantsBtnHtml}
        ${dropdownHtml}
        ${closeBtnHtml}
    </div>`;

    const statusBarHtml = `
    <div id="${statusBarId}" class="chat-status-bar">
        ${statusInfo ? `<div class="alert alert-${statusInfo.class || 'info'} mb-0 py-2 text-center small">${statusInfo.text}</div>` : ''}
        ${statusText ? `<div class="mb-0 py-1 text-center">${statusText}</div>` : ''}
        ${isClosed && !statusInfo ? `<div class="alert alert-secondary mb-0 py-2 text-center small"><i class="bi bi-lock-fill me-1"></i>${order?.status === 'finished' ? 'Pedido finalizado' : order?.status === 'cancelled' ? 'Pedido cancelado' : 'Atendimento encerrado'}</div>` : ''}
    </div>`;

    const participantsHtml = onToggleParticipants
        ? `<div id="${participantsId}" class="chat-participants-panel d-none"></div>`
        : '';

    const attachHtml = showAttach ? `
    <div id="${previewId}" class="p-2 bg-warning bg-opacity-10 border-bottom d-none"></div>
    <div id="${attachPanelId}" class="p-3 bg-light border-top d-none">
        <div class="d-flex gap-2 mb-3">
            <button type="button" class="btn btn-outline-primary btn-sm flex-grow-1 chat-attach-tab active" data-attach-type="image" onclick="window.setChatAttachType('image','${attachPanelId}')"><i class="bi bi-play-circle me-1"></i>Mídia</button>
            <button type="button" class="btn btn-outline-primary btn-sm flex-grow-1 chat-attach-tab" data-attach-type="file" onclick="window.setChatAttachType('file','${attachPanelId}')"><i class="bi bi-file-earmark me-1"></i>Documentos</button>
            <button type="button" class="btn btn-outline-primary btn-sm flex-grow-1 chat-attach-tab" data-attach-type="location" onclick="window.setChatAttachType('location','${attachPanelId}')"><i class="bi bi-geo-alt-fill me-1"></i>Endereço</button>
        </div>
        <div id="${attachPanelId}ImageBox">
            <div class="input-group input-group-sm mb-2 shadow-sm">
                <span class="input-group-text bg-white border-end-0"><i class="bi bi-link-45deg text-muted"></i></span>
                <input type="url" id="${attachLinkId}" class="form-control border-start-0" placeholder="Cole o link da imagem, vídeo ou GIF...">
                <button type="button" class="ml-attach rounded-start-0" onclick="${onConfirmAttach}"><i class="bi bi-send"></i></button>
            </div>
            <div class="d-flex gap-2">
                <label class="ml-attach flex-grow-1" style="cursor:pointer;">
                    <i class="bi bi-cloud-upload"></i>Escolher arquivos
                    <input type="file" accept="image/*" hidden onchange="${onSendFile}(this)">
                </label>
                <button type="button" class="ml-attach flex-grow-1" onclick="${openImgurFn}()"><i class="bi bi-box-arrow-up-right"></i>Imgur</button>
            </div>
        </div>
        <div id="${attachPanelId}FileBox" class="d-none">
            <div class="input-group input-group-sm mb-2 shadow-sm">
                <span class="input-group-text bg-white border-end-0"><i class="bi bi-link-45deg text-muted"></i></span>
                <input type="url" id="${attachLinkId}File" class="form-control border-start-0" placeholder="Cole o link do documento...">
                <button type="button" class="ml-attach rounded-start-0" onclick="${onConfirmAttach}"><i class="bi bi-send"></i></button>
            </div>
            <div class="d-flex gap-2">
                <button type="button" class="ml-attach flex-grow-1" onclick="${openDocHostFn}('${docHostBtn1}')"><i class="bi bi-google"></i>${docHostBtn1}</button>
                <button type="button" class="ml-attach flex-grow-1" onclick="${openDocHostFn}('${docHostBtn2}')"><i class="bi bi-microsoft"></i>${docHostBtn2}</button>
            </div>
        </div>
        <div id="${attachPanelId}LocationBox" class="d-none">
            <div class="input-group input-group-sm mb-2 shadow-sm">
                <span class="input-group-text bg-white border-end-0"><i class="bi bi-geo-alt-fill text-muted"></i></span>
                <input type="url" id="${attachLinkId}Loc" class="form-control border-start-0" placeholder="Cole o link do endereço (Google Maps)...">
                <button type="button" class="ml-attach rounded-start-0" onclick="${onSendLocation}('other')"><i class="bi bi-send"></i></button>
            </div>
            <div class="d-flex gap-2">
                <button type="button" class="ml-attach flex-grow-1" onclick="${onSendLocation}('current')"><i class="bi bi-geo-alt-fill"></i>Endereço atual</button>
                <button type="button" class="ml-attach flex-grow-1" onclick="${onSendLocation}('stored')"><i class="bi bi-house-door"></i>Endereço cadastrado</button>
            </div>
        </div>
    </div>` : '';

    const inputBarHtml = !isClosed ? `
    <div class="chat-input-bar">
        <div class="d-flex gap-2 align-items-center">
            ${showAttach ? `<button type="button" class="chat-icon-btn" onclick="${onToggleAttachPanel}" title="Anexar"><i class="bi bi-paperclip"></i></button>` : ''}
            ${onChatActions ? `<button type="button" class="chat-icon-btn" onclick="${onChatActions}" title="Opções do pedido"><i class="bi bi-plus-circle"></i></button>` : ''}
            <button type="button" class="chat-icon-btn" data-voice-input="${inputId}" onclick="${onVoiceInput}('${inputId}')" title="Gravar áudio"><i class="bi bi-mic"></i></button>
            <input type="text" id="${inputId}" class="chat-text-input" placeholder="Digite sua mensagem..." autocomplete="off"
                   onkeypress="if(event.key==='Enter'){event.preventDefault();${onSend}}">
            <button type="button" class="chat-send-btn" onclick="${onSend}"><i class="bi bi-send-fill"></i></button>
        </div>
    </div>` : '';

    return `
    <div class="chat-container" style="height:100%;display:flex;flex-direction:column;">
        ${headerHtml}
        ${statusBarHtml}
        ${participantsHtml}
        ${extraBeforeMessages}
        <div id="${msgsId}" class="chat-messages flex-grow-1" style="overflow-y:auto;"></div>
        ${attachHtml}
        ${extraBeforeInput}
        ${inputBarHtml}
    </div>`;
};

// ============================================
// CHAT DIRETO (Conversas Livres — WhatsApp-like)
// ============================================

/**
 * Abre a tela de "Conversas" — lista de todos os usuários do sistema,
 * reutilizando o layout split-panel do whatsappOrdersView.
 */
window.renderDirectChats = async function() {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }

    window.exitWaOrdersView();

    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    const gridMain = document.getElementById('productGridMain');
    if (gridMain) gridMain.classList.add('d-none');
    const grid = document.getElementById('productsGrid');
    if (grid) { grid.classList.remove('order-view-active'); grid.innerHTML = ''; grid.style.display = 'none'; }

    const waView = document.getElementById('whatsappOrdersView');
    const waList = document.getElementById('waContactList');
    const waTitle = document.getElementById('waSideTitle');
    const waSearch = document.getElementById('waContactSearch');

    if (waTitle) waTitle.textContent = 'Conversas';
    if (waSearch) {
        waSearch.placeholder = 'Buscar pessoa...';
        waSearch.oninput = function() { window.filterDirectContacts(this.value); };
    }
    if (waView) waView.classList.remove('d-none');
    document.body.classList.add('wa-locked');

    window.closeWaChat();

    waList.innerHTML = '<div class="text-center py-5 w-100"><div class="spinner-border text-success"></div></div>';

    try {
        const allUsers = await supabaseFetch(`users?select=id,nome,avatar,last_seen&order=nome.asc`);
        const directChats = await supabaseFetch(`chats?order_id=is.null&select=*`);
        const myChats = directChats.filter(c =>
            c.participants && c.participants.includes(user.id) &&
            c.messages && c.messages[0]?.type !== 'ticket_meta'
        );

        const contactMap = {};
        myChats.forEach(chat => {
            const otherId = chat.participants.find(p => p !== user.id);
            if (otherId) contactMap[otherId] = chat;
        });

        const otherUsers = allUsers.filter(u => u.id !== user.id);
        if (!otherUsers.length) {
            waList.innerHTML = `
                <div class="text-center py-5 px-3" style="color:#999;">
                    <i class="bi bi-people fs-1 d-block mb-2"></i>
                    <p class="small mb-0">Nenhum outro usuário encontrado.</p>
                </div>`;
            return;
        }

        const chatsWithMsgs = [];
        const archivedChats = [];
        const usersWithoutChat = [];

        otherUsers.forEach(u => {
            const chat = contactMap[u.id];
            if (chat) {
                const lastMsg = chat.messages?.[chat.messages.length - 1];
                const isArchived = chat.messages?.[0]?.archived === true;
                if (isArchived) {
                    archivedChats.push({ user: u, chat, lastMsg });
                } else {
                    chatsWithMsgs.push({ user: u, chat, lastMsg });
                }
            } else {
                usersWithoutChat.push(u);
            }
        });

        chatsWithMsgs.sort((a, b) => {
            const ta = a.lastMsg?.timestamp ? new Date(a.lastMsg.timestamp).getTime() : 0;
            const tb = b.lastMsg?.timestamp ? new Date(b.lastMsg.timestamp).getTime() : 0;
            return tb - ta;
        });
        archivedChats.sort((a, b) => {
            const ta = a.lastMsg?.timestamp ? new Date(a.lastMsg.timestamp).getTime() : 0;
            const tb = b.lastMsg?.timestamp ? new Date(b.lastMsg.timestamp).getTime() : 0;
            return tb - ta;
        });

        let html = '';

        if (chatsWithMsgs.length > 0) {
            html += `<div class="wa-contact-section-header">Conversas Recentes</div>`;
            html += chatsWithMsgs.map(({ user: u, chat, lastMsg }) => {
                const avatar = normalizeImageUrl(safeParseImages(u.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.nome || 'User')}&background=random&size=45`;
                const online = isRecentlyOnline(u.last_seen);
                const lastText = lastMsg?.type === 'image' ? '📷 Imagem' : lastMsg?.type === 'video' ? '🎬 Vídeo' : lastMsg?.type === 'location' ? '📍 Localização' : lastMsg?.type === 'file' ? '📄 Arquivo' : (lastMsg?.text || 'Iniciar conversa');
                const lastTime = lastMsg?.timestamp ? formatChatTime(lastMsg.timestamp) : '';
                const unread = chat.messages?.filter(m => m.senderId !== user.id && !m.visto).length || 0;

                return `
                <div class="wa-contact" data-direct-chat-id="${chat.id}" data-contact-name="${(u.nome || '').toLowerCase()}" onclick="window.openDirectChat('${chat.id}')">
                    <div style="position:relative;flex-shrink:0;">
                        <img src="${avatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&size=45'" style="width:46px;height:46px;border-radius:50%;object-fit:cover;">
                        <span class="presence-dot ${online ? 'online' : 'offline'}" style="width:12px;height:12px;border:2px solid #fff;"></span>
                    </div>
                    <div class="wa-contact-textbox">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="wa-contact-name">${u.nome || 'Usuário'}</div>
                            <small class="text-muted" style="font-size:0.65rem;white-space:nowrap;">${lastTime}</small>
                        </div>
                        <div class="wa-contact-text" style="${unread ? 'font-weight:600;color:#111;' : ''}">${truncateText(lastText, 40)}</div>
                    </div>
                    ${unread ? `<span class="badge bg-success wa-contact-badge">${unread}</span>` : ''}
                </div>`;
            }).join('');
        }

        if (archivedChats.length > 0) {
            html += `<div class="wa-contact-section-header" style="cursor:pointer;user-select:none;" onclick="document.getElementById('archivedChatsList').classList.toggle('d-none');this.querySelector('.bi')?.classList.toggle('bi-chevron-down');this.querySelector('.bi')?.classList.toggle('bi-chevron-right');">
                <span><i class="bi bi-chevron-down me-1" style="font-size:0.7rem;"></i>Arquivadas</span>
                <span class="small text-muted">${archivedChats.length}</span>
            </div>`;
            html += `<div id="archivedChatsList">`;
            html += archivedChats.map(({ user: u, chat, lastMsg }) => {
                const avatar = normalizeImageUrl(safeParseImages(u.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.nome || 'User')}&background=random&size=45`;
                const online = isRecentlyOnline(u.last_seen);
                const lastText = lastMsg?.type === 'image' ? '📷 Imagem' : lastMsg?.type === 'video' ? '🎬 Vídeo' : lastMsg?.type === 'location' ? '📍 Localização' : lastMsg?.type === 'file' ? '📄 Arquivo' : (lastMsg?.text || 'Iniciar conversa');
                const lastTime = lastMsg?.timestamp ? formatChatTime(lastMsg.timestamp) : '';

                return `
                <div class="wa-contact" data-direct-chat-id="${chat.id}" data-contact-name="${(u.nome || '').toLowerCase()}" onclick="window.openDirectChat('${chat.id}')" style="opacity:0.65;">
                    <div style="position:relative;flex-shrink:0;">
                        <img src="${avatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&size=45'" style="width:46px;height:46px;border-radius:50%;object-fit:cover;">
                    </div>
                    <div class="wa-contact-textbox">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="wa-contact-name">${u.nome || 'Usuário'}</div>
                            <small class="text-muted" style="font-size:0.65rem;white-space:nowrap;">${lastTime}</small>
                        </div>
                        <div class="wa-contact-text">${truncateText(lastText, 40)}</div>
                    </div>
                </div>`;
            }).join('');
            html += `</div>`;
        }

        if (usersWithoutChat.length > 0) {
            html += `<div class="wa-contact-section-header">${chatsWithMsgs.length > 0 ? 'Outros Usuários' : 'Todos os Usuários'}</div>`;
            html += usersWithoutChat.map(u => {
                const avatar = normalizeImageUrl(safeParseImages(u.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.nome || 'User')}&background=random&size=45`;
                const online = isRecentlyOnline(u.last_seen);

                return `
                <div class="wa-contact" data-contact-name="${(u.nome || '').toLowerCase()}" onclick="window.startDirectChat('${u.id}')">
                    <div style="position:relative;flex-shrink:0;">
                        <img src="${avatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&size=45'" style="width:46px;height:46px;border-radius:50%;object-fit:cover;">
                        <span class="presence-dot ${online ? 'online' : 'offline'}" style="width:12px;height:12px;border:2px solid #fff;"></span>
                    </div>
                    <div class="wa-contact-textbox">
                        <div class="wa-contact-name">${u.nome || 'Usuário'}</div>
                        <div class="wa-contact-text">Iniciar conversa</div>
                    </div>
                </div>`;
            }).join('');
        }

        waList.innerHTML = html || `
            <div class="text-center py-5 px-3" style="color:#999;">
                <i class="bi bi-people fs-1 d-block mb-2"></i>
                <p class="small mb-0">Nenhum usuário encontrado.</p>
            </div>`;

        window.closeMobileMenu();
    } catch (e) {
        console.error('Erro ao carregar conversas:', e);
        waList.innerHTML = '<div class="text-center py-5" style="color:#999;"><h6>Erro ao carregar conversas.</h6></div>';
    }
};

window.filterDirectContacts = function(query) {
    const q = query.trim().toLowerCase();
    let anyVisible = false;
    document.querySelectorAll('#waContactList .wa-contact').forEach(el => {
        const name = el.dataset.contactName || '';
        const show = !q || name.includes(q);
        el.style.display = show ? '' : 'none';
        if (show) anyVisible = true;
    });
    document.querySelectorAll('#waContactList .wa-contact-section-header').forEach(el => {
        el.style.display = q ? 'none' : '';
    });
    let emptyMsg = document.getElementById('directSearchEmptyMsg');
    if (!anyVisible && q) {
        if (!emptyMsg) {
            emptyMsg = document.createElement('div');
            emptyMsg.id = 'directSearchEmptyMsg';
            emptyMsg.className = 'text-center py-4 px-3';
            emptyMsg.style.color = '#999';
            emptyMsg.innerHTML = '<i class="bi bi-search fs-4 d-block mb-2"></i><p class="small mb-0">Nenhuma pessoa encontrada.</p>';
            document.getElementById('waContactList')?.appendChild(emptyMsg);
        }
    } else if (emptyMsg) {
        emptyMsg.remove();
    }
};

window.startDirectChat = async function(targetUserId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }

    showToast('Abrindo conversa...', 'info', 1500);

    try {
        const directChats = await supabaseFetch(`chats?order_id=is.null&select=*`);
        const existing = directChats.find(c =>
            c.order_id === null &&
            c.participants && c.participants.includes(user.id) && c.participants.includes(targetUserId) &&
            c.messages && c.messages[0]?.type !== 'ticket_meta'
        );

        if (existing) {
            window.openDirectChat(existing.id);
            return;
        }

        const targetData = await supabaseFetch(`users?select=nome,avatar&id=eq.${targetUserId}&limit=1`);
        const target = targetData?.[0];
        const targetName = target?.nome || 'Usuário';

        const newChat = {
            id: crypto.randomUUID(),
            order_id: null,
            buyer_id: user.id,
            seller_id: targetUserId,
            buyer_name: user.nome,
            seller_name: targetName,
            participants: [user.id, targetUserId],
            messages: [
                { type: 'direct_chat_meta', createdBy: user.id, createdByName: user.nome },
                { senderId: user.id, senderName: user.nome, text: `Olá! 👋`, timestamp: new Date().toISOString(), type: 'message' }
            ]
        };

        await supabaseFetch('chats', { method: 'POST', body: JSON.stringify(newChat) });

        await window.renderDirectChats();
        setTimeout(() => window.openDirectChat(newChat.id), 300);
    } catch (e) {
        console.error('Erro ao criar conversa:', e);
        showToast('Erro ao abrir conversa.', 'error');
    }
};

window.openDirectChat = async function(chatId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }
    if (window.currentChat !== chatId) window.lastChatSignature = null;
    window.currentChat = chatId;

    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Conversa não encontrada.', 'error'); return; }

        const otherId = chat.participants.find(p => p !== user.id);
        let otherName = 'Usuário';
        let otherAvatar = `https://ui-avatars.com/api/?name=User&background=random&size=40`;
        let otherLastSeen = null;
        let otherEmail = '';
        let otherPhone = '';

        if (otherId) {
            const otherData = await supabaseFetch(`users?select=nome,avatar,last_seen,email,telefone&id=eq.${otherId}&limit=1`);
            const other = otherData?.[0];
            if (other) {
                otherName = other.nome || otherName;
                const realAvatar = normalizeImageUrl(safeParseImages(other.avatar)[0]);
                if (realAvatar) otherAvatar = realAvatar;
                otherLastSeen = other.last_seen;
                otherEmail = other.email || '';
                otherPhone = other.telefone || '';
            }
        }

        const msgsId = `dmsgs_${chatId}`;
        const inputId = `dinput_${chatId}`;
        const previewId = `dpreview_${chatId}`;
        const attachId = `dattachPanel_${chatId}`;
        const attachLinkId = `dattachLink_${chatId}`;
        const statusBarId = `dstatusBar_${chatId}`;

        const partnerDotClass = isRecentlyOnline(otherLastSeen) ? 'online' : 'offline';

        const html = window.renderChatContainer({
            chatId,
            chat,
            partner: { name: otherName, avatar: otherAvatar },
            msgsId,
            inputId,
            previewId,
            attachPanelId: attachId,
            attachLinkId,
            statusBarId,
            onSend: 'window.sendDirectChatMessage(event)',
            onBack: 'window.closeDirectChat()',
            onClose: 'window.closeDirectChat()',
            onViewProfile: `window.viewDirectChatPartnerProfile('${otherId}')`,
            onMute: `window.muteDirectChat('${chatId}')`,
            onArchive: `window.archiveDirectChat('${chatId}')`,
            onBlock: `window.blockDirectChatUser('${otherId}')`,
            onToggleAttachPanel: 'window.toggleChatAttachPanel()',
            onConfirmAttach: 'window.confirmDirectChatAttach()',
            onSendLocation: 'window.sendDirectChatLocation',
        onSendFile: 'window.sendDirectChatImageFile',
        showBackBtn: true,
        showCloseBtn: true,
            showDeleteBtn: true,
            onDelete: `window.deleteDirectChat('${chatId}')`,
            showProductSummary: false,
            showAttach: true,
            statusInfo: { class: 'secondary mb-0 py-1', text: `<div class="d-flex justify-content-center align-items-center gap-3" style="font-size:0.75rem;color:#667781;">${otherEmail ? `<span><i class="bi bi-envelope-fill me-1" style="font-size:0.65rem;"></i>${otherEmail}</span>` : ''}${otherPhone ? `<span><i class="bi bi-telephone-fill me-1" style="font-size:0.65rem;"></i>${otherPhone}</span>` : ''}</div>` }
        });

        const panel = document.getElementById('waChatActive');
        if (panel) {
            panel.innerHTML = html;
            panel.classList.remove('d-none');
            panel.classList.add('d-flex');
        }

        if (partnerDotClass) {
            document.getElementById(`${msgsId}Dot`)?.classList.add(partnerDotClass);
        }

        window._chatActiveElements = {
            input: document.getElementById(inputId),
            container: document.getElementById(msgsId),
            statusBar: document.getElementById(statusBarId),
            attachPanel: document.getElementById(attachId),
            preview: document.getElementById(previewId)
        };

        document.getElementById('waEmptyState')?.classList.add('d-none');
        document.getElementById('whatsappOrdersView')?.classList.add('wa-chat-open');
        document.querySelectorAll('#waContactList .wa-contact').forEach(el => {
            el.classList.toggle('active-chat', el.dataset.directChatId === chatId);
        });

        await loadDirectChatMessages(chatId);
        startDirectChatPolling(chatId);
    } catch (e) {
        console.error('Erro ao abrir conversa:', e);
        showToast('Erro ao abrir conversa.', 'error');
    }
};

window.closeDirectChat = function() {
    stopDirectChatPolling();
    window.currentChat = null;
    window.lastChatSignature = null;
    window._chatActiveElements = null;
    const panel = document.getElementById('waChatActive');
    if (panel) { panel.innerHTML = ''; panel.classList.add('d-none'); panel.classList.remove('d-flex'); }
    document.getElementById('waEmptyState')?.classList.remove('d-none');
    document.getElementById('whatsappOrdersView')?.classList.remove('wa-chat-open');
    document.querySelectorAll('#waContactList .wa-contact').forEach(el => el.classList.remove('active-chat'));
};

let directChatPollInterval = null;

function startDirectChatPolling(chatId) {
    stopDirectChatPolling();
    directChatPollInterval = setInterval(() => {
        const panel = document.getElementById('waChatActive');
        if (!panel || panel.classList.contains('d-none') || window.currentChat !== chatId) {
            stopDirectChatPolling();
            return;
        }
        loadDirectChatMessages(chatId, true);
    }, 4000);
}

function stopDirectChatPolling() {
    if (directChatPollInterval) {
        clearInterval(directChatPollInterval);
        directChatPollInterval = null;
    }
}

async function loadDirectChatMessages(chatId, silent = false) {
    const container = window._chatActiveElements?.container;
    if (!container) return;
    if (!silent) {
        container.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div><p class="small mt-2">Carregando mensagens...</p></div>';
    }
    try {
        const user = getSavedUser();
        const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat?.messages) {
            if (!silent) container.innerHTML = '<div class="text-center py-4 text-muted">Nenhuma mensagem ainda.</div>';
            return;
        }

        window.__setupReactionHooks(chat,
            (c) => supabaseFetch(`chats?id=eq.${chatId}`, { method: 'PATCH', body: JSON.stringify({ messages: c.messages }) }),
            () => loadDirectChatMessages(chatId, true)
        );

        let changed = false;
        const otherSenderIds = chat.participants.filter(id => id !== user.id);
        chat.messages.forEach(msg => {
            if (msg.senderId && otherSenderIds.includes(msg.senderId) && !msg.visto) {
                msg.visto = true; changed = true;
            }
        });
        if (changed) {
            supabaseFetch(`chats?id=eq.${chatId}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) }).catch(() => {});
            window.updateChatBadge();
            window.renderDirectChats();
        }

        const signature = JSON.stringify(chat.messages);
        if (silent && signature === window.lastChatSignature) return;
        const isNewIncoming = silent && window.lastChatSignature !== null && chat.messages.length > (JSON.parse(window.lastChatSignature || '[]').length || 0);
        window.lastChatSignature = signature;

        const wasNearBottom = !silent || (container.scrollHeight - container.scrollTop - container.clientHeight < 120);
        const myAvatar = normalizeImageUrl(safeParseImages(user.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.nome || 'Você')}&background=22c98e&color=fff&size=40`;

        const otherId = chat.participants.find(p => p !== user.id);
        let partnerAvatarSrc = `https://ui-avatars.com/api/?name=User&background=random&size=40`;
        try {
            if (otherId) {
                const pd = await supabaseFetch(`users?select=avatar&id=eq.${otherId}&limit=1`);
                const ra = normalizeImageUrl(safeParseImages(pd?.[0]?.avatar)[0]);
                if (ra) partnerAvatarSrc = ra;
            }
        } catch (e) {}

        const chatMsgs = chat.messages.filter(m => m.type !== 'direct_chat_meta');
        container.innerHTML = chatMsgs.map((msg, index) => {
            return window.renderMsgBubble(msg, index, {
                userId: user.id, myAvatar, partnerAvatar: partnerAvatarSrc, supportAvatar: partnerAvatarSrc,
                resolveSenderName: () => msg.senderName || '',
                actions: { reply: 'startReply', copy: 'copyMessageText', edit: 'startEdit', delete: 'deleteMessage' },
                useDropdown: true, enableGrouping: true, allMessages: chatMsgs
            });
        }).join('');

        if (wasNearBottom) {
            container.scrollTop = container.scrollHeight;
        } else if (isNewIncoming) {
            showToast('Nova mensagem recebida.', 'info', 2000);
        }
    } catch (e) {
        if (silent) return;
        console.error(e);
        container.innerHTML = `<div class="text-center py-4 text-danger"><i class="bi bi-exclamation-triangle fs-1 d-block mb-2"></i><p>Erro ao carregar mensagens</p><button class="btn btn-primary btn-sm" onclick="loadDirectChatMessages('${chatId}')">Tentar novamente</button></div>`;
    }
}

window.sendDirectChatMessage = async function(event) {
    if (event?.preventDefault) event.preventDefault();
    const input = window._chatActiveElements?.input;
    const text = input?.value?.trim();
    const user = getSavedUser();
    if ((!text && window.editingMessageIndex === null) || !user || !window.currentChat) return;
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${window.currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Conversa não encontrada.', 'error'); return; }

        if (window.editingMessageIndex !== null) {
            chat.messages[window.editingMessageIndex].text = text;
            chat.messages[window.editingMessageIndex].edited = true;
        } else {
            const newMessage = { senderId: user.id, senderName: user.nome, text, timestamp: new Date().toISOString(), type: 'message' };
            if (window.currentReplyIndex !== null) {
                const repliedMsg = chat.messages[window.currentReplyIndex];
                newMessage.replyTo = { text: repliedMsg.text, senderName: repliedMsg.senderName };
            }
            chat.messages.push(newMessage);
        }

        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        input.value = '';
        window.cancelReplyOrEdit();
        await loadDirectChatMessages(window.currentChat);
    } catch (e) { showToast('Erro ao enviar mensagem.', 'error'); }
};

window.sendDirectChatImageFile = async function(inputFile) {
    const file = inputFile?.files?.[0];
    if (inputFile) inputFile.value = '';
    if (!file) return;
    const btn = inputFile?.closest('.chat-container')?.querySelector('label') || document.querySelector('#chatAttachPanel label');
    const original = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Enviando...';
    const clientId = window.CONFIG?.IMGUR_CLIENT_ID || window.CONFIG_LOCAL_FALLBACK?.IMGUR_CLIENT_ID || '546c25a59c58ad7';
    try {
        const fd = new FormData();
        fd.append('image', file, file.name || 'imagem.jpg');
        const res = await fetch('https://api.imgur.com/3/image', { method: 'POST', headers: { Authorization: `Client-ID ${clientId}` }, body: fd });
        const json = await res.json().catch(() => null);
        if (btn) btn.innerHTML = original;
        if (json?.success && json?.data?.link) {
            await window.sendDirectChatImage(json.data.link);
            window._chatActiveElements?.attachPanel?.classList.add('d-none');
        } else {
            showToast('Falha ao enviar imagem (tente um link).', 'error');
        }
    } catch (e) { if (btn) btn.innerHTML = original; showToast('Erro ao enviar imagem.', 'error'); }
};

window.sendDirectChatImage = async function(urlParam) {
    const rawUrl = urlParam;
    if (!rawUrl || !(rawUrl.startsWith('http') || rawUrl.startsWith('data:'))) { showToast('Link inválido!', 'warning'); return; }
    const url = normalizeImageUrl(rawUrl);
    const user = getSavedUser();
    if (!user || !window.currentChat) return;
    const isVideo = /\.(mp4|webm|ogg|mov)$/i.test(url) || /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
    const isGif = /\.gif$/i.test(url);
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${window.currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Conversa não encontrada.', 'error'); return; }
        const msg = { senderId: user.id, senderName: user.nome, text: isVideo ? 'Vídeo' : (isGif ? 'GIF' : 'Imagem'), timestamp: new Date().toISOString() };
        if (isVideo) { msg.type = 'video'; msg.video = url; }
        else { msg.type = 'image'; msg.image = url; }
        chat.messages.push(msg);
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        await loadDirectChatMessages(window.currentChat);
    } catch (e) { showToast('Erro ao processar o link.', 'error'); }
};

window.sendDirectChatFile = async function(urlParam) {
    const url = urlParam;
    if (!url || !url.startsWith('http')) { showToast('Link inválido!', 'warning'); return; }
    const user = getSavedUser();
    if (!user || !window.currentChat) return;
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${window.currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) return;
        chat.messages.push({ senderId: user.id, senderName: user.nome, text: `Arquivo: ${url.split('/').pop()}`, file: { name: 'Arquivo Externo', url, size: 0 }, timestamp: new Date().toISOString(), type: 'file' });
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        await loadDirectChatMessages(window.currentChat);
    } catch { showToast('Erro ao enviar arquivo.', 'error'); }
};

window.confirmDirectChatAttach = async function() {
    const suffix = chatAttachType === 'file' ? 'File' : '';
    const input = document.getElementById(`dattachLink_${window.currentChat}${suffix}`) || document.getElementById(`attachLink_${window.currentChat}${suffix}`);
    const url = input?.value?.trim();
    if (!url || !url.startsWith('http')) { showToast('Cole um link válido (começando com http).', 'warning'); return; }
    if (chatAttachType === 'image') await window.sendDirectChatImage(url);
    else await window.sendDirectChatFile(url);
    input.value = '';
    window._chatActiveElements?.attachPanel?.classList.add('d-none');
};

window.sendDirectChatLocation = async function(kind) {
    const user = getSavedUser();
    if (!user || !window.currentChat) return;
    if (kind === 'current') {
        if (!navigator.geolocation) { showToast('Geolocalização não suportada.', 'error'); return; }
        showToast('Obtendo sua localização...', 'info');
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const { latitude, longitude } = pos.coords;
            const maps = `https://www.google.com/maps?q=${latitude},${longitude}`;
            await sendDirectLocationMessage(maps, `Localização atual: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        }, () => showToast('Não foi possível obter a localização.', 'error'), { enableHighAccuracy: true, timeout: 10000 });
        return;
    }
    if (kind === 'stored') {
        const u = getSavedUser() || {};
        const endereco = [u.endereco, u.cidade, u.estado, u.cep].filter(Boolean).join(', ');
        const maps = u.maps || (endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}` : '');
        if (!maps) { showToast('Você não tem endereço cadastrado no perfil.', 'warning'); return; }
        sendDirectLocationMessage(maps, `📍 Meu endereço cadastrado: ${endereco || maps}`);
        return;
    }
    const input = document.getElementById(`dattachLink_${window.currentChat}Loc`) || document.getElementById(`attachLink_${window.currentChat}Loc`);
    const url = input?.value?.trim();
    if (!url || !url.startsWith('http')) { showToast('Cole um link de endereço válido.', 'warning'); return; }
    sendDirectLocationMessage(url, `Endereço (link): ${url}`);
    input.value = '';
    window._chatActiveElements?.attachPanel?.classList.add('d-none');
};

async function sendDirectLocationMessage(mapsUrl, text) {
    const user = getSavedUser();
    if (!user || !window.currentChat) return;
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${window.currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) return;
        chat.messages.push({ senderId: user.id, senderName: user.nome, text, location: mapsUrl, timestamp: new Date().toISOString(), type: 'location' });
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        await loadDirectChatMessages(window.currentChat);
        window._chatActiveElements?.attachPanel?.classList.add('d-none');
    } catch { showToast('Erro ao enviar localização.', 'error'); }
}

window.viewDirectChatPartnerProfile = async function(partnerId) {
    if (!partnerId) return;
    let partner = null;
    try {
        const r = await supabaseFetch(`users?select=nome,avatar,vendedor_rating,rating_count,created_at,last_seen&id=eq.${partnerId}&limit=1`);
        partner = r?.[0];
    } catch (e) {}
    const avatar = normalizeImageUrl(safeParseImages(partner?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(partner?.nome || 'User')}&background=random&size=100`;
    const rating = partner?.vendedor_rating ? parseFloat(partner.vendedor_rating).toFixed(1) : '—';
    const ratingCount = partner?.rating_count || 0;
    const memberSince = partner?.created_at ? new Date(partner.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '—';
    const online = isRecentlyOnline(partner?.last_seen);
    let modalEl = document.getElementById('partnerProfileModal');
    if (!modalEl) {
        modalEl = document.createElement('div');
        modalEl.id = 'partnerProfileModal';
        modalEl.className = 'modal fade';
        modalEl.tabIndex = -1;
        document.body.appendChild(modalEl);
    }
    modalEl.innerHTML = `
        <div class="modal-dialog modal-dialog-centered modal-sm">
            <div class="modal-content border-0 shadow-lg" style="border-radius:16px;">
                <div class="modal-body text-center p-4">
                    <button type="button" class="ml-auth-close" data-bs-dismiss="modal" aria-label="Fechar" style="border-radius:50%;width:34px;height:34px;font-size:0.9rem;"><i class="bi bi-x-lg"></i></button>
                    <div class="position-relative d-inline-block mb-3">
                        <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;" class="border" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&size=80'">
                        <span class="presence-dot ${online ? 'online' : 'offline'}" style="width:16px;height:16px;border:2px solid #fff;"></span>
                    </div>
                    <h5 class="fw-bold mb-1">${partner?.nome || 'Usuário'}</h5>
                    <p class="small mb-2 fw-bold ${online ? 'text-success' : 'text-muted'}">${online ? '● Online agora' : '○ Offline'}</p>
                    <p class="text-muted small mb-3"><i class="bi bi-calendar3 me-1"></i>Na plataforma desde ${memberSince}</p>
                    <div class="d-flex justify-content-center align-items-center gap-2 mb-3">
                        <i class="bi bi-star-fill text-warning"></i>
                        <span class="fw-bold">${rating}</span>
                        <span class="text-muted small">(${ratingCount} avaliações)</span>
                    </div>
                    <button class="ml-attach w-100 mb-2" onclick="window.showUserReviews('${partnerId}','${partner?.nome || 'Usuário'}')">
                        <i class="bi bi-star me-1"></i>Ver avaliações
                    </button>
                </div>
            </div>
        </div>`;
    new bootstrap.Modal(modalEl).show();
};

window.muteDirectChat = async function(chatId) {
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) return;
        const meta = chat.messages?.[0] || {};
        meta.muted = !meta.muted;
        chat.messages[0] = meta;
        await supabaseFetch(`chats?id=eq.${chatId}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        showToast(meta.muted ? 'Conversa silenciada.' : 'Notificações reativadas.', 'info');
    } catch (e) { showToast('Erro ao alterar notificações.', 'error'); }
};

window.archiveDirectChat = async function(chatId) {
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) return;
        const meta = chat.messages?.[0] || {};
        meta.archived = !meta.archived;
        chat.messages[0] = meta;
        await supabaseFetch(`chats?id=eq.${chatId}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        showToast(meta.archived ? 'Conversa arquivada.' : 'Conversa desarquivada.', 'info');
        window.closeDirectChat();
        window.renderDirectChats();
    } catch (e) { showToast('Erro ao arquivar conversa.', 'error'); }
};

window.blockDirectChatUser = async function(targetId) {
    if (!confirm('Tem certeza que deseja bloquear este usuário? Ele não poderá enviar mensagens para você.')) return;
    try {
        const user = getSavedUser();
        const directChats = await supabaseFetch(`chats?order_id=is.null&select=*`);
        const chat = directChats.find(c =>
            c.order_id === null &&
            c.participants && c.participants.includes(user.id) && c.participants.includes(targetId) &&
            c.messages && c.messages[0]?.type !== 'ticket_meta'
        );
        if (chat) {
            const meta = chat.messages?.[0] || {};
            meta.blocked_by = user.id;
            chat.messages[0] = meta;
            await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        }
        showToast('Usuário bloqueado.', 'info');
        window.closeDirectChat();
        window.renderDirectChats();
    } catch (e) { showToast('Erro ao bloquear usuário.', 'error'); }
};

window.deleteDirectChat = async function(chatId) {
    if (!confirm('Tem certeza que deseja apagar esta conversa?\nEssa ação não pode ser desfeita.')) return;
    try {
        await supabaseFetch(`chats?id=eq.${chatId}`, { method: 'DELETE' });
        showToast('Conversa apagada.', 'info');
        window.closeDirectChat();
        window.renderDirectChats();
    } catch (e) {
        showToast('Erro ao apagar conversa.', 'error');
    }
};

function formatChatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
        return 'Ontem';
    } else if (diffDays < 7) {
        return date.toLocaleDateString('pt-BR', { weekday: 'short' });
    } else {
        return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }
}

function truncateText(text, max) {
    if (!text) return '';
    return text.length > max ? text.substring(0, max) + '...' : text;
}

