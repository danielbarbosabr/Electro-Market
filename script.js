// ============================================
// ELECTROMARKET - VERSÃO QUE FUNCIONA
// ============================================
const SUPABASE_URL = 'https://pjisiqvaulgoikaitmaj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqaXNpcXZhdWxnb2lrYWl0bWFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNjI5ODAsImV4cCI6MjA5MjYzODk4MH0.vq69kmmYdr2aBePlxwVcO3QhUtbp5dtx-pZxRXgEkV8';

let allProductsCache = [];
let cart = JSON.parse(localStorage.getItem('electroCart')) || [];
let likedProducts = JSON.parse(localStorage.getItem('electroLiked')) || [];
let accessHistory = JSON.parse(localStorage.getItem('electroHistory')) || [];
let currentChat = null;
let currentReplyIndex = null; // Para responder mensagens
let editingMessageIndex = null; // Para editar mensagens
let ordersCache = []; // Cache de pedidos para acesso rápido
let chatsCache = []; // Cache de chats para acesso rápido

// Mapeamento de status de pedidos para exibição
const ORDER_STATUS_MAP = {
    'pending':         { text: 'Em Aprovação',             class: 'bg-warning text-dark' },
    'accepted':        { text: 'Aprovado (Chat Liberado)', class: 'bg-success' },
    'agreement':       { text: 'Aguardando Logística',     class: 'bg-info' },
    'shipping':        { text: 'Em Rota de Entrega',       class: 'bg-primary' },
    'awaiting_pickup': { text: 'Aguardando Retirada',      class: 'bg-primary' },
    'finished':        { text: 'Finalizado',               class: 'bg-dark' },
    'cancelled':       { text: 'Cancelado',                class: 'bg-danger' },
    'dispute':         { text: 'Em Disputa',               class: 'bg-danger' }
};

// Função fetch direta
async function supabaseFetch(path, options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...options,
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    if (!res.ok) throw await res.json().catch(() => ({ message: 'Erro' }));
    if (options.method === 'DELETE' || res.status === 204) return true; // 204 No Content para DELETE/PATCH sem retorno
    const text = await res.text();
    return text ? JSON.parse(text) : [];
}

// Carregar produtos
async function loadPage(query = 'eletronicos') {
    const grid = document.getElementById('productsGrid');
    grid.innerHTML = `<div class="col-12 text-center py-5"><div class="spinner-border" style="color:#131673;"></div><h5>Carregando...</h5></div>`;

    try {
        const user = getSavedUser();
        const role = user?.tipo || 'CLIENTE';
        const hero = document.getElementById('heroSection');
        let path = 'products?select=*';

        // Exibe o banner apenas se for a página inicial ('eletronicos') e o usuário não for Vendedor
        if (hero) {
            hero.classList.toggle('d-none', role === 'VENDEDOR' || query !== 'eletronicos');
        }
        
        // REGRA CRÍTICA: Se for vendedor, filtra apenas os produtos dele em qualquer navegação
        if (user && user.tipo === 'VENDEDOR') {
            path += `&vendedor_id=eq.${user.id}`;
        }

        const data = await supabaseFetch(path);
        allProductsCache = data || [];
        
        let products = allProductsCache;
        if (query !== 'eletronicos' && query !== '') {
            const term = query.toLowerCase();
            if (term === 'ofertas') {
                // Filtra produtos que tenham preço original maior que o preço atual
                products = products.filter(p => (p.preco_original || 0) > p.preco);
                document.getElementById('gridTitle').textContent = 'Ofertas Imperdíveis';
            } else {
                products = products.filter(p => 
                    (p.titulo || '').toLowerCase().includes(term) ||
                    (p.categoria || '').toLowerCase().includes(term)
                );
                document.getElementById('gridTitle').textContent = `Resultados para "${query}"`;
            }
        } else {
            document.getElementById('gridTitle').textContent = 'Recomendados para você';
        }
        
        renderGrid(products);
        updateStoreFilterUI();
        console.log('✅', products.length, 'produtos carregados');
    } catch (e) {
        console.error(e);
        grid.innerHTML = `<div class="col-12 text-center py-5"><h5>Erro ao carregar</h5><button class="btn btn-primary mt-3" onclick="loadPage()">Tentar</button></div>`;
    }
}

function renderCard(item) {
    if (!item?.titulo) return '';
    const preco = item.preco || 0;
    const pid = item.id;
    const isLiked = likedProducts.includes(pid);
    
    // Puxa a informação de entrega do banco de dados
    const realizaEntrega = !!(item.realizaentrega ?? item.realizaEntrega ?? true);
    
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
            <div class="product-card-img-container d-flex align-items-center justify-content-center bg-light" style="height:200px;">
                ${item.img 
                    ? `<img src="${item.img}" alt="${item.titulo}" style="max-width:100%;max-height:100%;object-fit:contain" onerror="this.parentElement.innerHTML='<i class=\\'bi bi-box-seam text-secondary\\' style=\\'font-size: 3rem;\\'></i>'">`
                    : `<i class="bi bi-box-seam text-secondary" style="font-size: 3rem;"></i>`
                }
            </div>
            <div class="card-body product-card-body">
                <h6 class="product-title-grid">${item.titulo}</h6>
                <h3 class="current-price">
                    ${item.preco_original && item.preco_original > preco 
                        ? `<small class="text-muted text-decoration-line-through d-block" style="font-size: 0.85rem; font-weight: normal;">
                            R$ ${item.preco_original.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                           </small>` 
                        : ''
                    }
                    ${preco === 0 
                        ? '<span class="text-success">GRÁTIS</span>' 
                        : `R$ ${Math.floor(preco).toLocaleString('pt-BR')}<small>${((preco % 1).toFixed(2)).substring(1)}</small>`
                    }
                </h3>
                
                <div class="shipping-info-grid ${realizaEntrega ? 'text-success' : 'text-muted'} small fw-bold mb-2">
                    <i class="bi ${realizaEntrega ? 'bi-truck' : 'bi-geo-alt'}"></i>
                    ${realizaEntrega ? 'Entrega disponível' : 'Retirada no local'}
                </div>

                <small class="text-muted">${item.loja || 'Vendedor'}</small>
            </div>
        </div>`;
}

function renderGrid(products) {
    const grid = document.getElementById('productsGrid');
    if (!products?.length) {
        grid.innerHTML = '<div class="col-12 text-center py-5"><h5>Nenhum produto encontrado</h5></div>';
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
            <label class="form-check-label">${store}</label>
        </div>`).join('');
}

function applyFilters() {
    const min = parseFloat(document.getElementById('minPrice')?.value) || 0;
    const max = parseFloat(document.getElementById('maxPrice')?.value) || Infinity;
    const sort = document.getElementById('sortOrder')?.value;
    const stores = Array.from(document.querySelectorAll('.store-checkbox:checked')).map(cb => cb.value);
    
    let filtered = allProductsCache.filter(p => 
        p.preco >= min && p.preco <= max && 
        (!stores.length || stores.includes(p.loja))
    );
    
    if (sort === 'priceAsc') filtered.sort((a, b) => a.preco - b.preco);
    if (sort === 'priceDesc') filtered.sort((a, b) => b.preco - a.preco);
    
    renderGrid(filtered);
}

