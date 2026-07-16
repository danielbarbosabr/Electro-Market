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

// ============================================
// SISTEMA DE TOAST (substitui alerts)
// ============================================

/**
 * Cria uma notificação persistente no Banco de Dados e mostra o Toast na tela
 */
async function createPersistentNotification(message, type = 'info', userId = null) {
    const targetId = userId || getSavedUser()?.id;
    const newNotif = { 
        id: Date.now(), 
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
    document.body.classList.remove('wa-locked');
    if (typeof window.closeWaChat === 'function') window.closeWaChat();
};

async function loadPage(query = 'eletronicos', forceRefresh = false) {
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

        renderStorefrontBanner(matchedStores);
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

    return `
        <div class="card product-card-ml" onclick="window.showDetail('${pid}')">
            ${temOferta ? `<div class="offer-badge-ml">${descontoPct}% OFF</div>` : ''}
            <div class="overlay">
                <button class="btn btn-action" onclick="event.stopPropagation();window.shareProduct('${pid}')" title="Compartilhar">
                    <i class="bi bi-share"></i>
                </button>
                <button class="btn btn-action" onclick="event.stopPropagation();window.toggleLike('${pid}')" title="Curtir">
                    <i class="bi ${isLiked ? 'bi-heart-fill text-danger' : 'bi-heart'}"></i>
                </button>
            </div>
            <div class="product-card-img-container">
                ${thumb
                    ? `<img src="${thumb}" alt="${item.titulo}" loading="lazy" referrerpolicy="no-referrer"
                           onerror="this.parentElement.innerHTML='<i class=\\'bi bi-box-seam text-secondary\\' style=\\'font-size:2.5rem;\\'></i>'">`
                    : `<i class="bi bi-box-seam text-secondary" style="font-size:2.5rem;"></i>`
                }
            </div>
            <div class="card-body product-card-body">
                <h6 class="product-title-grid">${item.titulo}</h6>
                <div class="current-price">
                    ${temOferta
                        ? `<div class="price-old-line text-muted text-decoration-line-through" style="font-size:0.75rem;font-weight:normal;">
                               R$ ${parseFloat(item.preco_original).toLocaleString('pt-BR', {minimumFractionDigits:2})}
                           </div>`
                        : ''
                    }
                    <div class="price-main-line">
                        <span class="price-main-text">${precoFormatado}</span>
                        ${temOferta ? `<span class="offer-pct-inline">${descontoPct}% OFF</span>` : ''}
                    </div>
                </div>
                <div class="${realizaEntrega ? 'text-success' : 'text-muted'} delivery-line fw-bold mt-2">
                    <i class="bi ${realizaEntrega ? 'bi-truck' : 'bi-geo-alt'}"></i>
                    ${realizaEntrega ? 'Entrega disponível' : 'Retirada no local'}
                </div>
                <div class="text-muted city-line mt-1">
                    <i class="bi bi-geo-alt"></i> ${cidade}
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
 * Mostra um pequeno "cartão de loja encontrada" acima dos resultados de busca
 * quando o termo digitado bate com o nome de um ou mais vendedores — igual ao
 * atalho de loja que aparece na busca do Mercado Livre/Shopee.
 */
function renderStorefrontBanner(stores) {
    const container = document.getElementById('storefrontBanner');
    if (!container) return;
    if (!stores || stores.length === 0) { container.innerHTML = ''; return; }

    container.innerHTML = stores.map(s => `
        <div class="storefront-banner" onclick="window.showSellerProfile('${s.vendedor_id}', '${(s.loja||'').replace(/'/g,"\\'")}')">
            <div class="storefront-banner-icon"><i class="bi bi-shop"></i></div>
            <div class="storefront-banner-info">
                <strong>${s.loja}</strong>
                <small>Ver todos os anúncios desta loja</small>
            </div>
            <i class="bi bi-chevron-right storefront-banner-arrow"></i>
        </div>
    `).join('');
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
        const [sellerData, products] = await Promise.all([
            supabaseFetch(`users?select=nome,avatar,cidade,estado,vendedor_rating,rating_count,created_at&id=eq.${sellerId}&limit=1`),
            supabaseFetch(`products?select=*&vendedor_id=eq.${sellerId}&order=created_at.desc`)
        ]);
        const seller = sellerData?.[0] || {};
        const nome = seller.nome || sellerNameFallback || 'Loja';
        const ratingAvg   = parseFloat(seller.vendedor_rating) || 0;
        const ratingCount = parseInt(seller.rating_count) || 0;
        const localizacao = [seller.cidade, seller.estado].filter(Boolean).join(' - ');
        const membroDesde = seller.created_at ? new Date(seller.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';

        grid.innerHTML = `
            <div class="seller-profile-page">
                <button type="button" class="detail-back-btn" onclick="window.closeProductDetail()">
                    <i class="bi bi-arrow-left"></i> Voltar
                </button>

                <div class="seller-profile-hero">
                    <img src="${seller.avatar?.startsWith('http') ? seller.avatar : 'https://ui-avatars.com/api/?name=' + encodeURIComponent(nome)}" class="seller-profile-avatar" referrerpolicy="no-referrer">
                    <div class="seller-profile-info">
                        <h4 class="fw-bold mb-1">${nome}</h4>
                        <div class="mb-1">
                            ${ratingCount > 0
                                ? `<span class="fw-bold">${ratingAvg.toFixed(1)}</span> <i class="bi bi-star-fill text-warning"></i> <span class="text-muted small">(${ratingCount} avaliaç${ratingCount === 1 ? 'ão' : 'ões'})</span>`
                                : `<span class="text-muted small">Ainda sem avaliações</span>`}
                        </div>
                        <small class="text-muted d-block">${localizacao ? `<i class="bi bi-geo-alt me-1"></i>${localizacao}` : ''}</small>
                        ${membroDesde ? `<small class="text-muted d-block"><i class="bi bi-calendar3 me-1"></i>No ElectroMarket desde ${membroDesde}</small>` : ''}
                        <small class="text-muted d-block"><i class="bi bi-box-seam me-1"></i>${products.length} anúncio${products.length === 1 ? '' : 's'} ativo${products.length === 1 ? '' : 's'}</small>
                    </div>
                </div>

                <h6 class="fw-bold mt-4 mb-3">Anúncios desta loja</h6>
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

/** Remove acentos e normaliza caixa, para comparar nomes de cidade sem erro de digitação/acentuação */
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

/**
 * Permite filtrar direto pelo CEP: busca o endereço (ViaCEP) e já seleciona
 * automaticamente o Estado e a Cidade correspondentes no filtro.
 */
window.applyCepFilter = async function() {
    const input  = document.getElementById('filterCEP');
    const status = document.getElementById('filterCepStatus');
    const cepLimpo = (input?.value || '').replace(/\D/g, '');

    if (cepLimpo.length !== 8) {
        if (status) { status.textContent = 'Digite um CEP válido (8 dígitos).'; status.className = 'small text-danger mt-1'; }
        return;
    }

    if (status) { status.textContent = 'Buscando...'; status.className = 'small text-muted mt-1'; }

    const endereco = await buscarEnderecoPorCep(cepLimpo);
    if (!endereco?.estado) {
        if (status) { status.textContent = 'CEP não encontrado.'; status.className = 'small text-danger mt-1'; }
        return;
    }

    document.getElementById('filterEstado').value = endereco.estado;
    await window.onFilterEstadoChange(endereco.cidade);

    if (status) { status.textContent = `Filtrando por ${endereco.cidade} - ${endereco.estado}`; status.className = 'small text-success mt-1'; }
};

function applyFilters() {
    const min      = parseFloat(document.getElementById('minPrice')?.value)  || 0;
    const max      = parseFloat(document.getElementById('maxPrice')?.value)  || Infinity;
    const sort     = document.getElementById('sortOrder')?.value;
    const stores   = Array.from(document.querySelectorAll('.store-checkbox:checked')).map(cb => cb.value);
    const cidade   = document.getElementById('filterCidade')?.value || '';
    const categoria = document.getElementById('filterCategory')?.value || '';
    const somenteEntrega = document.getElementById('filterDelivery')?.checked;

    let filtered = allProductsCache.filter(p =>
        p.preco >= min && p.preco <= max &&
        (!stores.length || stores.includes(p.loja)) &&
        (!cidade || normalizeStr(p.cidade) === normalizeStr(cidade)) &&
        (!categoria || (p.categoria || '').startsWith(categoria)) &&
        (!somenteEntrega || !!(p.realizaentrega ?? p.realiza_entrega ?? p.realizaEntrega))
    );

    if (sort === 'priceAsc')  filtered.sort((a, b) => a.preco - b.preco);
    if (sort === 'priceDesc') filtered.sort((a, b) => b.preco - a.preco);
    // "Mais curtidos": ordena pela quantidade de curtidas do produto — diferente da
    // reputação do vendedor (que é uma métrica separada, ligada às avaliações).
    if (sort === 'likes')     filtered.sort((a, b) => (b.likes || 0) - (a.likes || 0));

    renderGrid(filtered);
}

function clearFilters() {
    ['minPrice', 'maxPrice', 'filterCEP'].forEach(id => {
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
    if (delivery) delivery.checked = false;
    const status = document.getElementById('filterCepStatus');
    if (status) status.textContent = '';
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
        document.getElementById('prodDescription').value = item.descricao;
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
    try {
        const sellerInfo = await supabaseFetch(`users?select=endereco,cidade,estado,vendedor_rating,rating_count&id=eq.${item.vendedor_id}`);
        if (sellerInfo?.length > 0) {
            const s = sellerInfo[0];
            sellerAddressRaw = s.endereco || '';
            sellerAddress = `${s.endereco || ''}, ${s.cidade || ''} - ${s.estado || ''}`.replace(/^, /, '');
            sellerCidade  = s.cidade || '';
            sellerRatingAvg   = parseFloat(s.vendedor_rating) || 0;
            sellerRatingCount = parseInt(s.rating_count) || 0;
        }
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

    grid.innerHTML = `
        <div class="detail-page">
            <button type="button" class="detail-back-btn" onclick="window.closeProductDetail()">
                <i class="bi bi-arrow-left"></i> Voltar
            </button>
            <div class="row g-0 g-md-4">
                <div class="col-md-7 border-end pe-md-4">
                    <div class="text-center mb-3 bg-light rounded p-3 d-flex align-items-center justify-content-center position-relative${hasMultipleImgs ? ' product-3d-img' : ''}"
                         style="min-height:260px;" data-pid="${pid}" data-idx="0"
                         ${hasMultipleImgs ? `onmousemove="window.tiltDetailImage(event, this)" onmouseleave="window.resetDetailImage(this)"` : ''}>
                        ${mainImg
                            ? `<img id="mainDetailImg" src="${mainImg}" class="img-fluid" style="max-height:420px;object-fit:contain;transition:transform 0.15s ease-out, opacity 0.15s ease;" referrerpolicy="no-referrer"
                                   onerror="this.parentElement.innerHTML='<i class=\\'bi bi-box-seam text-secondary\\' style=\\'font-size:4rem;\\'></i>'">`
                            : `<i class="bi bi-box-seam text-secondary" style="font-size:4rem;"></i>`
                        }
                        ${hasMultipleImgs ? `
                            <div class="card-img-edge card-img-edge-left" onclick="event.stopPropagation(); window.cycleDetailImage('${pid}', this.parentElement, -1)"><i class="bi bi-chevron-left"></i></div>
                            <div class="card-img-edge card-img-edge-right" onclick="event.stopPropagation(); window.cycleDetailImage('${pid}', this.parentElement, 1)"><i class="bi bi-chevron-right"></i></div>
                            <div class="card-img-dots">${images.map((_, i) => `<span class="card-img-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>
                        ` : ''}
                    </div>
                    <div class="mt-3">
                        <h5 class="fw-bold">Descrição</h5>
                        <p class="text-muted" style="line-height:1.7">${item.descricao || 'Sem descrição detalhada.'}</p>
                    </div>
                </div>
                <div class="col-md-5 pt-3 pt-md-0">
                    <span class="badge bg-secondary mb-2 small">${item.categoria || 'Geral'}</span>
                    <h4 class="fw-bold">${item.titulo}</h4>

                    <div class="my-3" style="overflow-wrap:anywhere;word-break:break-word;">
                        ${item.preco_original && parseFloat(item.preco_original) > parseFloat(item.preco) ? `
                            <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
                                <span class="text-muted text-decoration-line-through">R$ ${parseFloat(item.preco_original).toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                                <span class="offer-pct-inline">${Math.round(100 - (item.preco / parseFloat(item.preco_original)) * 100)}% OFF</span>
                            </div>` : ''
                        }
                        ${item.preco === 0
                            ? `<span class="fs-1 fw-bold text-success">GRÁTIS</span>`
                            : `<span class="fs-1 fw-bold">R$ ${Math.floor(item.preco || 0).toLocaleString('pt-BR')}</span>
                               <span class="fs-5">,${((item.preco % 1).toFixed(2)).slice(1)}</span>`
                        }
                    </div>

                    <div class="card bg-light border-0 p-3 mb-3" style="border-radius:10px;">
                        ${realizaEntrega ? `
                            <p class="mb-1 text-success fw-bold"><i class="bi bi-truck me-2"></i> Entrega disponível</p>
                            <small class="text-muted">Entrega em <strong>${regiaoEntrega}</strong></small>
                        ` : `
                            <p class="mb-1 fw-bold" style="color:#e67e22;"><i class="bi bi-geo-alt me-2"></i> Retirada no local</p>
                            <small class="text-muted"><strong>Local:</strong> ${sellerAddress}</small>
                        `}
                    </div>

                    <div class="mb-3" id="detailLikesBar">
                        <p class="small mb-1 fw-bold text-muted">Interesse no produto</p>
                        <div class="d-flex gap-1 mb-1" style="height:8px;">
                            ${[1,2,3,4,5].map(i => `
                                <div class="flex-grow-1 rounded" style="background-color:${likesLevel>=i ? colors[i-1] : '#eee'}"></div>
                            `).join('')}
                        </div>
                        <small class="text-muted" id="detailLikesText">${likesCount > 0
                            ? `<i class="bi bi-heart-fill" style="color:#ff4d6d;"></i> ${likesCount} curtida${likesCount === 1 ? '' : 's'}`
                            : 'Ainda sem curtidas'}</small>
                    </div>

                    <div class="mb-3">
                        <p class="small mb-1 fw-bold text-muted">Reputação do vendedor</p>
                        <div class="d-flex gap-1 mb-1" style="height:8px;">
                            ${[1,2,3,4,5].map(i => `
                                <div class="flex-grow-1 rounded" style="background-color:${level>=i ? colors[i-1] : '#eee'}"></div>
                            `).join('')}
                        </div>
                        <small class="text-muted">${sellerRatingCount > 0
                            ? `${sellerRatingAvg.toFixed(1)} <i class="bi bi-star-fill text-warning"></i> · ${sellerRatingCount} avaliaç${sellerRatingCount === 1 ? 'ão' : 'ões'}`
                            : 'Ainda sem avaliações'}</small>
                    </div>

                    <p class="mb-1"><strong>Vendedor:</strong> <a href="#" class="fw-bold text-decoration-none" style="color:var(--primary-blue);" onclick="event.preventDefault(); window.showSellerProfile('${item.vendedor_id}', '${(item.loja||'').replace(/'/g,"\\'")}');">${item.loja || 'Não informado'}</a> <i class="bi bi-shop text-muted"></i></p>
                    <p class="mb-3"><strong>Estoque:</strong> ${item.quantidade || 1} ${item.quantidade === 1 ? 'unidade' : 'unidades'}</p>

                    ${isOwner ? `
                        <button class="btn btn-ml-primary btn-lg w-100 mb-2" onclick="window.prepareEditProduct('${item.id}')">
                            <i class="bi bi-pencil me-2"></i>Editar Anúncio
                        </button>
                        <button class="btn btn-ml-danger w-100" onclick="window.deleteProduct('${item.id}')">
                            <i class="bi bi-trash me-2"></i>Excluir Anúncio
                        </button>
                    ` : isAdminViewing ? `
                        <button class="btn btn-ml-secondary btn-lg w-100 mb-2" onclick="window.adminEditProduct('${item.id}')">
                            <i class="bi bi-pencil me-2"></i>Editar Anúncio (Admin)
                        </button>
                        <button class="btn btn-ml-danger w-100" onclick="window.adminDeleteProduct('${item.id}', '${(item.titulo || '').replace(/'/g, "\\'")}')">
                            <i class="bi bi-trash me-2"></i>Excluir Produto (Admin)
                        </button>
                    ` : `
                        <div class="ml-qty-picker mb-3" id="mlQtyPicker">
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
                        <button class="btn btn-ml-primary btn-lg w-100 mb-2" onclick="window.addToCart('${pid}', {openCart:false, silent:true, qty:window._detailQty || 1});window.buyItem(cart.length-1);">
                            <i class="bi bi-lightning me-2"></i>Solicitar Compra
                        </button>
                        ${item.preco > 0 ? `
                        <button class="btn btn-ml-outline w-100 mb-2" onclick="window.openOfferModal('${pid}')">
                            <i class="bi bi-tag me-2"></i>Fazer Oferta
                        </button>` : ''}
                        <button class="btn btn-ml-secondary w-100 mb-2" onclick="window.addToCart('${pid}', {qty:window._detailQty || 1});">
                            <i class="bi bi-cart-plus me-2"></i>Adicionar ao Carrinho
                        </button>
                    `}
                    <div class="d-flex gap-2">
                        <button class="btn btn-link text-decoration-none flex-grow-1 text-muted small" onclick="window.shareProduct('${pid}')">
                            <i class="bi bi-share me-2"></i>Compartilhar
                        </button>
                        <button id="detailLikeBtn" class="btn btn-link text-decoration-none flex-grow-1 small ${likedProducts.includes(pid) ? 'text-danger' : 'text-muted'}" onclick="window.toggleLike('${pid}')">
                            <i class="bi ${likedProducts.includes(pid) ? 'bi-heart-fill' : 'bi-heart'} me-2"></i>${likedProducts.includes(pid) ? 'Curtido' : 'Curtir'}
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

    window.scrollTo({ top: 0, behavior: 'smooth' });
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
};

window.prepareEditProduct = function(pid) {
    new bootstrap.Modal(document.getElementById('announceModal')).show();
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
                ? `<img src="${userAvatarLink}" style="width:100%;height:100%;object-fit:cover;" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/100'">`
                : `<i class="bi bi-person-circle fs-5 text-white"></i>`;
        }

        if (mobileMenuAvatar) {
            mobileMenuAvatar.innerHTML = hasAvatar
                ? `<img src="${userAvatarLink}" style="width:100%;height:100%;object-fit:cover;" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/100'">`
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
                container.innerHTML = '<div class="p-5 text-center text-muted"><i class="bi bi-bell-slash fs-1 d-block mb-2"></i>Nenhuma notificação</div>';
            } else {
                const icons = { 
                    success: { icon: 'bi-check-circle-fill', color: 'text-success' }, 
                    error:   { icon: 'bi-x-circle-fill', color: 'text-danger' }, 
                    info:    { icon: 'bi-info-circle-fill', color: 'text-primary' }, 
                    warning: { icon: 'bi-exclamation-triangle-fill', color: 'text-warning' } 
                };

                container.innerHTML = notifs.map(n => `
                    <div class="list-group-item list-group-item-action border-start-0 border-end-0 py-3 ${n.read ? 'opacity-75' : 'bg-light fw-bold'}">
                        <div class="d-flex align-items-center gap-3">
                            <i class="bi ${(icons[n.type] || icons.info).icon} fs-4 ${(icons[n.type] || icons.info).color}"></i>
                            <div class="flex-grow-1">
                                <div class="small">${n.message}</div>
                                <div class="text-muted" style="font-size: 0.65rem;">${new Date(n.created_at).toLocaleString('pt-BR')}</div>
                            </div>
                        </div>
                    </div>
                `).join('');
            }
    }
    
    if (badge) {
        const unread = displayNotifs.filter(n => !n.read).length;
        badge.textContent = unread;
        badge.classList.toggle('d-none', unread === 0);
    }
    // Badge para o menu mobile "Mais"
    const mobileBadge = document.getElementById('mobileNotifBadge');
    if (mobileBadge) {
        const unread = displayNotifs.filter(n => !n.read).length;
        mobileBadge.textContent = unread;
        mobileBadge.classList.toggle('d-none', unread === 0);
    }
}

/**
 * Abre o painel de notificações e marca como lidas
 */
window.showNotifications = async function() {
    const modalEl = document.getElementById('notificacoesModal');
    if (modalEl) {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
        loadNotifications();
    }
}

function updateCartBadge() {
    const count = cart.reduce((a, i) => a + (i.qtd || 1), 0);
    document.querySelectorAll('#cartBadgeDesktop, #cartBadgeMobile').forEach(el => {
        if (el) { el.textContent = count; el.classList.toggle('d-none', count === 0); }
    });
}

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
        <div class="cart-item border rounded p-2 mb-2">
            <div class="d-flex gap-2 align-items-center">
                <img src="${thumb || 'https://placehold.co/60'}" style="width:50px;height:50px;object-fit:contain;border-radius:6px;" loading="lazy">
                <div class="flex-grow-1">
                    <div class="small fw-bold text-truncate">${item.titulo}</div>
                    <div class="text-success fw-bold small">${(item.preco || 0) === 0 ? 'GRÁTIS' : `R$ ${(item.preco || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}`}</div>
                    <div class="d-flex align-items-center gap-2 mt-1">
                        <button class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="window.updateCartQty(${i}, -1)">−</button>
                        <span class="small fw-bold">${item.qtd || 1}</span>
                        <button class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="window.updateCartQty(${i}, +1)">+</button>
                    </div>
                </div>
            </div>
            <div class="d-flex gap-1 mt-2">
                <button class="btn btn-sm btn-outline-danger flex-grow-1" onclick="removeFromCart(${i})">
                    <i class="bi bi-trash"></i>
                </button>
                <button class="btn btn-sm btn-ml-primary flex-grow-1" onclick="buyItem(${i})">
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

window.addToCart = function(productId, options = {}) {
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
                id:           `chat_${Date.now()}`,
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

/** Abre o modal de oferta já preenchido com os dados do produto */
window.openOfferModal = function(pid) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login para enviar uma oferta!', 'warning'); return; }

    const item = allProductsCache.find(x => x.id == pid || x.id === pid);
    if (!item) { showToast('Produto não encontrado.', 'error'); return; }
    if (user.id === item.vendedor_id) { showToast('Você não pode fazer uma oferta no seu próprio anúncio.', 'warning'); return; }

    const preco = parseFloat(item.preco) || 0;
    document.getElementById('offerForm').dataset.pid = pid;
    document.getElementById('offerProductTitle').textContent = item.titulo;
    document.getElementById('offerProductImg').src = safeParseImages(item.img)[0] || 'https://placehold.co/60';
    document.getElementById('offerProductPrice').innerHTML = `Preço anunciado: <strong>${formatPreco(preco)}</strong>`;
    document.getElementById('offerAmount').value = '';
    document.getElementById('offerAmount').max = preco > 0 ? preco - 0.01 : '';
    document.getElementById('offerQty').value = 1;
    document.getElementById('offerQty').max = Math.max(1, item.quantidade || 1);

    new bootstrap.Modal(document.getElementById('makeOfferModal')).show();
};

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
            offer_amount:         offerValue,
            offer_original_price: preco,
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
                id:           `chat_${Date.now()}`,
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
        bootstrap.Modal.getInstance(document.getElementById('makeOfferModal'))?.hide();

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

document.addEventListener('DOMContentLoaded', () => {
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
                descricao:    document.getElementById('prodDescription').value,
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
            avatar:    novoAvatar || user.avatar
        };

        await supabaseFetch(`users?id=eq.${user.id}`, { method: 'PATCH', body: JSON.stringify(updated) });
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
});

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
    // Removida a validação matemática complexa para ser compatível com a versão antiga (que permitia CPFs de teste).
    // Validamos apenas se tem os 11 dígitos necessários.
    return cpf.length === 11;
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
        const avatarLinks = safeParseImages(user.avatar);
        linkInput.value = avatarLinks.length > 0 ? avatarLinks[0] : '';
    }

    const preview = document.getElementById('profilePreview');
    if (preview) {
        preview.src = user.avatar?.startsWith('http') ? user.avatar : 'https://placehold.co/100';
    }

    document.getElementById('profileLinksName').textContent = user.nome || 'Meu Perfil';
    document.getElementById('profileLinksTypeBadge').textContent =
        user.tipo === 'ADMIN' ? 'Administrador' : (user.tipo === 'VENDEDOR' ? 'Vendedor' : 'Cliente');
    document.getElementById('profileEditScreen').classList.remove('d-none');
    document.body.style.overflow = 'hidden';
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

        const payload = {
            id:       `user_${Date.now()}`,
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
            avatar:   avatarUrl,
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
function startOrdersPolling(type) {
    stopOrdersPolling();
    ordersPollInterval = setInterval(() => {
        const waView = document.getElementById('whatsappOrdersView');
        // Só continua se a lista ainda estiver visível e for a mesma aba (Compras/Vendas)
        if (!waView || waView.classList.contains('d-none') || currentOrderViewType !== type) {
            stopOrdersPolling();
            return;
        }
        // Não atualiza a lista enquanto uma conversa estiver aberta, pra não
        // interromper o polling de mensagens (mais prioritário nesse momento)
        if (currentChat) return;
        renderOrdersListSilently(type);
    }, 6000);
}

function stopOrdersPolling() {
    if (ordersPollInterval) {
        clearInterval(ordersPollInterval);
        ordersPollInterval = null;
    }
}

/** Re-busca e redesenha só a listinha lateral, sem mostrar spinner nem fechar a conversa aberta */
async function renderOrdersListSilently(type) {
    const user = getSavedUser();
    if (!user) return;
    const waList  = document.getElementById('waContactList');
    const waTitle = document.getElementById('waSideTitle');
    if (!waList) return;

    try {
        let path = 'orders?select=*';
        if (type === 'buyer') path += `&buyer_id=eq.${user.id}`;
        else path += `&seller_id=eq.${user.id}`;

        let orders = await supabaseFetch(path);
        const previousSignature = JSON.stringify(ordersCache.map(o => `${o.id}:${o.status}:${o.agree_buyer}:${o.agree_seller}`));
        ordersCache = orders;

        orders = orders.filter(o => (o.status !== 'pending' && o.status !== 'offer_pending') || type === 'buyer');
        orders = orders.slice().sort((a,b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

        const newSignature = JSON.stringify(orders.map(o => `${o.id}:${o.status}:${o.agree_buyer}:${o.agree_seller}`));
        if (newSignature === previousSignature) return; // nada mudou, evita re-render desnecessário

        if (!orders.length) return; // mantém a mensagem de "nenhum pedido" já mostrada

        waList.innerHTML = orders.map(order => {
            const st        = ORDER_STATUS_MAP[order.status] || { text: order.status, class: 'bg-secondary' };
            const isPending = order.status === 'pending' || order.status === 'offer_pending';
            const isBuyer   = user.id === order.buyer_id;
            const partnerName = isBuyer ? order.seller_name : order.buyer_name;

            let actionsHtml = '';
            if (isPending && type === 'buyer') {
                actionsHtml = `<button class="btn btn-sm btn-outline-danger w-100" onclick="event.stopPropagation(); window.cancelOrderBuyer('${order.id}')">${order.status === 'offer_pending' ? 'Cancelar Oferta' : 'Cancelar Pedido'}</button>`;
            } else if (order.status === 'cancelled' || order.status === 'finished') {
                actionsHtml = `<button class="btn btn-sm btn-outline-secondary w-100" onclick="event.stopPropagation(); window.removeOrderFromHistory('${order.id}', '${type}')"><i class="bi bi-trash me-1"></i>Remover</button>`;
            }

            return `
            <div class="wa-contact" data-order-id="${order.id}" onclick="${!isPending && order.status !== 'cancelled' ? `window.showChat('${order.id}')` : ''}" style="${isPending || order.status === 'cancelled' ? 'cursor:default;' : ''}">
                <img src="${order.product_img || ''}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/45'">
                <div class="wa-contact-textbox">
                    <div class="wa-contact-name">${partnerName || 'Usuário'}</div>
                    <div class="wa-contact-text">${order.product_title || 'Produto'} · ${order.status === 'offer_pending' ? `Oferta: ${formatPreco(order.offer_amount, {htmlGratis:false})}` : formatPreco(order.total, {htmlGratis:false})}</div>
                    ${actionsHtml ? `<div class="d-flex gap-2 mt-2">${actionsHtml}</div>` : ''}
                </div>
                <span class="badge ${st.class} wa-contact-badge">${st.text}</span>
            </div>`;
        }).join('');
        window.filterWaContacts(document.getElementById('waContactSearch')?.value || '');
    } catch (e) {
        // Falha silenciosa: não interrompe a experiência do usuário durante o polling
        console.error('Falha ao atualizar lista de pedidos (silencioso):', e);
    }
}

window.renderOrderManagement = async function(type = 'buyer') {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }

    // "Solicitações Pendentes" não é uma conversa — é uma tela de aceitar/recusar
    // com os dados do cliente (endereço etc.), então usa uma tela própria, sem chat.
    if (type === 'seller_requests') {
        return window.renderSellerRequests();
    }

    const grid  = document.getElementById('productsGrid');
    const hero  = document.getElementById('heroSection');
    const gridMain = document.getElementById('productGridMain');
    const waView = document.getElementById('whatsappOrdersView');
    const waList = document.getElementById('waContactList');
    const waTitle = document.getElementById('waSideTitle');
    if (hero) hero.classList.add('d-none');
    if (gridMain) gridMain.classList.add('d-none');
    if (grid) { grid.classList.remove('order-view-active'); grid.innerHTML = ''; grid.style.display = 'none'; }

    currentOrderViewType = type;
    if (waView) waView.classList.remove('d-none');
    document.body.classList.add('wa-locked');
    window.closeWaChat(); // fecha qualquer conversa aberta ao trocar de aba (Compras/Vendas/Solicitações)

    waList.innerHTML = '<div class="text-center py-5 w-100"><div class="spinner-border text-success"></div></div>';

    try {
        let path = 'orders?select=*';
        if (type === 'buyer') {
            path += `&buyer_id=eq.${user.id}`;
            if (waTitle) waTitle.textContent = 'Minhas Compras';
        } else {
            path += `&seller_id=eq.${user.id}`;
            if (waTitle) waTitle.textContent = 'Minhas Vendas';
        }

        let orders = await supabaseFetch(path);
        ordersCache = orders;

        // Aqui só entram pedidos já aceitos (a tela de chat não faz sentido pra pendentes/ofertas)
        orders = orders.filter(o => (o.status !== 'pending' && o.status !== 'offer_pending') || type === 'buyer');

        // Mais recentes primeiro, como numa lista de conversas de verdade
        orders = orders.slice().sort((a,b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

        if (!orders.length) {
            waList.innerHTML = `
                <div class="text-center py-5 px-3" style="color:#999;">
                    <i class="bi bi-inbox fs-1 d-block mb-2"></i>
                    <p class="small mb-0">Nenhum pedido encontrado.</p>
                </div>`;
            startOrdersPolling(type);
            return;
        }

        waList.innerHTML = orders.map(order => {
            const st        = ORDER_STATUS_MAP[order.status] || { text: order.status, class: 'bg-secondary' };
            const isPending = order.status === 'pending' || order.status === 'offer_pending';
            const isBuyer   = user.id === order.buyer_id;
            const partnerName = isBuyer ? order.seller_name : order.buyer_name;

            let actionsHtml = '';
            if (isPending && type === 'buyer') {
                actionsHtml = `<button class="btn btn-sm btn-outline-danger w-100" onclick="event.stopPropagation(); window.cancelOrderBuyer('${order.id}')">${order.status === 'offer_pending' ? 'Cancelar Oferta' : 'Cancelar Pedido'}</button>`;
            } else if (order.status === 'cancelled' || order.status === 'finished') {
                actionsHtml = `<button class="btn btn-sm btn-outline-secondary w-100" onclick="event.stopPropagation(); window.removeOrderFromHistory('${order.id}', '${type}')"><i class="bi bi-trash me-1"></i>Remover</button>`;
            }

            return `
            <div class="wa-contact" data-order-id="${order.id}" onclick="${!isPending && order.status !== 'cancelled' ? `window.showChat('${order.id}')` : ''}" style="${isPending || order.status === 'cancelled' ? 'cursor:default;' : ''}">
                <img src="${order.product_img || ''}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/45'">
                <div class="wa-contact-textbox">
                    <div class="wa-contact-name">${partnerName || 'Usuário'}</div>
                    <div class="wa-contact-text">${order.product_title || 'Produto'} · ${order.status === 'offer_pending' ? `Oferta: ${formatPreco(order.offer_amount, {htmlGratis:false})}` : formatPreco(order.total, {htmlGratis:false})}</div>
                    ${actionsHtml ? `<div class="d-flex gap-2 mt-2">${actionsHtml}</div>` : ''}
                </div>
                <span class="badge ${st.class} wa-contact-badge">${st.text}</span>
            </div>`;
        }).join('');

        window.closeMobileMenu();
        startOrdersPolling(type);
    } catch (e) {
        waList.innerHTML = '<div class="text-center py-5" style="color:#999;"><h6>Erro ao carregar pedidos.</h6></div>';
    }
};

/**
 * Tela de "Solicitações Pendentes": aceitar ou recusar pedidos novos, com os
 * dados do cliente (nome, telefone, endereço) — sem chat, porque ainda não
 * existe uma venda confirmada pra conversar.
 */
window.renderSellerRequests = async function() {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }

    window.exitWaOrdersView();
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    document.getElementById('gridTitle').textContent = 'Solicitações Pendentes';

    const grid = document.getElementById('productsGrid');
    grid.style.display = 'flex';
    grid.style.flexWrap = 'wrap';
    grid.classList.remove('order-view-active');
    grid.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border text-success"></div></div>';

    try {
        let orders = await supabaseFetch(`orders?select=*&seller_id=eq.${user.id}`);
        ordersCache = orders;
        orders = orders.filter(o => o.status === 'pending' || o.status === 'offer_pending');

        if (!orders.length) {
            grid.innerHTML = `<div class="col-12 text-center py-5"><i class="bi bi-inbox fs-1 text-muted d-block mb-3"></i><h5>Nenhuma solicitação pendente.</h5></div>`;
            return;
        }

        // Busca os dados de contato/endereço de cada comprador
        const buyerIds = [...new Set(orders.map(o => o.buyer_id))];
        let buyers = [];
        try {
            buyers = await supabaseFetch(`users?select=id,nome,telefone,cep,endereco,cidade,estado&id=in.(${buyerIds.join(',')})`);
        } catch (e) {}
        const buyerMap = Object.fromEntries(buyers.map(b => [b.id, b]));

        grid.innerHTML = orders.map(order => {
            const buyer = buyerMap[order.buyer_id] || {};
            const isOffer = order.status === 'offer_pending';
            return `
            <div class="col-12 col-lg-6">
                <div class="card border-0 shadow-sm p-3 mb-3" style="border-radius:14px;${isOffer ? 'border:1.5px solid #3483fa !important;' : ''}">
                    ${isOffer ? `<span class="badge bg-primary align-self-start mb-2" style="font-size:0.68rem;"><i class="bi bi-tag-fill me-1"></i>OFERTA DO CLIENTE</span>` : ''}
                    <div class="d-flex gap-3">
                        <img src="${order.product_img || ''}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/70'"
                             style="width:70px;height:70px;object-fit:cover;border-radius:10px;flex-shrink:0;">
                        <div class="flex-grow-1">
                            <h6 class="fw-bold mb-1">${order.product_title || 'Produto'}</h6>
                            ${isOffer ? `
                                <p class="mb-1"><span class="text-muted text-decoration-line-through small">${formatPreco(order.offer_original_price, {htmlGratis:false})}</span>
                                    <span class="fw-bold text-primary ms-1">${formatPreco(order.offer_amount, {htmlGratis:false})}</span>
                                    <small class="text-muted fw-normal">(${order.quantity} un. · oferta)</small></p>
                            ` : `
                                <p class="mb-1 text-success fw-bold">${formatPreco(order.total, {htmlGratis:false})} <small class="text-muted fw-normal">(${order.quantity} un.)</small></p>
                            `}
                            <p class="mb-0 small text-muted">ID: #${order.id.slice(-8).toUpperCase()}</p>
                        </div>
                    </div>
                    <hr>
                    <p class="small mb-1"><i class="bi bi-person-fill me-2 text-muted"></i><strong>${buyer.nome || order.buyer_name || 'Cliente'}</strong></p>
                    ${buyer.telefone ? `<p class="small mb-1"><i class="bi bi-telephone-fill me-2 text-muted"></i>${buyer.telefone}</p>` : ''}
                    ${buyer.endereco ? `<p class="small mb-2"><i class="bi bi-geo-alt-fill me-2 text-muted"></i>${buyer.endereco}${buyer.cep ? `, CEP ${buyer.cep}` : ''} — ${buyer.cidade || ''}/${buyer.estado || ''}</p>` : `<p class="small mb-2 text-muted"><i class="bi bi-geo-alt-fill me-2"></i>Endereço não informado</p>`}
                    <div class="d-flex gap-2 mt-2">
                        <button class="btn btn-success fw-bold flex-grow-1" onclick="window.updateOrderStatus('${order.id}', 'accepted')">
                            <i class="bi bi-check-lg me-1"></i>${isOffer ? 'Aceitar Oferta' : 'Aceitar'}
                        </button>
                        <button class="btn btn-outline-danger flex-grow-1" onclick="window.updateOrderStatus('${order.id}', 'cancelled')">
                            ${isOffer ? 'Recusar Oferta' : 'Recusar'}
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');

        window.closeMobileMenu();
    } catch (e) {
        grid.innerHTML = '<div class="col-12 text-center py-5"><h5>Erro ao carregar solicitações.</h5></div>';
    }
};

window.filterWaContacts = function(query) {
    const q = query.trim().toLowerCase();
    let anyVisible = false;
    document.querySelectorAll('#waContactList .wa-contact').forEach(el => {
        const text = el.textContent.toLowerCase();
        const show = !q || text.includes(q);
        el.style.display = show ? '' : 'none';
        if (show) anyVisible = true;
    });
    let emptyMsg = document.getElementById('waSearchEmptyMsg');
    if (!anyVisible && q) {
        if (!emptyMsg) {
            emptyMsg = document.createElement('div');
            emptyMsg.id = 'waSearchEmptyMsg';
            emptyMsg.className = 'text-center py-4 px-3';
            emptyMsg.style.color = '#999';
            emptyMsg.innerHTML = '<i class="bi bi-search fs-4 d-block mb-2"></i><p class="small mb-0">Nenhuma conversa encontrada.</p>';
            document.getElementById('waContactList')?.appendChild(emptyMsg);
        }
    } else if (emptyMsg) {
        emptyMsg.remove();
    }
};

window.updateOrderStatus = async function(orderId, newStatus) {
    try {
        // Busca o pedido antes de alterar, pra saber quem é o comprador e poder avisá-lo
        const orderData = await supabaseFetch(`orders?id=eq.${orderId}&limit=1`);
        const order = orderData?.[0];

        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus, updated_at: new Date().toISOString() })
        });
        const isOffer = order?.status === 'offer_pending';
        showToast(`${isOffer ? 'Oferta' : 'Pedido'} ${newStatus === 'accepted' ? 'aceita' : 'recusada'}!`, newStatus === 'accepted' ? 'success' : 'info');

        // CORREÇÃO: antes o comprador nunca era avisado que o pedido tinha sido
        // aceito/recusado — só descobriria se, por conta própria, saísse da tela
        // "Minhas Compras" e voltasse pra ela de novo. Agora ele recebe uma
        // notificação (sino) assim que o vendedor decide.
        if (order?.buyer_id) {
            const msg = newStatus === 'accepted'
                ? (isOffer
                    ? `Sua oferta de ${formatPreco(order.offer_amount, {htmlGratis:false})} para "${order.product_title || 'produto'}" foi aceita! Você já pode conversar com o vendedor.`
                    : `Sua proposta para "${order.product_title || 'produto'}" foi aceita! Você já pode conversar com o vendedor.`)
                : (isOffer
                    ? `Sua oferta para "${order.product_title || 'produto'}" foi recusada pelo vendedor.`
                    : `Sua proposta para "${order.product_title || 'produto'}" foi recusada pelo vendedor.`);
            await createPersistentNotification(msg, newStatus === 'accepted' ? 'success' : 'warning', order.buyer_id);
        }

        window.renderOrderManagement(newStatus === 'accepted' ? 'seller_sales' : 'seller_requests');
        const user = getSavedUser();
        if (user) updateSellerPendingBadge(user.id);
    } catch { showToast('Erro ao atualizar pedido.', 'error'); }
};

window.removeOrderFromHistory = async function(orderId, type) {
    if (!confirm('Deseja remover este registro do seu histórico?')) return;
    try {
        // Primeiro remove o chat (devido a restrições de chave estrangeira)
        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'DELETE' });
        // Depois remove o pedido
        await supabaseFetch(`orders?id=eq.${orderId}`, { method: 'DELETE' });
        
        showToast('Pedido removido do histórico!', 'info');
        window.renderOrderManagement(type);
    } catch (err) { 
        console.error("Erro ao remover:", err);
        showToast('Erro ao remover registro. Verifique a conexão.', 'error'); 
    }
};

window.cancelOrderBuyer = async function(orderId) {
    if (!confirm('Tem certeza que deseja cancelar este pedido?')) return;
    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'cancelled', updated_at: new Date().toISOString() })
        });
        showToast('Pedido cancelado!', 'info');
        window.renderOrderManagement('buyer');
    } catch { showToast('Erro ao cancelar pedido.', 'error'); }
};

window.deleteProduct = async function(pid) {
    if (!confirm('Tem certeza que deseja excluir este anúncio?')) return;
    try {
        await supabaseFetch(`products?id=eq.${pid}`, { method: 'DELETE' });
        showToast('Produto removido!', 'success');
        window._preDetailState = null;
        loadPage(undefined, true);
    } catch { showToast('Erro ao excluir produto.', 'error'); }
};

window.resetAnnounceModal = function() {
    const form = document.getElementById('announceForm');
    if (form) {
        form.reset();
        delete form.dataset.editingId;
        const modalTitle = document.querySelector('#announceModal .modal-title');
        const submitBtn  = document.querySelector('#announceForm button[type="submit"]');
        if (modalTitle) modalTitle.textContent = 'O que você quer vender?';
        if (submitBtn)  submitBtn.textContent   = 'Publicar Anúncio';
    }
};

// ============================================
// CHAT COMPLETO
// ============================================

window.showChat = async function(orderId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }

    let order = ordersCache.find(o => o.id === orderId);
    if (!order) {
        const result = await supabaseFetch(`orders?id=eq.${orderId}&limit=1`);
        order = result[0];
    }
    if (!order) { showToast('Pedido não encontrado.', 'error'); return; }

    if (currentChat !== orderId) lastChatSignature = null;
    currentChat = orderId;

    const otherId = user.id === order.buyer_id ? order.seller_id : order.buyer_id;
    const otherName = user.id === order.buyer_id ? order.seller_name : order.buyer_name;
    document.getElementById('chatPartnerNameHeader').textContent = otherName || 'Chat';

    const avatarEl = document.getElementById('chatPartnerAvatar');
    const dotEl = document.getElementById('chatPartnerStatusDot');
    avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(otherName || 'User')}&background=random&size=40`; // placeholder enquanto busca a foto real
    dotEl?.classList.remove('online', 'offline');
    try {
        const partnerData = await supabaseFetch(`users?select=avatar,last_seen&id=eq.${otherId}&limit=1`);
        const realAvatar = normalizeImageUrl(partnerData?.[0]?.avatar);
        if (realAvatar) avatarEl.src = realAvatar;
        if (dotEl) dotEl.classList.add(isRecentlyOnline(partnerData?.[0]?.last_seen) ? 'online' : 'offline');
    } catch (e) {}

    // Popula resumo do produto
    document.getElementById('chatProdImg').src = order.product_img || 'https://placehold.co/45/e9ecef/6c757d?text=%20';
    document.getElementById('chatProdTitle').textContent = order.product_title || 'Produto';
    document.getElementById('chatProdPrice').textContent = formatPreco(order.total, {htmlGratis:false});
    document.getElementById('chatOrderIdDisplay').textContent = `#${order.id.slice(-6).toUpperCase()}`;
    document.getElementById('chatOrderIdDisplayHeader').textContent = `#${order.id.slice(-6).toUpperCase()}`;

    // Abre o painel de chat inline (estilo WhatsApp Web), sem modal
    document.getElementById('waEmptyState')?.classList.add('d-none');
    const activePanel = document.getElementById('waChatActive');
    activePanel?.classList.remove('d-none');
    activePanel?.classList.add('d-flex');
    document.getElementById('whatsappOrdersView')?.classList.add('wa-chat-open'); // esconde a lista no mobile

    // Marca o contato ativo na lista lateral
    document.querySelectorAll('#waContactList .wa-contact').forEach(el => {
        el.classList.toggle('active-chat', el.dataset.orderId === orderId);
    });

    await loadChatMessages(orderId);
    setupPullToRefresh();
    startChatPolling(orderId);
};

/**
 * Fecha a conversa ativa e volta pro estado "selecione uma conversa"
 * (ou, no mobile, volta pra lista de contatos).
 */
window.closeWaChat = function() {
    stopChatPolling();
    currentChat = null;
    lastChatSignature = null;
    document.getElementById('waChatActive')?.classList.add('d-none');
    document.getElementById('waChatActive')?.classList.remove('d-flex');
    document.getElementById('waEmptyState')?.classList.remove('d-none');
    document.getElementById('whatsappOrdersView')?.classList.remove('wa-chat-open');
    document.querySelectorAll('#waContactList .wa-contact').forEach(el => el.classList.remove('active-chat'));
};

// ============================================
// AUTO-ATUALIZAÇÃO DE MENSAGENS (POLLING)
// ============================================

/**
 * Inicia a atualização automática das mensagens enquanto o chat estiver aberto.
 * Usa "silent = true" para não piscar o spinner nem interromper o scroll do usuário.
 */
function startChatPolling(orderId) {
    stopChatPolling();
    chatPollInterval = setInterval(() => {
        // Só continua atualizando se o painel de chat ainda estiver visível
        const activePanel = document.getElementById('waChatActive');
        if (!activePanel || activePanel.classList.contains('d-none') || currentChat !== orderId) {
            stopChatPolling();
            return;
        }
        loadChatMessages(orderId, true);
    }, 4000);
}

function stopChatPolling() {
    if (chatPollInterval) {
        clearInterval(chatPollInterval);
        chatPollInterval = null;
    }
}

async function loadChatMessages(orderId, silent = false) {
    const container = document.getElementById('chatMessagesContainer');
    if (!silent) {
        container.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div><p class="small mt-2">Carregando mensagens...</p></div>';
    }

    try {
        const user = getSavedUser();
        // CORREÇÃO: antes, se o pedido já estivesse em ordersCache, ele nunca era
        // atualizado de novo — então mudanças feitas pela OUTRA pessoa (aceitar o
        // pedido, propor uma logística de entrega, etc.) nunca apareciam aqui,
        // mesmo com o polling rodando. Agora sempre buscamos o pedido fresco do
        // banco, e sincronizamos o cache local com esse dado atualizado.
        let order = null;
        try {
            const r = await supabaseFetch(`orders?id=eq.${orderId}&limit=1`);
            order = r?.[0] || null;
        } catch (e) { /* se a rede falhar momentaneamente, cai no fallback abaixo */ }

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
                id:           `chat_${Date.now()}`,
                order_id:     orderId,
                seller_id:    order.seller_id,
                seller_name:  order.seller_name,
                buyer_id:     order.buyer_id,
                buyer_name:   order.buyer_name,
                participants: [order.seller_id, order.buyer_id],
                messages:     [{
                    senderId:  'system',
                text:      `Pedido #${orderId.slice(-8).toUpperCase()}`,
                    timestamp: new Date().toISOString(),
                    type:      'system'
                }],
                logistics_agreed: false
            };
            await supabaseFetch('chats', { method: 'POST', body: JSON.stringify(newChat) });
            chat = newChat;
        }

        if (!chat?.messages) {
            if (!silent) container.innerHTML = '<div class="text-center py-4 text-muted">Nenhuma mensagem ainda.</div>';
            return;
        }

        // Evita re-renderizar (e perder a posição do scroll/seleção) quando nada mudou
        const signature = JSON.stringify(chat.messages);
        if (silent && signature === lastChatSignature) {
            updateChatLogistics(order, user);
            return;
        }
        const isNewIncoming = silent && lastChatSignature !== null && chat.messages.length > (JSON.parse(lastChatSignature || '[]').length || 0);
        lastChatSignature = signature;

        // Preserva a posição de leitura: só rola pro fim automaticamente se o usuário
        // já estava perto do fim (ou se não é uma atualização silenciosa).
        const wasNearBottom = !silent || (container.scrollHeight - container.scrollTop - container.clientHeight < 120);

        const myAvatar = normalizeImageUrl(user.avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.nome||'Você')}&background=22c98e&color=fff&size=40`;
        const partnerAvatarSrc = document.getElementById('chatPartnerAvatar')?.src || '';

        container.innerHTML = chat.messages.map((msg, index) => {
            if (msg.type === 'system' || msg.senderId === 'system') {
                return `<div class="text-center my-3">
                    <span class="system-chip">
                        <i class="bi bi-info-circle-fill"></i>${stripLegacyEmoji(msg.text)}
                    </span>
                </div>`;
            }

            const isMe = msg.senderId === user.id;
            // Agrupamento estilo WhatsApp: some com o nome/margem quando a mensagem
            // anterior é da mesma pessoa em sequência.
            const prevMsg = chat.messages[index - 1];
            const isGrouped = prevMsg && prevMsg.senderId === msg.senderId && prevMsg.type !== 'system';

            if (msg.deleted) {
                return `
                <div class="msg-row ${isMe ? 'is-me' : 'is-them'}" style="${isGrouped ? 'margin-top:-4px;' : ''}">
                    ${!isMe ? `<img class="msg-avatar" src="${partnerAvatarSrc}" referrerpolicy="no-referrer">` : ''}
                    <div class="msg-bubble ${isMe ? 'is-me' : 'is-them'} msg-deleted">
                        <i class="bi bi-slash-circle me-1"></i><em>Mensagem apagada</em>
                    </div>
                    ${isMe ? `<img class="msg-avatar" src="${myAvatar}" referrerpolicy="no-referrer">` : ''}
                </div>`;
            }

            const cleanText = stripLegacyEmoji(msg.text);
            const replyHtml = msg.replyTo ? `
                <div class="p-2 mb-2 rounded ${isMe ? 'bg-white bg-opacity-25' : 'bg-secondary bg-opacity-10'} small border-start border-4 border-info">
                    <div class="fw-bold" style="font-size: 0.7rem;">${msg.replyTo.senderName}</div>
                    <div class="text-truncate chat-reply-preview">${stripLegacyEmoji(msg.replyTo.text)}</div>
                </div>
            ` : '';

            // Anexo de arquivo: mostra um "chip" clicável com ícone, em vez de texto cru
            const fileChipHtml = (msg.type === 'file' && msg.file) ? `
                <a href="${msg.file.url}" target="_blank" rel="noopener" class="chat-file-chip mb-2">
                    <i class="bi bi-file-earmark-arrow-down-fill"></i>
                    <span class="chat-file-name">${cleanText.replace(/^Arquivo:\s*/, '') || msg.file.name || 'Arquivo'}</span>
                </a>
            ` : '';

            // Some a legenda redundante quando é só uma imagem ou arquivo sem comentário adicional
            const showTextCaption = cleanText && !(msg.image && cleanText === 'Imagem') && !(msg.type === 'file' && msg.file);

            return `
            <div class="msg-row ${isMe ? 'is-me' : 'is-them'}" style="${isGrouped ? 'margin-top:-4px;' : ''}">
                ${!isMe ? `<img class="msg-avatar" src="${partnerAvatarSrc}" referrerpolicy="no-referrer">` : ''}
                <div class="msg-bubble ${isMe ? 'is-me' : 'is-them'}">

                    <div class="d-flex justify-content-between align-items-center mb-1 gap-2">
                        ${!isGrouped ? `<span class="msg-sender">${isMe ? 'Você' : (msg.senderName || 'Usuário')}</span>` : '<span></span>'}
                        <div class="dropdown">
                            <i class="bi bi-chevron-down cursor-pointer opacity-50" data-bs-toggle="dropdown" style="font-size: 0.8rem;"></i>
                            <ul class="dropdown-menu dropdown-menu-end shadow-sm">
                                <li><a class="dropdown-item py-1 small" href="javascript:void(0)" onclick="window.startReply(${index})"><i class="bi bi-reply me-2"></i>Responder</a></li>
                                <li><a class="dropdown-item py-1 small" href="javascript:void(0)" onclick="window.copyMessageText(${index})"><i class="bi bi-clipboard me-2"></i>Copiar</a></li>
                                ${isMe ? `<li><a class="dropdown-item py-1 small" href="javascript:void(0)" onclick="window.startEdit(${index})"><i class="bi bi-pencil me-2"></i>Editar</a></li>` : ''}
                                ${isMe ? `<li><a class="dropdown-item py-1 small text-danger" href="javascript:void(0)" onclick="window.deleteMessage(${index})"><i class="bi bi-trash me-2"></i>Apagar</a></li>` : ''}
                            </ul>
                        </div>
                    </div>

                    ${replyHtml}

                    ${msg.image ? `
                        <img src="${msg.image}" class="img-fluid rounded mb-2" referrerpolicy="no-referrer"
                             style="max-width:220px;cursor:pointer;"
                             onclick="window.openImageFull('${msg.image}')">
                    ` : ''}
                    ${fileChipHtml}
                    ${showTextCaption ? `<div class="chat-bubble-text" style="white-space:pre-wrap;">${formatLinks(cleanText)}</div>` : ''}
                    <div class="msg-time">
                        ${msg.edited ? '<span>(editada)</span>' : ''}
                        ${new Date(msg.timestamp).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}
                    </div>
                </div>
                ${isMe ? `<img class="msg-avatar" src="${myAvatar}" referrerpolicy="no-referrer">` : ''}
            </div>`;
        }).join('');

        if (wasNearBottom) {
            container.scrollTop = container.scrollHeight;
        } else if (isNewIncoming) {
            showToast('Nova mensagem recebida.', 'info', 2000);
        }
        updateChatLogistics(order, user);

        const realCount = chat.messages.filter(m => m.type !== 'system').length;
        const headerSub = document.getElementById('chatOrderIdDisplayHeader');
        if (headerSub) headerSub.textContent = `${realCount} mensage${realCount === 1 ? 'm' : 'ns'} · #${orderId.slice(-6).toUpperCase()}`;

    } catch (e) {
        // Falha silenciosa durante o polling automático: não interrompe a experiência do usuário
        if (silent) { console.error('Falha ao atualizar mensagens (silencioso):', e); return; }
        console.error(e);
        container.innerHTML = `
            <div class="text-center py-4 text-danger">
                <i class="bi bi-exclamation-triangle fs-1 d-block mb-2"></i>
                <p>Erro ao carregar mensagens</p>
                <button class="btn btn-primary btn-sm" onclick="loadChatMessages('${orderId}')">Tentar novamente</button>
            </div>`;
    }
}

/**
 * Remove emojis de mensagens antigas que já estão salvas no banco de dados
 * (de antes da atualização visual do chat), para manter a exibição consistente
 * e profissional sem precisar migrar dados existentes.
 */
function stripLegacyEmoji(text) {
    if (!text) return '';
    return text
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function formatLinks(text) {
    if (!text) return '';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, url =>
        `<a href="${url}" target="_blank" class="text-info text-decoration-underline small"><i class="bi bi-link-45deg"></i>${url.substring(0,40)}${url.length>40?'...':''}</a>`
    );
}

function updateChatLogistics(order, user) {
    const logisticsArea    = document.getElementById('logisticsAgreementArea');
    const logisticsButtons = document.getElementById('logisticsButtons');
    if (!logisticsArea || !logisticsButtons) return;

    const isBuyer    = user.id === order.buyer_id;
    const isSeller   = user.id === order.seller_id;

    let buttonsHtml = '';

    if (['accepted', 'agreement'].includes(order.status)) {
        const userAgreed = isBuyer ? order.agree_buyer : order.agree_seller;
        const otherAgreed = isBuyer ? order.agree_seller : order.agree_buyer;

        if (order.agree_buyer && order.agree_seller) {
            if (isSeller) {
                if (order.logistics_type === 'pickup') {
                    buttonsHtml += `<button class="btn btn-primary w-100 rounded-pill fw-bold mb-2" onclick="window.advanceLogisticsStatus('${order.id}','awaiting_pickup')"><i class="bi bi-check2-circle me-1"></i>Marcar como Pronto p/ Retirada</button>`;
                } else {
                    buttonsHtml += `<button class="btn btn-primary w-100 rounded-pill fw-bold mb-2" onclick="window.advanceLogisticsStatus('${order.id}','shipping')"><i class="bi bi-truck me-1"></i>Marcar que Saiu p/ Entrega</button>`;
                }
            } else {
                buttonsHtml += `<div class="alert alert-success rounded-pill text-center small mb-2"><i class="bi bi-people-fill me-1"></i>Aguardando envio/retirada pelo vendedor</div>`;
            }
        } else if (!userAgreed) {
            if (otherAgreed && order.logistics_type) {
                const typeText = getLogisticsTypeText(order.logistics_type);
                buttonsHtml += `
                    <p class="text-center small mb-2">A outra parte propôs: <strong>${typeText}</strong></p>
                    <div class="d-flex gap-2 mb-2">
                        <button class="btn btn-success flex-grow-1 rounded-pill fw-bold" onclick="window.setLogistics('${order.id}','${order.logistics_type}')">Aceitar</button>
                        <button class="btn btn-outline-secondary flex-grow-1 rounded-pill" onclick="window.resetLogistics('${order.id}')">Recusar</button>
                    </div>`;
            } else {
                buttonsHtml += `
                    <p class="text-center small mb-2" style="color: #666;">Como vai funcionar a entrega?</p>
                    <div class="logistics-options-row">
                        <button class="logistics-option-btn" onclick="window.setLogistics('${order.id}','pickup')">
                            <span class="icon-circle" style="background:#6f42c1;"><i class="bi bi-shop"></i></span>
                            <span class="option-label">Retirada no Local</span>
                        </button>
                        <button class="logistics-option-btn" onclick="window.setLogistics('${order.id}','seller_delivery')">
                            <span class="icon-circle" style="background:#198754;"><i class="bi bi-truck"></i></span>
                            <span class="option-label">Entrega pelo Vendedor</span>
                        </button>
                        <button class="logistics-option-btn" onclick="window.setLogistics('${order.id}','external_app')">
                            <span class="icon-circle" style="background:#fd7e14;"><i class="bi bi-phone"></i></span>
                            <span class="option-label">App de Entrega</span>
                        </button>
                    </div>`;
            }
        } else {
            buttonsHtml += `<div class="alert alert-info rounded-pill text-center small mb-2"><i class="bi bi-hourglass-split me-1"></i>Proposta enviada! Aguardando o outro lado...</div>`;
        }
    } else if (['shipping', 'awaiting_pickup'].includes(order.status)) {
        if (isBuyer) {
            buttonsHtml += `<button class="btn btn-success w-100 rounded-pill fw-bold mb-2" onclick="window.confirmReceipt('${order.id}')"><i class="bi bi-box-seam-fill me-1"></i>Confirmar Recebimento</button>
                <button class="btn btn-link btn-sm w-100 text-muted" onclick="window.reportOrderProblem('${order.id}','produto_nao_recebido')"><i class="bi bi-exclamation-triangle me-1"></i>Não recebi o produto</button>`;
        } else {
            buttonsHtml += `<div class="alert alert-primary rounded-pill text-center small mb-2">Aguardando o comprador confirmar recebimento</div>
                <button class="btn btn-link btn-sm w-100 text-muted" onclick="window.reportOrderProblem('${order.id}','entrega_sem_confirmacao')"><i class="bi bi-exclamation-triangle me-1"></i>Já entreguei, mas o comprador não confirmou</button>`;
        }
    } else if (order.status === 'finished') {
        if (isBuyer) {
            buttonsHtml += order.buyer_reviewed
                ? `<div class="alert alert-success rounded-pill text-center small mb-2"><i class="bi bi-patch-check-fill me-1"></i>Você avaliou este vendedor. Obrigado!</div>`
                : `<button class="btn btn-warning w-100 rounded-pill fw-bold mb-2" onclick="window.openReviewModal('${order.id}', 'buyer_rates_seller')"><i class="bi bi-star-fill me-1"></i>Avaliar Vendedor</button>`;
        } else {
            buttonsHtml += order.seller_reviewed
                ? `<div class="alert alert-success rounded-pill text-center small mb-2"><i class="bi bi-patch-check-fill me-1"></i>Você avaliou este comprador. Obrigado!</div>`
                : `<button class="btn btn-warning w-100 rounded-pill fw-bold mb-2" onclick="window.openReviewModal('${order.id}', 'seller_rates_buyer')"><i class="bi bi-star-fill me-1"></i>Avaliar Comprador</button>`;
        }
    }

    logisticsButtons.innerHTML = buttonsHtml;

    const statusBar = document.getElementById('orderStatusBar');
    if (statusBar && order) {
        const statusMap = {
            'pending':         '<i class="bi bi-hourglass-split me-1"></i>Aguardando Aprovação',
            'accepted':        '<i class="bi bi-check-circle-fill me-1"></i>Aprovado - Combinar Entrega',
            'agreement':       '<i class="bi bi-people-fill me-1"></i>Definindo Logística',
            'shipping':        '<i class="bi bi-truck me-1"></i>Em Transporte',
            'awaiting_pickup': '<i class="bi bi-geo-alt-fill me-1"></i>Aguardando Retirada',
            'finished':        '<i class="bi bi-patch-check-fill me-1"></i>Finalizado',
            'cancelled':       '<i class="bi bi-x-circle-fill me-1"></i>Cancelado',
            'dispute':         '<i class="bi bi-exclamation-triangle-fill me-1"></i>Em Disputa'
        };
        const alertClass = order.status === 'finished' ? 'success' : order.status === 'cancelled' ? 'danger' : 'info';
        statusBar.innerHTML = `
            <div class="alert alert-${alertClass} mb-0 py-2 text-center small">
                ${statusMap[order.status] || order.status}
            </div>`;
    }
}

window.sendChatMessage = async function(event) {
    event.preventDefault();
    const input = document.getElementById('chatMessageInput');
    const text  = input?.value?.trim();
    const user  = getSavedUser();
    if ((!text && editingMessageIndex === null) || !user || !currentChat) return;

    try {
        const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
        const chat       = chatResult?.[0];
        if (!chat) { showToast('Chat não encontrado.', 'error'); return; }

        if (editingMessageIndex !== null) {
            chat.messages[editingMessageIndex].text = text;
            chat.messages[editingMessageIndex].edited = true;
        } else {
            const newMessage = {
                senderId:   user.id,
                senderName: user.nome,
                text,
                timestamp:  new Date().toISOString(),
                type:       'message'
            };

            if (currentReplyIndex !== null) {
                const repliedMsg = chat.messages[currentReplyIndex];
                newMessage.replyTo = {
                    text: repliedMsg.text,
                    senderName: repliedMsg.senderName
                };
            }
            chat.messages.push(newMessage);
        }

        await supabaseFetch(`chats?id=eq.${chat.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ messages: chat.messages })
        });

        input.value = '';
        window.cancelReplyOrEdit();
        await loadChatMessages(currentChat);
    } catch (e) {
        showToast('Erro ao enviar mensagem.', 'error');
    }
};

window.sendChatImage = async function(urlParam) {
    const rawUrl = urlParam;
    if (!rawUrl || !rawUrl.startsWith('http')) {
        showToast("Link de imagem inválido!", "warning");
        return;
    }

    const url = normalizeImageUrl(rawUrl);

    const user = getSavedUser();
    if (!user || !currentChat) return;
    
    try {
        const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
        const chat       = chatResult?.[0];
        if (!chat) { showToast('Chat não encontrado.', 'error'); return; }

        chat.messages.push({
            senderId: user.id, senderName: user.nome,
            text: 'Imagem', image: url,
            timestamp: new Date().toISOString(), type: 'image'
        });
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        await loadChatMessages(currentChat);
    } catch (e) { showToast('Erro ao processar o envio do link da imagem.', 'error'); }
};

window.sendChatFile = async function(urlParam) {
    const url = urlParam;
    if (!url || !url.startsWith('http')) {
        showToast("Link inválido!", "warning");
        return;
    }

    const user = getSavedUser();
    if (!user || !currentChat) return;
    try {
        const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
        const chat       = chatResult?.[0];
        if (!chat) return;
        chat.messages.push({
            senderId: user.id, senderName: user.nome,
            text: `Arquivo: ${url.split('/').pop()}`,
            file: { name: 'Arquivo Externo', url: url, size: 0 },
            timestamp: new Date().toISOString(), type: 'file'
        });
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        await loadChatMessages(currentChat);
    } catch { showToast('Erro ao enviar arquivo.', 'error'); }
};

// ============================================
// PAINEL DE ANEXO DO CHAT (substitui os prompt() feios por um painel de verdade)
// ============================================

let chatAttachType = 'image'; // 'image' | 'file'

window.toggleChatAttachPanel = function() {
    const panel = document.getElementById('chatAttachPanel');
    if (!panel) return;
    document.getElementById('logisticsAgreementArea')?.classList.remove('show-menu');
    panel.classList.toggle('d-none');
    if (!panel.classList.contains('d-none')) {
        document.getElementById('chatAttachLinkInput')?.focus();
    }
};

window.setChatAttachType = function(type) {
    chatAttachType = type;
    document.querySelectorAll('.chat-attach-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.attachType === type);
    });
    const input = document.getElementById('chatAttachLinkInput');
    if (input) input.placeholder = type === 'image' ? 'Cole o link da imagem...' : 'Cole o link do arquivo...';
};

window.confirmChatAttach = async function() {
    const input = document.getElementById('chatAttachLinkInput');
    const url   = input?.value?.trim();
    if (!url || !url.startsWith('http')) {
        showToast('Cole um link válido (começando com http).', 'warning');
        return;
    }

    if (chatAttachType === 'image') {
        await window.sendChatImage(url);
    } else {
        await window.sendChatFile(url);
    }

    input.value = '';
    document.getElementById('chatAttachPanel')?.classList.add('d-none');
};

window.openImageFull = function(src) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
    modal.innerHTML = `<img src="${src}" style="max-width:90%;max-height:90%;border-radius:8px;">`;
    modal.onclick = () => modal.remove();
    document.body.appendChild(modal);
};

/**
 * Helper function to get descriptive text for logistics types.
 */
function getLogisticsTypeText(type) {
    if (type === 'pickup') return 'Retirada no Local';
    if (type === 'seller_delivery') return 'Entrega pelo Vendedor';
    if (type === 'external_app') return 'App de Entrega';
    return type;
}

window.setLogistics = async function(orderId, logisticsType) {
    const user  = getSavedUser();
    const order = ordersCache.find(o => o.id === orderId) || await supabaseFetch(`orders?id=eq.${orderId}&limit=1`).then(r => r[0]);
    if (!order) { showToast('Pedido não encontrado.', 'error'); return; }

    const isBuyer    = user.id === order.buyer_id;
    const updateBody = { logistics_type: logisticsType, updated_at: new Date().toISOString() };

    if (isBuyer) updateBody.agree_buyer  = true;
    else         updateBody.agree_seller = true;

    const isAccepting = (isBuyer && order.agree_seller) || (!isBuyer && order.agree_buyer);

    if (isAccepting) {
        updateBody.status = (logisticsType === 'pickup' ? 'awaiting_pickup' : 'shipping');
    } else {
        updateBody.status = 'agreement';
    }

    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify(updateBody) });

        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat     = chatData[0];
        if (chat) {
            const msgText = `${user.nome} propôs/aceitou a logística: ${getLogisticsTypeText(logisticsType)}.`;

            chat.messages.push({
                senderId:  'system',
                text:      msgText,
                timestamp: new Date().toISOString(),
                type:      'system'
            });
            await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        }
        loadChatMessages(orderId);
        showToast(isAccepting ? 'Logística definida!' : 'Proposta enviada!', 'success');
    } catch { showToast('Erro ao definir logística.', 'error'); }
};

/**
 * Mostra um mini-perfil do outro lado da conversa (nome, avatar, reputação),
 * acessível pelo menu de opções (⋮) do cabeçalho do chat.
 */
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

    const avatar = normalizeImageUrl(partner?.avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent(partnerName || 'User')}&background=random&size=100`;
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
                    <button type="button" class="btn-close float-end" data-bs-dismiss="modal"></button>
                    <div class="position-relative d-inline-block mb-3">
                        <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;" class="border" referrerpolicy="no-referrer">
                        <span class="presence-dot ${online ? 'online' : 'offline'}" style="width:16px;height:16px;border:2px solid #fff;"></span>
                    </div>
                    <h5 class="fw-bold mb-1">${partner?.nome || partnerName || 'Usuário'}</h5>
                    <p class="small mb-2 fw-bold ${online ? 'text-success' : 'text-muted'}">${online ? '● Online agora' : '○ Offline'}</p>
                    <p class="text-muted small mb-3"><i class="bi bi-calendar3 me-1"></i>Na plataforma desde ${memberSince}</p>
                    <div class="d-flex justify-content-center align-items-center gap-2">
                        <i class="bi bi-star-fill text-warning"></i>
                        <span class="fw-bold">${rating}</span>
                        <span class="text-muted small">(${ratingCount} avaliações)</span>
                    </div>
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
            chat.messages.push({
                senderId: 'system',
                text: 'O pedido foi cancelado por uma das partes.',
                timestamp: new Date().toISOString(),
                type: 'system'
            });
            await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        }
        showToast('Pedido cancelado!', 'info');
        window.toggleChatActions(); // Fecha a aba
        loadChatMessages(orderId);   // Recarrega o chat
    } catch { showToast('Erro ao cancelar.', 'error'); }
};

window.resetLogistics = async function(orderId) {
    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ 
                agree_buyer: false, agree_seller: false, logistics_type: null,
                updated_at: new Date().toISOString() 
            })
        });
        showToast('Proposta recusada. Escolha uma nova opção.', 'info');
        loadChatMessages(orderId);
    } catch { showToast('Erro ao resetar logística.', 'error'); }
};

