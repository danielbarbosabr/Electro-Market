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
async function renderStorefrontBanner(stores) {
    const container = document.getElementById('storefrontBanner');
    if (!container) return;
    if (!stores || stores.length === 0) { container.innerHTML = ''; return; }

    // Busca banner de cada loja a partir do campo avatar (array [avatar, banner])
    const storeIds = stores.map(s => s.vendedor_id).join(',');
    let bannersMap = {};
    try {
        const usersData = await supabaseFetch(`users?select=id,avatar&id=in.(${storeIds})`);
        if (usersData) {
            usersData.forEach(u => {
                const { banner } = splitAvatarField(u.avatar);
                if (banner) bannersMap[u.id] = banner;
            });
        }
    } catch(e) {}

    container.innerHTML = stores.map(s => {
        const banner = bannersMap[s.vendedor_id] || '';
        return `
        <div class="storefront-banner" onclick="window.showSellerProfile('${s.vendedor_id}', '${(s.loja||'').replace(/'/g,"\\'")}')">
            ${banner ? `<div class="storefront-banner-thumb"><img src="${banner}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'"></div>` : ''}
            <div class="storefront-banner-icon"><i class="bi bi-shop"></i></div>
            <div class="storefront-banner-info">
                <strong>${s.loja}</strong>
                <small>Ver todos os anúncios desta loja</small>
            </div>
            <i class="bi bi-chevron-right storefront-banner-arrow"></i>
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
        const { avatar: sellerAvatar, banner: sellerBanner } = splitAvatarField(seller.avatar);
        const heroBg = sellerBanner ? `background-image:url('${sellerBanner}');background-size:cover;background-position:center;` : (sellerAvatar ? `background-image:url('${sellerAvatar}');background-size:cover;background-position:center;` : '');

        grid.innerHTML = `
            <div class="seller-profile-page">
                <button type="button" class="detail-back-btn" onclick="window.closeProductDetail()">
                    <i class="bi bi-arrow-left"></i> Voltar
                </button>

                <div class="seller-profile-hero"${sellerBanner || sellerAvatar ? ` style="${heroBg}"` : ''}>
                    <div class="seller-profile-hero-overlay${sellerBanner || sellerAvatar ? '' : ' no-banner'}">
                        <img src="${sellerAvatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(nome)}" class="seller-profile-avatar" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">
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

    const precoNum = parseFloat(item.preco) || 0;
    const installmentValue = precoNum / 3;
    const installmentStr = installmentValue.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    const totalSold = item.vendas || 0;

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
                    <div class="ml-condition">${item.categoria || 'Produto'}${totalSold > 0 ? ` | ${totalSold} vendido${totalSold > 1 ? 's' : ''}` : ''}</div>

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
                            <span class="ml-shipping-detail">Entrega em <strong>${regiaoEntrega}</strong></span>
                        </div>
                    </div>
                    ` : `
                    <div class="ml-shipping-card ml-shipping-pickup">
                        <i class="bi bi-geo-alt-fill" style="color:#e67e22;font-size:1.3rem;"></i>
                        <div>
                            <span class="ml-shipping-title" style="color:#e67e22;">Retirada no local</span>
                            <span class="ml-shipping-detail">${sellerAddress}</span>
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
                            ? `${sellerRatingAvg.toFixed(1)} <i class="bi bi-star-fill text-warning"></i> · ${sellerRatingCount} avaliaç${sellerRatingCount === 1 ? 'ão' : 'ões'}`
                            : 'Ainda sem avaliações'}</div>
                        <a href="javascript:void(0)" class="ml-more-link" onclick="event.preventDefault(); window.showSellerProfile('${item.vendedor_id}', '${(item.loja||'').replace(/'/g,"\\'")}');">Ver mais dados do vendedor</a>
                    </div>
                </div>

                <div class="ml-panel-desc">
                    <h5 class="fw-bold">Descrição</h5>
                    <p class="text-muted" style="line-height:1.7;white-space:pre-line;">${item.descricao || 'Sem descrição detalhada.'}</p>
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

    const showTextCaption = cleanText && !(msg.image && cleanText === 'Imagem') && !(msg.type === 'file' && msg.file);

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
            ${fileChipHtml}
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