function clearFilters() {
    ['minPrice', 'maxPrice'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const s = document.getElementById('sortOrder'); if (s) s.value = 'default';
    document.querySelectorAll('.store-checkbox').forEach(cb => cb.checked = true);
    renderGrid(allProductsCache);
}

// Detalhe do produto
window.showDetail = async function(pid) {
    const item = allProductsCache.find(x => x.id == pid || x.id === pid);
    if (!item) return;
    
    const user = getSavedUser();
    const isOwner = user && item.vendedor_id === user.id;

    // Registrar no histórico de acessos
    accessHistory = accessHistory.filter(id => id != pid); // Remove duplicata antiga
    accessHistory.unshift(pid); // Adiciona no topo
    if (accessHistory.length > 20) accessHistory.pop(); // Mantém os últimos 20
    localStorage.setItem('electroHistory', JSON.stringify(accessHistory));

    // Preenche o formulário de edição caso o dono queira editar
    if (isOwner) {
        document.getElementById('prodTitle').value = item.titulo;
        document.getElementById('prodDescription').value = item.descricao;
        document.getElementById('prodPrice').value = item.preco;
        document.getElementById('prodQuantity').value = item.quantidade;
        document.getElementById('prodCategory').value = item.categoria;
        document.getElementById('prodImage').value = item.img || '';
        document.getElementById('prodDelivery').checked = !!(item.realiza_entrega ?? item.realizaEntrega ?? item.realizaentrega ?? true);
        // Armazena o ID no formulário para saber que é uma edição
        document.getElementById('announceForm').dataset.editingId = item.id;

        // Ajusta textos do Modal para o modo de edição
        const modalTitle = document.querySelector('#announceModal .modal-title');
        const submitBtn = document.querySelector('#announceForm button[type="submit"]');
        if (modalTitle) modalTitle.textContent = 'Editar Anúncio';
        if (submitBtn) submitBtn.textContent = 'Salvar Alterações';
    }

    // Garante que o modal de detalhes do produto seja fechado antes de abrir o de anúncio
    const productDetailModal = bootstrap.Modal.getInstance(document.getElementById('productDetailModal'));
    if (productDetailModal) {
        productDetailModal.hide();
    }

    // Busca o endereço do vendedor no banco de dados para mostrar na retirada
    let sellerAddress = 'A combinar com o vendedor';
    try {
        const sellerInfo = await supabaseFetch(`users?select=endereco,cidade,estado&id=eq.${item.vendedor_id}`);
        if (sellerInfo?.length > 0) {
            const s = sellerInfo[0];
            sellerAddress = `${s.endereco || 'Endereço não informado'}, ${s.cidade || ''} - ${s.estado || ''}`;
        }
    } catch (e) {
        console.error('Erro ao buscar endereço do vendedor:', e);
    }

    // Verifica se o vendedor realiza entrega (padrão é true caso o campo não exista)
    const realizaEntrega = !!(item.realiza_entrega ?? item.realizaEntrega ?? item.realizaentrega ?? true);

    // Cálculo de reputação do vendedor
    const sellerProducts = allProductsCache.filter(p => p.vendedor_id === item.vendedor_id);
    const totalLikes = sellerProducts.reduce((acc, p) => acc + (p.likes || 0), 0);
    
    // Define o nível da barra (1 a 5) baseado nas curtidas totais
    const level = totalLikes > 50 ? 5 : totalLikes > 20 ? 4 : totalLikes > 10 ? 3 : totalLikes > 2 ? 2 : 1;
    
    // Cores do Mercado Livre
    const colors = ['#F23D35', '#FF8900', '#FFE600', '#ADE07E', '#00A650'];
    
    document.getElementById('productDetailContent').innerHTML = `
        <div class="row g-0 g-md-4">
            <div class="col-md-7 border-end pe-md-4">
                <div class="text-center mb-4 bg-light rounded p-3 d-flex align-items-center justify-content-center" style="min-height:300px;">
                    ${item.img 
                        ? `<img src="${item.img}" class="img-fluid" style="max-height:400px;object-fit:contain" onerror="this.parentElement.innerHTML='<i class=\\'bi bi-box-seam text-secondary\\' style=\\'font-size: 5rem;\\'></i>'">`
                        : `<i class="bi bi-box-seam text-secondary" style="font-size: 5rem;"></i>`
                    }
                </div>
                <div class="d-none d-md-block">
                    <h4>Descrição</h4>
                    <p class="text-muted">${item.descricao || 'Sem descrição detalhada.'}</p>
                </div>
            </div>
            <div class="col-md-5">
                <span class="badge bg-secondary mb-2">${item.categoria || 'Geral'}</span>
                <h3 class="fw-bold">${item.titulo}</h3>
                
                <div class="my-4">
                    ${item.preco === 0 
                        ? `<span class="fs-1 fw-bold text-success">GRÁTIS</span>` 
                        : `<span class="fs-1 fw-bold">R$ ${Math.floor(item.preco || 0).toLocaleString('pt-BR')}</span>
                           <span class="fs-5">${((item.preco % 1).toFixed(2)).substring(1)}</span>`
                    }
                </div>
                
                <div class="card bg-light border-0 p-3 mb-3">
                    ${realizaEntrega ? `
                        <p class="mb-1 text-success fw-bold"><i class="bi bi-truck me-2"></i> Entrega disponível</p>
                        <small class="text-muted">Frete calculado no carrinho</small>
                    ` : `
                        <p class="mb-1 text-warning fw-bold"><i class="bi bi-geo-alt me-2"></i> Retirada no local</p>
                        <small class="text-muted"><strong class="text-dark">Local de retirada:</strong> ${sellerAddress}</small>
                    `}
                </div>
                
                <div class="seller-reputation-ml mb-4">
                    <p class="small mb-1 fw-bold text-muted">Avaliação do vendedor</p>
                    <div class="reputation-bar d-flex gap-1 mb-2" style="height: 8px;">
                        <div class="flex-grow-1 rounded-start" style="background-color: ${level >= 1 ? colors[0] : '#eee'}"></div>
                        <div class="flex-grow-1" style="background-color: ${level >= 2 ? colors[1] : '#eee'}"></div>
                        <div class="flex-grow-1" style="background-color: ${level >= 3 ? colors[2] : '#eee'}"></div>
                        <div class="flex-grow-1" style="background-color: ${level >= 4 ? colors[3] : '#eee'}"></div>
                        <div class="flex-grow-1 rounded-end" style="background-color: ${level >= 5 ? colors[4] : '#eee'}"></div>
                    </div>
                </div>

                <p><strong>Vendido por:</strong> ${item.loja || 'Vendedor'}</p>
                <p><strong>Estoque:</strong> ${item.quantidade || 1} unidades</p>
                
                ${isOwner ? `
                    <button class="btn btn-primary btn-lg w-100 mb-2" onclick="window.prepareEditProduct('${item.id}')">
                        <i class="bi bi-pencil me-2"></i>Editar Anúncio
                    </button>
                    <button class="btn btn-danger w-100" onclick="window.deleteProduct('${item.id}')">
                        <i class="bi bi-trash me-2"></i>Excluir
                    </button>
                ` : `
                    <button class="btn btn-primary btn-lg w-100 mb-2" onclick="window.addToCart('${pid}');window.buyItem(cart.length-1);bootstrap.Modal.getInstance(document.getElementById('productDetailModal')).hide();">
                        <i class="bi bi-lightning me-2"></i>Solicitar Compra
                    </button>
                    <button class="btn btn-success w-100" onclick="window.addToCart('${pid}');bootstrap.Modal.getInstance(document.getElementById('productDetailModal')).hide();">
                        <i class="bi bi-cart-plus me-2"></i>Adicionar ao Carrinho
                    </button>
                `}
                <button class="btn btn-link text-decoration-none w-100 text-secondary fw-bold small mt-3" onclick="window.shareProduct('${pid}')">
                    <i class="bi bi-share me-2"></i>Compartilhar
                </button>
            </div>
        </div>`;
    
    new bootstrap.Modal(document.getElementById('productDetailModal')).show();
};

// Função para preparar o modal de edição
window.prepareEditProduct = function(pid) {
    // A lógica de preenchimento já está em showDetail, só precisamos abrir o modal
    new bootstrap.Modal(document.getElementById('announceModal')).show();
};
// Login/Cadastro
function getSavedUser() {
    try { return JSON.parse(localStorage.getItem('electroUser')) || null; }
    catch { return null; }
}

function updateUI() {
    const user = getSavedUser();
    const logged = !!user;
    const role = user?.tipo || 'CLIENTE';

    document.querySelectorAll('.role-guest').forEach(el => el.classList.toggle('d-none', logged));
    document.querySelectorAll('.role-logged-in').forEach(el => el.classList.toggle('d-none', !logged));
    
    // Visibilidade baseada em Cargo
    document.querySelectorAll('.role-client').forEach(el => el.classList.toggle('d-none', role === 'VENDEDOR'));
    document.querySelectorAll('.role-seller').forEach(el => el.classList.toggle('d-none', role !== 'VENDEDOR' && role !== 'ADMIN'));
    document.querySelectorAll('.role-admin').forEach(el => el.classList.toggle('d-none', role !== 'ADMIN'));

    // Oculta o banner principal se for Vendedor (Regra: banner apenas no Início do Cliente)
    const heroSection = document.getElementById('heroSection');
    if (heroSection) heroSection.classList.toggle('d-none', role === 'VENDEDOR');

    if (logged && user.nome) {
        const navName = document.getElementById('navUserName');
        if (navName) navName.textContent = user.nome.split(' ')[0];
        const mobileName = document.getElementById('mobileWelcomeName');
        if (mobileName) mobileName.textContent = `Olá, ${user.nome.split(' ')[0]}`;

        // Atualiza a foto/ícone no botão do menu mobile (antigos 3 pontos)
        const mobileTrigger = document.getElementById('mobileUserTrigger');
        if (mobileTrigger) {
            if (user.avatar && user.avatar.startsWith('http')) {
                mobileTrigger.innerHTML = `<img src="${user.avatar}" style="width: 100%; height: 100%; object-fit: cover;">`;
            } else {
                mobileTrigger.innerHTML = `<i class="bi bi-person-circle fs-3 text-white"></i>`;
            }
        }
    }
    else {
        // Se deslogado, volta para o ícone padrão
        const mobileTrigger = document.getElementById('mobileUserTrigger');
        if (mobileTrigger) {
            mobileTrigger.innerHTML = `<i class="bi bi-person-circle fs-3 text-white"></i>`;
        }
    }

    updateCartBadge();
}

function updateCartBadge() {
    const count = cart.reduce((a, i) => a + (i.qtd || 1), 0);
    document.querySelectorAll('#cartBadgeDesktop, #cartBadgeMobile').forEach(el => {
        if (el) { el.textContent = count; el.classList.toggle('d-none', count === 0); }
    });
}

// Carrinho
function renderCart() {
    const list = document.getElementById('cartItemsList');
    const totalEl = document.getElementById('cartTotalValue');
    if (!list) return;
    
    if (!cart.length) {
        list.innerHTML = '<div class="text-center py-5 text-muted"><i class="bi bi-cart-x fs-1 d-block mb-3"></i>Carrinho vazio</div>';
        if (totalEl) totalEl.textContent = 'R$ 0,00';
        updateCartBadge();
        return;
    }
    
    let total = 0;
    list.innerHTML = cart.map((item, i) => {
        total += (item.preco || 0) * (item.qtd || 1);
        return `
        <div class="cart-item border rounded p-2 mb-2">
            <div class="d-flex gap-2 align-items-center">
                <img src="${item.img || 'https://placehold.co/60'}" style="width:50px;height:50px;object-fit:contain">
                <div class="flex-grow-1">
                    <div class="small fw-bold">${item.titulo}</div>
                    <div class="text-success fw-bold">R$ ${(item.preco || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
                    <div class="d-flex align-items-center gap-2 mt-1">
                        <button class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="window.updateCartQty(${i}, -1)">-</button>
                        <span class="small fw-bold">${item.qtd || 1}</span>
                        <button class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="window.updateCartQty(${i}, 1)">+</button>
                    </div>
                </div>
            </div>
            <div class="d-flex gap-1 mt-1">
                <button class="btn btn-sm btn-outline-danger flex-grow-1" onclick="removeFromCart(${i})"><i class="bi bi-trash"></i></button>
                <button class="btn btn-sm btn-success flex-grow-1" onclick="buyItem(${i})">Comprar</button>
            </div>
        </div>`;
    }).join('');
    
    if (totalEl) totalEl.textContent = `R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    updateCartBadge();
    localStorage.setItem('electroCart', JSON.stringify(cart));
}

window.addToCart = function(productId) {
    const p = allProductsCache.find(x => x.id === productId);
    if (!p) return;
    const exist = cart.find(i => i.id === productId);
    exist ? exist.qtd++ : cart.push({ ...p, qtd: 1 });
    renderCart();
    bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('cartOffcanvas')).show();
};

window.removeFromCart = function(i) { cart.splice(i, 1); renderCart(); };

window.updateCartQty = function(i, delta) {
    const item = cart[i];
    if (!item) return;
    const newQty = (item.qtd || 1) + delta;
    if (newQty < 1) {
        window.removeFromCart(i);
    } else {
        item.qtd = newQty;
        renderCart();
    }
};

window.toggleLike = async function(pid) {
    const idx = likedProducts.indexOf(pid);
    const product = allProductsCache.find(p => p.id == pid);
    if (!product) return;

    if (idx > -1) {
        likedProducts.splice(idx, 1);
        product.likes = Math.max(0, (product.likes || 0) - 1);
    } else {
        likedProducts.push(pid);
        product.likes = (product.likes || 0) + 1;
    }

    localStorage.setItem('electroLiked', JSON.stringify(likedProducts));
    
    // Atualiza o Supabase (requer coluna 'likes' na tabela 'products')
    try {
        await supabaseFetch(`products?id=eq.${pid}`, {
            method: 'PATCH',
            body: JSON.stringify({ likes: product.likes })
        });
    } catch (e) { console.warn('Erro ao sincronizar curtida:', e); }

    renderGrid(allProductsCache);
};

window.buyItem = async function(i) {
    const item = cart[i];
    const user = getSavedUser();
    if (!user) return alert('Faça login!');
    cart.splice(i, 1);
    renderCart();
    bootstrap.Offcanvas.getInstance(document.getElementById('cartOffcanvas'))?.hide();
    alert('✅ Compra solicitada!');
    if (!user) return alert('Faça login para comprar!');
    
    const btn = document.querySelector(`button[onclick="buyItem(${i})"]`);
    const originalText = btn?.textContent || 'Comprar';
    if (btn) { btn.disabled = true; btn.textContent = 'Processando...'; }

    try {
        const orderId = `ord_${Date.now()}`;
        const order = {
            id: orderId,
            seller_id: item.vendedor_id || 'system',
            seller_name: item.loja || 'Vendedor',
            buyer_id: user.id,
            buyer_name: user.nome,
            product_id: item.id,
            product_title: item.titulo,
            product_img: item.img || '',
            total: (item.preco || 0) * (item.qtd || 1),
            quantity: item.qtd || 1,
            status: 'pending',
            realiza_entrega: item.realizaentrega ?? item.realizaEntrega ?? true,
            agree_buyer: false,
            agree_seller: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        // 1. Salvar pedido no Supabase
        await supabaseFetch('orders', {
            method: 'POST',
            body: JSON.stringify(order)
        });

        // 2. Criar chat inicial
        await supabaseFetch('chats', {
            method: 'POST',
            body: JSON.stringify({
                id: `chat_${Date.now()}`,
                order_id: orderId,
                seller_id: order.seller_id,
                seller_name: order.seller_name,
                buyer_id: order.buyer_id,
                buyer_name: order.buyer_name,
                participants: [order.seller_id, order.buyer_id],
                logistics_agreed: false,
                messages: [{
                    senderId: 'system',
                    text: `🛒 Pedido #${orderId.slice(-8).toUpperCase()} criado!\n📦 ${item.titulo}\n💰 R$ ${order.total.toLocaleString('pt-BR')}\n⏳ Aguardando aprovação do vendedor...`,
                    timestamp: new Date().toISOString()
                }]
            })
        });

        // 3. Remover do carrinho e atualizar UI
        cart.splice(i, 1);
        renderCart();
        ordersCache.push(order);
        bootstrap.Offcanvas.getInstance(document.getElementById('cartOffcanvas'))?.hide();
        
        alert('✅ Pedido realizado com sucesso!\n\nAcompanhe em "Minhas Compras".');
        window.renderOrderManagement('buyer');
        
    } catch (err) {
        console.error('Erro ao finalizar compra:', err);
        alert('❌ Erro ao processar pedido: ' + (err.message || 'Tente novamente.'));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
};

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    // Login
    document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value.trim();
        const hash = btoa(document.getElementById('loginPass').value || '');
        try {
            const users = await supabaseFetch(`users?select=*&email=eq.${email}&senha_hash=eq.${hash}&limit=1`);
            if (users?.length) {
                localStorage.setItem('electroUser', JSON.stringify(users[0]));
                bootstrap.Modal.getInstance(document.getElementById('loginModal'))?.hide();
                updateUI();
                alert(`Bem-vindo, ${users[0].nome}!`);
            } else {
                alert('Email ou senha inválidos!');
            }
        } catch { alert('Erro ao fazer login.'); }
    });

    // Cadastro
    document.getElementById('cadastroForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await supabaseFetch('users', {
                method: 'POST',
                body: JSON.stringify({
                    id: `user_${Date.now()}`,
                    tipo: document.querySelector('input[name="cadastroTipo"]:checked')?.value || 'CLIENTE',
                    nome: document.getElementById('cadastroNome').value.trim(),
                    cpf: document.getElementById('cadastroCPF').value.trim(),
                    email: document.getElementById('cadastroEmail').value.trim(),
                    senha_hash: btoa(document.getElementById('cadastroSenha').value || ''),
                    endereco: document.getElementById('cadastroEndereco').value.trim(),
                    cidade: document.getElementById('cadastroCidade').value.trim(),
                    estado: document.getElementById('cadastroEstado').value
                })
            });
            bootstrap.Modal.getInstance(document.getElementById('cadastroModal'))?.hide();
            alert('Cadastro realizado! Faça login.');
        } catch { alert('Erro. Email/CPF já cadastrado?'); }
    });

    // Anunciar
    document.getElementById('announceForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = getSavedUser();
        if (!user) return alert('Faça login!');

        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn.textContent;
        const preco = +document.getElementById('prodPrice').value;

        // Validação de Preço: Não permite menor que 0
        if (preco < 0) {
            alert('O preço não pode ser menor que zero!');
            return;
        }
        
        try {
            btn.disabled = true;
            btn.textContent = 'Publicando...';

        const editingId = e.target.dataset.editingId;
        const productData = {
            id: editingId || `prod_${Date.now()}`,
            titulo: document.getElementById('prodTitle').value,
            descricao: document.getElementById('prodDescription').value,
            preco: preco,
            quantidade: +document.getElementById('prodQuantity').value,
            categoria: document.getElementById('prodCategory').value,
            img: document.getElementById('prodImage').value || '',
            loja: user.nome,
            vendedor_id: user.id,
            realizaentrega: document.getElementById('prodDelivery')?.checked ?? true
        };

        if (editingId) {
            await supabaseFetch(`products?id=eq.${editingId}`, {
                method: 'PATCH',
                body: JSON.stringify(productData)
            });
        } else {
            await supabaseFetch('products', {
                method: 'POST',
                body: JSON.stringify(productData)
            });
        }

        bootstrap.Modal.getInstance(document.getElementById('announceModal'))?.hide();
            await loadPage();
            alert(editingId ? 'Anúncio atualizado!' : 'Anúncio publicado!');
            e.target.reset();
        } catch (err) {
            console.error('Erro ao publicar:', err);
            alert('Erro ao salvar anúncio: ' + (err.message || 'Verifique sua conexão ou as colunas do banco.'));
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    });

    // Perfil
    document.getElementById('profileEditForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = getSavedUser();
        if (!user) return;
        const updated = { ...user, nome: document.getElementById('editNome').value.trim() };
        await supabaseFetch(`users?id=eq.${user.id}`, { method: 'PATCH', body: JSON.stringify(updated) });
        localStorage.setItem('electroUser', JSON.stringify(updated));
        bootstrap.Offcanvas.getInstance(document.getElementById('profileEditOffcanvas'))?.hide();
        updateUI();
        alert('Perfil atualizado!');
    });

    // Busca
    document.getElementById('btnSearch')?.addEventListener('click', () => {
        loadPage(document.getElementById('searchInput')?.value?.trim() || 'eletronicos');
    });
    document.getElementById('searchInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadPage(e.target.value.trim() || 'eletronicos');
    });

    // Tema
    document.getElementById('themeToggle')?.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
    });

    // Iniciar
    // Configurar formulário do chat (quando o modal abrir)
    document.getElementById('chatModal')?.addEventListener('shown.bs.modal', () => {
        const form = document.getElementById('chatMessageForm');
        if (form) {
            window.cancelReplyOrEdit();
            form.onsubmit = window.sendChatMessage;
        }
    });

    updateUI();
    renderCart();
    loadPage();
});