window.advanceLogisticsStatus = async function(orderId, nextStatus) {
    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: nextStatus, updated_at: new Date().toISOString() })
        });
        
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = chatData[0];
        if (chat) {
            const text = nextStatus === 'shipping' ? 'O vendedor colocou o pedido em rota de entrega!' : 'O pedido está aguardando retirada no local!';
            chat.messages.push({ senderId: 'system', text, timestamp: new Date().toISOString(), type: 'system' });
            await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        }
        showToast('Status atualizado!', 'success');
        loadChatMessages(orderId);
    } catch { showToast('Erro ao atualizar status.', 'error'); }
};

window.confirmReceipt = async function(orderId) {
    if (!confirm('Confirmar que recebeu o produto? Esta ação finalizará o pedido.')) return;
    try {
        // Busca os dados do pedido (produto e quantidade) antes de finalizar, para dar baixa no estoque
        const orderData = await supabaseFetch(`orders?id=eq.${orderId}&limit=1`);
        const order = orderData?.[0];

        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'finished', updated_at: new Date().toISOString() })
        });

        // Baixa automática de estoque (igual Mercado Livre): assim que a compra é
        // finalizada, a quantidade comprada é descontada do anúncio automaticamente.
        if (order?.product_id) {
            await baixarEstoqueProduto(order.product_id, order.quantity || 1);
        }

        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = chatData[0];
        if (chat) {
            chat.messages.push({ senderId: 'system', text: 'O comprador confirmou o recebimento. Compra finalizada!', timestamp: new Date().toISOString(), type: 'system' });
            await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        }
        showToast('Pedido finalizado!', 'success');
        loadChatMessages(orderId);
        window.openReviewModal(orderId, 'buyer_rates_seller');
    } catch { showToast('Erro ao confirmar recebimento.', 'error'); }
};

