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

    // Garante que o layout volte ao modo grade (3 ou 4 por linha)
    grid.style.display = 'grid';

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

                            <div class="d-flex flex-wrap gap-2 justify-content-end">
                                ${isPending && type === 'seller_requests' ? `
                                    <button class="btn btn-sm btn-success px-4 fw-bold" onclick="window.updateOrderStatus('${order.id}', 'accepted')">Aceitar</button>
                                    <button class="btn btn-sm btn-outline-danger px-4" onclick="window.updateOrderStatus('${order.id}', 'cancelled')">Recusar</button>
                                ` : ''}

                                ${isPending && type === 'buyer' ? `
                                    <button class="btn btn-sm btn-outline-danger px-3" onclick="window.cancelOrderBuyer('${order.id}')">Cancelar Pedido</button>
                                ` : ''}
                                
                                ${!isPending && !isCancelled ? `
                                    <button class="btn btn-sm btn-primary px-4 fw-bold shadow-sm" onclick="window.showChat('${order.id}')">
                                        <i class="bi bi-chat-dots me-1"></i> Abrir Chat
                                    </button>
                                ` : (isBuyer && isPending ? '<small class="text-muted italic border rounded p-1">Aguardando aprovação para liberar chat...</small>' : '')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
        window.closeMobileMenu();
    } catch (e) {
        console.error("Erro renderOrderManagement:", e);
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

// Lógica do Chat
window.showChat = async function(orderId) {
    currentChat = orderId; // O currentChat agora é o orderId
    const user = getSavedUser();
    const order = ordersCache.find(o => o.id === orderId) || await supabaseFetch(`orders?id=eq.${orderId}&limit=1`).then(r => r[0]);
    if (!order) return alert('Pedido não encontrado.');

    document.getElementById('chatPartnerNameHeader').textContent = user?.tipo === 'VENDEDOR' ? order.buyer_name : order.seller_name;
    document.getElementById('chatPartnerAvatar').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(document.getElementById('chatPartnerNameHeader').textContent)}&background=random`;
    document.getElementById('chatOrderIdDisplay').textContent = `#${orderId.slice(-6).toUpperCase()}`;
    new bootstrap.Modal(document.getElementById('chatModal')).show();
    
    loadMessages(orderId);
};

async function loadMessages(orderId) {
    const container = document.getElementById('chatMessagesContainer');
    container.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>';
    const user = getSavedUser();
    const order = ordersCache.find(o => o.id === orderId) || await supabaseFetch(`orders?id=eq.${orderId}&limit=1`).then(r => r[0]);
    if (!order) return;
    
    try {
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        let chat = chatData[0] || { messages: [] };
        
        container.innerHTML = chat.messages.map(msg => {
            const isMe = msg.senderId === getSavedUser()?.id;
            return `
                <div class="d-flex ${isMe ? 'justify-content-end' : 'justify-content-start'} mb-2">
                    <div class="p-2 rounded shadow-sm ${isMe ? 'bg-primary text-white' : 'bg-light'}" style="max-width: 80%;">
                        ${msg.text}
                        <div style="font-size: 0.6rem;" class="text-end opacity-75">${new Date(msg.timestamp).toLocaleTimeString()}</div>
                    </div>
                </div>
            `;
        }).join('');
        container.scrollTop = container.scrollHeight;

        // Lógica para exibir botões de ação no chat
        const logisticsArea = document.getElementById('logisticsAgreementArea');
        const logisticsButtons = document.getElementById('logisticsButtons');
        const chatActionsArea = document.getElementById('chatActionsArea');
        chatActionsArea.innerHTML = ''; // Limpa ações anteriores

        if (order.status === 'pending' && user.tipo === 'VENDEDOR') {
            chatActionsArea.innerHTML = `
                <p class="fw-bold mb-2"><i class="bi bi-question-circle me-1"></i> Ações do Pedido:</p>
                <div class="d-flex gap-2 flex-wrap">
                    <button class="btn btn-success px-4 fw-bold" onclick="window.updateOrderStatusFromChat('${order.id}', 'accepted')">Aceitar Pedido</button>
                    <button class="btn btn-outline-danger px-4" onclick="window.updateOrderStatusFromChat('${order.id}', 'cancelled')">Recusar Pedido</button>
                </div>
            `;
            logisticsArea.classList.add('d-none');
        } else if (order.status === 'accepted' || order.status === 'agreement') {
            logisticsArea.classList.remove('d-none');
            logisticsArea.classList.add('d-flex'); // Garante que o flexbox seja aplicado
            
            const buyerAgreed = order.agree_buyer;
            const sellerAgreed = order.agree_seller;

            if (user.tipo === 'VENDEDOR' && !sellerAgreed) {
                logisticsButtons.innerHTML = `
                    <button class="btn btn-sm btn-outline-primary" onclick="window.setLogistics('${order.id}','pickup')">Retirada</button>
                    <button class="btn btn-sm btn-outline-success" onclick="window.setLogistics('${order.id}','seller_delivery')">Entrega</button>
                    <button class="btn btn-sm btn-outline-warning" onclick="window.setLogistics('${order.id}','external_app')">App Entrega</button>
                `;
            } else if (user.tipo === 'CLIENTE' && !buyerAgreed) {
                logisticsButtons.innerHTML = `
                    <button class="btn btn-sm btn-outline-primary" onclick="window.setLogistics('${order.id}','pickup')">Retirada</button>
                    <button class="btn btn-sm btn-outline-success" onclick="window.setLogistics('${order.id}','seller_delivery')">Entrega</button>
                    <button class="btn btn-sm btn-outline-warning" onclick="window.setLogistics('${order.id}','external_app')">App Entrega</button>
                `;
            } else {
                logisticsButtons.innerHTML = `<div class="alert alert-info mb-0 small w-100">Aguardando a outra parte definir a logística...</div>`;
            }
            chatActionsArea.innerHTML = ''; // Limpa ações de pending
        } else if (['shipping', 'awaiting_pickup'].includes(order.status) && user.tipo === 'CLIENTE') {
            chatActionsArea.innerHTML = `
                <p class="fw-bold mb-2"><i class="bi bi-check-circle me-1"></i> Recebeu o produto?</p>
                <div class="d-flex gap-2 flex-wrap">
                    <button class="btn btn-success px-4 fw-bold" onclick="window.confirmReceipt('${order.id}')">Confirmar Recebimento</button>
                    <button class="btn btn-outline-warning px-4" onclick="window.reportProblem('${order.id}')">Reportar Problema</button>
                </div>
            `;
            logisticsArea.classList.add('d-none');
        } else {
            logisticsArea.classList.add('d-none');
            chatActionsArea.innerHTML = '';
        }

        // Atualiza a barra de status do pedido no chat
        updateOrderStatusBar(order);

        // Adiciona um listener para o formulário de mensagem
        document.getElementById('chatMessageForm')?.addEventListener('submit', window.sendChatMessage);

    } catch (e) { container.innerHTML = 'Erro ao carregar mensagens.'; }
}