window.loadPage = loadPage;
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;
window.renderCart = renderCart;
window.logout = () => { localStorage.removeItem('electroUser'); location.reload(); };
window.showProfileEdit = () => {
    const user = getSavedUser();
    if (!user) return;
    document.getElementById('editNome').value = user.nome || '';
    document.getElementById('editEmail').value = user.email || '';
    document.getElementById('editCPF').value = user.cpf || '';
    document.getElementById('editEndereco').value = user.endereco || '';
    document.getElementById('editCidade').value = user.cidade || '';
    document.getElementById('editEstado').value = user.estado || '';
    new bootstrap.Offcanvas(document.getElementById('profileEditOffcanvas')).show();
};
window.renderLikedProducts = () => {
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    document.getElementById('gridTitle').textContent = 'Seus Favoritos';
    renderGrid(allProductsCache.filter(p => likedProducts.includes(p.id)));
};
window.renderAccessHistory = () => {
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    document.getElementById('gridTitle').textContent = 'Vistos Recentemente';
    
    // Busca os produtos do cache seguindo a ordem do histórico (IDs salvos no localStorage)
    const historyProducts = accessHistory.map(id => allProductsCache.find(p => p.id == id)).filter(Boolean);
    renderGrid(historyProducts);
    window.closeMobileMenu();
};
window.closeMobileMenu = () => bootstrap.Offcanvas.getInstance(document.getElementById('mobileMenu'))?.hide();