// ============================================
// AVALIAÇÃO DO VENDEDOR (pós-compra)
// ============================================

let currentReviewRating = 0;

/**
 * Abre o modal de avaliação do vendedor pra um pedido finalizado. Chamado
 * automaticamente assim que o comprador confirma o recebimento, e também
 * pode ser reaberto depois pelo botão "Avaliar Vendedor" no chat, caso o
 * comprador tenha pulado a avaliação na hora.
 */
/**
 * Abre o modal de avaliação pra um pedido finalizado. `mode` define quem avalia
 * quem: 'buyer_rates_seller' (padrão, comprador avalia o vendedor) ou
 * 'seller_rates_buyer' (vendedor avalia o comprador). Chamado automaticamente
 * assim que o comprador confirma o recebimento, e também pode ser reaberto
 * depois pelo botão "Avaliar Vendedor"/"Avaliar Comprador" na tela de pedidos,
 * caso a avaliação tenha sido pulada na hora.
 */
window.openReviewModal = async function(orderId, mode = 'buyer_rates_seller') {
    try {
        const orderData = await supabaseFetch(`orders?id=eq.${orderId}&limit=1`);
        const order = orderData?.[0];
        if (!order) return;

        const isSellerRatingBuyer = mode === 'seller_rates_buyer';
        if (isSellerRatingBuyer ? order.seller_reviewed : order.buyer_reviewed) return; // já avaliado

        document.getElementById('reviewOrderId').value    = orderId;
        document.getElementById('reviewMode').value        = mode;
        document.getElementById('reviewTargetId').value    = isSellerRatingBuyer ? order.buyer_id : order.seller_id;
        document.getElementById('reviewTargetName').textContent =
            isSellerRatingBuyer ? (order.buyer_name || 'o comprador') : (order.seller_name || 'o vendedor');
        document.getElementById('reviewModalTitle').textContent =
            isSellerRatingBuyer ? 'Avalie o comprador' : 'Avalie o vendedor';
        window.setReviewStars(0);

        bootstrap.Modal.getOrCreateInstance(document.getElementById('reviewModal')).show();
    } catch (e) {
        console.error('Erro ao abrir avaliação:', e);
    }
};

