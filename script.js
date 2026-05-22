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
let ordersCache       = [];
let currentReplyIndex   = null;
let editingMessageIndex = null;
let riveInstance      = null;
let chatsCache        = [];
let notificationsCache = JSON.parse(localStorage.getItem('electroNotifs')) || [];

const ORDER_STATUS_MAP = {
    'pending':         { text: 'Em Aprovação',             class: 'bg-warning text-dark' },
    'accepted':        { text: 'Aprovado (Chat Liberado)', class: 'bg-success' },
    'agreement':       { text: '🤝 Combinando Entrega',     class: 'bg-info' },
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

async function loadPage(query = 'eletronicos') {
    const grid = document.getElementById('productsGrid');
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

    try {
        const user = getSavedUser();
        const role = user?.tipo || 'CLIENTE';
        const hero = document.getElementById('heroSection');
        let path = 'products?select=*';

        if (hero) {
            hero.classList.toggle('d-none', role === 'VENDEDOR' || query !== 'eletronicos');
        }

        if (user && user.tipo === 'VENDEDOR') {
            path += `&vendedor_id=eq.${user.id}`;
        }

        const data = await supabaseFetch(path);
        console.log(`Fetched ${data.length} products from Supabase.`);
        allProductsCache = data || [];

        let products = allProductsCache;
        if (query !== 'eletronicos' && query !== '') {
            const term = query.toLowerCase();
            if (term === 'ofertas') {
                products = products.filter(p => (p.preco_original || 0) > p.preco);
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

        console.log(`loadPage called with query: "${query}"`);
        console.log(`Filtered products count: ${products.length}`);
        console.log(`Filtered products:`, products);
        renderGrid(products);
        updateStoreFilterUI();
    } catch (e) {
        console.error(e);
        grid.innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="bi bi-wifi-off fs-1 text-muted d-block mb-3"></i>
                <h5>Erro ao carregar produtos</h5>
                <button class="btn btn-primary mt-3" onclick="loadPage()">Tentar novamente</button>
            </div>`;
    }
}

// ============================================
// RENDER CARD
// ============================================

function renderCard(item) {
    if (!item?.titulo) return '';
    const preco    = item.preco || 0;
    const pid      = item.id;
    const isLiked  = likedProducts.includes(pid);
    const realizaEntrega = !!(item.realiza_entrega ?? item.realizaEntrega ?? item.realizaentrega ?? true);
    const cidade   = item.cidade || 'Não informada';
    const imgs = safeParseImages(item.img);
    const thumb = (imgs.length > 0 ? imgs[0] : null) || 'https://via.placeholder.com/400';

    const precoFormatado = preco === 0
        ? '<span class="text-success fw-bold">GRÁTIS</span>'
        : `R$ ${Math.floor(preco).toLocaleString('pt-BR')}<small style="font-size:0.6em">,${((preco % 1).toFixed(2)).slice(1)}</small>`;

    return `
        <div class="card product-card-ml" onclick="window.showDetail('${pid}')">
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
                    ? `<img src="${thumb}" alt="${item.titulo}" loading="lazy"
                           onerror="this.parentElement.innerHTML='<i class=\\'bi bi-box-seam text-secondary\\' style=\\'font-size:2.5rem;\\'></i>'">`
                    : `<i class="bi bi-box-seam text-secondary" style="font-size:2.5rem;"></i>`
                }
            </div>
            <div class="card-body product-card-body">
                <h6 class="product-title-grid">${item.titulo}</h6>
                <div class="current-price">
                    ${item.preco_original && item.preco_original > preco
                        ? `<div class="text-muted text-decoration-line-through" style="font-size:0.75rem;font-weight:normal;">
                               R$ ${item.preco_original.toLocaleString('pt-BR', {minimumFractionDigits:2})}
                           </div>`
                        : ''
                    }
                    ${precoFormatado}
                </div>
                <div class="${realizaEntrega ? 'text-success' : 'text-muted'} small fw-bold mt-2">
                    <i class="bi ${realizaEntrega ? 'bi-truck' : 'bi-geo-alt'}"></i>
                    ${realizaEntrega ? 'Entrega disponível' : 'Retirada no local'}
                </div>
                <div class="text-muted mt-1" style="font-size:0.7rem;">
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

function applyFilters() {
    const min    = parseFloat(document.getElementById('minPrice')?.value)  || 0;
    const max    = parseFloat(document.getElementById('maxPrice')?.value)  || Infinity;
    const sort   = document.getElementById('sortOrder')?.value;
    const stores = Array.from(document.querySelectorAll('.store-checkbox:checked')).map(cb => cb.value);
    const city   = (document.getElementById('filterCity')?.value || '').toLowerCase();

    let filtered = allProductsCache.filter(p =>
        p.preco >= min && p.preco <= max &&
        (!stores.length || stores.includes(p.loja)) &&
        (p.cidade || '').toLowerCase().includes(city)
    );

    if (sort === 'priceAsc')  filtered.sort((a, b) => a.preco - b.preco);
    if (sort === 'priceDesc') filtered.sort((a, b) => b.preco - a.preco);

    renderGrid(filtered);
}

function clearFilters() {
    ['minPrice', 'maxPrice', 'filterCity'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const s = document.getElementById('sortOrder');
    if (s) s.value = 'default';
    document.querySelectorAll('.store-checkbox').forEach(cb => cb.checked = true);
    renderGrid(allProductsCache);
}

// ============================================
// DETALHE DO PRODUTO
// ============================================

window.showDetail = async function(pid) {
    const item = allProductsCache.find(x => x.id == pid || x.id === pid);
    if (!item) return;

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
    try {
        const sellerInfo = await supabaseFetch(`users?select=endereco,cidade,estado&id=eq.${item.vendedor_id}`);
        if (sellerInfo?.length > 0) {
            const s = sellerInfo[0];
            sellerAddress = `${s.endereco || ''}, ${s.cidade || ''} - ${s.estado || ''}`.replace(/^, /, '');
        }
    } catch (e) {}

    const realizaEntrega  = !!(item.realiza_entrega ?? item.realizaEntrega ?? item.realizaentrega ?? true);
    const cidadeVendedor  = item.cidade || 'sua região';
    const images = safeParseImages(item.img);
    const mainImg         = images[0] || '';

    const thumbnailsHtml = images.length > 1 ? `
        <div class="d-flex gap-2 mt-2 justify-content-center overflow-auto pb-2">
            ${images.map(src => `
                <img src="${src}" class="rounded border" width="58" height="58"
                     style="object-fit:cover;cursor:pointer;transition:transform 0.2s;"
                     onmouseover="this.style.transform='scale(1.1)'"
                     onmouseout="this.style.transform='scale(1)'"
                     onclick="document.getElementById('mainDetailImg').src='${src}'">`
            ).join('')}
        </div>` : '';

    const sellerProducts = allProductsCache.filter(p => p.vendedor_id === item.vendedor_id);
    const totalLikes     = sellerProducts.reduce((acc, p) => acc + (parseInt(p.likes) || 0), 0) || 0;
    const level          = totalLikes > 50 ? 5 : totalLikes > 20 ? 4 : totalLikes > 10 ? 3 : totalLikes > 2 ? 2 : 1;
    const colors         = ['#F23D35', '#FF8900', '#FFE600', '#ADE07E', '#00A650'];

    document.getElementById('productDetailContent').innerHTML = `
        <div class="row g-0 g-md-4">
            <div class="col-md-7 border-end pe-md-4">
                <div class="text-center mb-3 bg-light rounded p-3 d-flex align-items-center justify-content-center" style="min-height:260px;">
                    ${mainImg
                        ? `<img id="mainDetailImg" src="${mainImg}" class="img-fluid" style="max-height:380px;object-fit:contain;transition:transform 0.3s;"
                               onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'"
                               onerror="this.parentElement.innerHTML='<i class=\\'bi bi-box-seam text-secondary\\' style=\\'font-size:4rem;\\'></i>'">`
                        : `<i class="bi bi-box-seam text-secondary" style="font-size:4rem;"></i>`
                    }
                </div>
                ${thumbnailsHtml}
                <div class="d-none d-md-block mt-3">
                    <h5 class="fw-bold">Descrição</h5>
                    <p class="text-muted" style="line-height:1.7">${item.descricao || 'Sem descrição detalhada.'}</p>
                </div>
            </div>
            <div class="col-md-5 pt-3 pt-md-0">
                <span class="badge bg-secondary mb-2 small">${item.categoria || 'Geral'}</span>
                <h4 class="fw-bold">${item.titulo}</h4>

                <div class="my-3">
                    ${item.preco === 0
                        ? `<span class="fs-1 fw-bold text-success">GRÁTIS</span>`
                        : `<span class="fs-1 fw-bold">R$ ${Math.floor(item.preco || 0).toLocaleString('pt-BR')}</span>
                           <span class="fs-5">,${((item.preco % 1).toFixed(2)).slice(1)}</span>`
                    }
                </div>

                <div class="card bg-light border-0 p-3 mb-3" style="border-radius:10px;">
                    ${realizaEntrega ? `
                        <p class="mb-1 text-success fw-bold"><i class="bi bi-truck me-2"></i> Entrega disponível</p>
                        <small class="text-muted">Entrega em <strong>${cidadeVendedor}</strong></small>
                    ` : `
                        <p class="mb-1 fw-bold" style="color:#e67e22;"><i class="bi bi-geo-alt me-2"></i> Retirada no local</p>
                        <small class="text-muted"><strong>Local:</strong> ${sellerAddress}</small>
                    `}
                </div>

                <div class="mb-3">
                    <p class="small mb-1 fw-bold text-muted">Reputação do vendedor</p>
                    <div class="d-flex gap-1 mb-1" style="height:8px;">
                        ${[1,2,3,4,5].map(i => `
                            <div class="flex-grow-1 rounded" style="background-color:${level>=i ? colors[i-1] : '#eee'}"></div>
                        `).join('')}
                    </div>
                    <small class="text-muted">${totalLikes} curtidas recebidas</small>
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
                    <button class="btn btn-primary btn-lg w-100 mb-2" onclick="window.addToCart('${pid}');window.buyItem(cart.length-1);bootstrap.Modal.getInstance(document.getElementById('productDetailModal')).hide();">
                        <i class="bi bi-lightning me-2"></i>Comprar Agora
                    </button>
                    <button class="btn btn-success w-100 mb-2" onclick="window.addToCart('${pid}');bootstrap.Modal.getInstance(document.getElementById('productDetailModal')).hide();">
                        <i class="bi bi-cart-plus me-2"></i>Adicionar ao Carrinho
                    </button>
                `}
                <button class="btn btn-link text-decoration-none w-100 text-muted small" onclick="window.shareProduct('${pid}')">
                    <i class="bi bi-share me-2"></i>Compartilhar
                </button>
            </div>
        </div>`;

    new bootstrap.Modal(document.getElementById('productDetailModal')).show();
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

    const heroSection = document.getElementById('heroSection');
    if (heroSection) heroSection.classList.toggle('d-none', role === 'VENDEDOR');

    const shippingLabel = document.getElementById('shippingLabel');
    if (shippingLabel) {
        shippingLabel.textContent = logged
            ? (user.endereco?.substring(0, 20) + '...') || user.cidade || 'Endereço'
            : 'Faça login';
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
                ? `<img src="${userAvatarLink}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='https://via.placeholder.com/100'">`
                : `<i class="bi bi-person-circle fs-5 text-white"></i>`;
        }

        if (mobileMenuAvatar) {
            mobileMenuAvatar.innerHTML = hasAvatar
                ? `<img src="${userAvatarLink}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='https://via.placeholder.com/100'">`
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
            preview.src = url.startsWith('http') ? url : 'https://via.placeholder.com/100';
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
        const thumb = Array.isArray(item.img) ? item.img[0] : item.img;
        return `
        <div class="cart-item border rounded p-2 mb-2">
            <div class="d-flex gap-2 align-items-center">
                <img src="${thumb || 'https://placehold.co/60'}" style="width:50px;height:50px;object-fit:contain;border-radius:6px;" loading="lazy">
                <div class="flex-grow-1">
                    <div class="small fw-bold text-truncate">${item.titulo}</div>
                    <div class="text-success fw-bold small">R$ ${(item.preco || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</div>
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
                <button class="btn btn-sm btn-success flex-grow-1" onclick="buyItem(${i})">
                    Comprar
                </button>
            </div>
        </div>`;
    }).join('');

    if (totalEl) totalEl.textContent = `R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
    updateCartBadge();
    localStorage.setItem('electroCart', JSON.stringify(cart));
}

window.addToCart = function(productId) {
    const p = allProductsCache.find(x => x.id === productId);
    if (!p) return;
    const exist = cart.find(i => i.id === productId);
    if (exist) {
        if (exist.qtd >= 2) return showToast('Limite de 2 unidades por produto!', 'warning');
        exist.qtd++;
    } else {
        cart.push({ ...p, qtd: 1 });
    }
    renderCart();
    showToast(`"${p.titulo.substring(0,30)}..." adicionado ao carrinho!`, 'success');
    bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('cartOffcanvas')).show();
};

window.removeFromCart = function(i) {
    cart.splice(i, 1);
    renderCart();
};

window.updateCartQty = function(i, delta) {
    const item = cart[i];
    if (!item) return;
    const newQty = (item.qtd || 1) + delta;
    if (newQty > 2) {
        showToast('Máximo de 2 unidades permitido!', 'warning');
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
        showToast('Removido dos favoritos', 'info', 2000);
    } else {
        likedProducts.push(pid);
        product.likes = (product.likes || 0) + 1;
        showToast('Adicionado aos favoritos!', 'success', 2000);
    }

    localStorage.setItem('electroLiked', JSON.stringify(likedProducts));
    try {
        await supabaseFetch(`products?id=eq.${pid}`, {
            method: 'PATCH',
            body: JSON.stringify({ likes: product.likes })
        });
    } catch (e) {}

    renderGrid(allProductsCache);
};

window.buyItem = async function(i) {
    const item = cart[i];
    const user = getSavedUser();
    if (!user) { showToast('Faça login para comprar!', 'warning'); return; }

    const btn          = document.querySelector(`button[onclick="buyItem(${i})"]`);
    const originalText = btn?.textContent || 'Comprar';
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
                    text:      `🛒 Pedido #${orderId.slice(-8).toUpperCase()} criado!\n📦 ${item.titulo}\n💰 R$ ${order.total.toLocaleString('pt-BR')}\n⏳ Aguardando aprovação do vendedor...`,
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
        if (isNaN(preco) || preco < 0) { showToast('Preço inválido! Digite um número maior ou igual a zero.', 'warning'); return; }

        const quantidadeInput = document.getElementById('prodQuantity').value;
        const quantidade = parseInt(quantidadeInput);
        if (isNaN(quantidade) || quantidade < 1) { showToast('Quantidade inválida! Digite um número inteiro maior ou igual a um.', 'warning'); return; }

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

            const productData = {
                titulo:       document.getElementById('prodTitle').value,
                descricao:    document.getElementById('prodDescription').value,
                preco:        preco, // Usar o valor validado
                quantidade:   quantidade, // Usar o valor validado
                categoria:    document.getElementById('prodCategory').value, // Usar o valor validado
                img:          JSON.stringify(imgsArray),
                loja:         user.nome,
                vendedor_id:  user.id,
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
            await loadPage();
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

        const updated = { 
            ...user, 
            nome: document.getElementById('editNome').value.trim(), 
            avatar: novoAvatar || user.avatar 
        };

        await supabaseFetch(`users?id=eq.${user.id}`, { method: 'PATCH', body: JSON.stringify(updated) });
        localStorage.setItem('electroUser', JSON.stringify(updated));
        bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('profileEditOffcanvas'))?.hide();
        updateUI();
        createPersistentNotification('Suas informações de perfil foram atualizadas.', 'success');
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
function normalizeImageUrl(url) {
    if (!url || typeof url !== 'string') return url;
    // Já é link direto ou possui extensão?
    if (url.includes('i.imgur.com') || /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url)) {
        return url;
    }
    // Tenta capturar o ID do Imgur em links de página ou galeria
    const match = url.match(/imgur\.com\/(?:gallery\/|a\/)?([a-zA-Z0-9]+)/);
    if (match) {
        return `https://i.imgur.com/${match[1]}.jpg`;
    }
    return url;
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
    document.getElementById('editEndereco').value = user.endereco || '';
    document.getElementById('editCidade').value   = user.cidade   || '';
    document.getElementById('editEstado').value   = user.estado   || '';
    document.getElementById('editPagamento').value = user.pagamento || 'pix';

    const linkInput = document.getElementById('editAvatarLink');
    if (linkInput) {
        const avatarLinks = safeParseImages(user.avatar);
        linkInput.value = avatarLinks.length > 0 ? avatarLinks[0] : '';
    }

    const preview = document.getElementById('profilePreview');
    if (preview) {
        preview.src = user.avatar?.startsWith('http') ? user.avatar : 'https://via.placeholder.com/100';
    }

    bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('profileEditOffcanvas')).show();
};

window.showAuthScreen = function(mode = 'login', autoCloseMenu = true) {
  const overlay = document.getElementById('authScreen');
  if (!overlay) return;
  overlay.classList.remove('d-none');
  window.toggleAuthMode(mode);
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
};

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
            senha_hash: btoa(document.getElementById('v2CadPass').value),
            endereco: `${document.getElementById('v2CadEnd').value}, ${document.getElementById('v2CadNum').value} - ${document.getElementById('v2CadBairro').value}`,
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
            showToast('Erro no cadastro. Email/CPF já cadastrado?', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = orig; }
        }
    }

    if (e.target.id === 'loginFormAnimV2') {
        e.preventDefault();
        const btn  = e.target.querySelector('button[type="submit"]');
        const orig = btn?.textContent;
        if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }

        const email = document.getElementById('v2LogEmail').value;
        const hash  = btoa(document.getElementById('v2LogPass').value);

        try {
            const users = await supabaseFetch(`users?select=*&email=eq.${email}&senha_hash=eq.${hash}&limit=1`);
            if (users?.length) {
                localStorage.setItem('electroUser', JSON.stringify(users[0]));
                window.hideAuthScreen();
                
                await createPersistentNotification(`Novo acesso detectado em sua conta.`, 'info', users[0].id);
                setTimeout(() => location.reload(), 400);
            } else {
                showToast('Email ou senha incorretos.', 'error');
            }
        } catch { showToast('Erro de conexão.', 'error'); }
        finally {
            if (btn) { btn.disabled = false; btn.textContent = orig; }
        }
    }
});