// Gestão de Pedidos e Solicitações
window.renderOrderManagement = async function(type = 'buyer') {
    const user = getSavedUser();
    if (!user) return alert('Faça login!');

    const grid = document.getElementById('productsGrid');
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    
    const title = document.getElementById('gridTitle');
    grid.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border text-primary"></div></div>';

    // Reset do layout de grid para modo lista
    grid.style.display = 'block'; 
    grid.classList.add('order-view-active');

    try {
        let path = 'orders?select=*';
        if (type === 'buyer') {
            path += `&buyer_id=eq.${user.id}`;
            title.textContent = 'Minhas Compras';
        } else {
            path += `&seller_id=eq.${user.id}`;
            title.textContent = type === 'seller_requests' ? 'Solicitações Pendentes' : 'Minhas Vendas';
        }

        let orders = await supabaseFetch(path); // Busca os pedidos
        ordersCache = orders;

        if (type === 'seller_requests') orders = orders.filter(o => o.status === 'pending');
        else if (type === 'seller_sales') orders = orders.filter(o => o.status !== 'pending');

        if (!orders.length) {
            grid.innerHTML = '<div class="col-12 text-center py-5"><h5>Nenhum pedido encontrado.</h5></div>';
            return;
        }

        grid.innerHTML = orders.map(order => {
            const st = ORDER_STATUS_MAP[order.status] || { text: order.status, class: 'bg-secondary' };
            const isPending = order.status === 'pending';
            const isCancelled = order.status === 'cancelled';
            const isBuyer = type === 'buyer';

            return `
            <div class="col-12 col-xl-10 mx-auto mb-3">
                <div class="card p-3 shadow-sm border-0" style="border-radius: 15px;">
                    <div class="d-flex flex-column flex-md-row gap-3 align-items-center align-items-md-start">
                        <img src="${order.product_img || ''}" class="rounded border" 
                             style="width:100px;height:100px;object-fit:cover;" 
                             onerror="this.src='https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=100'">
                        
                        <div class="flex-grow-1 w-100">
                            <div class="d-flex justify-content-between align-items-start mb-2">
                                <div>
                                    <h6 class="fw-bold mb-1" style="font-size: 1.05rem;">${order.product_title}</h6>                                    
                                    <p class="text-muted mb-0" style="font-size: 0.8rem;">
                                        ${isBuyer ? `Vendedor: ${order.seller_name}` : `Comprador: ${order.buyer_name}`}<br>
                                        ID: #${order.id.slice(-6).toUpperCase()}
                                    </p>
                                </div>
                                <span class="badge ${st.class} py-2 px-3 rounded-pill" style="font-size: 0.75rem;">${st.text}</span>
                            </div>
                            
                            <p class="text-dark fw-bold mb-3" style="font-size: 0.95rem;">
                                Total: R$ ${parseFloat(order.total).toLocaleString('pt-BR')} 
                                <span class="text-muted fw-normal" style="font-size: 0.8rem;">(${order.quantity} un.)</span><br>
                            </p>

                            <div class="d-flex flex-wrap gap-2 justify-content-end align-items-center">
                                ${isPending && type === 'seller_requests' ? `
                                    <button class="btn btn-sm btn-success px-4 fw-bold shadow-sm" onclick="window.updateOrderStatus('${order.id}', 'accepted')">Aceitar</button>
                                    <button class="btn btn-sm btn-danger px-4 fw-bold shadow-sm" onclick="window.updateOrderStatus('${order.id}', 'cancelled')">Recusar</button>
                                ` : ''}

                                ${!isPending && !isCancelled ? `
                                    <button class="btn btn-sm btn-primary px-4 fw-bold shadow-sm" onclick="window.showChat('${order.id}')">
                                        <i class="bi bi-chat-dots me-1"></i> Abrir Chat
                                    </button>
                                ` : ''}

                                ${isPending ? `
                                    <span class="badge bg-warning text-dark py-2 px-3 rounded-pill">⏳ Aguardando aprovação</span>
                                    ${type === 'buyer' ? `
                                        <button class="btn btn-sm btn-danger px-3 fw-bold shadow-sm rounded-pill" onclick="window.cancelOrderBuyer('${order.id}')">Cancelar</button>
                                    ` : ''}
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
        alert(`Pedido atualizado para: ${newStatus}`);
        window.renderOrderManagement(newStatus === 'accepted' ? 'seller_sales' : 'seller_requests');
    } catch (e) { alert('Erro ao atualizar pedido.'); }
};

window.cancelOrderBuyer = async function(orderId) {
    if (!confirm('Tem certeza que deseja cancelar seu pedido?')) return;
    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'cancelled', updated_at: new Date().toISOString() })
        });
        alert('Pedido cancelado!');
        window.renderOrderManagement('buyer');
    } catch (e) { alert('Erro ao cancelar pedido.'); }
};