/** Atualiza a seleção visual das estrelas (1 a 5) no modal de avaliação */
window.setReviewStars = function(n) {
    currentReviewRating = n;
    document.querySelectorAll('#reviewStars .review-star').forEach(star => {
        const val = parseInt(star.dataset.value);
        star.classList.toggle('bi-star-fill', val <= n);
        star.classList.toggle('bi-star', val > n);
        star.classList.toggle('active', val <= n);
    });
};

/**
 * Envia a avaliação: salva o registro individual (histórico) e atualiza a
 * média/contador de quem está sendo avaliado. Funciona nos dois sentidos —
 * comprador avaliando vendedor (vendedor_rating / rating_count) e vendedor
 * avaliando comprador (comprador_rating / comprador_rating_count), ambos na
 * tabela de usuários.
 *
 * IMPORTANTE: pra avaliação de comprador funcionar, a tabela `users` no
 * Supabase precisa ter as colunas `comprador_rating` (numeric) e
 * `comprador_rating_count` (int), e a tabela `orders` precisa da coluna
 * `seller_reviewed` (boolean), do mesmo jeito que já existem `vendedor_rating`,
 * `rating_count` e `buyer_reviewed`.
 */
window.submitReview = async function() {
    const orderId  = document.getElementById('reviewOrderId').value;
    const targetId = document.getElementById('reviewTargetId').value;
    const mode     = document.getElementById('reviewMode').value || 'buyer_rates_seller';
    const user     = getSavedUser();
    const isSellerRatingBuyer = mode === 'seller_rates_buyer';

    if (!currentReviewRating) { showToast('Escolha de 1 a 5 estrelas antes de enviar.', 'warning'); return; }
    if (!user || !targetId) return;

    try {
        // Salva o registro individual da avaliação (histórico, separado das curtidas de produto)
        await supabaseFetch('avaliacoes', {
            method: 'POST',
            body: JSON.stringify({
                id:             `av_${Date.now()}`,
                order_id:       orderId,
                tipo:           mode,
                avaliador_id:   user.id,
                avaliador_nome: user.nome,
                avaliado_id:    targetId,
                rating:         currentReviewRating,
                comentario:     null,
                created_at:     new Date().toISOString()
            })
        });

        // Recalcula a média de quem está sendo avaliado com base na avaliação nova
        const ratingField = isSellerRatingBuyer ? 'comprador_rating'       : 'vendedor_rating';
        const countField   = isSellerRatingBuyer ? 'comprador_rating_count' : 'rating_count';

        const targetData = await supabaseFetch(`users?select=${ratingField},${countField}&id=eq.${targetId}&limit=1`);
        const target    = targetData?.[0] || {};
        const prevCount = parseInt(target[countField]) || 0;
        const prevAvg   = parseFloat(target[ratingField]) || 0;
        const newCount  = prevCount + 1;
        const newAvg    = ((prevAvg * prevCount) + currentReviewRating) / newCount;

        await supabaseFetch(`users?id=eq.${targetId}`, {
            method: 'PATCH',
            body: JSON.stringify({ [ratingField]: newAvg, [countField]: newCount })
        });

        // Marca o pedido como já avaliado (nesse sentido), pra não pedir de novo
        const reviewedField = isSellerRatingBuyer ? 'seller_reviewed' : 'buyer_reviewed';
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ [reviewedField]: true })
        });
        const cachedOrder = ordersCache.find(o => o.id === orderId);
        if (cachedOrder) cachedOrder[reviewedField] = true;

        bootstrap.Modal.getInstance(document.getElementById('reviewModal'))?.hide();
        showToast(isSellerRatingBuyer ? 'Obrigado por avaliar o comprador!' : 'Obrigado por avaliar o vendedor!', 'success');

        if (currentChat === orderId) {
            updateChatLogistics(cachedOrder || { id: orderId, status: 'finished', [reviewedField]: true }, user);
        }
    } catch (e) {
        console.error('Erro ao enviar avaliação:', e);
        showToast('Erro ao enviar avaliação. Tente novamente.', 'error');
    }
};

// Mantido por compatibilidade, caso algo ainda chame o nome antigo da função
window.submitSellerReview = window.submitReview;

/**
 * Desconta a quantidade comprada do estoque do anúncio assim que a compra é
 * finalizada, igual o Mercado Livre faz. Nunca deixa a quantidade ficar negativa.
 */
async function baixarEstoqueProduto(productId, quantidadeComprada) {
    try {
        const produtoData = await supabaseFetch(`products?id=eq.${productId}&limit=1`);
        const produto = produtoData?.[0];
        if (!produto) return;

        const estoqueAtual = parseInt(produto.quantidade) || 0;
        const novoEstoque  = Math.max(0, estoqueAtual - (parseInt(quantidadeComprada) || 1));

        await supabaseFetch(`products?id=eq.${productId}`, {
            method: 'PATCH',
            body: JSON.stringify({ quantidade: novoEstoque, updated_at: new Date().toISOString() })
        });

        // Atualiza o cache local também, refletindo na hora sem precisar recarregar a página
        const cached = allProductsCache.find(p => p.id === productId);
        if (cached) cached.quantidade = novoEstoque;
    } catch (e) {
        console.error('Erro ao dar baixa no estoque:', e);
    }
}

// ============================================
// PAINEL DO VENDEDOR
// ============================================

