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
window.currentEditingId = null; 
let currentChat = null;
let chats = JSON.parse(localStorage.getItem('electro_chats')) || [];
let orders = JSON.parse(localStorage.getItem('electro_orders')) || [];
let accessHistory = JSON.parse(localStorage.getItem('electro_access_history')) || [];
let likedProducts = JSON.parse(localStorage.getItem('electro_liked_products')) || [];
let chatRefreshInterval = null;
let dbCache = null; // Cache IndexedDB

// Mapeamento amigável de Status
const ORDER_STATUS_MAP = {
    'pending': { label: 'Solicitado', class: 'status-pending' },
    'accepted': { label: 'Aceito (Chat)', class: 'status-accepted' },
    'agreement': { label: 'Aguardando Confirmação', class: 'status-accepted' },
    'shipping': { label: 'Em Envio', class: 'status-shipping' },
    'awaiting_pickup': { label: 'Aguardando Retirada', class: 'status-shipping' },
    'shipped': { label: 'Enviado', class: 'status-shipping' },
    'received': { label: 'Recebido', class: 'status-finished' },
    'finished': { label: 'Finalizado', class: 'status-finished' },
    'cancelled': { label: 'Cancelado', class: 'status-dispute' },
    'dispute': { label: 'Em Análise Admin', class: 'status-dispute' }
};

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

        // Sincroniza pedidos e chats globais para que o vendedor veja solicitações de outros usuários
        if (fullDatabase.orders) orders = fullDatabase.orders;
        if (fullDatabase.chats) chats = fullDatabase.chats;
        updateVisibilityByRole(); // Atualiza contadores de pendências
        
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
        // Garante que pedidos e chats atuais façam parte do pacote de sincronização
        newData.orders = orders;
        newData.chats = chats;
        newData.last_updated = new Date().toISOString();

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

    // Ajustar títulos conforme o papel
    const heroTitle = document.getElementById('heroTitle');
    const heroSubtitle = document.getElementById('heroSubtitle');
    const heroCategories = document.getElementById('heroCategories');
    const gridTitle = document.getElementById('gridTitle');
    
    if (heroTitle) {
        heroTitle.textContent = role === 'VENDEDOR' ? 'Painel do Vendedor' : 'Encontre o melhor preço em eletrônicos';
    }
    if (heroSubtitle) {
        heroSubtitle.textContent = role === 'VENDEDOR' 
            ? 'Gerencie seu estoque, acompanhe suas vendas e publique novos anúncios.' 
            : 'Navegue por ofertas, compare preços e descubra produtos com frete rápido.';
    }
    if (heroCategories) {
        heroCategories.classList.toggle('d-none', role === 'VENDEDOR');
    }
    if (gridTitle) {
        gridTitle.textContent = role === 'VENDEDOR' ? 'Meu Estoque' : 'Recomendados para você';
    }

    // Visibilidade dos itens por papel
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

    // Atualiza Badges de Vendedor (Solicitações pendentes)
    const pendingCount = orders.filter(o => o.sellerId === info?.id && o.status === 'pending').length;
    const pendingBadge = document.getElementById('pendingBadgeNav');
    const pendingBadgeMobile = document.getElementById('pendingBadgeMobile');

    if (pendingBadge) {
        pendingBadge.textContent = pendingCount;
        pendingBadge.classList.toggle('d-none', pendingCount === 0);
    }
    if (pendingBadgeMobile) {
        pendingBadgeMobile.textContent = pendingCount;
        pendingBadgeMobile.classList.toggle('d-none', pendingCount === 0);
    }
    
    if (typeof renderNotifications === 'function') renderNotifications();
}