window.sendChatMessage = async function(event) {
    event.preventDefault();
    const input = document.getElementById('chatMessageInput');
    const text = input.value.trim();
    const user = getSavedUser(); // currentChat já é o orderId
    const orderId = currentChat;

    if (!text || !user) return;

    try {
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        let chat = chatData[0];
        const newMessage = { senderId: user.id, text, timestamp: new Date().toISOString() };
        
        if (chat) {
            chat.messages.push(newMessage);
            await supabaseFetch(`chats?id=eq.${chat.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ messages: chat.messages })
            });
        } else {
            // Se o chat não existe, cria um novo
            const order = ordersCache.find(o => o.id === orderId) || await supabaseFetch(`orders?id=eq.${orderId}&limit=1`).then(r => r[0]);
            if (!order) throw new Error('Pedido não encontrado para criar chat.');

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
                    messages: [newMessage]
                })
            });
        }
        input.value = '';
        loadMessages(orderId);
    } catch (e) { alert('Erro ao enviar mensagem.'); }
};

// Função para atualizar status do pedido a partir do chat
window.updateOrderStatusFromChat = async function(orderId, newStatus) {
    const user = getSavedUser();
    const order = ordersCache.find(o => o.id === orderId) || await supabaseFetch(`orders?id=eq.${orderId}&limit=1`).then(r => r[0]);
    if (!order) return alert('Pedido não encontrado.');

    if (newStatus === 'cancelled' && !confirm('Tem certeza que deseja recusar este pedido?')) return;
    if (newStatus === 'accepted' && !confirm('Tem certeza que deseja aceitar este pedido?')) return;

    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus, updated_at: new Date().toISOString() })
        });

        // Adiciona mensagem do sistema no chat
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        let chat = chatData[0];
        const systemMessage = {
            senderId: 'system',
            text: `Status do pedido alterado para: ${ORDER_STATUS_MAP[newStatus]?.text || newStatus}`,
            timestamp: new Date().toISOString()
        };

        if (chat) {
            chat.messages.push(systemMessage);
            await supabaseFetch(`chats?id=eq.${chat.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ messages: chat.messages })
            });
        } else {
            // Se o chat não existe, cria um novo com a mensagem do sistema
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
                    messages: [systemMessage]
                })
            });
        }

        alert(`Pedido atualizado para: ${ORDER_STATUS_MAP[newStatus]?.text || newStatus}`);
        loadMessages(orderId); // Recarrega as mensagens para atualizar a UI
        window.renderOrderManagement(user.tipo === 'VENDEDOR' ? 'seller_requests' : 'buyer'); // Atualiza a lista de pedidos
    } catch (e) {
        console.error('Erro ao atualizar status do pedido no chat:', e);
        alert('Erro ao atualizar pedido. Tente novamente.');
    }
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
        const systemMessage = {
            senderId: 'system',
            text: `${user.nome} propôs a logística: ${type === 'pickup' ? 'Retirada' : (type === 'seller_delivery' ? 'Entrega pelo Vendedor' : 'App de Entrega')}.`,
            timestamp: new Date().toISOString()
        };
        chat.messages.push(systemMessage);
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        
        loadMessages(orderId); // Recarrega as mensagens para atualizar a UI
    } catch (e) { console.error('Erro ao definir logística:', e); alert('Erro ao definir logística.'); }
};