window.renderSellerPanel = async function() {
    const user = getSavedUser();
    if (!user)                                           { showToast('Faça login!', 'warning'); return; }
    if (user.tipo !== 'VENDEDOR') { showToast('Acesso restrito a vendedores!', 'warning'); return; }

    window.exitWaOrdersView();
    document.getElementById('gridTitle').textContent = 'Meus Produtos';
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');

    const grid = document.getElementById('productsGrid');
    grid.style.display = 'grid';
    grid.classList.remove('order-view-active');
    grid.innerHTML = Array(6).fill(0).map(() => `
        <div class="card border-0" style="border-radius:10px;overflow:hidden;">
            <div class="skeleton" style="height:150px;"></div>
            <div style="padding:12px;">
                <div class="skeleton mb-2" style="height:14px;width:75%;"></div>
                <div class="skeleton" style="height:20px;width:45%;"></div>
            </div>
        </div>`).join('');

    try {
        const sellerProducts = await supabaseFetch(`products?select=*&vendedor_id=eq.${user.id}`);

        if (!sellerProducts.length) {
            grid.innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="bi bi-box-seam" style="font-size:3.5rem;color:#ccc;"></i>
                <h5 class="mt-3">Você ainda não tem produtos</h5>
                <button class="btn btn-primary mt-2" data-bs-toggle="modal" data-bs-target="#announceModal">
                    <i class="bi bi-plus-circle me-2"></i>Anunciar Produto
                </button>
            </div>`;
        } else {
            // Sincroniza os produtos do vendedor com o cache global para o showDetail funcionar
            sellerProducts.forEach(p => {
                if (!allProductsCache.find(x => x.id === p.id)) allProductsCache.push(p);
            });

            renderGrid(sellerProducts);
        }
        window.closeMobileMenu();
    } catch {
        grid.innerHTML = `
            <div class="col-12 text-center py-5">
                <h5>Erro ao carregar produtos</h5>
                <button class="btn btn-primary mt-3" onclick="window.renderSellerPanel()">Tentar novamente</button>
            </div>`;
    }
};

// ============================================
// PAINEL ADMINISTRATIVO
// ============================================

/**
 * Renderiza a interface de controle total para administradores
 */
/** Definição única das abas do painel admin — usada tanto na navbar principal (desktop) quanto na barrinha mobile dentro do painel */
function buildAdminTabButtons(counts, variant) {
    const tabs = [
        { tab: 'admin-overview', icon: 'bi-grid-1x2-fill',        label: 'Início' },
        { tab: 'admin-content',  icon: 'bi-collection-fill',      label: 'Conteúdo',    count: counts.users + counts.products },
        { tab: 'admin-cats',     icon: 'bi-tags-fill',            label: 'Categorias',  count: counts.categorias },
        { tab: 'admin-chats',    icon: 'bi-chat-dots-fill',       label: 'Chats',       count: counts.chatsAbertos },
        { tab: 'admin-support',  icon: 'bi-headset',              label: 'Suporte',     count: counts.ticketsAbertos }
    ];
    return tabs.map((t, i) => `
        <button class="admin-nav-link ${variant}${i === 0 ? ' active' : ''}" data-tab="${t.tab}" onclick="window.switchAdminTab(this)">
            <i class="bi ${t.icon}"></i> ${t.label}${t.count != null ? ` <span class="admin-nav-count">${t.count}</span>` : ''}
        </button>`).join('');
}

/** Mostra as abas do painel admin direto na navbar principal (topo do site) */
function showAdminTopNavTabs(counts) {
    const nav = document.getElementById('adminPanelTabsNav');
    if (nav) {
        nav.innerHTML = buildAdminTabButtons(counts, 'admin-topnav-tab');
        nav.classList.remove('d-none');
        nav.classList.add('d-flex');
    }
}

/** Some com as abas do painel admin da navbar (usado só pelas telas rápidas "Todos os Produtos"/"Todos os Chats") */
function hideAdminTopNavTabs() {
    const nav = document.getElementById('adminPanelTabsNav');
    if (nav) {
        nav.classList.add('d-none');
        nav.classList.remove('d-flex');
        nav.innerHTML = '';
    }
}

/** Monta as linhas da tabela de Publicações do painel admin — usada tanto na
 *  renderização inicial quanto pra atualizar só a tabela quando o admin pesquisa. */
function buildAdminProductsRows(products) {
    if (!products.length) return `<tr><td colspan="4" class="admin-table-empty">Nenhuma publicação encontrada.</td></tr>`;
    return products.map(p => `
        <tr class="admin-table-row-clickable" onclick="window.adminEditProduct('${p.id}')" title="Clique para abrir o anúncio">
            <td>
                <div class="d-flex align-items-center gap-2">
                    <img src="${safeParseImages(p.img)[0] || 'https://placehold.co/45'}" class="admin-row-avatar" style="border-radius:6px;" onerror="this.src='https://placehold.co/45'">
                    <strong>${p.titulo}</strong>
                </div>
            </td>
            <td class="text-muted">${p.loja || 'N/A'}</td>
            <td class="admin-row-value">${parseFloat(p.preco) === 0 ? 'GRÁTIS' : `R$ ${parseFloat(p.preco).toLocaleString('pt-BR')}`}</td>
            <td class="text-end">
                <div class="d-flex gap-1 justify-content-end">
                    <button class="admin-icon-btn" onclick="event.stopPropagation(); window.adminEditProduct('${p.id}')" title="Editar Anúncio">
                        <i class="bi bi-pencil-fill"></i>
                    </button>
                    <button class="admin-icon-btn danger" onclick="event.stopPropagation(); window.adminDeleteProduct('${p.id}', '${(p.titulo || '').replace(/'/g, "\\'")}')" title="Remover Publicação">
                        <i class="bi bi-trash-fill"></i>
                    </button>
                </div>
            </td>
        </tr>`).join('');
}

/** Monta as linhas da tabela de Usuários do painel admin — usada tanto na
 *  renderização inicial quanto pra atualizar só a tabela quando o admin pesquisa. */
function buildAdminUsersRows(users, currentUserId) {
    if (!users.length) return `<tr><td colspan="4" class="admin-table-empty">Nenhum usuário encontrado.</td></tr>`;
    return users.map(u => `
        <tr>
            <td>
                <div class="d-flex align-items-center gap-2">
                    <img src="${u.avatar || 'https://ui-avatars.com/api/?name='+encodeURIComponent(u.nome)}" class="admin-row-avatar" referrerpolicy="no-referrer">
                    <strong>${u.nome}</strong>
                </div>
            </td>
            <td class="text-muted">${u.email}</td>
            <td><span class="admin-badge-tipo ${u.tipo==='ADMIN'?'tipo-admin':(u.tipo==='VENDEDOR'?'tipo-vendedor':'tipo-cliente')}">${u.tipo === 'ADMIN' ? 'Administrador' : (u.tipo === 'VENDEDOR' ? 'Vendedor' : 'Cliente')}</span></td>
            <td class="text-end">
                ${u.id !== currentUserId ? `
                    <button class="admin-icon-btn danger" onclick="window.adminDeleteUser('${u.id}', '${(u.nome || '').replace(/'/g, "\\'")}')" title="Apagar Conta">
                        <i class="bi bi-person-x-fill"></i>
                    </button>
                ` : '<span class="admin-row-badge badge-muted">Você</span>'}
            </td>
        </tr>`).join('');
}

window.renderAdminPanel = async function() {
    const user = getSavedUser();
    if (!user || user.tipo !== 'ADMIN') {
        showToast('Acesso restrito a administradores!', 'error');
        return;
    }

    window._adminViewMode = 'panel';
    window.exitWaOrdersView();
    document.getElementById('gridTitle').textContent = '';
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');

    const grid = document.getElementById('productsGrid');
    grid.style.display = '';
    grid.className = 'admin-panel-active';
    grid.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-danger"></div><p class="mt-2">Carregando base de dados...</p></div>';

    try {
        // Busca todos os usuários, produtos, pedidos e conversas para gestão total
        const [users, products, orders, chats] = await Promise.all([
            supabaseFetch('users?select=*&order=nome.asc'),
            supabaseFetch('products?select=*&order=created_at.desc'),
            supabaseFetch('orders?select=*&order=created_at.desc'),
            supabaseFetch('chats?select=*&order_id=not.is.null')
        ]);
        adminOrdersCache = orders;
        window._adminProductsCache = products;
        window._adminUsersCache = users;

        // Chamados de suporte (linhas de `chats` com order_id NULL) — busca à parte.
        const tickets = await fetchSupportTicketsSafe();

        const categorias = [...new Set(products.map(p => p.categoria || 'Geral'))];
        const chatsAbertos = chats.filter(c => !c.closed).length;
        const ticketsAbertos = tickets.filter(t => t.status !== 'closed').length;
        const tabCounts = { users: users.length, products: products.length, categorias: categorias.length, chatsAbertos, ticketsAbertos };

        // Badge de aviso no dock mobile (mesma contagem da aba Chats do painel)
        const chatsDockBadge = document.getElementById('adminChatsBadgeDock');
        if (chatsDockBadge) {
            chatsDockBadge.textContent = chatsAbertos;
            chatsDockBadge.classList.toggle('d-none', chatsAbertos === 0);
        }
        // Badge de aviso no dock mobile pros chamados de suporte em aberto
        const supportDockBadge = document.getElementById('adminSupportBadgeDock');
        if (supportDockBadge) {
            supportDockBadge.textContent = ticketsAbertos;
            supportDockBadge.classList.toggle('d-none', ticketsAbertos === 0);
        }

        grid.innerHTML = `
            <div class="admin-dash">
                <main class="admin-main">
                    <header class="admin-topbar">
                        <div>
                            <h4 class="fw-bold mb-0" id="adminPanelTitle">Início</h4>
                            <small class="text-muted">Bem-vindo(a), ${user.nome}</small>
                        </div>
                        <div class="admin-sim-controls">
                            <span class="admin-sim-label"><i class="bi bi-eye-fill me-1"></i>Simular como:</span>
                            <button type="button" class="btn btn-sm btn-ml-secondary" onclick="window.setAdminSimulation('CLIENTE')">
                                <i class="bi bi-person-fill me-1"></i>Cliente
                            </button>
                            <button type="button" class="btn btn-sm btn-ml-secondary" onclick="window.setAdminSimulation('VENDEDOR')">
                                <i class="bi bi-shop me-1"></i>Vendedor
                            </button>
                        </div>
                    </header>

                    <div class="admin-stats-row">
                        <div class="admin-stat-card stat-blue"><i class="bi bi-people-fill"></i><div><h3>${users.length}</h3><span>Usuários</span></div></div>
                        <div class="admin-stat-card stat-green"><i class="bi bi-box-seam-fill"></i><div><h3>${products.length}</h3><span>Publicações</span></div></div>
                        <div class="admin-stat-card stat-orange"><i class="bi bi-bag-check-fill"></i><div><h3>${orders.length}</h3><span>Pedidos</span></div></div>
                        <div class="admin-stat-card stat-red"><i class="bi bi-headset"></i><div><h3>${ticketsAbertos}</h3><span>Chamados Abertos</span></div></div>
                    </div>

                    <div class="admin-tab-panel active" id="admin-overview">
                        <div class="admin-card">
                            <h6 class="admin-card-title"><i class="bi bi-box-seam-fill me-2"></i>Últimas Publicações</h6>
                            ${products.slice(0, 5).map(p => `
                                <div class="admin-row">
                                    <img src="${safeParseImages(p.img)[0] || 'https://placehold.co/40'}" class="admin-row-avatar" onerror="this.src='https://placehold.co/40'">
                                    <div class="admin-row-info">
                                        <strong>${p.titulo}</strong>
                                        <small>Loja: ${p.loja || 'N/A'}</small>
                                    </div>
                                    <span class="admin-row-value">${parseFloat(p.preco) === 0 ? 'GRÁTIS' : `R$ ${parseFloat(p.preco).toLocaleString('pt-BR')}`}</span>
                                </div>
                            `).join('') || '<p class="text-muted small mb-0">Nenhuma publicação ainda.</p>'}
                        </div>
                        <div class="admin-card">
                            <h6 class="admin-card-title"><i class="bi bi-chat-dots-fill me-2"></i>Últimos Chats de Pedido</h6>
                            ${chats.slice(0, 5).map(c => {
                                const order = orders.find(o => o.id === c.order_id) || {};
                                return `
                                <div class="admin-row">
                                    <div class="admin-row-icon"><i class="bi bi-chat-dots-fill"></i></div>
                                    <div class="admin-row-info">
                                        <strong>${order.product_title || 'Pedido #' + c.order_id?.slice(-6)}</strong>
                                        <small>${order.buyer_name || '?'} ↔ ${order.seller_name || '?'}</small>
                                    </div>
                                    <span class="admin-row-badge ${c.closed ? 'badge-muted' : 'badge-open'}">${c.closed ? 'Encerrado' : 'Aberto'}</span>
                                </div>`;
                            }).join('') || '<p class="text-muted small mb-0">Nenhuma conversa ainda.</p>'}
                        </div>
                        <div class="admin-card">
                            <h6 class="admin-card-title"><i class="bi bi-headset me-2"></i>Últimos Chamados de Suporte</h6>
                            ${tickets.slice(0, 5).map(t => `
                                <div class="admin-row">
                                    <div class="admin-row-icon"><i class="bi bi-life-preserver"></i></div>
                                    <div class="admin-row-info">
                                        <strong>${SUPPORT_CATEGORY_LABELS[t.category] || t.subject || 'Chamado'}</strong>
                                        <small>${t.requester_name || 'Visitante'}</small>
                                    </div>
                                    <span class="admin-row-badge ${t.status === 'closed' ? 'badge-muted' : 'badge-open'}">${t.status === 'closed' ? 'Encerrado' : 'Aberto'}</span>
                                </div>`).join('') || '<p class="text-muted small mb-0">Nenhum chamado ainda.</p>'}
                        </div>

                        <h6 class="admin-section-subtitle"><i class="bi bi-bar-chart-line-fill me-2"></i>Relatórios</h6>
                        <div class="admin-reports-grid">
                            <div class="admin-card admin-chart-card">
                                <h6 class="admin-card-title"><i class="bi bi-people-fill me-2"></i>Usuários por Tipo</h6>
                                <div class="admin-chart-wrap"><canvas id="chartUsersType"></canvas></div>
                            </div>
                            <div class="admin-card admin-chart-card">
                                <h6 class="admin-card-title"><i class="bi bi-headset me-2"></i>Chats: Abertos x Encerrados</h6>
                                <div class="admin-chart-wrap"><canvas id="chartChatsStatus"></canvas></div>
                            </div>
                            <div class="admin-card admin-chart-card">
                                <h6 class="admin-card-title"><i class="bi bi-bag-check-fill me-2"></i>Pedidos por Status</h6>
                                <div class="admin-chart-wrap"><canvas id="chartOrdersStatus"></canvas></div>
                            </div>
                            <div class="admin-card admin-chart-card admin-chart-wide">
                                <h6 class="admin-card-title"><i class="bi bi-tags-fill me-2"></i>Publicações por Categoria</h6>
                                <div class="admin-chart-wrap"><canvas id="chartProdsCategory"></canvas></div>
                            </div>
                            <div class="admin-card admin-chart-card admin-chart-wide">
                                <h6 class="admin-card-title"><i class="bi bi-graph-up me-2"></i>Novas Publicações (últimos 6 meses)</h6>
                                <div class="admin-chart-wrap"><canvas id="chartProdsTimeline"></canvas></div>
                            </div>
                        </div>
                    </div>

                    <div class="admin-tab-panel" id="admin-content">
                        <div class="admin-card" id="adminContentProdsCard">
                            <h6 class="admin-card-title"><i class="bi bi-box-seam-fill me-2"></i>Publicações <span class="admin-nav-count" id="adminContentProdsCount">${products.length}</span></h6>
                            <div class="admin-table-wrap">
                                <table class="admin-table">
                                    <thead>
                                        <tr>
                                            <th>Publicação</th>
                                            <th>Loja</th>
                                            <th>Preço</th>
                                            <th class="text-end">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody id="adminProdsTableBody">
                                        ${buildAdminProductsRows(products)}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div class="admin-card" id="adminContentUsersCard">
                            <h6 class="admin-card-title"><i class="bi bi-people-fill me-2"></i>Usuários <span class="admin-nav-count" id="adminContentUsersCount">${users.length}</span></h6>
                            <div class="admin-table-wrap">
                                <table class="admin-table">
                                    <thead>
                                        <tr>
                                            <th>Usuário</th>
                                            <th>E-mail</th>
                                            <th>Tipo de Conta</th>
                                            <th class="text-end">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody id="adminUsersTableBody">
                                        ${buildAdminUsersRows(users, user.id)}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div class="admin-tab-panel" id="admin-cats">
                        <div class="admin-card">
                            ${categorias.map(cat => `
                                <div class="admin-row">
                                    <div class="admin-row-icon"><i class="bi bi-tag-fill"></i></div>
                                    <div class="admin-row-info"><strong>${cat}</strong></div>
                                    <span class="admin-row-badge badge-muted">${products.filter(p => p.categoria === cat).length} anúncios</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="admin-tab-panel" id="admin-chats">
                        <div class="wa-main admin-chat-main" id="adminChatsTabMain">
                            <section class="wa-side">
                                <div class="wa-side__header">
                                    <h6 class="mb-0">Todas as Conversas</h6>
                                </div>
                                <div class="wa-side__search">
                                    <i class="bi bi-search"></i>
                                    <input type="text" id="adminChatsTabSearch" placeholder="Buscar conversa..." autocomplete="off" oninput="window.filterAdminChatsTab(this.value)">
                                </div>
                                <div id="adminChatsTabList" class="wa-side__list"></div>
                            </section>

                            <section class="wa-chat">
                                <div id="adminChatsTabEmpty" class="wa-empty-state">
                                    <i class="bi bi-chat-square-text"></i>
                                    <p>Selecione uma conversa ao lado</p>
                                </div>
                                <div id="adminChatsTabActive" class="d-none h-100 flex-column chat-container" style="margin:0;border-radius:0;"></div>
                            </section>
                        </div>
                    </div>

                    <div class="admin-tab-panel" id="admin-support">
                        <div class="admin-card">
                            ${tickets.length === 0 ? `
                                <p class="text-muted text-center py-4 mb-0">Nenhum chamado de suporte ainda. Assim que um cliente ou vendedor esquecer a senha, relatar um problema com a entrega ou pedir ajuda, o chamado aparece aqui automaticamente.</p>
                            ` : tickets.slice().sort((a, b) => (a.status === b.status) ? 0 : (a.status === 'closed' ? 1 : -1)).map(t => {
                                const msgCount = (t.messages || []).filter(m => m.type !== 'system').length;
                                const lastMsg = (t.messages || [])[t.messages.length - 1];
                                return `
                                <div class="admin-row admin-row-wrap">
                                    <div class="admin-row-icon"><i class="bi bi-life-preserver"></i></div>
                                    <div class="admin-row-info">
                                        <strong>${SUPPORT_CATEGORY_LABELS[t.category] || t.subject || 'Chamado'} <span class="admin-row-badge ${t.status === 'closed' ? 'badge-muted' : 'badge-open'} ms-1">${t.status === 'closed' ? 'Encerrado' : 'Aberto'}</span></strong>
                                        <small class="d-block">${t.requester_name || 'Visitante'}${t.requester_email ? ' • ' + t.requester_email : ''}${t.requester_role ? ' • ' + (t.requester_role === 'ADMIN' ? 'Administrador' : (t.requester_role === 'VENDEDOR' ? 'Vendedor' : 'Cliente')) : ''} • ${msgCount} mensagens</small>
                                        ${lastMsg ? `<small class="text-muted fst-italic d-block text-truncate" style="max-width:320px;">"${(lastMsg.text || '[mídia]').slice(0,60)}"</small>` : ''}
                                    </div>
                                    <div class="d-flex gap-2">
                                        <button class="btn btn-sm btn-ml-secondary" onclick="window.adminViewTicket('${t.id}')">
                                            <i class="bi bi-eye me-1"></i>Ver Chamado
                                        </button>
                                        <button class="btn btn-sm btn-ml-danger" onclick="window.adminDeleteTicket('${t.id}')" title="Apagar chamado">
                                            <i class="bi bi-trash"></i>
                                        </button>
                                    </div>
                                </div>`;
                            }).join('')}
                        </div>
                    </div>
                </main>
            </div>`;

        showAdminTopNavTabs(tabCounts);
        window.renderAdminChatsTab(chats, orders);

        // Guarda os dados carregados pra alimentar os gráficos (usados aqui
        // mesmo, dentro da aba "Início" — só constrói quando o canvas estiver
        // realmente visível, senão o Chart.js mede a largura errada).
        window._adminReportsData = { users, products, orders, chats, tickets, categorias };
        window._adminChartsReady = false;

        // Se o admin já estava numa aba específica (ex: voltou de uma conversa
        // aberta a partir da aba "Chats" ou "Suporte"), reabre na mesma aba
        // em vez de sempre cair no Início.
        if (window._adminActiveTab && window._adminActiveTab !== 'admin-overview') {
            const navBtn = document.querySelector(`.admin-nav-link[data-tab="${window._adminActiveTab}"]`);
            if (navBtn) window.switchAdminTab(navBtn);
        } else {
            window._adminChartsReady = true;
            requestAnimationFrame(() => window.renderAdminCharts());
        }

        window.closeMobileMenu();

        // Se o admin disparou uma busca antes do painel terminar de carregar
        // (ex: painel ainda montando), aplica ela agora que já está tudo pronto.
        if (window._pendingAdminSearch !== undefined) {
            const pending = window._pendingAdminSearch;
            window._pendingAdminSearch = undefined;
            window.adminSearchProducts(pending);
        }
    } catch (e) {
        console.error(e);
        grid.innerHTML = '<div class="alert alert-danger">Erro ao acessar o banco de dados.</div>';
    }
};

/** Troca de aba do painel administrativo (sidebar estilo Ocellaris/Vali Admin) */
window.switchAdminTab = function(navBtn) {
    const tabId = navBtn.dataset.tab;
    window._adminActiveTab = tabId;
    document.querySelectorAll('.admin-nav-link').forEach(el => el.classList.remove('active'));
    navBtn.classList.add('active');
    document.querySelectorAll('.admin-tab-panel').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId)?.classList.add('active');
    const titles = {
        'admin-overview': 'Início',
        'admin-content': 'Conteúdo',
        'admin-cats': 'Categorias',
        'admin-chats': 'Chats',
        'admin-support': 'Suporte'
    };
    const titleEl = document.getElementById('adminPanelTitle');
    if (titleEl) titleEl.textContent = titles[tabId] || '';

    // Os canvases dos gráficos ficam com display:none enquanto a aba "Início"
    // não está ativa, e o Chart.js não mede a largura corretamente nesse
    // estado — por isso, se o admin chegou aqui vindo de outra aba antes dos
    // gráficos serem montados, monta agora que o canvas ficou visível.
    if (tabId === 'admin-overview' && !window._adminChartsReady) {
        window._adminChartsReady = true;
        requestAnimationFrame(() => window.renderAdminCharts());
    }
};

/**
 * Devolve pra tela administrativa certa depois de uma ação (excluir produto,
 * apagar/encerrar chat etc.) — sem essa checagem, qualquer ação sempre
 * jogaria o admin de volta pro dashboard completo, mesmo que ele estivesse
 * na tela rápida "Todos os Produtos" ou "Todos os Chats".
 */
function adminRefreshCurrentView() {
    if (window._adminViewMode === 'products') return window.renderAdminAllProducts();
    if (window._adminViewMode === 'chats')    return window.renderAdminAllChats();
    return window.renderAdminPanel();
}

/**
 * Atalho da navbar: "Todos os Produtos" — navegação igual à visão normal do
 * cliente (mesma grade de cards), só que trazendo TODOS os anúncios da
 * plataforma (não só os de um vendedor) e com um botão de excluir no overlay
 * de cada card, pra o admin poder remover qualquer anúncio na hora.
 */
window.renderAdminAllProducts = async function() {
    const user = getSavedUser();
    if (!user || user.tipo !== 'ADMIN') { showToast('Acesso restrito a administradores!', 'error'); return; }

    window._adminViewMode = 'products';
    window.exitWaOrdersView();
    hideAdminTopNavTabs();
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    document.getElementById('gridTitle').textContent = 'Todos os Produtos';
    document.getElementById('storefrontBanner')?.replaceChildren();

    const grid = document.getElementById('productsGrid');
    grid.style.display = 'grid';
    grid.className = 'products-grid-uniform';
    grid.innerHTML = Array(12).fill(0).map(() => `
        <div class="card border-0" style="border-radius: 10px; overflow: hidden;">
            <div class="skeleton" style="height: 160px;"></div>
            <div style="padding: 12px;">
                <div class="skeleton mb-2" style="height: 14px; width: 80%;"></div>
                <div class="skeleton mb-1" style="height: 14px; width: 60%;"></div>
                <div class="skeleton" style="height: 22px; width: 50%;"></div>
            </div>
        </div>`).join('');

    try {
        const products = await supabaseFetch('products?select=*&order=created_at.desc');
        window._adminProductsCache = products;
        // Sincroniza com o cache global pra window.showDetail funcionar ao clicar no card
        products.forEach(p => { if (!allProductsCache.find(x => x.id === p.id)) allProductsCache.push(p); });

        if (!products.length) {
            grid.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="bi bi-box-seam" style="font-size:3.5rem;color:#ccc;"></i>
                    <h5 class="mt-3">Nenhum produto cadastrado na plataforma ainda.</h5>
                </div>`;
            return;
        }

        grid.innerHTML = products.map(p => renderAdminProductCard(p)).join('');
        window.closeMobileMenu();
    } catch (e) {
        console.error(e);
        grid.innerHTML = '<div class="alert alert-danger m-3">Erro ao carregar os produtos.</div>';
    }
};

/** Card de produto padrão (igual ao que o cliente vê) + botões de editar/excluir no overlay, só pro admin — mesma lógica de gerenciamento usada no painel do vendedor */
function renderAdminProductCard(item) {
    const html = renderCard(item);
    if (!html) return '';
    const actionBtns = `
                <button class="btn btn-action btn-admin-edit" onclick="event.stopPropagation();window.adminEditProduct('${item.id}')" title="Editar Anúncio (Admin)">
                    <i class="bi bi-pencil-fill"></i>
                </button>
                <button class="btn btn-action btn-admin-delete" onclick="event.stopPropagation();window.adminDeleteProduct('${item.id}', '${(item.titulo || '').replace(/'/g, "\\'")}')" title="Excluir Anúncio (Admin)">
                    <i class="bi bi-trash-fill"></i>
                </button>`;
    return html.replace('<div class="overlay">', `<div class="overlay">${actionBtns}`);
}

/**
 * Atalho da navbar: "Todos os Chats" — lista rápida de TODAS as conversas de
 * suporte da plataforma (abertas primeiro), com acesso direto a ver, entrar,
 * responder e encerrar/apagar qualquer uma delas, sem precisar abrir o
 * dashboard completo.
 */
window.renderAdminAllChats = async function() {
    const user = getSavedUser();
    if (!user || user.tipo !== 'ADMIN') { showToast('Acesso restrito a administradores!', 'error'); return; }

    window._adminViewMode = 'chats';
    window.exitWaOrdersView();
    hideAdminTopNavTabs();
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    document.getElementById('gridTitle').textContent = '';
    document.getElementById('storefrontBanner')?.replaceChildren();

    const grid = document.getElementById('productsGrid');
    grid.style.display = '';
    grid.className = 'admin-panel-active';
    grid.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-danger"></div><p class="mt-2">Carregando conversas...</p></div>';

    try {
        const [orders, chats] = await Promise.all([
            supabaseFetch('orders?select=*&order=created_at.desc'),
            supabaseFetch('chats?select=*&order_id=not.is.null')
        ]);
        adminOrdersCache = orders;

        // Abertos primeiro, pra facilitar a triagem do suporte
        const sorted = chats.slice().sort((a, b) => (a.closed === b.closed) ? 0 : (a.closed ? 1 : -1));
        const abertos = chats.filter(c => !c.closed).length;

        grid.innerHTML = `
            <div class="admin-standalone-page">
                <div class="admin-standalone-header">
                    <div>
                        <h4 class="fw-bold mb-0"><i class="bi bi-headset me-2"></i>Todos os Chats</h4>
                        <small class="text-muted">${abertos} aberto${abertos === 1 ? '' : 's'} de ${chats.length} conversa${chats.length === 1 ? '' : 's'} no total</small>
                    </div>
                </div>
                <div class="admin-card">
                    ${sorted.length === 0 ? `<p class="text-muted text-center py-4 mb-0">Nenhuma conversa no sistema ainda.</p>` : sorted.map(c => {
                        const order = orders.find(o => o.id === c.order_id) || {};
                        const msgCount = (c.messages || []).filter(m => m.type !== 'system').length;
                        const lastMsg = (c.messages || [])[c.messages.length - 1];
                        return `
                        <div class="admin-row admin-row-wrap admin-row-clickable" onclick="window.adminOpenChatsModal('${c.order_id}')">
                            <div class="admin-row-icon"><i class="bi bi-chat-dots-fill"></i></div>
                            <div class="admin-row-info">
                                <strong>${order.product_title || 'Pedido #' + c.order_id?.slice(-6)} <span class="admin-row-badge ${c.closed ? 'badge-muted' : 'badge-open'} ms-1">${c.closed ? 'Encerrado' : 'Aberto'}</span></strong>
                                <small class="d-block">${order.buyer_name || '?'} ↔ ${order.seller_name || '?'} • ${msgCount} mensagens</small>
                                ${lastMsg ? `<small class="text-muted fst-italic d-block text-truncate" style="max-width:320px;">"${(lastMsg.text || '[mídia]').slice(0,60)}"</small>` : ''}
                            </div>
                            <div class="d-flex gap-2">
                                <button class="btn btn-sm btn-ml-secondary" onclick="event.stopPropagation(); window.adminOpenChatsModal('${c.order_id}')">
                                    <i class="bi bi-eye me-1"></i>Ver Conversa
                                </button>
                                <button class="btn btn-sm btn-ml-danger" onclick="event.stopPropagation(); window.adminDeleteChat('${c.order_id}')" title="Apagar conversa e pedido">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        window.closeMobileMenu();
    } catch (e) {
        console.error(e);
        grid.innerHTML = '<div class="alert alert-danger m-3">Erro ao carregar as conversas.</div>';
    }
};

/**
 * Monta os 5 gráficos do painel administrativo (Chart.js) usando os dados já
 * carregados pelo renderAdminPanel — visão geral de usuários, produtos,
 * pedidos e chats "de tudo", como pedido pelo administrador.
 */
window.renderAdminCharts = function() {
    if (typeof Chart === 'undefined') {
        console.error('Chart.js não carregou — verifique a conexão com o CDN.');
        return;
    }
    const data = window._adminReportsData;
    if (!data) return;
    const { users, products, orders, chats, categorias } = data;

    // Cores lidas do tema atual (claro/escuro) pra combinar com o resto do painel
    const css = getComputedStyle(document.documentElement);
    const textColor  = css.getPropertyValue('--text-main').trim()  || '#333';
    const gridColor  = css.getPropertyValue('--border-light').trim() || 'rgba(0,0,0,0.08)';
    const palette = ['#2dcc71', '#3483fa', '#f0a020', '#e74c3c', '#8e44ad', '#16a2b8', '#e67e22', '#95a5a6'];

    Chart.defaults.color = textColor;
    Chart.defaults.font.family = "'Sora', sans-serif";

    // Destrói instâncias anteriores (evita "Canvas is already in use" ao reabrir a aba)
    window._adminChartInstances = window._adminChartInstances || {};
    Object.values(window._adminChartInstances).forEach(c => c?.destroy());
    window._adminChartInstances = {};

    const baseOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 12, padding: 14 } } }
    };

    // --- Usuários por tipo ---
    const tipoCount = { CLIENTE: 0, VENDEDOR: 0, ADMIN: 0 };
    users.forEach(u => { tipoCount[u.tipo] = (tipoCount[u.tipo] || 0) + 1; });
    window._adminChartInstances.usersType = new Chart(document.getElementById('chartUsersType'), {
        type: 'doughnut',
        data: {
            labels: ['Clientes', 'Vendedores', 'Administradores'],
            datasets: [{ data: [tipoCount.CLIENTE, tipoCount.VENDEDOR, tipoCount.ADMIN], backgroundColor: [palette[1], palette[0], palette[3]], borderWidth: 0 }]
        },
        options: baseOptions
    });

    // --- Chats abertos x encerrados ---
    const abertos   = chats.filter(c => !c.closed).length;
    const encerrados = chats.length - abertos;
    window._adminChartInstances.chatsStatus = new Chart(document.getElementById('chartChatsStatus'), {
        type: 'doughnut',
        data: {
            labels: ['Abertos', 'Encerrados'],
            datasets: [{ data: [abertos, encerrados], backgroundColor: [palette[0], palette[7]], borderWidth: 0 }]
        },
        options: baseOptions
    });

    // --- Pedidos por status ---
    const statusOrder = ['pending', 'accepted', 'agreement', 'shipping', 'awaiting_pickup', 'finished', 'cancelled', 'dispute'];
    const statusCount = {};
    orders.forEach(o => { statusCount[o.status] = (statusCount[o.status] || 0) + 1; });
    const statusLabels = statusOrder.filter(s => statusCount[s]);
    window._adminChartInstances.ordersStatus = new Chart(document.getElementById('chartOrdersStatus'), {
        type: 'doughnut',
        data: {
            labels: statusLabels.map(s => ORDER_STATUS_MAP[s]?.text || s),
            datasets: [{ data: statusLabels.map(s => statusCount[s]), backgroundColor: palette, borderWidth: 0 }]
        },
        options: baseOptions
    });

    // --- Publicações por categoria (nível principal, ex: "Games", "Informática") ---
    const catCount = {};
    products.forEach(p => {
        const top = (p.categoria || 'Geral').split(' > ')[0];
        catCount[top] = (catCount[top] || 0) + 1;
    });
    const catLabels = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a]);
    window._adminChartInstances.prodsCategory = new Chart(document.getElementById('chartProdsCategory'), {
        type: 'bar',
        data: {
            labels: catLabels,
            datasets: [{ label: 'Publicações', data: catLabels.map(c => catCount[c]), backgroundColor: palette[0], borderRadius: 6, maxBarThickness: 46 }]
        },
        options: {
            ...baseOptions,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { color: textColor } },
                y: { beginAtZero: true, ticks: { precision: 0, color: textColor }, grid: { color: gridColor } }
            }
        }
    });

    // --- Novas publicações por mês (últimos 6 meses) ---
    const now = new Date();
    const monthKeys = [];
    const monthLabels = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthKeys.push(`${d.getFullYear()}-${d.getMonth()}`);
        monthLabels.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
    }
    const monthCount = Object.fromEntries(monthKeys.map(k => [k, 0]));
    products.forEach(p => {
        if (!p.created_at) return;
        const d = new Date(p.created_at);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (key in monthCount) monthCount[key]++;
    });
    window._adminChartInstances.prodsTimeline = new Chart(document.getElementById('chartProdsTimeline'), {
        type: 'line',
        data: {
            labels: monthLabels,
            datasets: [{
                label: 'Novos anúncios',
                data: monthKeys.map(k => monthCount[k]),
                borderColor: palette[1],
                backgroundColor: 'rgba(52, 131, 250, 0.15)',
                fill: true,
                tension: 0.35,
                pointBackgroundColor: palette[1]
            }]
        },
        options: {
            ...baseOptions,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { color: textColor } },
                y: { beginAtZero: true, ticks: { precision: 0, color: textColor }, grid: { color: gridColor } }
            }
        }
    });
};

window.adminDeleteUser = async function(userId, userName) {
    if (!confirm(`ATENÇÃO: Deseja realmente excluir a conta de ${userName}?\nEsta ação removerá todos os dados do usuário.`)) return;
    try {
        await supabaseFetch(`users?id=eq.${userId}`, { method: 'DELETE' });
        showToast(`Usuário ${userName} removido.`, 'success');
        window.renderAdminPanel(); // Atualiza a lista
    } catch (e) { showToast('Erro ao remover conta.', 'error'); }
};

window.adminDeleteProduct = async function(pid, title) {
    if (!confirm(`Remover publicação "${title}" permanentemente?`)) return;
    try {
        await supabaseFetch(`products?id=eq.${pid}`, { method: 'DELETE' });
        showToast('Publicação removida pelo administrador.', 'success');
        adminRefreshCurrentView(); // Atualiza a lista (fica na mesma tela em que o admin estava)
    } catch (e) { showToast('Erro ao remover produto.', 'error'); }
};

/**
 * Abre o anúncio de QUALQUER vendedor no formulário de edição, como um
 * administrador geral do marketplace. Ao salvar, o vendedor/loja original é
 * preservado (ver flag `adminEdit` tratada no submit do #announceForm) e o
 * usuário volta pro painel administrativo em vez da grade normal de produtos.
 */
window.adminEditProduct = function(pid) {
    const p = window._adminProductsCache?.find(x => x.id === pid) || allProductsCache.find(x => x.id === pid);
    if (!p) { showToast('Produto não encontrado.', 'error'); return; }

    document.getElementById('prodTitle').value          = p.titulo;
    document.getElementById('prodDescription').value     = p.descricao;
    document.getElementById('prodPrice').value           = p.preco;
    document.getElementById('prodQuantity').value        = p.quantidade;
    document.getElementById('prodPrecoOriginal').value   = '';
    document.getElementById('prodCategory').value        = p.categoria;
    document.getElementById('prodDelivery').checked      = !!(p.realiza_entrega ?? p.realizaEntrega ?? p.realizaentrega ?? true);
    document.getElementById('announceForm').dataset.editingId  = p.id;
    document.getElementById('announceForm').dataset.adminEdit  = 'true';

    for (let n = 1; n <= 3; n++) {
        const el = document.getElementById(`prodLink${n}`);
        if (el) el.value = '';
    }
    safeParseImages(p.img).forEach((url, i) => {
        const el = document.getElementById(`prodLink${i + 1}`);
        if (el) el.value = url;
    });

    const modalTitle = document.querySelector('#announceModal .modal-title');
    const submitBtn  = document.querySelector('#announceForm button[type="submit"]');
    if (modalTitle) modalTitle.textContent = `Editar Anúncio (Admin) — loja ${p.loja || ''}`;
    if (submitBtn)  submitBtn.textContent  = 'Salvar Alterações';

    new bootstrap.Modal(document.getElementById('announceModal')).show();
};

/**
 * Monta o HTML de uma bolha de mensagem no MESMO padrão visual do chat
 * cliente ↔ vendedor (.msg-row/.msg-bubble), usado tanto na visão de admin
 * de conversas de pedido quanto na de chamados de suporte. Mensagens da
 * equipe de suporte (isStaff) ficam à direita, destacadas em amarelo.
 */
function adminMsgBubbleHtml(m, resolveSenderName) {
    if (m.type === 'system' || m.senderId === 'system') {
        return `<div class="text-center my-3"><span class="system-chip"><i class="bi bi-info-circle-fill"></i>${m.text}</span></div>`;
    }
    const isStaff = !!m.isStaff;
    const senderLabel = m.senderName || resolveSenderName(m) || 'Usuário';
    const bodyHtml = m.deleted
        ? `<em class="small">Mensagem apagada</em>`
        : `<div class="chat-bubble-text" style="white-space:pre-wrap;">${(m.text ? m.text.replace(/</g, '&lt;') : (m.image ? '[imagem]' : '[arquivo]'))}</div>`;
    return `
        <div class="msg-row ${isStaff ? 'is-me' : 'is-them'}">
            <div class="msg-bubble ${isStaff ? 'is-me is-staff' : 'is-them'}">
                <span class="msg-sender">${senderLabel}${isStaff ? ' <i class="bi bi-patch-check-fill"></i>' : ''}</span>
                ${bodyHtml}
                <div class="msg-time">${new Date(m.timestamp).toLocaleString('pt-BR')}</div>
            </div>
        </div>`;
}

/**
 * Visão total do administrador: abre qualquer conversa de pedido do site,
 * no MESMO layout usado no chat entre cliente e vendedor — ver usuários,
 * encerrar e apagar ficam integrados ao próprio chat, sem modais.
 */
window.adminViewChat = async function(orderId) {
    const grid = document.getElementById('productsGrid');
    grid.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-danger"></div><p class="mt-2">Carregando conversa...</p></div>';
    try {
        const [chatResult, order] = await Promise.all([
            supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`),
            Promise.resolve(adminOrdersCache.find(o => o.id === orderId))
        ]);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Conversa não encontrada.', 'error'); adminRefreshCurrentView(); return; }

        const resolveSenderName = (m) => (m.senderId === order?.buyer_id ? order?.buyer_name : order?.seller_name);
        const msgsHtml = (chat.messages || []).map(m => adminMsgBubbleHtml(m, resolveSenderName)).join('')
            || '<div class="text-center text-muted py-4">Sem mensagens.</div>';
        const msgCount = (chat.messages || []).filter(m => m.type !== 'system').length;

        grid.className = 'admin-panel-active';
        grid.innerHTML = `
            <div class="admin-standalone-page">
                <div class="d-flex align-items-center gap-2 mb-3">
                    <button class="btn btn-sm btn-ml-secondary" onclick="adminRefreshCurrentView()"><i class="bi bi-arrow-left me-1"></i>Voltar</button>
                    <h5 class="fw-bold mb-0">Conversa do pedido <span class="admin-row-badge ${chat.closed ? 'badge-muted' : 'badge-open'} ms-1">${chat.closed ? 'Encerrado' : 'Aberto'}</span></h5>
                </div>
                <div class="wa-main admin-chat-main" style="margin:0;">
                    <section class="wa-chat" style="flex-grow:1;">
                        <div class="chat-container" style="height:100%;">
                            <div class="chat-header-pro">
                                <div class="chat-header-avatar-wrap">
                                    <img src="${order?.product_img || 'https://placehold.co/45/e9ecef/6c757d?text=%20'}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/45/e9ecef/6c757d?text=%20'">
                                </div>
                                <div class="chat-header-info">
                                    <span class="chat-header-name">${order?.product_title || 'Pedido #' + orderId.slice(-6)}</span>
                                    <span class="chat-header-order-id">${order?.buyer_name || '?'} ↔ ${order?.seller_name || '?'} · ${msgCount} mensagens</span>
                                </div>
                                <button type="button" class="chat-header-close" onclick="window.adminToggleParticipants()" title="Ver usuários da conversa">
                                    <i class="bi bi-people-fill"></i>
                                </button>
                            </div>

                            <div id="adminChatParticipants" class="chat-participants-panel d-none">
                                <div class="chat-participant-row">
                                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order?.buyer_name || '?')}&background=3483fa&color=fff" referrerpolicy="no-referrer">
                                    <div class="chat-participant-info">
                                        <strong>${order?.buyer_name || 'Comprador não identificado'}</strong>
                                        <small><i class="bi bi-bag-fill me-1"></i>Comprador</small>
                                    </div>
                                </div>
                                <div class="chat-participant-row">
                                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order?.seller_name || '?')}&background=22c98e&color=fff" referrerpolicy="no-referrer">
                                    <div class="chat-participant-info">
                                        <strong>${order?.seller_name || 'Vendedor não identificado'}</strong>
                                        <small><i class="bi bi-shop me-1"></i>Vendedor</small>
                                    </div>
                                </div>
                            </div>

                            <div id="adminChatMsgsBody" class="chat-messages">${msgsHtml}</div>

                            ${!chat.closed ? `
                                <div class="chat-input-bar">
                                    <div class="d-flex gap-2 align-items-center">
                                        <input type="text" id="adminChatInput" class="chat-text-input" placeholder="Responder como Suporte..." autocomplete="off"
                                               onkeypress="if(event.key==='Enter'){event.preventDefault(); window.adminSendChatMessage('${orderId}');}">
                                        <button type="button" class="chat-send-btn" onclick="window.adminSendChatMessage('${orderId}')"><i class="bi bi-send-fill"></i></button>
                                    </div>
                                </div>
                            ` : ''}

                            <div class="chat-admin-actions">
                                <button class="btn btn-ml-danger btn-sm" onclick="window.adminDeleteChat('${orderId}')">
                                    <i class="bi bi-trash me-1"></i>Apagar conversa e pedido
                                </button>
                                ${!chat.closed ? `
                                    <button class="btn btn-warning btn-sm fw-bold" onclick="window.adminCloseChat('${orderId}')">
                                        <i class="bi bi-check-circle-fill me-1"></i>Encerrar Atendimento
                                    </button>
                                ` : `
                                    <span class="text-muted small d-flex align-items-center"><i class="bi bi-lock-fill me-1"></i>Atendimento encerrado</span>
                                `}
                            </div>
                        </div>
                    </section>
                </div>
            </div>`;

        const msgsBody = document.getElementById('adminChatMsgsBody');
        if (msgsBody) msgsBody.scrollTop = msgsBody.scrollHeight;
    } catch (e) {
        console.error(e);
        showToast('Erro ao carregar a conversa.', 'error');
    }
};

/** Mostra/esconde o painel "ver usuários da conversa", integrado ao próprio chat (sem modal) */
window.adminToggleParticipants = function(panelId = 'adminChatParticipants') {
    document.getElementById(panelId)?.classList.toggle('d-none');
};

/** Envia uma mensagem como membro da equipe de suporte dentro da conversa do pedido */
window.adminSendChatMessage = async function(orderId) {
    const input = document.getElementById('adminChatInput');
    const text  = input?.value.trim();
    if (!text) return;
    const user = getSavedUser();

    try {
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = chatData?.[0];
        if (!chat) return;

        const messages = chat.messages || [];
        messages.push({
            senderId:   user.id,
            senderName: `${user.nome} (Suporte)`,
            text,
            timestamp:  new Date().toISOString(),
            isStaff:    true
        });

        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        input.value = '';
        window.adminViewChat(orderId); // recarrega a conversa já com a mensagem nova
    } catch (e) {
        showToast('Erro ao enviar mensagem.', 'error');
    }
};

/**
 * Encerra o atendimento: registra uma mensagem de sistema avisando o
 * encerramento e marca a conversa como fechada (não recebe mais respostas
 * pelo lado do admin, embora comprador/vendedor continuem podendo se falar).
 *
 * IMPORTANTE: exige a coluna `closed` (boolean) na tabela `chats` do Supabase.
 */
window.adminCloseChat = async function(orderId) {
    if (!confirm('Encerrar este atendimento?\nUma mensagem de encerramento será registrada na conversa.')) return;
    const user = getSavedUser();

    try {
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = chatData?.[0];
        if (!chat) return;

        const messages = chat.messages || [];
        messages.push({
            type:      'system',
            senderId:  'system',
            text:      `Atendimento encerrado por ${user.nome} (Suporte).`,
            timestamp: new Date().toISOString()
        });

        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages, closed: true }) });
        showToast('Atendimento encerrado.', 'success');
        window.adminViewChat(orderId); // recarrega a mesma tela já como encerrada
    } catch (e) {
        showToast('Erro ao encerrar atendimento.', 'error');
    }
};