function addNotification(titulo, texto, icone = 'bi-info-circle', cor = 'primary', targetUserId = null) {
    const currentInfo = getSavedCadastro();
    const finalUserId = targetUserId || currentInfo?.id;
    if (!finalUserId) return;

    let notifications = JSON.parse(localStorage.getItem(`notifications_${finalUserId}`)) || [];
    
    const newNotif = {
        id: Date.now(),
        titulo,
        texto,
        icone,
        cor,
        data: new Date().toISOString()
    };
    
    notifications.unshift(newNotif);
    localStorage.setItem(`notifications_${finalUserId}`, JSON.stringify(notifications.slice(0, 50)));
    
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

window.resetAnnounceModal = function() {
    window.currentEditingId = null;
    document.getElementById('announceForm')?.reset();
    const modalTitle = document.querySelector('#announceModal .modal-title');
    const submitBtn = document.querySelector('#announceModal button[type="submit"]');
    if (modalTitle) modalTitle.textContent = 'O que você quer vender?';
    if (submitBtn) {
        submitBtn.textContent = 'Publicar Anúncio';
        submitBtn.className = 'btn btn-warning w-100 fw-bold';
    }
};

window.prepareEditProduct = function(productId) {
    const item = allProductsCache.find(p => p.productKey === productId);
    if (!item) return;

    window.currentEditingId = productId;
    
    // Preenche os campos
    document.getElementById('prodTitle').value = item.titulo || '';
    document.getElementById('prodDescription').value = item.descricao || '';
    document.getElementById('prodPrice').value = item.preco || 0;
    document.getElementById('prodQuantity').value = item.quantidade || 0;
    document.getElementById('prodCategory').value = item.categoria || '';
    document.getElementById('prodDelivery').checked = !!item.realizaEntrega;
    document.getElementById('prodImage').value = item.img || '';

    // Altera interface do modal
    const modalTitle = document.querySelector('#announceModal .modal-title');
    const submitBtn = document.querySelector('#announceModal button[type="submit"]');
    if (modalTitle) modalTitle.textContent = 'Editar Publicação';
    if (submitBtn) {
        submitBtn.textContent = 'Salvar Alterações';
        submitBtn.className = 'btn btn-primary w-100 fw-bold';
    }

    bootstrap.Modal.getInstance(document.getElementById('productDetailModal'))?.hide();
    new bootstrap.Modal(document.getElementById('announceModal')).show();
};

window.deleteProduct = async function(productId) {
    if (!confirm('Tem certeza que deseja excluir este anúncio permanentemente? Esta ação não pode ser desfeita.')) return;

    if (fullDatabase && fullDatabase.products) {
        // Encontra o índice do produto no banco global
        const index = fullDatabase.products.findIndex(p => p.productKey === productId || p.id === productId);
        
        if (index !== -1) {
            fullDatabase.products.splice(index, 1);
            
            // Sincroniza a exclusão com o servidor JSONBin
            const success = await updateFullDatabase(fullDatabase);
            
            if (success) {
                alert('Anúncio excluído com sucesso!');
                bootstrap.Modal.getInstance(document.getElementById('productDetailModal'))?.hide();
                loadPage('eletronicos'); // Recarrega a vitrine atualizada
            }
        }
    }
};

async function handleAnnounceSubmit(event) {
    event.preventDefault();
    const userInfo = getSavedCadastro();
    if (!userInfo) return;

    if (fullDatabase) {
        fullDatabase.products = fullDatabase.products || [];
        
        const announceData = {
            titulo: document.getElementById('prodTitle')?.value.trim(),
            descricao: document.getElementById('prodDescription')?.value.trim(),
            preco: parseFloat(document.getElementById('prodPrice')?.value) || 0,
            quantidade: parseInt(document.getElementById('prodQuantity')?.value) || 0,
            categoria: document.getElementById('prodCategory')?.value,
            realizaEntrega: document.getElementById('prodDelivery')?.checked,
            img: document.getElementById('prodImage')?.value || 'https://via.placeholder.com/400'
        };

        if (window.currentEditingId) {
            const index = fullDatabase.products.findIndex(p => p.productKey === window.currentEditingId || p.id === window.currentEditingId);
            if (index !== -1) {
                fullDatabase.products[index] = { ...fullDatabase.products[index], ...announceData, last_edit: new Date().toISOString() };
            }
        } else {
            const newProd = {
                id: `prod_${Date.now()}`,
                ...announceData,
                loja: userInfo.nome,
                vendedor_id: userInfo.id,
                created_at: new Date().toISOString()
            };
            fullDatabase.products.push(newProd);
        }
        
        // Inicializa orders e chats se não existirem no banco
        fullDatabase.orders = orders;
        fullDatabase.chats = chats;

        const success = await updateFullDatabase(fullDatabase);

        if (success) {
            const msg = window.currentEditingId ? 'Produto atualizado!' : 'Produto anunciado!';
            alert(msg);
            window.currentEditingId = null;
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
            orders: orders,
            chats: chats,
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

window.renderAccessHistory = function() {
    const grid = document.getElementById('productsGrid');
    const gridTitle = document.getElementById('gridTitle');
    gridTitle.textContent = "Produtos que você viu recentemente";
    
    // Filtra os produtos do cache que estão no array de IDs do histórico
    const historyProducts = accessHistory
        .map(id => allProductsCache.find(p => p.productKey === id))
        .filter(Boolean)
        .reverse(); // Mais recentes primeiro

    if (historyProducts.length === 0) {
        grid.innerHTML = `<div class="col-12 text-center py-5"><h5>Seu histórico está vazio.</h5></div>`;
        return;
    }
    grid.innerHTML = historyProducts.map(item => renderCard(item)).join('');
};

window.renderLikedProducts = function() {
    const grid = document.getElementById('productsGrid');
    const gridTitle = document.getElementById('gridTitle');
    gridTitle.textContent = "Seus Favoritos (Curtidos)";
    
    const likedItems = likedProducts
        .map(id => allProductsCache.find(p => p.productKey === id))
        .filter(Boolean);

    if (likedItems.length === 0) {
        grid.innerHTML = `<div class="col-12 text-center py-5"><h5>Você ainda não curtiu nenhum produto.</h5></div>`;
        return;
    }
    grid.innerHTML = likedItems.map(item => renderCard(item)).join('');
};

window.showProductDetail = function(productId) {
    const item = allProductsCache.find(p => String(p.productKey) === String(productId) || String(p.id) === String(productId));
    if (!item) return;
    
    // Adiciona ao histórico (evitando duplicatas)
    accessHistory = accessHistory.filter(id => id !== item.productKey);
    accessHistory.push(item.productKey);
    if (accessHistory.length > 20) accessHistory.shift(); // Limita a 20 itens
    localStorage.setItem('electro_access_history', JSON.stringify(accessHistory));
    
    const modalContent = document.getElementById('productDetailContent');
    
    // Lógica de Preço Quebrado (Cifrão, Inteiro e Centavos)
    const preco = item.preco || 0;
    const precoInteiro = Math.floor(preco).toLocaleString('pt-BR');
    const precoCentavos = (preco % 1).toFixed(2).substring(2);
    const precoOriginal = item.preco_original ? item.preco_original.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : null;
    
    const isDemo = item.isMock || item.source === 'DEMO';
    const userInfo = getSavedCadastro();
    
    modalContent.innerHTML = `
        <div class="row g-0 g-md-5">
            <!-- Coluna 1: Imagens -->
            <div class="col-md-7 border-end pe-md-4">
                <div class="product-gallery text-center mb-4">
                    <img src="${item.img || 'https://via.placeholder.com/400'}" 
                         class="img-fluid" 
                         style="max-height: 450px; object-fit: contain;">
                </div>
                
                <div class="description-section-ml d-none d-md-block">
                    <h3>Descrição</h3>
                    <p class="text-secondary" style="white-space: pre-line; font-size: 1.1rem;">${item.descricao || 'Este vendedor não incluiu uma descrição para o produto.'}</p>
                </div>
            </div>

            <!-- Coluna 2: Info de Venda -->
            <div class="col-md-5">
                <div class="product-detail-condition">Novo  |  +50 vendidos</div>
                <h1 class="product-detail-title">${item.titulo}</h1>
                
                <div class="d-flex align-items-center mb-3 gap-2" id="likesCounterContainer">
                    <span class="text-danger small"><i class="bi bi-heart-fill"></i></span>
                    <span class="text-muted small">${item.likes || 0} pessoas curtiram este produto</span>
                </div>

                <div class="price-area">
                    ${precoOriginal ? `<del class="text-muted small">R$ ${precoOriginal}</del>` : ''}
                    <div class="product-detail-price">
                        <span class="currency">R$</span>
                        <span class="integer">${precoInteiro}</span>
                        <span class="cents">${precoCentavos}</span>
                    </div>
                </div>

                <div class="shipping-card-detail">
                    ${item.realizaEntrega ? `
                        <div class="d-flex gap-2">
                            <i class="bi bi-truck text-success"></i>
                            <div>
                                <div class="text-success fw-bold">Frete Grátis</div>
                                <div class="small text-muted">Chegará entre amanhã e quarta-feira em <b>${userInfo?.cidade || 'sua região'}</b></div>
                                <span class="small text-muted">Envio prioritário ElectroMarket.</span>
                            </div>
                        </div>
                    ` : `
                        <div class="d-flex gap-2">
                            <i class="bi bi-geo-alt text-warning"></i>
                            <div>
                                <div class="text-warning fw-bold">Retirada no local</div>
                                <div class="small text-muted">Combine local e horário com o vendedor em <b>${item.cidade || 'região do vendedor'}</b></div>
                                <span class="small text-muted d-block">Este vendedor não realiza entregas.</span>
                            </div>
                        </div>
                    `}
                </div>

                <div class="seller-reputation-card">
                    <p class="mb-1 small">Vendido por <span class="text-primary">${item.loja}</span></p>
                    <div class="reputation-bar">
                        ${Array(5).fill(0).map((_, i) => `<div class="reputation-step ${i < Math.floor(item.vendedor_rating || 5) ? 'active-green' : ''}"></div>`).join('')}
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="text-warning small">${'★'.repeat(Math.floor(item.vendedor_rating || 5))}</span>
                        <span class="small text-muted">${item.vendedor_rating ? item.vendedor_rating.toFixed(1) : '5.0'} | Pontuação do Vendedor</span>
                    </div>
                </div>

                <p class="small mb-3">Estoque disponível: <b>${item.quantidade || 1} unidades</b></p>

                <div class="d-grid gap-2 mb-3">
                    ${userInfo && item.vendedor_id === userInfo.id ? 
                        `<button class="btn btn-primary btn-lg fw-bold" onclick="window.prepareEditProduct('${item.productKey}')">
                            <i class="bi bi-pencil-square me-2"></i>Editar Publicação
                         </button>
                         <button class="btn btn-outline-danger btn-sm fw-bold" onclick="window.deleteProduct('${item.productKey}')">
                            <i class="bi bi-trash me-2"></i>Excluir Anúncio Permanente
                         </button>` : 
                        `<button class="btn-buy-now" onclick="window.buyNow('${item.productKey}')">Solicitar Compra</button>
                         <button class="btn-add-to-cart-ml" onclick="window.addToCart('${item.productKey}')">Adicionar ao carrinho</button>`
                    }
                </div>
                <button class="btn btn-link text-decoration-none w-100 text-secondary fw-bold small mb-4" onclick="window.shareProduct('${item.productKey}')">
                    <i class="bi bi-share me-2"></i>Compartilhar produto
                </button>

                <div class="benefits-list">
                    <div class="benefit-item-ml">
                        <i class="bi bi-arrow-return-left"></i>
                        <div><span class="text-primary">Devolução grátis.</span> Você tem 30 dias a partir do recebimento.</div>
                    </div>
                    <div class="benefit-item-ml">
                        <i class="bi bi-shield-check"></i>
                        <div><span class="text-primary">Compra Garantida</span>, receba o produto que está esperando ou devolvemos o dinheiro.</div>
                    </div>
                </div>
            </div>
            
            <!-- Descrição Mobile -->
            <div class="col-12 d-md-none mt-4">
                <div class="description-section-ml">
                    <h3>Descrição</h3>
                    <p class="text-secondary">${item.descricao || 'Sem descrição.'}</p>
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

window.toggleLike = async function(productId) {
    const product = allProductsCache.find(p => p.productKey === productId);
    if (!product) return;

    // Incrementa no banco de dados real
    product.likes = (product.likes || 0) + 1;
    
    // Adiciona à lista pessoal de curtidos
    if (!likedProducts.includes(productId)) {
        likedProducts.push(productId);
        localStorage.setItem('electro_liked_products', JSON.stringify(likedProducts));
    }
    
    if (fullDatabase) {
        const dbIndex = fullDatabase.products.findIndex(p => getProductKey(p) === productId);
        if (dbIndex !== -1) {
            fullDatabase.products[dbIndex].likes = product.likes;
            await updateFullDatabase(fullDatabase);
        }
    }

    addNotification("Favorito", `Você curtiu: ${product.titulo}`, "bi-heart-fill", "danger");
    // Atualiza o contador se o modal estiver aberto
    const counter = document.querySelector('#likesCounterContainer span.text-muted');
    if (counter) counter.textContent = `${product.likes} pessoas curtiram este produto`;
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

// Exports
window.loadPage = loadPage;
window.applyFilters = applyFilters;

// ============================================
// SISTEMA DE CHAT E PEDIDOS (LÓGICA INTEGRADA)
// ============================================

window.buyNow = function(productId) {
    const product = allProductsCache.find(p => p.productKey === productId);
    if (!product) return;

    // Garante que o item está no carrinho antes de processar a compra direta
    const existing = cart.find(item => item.productKey === productId);
    if (!existing) {
        cart.push({ ...product, qtd: 1 });
        renderCart();
    }

    const index = cart.findIndex(item => item.productKey === productId);
    window.finalizarCompraMock(index);
};

window.finalizarCompraMock = async function(itemIndex) {
    const item = cart[itemIndex];
    const info = getSavedCadastro();
    if (!info) {
        alert("Por favor, faça login para finalizar a compra.");
        new bootstrap.Modal(document.getElementById('loginModal')).show();
        return;
    }
    
    const order = {
        id: `ord_${Date.now()}`,
        sellerId: item.vendedor_id || 'vendedor_demo',
        sellerName: item.loja || 'Vendedor Oficial',
        buyerId: info.id,
        buyerName: info.nome,
        productTitle: item.titulo,
        productImg: item.img,
        total: item.preco,
        quantity: item.qtd || 1,
        status: 'pending',
        realizaEntrega: item.realizaEntrega || false,
        createdAt: new Date().toISOString(),
        agreeBuyer: false, agreeSeller: false
    };
    
    orders.push(order);
    
    const chatId = `chat_${order.id}`;
    chats.push({
        id: chatId, orderId: order.id, sellerId: order.sellerId, buyerId: order.buyerId,
        participants: [String(order.buyerId), String(order.sellerId)],
        messages: [{ senderId: 'system', text: `🛒 Solicitação de compra #${order.id.slice(-8)}`, timestamp: new Date().toISOString(), type: 'system' }]
    });

    // 1. Salva localmente
    localStorage.setItem('electro_orders', JSON.stringify(orders));
    localStorage.setItem('electro_chats', JSON.stringify(chats));
    
    // 2. Força a sincronização com a nuvem (JSONBin)
    if (!fullDatabase) await fetchFullDatabase();
    if (fullDatabase) {
        await updateFullDatabase(fullDatabase);
    }

    addNotification("Nova Solicitação", `${info.nome} quer comprar: ${item.titulo}`, "bi-bag-plus", "warning", order.sellerId);
    window.removeFromCart(itemIndex);
    bootstrap.Offcanvas.getInstance(document.getElementById('cartOffcanvas'))?.hide();
    alert("✅ Solicitação enviada! Acompanhe em 'Minhas Compras'.");
    renderOrderManagement('buyer');
};

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
    document.getElementById('chatActiveContent').classList.remove('d-none');
    document.getElementById('chatActiveContent').style.display = 'flex';
    
    const otherUserName = chat.sellerId === info.id ? chat.buyerName : chat.sellerName;
    document.getElementById('chatPartnerNameHeader').textContent = otherUserName;
    document.getElementById('chatPartnerAvatar').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(otherUserName)}&background=random`;

    renderMessages(chat);
    updateOrderStatusBar(chat.orderId);
    loadChatContacts();
}

window.renderOrderManagement = function(type = 'buyer') {
    const info = getSavedCadastro();
    if (!info) return;
    const grid = document.getElementById('productsGrid');
    const gridTitle = document.getElementById('gridTitle');
    
    let filteredOrders = [];
    if (type === 'buyer') {
        filteredOrders = orders.filter(o => o.buyerId === info.id);
        gridTitle.textContent = "Minhas Compras";
    } else if (type === 'seller_requests') {
        filteredOrders = orders.filter(o => o.sellerId === info.id && o.status === 'pending');
        gridTitle.textContent = "Solicitações Pendentes";
    } else if (type === 'seller_sales') {
        filteredOrders = orders.filter(o => o.sellerId === info.id && o.status !== 'pending');
        gridTitle.textContent = "Histórico de Vendas";
    } else if (type === 'admin') {
        filteredOrders = orders.filter(o => o.status === 'dispute');
        gridTitle.textContent = "Painel de Disputas";
    }

    if (filteredOrders.length === 0) {
        grid.innerHTML = `<div class="col-12 text-center py-5"><h5>Nenhum pedido encontrado.</h5></div>`;
        return;
    }
    filteredOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    grid.innerHTML = filteredOrders.map(order => {
        const statusInfo = ORDER_STATUS_MAP[order.status] || { label: order.status, class: '' };
        return `
        <div class="col-12 mb-3">
            <div class="card order-card p-3 shadow-sm border-0">
                <div class="d-flex gap-3">
                    <img src="${order.productImg || 'https://via.placeholder.com/80'}" class="rounded" style="width: 80px; height: 80px; object-fit: cover;">
                    <div class="flex-grow-1">
                        <div class="d-flex justify-content-between align-items-start">
                            <div>
                                <span class="badge ${statusInfo.class} mb-2">${statusInfo.label}</span>
                                <h6 class="fw-bold mb-1">${order.productTitle}</h6>
                                <p class="small text-muted mb-0">Pedido #${order.id.slice(-8)} • ${type.includes('seller') ? 'Comprador: ' + order.buyerName : 'Vendedor: ' + order.sellerName}</p>
                            </div>
                            <h5 class="fw-bold text-success">R$ ${order.total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h5>
                        </div>
                        <div class="d-flex gap-2 mt-3 justify-content-end">
                            ${order.status !== 'pending' && order.status !== 'cancelled' ? `<button class="btn btn-sm btn-outline-primary" onclick="window.showChat('chat_${order.id}')"><i class="bi bi-chat-dots me-1"></i> Abrir Chat</button>` : ''}
                            ${order.status === 'pending' && type === 'seller_requests' ? `
                                <button class="btn btn-sm btn-success fw-bold" onclick="window.updateOrderStatus('${order.id}', 'accepted')"><i class="bi bi-check-lg me-1"></i> Aceitar Venda</button>
                                <button class="btn btn-sm btn-outline-danger fw-bold" onclick="window.updateOrderStatus('${order.id}', 'cancelled')"><i class="bi bi-x-lg me-1"></i> Recusar</button>` : ''}
                            ${order.status === 'shipping' && type === 'seller_sales' ? `<button class="btn btn-sm btn-primary" onclick="window.updateOrderStatus('${order.id}', 'shipped')">Enviado</button>` : ''}
                            ${order.status === 'shipped' && type === 'buyer' ? `<button class="btn btn-sm btn-success" onclick="window.updateOrderStatus('${order.id}', 'finished')">Confirmar Recebimento</button>` : ''}
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
};

window.reportProblem = function(orderId) {
    const reason = prompt("Descreva o problema:");
    if (!reason) return;
    const order = orders.find(o => o.id === orderId);
    const chat = chats.find(c => c.orderId === orderId);
    if (!order) return;
    order.status = 'dispute';
    if (chat) chat.messages.push({ senderId: 'system', text: `⚠️ Problema reportado: ${reason}`, timestamp: new Date().toISOString(), type: 'system' });
    saveAndRefresh(chat);
    renderOrderManagement(getSavedCadastro().tipo === 'VENDEDOR' ? 'seller' : 'buyer');
};

window.openExternalDeliveryModal = function(orderId) {
    const modalHtml = `
        <div class="modal fade" id="externalDeliveryModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content border-0 shadow">
                    <div class="modal-header bg-primary text-white"><h5 class="modal-title">App de Entrega</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
                    <div class="modal-body p-4"><div class="d-grid gap-2">
                        <button class="btn btn-outline-dark p-3" onclick="window.selectExternalService('${orderId}', 'Uber Flash')">Uber Flash</button>
                        <button class="btn btn-outline-success p-3" onclick="window.selectExternalService('${orderId}', '99 Entrega')">99 Entrega</button>
                        <button class="btn btn-outline-primary p-3" onclick="window.selectExternalService('${orderId}', 'Loggi')">Loggi</button>
                    </div></div>
                </div>
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    new bootstrap.Modal(document.getElementById('externalDeliveryModal')).show();
};

window.selectExternalService = function(orderId, service) {
    const chat = chats.find(c => c.orderId === orderId);
    const info = getSavedCadastro();
    if (chat) chat.messages.push({ senderId: 'system', text: `🚗 ${info.nome} sugeriu usar ${service}`, timestamp: new Date().toISOString(), type: 'system' });
    saveAndRefresh(chat);
    bootstrap.Modal.getInstance(document.getElementById('externalDeliveryModal'))?.hide();
    if (currentChat) selectChat(currentChat);
};

window.renderSellerPanel = function(filterStatus = 'pending') {
    const info = getSavedCadastro();
    if (!info || info.tipo !== 'VENDEDOR') return;
    window.renderOrderManagement('seller');
};

function renderMessages(chat) {
    const container = document.getElementById('chatMessagesContainer');
    const logisticsArea = document.getElementById('logisticsAgreementArea');
    const logisticsButtons = document.getElementById('logisticsButtons');
    const order = orders.find(o => o.id === chat.orderId);
    const info = getSavedCadastro();
    
    if (!container) return;
    
    container.innerHTML = chat.messages.map(msg => {
        if (msg.type === 'system') return `<div class="message-system"><span class="badge bg-light text-dark">${msg.text}</span></div>`;
        const isMe = msg.senderId === info.id;
        return `
            <div class="chat-message ${isMe ? 'message-sent' : 'message-received'}">
                <div class="message-bubble shadow-sm">
                    <div style="word-break: break-word;">${msg.text}</div>
                    <div class="message-time">${formatTime(msg.timestamp)}</div>
                </div>
            </div>`;
    }).join('');
    
    if (order && logisticsArea) {
        if (order.status === 'accepted') {
            logisticsArea.classList.remove('d-none');
            const hasAgreed = (info.id === order.buyerId && order.agreeBuyer) || (info.id === order.sellerId && order.agreeSeller);
            if (hasAgreed) {
                logisticsButtons.innerHTML = `<div class="alert alert-info mb-0 small w-100">Aguardando a outra parte confirmar...</div>`;
            } else {
                logisticsButtons.innerHTML = `
                    <button class="btn btn-sm btn-outline-primary" onclick="window.setLogistics('${order.id}', 'pickup')">Retirada</button>
                    <button class="btn btn-sm btn-outline-success" onclick="window.setLogistics('${order.id}', 'seller_delivery')">Entrega</button>
                    <button class="btn btn-sm btn-outline-warning" onclick="window.openExternalDeliveryModal('${order.id}')">App Entrega</button>`;
            }
        } else { logisticsArea.classList.add('d-none'); }
    }
    container.scrollTop = container.scrollHeight;
}

window.setLogistics = function(orderId, type) {
    const order = orders.find(o => o.id === orderId);
    const info = getSavedCadastro();
    const chat = chats.find(c => c.orderId === orderId);
    if (!order || !chat) return;

    const labels = { 'pickup': 'Retirada no Local', 'seller_delivery': 'Entrega pelo Vendedor', 'external': 'Entrega via Plataforma' };
    if (info.id === order.buyerId) order.agreeBuyer = true;
    if (info.id === order.sellerId) order.agreeSeller = true;
    
    chat.messages.push({ senderId: 'system', text: `🤝 ${info.nome} escolheu: ${labels[type]}`, timestamp: new Date().toISOString(), type: 'system' });
    if (order.agreeBuyer && order.agreeSeller) {
        order.status = (type === 'pickup') ? 'awaiting_pickup' : 'shipping';
        chat.messages.push({ senderId: 'system', text: `🚀 Acordo fechado! Status: ${ORDER_STATUS_MAP[order.status].label}`, timestamp: new Date().toISOString(), type: 'system' });
    }
    saveAndRefresh(chat);
};

function saveAndRefresh(chat) {
    localStorage.setItem('electro_orders', JSON.stringify(orders));
    localStorage.setItem('electro_chats', JSON.stringify(chats));
    
    if (fullDatabase) {
        fullDatabase.orders = orders;
        fullDatabase.chats = chats;
        updateFullDatabase(fullDatabase);
    }

    if (chat) renderMessages(chat);
}

window.updateOrderStatus = function(orderId, newStatus) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    order.status = newStatus;
    if (newStatus === 'accepted' && !chats.find(c => c.orderId === orderId)) window.createChatForOrder(order);
    const chat = chats.find(c => c.orderId === orderId);
    const msg = { 'accepted': "✅ Vendedor aceitou o pedido!", 'cancelled': "❌ Pedido cancelado.", 'shipped': "📦 Produto enviado!", 'finished': "🎉 Pedido finalizado!", 'dispute': "⚠️ Problema relatado." };
    if (chat) chat.messages.push({ senderId: 'system', text: msg[newStatus] || `Status: ${newStatus}`, timestamp: new Date().toISOString(), type: 'system' });
    saveAndRefresh(chat);
    if (newStatus === 'accepted') {
        addNotification("Pedido Aprovado!", "Combine a entrega no chat.", "bi-chat-dots-fill", "success", order.buyerId);
    }

    if (currentChat) selectChat(currentChat);
    else {
        const userInfo = getSavedCadastro();
        const nextType = userInfo.tipo === 'VENDEDOR' ? (newStatus === 'accepted' ? 'seller_sales' : 'seller_requests') : 'buyer';
        renderOrderManagement(nextType);
    }
};

function updateOrderStatusBar(orderId) {
    const order = orders.find(o => o.id === orderId);
    const info = getSavedCadastro();
    const container = document.getElementById('orderStatusBar');
    if (!order || !container) return;
    const steps = ['pending', 'accepted', 'shipping', 'finished'];
    const currentIdx = steps.indexOf(order.status === 'awaiting_pickup' || order.status === 'shipped' ? 'shipping' : order.status);
    container.innerHTML = `<div class="order-status-bar">${steps.map((s, i) => `<div class="status-step ${i <= currentIdx ? 'active' : ''}"><div class="status-icon"><i class="bi bi-circle"></i></div><small>${ORDER_STATUS_MAP[s]?.label || s}</small></div>`).join('')}</div>`;
}

function formatTime(iso) { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

window.createChatForOrder = function(order) {
    const chatId = `chat_${order.id}`;
    chats.push({ id: chatId, orderId: order.id, sellerId: order.sellerId, buyerId: order.buyerId, participants: [String(order.buyerId), String(order.sellerId)], messages: [{ senderId: 'system', text: `🛒 Novo pedido #${order.id.slice(-4)} gerado.`, timestamp: new Date().toISOString(), type: 'system' }] });
    localStorage.setItem('electro_chats', JSON.stringify(chats));
};
window.clearFilters = clearFilters;
window.toggleTheme = toggleTheme;
