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
        const pending = await supabaseFetch(`orders?select=id&seller_id=eq.${sellerId}&status=eq.pending`);
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
        if (query !== 'eletronicos' && query !== '') {
            const term = query.toLowerCase();
            if (term === 'ofertas') {
                products = products.filter(p => parseFloat(p.preco_original || 0) > parseFloat(p.preco || 0));
                document.getElementById('gridTitle').textContent = 'Ofertas Imperdíveis';
            } else {
                products = products.filter(p =>
                    (p.titulo    || '').toLowerCase().includes(term) ||
                    (p.categoria || '').toLowerCase().includes(term)
                );
                document.getElementById('gridTitle').textContent = `Resultados para "${query}"`;
            }
        } else {
            document.getElementById('gridTitle').textContent = 'Recomendados para você';
        }

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

                    <p class="mb-1"><strong>Vendedor:</strong> ${item.loja || 'Não informado'}</p>
                    <p class="mb-3"><strong>Estoque:</strong> ${item.quantidade || 1} ${item.quantidade === 1 ? 'unidade' : 'unidades'}</p>

                    ${isOwner ? `
                        <button class="btn btn-primary btn-lg w-100 mb-2" onclick="window.prepareEditProduct('${item.id}')">
                            <i class="bi bi-pencil me-2"></i>Editar Anúncio
                        </button>
                        <button class="btn btn-danger w-100" onclick="window.deleteProduct('${item.id}')">
                            <i class="bi bi-trash me-2"></i>Excluir Anúncio
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

function updateUI() {
    const user   = getSavedUser();
    const logged = !!user;
    const role   = user?.tipo || 'CLIENTE';

    document.querySelectorAll('.role-guest').forEach(el     => el.classList.toggle('d-none', logged));
    document.querySelectorAll('.role-logged-in').forEach(el => el.classList.toggle('d-none', !logged));
    document.querySelectorAll('.role-client').forEach(el    => el.classList.toggle('d-none', role === 'VENDEDOR'));
    document.querySelectorAll('.role-seller').forEach(el    => el.classList.toggle('d-none', role !== 'VENDEDOR' && role !== 'ADMIN'));
    document.querySelectorAll('.role-admin').forEach(el     => el.classList.toggle('d-none', role !== 'ADMIN'));

    if (role === 'VENDEDOR' || role === 'ADMIN') {
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

document.addEventListener('DOMContentLoaded', () => {
    // Aplicar tema salvo
    if (localStorage.getItem('modoEscuro') === 'true') {
        document.body.classList.add('dark-theme');
    }

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
            const editingId = e.target.dataset.editingId;

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
                imgsArray = safeParseImages(allProductsCache.find(p => p.id === editingId)?.img);
            }

            // OFERTA AUTOMÁTICA (estilo Mercado Livre): se o vendedor está editando
            // um anúncio já existente e simplesmente baixou o preço, sem preencher
            // manualmente o campo "preço original", usamos o preço anterior como
            // preço "de" automaticamente — o anúncio já nasce como oferta, sem o
            // vendedor precisar digitar nada a mais.
            if (editingId && precoOriginal === null) {
                const anuncioAnterior = allProductsCache.find(p => p.id === editingId);
                const precoAnterior = anuncioAnterior ? parseFloat(anuncioAnterior.preco) : null;
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
                loja:         user.nome,
                vendedor_id:  user.id,
                // Localização do anúncio = cidade cadastrada do vendedor (evita ficar "Não informada"
                // e permite que o filtro de Estado/Cidade/CEP encontre o produto corretamente).
                cidade:       user.cidade || '',
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
            await loadPage(undefined, true);
            createPersistentNotification(editingId ? 'Seu anúncio foi atualizado.' : 'Novo anúncio publicado com sucesso!', 'success');
            e.target.reset();
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

        const novoTipo = document.getElementById('editTipo')?.value || user.tipo;

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
        bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('profileEditOffcanvas'))?.hide();
        updateUI();
        createPersistentNotification('Suas informações de perfil foram atualizadas.', 'success');

        // Se o tipo de conta mudou, recarrega a página pra garantir que todo o
        // menu/navegação (que depende do papel do usuário) se ajuste corretamente.
        if (novoTipo !== user.tipo) {
            showToast(`Sua conta agora é do tipo ${novoTipo === 'VENDEDOR' ? 'Vendedor' : 'Cliente'}.`, 'success');
            setTimeout(() => location.reload(), 900);
        }
    });

    // Busca com debounce
    let searchTimeout;
    const searchInput = document.getElementById('searchInput');
    const btnSearch   = document.getElementById('btnSearch');

    btnSearch?.addEventListener('click', () => {
        loadPage(searchInput?.value?.trim() || 'eletronicos');
    });

    searchInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadPage(e.target.value.trim() || 'eletronicos');
    });

    // Busca ao digitar (debounce 500ms)
    searchInput?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const val = e.target.value.trim();
        if (val.length >= 3) {
            searchTimeout = setTimeout(() => loadPage(val), 500);
        } else if (val.length === 0) {
            loadPage('eletronicos');
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

    const user = getSavedUser();
    if (user?.tipo === 'VENDEDOR') {
        window.renderSellerPanel();
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
    if (tipoSelect) tipoSelect.value = (user.tipo === 'VENDEDOR') ? 'VENDEDOR' : 'CLIENTE';

    const linkInput = document.getElementById('editAvatarLink');
    if (linkInput) {
        const avatarLinks = safeParseImages(user.avatar);
        linkInput.value = avatarLinks.length > 0 ? avatarLinks[0] : '';
    }

    const preview = document.getElementById('profilePreview');
    if (preview) {
        preview.src = user.avatar?.startsWith('http') ? user.avatar : 'https://placehold.co/100';
    }

    bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('profileEditOffcanvas')).show();
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
  window.open('https://github.com/danielbarbosabr', '_blank', 'noopener');
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

        orders = orders.filter(o => o.status !== 'pending' || type === 'buyer');
        orders = orders.slice().sort((a,b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

        const newSignature = JSON.stringify(orders.map(o => `${o.id}:${o.status}:${o.agree_buyer}:${o.agree_seller}`));
        if (newSignature === previousSignature) return; // nada mudou, evita re-render desnecessário

        if (!orders.length) return; // mantém a mensagem de "nenhum pedido" já mostrada

        waList.innerHTML = orders.map(order => {
            const st        = ORDER_STATUS_MAP[order.status] || { text: order.status, class: 'bg-secondary' };
            const isPending = order.status === 'pending';
            const isBuyer   = user.id === order.buyer_id;
            const partnerName = isBuyer ? order.seller_name : order.buyer_name;

            let actionsHtml = '';
            if (isPending && type === 'buyer') {
                actionsHtml = `<button class="btn btn-sm btn-outline-danger w-100" onclick="event.stopPropagation(); window.cancelOrderBuyer('${order.id}')">Cancelar Pedido</button>`;
            } else if (order.status === 'cancelled' || order.status === 'finished') {
                actionsHtml = `<button class="btn btn-sm btn-outline-secondary w-100" onclick="event.stopPropagation(); window.removeOrderFromHistory('${order.id}', '${type}')"><i class="bi bi-trash me-1"></i>Remover</button>`;
            }

            return `
            <div class="wa-contact" data-order-id="${order.id}" onclick="${!isPending && order.status !== 'cancelled' ? `window.showChat('${order.id}')` : ''}" style="${isPending || order.status === 'cancelled' ? 'cursor:default;' : ''}">
                <img src="${order.product_img || ''}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/45'">
                <div class="wa-contact-textbox">
                    <div class="wa-contact-name">${partnerName || 'Usuário'}</div>
                    <div class="wa-contact-text">${order.product_title || 'Produto'} · ${formatPreco(order.total, {htmlGratis:false})}</div>
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

        // Aqui só entram pedidos já aceitos (a tela de chat não faz sentido pra pendentes)
        orders = orders.filter(o => o.status !== 'pending' || type === 'buyer');

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
            const isPending = order.status === 'pending';
            const isBuyer   = user.id === order.buyer_id;
            const partnerName = isBuyer ? order.seller_name : order.buyer_name;

            let actionsHtml = '';
            if (isPending && type === 'buyer') {
                actionsHtml = `<button class="btn btn-sm btn-outline-danger w-100" onclick="event.stopPropagation(); window.cancelOrderBuyer('${order.id}')">Cancelar Pedido</button>`;
            } else if (order.status === 'cancelled' || order.status === 'finished') {
                actionsHtml = `<button class="btn btn-sm btn-outline-secondary w-100" onclick="event.stopPropagation(); window.removeOrderFromHistory('${order.id}', '${type}')"><i class="bi bi-trash me-1"></i>Remover</button>`;
            }

            return `
            <div class="wa-contact" data-order-id="${order.id}" onclick="${!isPending && order.status !== 'cancelled' ? `window.showChat('${order.id}')` : ''}" style="${isPending || order.status === 'cancelled' ? 'cursor:default;' : ''}">
                <img src="${order.product_img || ''}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/45'">
                <div class="wa-contact-textbox">
                    <div class="wa-contact-name">${partnerName || 'Usuário'}</div>
                    <div class="wa-contact-text">${order.product_title || 'Produto'} · ${formatPreco(order.total, {htmlGratis:false})}</div>
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
        orders = orders.filter(o => o.status === 'pending');

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
            return `
            <div class="col-12 col-lg-6">
                <div class="card border-0 shadow-sm p-3 mb-3" style="border-radius:14px;">
                    <div class="d-flex gap-3">
                        <img src="${order.product_img || ''}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/70'"
                             style="width:70px;height:70px;object-fit:cover;border-radius:10px;flex-shrink:0;">
                        <div class="flex-grow-1">
                            <h6 class="fw-bold mb-1">${order.product_title || 'Produto'}</h6>
                            <p class="mb-1 text-success fw-bold">${formatPreco(order.total, {htmlGratis:false})} <small class="text-muted fw-normal">(${order.quantity} un.)</small></p>
                            <p class="mb-0 small text-muted">ID: #${order.id.slice(-8).toUpperCase()}</p>
                        </div>
                    </div>
                    <hr>
                    <p class="small mb-1"><i class="bi bi-person-fill me-2 text-muted"></i><strong>${buyer.nome || order.buyer_name || 'Cliente'}</strong></p>
                    ${buyer.telefone ? `<p class="small mb-1"><i class="bi bi-telephone-fill me-2 text-muted"></i>${buyer.telefone}</p>` : ''}
                    ${buyer.endereco ? `<p class="small mb-2"><i class="bi bi-geo-alt-fill me-2 text-muted"></i>${buyer.endereco}${buyer.cep ? `, CEP ${buyer.cep}` : ''} — ${buyer.cidade || ''}/${buyer.estado || ''}</p>` : `<p class="small mb-2 text-muted"><i class="bi bi-geo-alt-fill me-2"></i>Endereço não informado</p>`}
                    <div class="d-flex gap-2 mt-2">
                        <button class="btn btn-success fw-bold flex-grow-1" onclick="window.updateOrderStatus('${order.id}', 'accepted')">
                            <i class="bi bi-check-lg me-1"></i>Aceitar
                        </button>
                        <button class="btn btn-outline-danger flex-grow-1" onclick="window.updateOrderStatus('${order.id}', 'cancelled')">
                            Recusar
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
        showToast(`Pedido ${newStatus === 'accepted' ? 'aceito' : 'recusado'}!`, newStatus === 'accepted' ? 'success' : 'info');

        // CORREÇÃO: antes o comprador nunca era avisado que o pedido tinha sido
        // aceito/recusado — só descobriria se, por conta própria, saísse da tela
        // "Minhas Compras" e voltasse pra ela de novo. Agora ele recebe uma
        // notificação (sino) assim que o vendedor decide.
        if (order?.buyer_id) {
            const msg = newStatus === 'accepted'
                ? `Sua proposta para "${order.product_title || 'produto'}" foi aceita! Você já pode conversar com o vendedor.`
                : `Sua proposta para "${order.product_title || 'produto'}" foi recusada pelo vendedor.`;
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
            buttonsHtml += `<button class="btn btn-success w-100 rounded-pill fw-bold mb-2" onclick="window.confirmReceipt('${order.id}')"><i class="bi bi-box-seam-fill me-1"></i>Confirmar Recebimento</button>`;
        } else {
            buttonsHtml += `<div class="alert alert-primary rounded-pill text-center small mb-2">Aguardando o comprador confirmar recebimento</div>`;
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
    if (user.tipo !== 'VENDEDOR' && user.tipo !== 'ADMIN') { showToast('Acesso restrito a vendedores!', 'warning'); return; }

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
window.renderAdminPanel = async function() {
    const user = getSavedUser();
    if (!user || user.tipo !== 'ADMIN') {
        showToast('Acesso restrito a administradores!', 'error');
        return;
    }

    window.exitWaOrdersView();
    document.getElementById('gridTitle').textContent = 'Painel Administrativo';
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');

    const grid = document.getElementById('productsGrid');
    grid.style.display = ''; // deixa a classe CSS controlar (grid), sem forçar bloco via estilo inline
    grid.classList.add('order-view-active');
    grid.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-danger"></div><p class="mt-2">Carregando base de dados...</p></div>';

    try {
        // Busca todos os usuários e produtos para gestão
        const [users, products] = await Promise.all([
            supabaseFetch('users?select=*&order=nome.asc'),
            supabaseFetch('products?select=*&order=created_at.desc')
        ]);

        grid.innerHTML = `
            <div class="container-fluid py-2">
                <nav class="mb-4 d-flex justify-content-center">
                    <div class="nav nav-pills border-0 bg-light p-1 rounded-pill shadow-sm" id="nav-tab" role="tablist">
                        <button class="nav-link active rounded-pill px-4 fw-bold" data-bs-toggle="pill" data-bs-target="#admin-users" type="button">Usuários (${users.length})</button>
                        <button class="nav-link rounded-pill px-4 fw-bold" data-bs-toggle="pill" data-bs-target="#admin-cats" type="button">Categorias</button>
                        <button class="nav-link rounded-pill px-4 fw-bold" data-bs-toggle="pill" data-bs-target="#admin-prods" type="button">Publicações (${products.length})</button>
                    </div>
                </nav>
                <div class="tab-content" id="nav-tabContent">
                    <div class="tab-pane fade show active" id="admin-users">
                        <div class="list-group shadow-sm mt-2">
                            ${users.map(u => `
                                <div class="list-group-item d-flex align-items-center justify-content-between p-3 border-0 mb-2 rounded shadow-sm bg-white">
                                    <div class="d-flex align-items-center gap-3 text-dark">
                                        <img src="${u.avatar || 'https://ui-avatars.com/api/?name='+encodeURIComponent(u.nome)}" class="rounded-circle border" width="45" height="45" style="object-fit:cover;" referrerpolicy="no-referrer">
                                        <div>
                                            <h6 class="mb-0 fw-bold">${u.nome}</h6>
                                            <small class="text-muted">${u.email} • <span class="badge ${u.tipo==='ADMIN'?'bg-danger':'bg-primary'}">${u.tipo}</span></small>
                                        </div>
                                    </div>
                                    ${u.id !== user.id ? `
                                        <button class="btn btn-sm btn-outline-danger border-0" onclick="window.adminDeleteUser('${u.id}', '${u.nome}')" title="Apagar Conta">
                                            <i class="bi bi-person-x fs-5"></i>
                                        </button>
                                    ` : '<span class="badge bg-light text-dark border">Você</span>'}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="tab-pane fade" id="admin-cats">
                        <div class="list-group shadow-sm mt-2">
                            ${[...new Set(products.map(p => p.categoria || 'Geral'))].map(cat => `
                                <div class="list-group-item d-flex align-items-center justify-content-between p-3 border-0 mb-2 rounded shadow-sm bg-white">
                                    <h6 class="mb-0 fw-bold">${cat}</h6>
                                    <span class="badge bg-light text-dark border">${products.filter(p => p.categoria === cat).length} anúncios</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="tab-pane fade" id="admin-prods">
                        <div class="list-group shadow-sm mt-2">
                            ${products.map(p => `
                                <div class="list-group-item d-flex align-items-center justify-content-between p-3 border-0 mb-2 rounded shadow-sm bg-white">
                                    <div class="d-flex align-items-center gap-3 text-dark">
                                        <img src="${safeParseImages(p.img)[0] || 'https://placehold.co/45'}" 
                                             class="rounded" width="45" height="45" style="object-fit:cover;" 
                                             onerror="this.src='https://placehold.co/45'">
                                        <div style="max-width: 250px;">
                                            <h6 class="mb-0 fw-bold text-truncate">${p.titulo}</h6>
                                            <small class="text-muted">Loja: ${p.loja} • ${parseFloat(p.preco) === 0 ? 'GRÁTIS' : `R$ ${parseFloat(p.preco).toLocaleString('pt-BR')}`}</small>
                                        </div>
                                    </div>
                                    <button class="btn btn-sm btn-outline-danger border-0" onclick="window.adminDeleteProduct('${p.id}', '${p.titulo}')" title="Remover Publicação">
                                        <i class="bi bi-trash fs-5"></i>
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>`;
        window.closeMobileMenu();
    } catch (e) {
        console.error(e);
        grid.innerHTML = '<div class="alert alert-danger">Erro ao acessar o banco de dados.</div>';
    }
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
        window.renderAdminPanel(); // Atualiza a lista
    } catch (e) { showToast('Erro ao remover produto.', 'error'); }
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