// Função para o comprador confirmar recebimento
window.confirmReceipt = async function(orderId) {
    if (!confirm('Confirma o recebimento do produto?')) return;
    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'finished', updated_at: new Date().toISOString() })
        });
        // Adiciona mensagem do sistema no chat
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        let chat = chatData[0];
        const systemMessage = { senderId: 'system', text: '✅ Comprador confirmou o recebimento do produto!', timestamp: new Date().toISOString() };
        chat.messages.push(systemMessage);
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });

        alert('Recebimento confirmado! Pedido finalizado.');
        loadMessages(orderId);
        window.renderOrderManagement('buyer');
    } catch (e) { alert('Erro ao confirmar recebimento.'); }
};

// Função para o comprador reportar problema
window.reportProblem = async function(orderId) {
    const reason = prompt('Por favor, descreva o problema com o pedido:');
    if (!reason) return;
    try {
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'dispute', dispute_reason: reason, updated_at: new Date().toISOString() })
        });
        // Adiciona mensagem do sistema no chat
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        let chat = chatData[0];
        const systemMessage = { senderId: 'system', text: `⚠️ Comprador reportou um problema: ${reason}`, timestamp: new Date().toISOString() };
        chat.messages.push(systemMessage);
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });

        alert('Problema reportado. Nossa equipe analisará.');
        loadMessages(orderId);
        window.renderOrderManagement('buyer');
    } catch (e) { alert('Erro ao reportar problema.'); }
};

// Função para atualizar a barra de status do pedido no chat
function updateOrderStatusBar(order) {
    const container = document.getElementById('orderStatusBar');
    if (!order || !container) return;

    const steps = ['pending', 'accepted', 'agreement', 'shipping', 'finished'];
    const currentStatusIndex = steps.indexOf(order.status);

    container.innerHTML = `
        <div class="d-flex justify-content-between align-items-center p-2 small">
            ${steps.map((s, i) => {
                const isActive = i <= currentStatusIndex;
                const statusInfo = ORDER_STATUS_MAP[s] || { text: s, class: 'bg-secondary' };
                return `
                    <div class="text-center flex-grow-1 ${isActive ? 'text-primary' : 'text-muted'}">
                        <i class="bi ${isActive ? 'bi-check-circle-fill' : 'bi-circle'}" style="font-size: 1.2rem;"></i><br>
                        ${statusInfo.text}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// Painel do Vendedor
window.renderSellerPanel = async function() { // Tornar a função assíncrona
    const user = getSavedUser();
    if (!user) {
        alert('Faça login para acessar o painel do vendedor!');
        return;
    }
    if (user.tipo !== 'VENDEDOR' && user.tipo !== 'ADMIN') {
        return alert('Acesso restrito a vendedores!');
    }
    
    document.getElementById('gridTitle').textContent = 'Meus Produtos';
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');

    const grid = document.getElementById('productsGrid');
    // Garante que o grid de produtos volte ao normal (3 ou 4 por linha)
    grid.style.display = 'grid';
    grid.innerHTML = `<div class="col-12 text-center py-5"><div class="spinner-border" style="color:#131673;"></div><h5>Carregando seus produtos...</h5></div>`;

    try {
        // Busca APENAS os produtos do vendedor logado diretamente do Supabase
        const sellerProducts = await supabaseFetch(`products?select=*&vendedor_id=eq.${user.id}`);
        
        if (!sellerProducts.length) {
            grid.innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="bi bi-box-seam" style="font-size:4rem;color:#ccc;"></i>
                <h5 class="mt-3">Você ainda não tem produtos</h5>
                <button class="btn btn-primary mt-2" data-bs-toggle="modal" data-bs-target="#announceModal">
                    <i class="bi bi-plus-circle me-2"></i>Anunciar Produto
                </button>
            </div>`;
        } else {
            renderGrid(sellerProducts); // Renderiza apenas os produtos do vendedor
        }
        console.log('✅', sellerProducts.length, 'produtos do vendedor carregados');
        window.closeMobileMenu(); // Fecha o menu mobile após carregar
    } catch (e) {
        console.error('Erro ao carregar produtos do vendedor:', e);
        grid.innerHTML = `<div class="col-12 text-center py-5"><h5>Erro ao carregar seus produtos</h5><button class="btn btn-primary mt-3" onclick="window.renderSellerPanel()">Tentar Novamente</button></div>`;
    }
};

window.shareProduct = function (pid) {
    const item = allProductsCache.find(x => x.id === pid || x.id == pid);
    if (!item) return;
    const url = window.location.href;
    const text = `Confira este produto no ElectroMarket: ${item.titulo}`;
    if (navigator.share) {
        navigator.share({ title: 'ElectroMarket', text: text, url: url }).catch(console.error);
    } else {
        navigator.clipboard.writeText(url).then(() => alert('Link do produto copiado!'));
    }
};