window.deleteProduct = async function(pid) {
    if (!confirm('Tem certeza que deseja excluir este anúncio?')) return;
    try {
        await supabaseFetch(`products?id=eq.${pid}`, { method: 'DELETE' });
        alert('Produto removido!');
        bootstrap.Modal.getInstance(document.getElementById('productDetailModal'))?.hide();
        loadPage();
    } catch (e) { alert('Erro ao excluir produto.'); }
};

window.resetAnnounceModal = function() {
    const form = document.getElementById('announceForm');
    if (form) {
        form.reset();
        delete form.dataset.editingId;

        // Reseta os textos do Modal para o padrão original
        const modalTitle = document.querySelector('#announceModal .modal-title');
        const submitBtn = document.querySelector('#announceForm button[type="submit"]');
        if (modalTitle) modalTitle.textContent = 'O que você quer vender?';
        if (submitBtn) submitBtn.textContent = 'Publicar Anúncio';
    }
};

// ============================================
// CHAT COMPLETO - COM IMAGENS, LINKS E ARQUIVOS
// ============================================

window.showChat = async function(orderId) {
    const user = getSavedUser();
    if (!user) return alert('Faça login!');

    // Buscar pedido
    let order = ordersCache.find(o => o.id === orderId);
    if (!order) {
        const result = await supabaseFetch(`orders?id=eq.${orderId}&limit=1`);
        order = result[0];
    }
    if (!order) return alert('Pedido não encontrado.');

    currentChat = orderId;

    // 1. Atualiza o resumo do topo (Onde aparecia Produto R$ 0,00)
    const titleEl = document.getElementById('chatProdTitle');
    const priceEl = document.getElementById('chatProdPrice');
    const imgEl = document.getElementById('chatProdImg');
    const orderIdEl = document.getElementById('chatOrderIdDisplay');

    if (titleEl) titleEl.textContent = order.product_title;
    if (priceEl) priceEl.textContent = `R$ ${parseFloat(order.total).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    if (imgEl) imgEl.src = order.product_img || 'https://placehold.co/45?text=📦';
    if (orderIdEl) orderIdEl.textContent = `#${order.id.slice(-8).toUpperCase()}`;

    // Garante que a área de ações comece fechada ao abrir o chat
    const actionsArea = document.getElementById('chatActionsArea');
    if (actionsArea) actionsArea.classList.add('d-none');

    // Nome do outro participante
    const otherName = user.id === order.buyer_id ? order.seller_name : order.buyer_name;
    document.getElementById('chatPartnerNameHeader').textContent = otherName || 'Chat';
    document.getElementById('chatPartnerAvatar').src = 
        `https://ui-avatars.com/api/?name=${encodeURIComponent(otherName || 'User')}&background=random&size=40`;

    // Mostrar modal
    new bootstrap.Modal(document.getElementById('chatModal')).show();
    
    // Carregar mensagens
    await loadChatMessages(orderId);
};