/** Apaga a conversa E o pedido associado (ação total de administrador) */
window.adminDeleteChat = async function(orderId) {
    if (!confirm('Apagar esta conversa e o pedido relacionado permanentemente?\nEsta ação não pode ser desfeita.')) return;
    try {
        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'DELETE' });
        await supabaseFetch(`orders?id=eq.${orderId}`, { method: 'DELETE' });
        showToast('Conversa e pedido removidos pelo administrador.', 'success');
        adminRefreshCurrentView();
    } catch (e) { showToast('Erro ao remover a conversa.', 'error'); }
};

// ============================================
// MODAL "CENTRAL DE CONVERSAS" DO ADMIN
// ============================================
// Mesmo layout visual do chat cliente ↔ vendedor (lista lateral de conversas
// + painel de chat, classes .wa-main/.wa-side/.wa-chat), só que dentro de um
// modal e com permissões de administrador (vê TODAS as conversas da
// plataforma, responde como Suporte, encerra e apaga qualquer uma delas).

/**
 * Abre o modal "Central de Conversas" do admin. Se orderId for passado, já
 * abre direto naquela conversa; senão, mostra só a lista pra escolher.
 */
window.adminOpenChatsModal = async function(orderId) {
    const user = getSavedUser();
    if (!user || user.tipo !== 'ADMIN') { showToast('Acesso restrito a administradores!', 'error'); return; }

    const list = document.getElementById('adminChatsModalList');
    const emptyEl = document.getElementById('adminChatsModalEmpty');
    const activeEl = document.getElementById('adminChatsModalActive');
    if (!list) return;

    document.getElementById('adminChatsModalMain')?.classList.remove('wa-chat-open');
    emptyEl?.classList.remove('d-none');
    activeEl?.classList.add('d-none');
    list.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm text-danger"></div></div>';

    new bootstrap.Modal(document.getElementById('adminChatsModal')).show();

    try {
        const [orders, chats] = await Promise.all([
            supabaseFetch('orders?select=*&order=created_at.desc'),
            supabaseFetch('chats?select=*&order_id=not.is.null')
        ]);
        adminOrdersCache = orders;

        const sorted = chats.slice().sort((a, b) => (a.closed === b.closed) ? 0 : (a.closed ? 1 : -1));

        window._adminChatsModalRenderList = (term = '') => {
            const q = term.trim().toLowerCase();
            const filtered = sorted.filter(c => {
                if (!q) return true;
                const order = orders.find(o => o.id === c.order_id) || {};
                return `${order.product_title || ''} ${order.buyer_name || ''} ${order.seller_name || ''}`.toLowerCase().includes(q);
            });
            list.innerHTML = filtered.length === 0
                ? '<p class="text-muted text-center small py-4 px-3 mb-0">Nenhuma conversa encontrada.</p>'
                : filtered.map(c => {
                    const order = orders.find(o => o.id === c.order_id) || {};
                    const msgCount = (c.messages || []).filter(m => m.type !== 'system').length;
                    const lastMsg = (c.messages || [])[c.messages.length - 1];
                    return `
                    <div class="wa-contact ${c.order_id === window._adminActiveChatOrderId ? 'active-chat' : ''}" data-order-id="${c.order_id}" onclick="window.adminChatsModalSelect('${c.order_id}')">
                        <img src="${order.product_img || ''}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/45'">
                        <div class="wa-contact-textbox">
                            <div class="wa-contact-name">${order.product_title || 'Pedido #' + c.order_id?.slice(-6)}</div>
                            <div class="wa-contact-text">${order.buyer_name || '?'} ↔ ${order.seller_name || '?'} • ${msgCount} msgs</div>
                            ${lastMsg ? `<div class="wa-contact-text fst-italic">"${(lastMsg.text || '[mídia]').slice(0,40)}"</div>` : ''}
                        </div>
                        <span class="badge ${c.closed ? 'bg-secondary' : 'bg-success'} wa-contact-badge">${c.closed ? 'Encerrado' : 'Aberto'}</span>
                    </div>`;
                }).join('');
        };
        window._adminChatsModalRenderList();

        if (orderId) window.adminChatsModalSelect(orderId);
    } catch (e) {
        console.error(e);
        list.innerHTML = '<div class="alert alert-danger m-3">Erro ao carregar as conversas.</div>';
    }
};

/** Filtra a lista lateral do modal de conversas do admin conforme o usuário digita */
window.filterAdminChatsModal = function(term) {
    window._adminChatsModalRenderList?.(term);
};

