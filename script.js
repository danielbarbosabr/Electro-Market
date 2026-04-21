// ============================================
// CONFIGURAÇÃO
// ============================================

const API_CONFIG = {
    // Configuração JSONBin.io (Substituindo Firebase)
    JSONBIN_BIN_ID: '69e5308936566621a8ce0cba', 
    JSONBIN_KEY: '$2a$10$bwbkqz62UMqBrSFlIRMUVuF/BrBdrhqkvUUMjyo/cvLMjVjaGMfPK', // Sua Master Key está correta aqui
    MODE: 'PRODUCTION' 
};

let allProductsCache = [];
let fullDatabase = null; // Cache local do banco completo
let syncInProgress = false;
let cart = JSON.parse(localStorage.getItem('holandesVoadorCart')) || [];
let cartCount = cart.reduce((acc, item) => acc + (item.qtd || 1), 0);
let currentChat = null;
let chats = JSON.parse(localStorage.getItem('electro_chats')) || [];
let orders = JSON.parse(localStorage.getItem('electro_orders')) || [];
let chatRefreshInterval = null;
let dbCache = null; // Cache IndexedDB

// ============================================
// CACHE SYSTEM (IndexedDB)
// ============================================

async function initCache() {
    return new Promise((resolve, reject) => {
        if (dbCache) return resolve(dbCache);
        
        const request = indexedDB.open('GoogleShoppingCache', 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            dbCache = request.result;
            resolve(dbCache);
        };
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('products')) {
                const store = db.createObjectStore('products', { keyPath: 'query' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

async function saveProductsToCache(query, products) {
    try {
        const db = await initCache();
        const tx = db.transaction('products', 'readwrite');
        const store = tx.objectStore('products');
        await store.put({
            query: query.toLowerCase().trim(),
            products,
            timestamp: Date.now()
        });
    } catch (e) {
        console.warn("Erro ao salvar cache:", e);
    }
}

async function getProductsFromCache(query) {
    try {
        const db = await initCache();
        const tx = db.transaction('products', 'readonly');
        const store = tx.objectStore('products');
        
        const result = await new Promise((resolve) => {
            const request = store.get(query.toLowerCase().trim());
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        });
        
        // Cache válido por 1 hora (para dados gratuitos, economizamos chamadas)
        if (result && (Date.now() - result.timestamp < 60 * 60 * 1000)) {
            console.log(`[CACHE HIT] ${result.products.length} produtos`);
            return result.products;
        }
        return null;
    } catch (e) {
        return null;
    }
}

// ============================================
// APIS GRATUITAS IMPLEMENTADAS
// ============================================

// ============================================
// SISTEMA DE FALLBACK INTELIGENTE (100% GRATUITO)
// ============================================

// ============================================
// FUNÇÕES DE SINCRONIZAÇÃO COM JSONBIN
// ============================================

async function fetchFullDatabase() {
    try {
        const isConfigured = API_CONFIG.JSONBIN_BIN_ID !== 'INSIRA_AQUI_O_ID_DE_24_CARACTERES';
        if (!isConfigured) return null;

        const url = `https://api.jsonbin.io/v3/b/${API_CONFIG.JSONBIN_BIN_ID}/latest`;
        const response = await fetch(url, {
            headers: { 'X-Master-Key': API_CONFIG.JSONBIN_KEY }
        });
        
        if (!response.ok) throw new Error(`Erro ao buscar banco: ${response.status}`);
        
        const data = await response.json();
        fullDatabase = data.record; 
        
        console.log('[DATABASE] Sincronizado:', {
            produtos: fullDatabase.products?.length || 0,
            usuarios: fullDatabase.users?.length || 0
        });
        
        return fullDatabase;
    } catch (e) {
        console.error('[DATABASE] Erro:', e);
        return null;
    }
}

async function updateFullDatabase(newData) {
    if (syncInProgress) return false;
    syncInProgress = true;
    
    try {
        const url = `https://api.jsonbin.io/v3/b/${API_CONFIG.JSONBIN_BIN_ID}`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'X-Master-Key': API_CONFIG.JSONBIN_KEY,
                'Content-Type': 'application/json',
                'X-Bin-Versioning': 'false'
            },
            body: JSON.stringify(newData)
        });
        
        if (!response.ok) throw new Error('Erro na atualização remota');
        fullDatabase = newData;
        return true;
    } catch (e) {
        console.error('[DATABASE] Falha no salvamento:', e);
        return false;
    } finally {
        syncInProgress = false;
    }
}

// ============================================
// FUNÇÃO PRINCIPAL DE BUSCA (AUTO-FALLBACK)
// ============================================

async function fetchGoogleShoppingProducts(query, onProgress, onSourceUpdate) {
    try {
        if (typeof onProgress === 'function') onProgress(30);
        
        // Se o banco completo não estiver carregado, busca agora
        if (!fullDatabase) {
            await fetchFullDatabase();
        }
        
        if (typeof onProgress === 'function') onProgress(70);

        // Se ainda não temos banco (não configurado), usamos o arquivo local
        if (!fullDatabase) {
            const response = await fetch('products.json');
            const data = await response.json();
            return data;
        }

        let products = fullDatabase.products || [];
        const info = getSavedCadastro();

        // Se o usuário logado for um VENDEDOR, ele vê apenas os SEUS produtos em toda a plataforma
        if (info && info.tipo === 'VENDEDOR') {
            products = products.filter(p => p.vendedor_id === info.id);
        }

        // Aplica o filtro de busca ou categoria se o termo não for o padrão
        if (query && query !== 'eletronicos') {
            products = products.filter(p => 
                p.titulo.toLowerCase().includes(query.toLowerCase()) || 
                p.loja.toLowerCase().includes(query.toLowerCase())
            );
        }

        if (typeof onProgress === 'function') onProgress(100);
        return products;
    } catch (e) {
        console.error("Erro na busca de produtos:", e);
        return [];
    }
}

// ============================================
// UTILITÁRIOS E RENDERIZAÇÃO
// ============================================

function removeDuplicates(products) {
    const seen = new Set();
    return products.filter(product => {
        const normalizedTitle = product.titulo?.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 30);
        const key = `${normalizedTitle}_${product.loja}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function getProductKey(item) {
    if (!item) return '';
    if (item.productKey) return item.productKey;
    const rawId = item.id || item.titulo || '';
    const normalized = rawId.toString().trim().toLowerCase();
    return item.productKey = btoa(unescape(encodeURIComponent(normalized))).substring(0, 26);
}

function prepareProducts(products) {
    return removeDuplicates(products || []).map(item => ({
        ...item,
        productKey: getProductKey(item)
    }));
}

function getSavedCadastro() {
    try {
        const stored = localStorage.getItem('holandesVoadorCadastro');
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        return null;
    }
}

async function updateShippingAddress() {
    const info = getSavedCadastro();
    const label = document.getElementById('shippingLabel');
    if (!label) return;

    if (info?.endereco && info?.cidade && info?.estado) {
        label.textContent = `${info.endereco}, ${info.cidade} - ${info.estado}`;
    } else if (info?.endereco) {
        label.textContent = info.endereco;
    } else {
        // Fallback para visitantes: tenta detectar localização por IP
        try {
            // ipapi.co fornece cidade e região com base no IP de quem acessa
            const response = await fetch('https://ipapi.co/json/');
            const data = await response.json();
            
            if (data.city && data.region_code) {
                label.textContent = `${data.city}, ${data.region_code}`;
            } else {
                label.textContent = 'Sua região';
            }
        } catch (e) {
            console.warn("Não foi possível obter a localização por IP:", e);
            label.textContent = 'Sua região';
        }
    }
}

function updateVisibilityByRole() {
    const info = getSavedCadastro();
    const isLoggedIn = !!info;
    const role = info?.tipo || 'CLIENTE';

    const clientItems = document.querySelectorAll('.role-client');
    const sellerItems = document.querySelectorAll('.role-seller');
    const adminItems = document.querySelectorAll('.role-admin');
    const guestItems = document.querySelectorAll('.role-guest');
    const loggedInItems = document.querySelectorAll('.role-logged-in');

    guestItems.forEach(el => el.classList.toggle('d-none', isLoggedIn));
    loggedInItems.forEach(el => el.classList.toggle('d-none', !isLoggedIn));

    // Atualiza Nome e Foto na Navbar principal
    const navName = document.getElementById('navUserName');
    const navAvatar = document.getElementById('navUserAvatar');
    const navIcon = document.getElementById('navUserIcon');
    if (navName && isLoggedIn) {
        navName.textContent = info.nome.split(' ')[0];
        if (info.avatar) {
            navAvatar.src = info.avatar;
            navAvatar.style.display = 'block';
            navIcon.style.display = 'none';
        } else {
            navAvatar.style.display = 'none';
            navIcon.style.display = 'block';
        }
    }

    const mobileName = document.getElementById('mobileWelcomeName');
    if (mobileName) {
        mobileName.textContent = isLoggedIn ? `Olá, ${info.nome.split(' ')[0]}` : 'Bem-vindo';
    }
    const mobileProfileHeader = document.getElementById('mobileProfileHeader');
    if (mobileProfileHeader) {
        mobileProfileHeader.innerHTML = (isLoggedIn && info.avatar) ? 
            `<img src="${info.avatar}" class="rounded-circle" width="50" height="50" style="object-fit: cover;">` : 
            `<i class="bi bi-person-circle fs-1 text-dark"></i>`;
    }

    const heroTitle = document.getElementById('heroTitle');
    const heroSubtitle = document.getElementById('heroSubtitle');
    const heroCategories = document.getElementById('heroCategories');
    const gridTitle = document.getElementById('gridTitle');
    
    if (heroTitle) {
        heroTitle.textContent = role === 'VENDEDOR' ? 'Painel do Vendedor' : 'Encontre o melhor preço em eletrônicos';
    }
    if (heroSubtitle) {
        heroSubtitle.textContent = role === 'VENDEDOR' 
            ? 'Gerencie seu estoque, acompanhe suas vendas e publique novos anúncios para seus clientes.' 
            : 'Navegue por ofertas, compare preços e descubra produtos com frete rápido.';
    }
    if (heroCategories) {
        heroCategories.classList.toggle('d-none', role === 'VENDEDOR');
    }
    if (gridTitle) {
        gridTitle.textContent = role === 'VENDEDOR' ? 'Meu Estoque' : 'Recomendados para você';
    }

    if (role === 'VENDEDOR') {
        clientItems.forEach(el => el.classList.add('d-none'));
        sellerItems.forEach(el => el.classList.remove('d-none'));
        adminItems.forEach(el => el.classList.add('d-none'));
    } else if (role === 'ADMIN') {
        clientItems.forEach(el => el.classList.remove('d-none'));
        sellerItems.forEach(el => el.classList.remove('d-none'));
        adminItems.forEach(el => el.classList.remove('d-none'));
    } else {
        clientItems.forEach(el => el.classList.remove('d-none'));
        sellerItems.forEach(el => el.classList.add('d-none'));
        adminItems.forEach(el => el.classList.add('d-none'));
    }
    if (typeof renderNotifications === 'function') renderNotifications();
}

function addNotification(titulo, texto, icone = 'bi-info-circle', cor = 'primary') {
    const info = getSavedCadastro();
    if (!info) return;

    // Busca notificações existentes ou cria array vazio
    let notifications = JSON.parse(localStorage.getItem(`notifications_${info.id}`)) || [];
    
    const newNotif = {
        id: Date.now(),
        titulo,
        texto,
        icone,
        cor,
        data: new Date().toISOString()
    };
    
    // Adiciona ao início da lista e limita a 50 itens
    notifications.unshift(newNotif);
    localStorage.setItem(`notifications_${info.id}`, JSON.stringify(notifications.slice(0, 50)));
    
    renderNotifications();
}

function renderNotifications() {
    const info = getSavedCadastro();
    const container = document.getElementById('notificacoesList');
    const badgeDesktop = document.getElementById('notifBadgeDesktop');
    const badgeMobile = document.getElementById('notifBadgeMobile');

    if (!container || !info) {
        if (badgeDesktop) badgeDesktop.textContent = '0';
        if (badgeMobile) badgeMobile.textContent = '0';
        return;
    }

    const notifications = JSON.parse(localStorage.getItem(`notifications_${info.id}`)) || [];

    if (notifications.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-muted small">Nenhuma atividade recente.</div>';
    } else {
        container.innerHTML = notifications.map(n => {
            const time = new Date(n.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            return `
            <div class="list-group-item border-0 p-3">
                <div class="d-flex gap-3">
                    <div class="bg-${n.cor} bg-opacity-10 p-2 rounded-circle text-${n.cor}" style="width: 35px; height: 35px; display: flex; align-items: center; justify-content: center;">
                        <i class="bi ${n.icone}"></i>
                    </div>
                    <div class="flex-grow-1">
                        <div class="d-flex justify-content-between align-items-center">
                            <h6 class="mb-0 fw-bold small">${n.titulo}</h6>
                            <small class="text-muted" style="font-size: 0.65rem;">${time}</small>
                        </div>
                        <p class="mb-0 text-muted" style="font-size: 0.75rem;">${n.texto}</p>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    const count = notifications.length;
    if (badgeDesktop) badgeDesktop.textContent = count;
    if (badgeMobile) badgeMobile.textContent = count;
}

window.logout = function() {
    localStorage.removeItem('holandesVoadorCadastro');
    location.reload();
};

async function handleAnnounceSubmit(event) {
    event.preventDefault();
    const userInfo = getSavedCadastro();
    if (!userInfo) return;

    const announceData = {
        id: `prod_${Date.now()}`,
        titulo: document.getElementById('prodTitle')?.value.trim(),
        descricao: document.getElementById('prodDescription')?.value.trim(),
        preco: parseFloat(document.getElementById('prodPrice')?.value) || 0,
        quantidade: parseInt(document.getElementById('prodQuantity')?.value) || 0,
        categoria: document.getElementById('prodCategory')?.value,
        realizaEntrega: document.getElementById('prodDelivery')?.checked,
        img: document.getElementById('prodImage')?.value || 'https://via.placeholder.com/400',
        loja: userInfo.nome,
        vendedor_id: userInfo.id,
        created_at: new Date().toISOString()
    };

    if (fullDatabase) {
        fullDatabase.products = fullDatabase.products || [];
        fullDatabase.products.push(announceData);
        const success = await updateFullDatabase(fullDatabase);
        if (success) {
            addNotification("Novo Anúncio", `Você publicou o produto: ${announceData.titulo}`, "bi-plus-circle", "warning");
            alert('Produto anunciado com sucesso!');
            bootstrap.Modal.getInstance(document.getElementById('announceModal'))?.hide();
            loadPage('eletronicos');
        }
    }
}

async function handleLoginSubmit(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail')?.value.trim();
    const pass = document.getElementById('loginPass')?.value;
    const passHash = btoa(pass || ''); // Transforma a senha em hash para comparar com o banco

    // Garante que o banco de dados completo (JSONBin) esteja carregado
    if (!fullDatabase) {
        await fetchFullDatabase();
    }

    if (fullDatabase && fullDatabase.users) {
        // Busca o usuário no banco global pelo email e pela senha (hash)
        const user = fullDatabase.users.find(u => u.email === email && u.senha_hash === passHash);

        if (user) {
            // Se encontrou, salva no localStorage para manter a sessão ativa neste navegador
            localStorage.setItem('holandesVoadorCadastro', JSON.stringify(user));
            
            updateShippingAddress();
            updateVisibilityByRole();
            
            addNotification("Acesso", `Bem-vindo de volta, ${user.nome}!`, "bi-person-check", "primary");
            bootstrap.Modal.getInstance(document.getElementById('loginModal'))?.hide();
            document.getElementById('loginForm')?.reset();
            alert(`Bem-vindo de volta, ${user.nome}!`);
            return;
        }
    }
    
    // Se chegou aqui, não encontrou ou a senha está errada
    alert("E-mail ou senha inválidos.");
}

async function handleCadastroSubmit(event) {
    event.preventDefault();
    
    const nome = document.getElementById('cadastroNome')?.value.trim();
    const email = document.getElementById('cadastroEmail')?.value.trim();
    const cpf = document.getElementById('cadastroCPF')?.value.trim();

    // Garante que o banco de dados esteja carregado para a verificação
    if (!fullDatabase) {
        await fetchFullDatabase();
    }

    // Verifica se o e-mail ou CPF já existem no banco global
    if (fullDatabase && fullDatabase.users) {
        const existe = fullDatabase.users.some(u => u.email === email || u.cpf === cpf);
        if (existe) {
            alert('Erro: Este e-mail ou CPF já está cadastrado em nossa plataforma!');
            return;
        }
    }

    const cadastroData = {
        id: `user_${Date.now()}`,
        tipo: document.querySelector('input[name="cadastroTipo"]:checked')?.value || 'CLIENTE',
        nome: nome,
        cpf: cpf,
        email: email,
        endereco: document.getElementById('cadastroEndereco')?.value.trim(),
        cep: document.getElementById('cadastroCEP')?.value.trim(),
        cidade: document.getElementById('cadastroCidade')?.value.trim(),
        estado: document.getElementById('cadastroEstado')?.value,
        pagamento: document.getElementById('cadastroPagamento')?.value,
        senha_hash: btoa(document.getElementById('cadastroSenha')?.value || '')
    };

    // Salva localmente para persistência na sessão atual
    localStorage.setItem('holandesVoadorCadastro', JSON.stringify(cadastroData));

    // Sincroniza o novo usuário com o banco na nuvem (JSONBin)
    if (fullDatabase) {
        fullDatabase.users = fullDatabase.users || [];
        fullDatabase.users.push(cadastroData);
        await updateFullDatabase(fullDatabase);
    }

    updateShippingAddress();
    updateVisibilityByRole();

    const modal = bootstrap.Modal.getInstance(document.getElementById('cadastroModal'));
    addNotification("Boas-vindas", "Sua conta foi criada com sucesso no ElectroMarket!", "bi-stars", "success");
    if (modal) modal.hide();
    document.getElementById('cadastroForm')?.reset();
    alert(`Bem-vindo, ${nome}! Cadastro realizado com sucesso.`);
}

// ============================================
// FUNÇÕES DE ADMINISTRAÇÃO DO BANCO (JSONBIN)
// ============================================

async function initializeJsonDatabase() {
    const btn = document.getElementById('btnInitDb');
    if (!btn) return;

    try {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Sincronizando...';

        // 1. Pega os dados locais de produtos
        const responseLocal = await fetch('products.json');
        const products = await responseLocal.json();

        // 2. Cria a estrutura do banco completo
        const skeletonDatabase = {
            database_version: "1.0.0",
            last_updated: new Date().toISOString(),
            products: products,
            users: [],
            orders: [],
            announcements: [],
            notifications: [],
            site_config: { featured_products: [], banners: [], categories: [] }
        };

        // 3. Envia para o JSONBin.io
        const success = await updateFullDatabase(skeletonDatabase);
        if (!success) throw new Error('Falha ao gravar no servidor.');

        alert('Banco de dados inicializado com sucesso!');
        bootstrap.Modal.getInstance(document.getElementById('adminDbModal'))?.hide();
        loadPage('eletronicos');
    } catch (e) {
        alert('Erro ao sincronizar: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'CRIAR / ATUALIZAR BANCO';
    }
}

function getSavedTheme() {
    return localStorage.getItem('holandesVoadorTheme') || 'light';
}

function updateThemeIcon() {
    const theme = getSavedTheme();
    const icon = theme === 'dark' ? 'bi-sun' : 'bi-moon-stars';
    document.querySelectorAll('#themeToggle i, #themeToggleMobile i').forEach(el => {
        el.className = `bi ${icon}`;
    });
}

function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.body.classList.toggle('dark-theme', isDark);
    localStorage.setItem('holandesVoadorTheme', theme);
    updateThemeIcon();
}

function toggleTheme() {
    const current = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
    applyTheme(current);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function renderCard(item) {
    if (!item || !item.titulo) return '';
    
    // Formatação de preço estilo ML
    const precoInteiro = Math.floor(item.preco || 0).toLocaleString('pt-BR');
    const precoCentavos = ((item.preco || 0) % 1).toFixed(2).substring(2);
    
    const precoOriginalFormatado = item.preco_original 
        ? item.preco_original.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
        : null;
    
    const productId = getProductKey(item);
    const info = getSavedCadastro();
    const isSeller = info?.tipo === 'VENDEDOR';

    const productImg = item.img 
        ? `<img src="${item.img}" alt="${item.titulo}">`
        : `<div class="img-placeholder-icon">
             <i class="bi bi-box-seam"></i>
             <span class="small" style="font-size: 10px;">Sem foto</span>
           </div>`;

    const sellerMeta = isSeller ? `
        <div class="mt-2 border-top pt-2" style="font-size: 12px; color: var(--text-muted);">
            <div class="d-flex justify-content-between mb-1">
                <span>Estoque: <strong>${item.quantidade || 0}</strong></span>
            </div>
            <div>Cat: <span class="badge bg-light text-dark border fw-normal">${item.categoria || 'Geral'}</span></div>
        </div>
    ` : '';
    
    return `
        <div class="card product-card-ml" onclick="window.showProductDetail('${productId}')">
            <div class="overlay">
                <button class="btn btn-action" onclick="event.stopPropagation(); window.toggleLike('${productId}')" title="Curtir">
                    <i class="bi bi-heart"></i>
                </button>
                <button class="btn btn-action" onclick="event.stopPropagation(); window.shareProduct('${productId}')" title="Compartilhar">
                    <i class="bi bi-share"></i>
                </button>
            </div>

            <div class="product-card-img-container">
                ${productImg}
            </div>
            
            <div class="card-body product-card-body">
                <p class="product-title-grid">
                    ${item.titulo}
                </p>
                
                ${precoOriginalFormatado ? `<span class="preco-antigo text-decoration-line-through small text-muted">R$ ${precoOriginalFormatado}</span>` : ''}
                
                <div class="price-container mb-2">
                    <h3 class="current-price">R$ ${precoInteiro}<small style="font-size: 12px; vertical-align: super;">${precoCentavos}</small></h3>
                </div>

                <div class="shipping-tag ${item.realizaEntrega ? 'text-success' : 'text-muted'} small fw-bold">
                    <i class="bi ${item.realizaEntrega ? 'bi-truck' : 'bi-geo-alt'}"></i> 
                    ${item.realizaEntrega ? 'Realiza entrega' : 'Apenas retirada'}
                </div>
                ${sellerMeta}
            </div>
        </div>
    `;
}

// ============================================
// MODAL E INTERAÇÃO
// ============================================

window.showProductDetail = function(productId) {
    const item = allProductsCache.find(p => String(p.productKey) === String(productId) || String(p.id) === String(productId));
    if (!item) return;
    
    const modalContent = document.getElementById('productDetailContent');
    const precoFormatado = item.preco 
        ? item.preco.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
        : '---';
    
    const precoOriginalFormatado = item.preco_original 
        ? item.preco_original.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
        : null;
    
    const isDemo = item.isMock || item.source === 'DEMO';
    
    const alertDemo = isDemo 
        ? `<div class="alert alert-warning alert-dismissible fade show" role="alert">
             <i class="bi bi-exclamation-triangle-fill me-2"></i>
             <strong>Modo Demonstração:</strong> Dados simulados. Clique "Ver no Google Shopping" para preços reais.
             <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
           </div>`
        : '';
    
    modalContent.innerHTML = `
        <div class="row g-4">
            <div class="col-md-5">
                <div class="position-relative">
                    <img src="${item.img || 'https://via.placeholder.com/400'}" 
                         class="img-fluid rounded border w-100" 
                         style="object-fit: contain; max-height: 400px;">
                    ${item.tag ? `<span class="badge bg-danger position-absolute top-0 end-0 m-2 fs-6">${item.tag}</span>` : ''}
                </div>
            </div>
            <div class="col-md-7">
                ${alertDemo}
                
                <div class="d-flex align-items-center gap-2 mb-3" style="font-family: 'Sora', sans-serif;">
                    <span class="badge" style="background-color: var(--market-color);">Vendedor: ${item.loja}</span>
                    <span class="badge bg-secondary">Novo</span>
                    ${item.source && item.source !== 'DEMO' ? `<span class="badge bg-info">Via ${item.source}</span>` : ''}
                </div>
                
                <h4 class="mb-3 fw-bold">${item.titulo}</h4>
                
                <div class="d-flex align-items-center mb-2">
                    <span class="text-warning fs-4 me-2">${'★'.repeat(Math.floor(item.rating || 0))}</span>
                    <span class="text-muted small">(${item.reviews || 0} avaliações)</span>
                </div>

                <div class="text-muted small mb-3">
                    Disponível em estoque: <strong>${item.quantidade || 0} unidades</strong>
                </div>
                
                <div class="mb-4">
                    ${precoOriginalFormatado ? `<h4 class="text-muted text-decoration-line-through mb-0">R$ ${precoOriginalFormatado}</h4>` : ''}
                    <h2 class="fw-bold mb-2" style="color: var(--text-main);">R$ ${precoFormatado}</h2>
                    <div class="${item.realizaEntrega ? 'text-success' : 'text-warning'} fw-bold small">
                        <i class="bi ${item.realizaEntrega ? 'bi-truck' : 'bi-geo-alt'}"></i> 
                        ${item.realizaEntrega ? 'Este vendedor realiza entregas' : 'Disponível apenas para retirada'}
                    </div>
                </div>

                <div class="p-3 rounded mb-4 border bg-opacity-10" style="background-color: var(--bg-color);">
                    <h6 class="fw-bold small mb-2 text-uppercase">Descrição do produto</h6>
                    <p class="mb-0 small text-secondary" style="white-space: pre-line;">${item.descricao || 'O vendedor não forneceu uma descrição detalhada para este item.'}</p>
                </div>
                
                <div class="d-grid gap-2">
                    <button class="btn btn-primary btn-lg py-3 fw-bold">COMPRAR AGORA</button>
                    <button class="btn btn-outline-primary btn-lg py-3 fw-bold" onclick="window.addToCart('${item.productKey}')">ADICIONAR AO CARRINHO</button>
                </div>

                <div class="d-flex justify-content-center mt-3 gap-4">
                    <button class="btn btn-link text-decoration-none text-danger fw-bold p-0" onclick="window.toggleLike('${productId}')">
                        <i class="bi bi-heart me-1"></i> Curtir
                    </button>
                    <button class="btn btn-link text-decoration-none text-secondary fw-bold p-0" onclick="window.shareProduct('${productId}')">
                        <i class="bi bi-share me-1"></i> Compartilhar
                    </button>
                </div>
            </div>
        </div>
    `;
    
    const modal = new bootstrap.Modal(document.getElementById('productDetailModal'));
    modal.show();
};

// ============================================
// FILTROS E UI
// ============================================

function applyFilters() {
    const min = parseFloat(document.getElementById('minPrice')?.value) || 0;
    const max = parseFloat(document.getElementById('maxPrice')?.value) || Infinity;
    const sort = document.getElementById('sortOrder')?.value || 'default';
    
    const selectedStores = Array.from(document.querySelectorAll('.store-checkbox:checked')).map(cb => cb.value);
    
    let filtered = allProductsCache.filter(p => {
        const priceMatch = (p.preco || 0) >= min && (p.preco || 0) <= max;
        const storeMatch = selectedStores.length === 0 || selectedStores.includes(p.loja);
        return priceMatch && storeMatch;
    });

    // Lógica de Ordenação
    if (sort === 'recent') {
        // Ordena por data de criação (do mais novo para o mais antigo)
        filtered.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    } else if (sort === 'rating') {
        // Ordena por nota de avaliação (do maior para o menor)
        filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sort === 'priceAsc') {
        filtered.sort((a, b) => (a.preco || 0) - (b.preco || 0));
    } else if (sort === 'priceDesc') {
        filtered.sort((a, b) => (b.preco || 0) - (a.preco || 0));
    }
    
    renderFilteredGrid(filtered);
}

function renderFilteredGrid(products) {
    const grid = document.getElementById('productsGrid');
    
    if (!products || products.length === 0) {
        grid.innerHTML = `
            <div class="col-12 d-flex align-items-center justify-content-center py-5" style="min-height: 50vh;">
                <div class="card border-0 shadow-sm p-5 text-center" style="max-width: 600px; width: 100%; background: #fff; border-radius: 12px;">
                    <i class="bi bi-search mb-3" style="font-size: 3rem; color: #131673;"></i>
                    <h5 style="color: #131673; font-family: 'Sora', sans-serif; font-weight: 600;">Nenhum produto encontrado</h5>
                    <p class="text-muted small mb-4">Não encontramos resultados para sua busca ou filtros atuais.</p>
                    <button class="btn btn-primary rounded-pill px-4" style="background-color: #3a81f8; border: none; font-family: 'Sora', sans-serif;" onclick="clearFilters()">Limpar Filtros</button>
                </div>
            </div>`;
        return;
    }
    
    let html = '';
    if (products.some(p => p.isMock || p.source === 'DEMO')) {
        html += `
            <div class="col-12 mb-4">
                <div class="alert alert-info alert-dismissible fade show" role="alert">
                    <div class="d-flex align-items-center">
                        <i class="bi bi-info-circle-fill fs-4 me-3"></i>
                        <div>
                            <strong>💡 Dica:</strong> Configure uma API gratuita para obter dados reais do Google Shopping.
                            <a href="#" onclick="showApiSetupModal(); return false;" class="alert-link">Clique aqui para ver opções</a>
                        </div>
                    </div>
                    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
                </div>
            </div>`;
    }
    
    html += products.map(item => renderCard(item)).join('');
    
    grid.innerHTML = html;
}

function updateStoreFilterUI() {
    const storeContainer = document.getElementById('storeFilters');
    if (!storeContainer) return;
    
    const stores = [...new Set(allProductsCache.map(p => p.loja).filter(Boolean))];
    
    storeContainer.innerHTML = stores.map(store => {
        const safeId = `store-${store.replace(/[^a-zA-Z0-9]/g, '-')}`;
        return `
        <div class="form-check mb-2">
            <input class="form-check-input store-checkbox" type="checkbox" value="${store}" 
                   id="${safeId}" onchange="applyFilters()" checked>
            <label class="form-check-label" for="${safeId}">${store}</label>
        </div>
    `;
    }).join('');
}

function clearFilters() {
    document.getElementById('minPrice').value = '';
    document.getElementById('maxPrice').value = '';
    if (document.getElementById('sortOrder')) document.getElementById('sortOrder').value = 'default';
    document.querySelectorAll('.store-checkbox').forEach(cb => cb.checked = true);
    renderFilteredGrid(allProductsCache);
}

// ============================================
// CARREGAMENTO PRINCIPAL
// ============================================

function syncThemeSwitch() {
    const themeSwitch = document.getElementById('themeSwitchMobile');
    if (themeSwitch) {
        themeSwitch.checked = document.body.classList.contains('dark-theme');
    }
}

window.closeMobileMenu = function() {
    const menuEl = document.getElementById('mobileMenu');
    if (menuEl) {
        const offcanvas = bootstrap.Offcanvas.getInstance(menuEl);
        if (offcanvas) {
            offcanvas.hide();
        }
    }
    
    // Limpeza forçada de backdrops residuais (comum em SPAs ou transições rápidas)
    const backdrops = document.querySelectorAll('.offcanvas-backdrop');
    backdrops.forEach(b => b.remove());
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
};

async function loadPage(query = 'eletronicos') {
    const grid = document.getElementById('productsGrid');
    const searchInput = document.getElementById('searchInput');
    
    if (searchInput && document.activeElement !== searchInput) {
        searchInput.value = query === 'eletronicos' ? '' : query;
    }
    
    grid.innerHTML = `
        <div class="col-12 d-flex align-items-center justify-content-center py-5" style="min-height: 50vh;">
            <div class="card border-0 shadow-sm p-5 text-center" style="max-width: 600px; width: 100%; background: #fff; border-radius: 12px;">
                <div class="spinner-border mb-3" style="width: 3rem; height: 3rem; color: #131673;"></div>
                <h5 style="color: #131673; font-family: 'Sora', sans-serif; font-weight: 600;">Sincronizando ofertas em tempo real...</h5>
                <div class="progress mb-3" style="height: 8px;">
                    <div id="loadingBar" class="progress-bar progress-bar-striped progress-bar-animated" style="width: 0%; background-color: #131673;"></div>
                </div>
                <div id="statusLogs" class="d-flex flex-wrap justify-content-center gap-2"></div>
            </div>
        </div>`;
    
    const loadingBar = document.getElementById('loadingBar');
    const statusLogs = document.getElementById('statusLogs');
    
    const updateProgress = (percent) => {
        if (loadingBar) loadingBar.style.width = percent + '%';
    };
    
    const updateSourceStatus = (name, status, count = 0) => {
        if (!statusLogs) return;
        
        const icons = {
            success: '✓', error: '✗', empty: '○', 
            loading: '⟳', active: '●', fallback: '⚠'
        };
        
        const colors = {
            success: 'success', error: 'danger', empty: 'warning',
            loading: 'primary', active: 'info', fallback: 'secondary'
        };
        
        const id = `status-${name.replace(/\s/g, '')}`;
        let existing = document.getElementById(id);
        
        const badgeClass = `badge bg-${colors[status]} bg-opacity-10 text-${colors[status]} border`;
        const text = status === 'success' ? `${name}: ${count}` : 
                    status === 'active' ? `${name}: Ativo` : name;
        
        if (existing) {
            existing.className = `${badgeClass} ${status === 'loading' ? 'animate-pulse' : ''}`;
            existing.innerHTML = `${icons[status]} ${text}`;
        } else {
            statusLogs.insertAdjacentHTML('beforeend', 
                `<span id="${id}" class="${badgeClass}">${icons[status]} ${text}</span>`);
        }
    };
    
    try {
        allProductsCache = prepareProducts(await fetchGoogleShoppingProducts(query, updateProgress, updateSourceStatus));
        updateStoreFilterUI();
        renderFilteredGrid(allProductsCache);
        window.closeMobileMenu();
    } catch (e) {
        console.error('Erro:', e);
        grid.innerHTML = `
            <div class="col-12 d-flex align-items-center justify-content-center py-5" style="min-height: 50vh;">
                <div class="card border-0 shadow-sm p-5 text-center" style="max-width: 600px; width: 100%; background: #fff; border-radius: 12px;">
                    <i class="bi bi-exclamation-triangle-fill mb-3" style="font-size: 3rem; color: #e63946;"></i>
                    <h5 style="color: #131673; font-family: 'Sora', sans-serif; font-weight: 600;">Erro ao sincronizar</h5>
                    <p class="text-muted small mb-4">Ocorreu uma falha ao carregar as ofertas. Por favor, tente novamente.</p>
                    <button class="btn btn-primary rounded-pill px-4" style="background-color: #131673; border: none; font-family: 'Sora', sans-serif;" onclick="loadPage('${query}')">Tentar Novamente</button>
                </div>
            </div>`;
    }
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupSearchListeners() {
    const btnSearch = document.getElementById('btnSearch');
    const searchInput = document.getElementById('searchInput');
    
    if (btnSearch) {
        btnSearch.addEventListener('click', () => {
            loadPage(searchInput?.value?.trim() || 'eletronicos');
        });
    }
    
    if (searchInput) {
        const debouncedSearch = debounce((value) => {
            if (value.length >= 3) loadPage(value);
        }, 800);
        
        searchInput.addEventListener('input', (e) => debouncedSearch(e.target.value));
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadPage(e.target.value.trim() || 'eletronicos');
        });
    }
}

// Modal de configuração de APIs
window.showApiSetupModal = function() {
    const modalHtml = `
        <div class="modal fade" id="apiSetupModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">🔑 APIs Gratuitas Disponíveis</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-4">Escolha uma das opções abaixo para obter dados reais do Google Shopping:</p>
                        
                        <div class="list-group">
                            <a href="https://hasdata.com" target="_blank" class="list-group-item list-group-item-action">
                                <div class="d-flex w-100 justify-content-between">
                                    <h6 class="mb-1">HasData</h6>
                                    <span class="badge bg-success">100/mês grátis</span>
                                </div>
                                <p class="mb-1 small">Sem cartão de crédito. Cadastro rápido.</p>
                            </a>
                            
                            <a href="https://serpstack.com" target="_blank" class="list-group-item list-group-item-action">
                                <div class="d-flex w-100 justify-content-between">
                                    <h6 class="mb-1">SerpStack</h6>
                                    <span class="badge bg-success">100/mês grátis</span>
                                </div>
                                <p class="mb-1 small">API simples e confiável.</p>
                            </a>
                            
                            <a href="https://www.searchapi.io" target="_blank" class="list-group-item list-group-item-action">
                                <div class="d-flex w-100 justify-content-between">
                                    <h6 class="mb-1">SearchAPI.io</h6>
                                    <span class="badge bg-success">100 créditos</span>
                                </div>
                                <p class="mb-1 small">Sem cartão, cancelamento anytime.</p>
                            </a>
                            
                            <a href="https://www.scraperapi.com" target="_blank" class="list-group-item list-group-item-action">
                                <div class="d-flex w-100 justify-content-between">
                                    <h6 class="mb-1">ScraperAPI</h6>
                                    <span class="badge bg-warning text-dark">5.000 teste</span>
                                </div>
                                <p class="mb-1 small">Requer cartão mas tem trial generoso.</p>
                            </a>
                            
                            <a href="https://serpapi.com" target="_blank" class="list-group-item list-group-item-action">
                                <div class="d-flex w-100 justify-content-between">
                                    <h6 class="mb-1">SerpApi</h6>
                                    <span class="badge bg-success">250/mês grátis</span>
                                </div>
                                <p class="mb-1 small">Mais popular, documentação excelente.</p>
                            </a>
                        </div>
                        
                        <div class="alert alert-info mt-4">
                            <strong>Como configurar:</strong><br>
                            1. Cadastre-se em um dos serviços acima<br>
                            2. Copie sua API Key<br>
                            3. Cole no topo deste arquivo em <code>API_CONFIG</code>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remove modal anterior se existir
    const existing = document.getElementById('apiSetupModal');
    if (existing) existing.remove();
    
    // Adiciona e mostra
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = new bootstrap.Modal(document.getElementById('apiSetupModal'));
    modal.show();
};


// ============================================
// SISTEMA DE PERFIL
// ============================================

window.showProfileEdit = function() {
    const info = getSavedCadastro();
    if (!info) return;

    const offcanvasEl = document.getElementById('profileEditOffcanvas');
    if (!offcanvasEl) return;
    
    const bsOffcanvas = new bootstrap.Offcanvas(offcanvasEl);

    // Preenche o formulário com os dados atuais
    const preview = document.getElementById('profilePreview');
    if (preview) preview.src = info.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(info.nome);
    
    document.getElementById('editAvatar').value = info.avatar || '';
    document.getElementById('editNome').value = info.nome || '';
    document.getElementById('editEmail').value = info.email || '';
    document.getElementById('editCPF').value = info.cpf || '';
    document.getElementById('editEndereco').value = info.endereco || '';
    document.getElementById('editCidade').value = info.cidade || '';
    document.getElementById('editEstado').value = info.estado || '';
    document.getElementById('editPagamento').value = info.pagamento || 'pix';

    bsOffcanvas.show();
};

async function handleProfileUpdate(event) {
    event.preventDefault();
    const info = getSavedCadastro();
    if (!info) return;

    const btn = event.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Salvando...';

    const updatedData = {
        ...info,
        avatar: document.getElementById('editAvatar').value.trim(),
        nome: document.getElementById('editNome').value.trim(),
        endereco: document.getElementById('editEndereco').value.trim(),
        cidade: document.getElementById('editCidade').value.trim(),
        estado: document.getElementById('editEstado').value,
        pagamento: document.getElementById('editPagamento').value
    };

    try {
        // 1. Atualiza LocalStorage
        localStorage.setItem('holandesVoadorCadastro', JSON.stringify(updatedData));

        // 2. Sincroniza com JSONBin
        if (!fullDatabase) {
            await fetchFullDatabase();
        }
        
        if (fullDatabase && fullDatabase.users) {
            const index = fullDatabase.users.findIndex(u => u.id === info.id || u.email === info.email);
            if (index !== -1) {
                fullDatabase.users[index] = updatedData;
                await updateFullDatabase(fullDatabase);
            }
        }

        // 3. Atualiza UI
        updateShippingAddress();
        updateVisibilityByRole();
        
        addNotification("Perfil Atualizado", "Suas informações de conta foram salvas.", "bi-person-gear", "info");
        alert('Perfil atualizado com sucesso!');
        bootstrap.Offcanvas.getInstance(document.getElementById('profileEditOffcanvas'))?.hide();
    } catch (e) {
        console.error(e);
        alert('Erro ao atualizar perfil.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    setupSearchListeners();
    const cadastroForm = document.getElementById('cadastroForm');
    if (cadastroForm) cadastroForm.addEventListener('submit', handleCadastroSubmit);

    const profileEditForm = document.getElementById('profileEditForm');
    if (profileEditForm) profileEditForm.addEventListener('submit', handleProfileUpdate);

    const editAvatarInput = document.getElementById('editAvatar');
    if (editAvatarInput) {
        editAvatarInput.addEventListener('input', (e) => {
            const preview = document.getElementById('profilePreview');
            if (preview) preview.src = e.target.value || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(document.getElementById('editNome').value);
        });
    }

    const announceForm = document.getElementById('announceForm');
    if (announceForm) announceForm.addEventListener('submit', handleAnnounceSubmit);

    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

    const themeToggle = document.getElementById('themeToggle');
    const themeToggleMobile = document.getElementById('themeToggleMobile');
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
    if (themeToggleMobile) themeToggleMobile.addEventListener('click', toggleTheme);

    applyTheme(getSavedTheme());
    updateShippingAddress();
    updateVisibilityByRole();
    renderCart(); // Inicializa e exibe o estado atual do carrinho

    // Configura o evento do botão de administração
    const btnInit = document.getElementById('btnInitDb');
    if (btnInit) btnInit.addEventListener('click', initializeJsonDatabase);
    
    const mobileMenu = document.getElementById('mobileMenu');
    if (mobileMenu) {
        mobileMenu.addEventListener('shown.bs.offcanvas', syncThemeSwitch);
    }
    loadPage('eletronicos');
});

function updateCartBadge() {
    cartCount = cart.reduce((acc, item) => acc + (item.qtd || 1), 0);
    const badges = [document.getElementById('cartBadgeDesktop'), document.getElementById('cartBadgeMobile')];
    badges.forEach(badge => {
        if (badge) {
            badge.textContent = cartCount;
            badge.classList.toggle('d-none', cartCount === 0);
        }
    });
}

window.renderCart = function() {
    const list = document.getElementById('cartItemsList');
    const totalEl = document.getElementById('cartTotalValue');
    if (!list) return;

    if (cart.length === 0) {
        list.innerHTML = `<div class="text-center py-5 text-muted"><i class="bi bi-cart-x fs-1 d-block mb-3"></i>Seu carrinho está vazio</div>`;
        totalEl.textContent = 'R$ 0,00';
        updateCartBadge();
        return;
    }

    let total = 0;
    list.innerHTML = cart.map((item, index) => {
        total += item.preco * (item.qtd || 1);
        return `
        <div class="cart-item border rounded p-2 mb-2">
            <div class="d-flex gap-3 align-items-center">
                <img src="${item.img}" class="cart-item-img border rounded">
                <div class="flex-grow-1 overflow-hidden">
                    <div class="cart-item-title text-truncate-2">${item.titulo}</div>
                    <div class="fw-bold text-success">R$ ${item.preco.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                    <div class="small text-muted">Qtd: ${item.qtd || 1}</div>
                </div>
            </div>
            <div class="d-flex justify-content-between mt-2 gap-2">
                <button class="btn btn-sm btn-outline-danger flex-grow-1" onclick="window.removeFromCart(${index})"><i class="bi bi-trash"></i></button>
                <button class="btn btn-sm btn-success flex-grow-1" onclick="window.finalizarCompraMock(${index})"><i class="bi bi-bag-check"></i> Comprar</button>
            </div>
        </div>`;
    }).join('');

    totalEl.textContent = `R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    updateCartBadge();
    localStorage.setItem('holandesVoadorCart', JSON.stringify(cart));
};

// ============================================
// FUNÇÕES DE INTERAÇÃO E CARRINHO
// ============================================

window.addToCart = function(productId) {
    const product = allProductsCache.find(p => p.productKey === productId);
    if (!product) return;

    const existing = cart.find(item => item.productKey === productId);
    if (existing) {
        existing.qtd = (existing.qtd || 1) + 1;
    } else {
        cart.push({ ...product, qtd: 1 });
    }

    addNotification("Carrinho", `${product.titulo} foi adicionado.`, "bi-cart-plus", "success");
    renderCart();
    
    const cartOffcanvas = document.getElementById('cartOffcanvas');
    if (cartOffcanvas) {
        const bsOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(cartOffcanvas);
        bsOffcanvas.show();
    }
};

window.removeFromCart = function(index) {
    cart.splice(index, 1);
    renderCart();
};

window.toggleLike = function(productId) {
    const product = allProductsCache.find(p => p.productKey === productId);
    const name = product ? product.titulo : 'Produto';
    addNotification("Favorito", `Você curtiu: ${name}`, "bi-heart-fill", "danger");
    alert(`"${name}" adicionado aos seus favoritos!`);
};

window.shareProduct = function(productId) {
    addNotification("Compartilhamento", "Link do produto copiado.", "bi-share", "secondary");
    const url = window.location.href;
    if (navigator.share) {
        navigator.share({
            title: 'ElectroMarket',
            text: 'Olha que oferta legal que encontrei no ElectroMarket!',
            url: url
        }).catch(console.error);
    } else {
        navigator.clipboard.writeText(url).then(() => {
            alert('Link do produto copiado para a área de transferência!');
        });
    }
};
// ============================================
// SISTEMA DE CHAT E PEDIDOS (PÓS-COMPRA)
// ============================================

window.showChat = function(chatId = null) {
    const info = getSavedCadastro();
    if (!info) {
        alert("Faça login para acessar suas mensagens.");
        return;
    }
    const modal = new bootstrap.Modal(document.getElementById('chatModal'));
    modal.show();
    loadChatContacts();
    if (chatId) selectChat(chatId);
};

function loadChatContacts() {
    const info = getSavedCadastro();
    const container = document.getElementById('chatContactsList');
    const userChats = chats.filter(c => c.participants.includes(info.id));

    if (userChats.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-muted small">Nenhuma conversa ativa.</div>';
        return;
    }

    container.innerHTML = userChats.map(chat => {
        const otherUserId = chat.participants.find(id => id !== info.id);
        const otherUserName = chat.sellerId === info.id ? chat.buyerName : chat.sellerName;
        const lastMsg = chat.messages[chat.messages.length - 1];
        
        return `
            <div class="chat-contact-item ${currentChat === chat.id ? 'active' : ''}" onclick="selectChat('${chat.id}')">
                <div class="position-relative">
                    <div class="bg-secondary rounded-circle text-white d-flex align-items-center justify-content-center" style="width: 45px; height: 45px;">
                        ${otherUserName.charAt(0)}
                    </div>
                    <span class="online-indicator position-absolute bottom-0 end-0"></span>
                </div>
                <div class="flex-grow-1 overflow-hidden">
                    <div class="d-flex justify-content-between">
                        <strong class="small text-truncate">${otherUserName}</strong>
                        <small style="font-size: 9px;">${lastMsg ? formatTime(lastMsg.timestamp) : ''}</small>
                    </div>
                    <div class="small text-muted text-truncate">${lastMsg ? lastMsg.text : 'Pedido criado'}</div>
                </div>
            </div>`;
    }).join('');
}

function selectChat(chatId) {
    currentChat = chatId;
    const chat = chats.find(c => c.id === chatId);
    const info = getSavedCadastro();
    
    document.getElementById('chatEmptyState').style.display = 'none';
    document.getElementById('chatActiveContent').style.display = 'flex';
    
    const otherUserName = chat.sellerId === info.id ? chat.buyerName : chat.sellerName;
    document.getElementById('chatPartnerName').textContent = otherUserName;
    document.getElementById('chatPartnerAvatar').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(otherUserName)}&background=random`;

    renderMessages(chat);
    updateOrderStatusBar(chat.orderId);
    loadChatContacts();
}

function renderMessages(chat) {
    const container = document.getElementById('chatMessagesContainer');
    const info = getSavedCadastro();
    
    container.innerHTML = chat.messages.map(msg => {
        if (msg.type === 'system') return `<div class="message-system"><span class="badge">${msg.text}</span></div>`;
        const isMe = msg.senderId === info.id;
        return `
            <div class="chat-message ${isMe ? 'message-sent' : 'message-received'}">
                <div class="message-bubble shadow-sm">
                    <div>${msg.text}</div>
                    <div class="message-time">${formatTime(msg.timestamp)}</div>
                </div>
            </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

window.sendChatMessage = function(e) {
    e.preventDefault();
    const input = document.getElementById('chatMessageInput');
    const text = input.value.trim();
    if (!text || !currentChat) return;

    const info = getSavedCadastro();
    const chat = chats.find(c => c.id === currentChat);
    
    chat.messages.push({
        senderId: info.id,
        text: text,
        timestamp: new Date().toISOString(),
        type: 'message'
    });

    localStorage.setItem('electro_chats', JSON.stringify(chats));
    input.value = '';
    renderMessages(chat);
};

function updateOrderStatusBar(orderId) {
    const order = orders.find(o => o.id === orderId);
    const info = getSavedCadastro();
    const container = document.getElementById('orderStatusBar');
    if (!order) return;

    const steps = ['pending', 'accepted', 'shipped', 'delivered'];
    const currentIdx = steps.indexOf(order.status);
    const isSeller = order.sellerId === info.id;

    let actionBtn = '';
    if (isSeller && order.status === 'pending') {
        actionBtn = `<button class="btn btn-sm btn-success w-100 mt-2" onclick="updateOrderStatus('${orderId}', 'accepted')">Aceitar Pedido</button>`;
    } else if (isSeller && order.status === 'accepted') {
        actionBtn = `<button class="btn btn-sm btn-primary w-100 mt-2" onclick="updateOrderStatus('${orderId}', 'shipped')">Marcar como Enviado</button>`;
    } else if (!isSeller && order.status === 'shipped') {
        actionBtn = `<button class="btn btn-sm btn-success w-100 mt-2" onclick="updateOrderStatus('${orderId}', 'delivered')">Confirmar Recebimento</button>`;
    }

    container.innerHTML = `
        <div class="order-status-bar">
            <div class="status-step ${currentIdx >= 0 ? 'active' : ''}"><div class="status-icon"><i class="bi bi-cart"></i></div><small>Pedido</small></div>
            <div class="status-step ${currentIdx >= 1 ? 'active' : ''}"><div class="status-icon"><i class="bi bi-check-lg"></i></div><small>Aceito</small></div>
            <div class="status-step ${currentIdx >= 2 ? 'active' : ''}"><div class="status-icon"><i class="bi bi-truck"></i></div><small>Enviado</small></div>
            <div class="status-step ${currentIdx >= 3 ? 'active' : ''}"><div class="status-icon"><i class="bi bi-house-heart"></i></div><small>Entregue</small></div>
        </div>
        ${actionBtn}
    `;
}

window.updateOrderStatus = function(orderId, newStatus) {
    const order = orders.find(o => o.id === orderId);
    const chat = chats.find(c => c.orderId === orderId);
    if (!order || !chat) return;

    order.status = newStatus;
    const statusTexts = { 
        accepted: "✅ O vendedor aceitou seu pedido!", 
        shipped: "📦 O produto foi postado e está a caminho.", 
        delivered: "🎉 Pedido finalizado com sucesso!" 
    };

    chat.messages.push({ senderId: 'system', text: statusTexts[newStatus], timestamp: new Date().toISOString(), type: 'system' });
    
    localStorage.setItem('electro_orders', JSON.stringify(orders));
    localStorage.setItem('electro_chats', JSON.stringify(chats));
    
    addNotification("Status do Pedido", statusTexts[newStatus], "bi-info-circle", "info");
    selectChat(chat.id);
};

window.createChatForOrder = function(order) {
    const chatId = `chat_${order.id}`;
    const newChat = {
        id: chatId,
        orderId: order.id,
        sellerId: order.sellerId,
        sellerName: order.sellerName,
        buyerId: order.buyerId,
        buyerName: order.buyerName,
        participants: [order.buyerId, order.sellerId],
        messages: [{ senderId: 'system', text: `🛒 Novo pedido #${order.id.slice(-4)} gerado.`, timestamp: new Date().toISOString(), type: 'system' }]
    };
    chats.push(newChat);
    localStorage.setItem('electro_chats', JSON.stringify(chats));
    return chatId;
};

window.viewOrderDetails = function() {
    if (!currentChat) return;
    const chat = chats.find(c => c.id === currentChat);
    const order = orders.find(o => o.id === chat.orderId);
    const content = document.getElementById('orderDetailsContent');
    
    content.innerHTML = `
        <div class="small">
            <p><strong>Pedido:</strong> #${order.id.slice(-8)}</p>
            <p><strong>Produto:</strong> ${order.productTitle}</p>
            <p><strong>Vendedor:</strong> ${order.sellerName}</p>
            <p><strong>Valor:</strong> R$ ${order.total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</p>
            <hr>
            <p class="mb-0 text-muted">Acompanhe as atualizações de status diretamente no chat.</p>
        </div>`;
    new bootstrap.Modal(document.getElementById('orderDetailsModal')).show();
};

function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

window.toggleChatSidebar = function() {
    document.getElementById('chatSidebar').classList.toggle('show');
};

// Modifique a função de finalização de compra (onde você tiver o alert de compra)
// Para chamar a criação de pedido e chat. Exemplo para o botão do carrinho:
window.finalizarCompraMock = function(itemIndex) {
    const item = cart[itemIndex];
    const info = getSavedCadastro();
    if (!info) {
        alert("Por favor, faça login para finalizar a compra.");
        const modal = new bootstrap.Modal(document.getElementById('loginModal'));
        modal.show();
        return;
    }
    const order = {
        id: `ord_${Date.now()}`,
        sellerId: item.vendedor_id || 'vendedor_demo',
        sellerName: item.loja || 'Vendedor Oficial',
        buyerId: info.id,
        buyerName: info.nome,
        productTitle: item.titulo,
        total: item.preco,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    orders.push(order);
    localStorage.setItem('electro_orders', JSON.stringify(orders));
    window.createChatForOrder(order);
    window.removeFromCart(itemIndex);
    alert("Pedido realizado! Clique em 'Mensagens' para falar com o vendedor.");
    window.showChat(`chat_${order.id}`);
};

// Exports
window.loadPage = loadPage;
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;
window.toggleTheme = toggleTheme;