async function loadChatMessages(orderId) {
    const container = document.getElementById('chatMessagesContainer');
    container.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>';

    try {
        const user = getSavedUser();
        
        // Buscar pedido atualizado
        const orderResult = await supabaseFetch(`orders?id=eq.${orderId}&limit=1`);
        const order = orderResult?.[0];
        
        if (!order) {
            container.innerHTML = '<div class="text-center py-4 text-danger">Pedido não encontrado</div>';
            return;
        }

        // Atualizar cache
        const idx = ordersCache.findIndex(o => o.id === orderId);
        if (idx >= 0) ordersCache[idx] = order;
        else ordersCache.push(order);

        // Buscar ou criar chat
        let chatResult = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        let chat = chatResult?.[0];

        // Se não existe chat, cria um
        if (!chat) {
            const newChat = {
                id: `chat_${Date.now()}`,
                order_id: orderId,
                seller_id: order.seller_id,
                seller_name: order.seller_name,
                buyer_id: order.buyer_id,
                buyer_name: order.buyer_name,
                participants: [order.seller_id, order.buyer_id],
                messages: [],
                logistics_agreed: false
            };
            await supabaseFetch('chats', { method: 'POST', body: JSON.stringify(newChat) });
            chat = newChat;
        }

        // ============================================
        // MONTAR HTML DO CHAT
        // ============================================
        let html = '';

        // Criar ou atualizar container de preview do input (barra de responder/editar)
        if (!document.getElementById('chatInputPreview')) {
            const form = document.getElementById('chatMessageForm');
            const preview = document.createElement('div');
            preview.id = 'chatInputPreview';
            preview.className = 'p-2 bg-light border-bottom d-flex justify-content-between align-items-center d-none';
            form?.parentNode.insertBefore(preview, form);
        }

        // 💬 MENSAGENS
        if (chat.messages && chat.messages.length > 0) {
            html += chat.messages.map((msg, index) => {
                // Mensagem do sistema
                if (msg.type === 'system' || msg.senderId === 'system') {
                    return `<div class="text-center my-3">
                        <span class="badge bg-light text-dark px-3 py-2">${msg.text}</span>
                    </div>`;
                }

                const isMe = msg.senderId === user.id || msg.senderId === String(user.id);
                
                const replyHtml = msg.replyTo ? `
                    <div class="p-2 mb-2 rounded ${isMe ? 'bg-white bg-opacity-25' : 'bg-secondary bg-opacity-25'} small border-start border-4 border-info">
                        <div class="fw-bold" style="font-size: 0.7rem;">${msg.replyTo.senderName}</div>
                        <div class="text-truncate" style="max-height: 20px;">${msg.replyTo.text}</div>
                    </div>
                ` : '';

                return `
                <div class="d-flex ${isMe ? 'justify-content-end' : 'justify-content-start'} mb-3">
                    <div class="p-3 rounded shadow-sm ${isMe ? 'bg-primary text-white' : 'bg-light'}" 
                         style="max-width: 75%; word-break: break-word;">
                        <div class="d-flex justify-content-between align-items-center mb-1 gap-2">
                            <small class="fw-bold" style="font-size: 0.7rem;">${isMe ? 'Você' : (msg.senderName || 'Usuário')}</small>
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
                                 style="max-width: 250px; cursor: pointer;" 
                                 onclick="window.openImageFull('${msg.image}')">
                        ` : ''}
                        
                        ${msg.file ? `
                            <div class="d-flex align-items-center gap-2 p-2 bg-white rounded mb-2">
                                <i class="bi bi-file-earmark fs-4"></i>
                                <a href="${msg.file.url}" target="_blank" class="small text-primary">
                                    📎 ${msg.file.name || 'Arquivo anexado'}
                                </a>
                            </div>
                        ` : ''}
                        
                        <div style="white-space: pre-wrap;">${formatLinks(msg.text)}</div>
                        
                        <div style="font-size: 0.65rem;" class="text-end mt-1 ${isMe ? 'text-white-50' : 'text-muted'} d-flex justify-content-end gap-1">
                            ${msg.edited ? '<span>(editada)</span>' : ''}
                            <span>${new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    </div>
                </div>`;
            }).join('');
        } else {
            html += '<div class="text-center py-4 text-muted">📝 Nenhuma mensagem ainda. Envie a primeira!</div>';
        }

        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;

        // Atualizar área de logística e status
        updateChatLogistics(order, user);

    } catch (e) {
        console.error('❌ Erro ao carregar chat:', e);
        container.innerHTML = `
            <div class="text-center py-4 text-danger">
                <i class="bi bi-exclamation-triangle fs-1"></i>
                <p>Erro ao carregar mensagens</p>
                <small>${e.message}</small>
                <br>
                <button class="btn btn-primary btn-sm mt-2" onclick="loadChatMessages('${orderId}')">Tentar Novamente</button>
            </div>`;
    }
}

function formatLinks(text) {
    if (!text) return '';
    // Detecta URLs e transforma em links clicáveis
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, (url) => {
        return `<a href="${url}" target="_blank" style="color: inherit; text-decoration: underline;">🔗 ${url}</a>`;
    });
}

function updateChatLogistics(order, user) {
    // Atualizar a barra de status visual
    const statusBar = document.getElementById('orderStatusBar');
    if (statusBar) {
        const st = ORDER_STATUS_MAP[order.status] || { text: order.status, class: 'bg-secondary' };
        statusBar.innerHTML = `<div class="badge ${st.class} w-100 py-2 shadow-sm">${st.text}</div>`;
    }

    const actionsArea = document.getElementById('chatActionsArea');
    if (!actionsArea) return;
    actionsArea.innerHTML = '';

    const isBuyer = user.id === order.buyer_id;

    // Combinar logística
    if (['accepted', 'agreement'].includes(order.status)) {
        const buyerAgreed = order.agree_buyer;
        const sellerAgreed = order.agree_seller;
        const userAgreed = isBuyer ? buyerAgreed : sellerAgreed;

        if (!userAgreed) {
            actionsArea.innerHTML = `
                <p class="small fw-bold mb-2"><i class="bi bi-truck me-1"></i> Combine a entrega:</p>
                <div class="d-flex gap-2 flex-wrap">
                    <button class="btn btn-sm btn-outline-primary" onclick="window.setLogistics('${order.id}','pickup')">🏪 Retirada</button>
                    <button class="btn btn-sm btn-outline-success" onclick="window.setLogistics('${order.id}','seller_delivery')">🚚 Entrega</button>
                    <button class="btn btn-sm btn-outline-warning" onclick="window.setLogistics('${order.id}','external_app')">📱 App</button>
                </div>`;
        } else {
            actionsArea.innerHTML = `<div class="alert alert-info mb-0 small py-2">⏳ Aguardando a outra parte confirmar...</div>`;
        }
    }

    // Confirmar recebimento (comprador)
    if (['shipping', 'awaiting_pickup'].includes(order.status) && isBuyer) {
        actionsArea.innerHTML = `
            <p class="small fw-bold mb-2">📦 O produto chegou?</p>
            <div class="d-flex gap-2">
                <button class="btn btn-sm btn-success flex-grow-1 fw-bold" onclick="window.confirmReceipt('${order.id}')">
                    <i class="bi bi-check-circle me-1"></i> Sim, recebi!
                </button>
                <button class="btn btn-sm btn-outline-warning" onclick="window.reportProblem('${order.id}')">
                    ⚠️ Reportar
                </button>
            </div>`;
    }

    // Pedido finalizado
    if (order.status === 'finished') {
        actionsArea.innerHTML = `<div class="alert alert-success mb-0 py-2 text-center small fw-bold">🎉 Negociação finalizada com sucesso!</div>`;
    }

    // Pedido cancelado
    if (order.status === 'cancelled') {
        actionsArea.innerHTML = `<div class="alert alert-danger mb-0 py-2 text-center small fw-bold">❌ Este pedido foi cancelado.</div>`;
    }

    // Botão cancelar (sempre visível enquanto ativo)
    if (!['finished', 'cancelled', 'dispute'].includes(order.status)) {
        actionsArea.innerHTML += `
            <button class="btn btn-link btn-sm text-danger text-decoration-none mt-2 p-0 fw-bold" 
                    onclick="window.cancelOrderFromChat('${order.id}')">
                <i class="bi bi-x-circle me-1"></i> Cancelar Pedido
            </button>`;
    }
}

// --- Novas Funções de Status ---

window.confirmReceipt = async function(orderId) {
    if (!confirm('Você confirma que recebeu o produto conforme anunciado? Isso liberará o pagamento.')) return;
    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'finished', updated_at: new Date().toISOString() })
        });
        
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        let chat = chatData[0];
        if (chat) {
            chat.messages.push({ senderId: 'system', text: `✅ Comprador confirmou o recebimento. Pedido finalizado!`, timestamp: new Date().toISOString(), type: 'system' });
            await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        }
        alert('Parabéns! Compra finalizada.');
        loadChatMessages(orderId);
    } catch (e) { alert('Erro ao finalizar pedido.'); }
};

window.reportProblem = async function(orderId) {
    const motivo = prompt('Descreva brevemente o problema encontrado:');
    if (!motivo) return;
    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'dispute', updated_at: new Date().toISOString() })
        });
        
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        let chat = chatData[0];
        if (chat) {
            chat.messages.push({ senderId: 'system', text: `⚠️ O comprador reportou um problema: "${motivo}". Negociação em disputa.`, timestamp: new Date().toISOString(), type: 'system' });
            await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        }
        loadChatMessages(orderId);
    } catch (e) { alert('Erro ao reportar problema.'); }
};

window.sendChatMessage = async function(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const input = document.getElementById('chatMessageInput');
    const text = input?.value?.trim();
    const user = getSavedUser();
    
    console.log('📤 Enviando mensagem:', text, '| Chat:', currentChat, '| User:', user?.id);
    
    if (!text || !user || !currentChat) {
        console.warn('⚠️ Dados faltando:', { text: !!text, user: !!user, chat: !!currentChat });
        return false;
    }

    try {
        // Buscar chat
        const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
        let chat = chatResult?.[0];

        if (!chat) {
            alert('Chat não encontrado.');
            return false;
        }

        if (editingMessageIndex !== null) {
            // Lógica de Edição
            chat.messages[editingMessageIndex].text = text;
            chat.messages[editingMessageIndex].edited = true;
        } else {
            // Lógica de Nova Mensagem
            const newMessage = {
                senderId: String(user.id),
                senderName: user.nome || 'Usuário',
                text: text,
                timestamp: new Date().toISOString(),
                type: 'message'
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

        // Salvar no Supabase
        const result = await supabaseFetch(`chats?id=eq.${chat.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ messages: chat.messages })
        });

        console.log('✅ Mensagem salva!', result);

        // Limpar input e estados de UI
        window.cancelReplyOrEdit();
        input.value = '';
        
        // Recarregar mensagens
        await loadChatMessages(currentChat);

    } catch (e) {
        console.error('❌ Erro ao enviar mensagem:', e);
        alert('Erro ao enviar mensagem: ' + e.message);
    }
    
    return false;
};