/** Seleciona e carrega uma conversa específica dentro do modal de conversas do admin */
window.adminChatsModalSelect = async function(orderId) {
    window._adminActiveChatOrderId = orderId;
    document.getElementById('adminChatsModalMain')?.classList.add('wa-chat-open'); // no mobile, troca a lista pelo chat
    document.querySelectorAll('#adminChatsModalList .wa-contact').forEach(el => el.classList.toggle('active-chat', el.dataset.orderId === orderId));

    const emptyEl = document.getElementById('adminChatsModalEmpty');
    const activeEl = document.getElementById('adminChatsModalActive');
    emptyEl?.classList.add('d-none');
    activeEl?.classList.remove('d-none');
    activeEl.classList.add('d-flex');
    activeEl.innerHTML = '<div class="text-center py-5 flex-grow-1"><div class="spinner-border text-danger"></div></div>';

    try {
        const [chatResult, order] = await Promise.all([
            supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`),
            Promise.resolve(adminOrdersCache.find(o => o.id === orderId))
        ]);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Conversa não encontrada.', 'error'); return; }

        const resolveSenderName = (m) => (m.senderId === order?.buyer_id ? order?.buyer_name : order?.seller_name);
        const msgsHtml = (chat.messages || []).map(m => adminMsgBubbleHtml(m, resolveSenderName)).join('')
            || '<div class="text-center text-muted py-4">Sem mensagens.</div>';
        const msgCount = (chat.messages || []).filter(m => m.type !== 'system').length;
        const st = ORDER_STATUS_MAP[order?.status] || { text: order?.status || '—', class: 'bg-secondary' };

        activeEl.innerHTML = `
            <div class="chat-header-pro">
                <button type="button" class="chat-header-close d-lg-none" onclick="window.adminChatsModalBack()" style="margin-right:4px;" title="Voltar para a lista">
                    <i class="bi bi-arrow-left"></i>
                </button>
                <div class="chat-header-avatar-wrap">
                    <img src="${order?.product_img || 'https://placehold.co/45/e9ecef/6c757d?text=%20'}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/45/e9ecef/6c757d?text=%20'">
                </div>
                <div class="chat-header-info">
                    <span class="chat-header-name">${order?.product_title || 'Pedido #' + orderId.slice(-6)}</span>
                    <span class="chat-header-order-id">${order?.buyer_name || '?'} ↔ ${order?.seller_name || '?'} · ${msgCount} mensagens</span>
                </div>
                <button type="button" class="chat-header-close" onclick="window.adminToggleParticipants('adminChatsModalParticipants')" title="Ver usuários da conversa">
                    <i class="bi bi-people-fill"></i>
                </button>
            </div>

            <!-- Resumo do Produto + Status do Pedido, direto junto com o chat (mesmas informações do chat cliente ↔ vendedor) -->
            <div class="chat-product-summary">
                <img src="${order?.product_img || 'https://placehold.co/45/e9ecef/6c757d?text=%20'}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/45/e9ecef/6c757d?text=%20'">
                <div class="chat-product-summary-info">
                    <div class="chat-product-summary-title">${order?.product_title || 'Produto'}</div>
                    <div class="chat-product-summary-price">${order ? formatPreco(order.total, {htmlGratis:false}) : '—'}</div>
                </div>
                <small class="chat-product-summary-id">#${orderId.slice(-6).toUpperCase()}</small>
            </div>
            <div class="chat-status-bar">
                <span class="badge ${st.class}">${st.text}</span>
                ${order?.buyer_name ? `<span class="small text-muted ms-2"><i class="bi bi-bag-fill me-1"></i>${order.buyer_name}</span>` : ''}
                ${order?.seller_name ? `<span class="small text-muted ms-2"><i class="bi bi-shop me-1"></i>${order.seller_name}</span>` : ''}
            </div>

            <div id="adminChatsModalParticipants" class="chat-participants-panel d-none">
                <div class="chat-participant-row">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order?.buyer_name || '?')}&background=3483fa&color=fff" referrerpolicy="no-referrer">
                    <div class="chat-participant-info">
                        <strong>${order?.buyer_name || 'Comprador não identificado'}</strong>
                        <small><i class="bi bi-bag-fill me-1"></i>Comprador</small>
                    </div>
                </div>
                <div class="chat-participant-row">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order?.seller_name || '?')}&background=22c98e&color=fff" referrerpolicy="no-referrer">
                    <div class="chat-participant-info">
                        <strong>${order?.seller_name || 'Vendedor não identificado'}</strong>
                        <small><i class="bi bi-shop me-1"></i>Vendedor</small>
                    </div>
                </div>
            </div>

            <div id="adminChatsModalMsgsBody" class="chat-messages" style="flex-grow:1; overflow-y:auto;">${msgsHtml}</div>

            ${!chat.closed ? `
                <div class="chat-input-bar">
                    <div class="d-flex gap-2 align-items-center">
                        <input type="text" id="adminChatsModalInput" class="chat-text-input" placeholder="Responder como Suporte..." autocomplete="off"
                               onkeypress="if(event.key==='Enter'){event.preventDefault(); window.adminChatsModalSend('${orderId}');}">
                        <button type="button" class="chat-send-btn" onclick="window.adminChatsModalSend('${orderId}')"><i class="bi bi-send-fill"></i></button>
                    </div>
                </div>
            ` : ''}

            <div class="chat-admin-actions">
                <button class="btn btn-ml-danger btn-sm" onclick="window.adminChatsModalDelete('${orderId}')">
                    <i class="bi bi-trash me-1"></i>Apagar conversa e pedido
                </button>
                ${!chat.closed ? `
                    <button class="btn btn-warning btn-sm fw-bold" onclick="window.adminChatsModalCloseChat('${orderId}')">
                        <i class="bi bi-check-circle-fill me-1"></i>Encerrar Atendimento
                    </button>
                ` : `
                    <span class="text-muted small d-flex align-items-center"><i class="bi bi-lock-fill me-1"></i>Atendimento encerrado</span>
                `}
            </div>`;

        const msgsBody = document.getElementById('adminChatsModalMsgsBody');
        if (msgsBody) msgsBody.scrollTop = msgsBody.scrollHeight;
    } catch (e) {
        console.error(e);
        showToast('Erro ao carregar a conversa.', 'error');
    }
};

/** No mobile, volta da conversa aberta pra lista lateral sem fechar o modal */
window.adminChatsModalBack = function() {
    document.getElementById('adminChatsModalMain')?.classList.remove('wa-chat-open');
};

/** Envia uma mensagem como membro da equipe de suporte, dentro do modal de conversas do admin */
window.adminChatsModalSend = async function(orderId) {
    const input = document.getElementById('adminChatsModalInput');
    const text  = input?.value.trim();
    if (!text) return;
    const user = getSavedUser();

    try {
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = chatData?.[0];
        if (!chat) return;

        const messages = chat.messages || [];
        messages.push({
            senderId:   user.id,
            senderName: `${user.nome} (Suporte)`,
            text,
            timestamp:  new Date().toISOString(),
            isStaff:    true
        });

        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        input.value = '';
        window.adminChatsModalSelect(orderId); // recarrega a conversa já com a mensagem nova
    } catch (e) {
        showToast('Erro ao enviar mensagem.', 'error');
    }
};

/** Encerra o atendimento a partir do modal de conversas do admin */
window.adminChatsModalCloseChat = async function(orderId) {
    if (!confirm('Encerrar este atendimento?\nUma mensagem de encerramento será registrada na conversa.')) return;
    const user = getSavedUser();

    try {
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = chatData?.[0];
        if (!chat) return;

        const messages = chat.messages || [];
        messages.push({
            type:      'system',
            senderId:  'system',
            text:      `Atendimento encerrado por ${user.nome} (Suporte).`,
            timestamp: new Date().toISOString()
        });

        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages, closed: true }) });
        showToast('Atendimento encerrado.', 'success');
        window.adminChatsModalSelect(orderId); // recarrega a mesma conversa já como encerrada
        window._adminChatsModalRenderList?.(document.getElementById('adminChatsModalSearch')?.value || '');
    } catch (e) {
        showToast('Erro ao encerrar atendimento.', 'error');
    }
};

/** Apaga a conversa E o pedido associado, a partir do modal de conversas do admin */
window.adminChatsModalDelete = async function(orderId) {
    if (!confirm('Apagar esta conversa e o pedido relacionado permanentemente?\nEsta ação não pode ser desfeita.')) return;
    try {
        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'DELETE' });
        await supabaseFetch(`orders?id=eq.${orderId}`, { method: 'DELETE' });
        showToast('Conversa e pedido removidos pelo administrador.', 'success');
        bootstrap.Modal.getInstance(document.getElementById('adminChatsModal'))?.hide();
        adminRefreshCurrentView();
    } catch (e) {
        showToast('Erro ao remover a conversa.', 'error');
    }
};

// ============================================
// ABA "CHATS" DO PAINEL ADMIN — chat embutido (sem modal)
// ============================================
// Mesmo layout e comportamento do chat cliente ↔ vendedor (lista lateral +
// janela de chat, classes .wa-main/.wa-side/.wa-chat), só que vive direto
// dentro da aba "Chats" do dashboard (com os quadros de estatística em cima)
// e com as ações de administrador (encerrar/apagar) integradas ao próprio
// chat — nada de popup.

/** Preenche a lista lateral da aba "Chats" com as conversas já carregadas pelo renderAdminPanel */
window.renderAdminChatsTab = function(chats, orders) {
    const list = document.getElementById('adminChatsTabList');
    if (!list) return;

    window._adminChatsTabData = {
        chats: chats.slice().sort((a, b) => (a.closed === b.closed) ? 0 : (a.closed ? 1 : -1)),
        orders
    };

    window._adminChatsTabRenderList = (term = '') => {
        const { chats: sorted, orders } = window._adminChatsTabData;
        const q = term.trim().toLowerCase();
        const filtered = sorted.filter(c => {
            if (!q) return true;
            const order = orders.find(o => o.id === c.order_id) || {};
            return `${order.product_title || ''} ${order.buyer_name || ''} ${order.seller_name || ''}`.toLowerCase().includes(q);
        });
        list.innerHTML = filtered.length === 0
            ? '<p class="text-muted text-center small py-4 px-3 mb-0">Nenhuma conversa encontrada.</p>'
            : filtered.map(c => {
                const order = orders.find(o => o.id === c.order_id) || {};
                const msgCount = (c.messages || []).filter(m => m.type !== 'system').length;
                const lastMsg = (c.messages || [])[c.messages.length - 1];
                return `
                <div class="wa-contact ${c.order_id === window._adminActiveChatOrderId ? 'active-chat' : ''}" data-order-id="${c.order_id}" onclick="window.adminChatsTabSelect('${c.order_id}')">
                    <img src="${order.product_img || ''}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/45'">
                    <div class="wa-contact-textbox">
                        <div class="wa-contact-name">${order.product_title || 'Pedido #' + c.order_id?.slice(-6)}</div>
                        <div class="wa-contact-text">${order.buyer_name || '?'} ↔ ${order.seller_name || '?'} • ${msgCount} msgs</div>
                        ${lastMsg ? `<div class="wa-contact-text fst-italic">"${(lastMsg.text || '[mídia]').slice(0,40)}"</div>` : ''}
                    </div>
                    <span class="badge ${c.closed ? 'bg-secondary' : 'bg-success'} wa-contact-badge">${c.closed ? 'Encerrado' : 'Aberto'}</span>
                </div>`;
            }).join('');
    };
    window._adminChatsTabRenderList();

    // Se a aba "Chats" já estava aberta com uma conversa selecionada (ex: o
    // admin encerrou/apagou algo e o painel recarregou), reabre a mesma
    // conversa em vez de voltar pro estado vazio.
    if (window._adminActiveTab === 'admin-chats' && window._adminActiveChatOrderId &&
        window._adminChatsTabData.chats.some(c => c.order_id === window._adminActiveChatOrderId)) {
        window.adminChatsTabSelect(window._adminActiveChatOrderId);
    }
};

/** Filtra a lista lateral da aba "Chats" conforme o admin digita */
window.filterAdminChatsTab = function(term) {
    window._adminChatsTabRenderList?.(term);
};

/** Seleciona e carrega uma conversa específica dentro da aba "Chats" do admin */
window.adminChatsTabSelect = async function(orderId) {
    window._adminActiveChatOrderId = orderId;
    document.getElementById('adminChatsTabMain')?.classList.add('wa-chat-open'); // no mobile, troca a lista pelo chat
    document.querySelectorAll('#adminChatsTabList .wa-contact').forEach(el => el.classList.toggle('active-chat', el.dataset.orderId === orderId));

    const emptyEl = document.getElementById('adminChatsTabEmpty');
    const activeEl = document.getElementById('adminChatsTabActive');
    emptyEl?.classList.add('d-none');
    activeEl?.classList.remove('d-none');
    activeEl.classList.add('d-flex');
    activeEl.innerHTML = '<div class="text-center py-5 flex-grow-1"><div class="spinner-border text-danger"></div></div>';

    try {
        const [chatResult, order] = await Promise.all([
            supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`),
            Promise.resolve((window._adminChatsTabData?.orders || adminOrdersCache).find(o => o.id === orderId))
        ]);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Conversa não encontrada.', 'error'); return; }

        const resolveSenderName = (m) => (m.senderId === order?.buyer_id ? order?.buyer_name : order?.seller_name);
        const msgsHtml = (chat.messages || []).map(m => adminMsgBubbleHtml(m, resolveSenderName)).join('')
            || '<div class="text-center text-muted py-4">Sem mensagens.</div>';
        const msgCount = (chat.messages || []).filter(m => m.type !== 'system').length;
        const st = ORDER_STATUS_MAP[order?.status] || { text: order?.status || '—', class: 'bg-secondary' };

        activeEl.innerHTML = `
            <div class="chat-header-pro">
                <button type="button" class="chat-header-close d-lg-none" onclick="window.adminChatsTabBack()" style="margin-right:4px;" title="Voltar para a lista">
                    <i class="bi bi-arrow-left"></i>
                </button>
                <div class="chat-header-avatar-wrap">
                    <img src="${order?.product_img || 'https://placehold.co/45/e9ecef/6c757d?text=%20'}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/45/e9ecef/6c757d?text=%20'">
                </div>
                <div class="chat-header-info">
                    <span class="chat-header-name">${order?.product_title || 'Pedido #' + orderId.slice(-6)}</span>
                    <span class="chat-header-order-id">${order?.buyer_name || '?'} ↔ ${order?.seller_name || '?'} · ${msgCount} mensagens</span>
                </div>
                <button type="button" class="chat-header-close" onclick="window.adminToggleParticipants('adminChatsTabParticipants')" title="Ver usuários da conversa">
                    <i class="bi bi-people-fill"></i>
                </button>
            </div>

            <!-- Resumo do Produto + Status do Pedido, igual ao chat cliente ↔ vendedor -->
            <div class="chat-product-summary">
                <img src="${order?.product_img || 'https://placehold.co/45/e9ecef/6c757d?text=%20'}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/45/e9ecef/6c757d?text=%20'">
                <div class="chat-product-summary-info">
                    <div class="chat-product-summary-title">${order?.product_title || 'Produto'}</div>
                    <div class="chat-product-summary-price">${order ? formatPreco(order.total, {htmlGratis:false}) : '—'}</div>
                </div>
                <small class="chat-product-summary-id">#${orderId.slice(-6).toUpperCase()}</small>
            </div>
            <div class="chat-status-bar">
                <span class="badge ${st.class}">${st.text}</span>
                ${order?.buyer_name ? `<span class="small text-muted ms-2"><i class="bi bi-bag-fill me-1"></i>${order.buyer_name}</span>` : ''}
                ${order?.seller_name ? `<span class="small text-muted ms-2"><i class="bi bi-shop me-1"></i>${order.seller_name}</span>` : ''}
            </div>

            <div id="adminChatsTabParticipants" class="chat-participants-panel d-none">
                <div class="chat-participant-row">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order?.buyer_name || '?')}&background=3483fa&color=fff" referrerpolicy="no-referrer">
                    <div class="chat-participant-info">
                        <strong>${order?.buyer_name || 'Comprador não identificado'}</strong>
                        <small><i class="bi bi-bag-fill me-1"></i>Comprador</small>
                    </div>
                </div>
                <div class="chat-participant-row">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order?.seller_name || '?')}&background=22c98e&color=fff" referrerpolicy="no-referrer">
                    <div class="chat-participant-info">
                        <strong>${order?.seller_name || 'Vendedor não identificado'}</strong>
                        <small><i class="bi bi-shop me-1"></i>Vendedor</small>
                    </div>
                </div>
            </div>

            <div id="adminChatsTabMsgsBody" class="chat-messages" style="flex-grow:1; overflow-y:auto;">${msgsHtml}</div>

            ${!chat.closed ? `
                <div class="chat-input-bar">
                    <div class="d-flex gap-2 align-items-center">
                        <input type="text" id="adminChatsTabInput" class="chat-text-input" placeholder="Responder como Suporte..." autocomplete="off"
                               onkeypress="if(event.key==='Enter'){event.preventDefault(); window.adminChatsTabSend('${orderId}');}">
                        <button type="button" class="chat-send-btn" onclick="window.adminChatsTabSend('${orderId}')"><i class="bi bi-send-fill"></i></button>
                    </div>
                </div>
            ` : ''}

            <div class="chat-admin-actions">
                <button class="btn btn-ml-danger btn-sm" onclick="window.adminChatsTabDelete('${orderId}')">
                    <i class="bi bi-trash me-1"></i>Apagar conversa e pedido
                </button>
                ${!chat.closed ? `
                    <button class="btn btn-warning btn-sm fw-bold" onclick="window.adminChatsTabCloseChat('${orderId}')">
                        <i class="bi bi-check-circle-fill me-1"></i>Encerrar Atendimento
                    </button>
                ` : `
                    <span class="text-muted small d-flex align-items-center"><i class="bi bi-lock-fill me-1"></i>Atendimento encerrado</span>
                `}
            </div>`;

        const msgsBody = document.getElementById('adminChatsTabMsgsBody');
        if (msgsBody) msgsBody.scrollTop = msgsBody.scrollHeight;
    } catch (e) {
        console.error(e);
        showToast('Erro ao carregar a conversa.', 'error');
    }
};

/** No mobile, volta da conversa aberta pra lista lateral, sem sair da aba */
window.adminChatsTabBack = function() {
    document.getElementById('adminChatsTabMain')?.classList.remove('wa-chat-open');
    window._adminActiveChatOrderId = null;
};

/** Envia uma mensagem como membro da equipe de suporte, direto na aba "Chats" */
window.adminChatsTabSend = async function(orderId) {
    const input = document.getElementById('adminChatsTabInput');
    const text  = input?.value.trim();
    if (!text) return;
    const user = getSavedUser();

    try {
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = chatData?.[0];
        if (!chat) return;

        const messages = chat.messages || [];
        messages.push({
            senderId:   user.id,
            senderName: `${user.nome} (Suporte)`,
            text,
            timestamp:  new Date().toISOString(),
            isStaff:    true
        });

        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        input.value = '';
        window.adminChatsTabSelect(orderId); // recarrega a conversa já com a mensagem nova
    } catch (e) {
        showToast('Erro ao enviar mensagem.', 'error');
    }
};

/** Encerra o atendimento a partir da aba "Chats" do admin */
window.adminChatsTabCloseChat = async function(orderId) {
    if (!confirm('Encerrar este atendimento?\nUma mensagem de encerramento será registrada na conversa.')) return;
    const user = getSavedUser();

    try {
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = chatData?.[0];
        if (!chat) return;

        const messages = chat.messages || [];
        messages.push({
            type:      'system',
            senderId:  'system',
            text:      `Atendimento encerrado por ${user.nome} (Suporte).`,
            timestamp: new Date().toISOString()
        });

        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages, closed: true }) });
        showToast('Atendimento encerrado.', 'success');

        // Atualiza o cache local pra badge da lista virar "Encerrado" na hora
        const cached = window._adminChatsTabData?.chats.find(c => c.order_id === orderId);
        if (cached) cached.closed = true;

        window.adminChatsTabSelect(orderId); // recarrega a mesma conversa já como encerrada
        window._adminChatsTabRenderList?.(document.getElementById('adminChatsTabSearch')?.value || '');
    } catch (e) {
        showToast('Erro ao encerrar atendimento.', 'error');
    }
};

/** Apaga a conversa E o pedido associado, a partir da aba "Chats" do admin */
window.adminChatsTabDelete = async function(orderId) {
    if (!confirm('Apagar esta conversa e o pedido relacionado permanentemente?\nEsta ação não pode ser desfeita.')) return;
    try {
        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'DELETE' });
        await supabaseFetch(`orders?id=eq.${orderId}`, { method: 'DELETE' });
        showToast('Conversa e pedido removidos pelo administrador.', 'success');
        window._adminActiveChatOrderId = null;
        adminRefreshCurrentView();
    } catch (e) {
        showToast('Erro ao remover a conversa.', 'error');
    }
};

// ============================================
// CENTRAL DE SUPORTE (chamados: senha, entrega, conta etc.)
// ============================================
// Reaproveita a tabela `chats` (mesma dos chats comprador ↔ vendedor) sem criar
// nenhuma coluna nova. Um chamado de suporte é uma linha de `chats` onde:
//  - `order_id` fica sempre NULL (é isso que diferencia um chamado de um chat
//    de pedido de verdade, que sempre tem `order_id` preenchido);
//  - `buyer_id` / `buyer_name` guardam o solicitante;
//  - `closed` (mesma coluna já usada pelos chats) guarda o status;
//  - categoria, assunto, e-mail, cargo e pedido relacionado ficam dentro do
//    próprio JSON de `messages`, numa mensagem de metadados (type: 'ticket_meta')
//    que fica escondida da conversa exibida pro usuário/admin.

const SUPPORT_CATEGORY_LABELS = {
    esqueci_senha:            'Esqueci minha senha',
    produto_nao_recebido:     'Não recebi o produto',
    entrega_sem_confirmacao:  'Entreguei, mas o comprador não confirmou',
    conta_ajuda:               'Dúvida sobre a conta/plataforma',
    outro:                     'Outro assunto'
};

/** Converte a linha crua de `chats` (com a mensagem de metadados embutida) num objeto de chamado "achatado" e fácil de usar na UI */
function normalizeTicket(raw) {
    if (!raw) return null;
    const msgs = raw.messages || [];
    const meta = msgs.find(m => m.type === 'ticket_meta') || {};
    return {
        id:              raw.id,
        category:        meta.category,
        subject:         meta.subject,
        status:          raw.closed ? 'closed' : 'open',
        requester_id:    raw.buyer_id,
        requester_name:  raw.buyer_name,
        requester_email: meta.requester_email,
        requester_role:  meta.requester_role,
        order_id:        meta.related_order_id || null,
        messages:        msgs.filter(m => m.type !== 'ticket_meta')
    };
}