// ============================================
// FAVORITOS E HISTÓRICO
// ============================================

window.renderLikedProducts = () => {
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    document.getElementById('gridTitle').textContent = 'Seus Favoritos';
    renderGrid(allProductsCache.filter(p => likedProducts.includes(p.id)));
    window.closeMobileMenu();
};

window.renderAccessHistory = () => {
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

window.renderOrderManagement = async function(type = 'buyer') {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }

    const grid  = document.getElementById('productsGrid');
    const hero  = document.getElementById('heroSection');
    const title = document.getElementById('gridTitle');
    if (hero) hero.classList.add('d-none');

    grid.style.display = 'block';
    grid.classList.add('order-view-active');
    grid.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2">Carregando pedidos...</p></div>';

    try {
        let path = 'orders?select=*';
        if (type === 'buyer') {
            path += `&buyer_id=eq.${user.id}`;
            if (title) title.textContent = 'Minhas Compras';
        } else {
            path += `&seller_id=eq.${user.id}`;
            if (title) title.textContent = type === 'seller_requests' ? 'Solicitações Pendentes' : 'Minhas Vendas';
        }

        let orders = await supabaseFetch(path);
        ordersCache = orders;

        if (type === 'seller_requests') orders = orders.filter(o => o.status === 'pending');
        else if (type === 'seller_sales') orders = orders.filter(o => o.status !== 'pending');

        if (!orders.length) {
            grid.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="bi bi-inbox fs-1 text-muted d-block mb-3"></i>
                    <h5>Nenhum pedido encontrado.</h5>
                </div>`;
            return;
        }

        grid.innerHTML = orders.map(order => {
            const st        = ORDER_STATUS_MAP[order.status] || { text: order.status, class: 'bg-secondary' };
            const isPending = order.status === 'pending';
            const isBuyer   = user.id === order.buyer_id;
            const isSeller  = user.id === order.seller_id;

            return `
            <div class="col-12 col-xl-10 mx-auto mb-3">
                <div class="card p-3 shadow-sm border-0" style="border-radius:14px;">
                    <div class="d-flex flex-column flex-md-row gap-3 align-items-center align-items-md-start">
                        <img src="${order.product_img || ''}" class="rounded border"
                             style="width:90px;height:90px;object-fit:cover;"
                             onerror="this.src='https://placehold.co/90'">

                        <div class="flex-grow-1 w-100">
                            <div class="d-flex justify-content-between align-items-start mb-2">
                                <div>
                                    <h6 class="fw-bold mb-1">${order.product_title}</h6>
                                    <p class="text-muted mb-0" style="font-size:0.78rem;">
                                        ${isBuyer ? `Vendedor: ${order.seller_name}` : `Comprador: ${order.buyer_name}`}<br>
                                        ID: #${order.id.slice(-8).toUpperCase()}
                                    </p>
                                </div>
                                <span class="badge ${st.class} py-2 px-3 rounded-pill" style="font-size:0.7rem;">${st.text}</span>
                            </div>

                            <p class="fw-bold mb-3" style="font-size:0.92rem;">
                                R$ ${parseFloat(order.total).toLocaleString('pt-BR')}
                                <span class="text-muted fw-normal" style="font-size:0.78rem;">(${order.quantity} un.)</span>
                            </p>

                            <div class="d-flex flex-wrap gap-2 justify-content-end">
                                ${isPending && type === 'seller_requests' ? `
                                    <button class="btn btn-sm btn-success px-4 fw-bold rounded-pill" onclick="window.updateOrderStatus('${order.id}', 'accepted')">
                                        <i class="bi bi-check-lg me-1"></i>Aceitar
                                    </button>
                                    <button class="btn btn-sm btn-outline-danger px-4 rounded-pill" onclick="window.updateOrderStatus('${order.id}', 'cancelled')">
                                        Recusar
                                    </button>
                                ` : ''}
                                ${isPending && type === 'buyer' ? `
                                    <button class="btn btn-sm btn-outline-danger px-3 rounded-pill" onclick="window.cancelOrderBuyer('${order.id}')">
                                        Cancelar Pedido
                                    </button>
                                ` : ''}
                                
                                ${!isPending && order.status !== 'cancelled' ? `
                                    <button class="btn btn-sm btn-primary px-4 fw-bold rounded-pill" onclick="window.showChat('${order.id}')">
                                        <i class="bi bi-chat-dots me-1"></i>Abrir Chat
                                    </button>
                                ` : ''}
                                
                                ${isPending && isSeller && type === 'seller_sales' ? `<span class="badge bg-warning text-dark mt-1">⏳ Aguardando sua aprovação</span>` : ''}
                                
                                ${(order.status === 'cancelled' || order.status === 'finished') ? `
                                    <button class="btn btn-sm btn-outline-secondary px-3 rounded-pill" onclick="window.removeOrderFromHistory('${order.id}', '${type}')">
                                        <i class="bi bi-trash me-1"></i>Remover do Histórico
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');

        window.closeMobileMenu();
    } catch (e) {
        grid.innerHTML = '<div class="col-12 text-center py-5"><h5>Erro ao carregar pedidos.</h5></div>';
    }
};

window.updateOrderStatus = async function(orderId, newStatus) {
    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus, updated_at: new Date().toISOString() })
        });
        showToast(`Pedido ${newStatus === 'accepted' ? 'aceito' : 'recusado'}!`, newStatus === 'accepted' ? 'success' : 'info');
        window.renderOrderManagement(newStatus === 'accepted' ? 'seller_sales' : 'seller_requests');
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
        bootstrap.Modal.getInstance(document.getElementById('productDetailModal'))?.hide();
        loadPage();
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

    currentChat = orderId;

    const otherName = user.id === order.buyer_id ? order.seller_name : order.buyer_name;
    document.getElementById('chatPartnerNameHeader').textContent = otherName || 'Chat';
    document.getElementById('chatPartnerAvatar').src =
        `https://ui-avatars.com/api/?name=${encodeURIComponent(otherName || 'User')}&background=random&size=40`;

    // Popula resumo do produto
    document.getElementById('chatProdImg').src = order.product_img || 'https://placehold.co/45?text=📦';
    document.getElementById('chatProdTitle').textContent = order.product_title || 'Produto';
    document.getElementById('chatProdPrice').textContent = `R$ ${parseFloat(order.total).toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
    document.getElementById('chatOrderIdDisplay').textContent = `#${order.id.slice(-6).toUpperCase()}`;
    document.getElementById('chatOrderIdDisplayHeader').textContent = `#${order.id.slice(-6).toUpperCase()}`;

    new bootstrap.Modal(document.getElementById('chatModal')).show();
    await loadChatMessages(orderId);
    setupPullToRefresh();
};

async function loadChatMessages(orderId) {
    const container = document.getElementById('chatMessagesContainer');
    container.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div><p class="small mt-2">Carregando mensagens...</p></div>';

    try {
        const user = getSavedUser();
        let order  = ordersCache.find(o => o.id === orderId);
        if (!order) {
            const r = await supabaseFetch(`orders?id=eq.${orderId}&limit=1`);
            order   = r?.[0];
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
                    text:      `🛒 Pedido #${orderId.slice(-8).toUpperCase()}`,
                    timestamp: new Date().toISOString(),
                    type:      'system'
                }],
                logistics_agreed: false
            };
            await supabaseFetch('chats', { method: 'POST', body: JSON.stringify(newChat) });
            chat = newChat;
        }

        if (!chat?.messages) {
            container.innerHTML = '<div class="text-center py-4 text-muted">Nenhuma mensagem ainda.</div>';
            return;
        }

        container.innerHTML = chat.messages.map((msg, index) => {
            if (msg.type === 'system' || msg.senderId === 'system') {
                return `<div class="text-center my-3">
                    <span class="badge bg-light text-dark border px-3 py-2" style="font-size:0.72rem;">${msg.text}</span>
                </div>`;
            }

            const isMe = msg.senderId === user.id;
            const replyHtml = msg.replyTo ? `
                <div class="p-2 mb-2 rounded ${isMe ? 'bg-white bg-opacity-25' : 'bg-secondary bg-opacity-10'} small border-start border-4 border-info">
                    <div class="fw-bold" style="font-size: 0.7rem;">${msg.replyTo.senderName}</div>
                    <div class="text-truncate" style="max-height: 20px;">${msg.replyTo.text}</div>
                </div>
            ` : '';

            return `
            <div class="d-flex ${isMe ? 'justify-content-end' : 'justify-content-start'} mb-3">
                <div class="p-3 rounded shadow-sm position-relative ${isMe ? 'bg-primary text-white' : 'bg-light'}"
                     style="min-width: 100px; max-width:75%; word-break:break-word; border-radius:${isMe?'18px 18px 2px 18px':'18px 18px 18px 2px'}!important;">
                    
                    <div class="d-flex justify-content-between align-items-center mb-1 gap-2">
                        <small class="fw-bold" style="font-size: 0.65rem; opacity: 0.8;">${isMe ? 'Você' : (msg.senderName || 'Usuário')}</small>
                        <div class="dropdown">
                            <i class="bi bi-chevron-down cursor-pointer opacity-50" data-bs-toggle="dropdown" style="font-size: 0.8rem;"></i>
                            <ul class="dropdown-menu dropdown-menu-end shadow-sm">
                                <li><a class="dropdown-item py-1 small" href="javascript:void(0)" onclick="window.startReply(${index})"><i class="bi bi-reply me-2"></i>Responder</a></li>
                                ${isMe ? `<li><a class="dropdown-item py-1 small" href="javascript:void(0)" onclick="window.startEdit(${index})"><i class="bi bi-pencil me-2"></i>Editar</a></li>` : ''}
                            </ul>
                        </div>
                    </div>

                    ${replyHtml}

                    ${msg.image ? `
                        <img src="${msg.image}" class="img-fluid rounded mb-2"
                             style="max-width:220px;cursor:pointer;"
                             onclick="window.openImageFull('${msg.image}')">
                    ` : ''}
                    <div style="white-space:pre-wrap;">${formatLinks(msg.text)}</div>
                    <div style="font-size:0.62rem;" class="text-end mt-1 d-flex justify-content-end gap-1 ${isMe?'text-white-50':'text-muted'}">
                        ${msg.edited ? '<span>(editada)</span>' : ''}
                        ${new Date(msg.timestamp).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}
                    </div>
                </div>
            </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;
        updateChatLogistics(order, user);

    } catch (e) {
        console.error(e);
        container.innerHTML = `
            <div class="text-center py-4 text-danger">
                <i class="bi bi-exclamation-triangle fs-1 d-block mb-2"></i>
                <p>Erro ao carregar mensagens</p>
                <button class="btn btn-primary btn-sm" onclick="loadChatMessages('${orderId}')">Tentar novamente</button>
            </div>`;
    }
}

function formatLinks(text) {
    if (!text) return '';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, url =>
        `<a href="${url}" target="_blank" class="text-info text-decoration-underline small">🔗 ${url.substring(0,40)}${url.length>40?'...':''}</a>`
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
                    buttonsHtml += `<button class="btn btn-primary w-100 rounded-pill fw-bold mb-2" onclick="window.advanceLogisticsStatus('${order.id}','awaiting_pickup')">✅ Marcar como Pronto p/ Retirada</button>`;
                } else {
                    buttonsHtml += `<button class="btn btn-primary w-100 rounded-pill fw-bold mb-2" onclick="window.advanceLogisticsStatus('${order.id}','shipping')">🚚 Marcar que Saiu p/ Entrega</button>`;
                }
            } else {
                buttonsHtml += `<div class="alert alert-success rounded-pill text-center small mb-2">🤝 Aguardando envio/retirada pelo vendedor</div>`;
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
                    <div class="d-grid gap-2 mb-2">
                        <button class="btn btn-outline-primary rounded-pill" onclick="window.setLogistics('${order.id}','pickup')">🏪 Retirada no Local</button>
                        <button class="btn btn-outline-success rounded-pill" onclick="window.setLogistics('${order.id}','seller_delivery')">🚚 Entrega pelo Vendedor</button>
                        <button class="btn btn-outline-warning rounded-pill" onclick="window.setLogistics('${order.id}','external_app')">📱 App de Entrega</button>
                    </div>`;
            }
        } else {
            buttonsHtml += `<div class="alert alert-info rounded-pill text-center small mb-2">⏳ Proposta enviada! Aguardando o outro lado...</div>`;
        }
    } else if (['shipping', 'awaiting_pickup'].includes(order.status)) {
        if (isBuyer) {
            buttonsHtml += `<button class="btn btn-success w-100 rounded-pill fw-bold mb-2" onclick="window.confirmReceipt('${order.id}')">🎁 Confirmar Recebimento</button>`;
        } else {
            buttonsHtml += `<div class="alert alert-primary rounded-pill text-center small mb-2">Aguardando o comprador confirmar recebimento</div>`;
        }
    }

    // Opção de Cancelar sempre presente se não finalizado
    if (order.status !== 'finished' && order.status !== 'cancelled') {
        buttonsHtml += `
            <hr class="my-2">
            <button class="btn btn-outline-danger w-100 rounded-pill" onclick="window.chatCancelOrder('${order.id}')">
                <i class="bi bi-x-circle me-1"></i>Cancelar Pedido
            </button>`;
    }

    logisticsButtons.innerHTML = buttonsHtml;

    const statusBar = document.getElementById('orderStatusBar');
    if (statusBar && order) {
        const statusMap = {
            'pending':         '⏳ Aguardando Aprovação',
            'accepted':        '✅ Aprovado - Combinar Entrega',
            'agreement':       '🤝 Definindo Logística',
            'shipping':        '📦 Em Transporte',
            'awaiting_pickup': '📍 Aguardando Retirada',
            'finished':        '🎉 Finalizado',
            'cancelled':       '❌ Cancelado',
            'dispute':         '⚠️ Em Disputa'
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

window.sendChatImage = async function() {
    const rawUrl = prompt("Dica: Use o botão 'Upload' para subir no Imgur e cole o link direto da imagem aqui:");
    if (!rawUrl || !rawUrl.startsWith('http')) {
        if (rawUrl) showToast("Link de imagem inválido!", "warning");
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
            text: '📷 Imagem', image: url,
            timestamp: new Date().toISOString(), type: 'image'
        });
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        await loadChatMessages(currentChat);
    } catch (e) { showToast('Erro ao processar o envio do link da imagem.', 'error'); }
};

window.sendChatFile = async function() {
    const url = prompt("Cole o link do arquivo ou documento (Hospedado no Google Drive, Dropbox, etc):");
    if (!url || !url.startsWith('http')) {
        if (url) showToast("Link inválido!", "warning");
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
            text: `📎 Arquivo: ${url.split('/').pop()}`,
            file: { name: 'Arquivo Externo', url: url, size: 0 },
            timestamp: new Date().toISOString(), type: 'file'
        });
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        await loadChatMessages(currentChat);
    } catch { showToast('Erro ao enviar arquivo.', 'error'); }
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
                text: '❌ O pedido foi cancelado por uma das partes.',
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
            const text = nextStatus === 'shipping' ? '🚚 O vendedor colocou o pedido em rota de entrega!' : '📍 O pedido está aguardando retirada no local!';
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
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'finished', updated_at: new Date().toISOString() })
        });
        
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = chatData[0];
        if (chat) {
            chat.messages.push({ senderId: 'system', text: '🎉 O comprador confirmou o recebimento. Compra finalizada!', timestamp: new Date().toISOString(), type: 'system' });
            await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        }
        showToast('Pedido finalizado!', 'success');
        loadChatMessages(orderId);
    } catch { showToast('Erro ao confirmar recebimento.', 'error'); }
};