// Alterna a visibilidade da área de opções do pedido
window.toggleChatActions = function() {
    const area = document.getElementById('chatActionsArea');
    if (area) {
        area.classList.toggle('d-none');
    }
};

// ============================================
// LÓGICA DE RESPOSTA E EDIÇÃO
// ============================================

window.startReply = async function(index) {
    const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
    const msg = chatResult?.[0]?.messages[index];
    if (!msg) return;

    currentReplyIndex = index;
    editingMessageIndex = null;
    
    window.updateChatInputUI(`Respondendo a ${msg.senderName}`, msg.text);
    document.getElementById('chatMessageInput')?.focus();
};

window.startEdit = async function(index) {
    const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
    const msg = chatResult?.[0]?.messages[index];
    if (!msg) return;

    editingMessageIndex = index;
    currentReplyIndex = null;

    const input = document.getElementById('chatMessageInput');
    if (input) input.value = msg.text;
    
    window.updateChatInputUI(`Editando sua mensagem`, msg.text);
    input?.focus();
};

window.cancelReplyOrEdit = function() {
    currentReplyIndex = null;
    editingMessageIndex = null;
    const preview = document.getElementById('chatInputPreview');
    if (preview) {
        preview.classList.add('d-none');
        preview.innerHTML = '';
    }
};