/** Busca os chamados de suporte (linhas de `chats` com order_id NULL) sem derrubar o painel em caso de erro */
async function fetchSupportTicketsSafe() {
    try {
        const rows = await supabaseFetch('chats?order_id=is.null&select=*&order=id.desc');
        return rows.map(normalizeTicket);
    } catch (e) {
        console.warn('Erro ao buscar chamados de suporte:', e);
        return [];
    }
}

/**
 * Cria um chamado de suporte. Chamado automaticamente sempre que: o usuário
 * pede recuperação de senha, o comprador reporta que não recebeu o produto,
 * o vendedor reporta que entregou mas não teve confirmação, ou o usuário
 * pede ajuda geral pelo formulário "Falar com o Suporte".
 */
async function createSupportTicket({ category, subject, message = null, orderId = null, overrideEmail = null }) {
    const user = getSavedUser();
    const firstMsgText = message || subject;
    const ticket = {
        id: `ticket_${Date.now()}`,
        // order_id fica NULL de propósito: é o que marca esta linha como um
        // chamado de suporte (todo chat de pedido de verdade tem order_id).
        order_id:   null,
        buyer_id:   user?.id || null,
        buyer_name: user?.nome || 'Visitante',
        closed:     false,
        messages: [
            {
                // "Mensagem" de metadados: não é exibida na conversa, só carrega
                // os dados extras do chamado dentro do próprio JSON de messages.
                type:              'ticket_meta',
                category,
                subject,
                requester_email:   overrideEmail || user?.email || null,
                requester_role:    user?.tipo || null,
                related_order_id:  orderId
            },
            {
                senderId:   user?.id || 'anon',
                senderName: user?.nome || 'Visitante',
                text:       firstMsgText,
                timestamp:  new Date().toISOString()
            }
        ]
    };
    try {
        await supabaseFetch('chats', { method: 'POST', body: JSON.stringify(ticket) });
        return ticket.id;
    } catch (e) {
        console.error('Erro ao abrir chamado de suporte:', e);
        return null;
    }
}

/**
 * Abre "Falar com o Suporte". Se o usuário (logado, ou visitante que já abriu
 * um chamado nesta sessão) já tiver um atendimento em aberto, pula direto pra
 * conversa em vez de mostrar o formulário de novo — é assim que vira um
 * "chatinho" de verdade: clicou, escolheu o assunto, confirmou, e a partir
 * daí sempre volta pra mesma conversa até o admin encerrar o atendimento.
 * `presetCategory`/`presetOrderId` (vindos dos atalhos de "esqueci senha" e
 * "problema com o pedido") sempre abrem um chamado novo com o assunto certo.
 */
window.openSupportRequestModal = async function(presetCategory, presetOrderId) {
    const user = getSavedUser();
    window._supportReqOrderId = presetOrderId || null;

    const modalEl = document.getElementById('supportRequestModal');
    if (!modalEl) return;
    const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);

    if (!presetCategory) {
        modalInstance.show();
        window.showSupportChatLoading();
        const existing = await findMyOpenSupportTicket();
        if (existing) {
            window.enterSupportChatMode(existing.id);
            return;
        }
    }

    window.showSupportRequestForm();

    const emailInput = document.getElementById('supportReqEmail');
    const emailWrap  = document.getElementById('supportReqEmailWrap');
    if (emailInput) emailInput.value = user?.email || '';
    if (emailWrap)  emailWrap.classList.toggle('d-none', !!user);

    const catSelect = document.getElementById('supportReqCategory');
    if (catSelect) catSelect.value = presetCategory || 'conta_ajuda';

    modalInstance.show();
};

/** Envia o formulário de suporte, cria o chamado e já entra na conversa (etapa 2) */
window.submitSupportRequest = async function(event) {
    event.preventDefault();
    const category = document.getElementById('supportReqCategory')?.value || 'outro';
    const email    = document.getElementById('supportReqEmail')?.value.trim();
    const subject  = SUPPORT_CATEGORY_LABELS[category] || 'Solicitação de suporte';
    const message  = subject;
    const user     = getSavedUser();

    if (!user && !email) { showToast('Informe seu e-mail para podermos retornar.', 'warning'); return false; }

    const btn = document.querySelector('#supportRequestForm button[type="submit"]');
    if (btn) { btn.disabled = true; btn.dataset.origText = btn.dataset.origText || btn.textContent; btn.textContent = 'Abrindo chamado...'; }

    const ticketId = await createSupportTicket({
        category,
        subject,
        message,
        orderId:      window._supportReqOrderId || null,
        overrideEmail: email
    });

    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText; }

    if (ticketId) {
        if (!user) { try { localStorage.setItem('electroGuestTicketId', ticketId); } catch (e) {} }
        document.getElementById('supportRequestForm')?.reset();
        window._supportReqOrderId = null;
        showToast('Chamado aberto! Continue a conversa por aqui.', 'success');
        window.enterSupportChatMode(ticketId);
    } else {
        showToast('Erro ao abrir chamado. Tente novamente em instantes.', 'error');
    }
    return false;
};

// -------- Chat do chamado de suporte (visão do usuário que abriu) --------

let supportChatPollInterval  = null;
let supportChatLastSignature = null;
window._activeSupportTicketId = null;

/** Procura um chamado ainda aberto pertencente ao usuário atual (logado, pelo
 *  id da conta; visitante, pelo id salvo no localStorage quando abriu o
 *  chamado) — usado pra retomar a conversa em vez de repetir o formulário. */
async function findMyOpenSupportTicket() {
    const user = getSavedUser();
    try {
        if (user) {
            const rows = await supabaseFetch(`chats?order_id=is.null&buyer_id=eq.${user.id}&closed=eq.false&select=*&order=id.desc&limit=1`);
            return rows?.[0] || null;
        }
        let guestId = null;
        try { guestId = localStorage.getItem('electroGuestTicketId'); } catch (e) {}
        if (!guestId) return null;
        const rows = await supabaseFetch(`chats?id=eq.${guestId}&select=*&limit=1`);
        const t = rows?.[0];
        if (!t || t.closed) { try { localStorage.removeItem('electroGuestTicketId'); } catch (e) {} return null; }
        return t;
    } catch (e) {
        console.warn('Erro ao buscar chamado em andamento:', e);
        return null;
    }
}

/** Volta a etapa 1 (formulário) do modal de suporte */
window.showSupportRequestForm = function() {
    stopSupportChatPolling();
    window._activeSupportTicketId = null;
    document.getElementById('supportRequestForm')?.classList.remove('d-none');
    document.getElementById('supportChatView')?.classList.add('d-none');
    const title = document.getElementById('supportModalTitle');
    if (title) title.innerHTML = '<i class="bi bi-headset me-2"></i>Falar com o Suporte';
};

/** Mostra um estado de carregamento rápido enquanto checa se já existe um chamado em aberto */
window.showSupportChatLoading = function() {
    document.getElementById('supportRequestForm')?.classList.add('d-none');
    const chatView = document.getElementById('supportChatView');
    chatView?.classList.remove('d-none');
    const container = document.getElementById('supportChatMessages');
    if (container) container.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>';
    document.getElementById('supportChatInputBar')?.classList.add('d-none');
};

/** Entra na etapa 2 (conversa) do modal de suporte, pro chamado indicado */
window.enterSupportChatMode = function(ticketId) {
    window._activeSupportTicketId = ticketId;
    supportChatLastSignature = null;
    document.getElementById('supportRequestForm')?.classList.add('d-none');
    document.getElementById('supportChatView')?.classList.remove('d-none');
    const title = document.getElementById('supportModalTitle');
    if (title) title.innerHTML = '<i class="bi bi-headset me-2"></i>Atendimento do Suporte';
    loadMySupportTicket(ticketId);
    startSupportChatPolling(ticketId);
};

function startSupportChatPolling(ticketId) {
    stopSupportChatPolling();
    supportChatPollInterval = setInterval(() => {
        const modalEl = document.getElementById('supportRequestModal');
        const isOpen  = modalEl?.classList.contains('show');
        if (!isOpen || window._activeSupportTicketId !== ticketId) { stopSupportChatPolling(); return; }
        loadMySupportTicket(ticketId, true);
    }, 4000);
}

function stopSupportChatPolling() {
    if (supportChatPollInterval) { clearInterval(supportChatPollInterval); supportChatPollInterval = null; }
}

/** Fecha o modal de suporte e para o polling — chamado pelo X do modal */
window.closeSupportChatModal = function() {
    stopSupportChatPolling();
};

async function loadMySupportTicket(ticketId, silent = false) {
    const container = document.getElementById('supportChatMessages');
    if (!container) return;
    if (!silent) container.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div><p class="small mt-2">Carregando conversa...</p></div>';

    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const raw = result?.[0];
        if (!raw) {
            stopSupportChatPolling();
            if (!silent) container.innerHTML = '<div class="text-center text-muted py-4">Chamado não encontrado.</div>';
            return;
        }
        const ticket = normalizeTicket(raw);

        const signature = JSON.stringify(raw.messages) + '|' + !!raw.closed;
        if (silent && signature === supportChatLastSignature) return;
        supportChatLastSignature = signature;

        const wasNearBottom = !silent || (container.scrollHeight - container.scrollTop - container.clientHeight < 120);

        container.innerHTML = (ticket.messages || []).map(m => supportMsgBubbleHtml(m)).join('')
            || '<div class="text-center text-muted py-4">Sem mensagens ainda.</div>';

        const inputBar = document.getElementById('supportChatInputBar');
        if (inputBar) inputBar.classList.toggle('d-none', ticket.status === 'closed');

        const statusBar = document.getElementById('supportChatStatusBar');
        if (statusBar) {
            statusBar.innerHTML = ticket.status === 'closed'
                ? '<span class="admin-row-badge badge-muted"><i class="bi bi-lock-fill me-1"></i>Atendimento encerrado</span>'
                : `<span class="admin-row-badge badge-open"><i class="bi bi-headset me-1"></i>${SUPPORT_CATEGORY_LABELS[ticket.category] || ticket.subject || 'Chamado'}</span>`;
        }

        if (ticket.status === 'closed') {
            stopSupportChatPolling();
            try {
                if (localStorage.getItem('electroGuestTicketId') === ticketId) localStorage.removeItem('electroGuestTicketId');
            } catch (e) {}
        }

        if (wasNearBottom) container.scrollTop = container.scrollHeight;
    } catch (e) {
        console.error(e);
        if (!silent) container.innerHTML = '<div class="text-center text-muted py-4">Erro ao carregar a conversa.</div>';
    }
}

/** Bolha de mensagem na visão do usuário: a mensagem dele fica à direita, e
 *  as respostas da equipe de suporte (isStaff) ficam à esquerda em destaque. */
function supportMsgBubbleHtml(m) {
    if (m.type === 'system' || m.senderId === 'system') {
        return `<div class="text-center my-3"><span class="system-chip"><i class="bi bi-info-circle-fill"></i>${m.text}</span></div>`;
    }
    const isMe = !m.isStaff;
    const senderLabel = m.isStaff ? (m.senderName || 'Suporte') : 'Você';
    return `
        <div class="msg-row ${isMe ? 'is-me' : 'is-them'}">
            <div class="msg-bubble ${isMe ? 'is-me' : 'is-them is-staff'}">
                <span class="msg-sender">${senderLabel}${m.isStaff ? ' <i class="bi bi-patch-check-fill"></i>' : ''}</span>
                <div class="chat-bubble-text" style="white-space:pre-wrap;">${(m.text || '').replace(/</g, '&lt;')}</div>
                <div class="msg-time">${new Date(m.timestamp).toLocaleString('pt-BR')}</div>
            </div>
        </div>`;
}

/** Envia uma nova mensagem do usuário dentro do chamado já aberto */
window.sendMySupportMessage = async function() {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    const input = document.getElementById('supportChatInput');
    const text  = input?.value.trim();
    if (!text) return;
    const user = getSavedUser();

    input.disabled = true;
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = result?.[0];
        if (!ticket) return;
        if (ticket.closed) { showToast('Este atendimento já foi encerrado.', 'warning'); loadMySupportTicket(ticketId); return; }

        const messages = ticket.messages || [];
        messages.push({
            senderId:   user?.id || 'anon',
            senderName: user?.nome || 'Visitante',
            text,
            timestamp:  new Date().toISOString()
        });

        await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        input.value = '';
        supportChatLastSignature = null;
        await loadMySupportTicket(ticketId);
    } catch (e) {
        showToast('Erro ao enviar mensagem.', 'error');
    } finally {
        input.disabled = false;
        input?.focus();
    }
};

/**
 * Atalhos usados dentro do chat do pedido (área de logística) quando o
 * comprador não recebeu o produto, ou o vendedor entregou mas não teve
 * confirmação — abre o chamado já com o pedido vinculado.
 */
window.reportOrderProblem = function(orderId, category) {
    window.openSupportRequestModal(category, orderId);
};

// -------- Visão do administrador sobre um chamado (mesmo design do chat) --------

/** Abre um chamado de suporte no mesmo layout do chat cliente↔vendedor, sem modal */
window.adminViewTicket = async function(ticketId) {
    const grid = document.getElementById('productsGrid');
    grid.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-danger"></div><p class="mt-2">Carregando chamado...</p></div>';
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = normalizeTicket(result?.[0]);
        if (!ticket) { showToast('Chamado não encontrado.', 'error'); adminRefreshCurrentView(); return; }

        const resolveSenderName = () => ticket.requester_name;
        const msgsHtml = (ticket.messages || []).map(m => adminMsgBubbleHtml(m, resolveSenderName)).join('')
            || '<div class="text-center text-muted py-4">Sem mensagens.</div>';

        grid.className = 'admin-panel-active';
        grid.innerHTML = `
            <div class="admin-standalone-page">
                <div class="d-flex align-items-center gap-2 mb-3">
                    <button class="btn btn-sm btn-ml-secondary" onclick="adminRefreshCurrentView()"><i class="bi bi-arrow-left me-1"></i>Voltar</button>
                    <h5 class="fw-bold mb-0">Chamado de Suporte <span class="admin-row-badge ${ticket.status === 'closed' ? 'badge-muted' : 'badge-open'} ms-1">${ticket.status === 'closed' ? 'Encerrado' : 'Aberto'}</span></h5>
                </div>
                <div class="wa-main admin-chat-main" style="margin:0;">
                    <section class="wa-chat" style="flex-grow:1;">
                        <div class="chat-container" style="height:100%;">
                            <div class="chat-header-pro">
                                <div class="chat-header-avatar-wrap">
                                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(ticket.requester_name || '?')}&background=e50914&color=fff" referrerpolicy="no-referrer">
                                </div>
                                <div class="chat-header-info">
                                    <span class="chat-header-name">${SUPPORT_CATEGORY_LABELS[ticket.category] || ticket.subject || 'Chamado'}</span>
                                    <span class="chat-header-order-id">${ticket.requester_name || 'Visitante'}${ticket.order_id ? ' · Pedido #' + ticket.order_id.slice(-6).toUpperCase() : ''}</span>
                                </div>
                                <button type="button" class="chat-header-close" onclick="window.adminToggleParticipants()" title="Ver usuário do chamado">
                                    <i class="bi bi-people-fill"></i>
                                </button>
                            </div>

                            <div id="adminChatParticipants" class="chat-participants-panel d-none">
                                <div class="chat-participant-row">
                                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(ticket.requester_name || '?')}&background=3483fa&color=fff" referrerpolicy="no-referrer">
                                    <div class="chat-participant-info">
                                        <strong>${ticket.requester_name || 'Visitante'}</strong>
                                        <small>${ticket.requester_email || 'E-mail não informado'} ${ticket.requester_role ? '• ' + (ticket.requester_role === 'ADMIN' ? 'Administrador' : (ticket.requester_role === 'VENDEDOR' ? 'Vendedor' : 'Cliente')) : ''}</small>
                                    </div>
                                </div>
                            </div>

                            <div id="adminChatMsgsBody" class="chat-messages">${msgsHtml}</div>

                            ${ticket.status !== 'closed' ? `
                                <div class="chat-input-bar">
                                    <div class="d-flex gap-2 align-items-center">
                                        <input type="text" id="adminChatInput" class="chat-text-input" placeholder="Responder como Suporte..." autocomplete="off"
                                               onkeypress="if(event.key==='Enter'){event.preventDefault(); window.adminSendTicketMessage('${ticketId}');}">
                                        <button type="button" class="chat-send-btn" onclick="window.adminSendTicketMessage('${ticketId}')"><i class="bi bi-send-fill"></i></button>
                                    </div>
                                </div>
                            ` : ''}

                            <div class="chat-admin-actions">
                                <button class="btn btn-ml-danger btn-sm" onclick="window.adminDeleteTicket('${ticketId}')">
                                    <i class="bi bi-trash me-1"></i>Apagar chamado
                                </button>
                                ${ticket.status !== 'closed' ? `
                                    <button class="btn btn-warning btn-sm fw-bold" onclick="window.adminCloseTicket('${ticketId}')">
                                        <i class="bi bi-check-circle-fill me-1"></i>Encerrar Chamado
                                    </button>
                                ` : `
                                    <span class="text-muted small d-flex align-items-center"><i class="bi bi-lock-fill me-1"></i>Chamado encerrado</span>
                                `}
                            </div>
                        </div>
                    </section>
                </div>
            </div>`;

        const msgsBody = document.getElementById('adminChatMsgsBody');
        if (msgsBody) msgsBody.scrollTop = msgsBody.scrollHeight;
    } catch (e) {
        console.error(e);
        showToast('Erro ao carregar o chamado.', 'error');
    }
};

/** Envia uma resposta da equipe de suporte dentro do chamado */
window.adminSendTicketMessage = async function(ticketId) {
    const input = document.getElementById('adminChatInput');
    const text  = input?.value.trim();
    if (!text) return;
    const user = getSavedUser();

    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = result?.[0];
        if (!ticket) return;

        const messages = ticket.messages || [];
        messages.push({
            senderId:   user.id,
            senderName: `${user.nome} (Suporte)`,
            text,
            timestamp:  new Date().toISOString(),
            isStaff:    true
        });

        await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        input.value = '';
        window.adminViewTicket(ticketId);
    } catch (e) {
        showToast('Erro ao enviar mensagem.', 'error');
    }
};

/** Encerra o chamado de suporte (o requerente pode ver o encerramento se acompanhar o próprio chamado no futuro) */
window.adminCloseTicket = async function(ticketId) {
    if (!confirm('Encerrar este chamado?\nUma mensagem de encerramento será registrada.')) return;
    const user = getSavedUser();
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = result?.[0];
        if (!ticket) return;

        const messages = ticket.messages || [];
        messages.push({
            type:      'system',
            senderId:  'system',
            text:      `Chamado encerrado por ${user.nome} (Suporte).`,
            timestamp: new Date().toISOString()
        });

        await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages, closed: true }) });
        showToast('Chamado encerrado.', 'success');
        window.adminViewTicket(ticketId);
    } catch (e) {
        showToast('Erro ao encerrar chamado.', 'error');
    }
};

/** Apaga o chamado de suporte permanentemente */
window.adminDeleteTicket = async function(ticketId) {
    if (!confirm('Apagar este chamado permanentemente?\nEsta ação não pode ser desfeita.')) return;
    try {
        await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'DELETE' });
        showToast('Chamado removido.', 'success');
        adminRefreshCurrentView();
    } catch (e) { showToast('Erro ao remover o chamado.', 'error'); }
};

// ============================================
// COMPARTILHAR
// ============================================

window.shareProduct = function(pid) {
    const item = allProductsCache.find(x => x.id === pid || x.id == pid);
    if (!item) return;
    const url  = window.location.href;
    const text = `Confira: ${item.titulo} no ElectroMarket!`;

    if (navigator.share) {
        navigator.share({ title: 'ElectroMarket', text, url }).catch(console.error);
    } else {
        navigator.clipboard.writeText(url).then(() => showToast('Link copiado!', 'success', 2000));
    }
};

// ============================================
// MOBILE NAV ACTIVE STATE
// ============================================

window.updateMobileNavActive = function(page) {
    document.querySelectorAll('.mobile-nav-row .nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll(`.mobile-nav-row .nav-item[data-page="${page}"]`).forEach(el => el.classList.add('active'));
};

window.startReply = async function(index) {
    const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
    const msg = chatResult?.[0]?.messages[index];
    if (!msg) return;

    currentReplyIndex = index;
    editingMessageIndex = null;
    
    const preview = document.getElementById('chatInputPreview');
    preview.classList.remove('d-none');
    preview.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
            <div class="small text-truncate" style="max-width: 85%;">
                <strong class="text-primary d-block">Respondendo a ${msg.senderName}</strong>
                <span class="text-muted">${msg.text}</span>
            </div>
            <i class="bi bi-x-lg cursor-pointer" onclick="window.cancelReplyOrEdit()"></i>
        </div>`;
    document.getElementById('chatMessageInput').focus();
};

window.startEdit = async function(index) {
    const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
    const msg = chatResult?.[0]?.messages[index];
    if (!msg) return;

    editingMessageIndex = index;
    currentReplyIndex = null;

    const input = document.getElementById('chatMessageInput');
    input.value = msg.text;
    
    const preview = document.getElementById('chatInputPreview');
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
    const preview = document.getElementById('chatInputPreview');
    if (preview) {
        preview.classList.add('d-none');
        preview.innerHTML = '';
    }
    const input = document.getElementById('chatMessageInput');
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
        // Apaga o conteúdo mas mantém a posição no array (soft delete), pra não
        // quebrar referências de "respondendo a" em outras mensagens.
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

function setupPullToRefresh() {
    const container = document.getElementById('chatMessagesContainer');
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
    const area = document.getElementById('logisticsAgreementArea');
    if (area) {
        document.getElementById('chatAttachPanel')?.classList.add('d-none');
        area.classList.toggle('show-menu');
    }
};

window.finalizarCompraCarrinho = function() {
    if (cart.length === 0) {
        showToast('Seu carrinho está vazio!', 'warning');
        return;
    }
    showToast('Processando seu pedido... Por favor, aguarde.', 'info');
    // Aqui chamaria a lógica de compra em lote ou apenas avisa que deve comprar item a item
    alert('Funcionalidade de Checkout Global em desenvolvimento. Por enquanto, utilize o botão "Solicitar Compra" em cada item.');
};