// ============================================
// PAINEL DO VENDEDOR
// ============================================

window.renderSellerPanel = async function() {
    const user = getSavedUser();
    if (!user)                                           { showToast('Faça login!', 'warning'); return; }
    if (user.tipo !== 'VENDEDOR' && user.tipo !== 'ADMIN') { showToast('Acesso restrito a vendedores!', 'warning'); return; }

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

    document.getElementById('gridTitle').textContent = 'Painel Administrativo';
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');

    const grid = document.getElementById('productsGrid');
    grid.style.display = 'block';
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
                                        <img src="${u.avatar || 'https://ui-avatars.com/api/?name='+encodeURIComponent(u.nome)}" class="rounded-circle border" width="45" height="45" style="object-fit:cover;">
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
                                            <small class="text-muted">Loja: ${p.loja} • R$ ${parseFloat(p.preco).toLocaleString('pt-BR')}</small>
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
    const map = {
        'eletronicos':            0,
        'renderLikedProducts':    1,
        'renderOrderManagement':  2,
        'cartOffcanvas':          3,
        'mobileMenu':             4
    };
    const idx = map[page];
    if (idx !== undefined) {
        const items = document.querySelectorAll('.mobile-nav-row .nav-item');
        if (items[idx]) items[idx].classList.add('active');
    }
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
    alert('Funcionalidade de Checkout Global em desenvolvimento. Por enquanto, utilize o botão "Comprar" em cada item.');
};