window.updateChatInputUI = function(title, text) {
    const preview = document.getElementById('chatInputPreview');
    if (!preview) return;

    preview.innerHTML = `
        <div class="small text-truncate" style="max-width: 80%;">
            <strong class="text-primary d-block" style="font-size: 0.7rem;">${title}</strong>
            <span class="text-muted" style="font-size: 0.8rem;">${text}</span>
        </div>
        <button type="button" class="btn-close" style="font-size: 0.6rem;" onclick="window.cancelReplyOrEdit()"></button>
    `;
    preview.classList.remove('d-none');
};

// Enviar imagem
window.sendChatImage = async function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const user = getSavedUser();
        if (!user || !currentChat) return;

        // Converter para base64
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
                let chat = chatResult?.[0];
                if (!chat) return;

                chat.messages.push({
                    senderId: user.id,
                    senderName: user.nome,
                    text: '📷 Imagem',
                    image: ev.target.result,
                    timestamp: new Date().toISOString(),
                    type: 'image'
                });

                await supabaseFetch(`chats?id=eq.${chat.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ messages: chat.messages })
                });

                await loadChatMessages(currentChat);
            } catch (err) {
                console.error(err);
                alert('Erro ao enviar imagem.');
            }
        };
        reader.readAsDataURL(file);
    };
    input.click();
};

// Função para cancelar o pedido diretamente pelo chat
window.cancelOrderFromChat = async function(orderId) {
    if (!confirm('Deseja realmente cancelar este pedido? Esta ação não pode ser desfeita.')) return;
    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'cancelled', updated_at: new Date().toISOString() })
        });

        // Adiciona aviso do sistema no chat
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        let chat = chatData[0];
        if (chat) {
            chat.messages.push({ senderId: 'system', text: `🚫 Pedido cancelado através do chat.`, timestamp: new Date().toISOString(), type: 'system' });
            await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        }

        alert('Pedido cancelado!');
        loadChatMessages(orderId);
    } catch (e) { alert('Erro ao cancelar pedido.'); }
};

// Enviar arquivo
window.sendChatFile = async function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const user = getSavedUser();
        if (!user || !currentChat) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const chatResult = await supabaseFetch(`chats?order_id=eq.${currentChat}&limit=1`);
                let chat = chatResult?.[0];
                if (!chat) return;

                chat.messages.push({
                    senderId: user.id,
                    senderName: user.nome,
                    text: `📎 ${file.name}`,
                    file: {
                        name: file.name,
                        url: ev.target.result,
                        size: file.size
                    },
                    timestamp: new Date().toISOString(),
                    type: 'file'
                });

                await supabaseFetch(`chats?id=eq.${chat.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ messages: chat.messages })
                });

                await loadChatMessages(currentChat);
            } catch (err) {
                console.error(err);
                alert('Erro ao enviar arquivo.');
            }
        };
        reader.readAsDataURL(file);
    };
    input.click();
};

window.openImageFull = function(src) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
    modal.innerHTML = `<img src="${src}" style="max-width:90%;max-height:90%;">`;
    modal.onclick = () => modal.remove();
    document.body.appendChild(modal);
};

// Função para definir logística (chamada do chat)
window.setLogistics = async function(orderId, type) {
    const user = getSavedUser();
    const order = ordersCache.find(o => o.id === orderId) || await supabaseFetch(`orders?id=eq.${orderId}&limit=1`).then(r => r[0]);
    if (!order) return alert('Pedido não encontrado.');

    const isBuyer = user.id === order.buyer_id;
    const updateBody = {
        logistics_type: type,
        updated_at: new Date().toISOString()
    };

    if (isBuyer) updateBody.agree_buyer = true;
    else updateBody.agree_seller = true;

    // Se ambos concordaram, muda o status do pedido
    if ((isBuyer && order.agree_seller) || (!isBuyer && order.agree_buyer)) {
        updateBody.status = (type === 'pickup' ? 'awaiting_pickup' : 'shipping');
    } else {
        updateBody.status = 'agreement'; // Aguardando a outra parte
    }

    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify(updateBody)
        });

        // Adiciona mensagem do sistema no chat
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        let chat = chatData[0];
        if (chat) {
            const systemMessage = {
                senderId: 'system',
                text: `${user.nome} propôs a logística: ${type === 'pickup' ? 'Retirada' : (type === 'seller_delivery' ? 'Entrega pelo Vendedor' : 'App de Entrega')}.`,
                timestamp: new Date().toISOString(),
                type: 'system'
            };
            chat.messages.push(systemMessage);
            await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        }
        
        loadChatMessages(orderId);
    } catch (e) { console.error('Erro ao definir logística:', e); alert('Erro ao definir logística.'); }
};

// Painel do Vendedor
