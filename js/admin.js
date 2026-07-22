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
        { tab: 'admin-support',  icon: 'bi-headset',              label: 'Suporte',     count: (counts.chatsAbertos || 0) + (counts.ticketsAbertos || 0) },
        { tab: 'admin-cats',     icon: 'bi-tags-fill',            label: 'Categorias',  count: counts.categorias }
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
                    <img src="${safeParseImages(p.img)[0] || 'https://placehold.co/45'}" class="admin-row-avatar" style="border-radius:6px;" onerror="this.onerror=null;this.src='https://placehold.co/45'">
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
    if (!users.length) return `<tr><td colspan="6" class="admin-table-empty">Nenhum usuário encontrado.</td></tr>`;
    return users.map(u => {
        const idade = u.created_at ? (() => {
            const dias = Math.floor((Date.now() - new Date(u.created_at).getTime()) / 86400000);
            if (dias < 30) return `${dias}d`;
            if (dias < 365) return `${Math.floor(dias / 30)}m`;
            return `${Math.floor(dias / 365)}a`;
        })() : '-';
        const rating = u.avaliacao || u.rating || '-';
        return `
        <tr>
            <td>
                <div class="d-flex align-items-center gap-2">
                    <img src="${safeParseImages(u.avatar)[0] || 'https://ui-avatars.com/api/?name='+encodeURIComponent(u.nome)}" class="admin-row-avatar" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=3483fa&color=fff&size=40'">
                    <strong>${u.nome}</strong>
                </div>
            </td>
            <td class="text-muted">${u.email}</td>
            <td class="text-muted">${idade}</td>
            <td>${typeof rating === 'number' ? '<span class="admin-row-badge badge-open"><i class="bi bi-star-fill me-1" style="color:#f59f00;font-size:0.7rem"></i>' + rating.toFixed(1) + '</span>' : '-'}</td>
            <td><span class="admin-badge-tipo ${u.tipo==='ADMIN'?'tipo-admin':(u.tipo==='VENDEDOR'?'tipo-vendedor':'tipo-cliente')}">${u.tipo === 'ADMIN' ? 'Administrador' : (u.tipo === 'VENDEDOR' ? 'Vendedor' : 'Cliente')}</span></td>
            <td class="text-end">
                ${u.id !== currentUserId ? `
                    <button class="admin-icon-btn danger" onclick="window.adminDeleteUser('${u.id}', '${(u.nome || '').replace(/'/g, "\\'")}')" title="Apagar Conta">
                        <i class="bi bi-person-x-fill"></i>
                    </button>
                ` : '<span class="admin-row-badge badge-muted">Você</span>'}
            </td>
        </tr>`;
    }).join('');
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

        // Chamados de suporte (linhas de `chats` com order_id NULL) — busca — parte.
        const tickets = await fetchSupportTicketsSafe();

        const categorias = [...new Set(products.map(p => p.categoria || 'Geral'))];
        const chatsAbertos = chats.filter(c => !c.closed).length;
        const ticketsAbertos = tickets.filter(t => t.status !== 'closed').length;
        const tabCounts = { users: users.length, products: products.length, categorias: categorias.length, chatsAbertos, ticketsAbertos };

        // Badge de aviso no dock mobile (aba Suporte unificada: conversas + chamados)
        const supportDockBadge = document.getElementById('adminSupportBadgeDock');
        if (supportDockBadge) {
            const totalAbertos = chatsAbertos + ticketsAbertos;
            supportDockBadge.textContent = totalAbertos;
            supportDockBadge.classList.toggle('d-none', totalAbertos === 0);
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
                                    <img src="${safeParseImages(p.img)[0] || 'https://placehold.co/40'}" class="admin-row-avatar" onerror="this.onerror=null;this.src='https://placehold.co/40'">
                                    <div class="admin-row-info">
                                        <strong>${p.titulo}</strong>
                                        <small>Loja: ${p.loja || 'N/A'}</small>
                                    </div>
                                    <span class="admin-row-value">${parseFloat(p.preco) === 0 ? 'GRÁTIS' : `R$ ${parseFloat(p.preco).toLocaleString('pt-BR')}`}</span>
                                </div>
                            `).join('') || '<p class="text-muted small mb-0">Nenhuma publicação ainda.</p>'}
                        </div>
                        <div class="admin-card">
                            <h6 class="admin-card-title"><i class="bi bi-chat-dots-fill me-2"></i>últimos Chats de Pedido</h6>
                            ${chats.slice(0, 5).map(c => {
                                const order = orders.find(o => o.id === c.order_id) || {};
                                return `
                                <div class="admin-row">
                                    ${(() => {
                                        const pid = order.buyer_id || c.buyer_id;
                                        const u = (window._adminUsersCache || []).find(x => x.id === pid);
                                        const av = normalizeImageUrl(safeParseImages(u?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent((order.buyer_name || '?').slice(0,2))}&background=22c98e&color=fff&size=40`;
                                        return `<img src="${av}" class="admin-row-avatar" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=22c98e&color=fff&size=40'">`;
                                    })()}
                                    <div class="admin-row-info">
                                        <strong>${order.product_title || 'Pedido #' + c.order_id?.slice(-6)}</strong>
                                        <small>${order.buyer_name || '?'} ? ${order.seller_name || '?'}</small>
                                    </div>
                                    <span class="admin-row-badge ${c.closed ? 'badge-muted' : 'badge-open'}">${c.closed ? 'Encerrado' : (ORDER_STATUS_MAP[order.status]?.text || 'Aberto')}</span>
                                </div>`;
                            }).join('') || '<p class="text-muted small mb-0">Nenhuma conversa ainda.</p>'}
                        </div>
                        <div class="admin-card">
                            <h6 class="admin-card-title"><i class="bi bi-headset me-2"></i>últimos Chamados de Suporte</h6>
                            ${tickets.slice(0, 5).map(t => `
                                <div class="admin-row">
                                    <img src="${safeParseImages(t.requester_avatar)[0] || ('https://ui-avatars.com/api/?name=' + encodeURIComponent((t.requester_name || '?').slice(0,2)) + '&background=e50914&color=fff&size=40')}" class="admin-row-avatar" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=e50914&color=fff&size=40'">
                                    <div class="admin-row-info">
                                        <strong>${getTicketLabel(t)}</strong>
                                        <small>${t.requester_name || 'Visitante'}</small>
                                    </div>
                                    <span class="admin-row-badge ${t.status === 'closed' ? 'badge-muted' : 'badge-open'}"><i class="bi ${t.status === 'closed' ? 'bi-lock-fill' : 'bi-headset'} me-1"></i>${t.status === 'closed' ? 'Solicitação Encerrada' : 'Solicitação Aberta'}</span>
                                </div>`).join('') || '<p class="text-muted small mb-0">Nenhum chamado ainda.</p>'}
                        </div>

                        <header class="admin-topbar" style="margin-top:0.5rem">
                            <div>
                                <h4 class="fw-bold mb-0" style="font-size:1.1rem">Relatórios</h4>
                                <small class="text-muted">Métricas e estatísticas da plataforma</small>
                            </div>
                        </header>
                        <div class="admin-reports-grid" style="margin-top:0.75rem">
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
                                <h6 class="admin-card-title"><i class="bi bi-graph-up me-2"></i>Novas Publicações (últimos 6 meses)</h6>
                                <div class="admin-chart-wrap"><canvas id="chartProdsTimeline"></canvas></div>
                            </div>
                        </div>
                    </div>

                    <div class="admin-tab-panel" id="admin-content">
                        <div class="admin-card" id="adminContentUsersCard">
                            <h6 class="admin-card-title"><i class="bi bi-people-fill me-2"></i>Usuários <span class="admin-nav-count" id="adminContentUsersCount">${users.length}</span></h6>
                            <div class="admin-table-wrap">
                                <table class="admin-table">
                                    <thead>
                                        <tr>
                                            <th>Usuário</th>
                                            <th>E-mail</th>
                                            <th>Idade da Conta</th>
                                            <th>Avaliação</th>
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
                    </div>

                    <div class="admin-tab-panel" id="admin-cats">
                        <div class="admin-card">
                            <h6 class="admin-card-title"><i class="bi bi-tags-fill me-2"></i>Categorias Ativas</h6>
                            ${categorias.map(cat => `
                                <div class="admin-row">
                                    <div class="admin-row-icon"><i class="bi bi-tag-fill"></i></div>
                                    <div class="admin-row-info"><strong>${cat}</strong></div>
                                    <span class="admin-row-badge badge-muted">${products.filter(p => p.categoria === cat).length} anúncios</span>
                                </div>
                            `).join('')}
                        </div>

                        <div class="admin-card mt-3" id="adminPendingCatsCard">
                            <h6 class="admin-card-title"><i class="bi bi-hourglass-split me-2"></i>Categorias Pendentes <span class="admin-nav-count" id="pendingCatsCount">0</span></h6>
                            <div id="adminPendingCatsList">
                                <p class="text-muted small">Nenhuma sugestão pendente.</p>
                            </div>
                        </div>
                    </div>

                    <div class="admin-tab-panel" id="admin-support">
                        <!-- Fullscreen WhatsApp layout renderizado por openAdminSupportFullscreen -->
                    </div>
                </main>
            </div>`;

        showAdminTopNavTabs(tabCounts);

        // Popula categorias pendentes
        renderPendingCategories();

        // Guarda os dados carregados pra alimentar os gráficos (usados aqui
        // mesmo, dentro da aba "Início" — só constrói quando o canvas estiver
        // realmente visível, senão o Chart.js mede a largura errada).
        window._adminReportsData = { users, products, orders, chats, tickets, categorias };
        window._adminChartsReady = false;

        // Se o admin já estava numa aba específica (ex: voltou de uma conversa
        // aberta a partir da aba "Chats" ou "Suporte"), reabre na mesma aba
        // em vez de sempre cair no Início. Mapeia a aba "admin-chats" (antiga)
        // para a aba unificada "admin-support".
        if (window._adminActiveTab === 'admin-chats') window._adminActiveTab = 'admin-support';
        if (window._adminActiveTab && window._adminActiveTab !== 'admin-overview') {
            // Apenas troca o active visual sem re-renderizar o painel inteiro
            document.querySelectorAll('.admin-nav-link').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.admin-tab-panel').forEach(el => el.classList.remove('active'));
            const navBtn = document.querySelector(`.admin-nav-link[data-tab="${window._adminActiveTab}"]`);
            const panel = document.getElementById(window._adminActiveTab);
            if (navBtn) navBtn.classList.add('active');
            if (panel) panel.classList.add('active');
            // Se for support, chama o fullscreen
            if (window._adminActiveTab === 'admin-support') {
                window.openAdminSupportFullscreen();
                return;
            }
        }

        window._adminChartsReady = true;
        requestAnimationFrame(() => window.renderAdminCharts());

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

    // Support tab = full WhatsApp screen
    if (tabId === 'admin-support') {
        document.body.classList.add('wa-locked', 'admin-chat-fullscreen');
        document.getElementById('adminPanelTitle').textContent = 'Suporte';
        window._adminSupportViewOpen = true;
        window.openAdminSupportFullscreen();
        return;
    }

    document.body.classList.remove('wa-locked', 'admin-chat-fullscreen');
    window._adminSupportViewOpen = false;

    // Suporte fullscreen substitui o HTML do grid; se a aba alvo não existe
    // mais no DOM, precisamos re-renderizar o painel admin primeiro.
    if (!document.getElementById(tabId)) {
        adminRefreshCurrentView();
        return;
    }

    const panel = document.getElementById(tabId);
    if (panel) panel.classList.add('active');

    const titles = {
        'admin-overview': 'Início',
        'admin-content': 'Conteúdo',
        'admin-cats': 'Categorias',
        'admin-support': 'Suporte'
    };
    const titleEl = document.getElementById('adminPanelTitle');
    if (titleEl) titleEl.textContent = titles[tabId] || '';

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
    if (window._adminSupportViewOpen)         return window.openAdminSupportFullscreen();
    return window.renderAdminPanel();
}

/**
 * Atalho da navbar: "Todos os Produtos" — navegação igual — visão normal do
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
                                <strong>${order.product_title || 'Pedido #' + c.order_id?.slice(-6)} <span class="admin-row-badge ${c.closed ? 'badge-muted' : 'badge-open'} ms-1">${c.closed ? 'Encerrado' : (ORDER_STATUS_MAP[order.status]?.text || 'Aberto')}</span></strong>
                                <small class="d-block">${order.buyer_name || '?'} ? ${order.seller_name || '?'} • ${msgCount} mensagens</small>
                                ${lastMsg ? `<small class="text-muted fst-italic d-block text-truncate" style="max-width:320px;">"${(lastMsg.text || '[mídia]').slice(0,60)}"</small>` : ''}
                            </div>
                            <div class="d-flex gap-1 justify-content-end">
                                <button class="admin-icon-btn" onclick="event.stopPropagation(); window.adminOpenChatsModal('${c.order_id}')" title="Ver Conversa">
                                    <i class="bi bi-eye"></i>
                                </button>
                                <button class="admin-icon-btn danger" onclick="event.stopPropagation(); window.adminDeleteChat('${c.order_id}')" title="Apagar conversa e pedido">
                                    <i class="bi bi-trash-fill"></i>
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
        console.error('Chart.js não carregou • verifique a conexão com o CDN.');
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
 * administrador geral do marketplace. Ao salvar, o vendedor/loja original — 
 * preservado (ver flag `adminEdit` tratada no submit do #announceForm) e o
 * usuário volta pro painel administrativo em vez da grade normal de produtos.
 */
window.adminEditProduct = function(pid) {
    const p = window._adminProductsCache?.find(x => x.id === pid) || allProductsCache.find(x => x.id === pid);
    if (!p) { showToast('Produto não encontrado.', 'error'); return; }
    window.showCreateAdPage(pid, true);
};

/** Renderiza a lista de categorias pendentes no painel admin */
function renderPendingCategories() {
    const container = document.getElementById('adminPendingCatsList');
    if (!container) return;
    const pendentes = JSON.parse(localStorage.getItem('emCategoriasPendentes') || '[]');
    const countEl = document.getElementById('pendingCatsCount');
    if (countEl) countEl.textContent = pendentes.length;
    if (pendentes.length === 0) {
        container.innerHTML = '<p class="text-muted small">Nenhuma sugestão pendente.</p>';
        return;
    }
    container.innerHTML = pendentes.map((p, i) => `
        <div class="admin-row">
            <div class="admin-row-icon"><i class="bi bi-tag"></i></div>
            <div class="admin-row-info">
                <strong>${p.nome}</strong>
                <small>Sugerido por ${p.sugeridoPor} em ${new Date(p.data).toLocaleDateString('pt-BR')}</small>
            </div>
            <div class="d-flex gap-1">
                <button class="btn btn-sm btn-success" onclick="window.aprovarCategoria(${i})" title="Aprovar"><i class="bi bi-check-lg"></i></button>
                <button class="btn btn-sm btn-danger" onclick="window.rejeitarCategoria(${i})" title="Recusar"><i class="bi bi-x-lg"></i></button>
            </div>
        </div>
    `).join('');
}

window.aprovarCategoria = function(index) {
    const pendentes = JSON.parse(localStorage.getItem('emCategoriasPendentes') || '[]');
    const item = pendentes[index];
    if (!item) return;
    const aprovadas = JSON.parse(localStorage.getItem('emCategoriasAprovadas') || '[]');
    if (!aprovadas.includes(item.nome)) aprovadas.push(item.nome);
    localStorage.setItem('emCategoriasAprovadas', JSON.stringify(aprovadas));
    pendentes.splice(index, 1);
    localStorage.setItem('emCategoriasPendentes', JSON.stringify(pendentes));
    showToast(`Categoria "${item.nome}" aprovada!`, 'success');
    renderPendingCategories();
    // Recarrega o select de categorias se a página de criação estiver aberta
    const catSelect = document.getElementById('caCategory');
    if (catSelect && document.querySelector('.create-ad-active')) {
        const selected = catSelect.value;
        catSelect.innerHTML = renderCategoriaOptions(selected);
    }
};

window.rejeitarCategoria = function(index) {
    const pendentes = JSON.parse(localStorage.getItem('emCategoriasPendentes') || '[]');
    const item = pendentes[index];
    if (!item) return;
    pendentes.splice(index, 1);
    localStorage.setItem('emCategoriasPendentes', JSON.stringify(pendentes));
    showToast(`Categoria "${item.nome}" recusada.`, 'warning');
    renderPendingCategories();
};

/**
 * Monta o HTML de uma bolha de mensagem no MESMO padrão visual do chat
 * cliente ? vendedor (.msg-row/.msg-bubble), usado tanto na visão de admin
 * de conversas de pedido quanto na de chamados de suporte. Mensagens da
 * equipe de suporte (isStaff) ficam — direita, destacadas em amarelo.
 */
function adminMsgBubbleHtml(m, index, resolveSenderName, myAvatarSrc, partnerAvatarSrc) {
    const adminUser = getSavedUser();
    return window.renderMsgBubble(m, index, {
        userId: adminUser?.id || '',
        myAvatar: myAvatarSrc,
        partnerAvatar: partnerAvatarSrc,
        resolveSenderName,
        actions: { reply:'startAdminTicketReply', copy:'copyAdminTicketMessageText', edit:'startAdminTicketEdit', delete:'deleteAdminTicketMessage' },
        useDropdown: true,
        enableGrouping: false
    });
}

// -------- Bolha de mensagem com opções (aba "Chats" do admin) --------
// Mesmo conjunto de recursos do chat de suporte: responder, copiar,
// editar/apagar (só nas próprias mensagens da equipe).

let adminChatsTabReplyIndex = null;
let adminChatsTabEditIndex  = null;

function adminChatsTabMsgBubbleHtml(m, index, resolveSenderName, resolveSenderAvatar) {
    const adminUser = getSavedUser();
    const myAvatar = normalizeImageUrl(safeParseImages(adminUser?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(adminUser?.nome || 'Suporte')}&background=ffc107&color=1c1c1c&size=40`;
    const senderAvatar = resolveSenderAvatar ? resolveSenderAvatar(m) : '';
    const partnerAvatar = senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(resolveSenderName(m) || 'User')}&background=22c98e&color=fff&size=40`;
    return window.renderMsgBubble(m, index, {
        userId: adminUser?.id || '',
        myAvatar,
        partnerAvatar,
        resolveSenderName,
        actions: { reply:'startAdminChatsTabReply', copy:'copyAdminChatsTabMessageText', edit:'startAdminChatsTabEdit', delete:'deleteAdminChatsTabMessage' },
        useDropdown: true,
        enableGrouping: false
    });
}

function adminSupportMsgBubbleHtml(m, index, resolveSenderName, resolveSenderAvatar) {
    const adminUser = getSavedUser();
    const myAvatar = normalizeImageUrl(safeParseImages(adminUser?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(adminUser?.nome || 'Suporte')}&background=ffc107&color=1c1c1c&size=40`;
    const senderAvatar = resolveSenderAvatar ? resolveSenderAvatar(m) : '';
    const partnerAvatar = senderAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(resolveSenderName(m) || 'User')}&background=22c98e&color=fff&size=40`;
    return window.renderMsgBubble(m, index, {
        userId: adminUser?.id || '',
        myAvatar,
        partnerAvatar,
        resolveSenderName,
        actions: { reply:'startAdminSupportReply', copy:'copyAdminSupportMessageText', edit:'startAdminSupportEdit', delete:'deleteAdminSupportMessage' },
        useDropdown: true,
        enableGrouping: false
    });
}

/** Prepara a resposta a uma mensagem específica dentro da aba "Chats" do admin */
window.startAdminChatsTabReply = async function(index) {
    const orderId = window._adminActiveChatOrderId;
    if (!orderId) return;
    const result = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
    const msg = result?.[0]?.messages?.[index];
    if (!msg) return;

    adminChatsTabReplyIndex = index;
    adminChatsTabEditIndex  = null;

    const preview = document.getElementById('adminChatsTabInputPreview');
    if (preview) {
        preview.classList.remove('d-none');
        preview.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div class="small text-truncate" style="max-width: 85%;">
                    <strong class="text-primary d-block">Respondendo a ${msg.senderName || (msg.isStaff ? 'Suporte' : 'Usuário')}</strong>
                    <span class="text-muted">${msg.text}</span>
                </div>
                <i class="bi bi-x-lg cursor-pointer" onclick="window.cancelAdminChatsTabReplyOrEdit()"></i>
            </div>`;
    }
    document.getElementById('adminChatsTabMessageInput')?.focus();
};

/** Começa a editar uma mensagem já enviada pela própria equipe de suporte */
window.startAdminChatsTabEdit = async function(index) {
    const orderId = window._adminActiveChatOrderId;
    if (!orderId) return;
    const result = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
    const msg = result?.[0]?.messages?.[index];
    if (!msg) return;

    adminChatsTabEditIndex  = index;
    adminChatsTabReplyIndex = null;

    const input = document.getElementById('adminChatsTabMessageInput');
    if (input) input.value = msg.text || '';

    const preview = document.getElementById('adminChatsTabInputPreview');
    if (preview) {
        preview.classList.remove('d-none');
        preview.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div class="small"><strong class="text-warning">Editando mensagem...</strong></div>
                <i class="bi bi-x-lg cursor-pointer" onclick="window.cancelAdminChatsTabReplyOrEdit()"></i>
            </div>`;
    }
    input?.focus();
};

/** Cancela a resposta/edição em andamento na aba "Chats" do admin */
window.cancelAdminChatsTabReplyOrEdit = function() {
    adminChatsTabReplyIndex = null;
    adminChatsTabEditIndex  = null;
    const preview = document.getElementById('adminChatsTabInputPreview');
    if (preview) {
        preview.classList.add('d-none');
        preview.innerHTML = '';
    }
    const input = document.getElementById('adminChatsTabMessageInput');
    if (input) input.value = '';
};

/** Copia o texto de uma mensagem dentro da aba "Chats" do admin */
window.copyAdminChatsTabMessageText = async function(index) {
    const orderId = window._adminActiveChatOrderId;
    if (!orderId) return;
    try {
        const result = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const msg = result?.[0]?.messages?.[index];
        if (!msg?.text) return;
        await navigator.clipboard.writeText(msg.text);
        showToast('Mensagem copiada!', 'success', 1500);
    } catch (e) {
        showToast('Não foi possível copiar.', 'error');
    }
};

/** Apaga (soft-delete) uma mensagem própria da equipe de suporte, na aba "Chats" do admin */
window.deleteAdminChatsTabMessage = async function(index) {
    const orderId = window._adminActiveChatOrderId;
    if (!orderId) return;
    if (!confirm('Apagar esta mensagem para todos?')) return;
    try {
        const result = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = result?.[0];
        if (!chat?.messages?.[index]) return;
        chat.messages[index].text    = '';
        chat.messages[index].image   = null;
        chat.messages[index].file    = null;
        chat.messages[index].deleted = true;
        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        window.adminChatsTabSelect(orderId);
    } catch (e) {
        showToast('Erro ao apagar mensagem.', 'error');
    }
};

// -------- Anexo de imagem/arquivo na aba "Chats" do admin (mesmo padrão do chat cliente ? vendedor / suporte) --------

let adminChatsTabAttachType = 'image'; // 'image' | 'file'

window.toggleAdminChatsTabAttachPanel = function() {
    const panel = document.getElementById('adminChatsTabAttachPanel');
    if (!panel) return;
    panel.classList.toggle('d-none');
    if (!panel.classList.contains('d-none')) {
        document.getElementById('adminChatsTabAttachLinkInput')?.focus();
    }
};

window.setAdminChatsTabAttachType = function(type) {
    adminChatsTabAttachType = type;
    document.querySelectorAll('#adminChatsTabAttachPanel .chat-attach-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.attachType === type);
    });
    const mapping = { image: 'adminChatsTabAttachPanelImageBox', file: 'adminChatsTabAttachPanelFileBox', location: 'adminChatsTabAttachPanelLocationBox' };
    Object.entries(mapping).forEach(([t, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('d-none', type !== t);
    });
    const input = document.getElementById('adminChatsTabAttachLinkInput');
    if (input) input.placeholder = type === 'image' ? 'Cole o link da imagem...' : 'Cole o link do arquivo...';
};

window.confirmAdminChatsTabAttach = async function(orderId) {
    const input = document.getElementById('adminChatsTabAttachLinkInput');
    const url   = input?.value?.trim();
    if (!url || !url.startsWith('http')) {
        showToast('Cole um link válido (começando com http).', 'warning');
        return;
    }
    const user = getSavedUser();

    try {
        const result = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = result?.[0];
        if (!chat) return;
        const messages = chat.messages || [];

        if (adminChatsTabAttachType === 'image') {
            messages.push({
                senderId: user.id, senderName: `${user.nome} (Suporte)`,
                text: 'Imagem', image: normalizeImageUrl(url),
                timestamp: new Date().toISOString(), type: 'image', isStaff: true
            });
        } else {
            messages.push({
                senderId: user.id, senderName: `${user.nome} (Suporte)`,
                text: `Arquivo: ${url.split('/').pop()}`,
                file: { name: 'Arquivo Externo', url, size: 0 },
                timestamp: new Date().toISOString(), type: 'file', isStaff: true
            });
        }

        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        input.value = '';
        document.getElementById('adminChatsTabAttachPanel')?.classList.add('d-none');
        window.adminChatsTabSelect(orderId);
    } catch (e) {
        showToast('Erro ao enviar anexo.', 'error');
    }
};

window.sendAdminChatsTabLocation = async function(orderId) {
    const user = getSavedUser();
    const addr = user?.endereco || user?.cidade;
    if (!addr) { showToast('Cadastre um endereço no seu perfil para compartilhar.', 'info'); return; }
    const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);
    try {
        const result = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = result?.[0];
        if (!chat) return;
        const messages = chat.messages || [];
        messages.push({
            senderId: user.id, senderName: `${user.nome} (Suporte)`,
            text: `?? ${addr}\n${mapsUrl}`,
            timestamp: new Date().toISOString(), type: 'location', isStaff: true
        });
        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        document.getElementById('adminChatsTabAttachPanel')?.classList.add('d-none');
        window.adminChatsTabSelect(orderId);
        showToast('Localização enviada!', 'success');
    } catch (e) {
        showToast('Erro ao enviar localização.', 'error');
    }
};

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
        const adminUser = getSavedUser();
        const adminChatMyAvatar = normalizeImageUrl(safeParseImages(adminUser?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(adminUser?.nome || 'Suporte')}&background=ffc107&color=1c1c1c&size=40`;
        const partnerFromCache = (window._adminUsersCache || []).find(u => u.id === order?.buyer_id);
        const adminChatPartnerAvatar = normalizeImageUrl(safeParseImages(partnerFromCache?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent((order?.buyer_name || '?').slice(0,2))}&background=22c98e&color=fff&size=40`;
        window.__setupReactionHooks(chat, c => supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages: c.messages }) }), () => adminRefreshCurrentView());
        // Marca como visto mensagens dos participantes
        { const adminUser = getSavedUser(); let changed = false; (chat.messages || []).forEach(m => { if (m.senderId && m.senderId !== adminUser?.id && !m.visto) { m.visto = true; changed = true; } }); if (changed) { supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) }).catch(() => {}); } }
        const msgsHtml = (chat.messages || []).map((m, i) => adminMsgBubbleHtml(m, i, resolveSenderName, adminChatMyAvatar, adminChatPartnerAvatar)).join('')
            || '<div class="text-center text-muted py-4">Sem mensagens.</div>';
        const msgCount = (chat.messages || []).filter(m => m.type !== 'system').length;

        const closed = getChatClosed(chat);

        grid.className = 'admin-panel-active';
        grid.innerHTML = `
            <div class="admin-standalone-page">
                <div class="d-flex align-items-center gap-2 mb-3">
                    <button class="btn btn-sm btn-ml-secondary" onclick="adminRefreshCurrentView()"><i class="bi bi-arrow-left me-1"></i>Voltar</button>
                    <h5 class="fw-bold mb-0">Conversa do pedido <span class="admin-row-badge ${closed ? 'badge-muted' : 'badge-open'} ms-1">${closed ? 'Encerrado' : (ORDER_STATUS_MAP[order?.status]?.text || 'Aberto')}</span></h5>
                </div>
                <div class="wa-main admin-chat-main" style="margin:0;">
                    <section class="wa-chat" style="flex-grow:1;">
                        ${window.renderChatContainer({
                            chatId: orderId,
                            chat,
                            order,
                            partner: { name: order?.product_title || 'Pedido #' + orderId.slice(-6), avatar: order?.product_img || 'https://placehold.co/45/e9ecef/6c757d?text=%20' },
                            msgsId: 'adminChatMsgsBody',
                            inputId: 'adminChatInput',
                            previewId: 'adminChatInputPreview',
                            attachPanelId: 'adminChatAttachPanel',
                            attachLinkId: 'adminChatAttachLinkInput',
                            participantsId: 'adminChatParticipants',
                            statusBarId: 'adminChatStatusBar',
                            onSend: `window.adminSendChatMessage('${orderId}')`,
                            onBack: 'window.adminRefreshCurrentView()',
                            onClose: closed ? '' : `window.adminCloseChat('${orderId}')`,
                            onDelete: `window.adminDeleteChat('${orderId}')`,
                            onToggleParticipants: `window.adminToggleParticipants()`,
                            showBackBtn: true,
                            showCloseBtn: false,
                            showAttach: false,
                            showDeleteBtn: order?.status === 'finished'
                        })}
                    </section>
                </div>
            </div>`;

        const msgsBody = document.getElementById('adminChatMsgsBody');
        if (msgsBody) {
            msgsBody.innerHTML = msgsHtml;
            msgsBody.scrollTop = msgsBody.scrollHeight;
        }

        const participantsPanel = document.getElementById('adminChatParticipants');
        if (participantsPanel && order) {
            participantsPanel.innerHTML = `
                <div class="chat-participant-row">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order.buyer_name || '?')}&background=3483fa&color=fff" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">
                    <div class="chat-participant-info">
                        <strong>${order.buyer_name || 'Comprador não identificado'}</strong>
                        <small><i class="bi bi-bag-fill me-1"></i>Comprador</small>
                    </div>
                </div>
                <div class="chat-participant-row">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order.seller_name || '?')}&background=22c98e&color=fff" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">
                    <div class="chat-participant-info">
                        <strong>${order.seller_name || 'Vendedor não identificado'}</strong>
                        <small><i class="bi bi-shop me-1"></i>Vendedor</small>
                    </div>
                </div>`;
        }
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

        const closedChat = withChatClosed({ messages }, true);
        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages: closedChat.messages }) });
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
// Mesmo layout visual do chat cliente ? vendedor (lista lateral de conversas
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
                        <img src="${order.product_img || ''}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://placehold.co/45'">
                        <div class="wa-contact-textbox">
                            <div class="wa-contact-name">${order.product_title || 'Pedido #' + c.order_id?.slice(-6)}</div>
                            <div class="wa-contact-text">${order.buyer_name || '?'} ? ${order.seller_name || '?'} • ${msgCount} msgs</div>
                            ${lastMsg ? `<div class="wa-contact-text fst-italic">"${(lastMsg.text || '[mídia]').slice(0,40)}"</div>` : ''}
                        </div>
                        <span class="badge ${c.closed ? 'bg-secondary' : 'bg-success'} wa-contact-badge">${c.closed ? 'Encerrado' : (ORDER_STATUS_MAP[order.status]?.text || 'Aberto')}</span>
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
        const adminUser = getSavedUser();
        const adminChatMyAvatar = normalizeImageUrl(safeParseImages(adminUser?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(adminUser?.nome || 'Suporte')}&background=ffc107&color=1c1c1c&size=40`;
        const partnerFromCache = (window._adminUsersCache || []).find(u => u.id === order?.buyer_id);
        const adminChatPartnerAvatar = normalizeImageUrl(safeParseImages(partnerFromCache?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent((order?.buyer_name || '?').slice(0,2))}&background=22c98e&color=fff&size=40`;
        window.__setupReactionHooks(chat, c => supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages: c.messages }) }), () => adminChatsModalSelect(orderId));
        // Marca como visto mensagens dos participantes
        { const adminUser = getSavedUser(); let changed = false; (chat.messages || []).forEach(m => { if (m.senderId && m.senderId !== adminUser?.id && !m.visto) { m.visto = true; changed = true; } }); if (changed) { supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) }).catch(() => {}); } }
        const msgsHtml = (chat.messages || []).map((m, i) => adminMsgBubbleHtml(m, i, resolveSenderName, adminChatMyAvatar, adminChatPartnerAvatar)).join('')
            || '<div class="text-center text-muted py-4">Sem mensagens.</div>';
        const msgCount = (chat.messages || []).filter(m => m.type !== 'system').length;
        const closed = getChatClosed(chat);
        const st = ORDER_STATUS_MAP[order?.status] || { text: order?.status || ' • ', class: 'bg-secondary' };

        activeEl.innerHTML = window.renderChatContainer({
            chatId: orderId,
            chat,
            order,
            partner: { name: order?.product_title || 'Pedido #' + orderId.slice(-6), avatar: order?.product_img || 'https://placehold.co/45/e9ecef/6c757d?text=%20' },
            msgsId: 'adminChatsModalMsgsBody',
            inputId: 'adminChatsModalInput',
            previewId: 'adminChatsModalInputPreview',
            attachPanelId: 'adminChatsModalAttachPanel',
            attachLinkId: 'adminChatsModalAttachLinkInput',
            participantsId: 'adminChatsModalParticipants',
            statusBarId: 'adminChatsModalStatusBar',
            onSend: `window.adminChatsModalSend('${orderId}')`,
            onBack: 'window.adminChatsModalBack()',
            onClose: closed ? '' : `window.adminChatsModalCloseChat('${orderId}')`,
            onDelete: `window.adminChatsModalDelete('${orderId}')`,
            onToggleParticipants: `window.adminToggleParticipants('adminChatsModalParticipants')`,
            onToggleAttachPanel: 'window.toggleChatAttachPanel()',
            onConfirmAttach: `window.confirmAdminChatsModalAttach('${orderId}')`,
            onSendLocation: `window.sendAdminChatsModalLocation('${orderId}')`,
            onSendFile: 'window.sendAdminChatsModalFile',
            showBackBtn: true,
            showCloseBtn: false,
            showAttach: true,
            showDeleteBtn: true,
            statusInfo: { text: STATUS_BAR_MAP[order?.status] || st.text, class: statusToAlertClass(order?.status) },
            statusText: '',
            extraHeaderHtml: `<button type="button" class="ml-auth-close chat-header-x" aria-label="Fechar" data-bs-dismiss="modal" style="position:static;border-radius:50%;width:34px;height:34px;font-size:0.9rem;margin-left:4px;"><i class="bi bi-x-lg"></i></button>`
        });

        const msgsBody = document.getElementById('adminChatsModalMsgsBody');
        if (msgsBody) {
            msgsBody.innerHTML = msgsHtml;
            msgsBody.scrollTop = msgsBody.scrollHeight;
        }

        const participantsPanel = document.getElementById('adminChatsModalParticipants');
        if (participantsPanel && order) {
            participantsPanel.innerHTML = `
                <div class="chat-participant-row">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order.buyer_name || '?')}&background=3483fa&color=fff" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">
                    <div class="chat-participant-info">
                        <strong>${order.buyer_name || 'Comprador não identificado'}</strong>
                        <small><i class="bi bi-bag-fill me-1"></i>Comprador</small>
                    </div>
                </div>
                <div class="chat-participant-row">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order.seller_name || '?')}&background=22c98e&color=fff" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">
                    <div class="chat-participant-info">
                        <strong>${order.seller_name || 'Vendedor não identificado'}</strong>
                        <small><i class="bi bi-shop me-1"></i>Vendedor</small>
                    </div>
                </div>`;
        }
    } catch (e) {
        console.error(e);
        showToast('Erro ao carregar a conversa.', 'error');
    }
};

/** No mobile, volta da conversa aberta pra lista lateral sem fechar o modal */
window.adminChatsModalBack = function() {
    document.getElementById('adminChatsModalMain')?.classList.remove('wa-chat-open');
};

// -------- Anexo de imagem/arquivo/localização na Central de Conversas (mesmo padrão do chat cliente ? vendedor) --------

let adminChatsModalAttachType = 'image'; // 'image' | 'file'

window.toggleAdminChatsModalAttachPanel = function() {
    const panel = document.getElementById('adminChatsModalAttachPanel');
    if (!panel) return;
    panel.classList.toggle('d-none');
    if (!panel.classList.contains('d-none')) {
        document.getElementById('adminChatsModalAttachLinkInput')?.focus();
    }
};

window.setAdminChatsModalAttachType = function(type) {
    adminChatsModalAttachType = type;
    document.querySelectorAll('#adminChatsModalAttachPanel .chat-attach-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.attachType === type);
    });
    const mapping = { image: 'adminChatsModalAttachPanelImageBox', file: 'adminChatsModalAttachPanelFileBox', location: 'adminChatsModalAttachPanelLocationBox' };
    Object.entries(mapping).forEach(([t, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('d-none', type !== t);
    });
    const input = document.getElementById('adminChatsModalAttachLinkInput');
    if (input) input.placeholder = type === 'image' ? 'Cole o link da imagem...' : 'Cole o link do arquivo...';
};

window.confirmAdminChatsModalAttach = async function(orderId) {
    const input = document.getElementById('adminChatsModalAttachLinkInput');
    const url   = input?.value?.trim();
    if (!url || !url.startsWith('http')) {
        showToast('Cole um link válido (começando com http).', 'warning');
        return;
    }
    const user = getSavedUser();
    try {
        const result = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = result?.[0];
        if (!chat) return;
        const messages = chat.messages || [];
        if (adminChatsModalAttachType === 'image') {
            messages.push({
                senderId: user.id, senderName: `${user.nome} (Suporte)`,
                text: 'Imagem', image: normalizeImageUrl(url),
                timestamp: new Date().toISOString(), type: 'image', isStaff: true
            });
        } else {
            messages.push({
                senderId: user.id, senderName: `${user.nome} (Suporte)`,
                text: `Arquivo: ${url.split('/').pop()}`,
                file: { name: 'Arquivo Externo', url, size: 0 },
                timestamp: new Date().toISOString(), type: 'file', isStaff: true
            });
        }
        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        input.value = '';
        document.getElementById('adminChatsModalAttachPanel')?.classList.add('d-none');
        window.adminChatsModalSelect(orderId);
    } catch (e) {
        showToast('Erro ao enviar anexo.', 'error');
    }
};

window.sendAdminChatsModalLocation = async function(orderId) {
    const user = getSavedUser();
    const addr = user?.endereco || user?.cidade;
    if (!addr) { showToast('Cadastre um endereço no seu perfil para compartilhar.', 'info'); return; }
    const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);
    try {
        const result = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = result?.[0];
        if (!chat) return;
        const messages = chat.messages || [];
        messages.push({
            senderId: user.id, senderName: `${user.nome} (Suporte)`,
            text: `?? ${addr}\n${mapsUrl}`,
            timestamp: new Date().toISOString(), type: 'location', isStaff: true
        });
        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        document.getElementById('adminChatsModalAttachPanel')?.classList.add('d-none');
        window.adminChatsModalSelect(orderId);
        showToast('Localização enviada!', 'success');
    } catch (e) {
        showToast('Erro ao enviar localização.', 'error');
    }
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

        const closedChat = withChatClosed({ messages }, true);
        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages: closedChat.messages }) });
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
// Lista no MESMO padrão visual das outras abas do admin (admin-card +
// admin-row, igual Publicações/Usuários/Suporte). Ao abrir uma conversa,
// ela ocupa a tela toda no lugar da lista — igual ao chat cliente ?
// vendedor (mesmas classes chat-header-pro/chat-product-summary/chat-
// messages/chat-input-bar), só que sem lista lateral do lado, e com as
// ações de administrador (encerrar/apagar) integradas ao próprio chat.

/** Preenche a lista da aba "Chats" com as conversas já carregadas pelo renderAdminPanel */
window.renderAdminSupportTab = function(chats, tickets, orders, users) {
    const list = document.getElementById('adminSupportContactList');
    if (!list) return;

    window._adminSupportData = { chats, tickets, orders, users };

    const buildContactList = (term = '') => {
        const q = term.trim().toLowerCase();

        // Build unified contacts
        const contacts = [];

        // Order chats
        chats.forEach(c => {
            const order = orders.find(o => o.id === c.order_id) || {};
            const lastMsg = (c.messages || []).slice().reverse().find(m => m.type !== 'ticket_meta');
            const name = order.product_title || 'Pedido #' + c.order_id?.slice(-6);
            const buyer = order.buyer_name || '?';
            const seller = order.seller_name || '?';

            contacts.push({
                id: c.order_id,
                type: 'order',
                name,
                subname: `${buyer} ? ${seller}`,
                avatar: order.product_img || 'https://placehold.co/45/e9ecef/6c757d?text=Ped',
                lastMsg: lastMsg?.text || (lastMsg?.image ? '[Imagem]' : ''),
                lastTime: lastMsg?.timestamp || c.created_at || '',
                closed: getChatClosed(c),
                messages: c.messages || [],
                chat: c,
                order
            });
        });

        // Support tickets
        tickets.forEach(t => {
            const msgs = t.messages || [];
            const lastMsg = msgs.slice().reverse().find(m => m.type !== 'ticket_meta');
            const roleLabel = t.requester_role === 'ADMIN' ? 'Admin' : (t.requester_role === 'VENDEDOR' ? 'Vendedor' : 'Cliente');

            contacts.push({
                id: t.id,
                type: 'ticket',
                name: t.requester_name || 'Visitante',
                subname: `${getTicketLabel(t)} • ${roleLabel}`,
                avatar: t.requester_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((t.requester_name || '?').slice(0,2))}&background=e50914&color=fff&size=45`,
                lastMsg: lastMsg?.text || (lastMsg?.image ? '[Imagem]' : ''),
                lastTime: lastMsg?.timestamp || '',
                closed: t.status === 'closed',
                messages: msgs,
                ticket: t
            });
        });

        // Sort by last message time (most recent first)
        contacts.sort((a, b) => {
            const ta = a.lastTime ? new Date(a.lastTime).getTime() : 0;
            const tb = b.lastTime ? new Date(b.lastTime).getTime() : 0;
            return tb - ta;
        });

        const countEl = document.getElementById('adminSupportSidebarCount');
        if (countEl) {
            const open = contacts.filter(c => !c.closed).length;
            countEl.textContent = `${open} aberto${open !== 1 ? 's' : ''} • ${contacts.length} total`;
        }

        // Filter
        const filtered = !q ? contacts : contacts.filter(c =>
            `${c.name} ${c.subname}`.toLowerCase().includes(q)
        );

        if (filtered.length === 0) {
            list.innerHTML = '<div class="text-center text-muted small py-5 px-3">Nenhuma conversa encontrada.</div>';
            return;
        }

        // Separate into sections when not searching
        const renderContact = (c) => {
            const isActive = window._adminActiveSupportId === c.id;
            const timeStr = c.lastTime ? new Date(c.lastTime).toLocaleString('pt-BR', { hour:'2-digit', minute:'2-digit' }) : '';
            return `
                <div class="wa-contact ${isActive ? 'active-chat' : ''}" onclick="window.adminSupportSelect('${c.id}', '${c.type}')" data-contact-id="${c.id}">
                    <img src="${safeParseImages(c.avatar)[0] || c.avatar}" class="wa-contact-avatar" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://placehold.co/45/e9ecef/6c757d?text=%3F'">
                    <div class="wa-contact-textbox">
                        <div class="wa-contact-name">${c.name}</div>
                        <div class="wa-contact-text">${c.lastMsg ? window.stripLegacyEmoji?.(c.lastMsg.slice(0, 60)) || c.lastMsg.slice(0, 60) : 'Nenhuma mensagem'}</div>
                        <small class="text-muted" style="font-size:0.68rem;">${c.subname}</small>
                    </div>
                    <div class="wa-contact-badge text-end" style="flex-shrink:0;">
                        <small class="text-muted" style="font-size:0.65rem;">${timeStr}</small>
                        <div><span class="admin-row-badge ${c.closed ? 'badge-muted' : (c.type === 'ticket' ? 'badge-ticket' : 'badge-open')}" style="font-size:0.6rem;padding:1px 6px;"><i class="bi ${c.closed ? 'bi-lock-fill' : (c.type === 'ticket' ? 'bi-headset' : 'bi-bag-fill')} me-1"></i>${c.closed ? 'Enc.' : (c.type === 'ticket' ? 'Solicitação Aberta' : (ORDER_STATUS_MAP[c.order?.status]?.text || 'Aberto'))}</span></div>
                    </div>
                </div>`;
        };

        if (q) {
            // Search mode: mixed
            list.innerHTML = filtered.map(renderContact).join('');
        } else {
            // Separated sections
            const chatsSection = contacts.filter(c => c.type === 'order');
            const ticketsSection = contacts.filter(c => c.type === 'ticket');
            let html = '';
            if (chatsSection.length) {
                html += `<div class="wa-contact-section-header"><span>Conversas de Pedido</span><span class="small text-muted">${chatsSection.length}</span></div>`;
                html += chatsSection.map(renderContact).join('');
            }
            if (ticketsSection.length) {
                html += `<div class="wa-contact-section-header"><span>Chamados de Suporte</span><span class="small text-muted">${ticketsSection.length}</span></div>`;
                html += ticketsSection.map(renderContact).join('');
            }
            list.innerHTML = html;
        }
    };

    window._adminSupportBuildList = buildContactList;
    buildContactList();
};

window.filterAdminSupportContacts = function(query) {
    if (window._adminSupportBuildList) window._adminSupportBuildList(query);
};

window.adminSupportSelect = async function(id, type) {
    window._adminActiveSupportId = id;
    // Garante que nenhuma classe de modal de suporte do USUÁRIO fique
    // ativa por engano (evita o chat abrir "dentro de outro modal").
    document.body.classList.remove('support-chat-fullscreen');
    document.body.classList.add('wa-locked', 'admin-chat-fullscreen');
    const adminUser = getSavedUser();

    // Update active state in sidebar
    document.querySelectorAll('#adminSupportContactList .wa-contact').forEach(el => el.classList.remove('active-chat'));
    const activeEl = document.querySelector(`#adminSupportContactList [data-contact-id="${id}"]`);
    if (activeEl) activeEl.classList.add('active-chat');

    const emptyEl = document.getElementById('adminSupportEmpty');
    const activeChatEl = document.getElementById('adminSupportChatActive');

    emptyEl?.classList.add('d-none');
    activeChatEl?.classList.remove('d-none');
    activeChatEl.innerHTML = '<div class="text-center py-5 flex-grow-1"><div class="spinner-border text-danger"></div></div>';

    // Mobile: hide sidebar, show chat
    const waMain = document.querySelector('#adminSupportFullscreen .wa-main, #admin-support .wa-main');
    if (waMain && window.innerWidth < 768) waMain.classList.add('wa-chat-open');

    try {
        if (type === 'order') {
            // Fetch order chat
            const [chatResult, order] = await Promise.all([
                supabaseFetch(`chats?order_id=eq.${id}&limit=1`),
                Promise.resolve(adminOrdersCache.find(o => o.id === id))
            ]);
            const chat = chatResult?.[0];
            if (!chat) { showToast('Conversa não encontrada.', 'error'); window.adminSupportBack(); return; }

            const resolveSenderName = (m) => (m.senderId === order?.buyer_id ? order?.buyer_name : order?.seller_name);
            const resolveSenderAvatar = (m) => {
                if (m.senderId === adminUser?.id) return '';
                const u = (window._adminUsersCache || []).find(u => u.id === m.senderId);
                return u ? (normalizeImageUrl(safeParseImages(u.avatar)[0]) || '') : '';
            };
            window.__setupReactionHooks(chat,
                c => supabaseFetch(`chats?order_id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ messages: c.messages }) }),
                () => window.adminSupportSelect(id, type)
            );
            // Mark as seen
            { let changed = false; (chat.messages || []).forEach(m => { if (m.senderId && m.senderId !== adminUser?.id && !m.visto) { m.visto = true; changed = true; } }); if (changed) { supabaseFetch(`chats?order_id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) }).catch(() => {}); } }

            const msgsHtml = (chat.messages || []).map((m, i) => adminSupportMsgBubbleHtml(m, i, resolveSenderName, resolveSenderAvatar)).join('')
                || '<div class="text-center text-muted py-4">Sem mensagens.</div>';
            const msgCount = (chat.messages || []).filter(m => m.type !== 'system').length;
            const st = ORDER_STATUS_MAP[order?.status] || { text: order?.status || ' • ', class: 'bg-secondary' };
            const closed = getChatClosed(chat);

            activeChatEl.innerHTML = window.renderChatContainer({
                chatId: id,
                chat,
                order,
                partner: { name: order?.buyer_name || 'Comprador', avatar: order?.product_img || 'https://placehold.co/45/e9ecef/6c757d?text=%20' },
                msgsId: 'adminSupportMsgsBody',
                inputId: 'adminSupportChatInput',
                previewId: 'adminSupportInputPreview',
                attachPanelId: 'adminSupportAttachPanel',
                attachLinkId: 'adminSupportAttachLinkInput',
                participantsId: 'adminSupportParticipants',
                statusBarId: 'adminSupportStatusBar',
                onSend: `window.adminSupportSendMessage('${id}', 'order')`,
                onBack: 'window.adminSupportBack()',
                onClose: closed ? '' : `window.adminSupportCloseChat('${id}')`,
                onDelete: `window.adminSupportDelete('${id}', 'order')`,
                onToggleParticipants: `window.adminToggleParticipants('adminSupportParticipants')`,
                onToggleAttachPanel: 'window.toggleAdminSupportAttachPanel()',
                onConfirmAttach: `window.confirmAdminSupportAttach('${id}')`,
                onSendLocation: `window.sendAdminSupportLocation('${id}')`,
                onSendFile: 'window.sendAdminSupportFile',
                showBackBtn: true,
                showCloseBtn: false,
                showAttach: true,
                showDeleteBtn: true,
                statusInfo: { text: st.text, class: closed ? 'secondary' : statusToAlertClass(order?.status) },
                statusText: '',
                extraHeaderHtml: ''
            });

            const msgsBody = document.getElementById('adminSupportMsgsBody');
            if (msgsBody) { msgsBody.innerHTML = msgsHtml; msgsBody.scrollTop = msgsBody.scrollHeight; }
            const participantsPanel = document.getElementById('adminSupportParticipants');
            if (participantsPanel) {
                participantsPanel.innerHTML = `
                    <div class="chat-participant-row">
                        <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order?.buyer_name || '?')}&background=3483fa&color=fff" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">
                        <div class="chat-participant-info">
                            <strong>${order?.buyer_name || 'Comprador'}</strong>
                            <small><i class="bi bi-bag-fill me-1"></i>Comprador</small>
                        </div>
                    </div>
                    <div class="chat-participant-row">
                        <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order?.seller_name || '?')}&background=22c98e&color=fff" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">
                        <div class="chat-participant-info">
                            <strong>${order?.seller_name || 'Vendedor'}</strong>
                            <small><i class="bi bi-shop me-1"></i>Vendedor</small>
                        </div>
                    </div>`;
            }

        } else {
            // Support ticket
            const result = await supabaseFetch(`chats?id=eq.${id}&limit=1`);
            const ticket = normalizeTicket(result?.[0]);
            if (!ticket) { showToast('Chamado não encontrado.', 'error'); window.adminSupportBack(); return; }

            const resolveSenderName = () => ticket.requester_name;
            const resolveSenderAvatar = (m) => {
                if (m.senderId === adminUser?.id) return '';
                return ticket.requester_avatar || '';
            };
            const myAvatar = normalizeImageUrl(safeParseImages(adminUser?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(adminUser?.nome || 'Suporte')}&background=ffc107&color=1c1c1c&size=40`;
            const requesterAvatar = safeParseImages(ticket.requester_avatar)[0] || `https://ui-avatars.com/api/?name=${encodeURIComponent((ticket.requester_name || '?').slice(0,2))}&background=e50914&color=fff&size=40`;
            let deleteOtherCallback = '';
            if (ticket.order_id) {
                const orderResult = await supabaseFetch(`orders?id=eq.${ticket.order_id}&select=seller_id,buyer_id&limit=1`);
                const orderData = orderResult?.[0];
                const otherId = orderData?.seller_id && orderData.seller_id !== ticket.requester_id ? orderData.seller_id
                    : (orderData?.buyer_id && orderData.buyer_id !== ticket.requester_id ? orderData.buyer_id : null);
                if (otherId) {
                    deleteOtherCallback = `window.adminDeleteUserAccount('${otherId}', 'Participante')`;
                }
            }
            window.__setupReactionHooks(ticket,
                c => supabaseFetch(`chats?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ messages: c.messages }) }),
                () => window.adminSupportSelect(id, type)
            );
            { let changed = false; (ticket.messages || []).forEach(m => { if (m.senderId && m.senderId !== adminUser?.id && !m.visto) { m.visto = true; changed = true; } }); if (changed) { supabaseFetch(`chats?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ messages: ticket.messages }) }).catch(() => {}); } }
            const msgsHtml = (ticket.messages || []).map((m, i) => adminSupportMsgBubbleHtml(m, i, resolveSenderName, resolveSenderAvatar)).join('')
                || '<div class="text-center text-muted py-4">Sem mensagens.</div>';
            const msgCount = (ticket.messages || []).filter(m => m.type !== 'system').length;
            const roleLabel = ticket.requester_role === 'ADMIN' ? 'Administrador' : (ticket.requester_role === 'VENDEDOR' ? 'Vendedor' : 'Cliente');
            const reasonLabel = getTicketLabel(ticket);

            activeChatEl.innerHTML = window.renderChatContainer({
                chatId: id,
                chat: ticket,
                partner: { name: ticket.requester_name || 'Visitante', avatar: requesterAvatar },
                msgsId: 'adminSupportMsgsBody',
                inputId: 'adminSupportChatInput',
                previewId: 'adminSupportInputPreview',
                attachPanelId: 'adminSupportAttachPanel',
                attachLinkId: 'adminSupportAttachLinkInput',
                participantsId: 'adminSupportTicketParticipants',
                statusBarId: 'adminSupportTicketStatusBar',
                onSend: `window.adminSupportSendMessage('${id}', 'ticket')`,
                onBack: 'window.adminSupportBack()',
                onClose: ticket.status !== 'closed' ? `window.adminSupportCloseTicket('${id}')` : '',
                onDelete: `window.adminSupportDelete('${id}', 'ticket')`,
                onToggleParticipants: `window.adminToggleParticipants('adminSupportTicketParticipants')`,
                onToggleAttachPanel: 'window.toggleAdminSupportAttachPanel()',
                onConfirmAttach: `window.confirmAdminSupportAttach('${id}')`,
                onSendLocation: `window.sendAdminSupportLocation('${id}')`,
                onSendFile: 'window.sendAdminSupportFile',
                onCloseTicket: ticket.status !== 'closed' ? `window.adminSupportCloseTicket('${id}')` : '',
                onChangeStatus: `window.adminChangeTicketStatus('${id}')`,
                onDeleteRequester: `window.adminDeleteUserAccount('${ticket.requester_id}', '${(ticket.requester_name || 'Solicitante').replace(/'/g, "\\'")}')`,
                onDeleteOtherAccount: deleteOtherCallback,
                showBackBtn: true,
                showCloseBtn: false,
                showAttach: ticket.status !== 'closed',
                showDeleteBtn: ticket.status === 'closed',
                statusInfo: { text: ticket.status === 'closed' ? '<i class="bi bi-lock-fill me-1"></i>Solicitação Encerrada' : '<i class="bi bi-headset me-1"></i>Solicitação Aberta', class: ticket.status === 'closed' ? 'secondary' : 'info' },
                statusText: '',
                extraHeaderHtml: ''
            });

            const msgsBody = document.getElementById('adminSupportMsgsBody');
            if (msgsBody) { msgsBody.innerHTML = msgsHtml; msgsBody.scrollTop = msgsBody.scrollHeight; }
            const participantsPanel = document.getElementById('adminSupportTicketParticipants');
            if (participantsPanel) {
                participantsPanel.innerHTML = `
                    <div class="chat-participant-row">
                        <img src="${requesterAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=3483fa&color=fff&size=40'">
                        <div class="chat-participant-info">
                            <strong>${ticket.requester_name || 'Visitante'}</strong>
                            <small>${ticket.requester_email || 'E-mail não informado'} • ${roleLabel}</small>
                        </div>
                    </div>`;
            }
        }
    } catch (e) {
        console.error(e);
        showToast('Erro ao carregar conversa.', 'error');
    }
};

window.adminSupportBack = function() {
    window._adminActiveSupportId = null;
    document.getElementById('adminSupportEmpty')?.classList.remove('d-none');
    document.getElementById('adminSupportChatActive')?.classList.add('d-none');
    document.querySelectorAll('#adminSupportContactList .wa-contact').forEach(el => el.classList.remove('active-chat'));
    // Mobile: show sidebar again
    const waMain = document.querySelector('#adminSupportFullscreen .wa-main, #admin-support .wa-main');
    if (waMain) waMain.classList.remove('wa-chat-open');
};

window.adminSupportCloseFullscreen = function() {
    window._adminSupportViewOpen = false;
    document.body.classList.remove('wa-locked', 'admin-chat-fullscreen');
    window._adminActiveSupportId = null;
    window.goToAdminTab('admin-overview');
    adminRefreshCurrentView();
};

/**
 * Gera o HTML do painel de anexo completo (3 abas: Mídia / Documentos /
 * Endereço) para o chat de suporte do admin, reaproveitando EXATAMENTE as
 * mesmas funções globais do chat cliente ? vendedor:
 *   - window.sendChatImageFile   (upload Imgur de imagem do PC)
 *   - window.sendChatImage       (envio de imagem por link)
 *   - window.abrirDocHost        (abre Google Drive / OneDrive em nova aba)
 *   - window.sendChatLocation    (atual / cadastrado / link do Maps)
 * O `prefix` ('adminSupport' aqui) — usado pra montar os ids dos inputs.
 */
function supportAttachPanelHtml(prefix) {
    return `
    <div id="${prefix}AttachPanel" class="p-3 bg-light border-top d-none">
        <div class="d-flex gap-2 mb-2">
            <button type="button" class="btn btn-outline-secondary btn-sm flex-grow-1 chat-attach-tab active" data-attach-type="media" onclick="window.setAdminSupportAttachType('media')">
                <i class="bi bi-play-circle me-1"></i>Mídia
            </button>
            <button type="button" class="btn btn-outline-secondary btn-sm flex-grow-1 chat-attach-tab" data-attach-type="docs" onclick="window.setAdminSupportAttachType('docs')">
                <i class="bi bi-file-earmark me-1"></i>Documentos
            </button>
            <button type="button" class="btn btn-outline-secondary btn-sm flex-grow-1 chat-attach-tab" data-attach-type="address" onclick="window.setAdminSupportAttachType('address')">
                <i class="bi bi-geo-alt-fill me-1"></i>Endereço
            </button>
        </div>

        <!-- MÍDIA -->
        <div id="${prefix}AttachBoxMedia">
            <div class="input-group input-group-sm mb-2">
                <span class="input-group-text"><i class="bi bi-link-45deg"></i></span>
                <input type="url" id="${prefix}AttachLinkInputMedia" class="form-control" placeholder="Cole o link da imagem/vídeo...">
                <button type="button" class="ml-attach ml-btn-media" onclick="window.sendAdminSupportImageFromLink(document.getElementById('${prefix}AttachLinkInputMedia').value)">
                    <i class="bi bi-send me-1"></i>Enviar
                </button>
            </div>
            <div class="d-flex gap-2">
                <label class="ml-attach flex-grow-1" style="cursor:pointer;">
                    <i class="bi bi-cloud-upload me-1"></i>Escolher arquivos
                    <input type="file" accept="image/*,video/*" class="d-none" onchange="window.sendAdminSupportImageFile(this)">
                </label>
                <button type="button" class="ml-attach flex-grow-1" onclick="window.abrirUploadExterno()">
                    <i class="bi bi-box-arrow-up-right me-1"></i>Imgur
                </button>
            </div>
        </div>

        <!-- DOCUMENTOS -->
        <div id="${prefix}AttachBoxDocs" class="d-none">
            <div class="input-group input-group-sm mb-2">
                <span class="input-group-text"><i class="bi bi-link-45deg"></i></span>
                <input type="url" id="${prefix}AttachLinkInputDocs" class="form-control" placeholder="Cole o link do documento...">
                <button type="button" class="ml-attach ml-btn-media" onclick="window.sendAdminSupportDoc()">
                    <i class="bi bi-send me-1"></i>Enviar
                </button>
            </div>
            <div class="d-flex gap-2">
                <button type="button" class="ml-attach ml-btn-drive flex-grow-1" onclick="window.abrirDocHost('Google Drive')">
                    <i class="bi bi-google me-1"></i>Google Drive
                </button>
                <button type="button" class="ml-attach ml-btn-onedrive flex-grow-1" onclick="window.abrirDocHost('OneDrive')">
                    <i class="bi bi-microsoft me-1"></i>OneDrive
                </button>
            </div>
        </div>

        <!-- ENDEREÇO -->
        <div id="${prefix}AttachBoxAddress" class="d-none">
            <div class="input-group input-group-sm mb-2">
                <span class="input-group-text"><i class="bi bi-geo-alt-fill"></i></span>
                <input type="url" id="${prefix}AttachLinkInputAddress" class="form-control" placeholder="Cole o link do endereço (Google Maps)...">
                <button type="button" class="ml-attach ml-btn-media" onclick="window.sendAdminSupportLocation('other')">
                    <i class="bi bi-send me-1"></i>Enviar
                </button>
            </div>
            <div class="d-flex gap-2">
                <button type="button" class="ml-attach ml-btn-loc flex-grow-1" onclick="window.sendAdminSupportLocation('current')">
                    <i class="bi bi-geo-alt-fill me-1"></i>Endereço atual
                </button>
                <button type="button" class="ml-attach ml-btn-loc flex-grow-1" onclick="window.sendAdminSupportLocation('stored')">
                    <i class="bi bi-house-door me-1"></i>Endereço cadastrado
                </button>
            </div>
        </div>
    </div>`;
}

/** Abre a tela inteira do Suporte com sidebar + chat, igual ao chat do vendedor/cliente */
window.openAdminSupportFullscreen = async function() {
    const grid = document.getElementById('productsGrid');
    grid.className = 'admin-panel-active';
    grid.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-danger"></div><p class="mt-2">Carregando conversas...</p></div>';

    try {
        const [chats, orders, tickets] = await Promise.all([
            supabaseFetch('chats?select=*&order_id=not.is.null'),
            Promise.resolve(adminOrdersCache || []),
            fetchSupportTicketsSafe()
        ]);

        grid.innerHTML = `
            <div id="adminSupportFullscreen" style="height:100%;display:flex;flex-direction:column;">
                <div class="wa-main admin-chat-main" style="margin:0;flex:1;min-height:0;height:auto;border-radius:0;">
                    <section class="wa-side">
                        <div class="wa-side__header">
                            <h6 class="mb-0">Suporte</h6>
                            <span class="small text-muted ms-auto me-2" id="adminSupportSidebarCount"></span>
                            <button type="button" class="ml-auth-close" aria-label="Fechar" onclick="window.adminSupportCloseFullscreen()" style="position:static;border-radius:50%;width:34px;height:34px;font-size:0.9rem;"><i class="bi bi-x-lg"></i></button>
                        </div>
                        <div class="wa-side__search">
                            <i class="bi bi-search"></i>
                            <input type="text" id="adminSupportSearch" placeholder="Buscar conversa..." autocomplete="off" oninput="window.filterAdminSupportContacts(this.value)">
                        </div>
                        <div id="adminSupportContactList" class="wa-side__list"></div>
                    </section>

                    <section class="wa-chat">
                        <div id="adminSupportEmpty" class="wa-empty-state">
                            <i class="bi bi-chat-square-text"></i>
                            <p>Selecione uma conversa ao lado</p>
                        </div>
                        <div id="adminSupportChatActive" class="d-none h-100 flex-column chat-container" style="margin:0;border-radius:0;"></div>
                    </section>
                </div>
            </div>`;

        window.renderAdminSupportTab(chats, tickets, orders, window._adminUsersCache || []);
    } catch (e) {
        console.error(e);
        grid.innerHTML = '<div class="alert alert-danger">Erro ao carregar conversas de suporte.</div>';
    }
};

// -------- Support tab reply/edit state --------
let adminSupportReplyIndex = null;
let adminSupportEditIndex  = null;
let adminSupportAttachType = 'image';

window.cancelAdminSupportReplyOrEdit = function() {
    adminSupportReplyIndex = null;
    adminSupportEditIndex  = null;
    const preview = document.getElementById('adminSupportInputPreview');
    if (preview) preview.classList.add('d-none');
};

window.startAdminSupportReply = async function(index) {
    const id = window._adminActiveSupportId;
    if (!id) return;
    const data = window._adminSupportData;
    const contact = [...(data?.chats || []), ...(data?.tickets || [])].find(c => c.id === id || c.order_id === id);
    const msg = contact?.messages?.[index];
    if (!msg) return;
    adminSupportReplyIndex = index;
    adminSupportEditIndex  = null;
    const preview = document.getElementById('adminSupportInputPreview');
    if (preview) {
        preview.classList.remove('d-none');
        preview.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div class="small text-truncate" style="max-width:85%;">
                    <strong class="text-primary d-block">Respondendo a ${msg.senderName || (msg.isStaff ? 'Suporte' : 'Usuário')}</strong>
                    <span class="text-muted">${msg.text}</span>
                </div>
                <i class="bi bi-x-lg cursor-pointer" onclick="window.cancelAdminSupportReplyOrEdit()"></i>
            </div>`;
    }
    document.getElementById('adminSupportChatInput')?.focus();
};

window.startAdminSupportEdit = async function(index) {
    const id = window._adminActiveSupportId;
    if (!id) return;
    const data = window._adminSupportData;
    const contact = [...(data?.chats || []), ...(data?.tickets || [])].find(c => c.id === id || c.order_id === id);
    const msg = contact?.messages?.[index];
    if (!msg) return;
    adminSupportEditIndex = index;
    adminSupportReplyIndex = null;
    const input = document.getElementById('adminSupportChatInput');
    if (input) {
        input.value = msg.text || '';
        input.focus();
    }
};

window.copyAdminSupportMessageText = async function(index) {
    const id = window._adminActiveSupportId;
    if (!id) return;
    const data = window._adminSupportData;
    const contact = [...(data?.chats || []), ...(data?.tickets || [])].find(c => c.id === id || c.order_id === id);
    const msg = contact?.messages?.[index];
    if (msg?.text) {
        try { await navigator.clipboard.writeText(msg.text); showToast('Texto copiado!', 'success', 2000); } catch(e) {}
    }
};

window.deleteAdminSupportMessage = async function(index) {
    const id = window._adminActiveSupportId;
    if (!id) return;
    if (!confirm('Apagar esta mensagem?')) return;

    // Determine if it's an order chat or ticket
    const data = window._adminSupportData;
    const isOrder = data?.chats?.some(c => c.order_id === id);
    const endpoint = isOrder ? `chats?order_id=eq.${id}` : `chats?id=eq.${id}`;

    try {
        const result = await supabaseFetch(endpoint + '&limit=1');
        const chat = result?.[0];
        if (!chat) return;
        const messages = chat.messages || [];
        if (messages[index]) {
            messages[index].deleted = true;
            messages[index].text = 'Mensagem apagada';
        }
        await supabaseFetch(isOrder ? `chats?order_id=eq.${id}` : `chats?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        window.adminSupportSelect(id, isOrder ? 'order' : 'ticket');
    } catch(e) {
        showToast('Erro ao apagar mensagem.', 'error');
    }
};

window.adminSupportSendMessage = async function(id, type) {
    const input = document.getElementById('adminSupportChatInput');
    const text  = input?.value.trim();
    if (!text && adminSupportEditIndex === null) return;
    const user = getSavedUser();

    try {
        const endpoint = type === 'order' ? `chats?order_id=eq.${id}` : `chats?id=eq.${id}`;
        const result = await supabaseFetch(endpoint + '&limit=1');
        const chat = result?.[0];
        if (!chat) return;

        const messages = chat.messages || [];

        if (adminSupportEditIndex !== null) {
            if (messages[adminSupportEditIndex]) {
                messages[adminSupportEditIndex].text   = text;
                messages[adminSupportEditIndex].edited = true;
            }
            adminSupportEditIndex = null;
            adminSupportReplyIndex = null;
        } else {
            const replyTarget = (adminSupportReplyIndex !== null) ? messages[adminSupportReplyIndex] : null;
            const newMsg = {
                senderId:   user.id,
                senderName: `${user.nome} (Suporte)`,
                text,
                timestamp:  new Date().toISOString(),
                isStaff:    true
            };
            if (replyTarget) {
                newMsg.replyTo = { senderName: replyTarget.senderName || (replyTarget.isStaff ? 'Suporte' : 'Usuário'), text: replyTarget.text || (replyTarget.image ? '[imagem]' : '') };
            }
            messages.push(newMsg);
            adminSupportReplyIndex = null;
        }

        await supabaseFetch(type === 'order' ? `chats?order_id=eq.${id}` : `chats?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        input.value = '';
        window.cancelAdminSupportReplyOrEdit();
        window.adminSupportSelect(id, type);
    } catch(e) {
        showToast('Erro ao enviar mensagem.', 'error');
    }
};

window.adminSupportCloseChat = async function(orderId) {
    if (!confirm('Encerrar este atendimento?\nUma mensagem de encerramento será registrada na conversa.')) return;
    const user = getSavedUser();
    try {
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = chatData?.[0];
        if (!chat) return;
        const messages = chat.messages || [];
        messages.push({
            type: 'system', senderId: 'system',
            text: `Atendimento encerrado por ${user.nome} (Suporte).`,
            timestamp: new Date().toISOString()
        });
        const closedChat = withChatClosed({ messages }, true);
        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages: closedChat.messages }) });
        showToast('Atendimento encerrado.', 'success');
        window.adminSupportSelect(orderId, 'order');
        if (window._adminSupportBuildList) window._adminSupportBuildList();
    } catch(e) { showToast('Erro ao encerrar atendimento.', 'error'); }
};

window.adminSupportCloseTicket = async function(ticketId) {
    if (!confirm('Encerrar este chamado?\nUma mensagem de encerramento será registrada.')) return;
    const user = getSavedUser();
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = result?.[0];
        if (!ticket) return;
        const messages = ticket.messages || [];
        messages.push({
            type: 'system', senderId: 'system',
            text: `Chamado encerrado por ${user.nome} (Suporte).`,
            timestamp: new Date().toISOString()
        });
        const closedChat = withChatClosed({ messages }, true);
        await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages: closedChat.messages }) });
        showToast('Chamado encerrado.', 'success');
        window.adminSupportSelect(ticketId, 'ticket');
        if (window._adminSupportBuildList) window._adminSupportBuildList();
    } catch(e) { showToast('Erro ao encerrar chamado.', 'error'); }
};

window.adminSupportDelete = async function(id, type) {
    const label = type === 'order' ? 'conversa e o pedido' : 'chamado';
    if (!confirm(`Apagar ${label} permanentemente?\nEsta ação não pode ser desfeita.`)) return;
    try {
        if (type === 'order') {
            await supabaseFetch(`chats?order_id=eq.${id}`, { method: 'DELETE' });
            await supabaseFetch(`orders?id=eq.${id}`, { method: 'DELETE' });
        } else {
            await supabaseFetch(`chats?id=eq.${id}`, { method: 'DELETE' });
        }
        showToast(`${label.charAt(0).toUpperCase() + label.slice(1)} removido.`, 'success');
        window._adminActiveSupportId = null;
        window.adminSupportBack();
        adminRefreshCurrentView();
    } catch(e) { showToast('Erro ao remover.', 'error'); }
};

window.adminChangeTicketStatus = async function(ticketId) {
    const statuses = [
        { id: 'open', label: 'Aberto', icon: 'bi-unlock' },
        { id: 'in_progress', label: 'Em Andamento', icon: 'bi-hourglass-split' },
        { id: 'awaiting_response', label: 'Aguardando Resposta', icon: 'bi-clock' },
        { id: 'resolved', label: 'Resolvido', icon: 'bi-check-circle' },
        { id: 'closed', label: 'Encerrado', icon: 'bi-lock-fill' }
    ];
    let modalEl = document.getElementById('statusPickerModal');
    if (!modalEl) {
        modalEl = document.createElement('div');
        modalEl.id = 'statusPickerModal';
        modalEl.className = 'modal fade';
        modalEl.tabIndex = -1;
        document.body.appendChild(modalEl);
    }
    modalEl.innerHTML = `
        <div class="modal-dialog modal-dialog-centered modal-sm">
            <div class="modal-content border-0 shadow-lg" style="border-radius:16px;">
                <div class="modal-header border-0 pb-0 position-relative">
                    <h5 class="modal-title fw-bold" style="font-size:1rem;">Alterar status do chamado</h5>
                    <button type="button" class="ml-auth-close" data-bs-dismiss="modal" aria-label="Fechar" style="border-radius:50%;width:34px;height:34px;font-size:0.9rem;"><i class="bi bi-x-lg"></i></button>
                </div>
                <div class="modal-body pt-2">
                    ${statuses.map(s => `
                        <button class="ml-attach w-100 mb-2" style="justify-content:flex-start;" onclick="window.adminSetTicketStatus('${ticketId}','${s.id}')" data-bs-dismiss="modal">
                            <i class="${s.icon} me-2"></i>${s.label}
                        </button>
                    `).join('')}
                </div>
            </div>
        </div>`;
    new bootstrap.Modal(modalEl).show();
};

window.adminSetTicketStatus = async function(ticketId, newStatus) {
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const chat = result?.[0];
        if (!chat) return;
        const closed = newStatus === 'closed' || newStatus === 'resolved';
        const messages = chat.messages || [];
        if (messages[0] && messages[0].type === 'ticket_meta') {
            messages[0].closed = closed;
            messages[0].status = newStatus;
        }
        const user = getSavedUser();
        messages.push({
            senderId: 'system', type: 'system',
            text: `Status alterado para "${newStatus}" por ${user?.nome || 'Suporte'}.`,
            timestamp: new Date().toISOString()
        });
        await supabaseFetch(`chats?id=eq.${ticketId}`, {
            method: 'PATCH',
            body: JSON.stringify({ messages, closed })
        });
        showToast(`Status alterado para "${newStatus}"`, 'success');
        window.adminSupportSelect(ticketId, 'ticket');
        if (window._adminSupportBuildList) window._adminSupportBuildList();
    } catch (e) { showToast('Erro ao alterar status.', 'error'); }
};

window.adminDeleteTicketAccounts = async function(ticketId) {
    if (!confirm('Tem certeza que deseja DELETAR AS CONTAS dos envolvidos? Esta ação não pode ser desfeita.')) return;
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const chat = result?.[0];
        if (!chat) return;
        const meta = (chat.messages || []).find(m => m.type === 'ticket_meta') || {};
        const userIds = [chat.buyer_id];
        if (meta.related_order_id) {
            const orderData = await supabaseFetch(`orders?id=eq.${meta.related_order_id}&limit=1`);
            const order = orderData?.[0];
            if (order) {
                if (order.buyer_id && !userIds.includes(order.buyer_id)) userIds.push(order.buyer_id);
                if (order.seller_id && !userIds.includes(order.seller_id)) userIds.push(order.seller_id);
            }
        }
        for (const uid of userIds) {
            if (uid) await supabaseFetch(`users?id=eq.${uid}`, { method: 'DELETE' });
        }
        showToast(`${userIds.length} conta(s) deletada(s).`, 'warning');
        window.adminSupportBack();
        adminRefreshCurrentView();
    } catch (e) { showToast('Erro ao deletar contas.', 'error'); }
};

window.adminDeleteUserAccount = async function(userId, label) {
    if (!userId) { showToast('Usuário não identificado.', 'error'); return; }
    if (!confirm(`Tem certeza que deseja DELETAR a conta de "${label}"? Esta ação não pode ser desfeita.`)) return;
    try {
        await supabaseFetch(`users?id=eq.${userId}`, { method: 'DELETE' });
        showToast(`Conta de "${label}" deletada.`, 'warning');
        window.adminSupportBack();
        adminRefreshCurrentView();
    } catch (e) { showToast('Erro ao deletar conta.', 'error'); }
};

window.toggleAdminSupportAttachPanel = function() {
    const panel = document.getElementById('adminSupportAttachPanel');
    if (!panel) return;
    panel.classList.toggle('d-none');
    if (!panel.classList.contains('d-none')) {
        window.setAdminSupportAttachType(adminSupportAttachType || 'media');
    }
};

window.setAdminSupportAttachType = function(type) {
    adminSupportAttachType = type;
    document.querySelectorAll('#adminSupportAttachPanel .chat-attach-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.attachType === type);
    });
    const mapping = {
        media:   'adminSupportAttachPanelImageBox',
        docs:    'adminSupportAttachPanelFileBox',
        address: 'adminSupportAttachPanelLocationBox'
    };
    Object.entries(mapping).forEach(([k, id]) => {
        document.getElementById(id)?.classList.toggle('d-none', k !== type);
    });
    const focusMap = {
        media:   'adminSupportAttachLinkInputMedia',
        docs:    'adminSupportAttachLinkInputDocs',
        address: 'adminSupportAttachLinkInputAddress'
    };
    document.getElementById(focusMap[type])?.focus();
};

window.confirmAdminSupportAttach = async function() {
    const id = window._adminActiveSupportId;
    if (!id) return;
    const data = window._adminSupportData;
    const isOrder = data?.chats?.some(c => c.order_id === id);
    const type = isOrder ? 'order' : 'ticket';
    // A aba "Mídia" envia imagem; as demais (docs/address) têm botões próprios.
    if (adminSupportAttachType === 'docs') { return window.sendAdminSupportDoc(); }
    if (adminSupportAttachType === 'address') { return window.sendChatLocation('other'); }
    const input = document.getElementById('adminSupportAttachLinkInputMedia');
    const url   = input?.value?.trim();
    if (!url || !url.startsWith('http')) {
        showToast('Cole um link válido (começando com http).', 'warning');
        return;
    }
    const user = getSavedUser();
    try {
        const endpoint = type === 'order' ? `chats?order_id=eq.${id}` : `chats?id=eq.${id}`;
        const result = await supabaseFetch(endpoint + '&limit=1');
        const chat = result?.[0];
        if (!chat) return;
        const messages = chat.messages || [];
        const isVideo = /\.(mp4|webm|ogg|mov)$/i.test(url) || /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
        messages.push({
            senderId: user?.id || 'anon', senderName: `${user?.nome || 'Suporte'} (Suporte)`,
            text: isVideo ? 'Vídeo' : 'Imagem',
            ...(isVideo ? { video: normalizeImageUrl(url) } : { image: normalizeImageUrl(url) }),
            timestamp: new Date().toISOString(),
            type: isVideo ? 'video' : 'image', isStaff: true
        });
        await supabaseFetch(type === 'order' ? `chats?order_id=eq.${id}` : `chats?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        input.value = '';
        document.getElementById('adminSupportAttachPanel')?.classList.add('d-none');
        window.adminSupportSelect(id, type);
    } catch(e) { showToast('Erro ao enviar anexo.', 'error'); }
};

/** Envia imagem/vídeo por link como Suporte (reutiliza a mesma lógica de tipo do cliente) */
window.sendAdminSupportImageFromLink = async function(rawUrl) {
    const url = (rawUrl || '').trim();
    if (!url || !(url.startsWith('http') || url.startsWith('data:'))) {
        showToast('Cole um link de imagem/vídeo válido (começando com http).', 'warning');
        return;
    }
    const id = window._adminActiveSupportId;
    if (!id) return;
    const data = window._adminSupportData;
    const isOrder = data?.chats?.some(c => c.order_id === id);
    const type = isOrder ? 'order' : 'ticket';
    const user = getSavedUser();
    const isVideo = /\.(mp4|webm|ogg|mov)$/i.test(url) || /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
    try {
        const endpoint = type === 'order' ? `chats?order_id=eq.${id}` : `chats?id=eq.${id}`;
        const result = await supabaseFetch(endpoint + '&limit=1');
        const chat = result?.[0];
        if (!chat) return;
        const messages = chat.messages || [];
        messages.push({
            senderId: user?.id || 'anon', senderName: `${user?.nome || 'Suporte'} (Suporte)`,
            text: isVideo ? 'Vídeo' : 'Imagem',
            ...(isVideo ? { video: normalizeImageUrl(url) } : { image: normalizeImageUrl(url) }),
            timestamp: new Date().toISOString(),
            type: isVideo ? 'video' : 'image', isStaff: true
        });
        await supabaseFetch(endpoint, { method: 'PATCH', body: JSON.stringify({ messages }) });
        const input = document.getElementById('adminSupportAttachLinkInputMedia');
        if (input) input.value = '';
        document.getElementById('adminSupportAttachPanel')?.classList.add('d-none');
        window.adminSupportSelect(id, type);
    } catch (e) { showToast('Erro ao enviar imagem.', 'error'); }
};

/** Upload de imagem do PC via Imgur (reutiliza window.uploadImageToHost) e envio como Suporte */
window.sendAdminSupportImageFile = async function(input) {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const label = input.closest('label');
    const original = label ? label.innerHTML : '';
    if (label) label.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Enviando...';
    const url = await window.uploadImageToHost(file);
    if (label) label.innerHTML = original;
    if (!url) return;
    const id = window._adminActiveSupportId;
    if (!id) return;
    const data = window._adminSupportData;
    const isOrder = data?.chats?.some(c => c.order_id === id);
    const type = isOrder ? 'order' : 'ticket';
    const user = getSavedUser();
    try {
        const endpoint = type === 'order' ? `chats?order_id=eq.${id}` : `chats?id=eq.${id}`;
        const result = await supabaseFetch(endpoint + '&limit=1');
        const chat = result?.[0];
        if (!chat) return;
        const messages = chat.messages || [];
        messages.push({
            senderId: user?.id || 'anon', senderName: `${user?.nome || 'Suporte'} (Suporte)`,
            text: 'Imagem', image: normalizeImageUrl(url),
            timestamp: new Date().toISOString(), type: 'image', isStaff: true
        });
        await supabaseFetch(endpoint, { method: 'PATCH', body: JSON.stringify({ messages }) });
        document.getElementById('adminSupportAttachPanel')?.classList.add('d-none');
        window.adminSupportSelect(id, type);
    } catch (e) { showToast('Erro ao enviar imagem.', 'error'); }
};

/** Envia documento (Google Drive / OneDrive) por link como Suporte */
window.sendAdminSupportDoc = async function() {
    const id = window._adminActiveSupportId;
    if (!id) return;
    const data = window._adminSupportData;
    const isOrder = data?.chats?.some(c => c.order_id === id);
    const type = isOrder ? 'order' : 'ticket';
    const input = document.getElementById('adminSupportAttachLinkInputDocs');
    const url   = input?.value?.trim();
    if (!url || !url.startsWith('http')) {
        showToast('Cole um link de documento válido (começando com http).', 'warning');
        return;
    }
    const user = getSavedUser();
    try {
        const endpoint = type === 'order' ? `chats?order_id=eq.${id}` : `chats?id=eq.${id}`;
        const result = await supabaseFetch(endpoint + '&limit=1');
        const chat = result?.[0];
        if (!chat) return;
        const messages = chat.messages || [];
        messages.push({
            senderId: user?.id || 'anon', senderName: `${user?.nome || 'Suporte'} (Suporte)`,
            text: `Arquivo: ${url.split('/').pop()}`,
            file: { name: 'Arquivo Externo', url, size: 0 },
            timestamp: new Date().toISOString(), type: 'file', isStaff: true
        });
        await supabaseFetch(endpoint, { method: 'PATCH', body: JSON.stringify({ messages }) });
        input.value = '';
        document.getElementById('adminSupportAttachPanel')?.classList.add('d-none');
        window.adminSupportSelect(id, type);
        showToast('Documento enviado!', 'success');
    } catch (e) { showToast('Erro ao enviar documento.', 'error'); }
};

/** Envia localização (atual / cadastrada / link do Maps) como Suporte.
 *  Mesmo comportamento do chat cliente ? vendedor (chip clicável do Maps),
 *  porém gravando com isStaff e re-renderizando a própria tela do admin. */
window.sendAdminSupportLocation = async function(kind) {
    const id = window._adminActiveSupportId;
    if (!id) return;
    const data = window._adminSupportData;
    const isOrder = data?.chats?.some(c => c.order_id === id);
    const type = isOrder ? 'order' : 'ticket';
    const user = getSavedUser();
    const endpoint = type === 'order' ? `chats?order_id=eq.${id}` : `chats?id=eq.${id}`;

    let mapsUrl = '';
    let caption = '';

    if (kind === 'current') {
        if (!navigator.geolocation) { showToast('Geolocalização não suportada.', 'error'); return; }
        showToast('Obtendo sua localização...', 'info');
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const { latitude, longitude } = pos.coords;
            mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
            await sendAdminSupportLocationMessage(mapsUrl, `Localização atual: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`, endpoint, id, type, user);
        }, () => showToast('Não foi possível obter a localização.', 'error'), { enableHighAccuracy: true, timeout: 10000 });
        return;
    }

    if (kind === 'stored') {
        const u = getSavedUser() || {};
        const endereco = [u.endereco, u.cidade, u.estado, u.cep].filter(Boolean).join(', ');
        mapsUrl = u.maps || (endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}` : '');
        if (!mapsUrl) { showToast('Você não tem endereço cadastrado no perfil.', 'warning'); return; }
        caption = `?? Meu endereço cadastrado: ${endereco || mapsUrl}`;
    } else {
        // other: link do campo do Maps
        const input = document.getElementById('adminSupportAttachLinkInputAddress');
        mapsUrl = (input?.value || '').trim();
        if (!mapsUrl || !mapsUrl.startsWith('http')) { showToast('Cole um link de endereço válido.', 'warning'); return; }
        caption = `Endereço (link): ${mapsUrl}`;
    }

    await sendAdminSupportLocationMessage(mapsUrl, caption, endpoint, id, type, user);
};

async function sendAdminSupportLocationMessage(mapsUrl, caption, endpoint, id, type, user) {
    try {
        const result = await supabaseFetch(endpoint + '&limit=1');
        const chat = result?.[0];
        if (!chat) return;
        const messages = chat.messages || [];
        messages.push({
            senderId: user?.id || 'anon', senderName: `${user?.nome || 'Suporte'} (Suporte)`,
            text: caption, location: mapsUrl,
            timestamp: new Date().toISOString(), type: 'location', isStaff: true
        });
        await supabaseFetch(endpoint, { method: 'PATCH', body: JSON.stringify({ messages }) });
        document.getElementById('adminSupportAttachPanel')?.classList.add('d-none');
        window.adminSupportSelect(id, type);
        showToast('Localização enviada!', 'success');
    } catch (e) { showToast('Erro ao enviar localização.', 'error'); }
}

/** Seleciona e carrega uma conversa específica dentro da aba "Chats" do admin — abre em tela cheia no lugar da lista */
window.adminChatsTabSelect = async function(orderId) {
    window._adminActiveChatOrderId = orderId;
    adminChatsTabReplyIndex = null;
    adminChatsTabEditIndex  = null;
    // Igual ao chat cliente <-> vendedor: some com a navbar inferior (footer)
    // e, além disso, esconde o resto do painel admin (título, cards de
    // estatística) pra o chat ocupar a tela toda, só ficando a navbar do site.
    document.body.classList.add('wa-locked', 'admin-chat-fullscreen');

    // Esconde a lista (admin-card) e mostra o chat ocupando toda a área da aba
    document.getElementById('adminChatsTabListWrap')?.classList.add('d-none');
    const wrap = document.getElementById('adminChatsTabActiveWrap');
    wrap?.classList.remove('d-none');

    const activeEl = document.getElementById('adminChatsTabActive');
    activeEl.innerHTML = '<div class="text-center py-5 flex-grow-1"><div class="spinner-border text-danger"></div></div>';

    try {
        const [chatResult, order] = await Promise.all([
            supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`),
            Promise.resolve((window._adminChatsTabData?.orders || adminOrdersCache).find(o => o.id === orderId))
        ]);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Conversa não encontrada.', 'error'); window.adminChatsTabBack(); return; }

        const resolveSenderName = (m) => (m.senderId === order?.buyer_id ? order?.buyer_name : order?.seller_name);
        const resolveSenderAvatar = (m) => {
            if (m.senderId === getSavedUser()?.id) return '';
            const u = (window._adminUsersCache || []).find(u => u.id === m.senderId);
            return u ? (normalizeImageUrl(safeParseImages(u.avatar)[0]) || '') : '';
        };
        window.__setupReactionHooks(chat, c => supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages: c.messages }) }), () => window.adminChatsTabSelect(orderId));
        // Marca como visto mensagens dos participantes
        { const adminUser = getSavedUser(); let changed = false; (chat.messages || []).forEach(m => { if (m.senderId && m.senderId !== adminUser?.id && !m.visto) { m.visto = true; changed = true; } }); if (changed) { supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) }).catch(() => {}); } }
        const msgsHtml = (chat.messages || []).map((m, i) => adminChatsTabMsgBubbleHtml(m, i, resolveSenderName, resolveSenderAvatar)).join('')
            || '<div class="text-center text-muted py-4">Sem mensagens.</div>';
        const msgCount = (chat.messages || []).filter(m => m.type !== 'system').length;
        const st = ORDER_STATUS_MAP[order?.status] || { text: order?.status || ' • ', class: 'bg-secondary' };
        const closed = getChatClosed(chat);

        const chatHtml = window.renderChatContainer({
            chatId: orderId,
            chat,
            order,
            partner: { name: order?.product_title || 'Pedido #' + orderId.slice(-6), avatar: order?.product_img || 'https://placehold.co/45/e9ecef/6c757d?text=%20' },
            msgsId: 'adminChatsTabMsgsBody',
            inputId: 'adminChatsTabMessageInput',
            previewId: 'adminChatsTabInputPreview',
            attachPanelId: 'adminChatsTabAttachPanel',
            attachLinkId: 'adminChatsTabAttachLinkInput',
            participantsId: 'adminChatsTabParticipants',
            statusBarId: 'adminChatsTabStatusBar',
            onSend: `window.adminChatsTabSend('${orderId}')`,
            onBack: 'window.adminChatsTabBack()',
            onClose: closed ? '' : `window.adminChatsTabCloseChat('${orderId}')`,
            onDelete: `window.adminChatsTabDelete('${orderId}')`,
            onToggleParticipants: `window.adminToggleParticipants('adminChatsTabParticipants')`,
            onToggleAttachPanel: 'window.toggleAdminChatsTabAttachPanel()',
            onConfirmAttach: `window.confirmAdminChatsTabAttach('${orderId}')`,
            onSendLocation: `window.sendAdminChatsTabLocation('${orderId}')`,
            onSendFile: 'window.sendAdminChatsTabFile',
            showBackBtn: true,
            showCloseBtn: false,
            showAttach: true,
            showDeleteBtn: true,
            statusInfo: { text: STATUS_BAR_MAP[order?.status] || st.text, class: statusToAlertClass(order?.status) },
            statusText: ''
        });

        activeEl.innerHTML = chatHtml;

        const msgsBody = document.getElementById('adminChatsTabMsgsBody');
        if (msgsBody) {
            msgsBody.innerHTML = msgsHtml;
            msgsBody.scrollTop = msgsBody.scrollHeight;
        }

        const participantsPanel = document.getElementById('adminChatsTabParticipants');
        if (participantsPanel && order) {
            participantsPanel.innerHTML = `
                <div class="chat-participant-row">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order.buyer_name || '?')}&background=3483fa&color=fff" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">
                    <div class="chat-participant-info">
                        <strong>${order.buyer_name || 'Comprador não identificado'}</strong>
                        <small><i class="bi bi-bag-fill me-1"></i>Comprador</small>
                    </div>
                </div>
                <div class="chat-participant-row">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(order.seller_name || '?')}&background=22c98e&color=fff" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">
                    <div class="chat-participant-info">
                        <strong>${order.seller_name || 'Vendedor não identificado'}</strong>
                        <small><i class="bi bi-shop me-1"></i>Vendedor</small>
                    </div>
                </div>`;
        }
    } catch (e) {
        console.error(e);
        showToast('Erro ao carregar a conversa.', 'error');
    }
};

/** Volta da conversa aberta pra lista de conversas, sem sair da aba */
window.adminChatsTabBack = function() {
    document.body.classList.remove('wa-locked', 'admin-chat-fullscreen');
    document.getElementById('adminChatsTabActiveWrap')?.classList.add('d-none');
    document.getElementById('adminChatsTabListWrap')?.classList.remove('d-none');
    window._adminActiveChatOrderId = null;
    adminChatsTabReplyIndex = null;
    adminChatsTabEditIndex  = null;
};

/** Handler do formulario de escrita (mesmo esquema do chat cliente <-> vendedor) */
window.adminChatsTabSendForm = async function(event, orderId) {
    event.preventDefault();
    return window.adminChatsTabSend(orderId);
};

/** Envia uma mensagem como membro da equipe de suporte, direto na aba "Chats" — 
 *  ou salva a edição em andamento, se houver uma (ver window.startAdminChatsTabEdit). */
window.adminChatsTabSend = async function(orderId) {
    const input = document.getElementById('adminChatsTabMessageInput');
    const text  = input?.value.trim();
    if (!text && adminChatsTabEditIndex === null) return;
    const user = getSavedUser();

    try {
        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = chatData?.[0];
        if (!chat) return;

        const messages = chat.messages || [];

        if (adminChatsTabEditIndex !== null) {
            if (messages[adminChatsTabEditIndex]) {
                messages[adminChatsTabEditIndex].text   = text;
                messages[adminChatsTabEditIndex].edited = true;
            }
        } else {
            const newMsg = {
                senderId:   user.id,
                senderName: `${user.nome} (Suporte)`,
                text,
                timestamp:  new Date().toISOString(),
                isStaff:    true
            };
            if (adminChatsTabReplyIndex !== null && messages[adminChatsTabReplyIndex]) {
                const replySrc = messages[adminChatsTabReplyIndex];
                newMsg.replyTo = { senderName: replySrc.senderName || (replySrc.isStaff ? 'Suporte' : 'Usuário'), text: replySrc.text || '' };
            }
            messages.push(newMsg);
        }

        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        window.cancelAdminChatsTabReplyOrEdit();
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

        const closedChat = withChatClosed({ messages }, true);
        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ messages: closedChat.messages }) });
        showToast('Atendimento encerrado.', 'success');

        // Atualiza o cache local pra badge da lista virar "Encerrado" na hora
        const cached = window._adminChatsTabData?.chats.find(c => c.order_id === orderId);
        if (cached) cached.closed = true;

        window.adminChatsTabSelect(orderId); // recarrega a mesma conversa já como encerrada
        window._adminChatsTabRenderList?.();
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
        document.body.classList.remove('wa-locked', 'admin-chat-fullscreen');
        adminRefreshCurrentView();
    } catch (e) {
        showToast('Erro ao remover a conversa.', 'error');
    }
};

// ============================================
// CENTRAL DE SUPORTE (chamados: senha, entrega, conta etc.)
// ============================================
// Reaproveita a tabela `chats` (mesma dos chats comprador ? vendedor) sem criar
// nenhuma coluna nova. Um chamado de suporte — uma linha de `chats` onde:
//  - `order_id` fica sempre NULL ( — isso que diferencia um chamado de um chat
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

/** Retorna o label legível de um chamado de suporte: categoria ? assunto ? primeira mensagem ? fallback */
function getTicketLabel(t) {
    return SUPPORT_CATEGORY_LABELS[t?.category] || t?.subject || t?.messages?.[0]?.text || 'Chamado';
}

/** Converte a linha crua de `chats` (com a mensagem de metadados embutida) num objeto de chamado "achatado" e fácil de usar na UI */
function normalizeTicket(raw) {
    if (!raw) return null;
    const msgs = raw.messages || [];
    const meta = msgs.find(m => m.type === 'ticket_meta') || {};
    // Tenta achar o avatar do requerente: primeiro no próprio metadata do
    // chamado, depois no cache de usuários do admin (buscando pelo buyer_id).
    const cachedUser = (window._adminUsersCache || []).find(u => u.id === raw.buyer_id);
    const requesterAvatar = meta.requester_avatar || safeParseImages(cachedUser?.avatar)[0] || null;
    return {
        id:              raw.id,
        category:        meta.category,
        subject:         meta.subject,
        status:          getChatClosed(raw) ? 'closed' : 'open',
        requester_id:    raw.buyer_id,
        requester_name:  raw.buyer_name,
        requester_email: meta.requester_email,
        requester_role:  meta.requester_role,
        requester_avatar: normalizeImageUrl(requesterAvatar),
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
window.createSupportTicket = async function({ category, subject, message = null, orderId = null, overrideEmail = null }) {
    const user = getSavedUser();
    const firstMsgText = message || subject;
    const ticket = {
        id: crypto.randomUUID(),
        // order_id fica NULL de propósito: — o que marca esta linha como um
        // chamado de suporte (todo chat de pedido de verdade tem order_id).
        order_id:   null,
        buyer_id:   user?.id || null,
        buyer_name: user?.nome || 'Visitante',
        messages: [
            {
                // "Mensagem" de metadados: não — exibida na conversa, só carrega
                // os dados extras do chamado dentro do próprio JSON de messages.
                type:              'ticket_meta',
                category,
                subject,
                closed:            false,
                requester_email:   overrideEmail || user?.email || null,
                requester_role:    user?.tipo || null,
                requester_avatar:  user?.avatar || null,
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

/** A tabela `chats` não possui coluna `closed` (apenas as colunas existentes:
 *  id, order_id, seller_id, seller_name, buyer_id, buyer_name, participants,
 *  messages, logistics_agreed, logistics_method, created_at). O status de
 *  encerramento — guardado DENTRO do jsonb `messages` (em messages[0].closed),
 *  para não precisar alterar o banco. */
function getChatClosed(chat) {
    if (!chat) return false;
    if (typeof chat.closed === 'boolean') return chat.closed;
    return !!(chat.messages && chat.messages[0] && chat.messages[0].closed === true);
}

/** Marca o encerramento num objeto de chat, mantendo o campo dentro de messages. */
function withChatClosed(chat, closed) {
    const messages = Array.isArray(chat.messages) ? chat.messages.slice() : [];
    if (messages[0] && typeof messages[0] === 'object') {
        messages[0] = { ...messages[0], closed: !!closed };
    } else {
        messages.unshift({ type: 'ticket_meta', closed: !!closed });
    }
    return { ...chat, messages, closed: !!closed };
}

/**
 * Abre "Falar com o Suporte". Se o usuário (logado, ou visitante que já abriu
 * um chamado nesta sessão) já tiver um atendimento em aberto, pula direto pra
 * conversa em vez de mostrar o formulário de novo —  — assim que vira um
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
    const desc     = document.getElementById('supportReqDescription')?.value.trim();
    const message  = desc || subject;
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
let supportReplyIndex        = null;
let supportEditIndex         = null;
let supportAttachType        = 'image'; // 'image' | 'file'
window._activeSupportTicketId = null;

/** Procura um chamado ainda aberto pertencente ao usuário atual (logado, pelo
 *  id da conta; visitante, pelo id salvo no localStorage quando abriu o
 *  chamado) — usado pra retomar a conversa em vez de repetir o formulário. */
async function findMyOpenSupportTicket() {
    const user = getSavedUser();
    try {
        if (user) {
            const rows = await supabaseFetch(`chats?order_id=is.null&buyer_id=eq.${user.id}&select=*&order=id.desc&limit=20`);
            const open = (rows || []).find(r => !getChatClosed(r));
            return open || null;
        }
        let guestId = null;
        try { guestId = localStorage.getItem('electroGuestTicketId'); } catch (e) {}
        if (!guestId) return null;
        const rows = await supabaseFetch(`chats?id=eq.${guestId}&select=*&limit=1`);
        const t = rows?.[0];
        if (!t || getChatClosed(t)) { try { localStorage.removeItem('electroGuestTicketId'); } catch (e) {} return null; }
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
    window._chatActiveElements = null;
    window.currentChat = null;
    window.cancelSupportReplyOrEdit();
    const chatView = document.getElementById('supportChatView');
    if (chatView) { chatView.innerHTML = ''; chatView.classList.add('d-none'); }
    document.getElementById('supportRequestForm')?.classList.remove('d-none');
    document.getElementById('supportModalDialog')?.classList.remove('modal-fullscreen');
    document.body.classList.remove('support-chat-fullscreen');
    document.querySelector('#supportRequestModal .modal-header')?.classList.remove('d-none');
    const title = document.getElementById('supportModalTitle');
    if (title) title.innerHTML = 'Falar com o Suporte';
    window.toggleSupportDescriptionField();
};

window.toggleSupportDescriptionField = function() {
    const cat = document.getElementById('supportReqCategory')?.value;
    const wrap = document.getElementById('supportReqDescWrap');
    if (!wrap) return;
    wrap.style.display = (!cat || cat === 'outro') ? '' : 'none';
};

/** Mostra um estado de carregamento rápido enquanto checa se já existe um chamado em aberto */
window.showSupportChatLoading = function() {
    document.getElementById('supportRequestForm')?.classList.add('d-none');
    document.getElementById('supportModalDialog')?.classList.add('modal-fullscreen');
    document.body.classList.add('support-chat-fullscreen');
    document.querySelector('#supportRequestModal .modal-header')?.classList.add('d-none');
    const chatView = document.getElementById('supportChatView');
    if (chatView) { chatView.classList.remove('d-none'); chatView.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>'; }
};

/** Entra na etapa 2 (conversa) do modal de suporte, pro chamado indicado */
window.enterSupportChatMode = function(ticketId) {
    window._activeSupportTicketId = ticketId;
    window.currentChat = ticketId;
    supportChatLastSignature = null;
    document.getElementById('supportRequestForm')?.classList.add('d-none');
    document.getElementById('supportModalDialog')?.classList.add('modal-fullscreen');
    document.body.classList.add('support-chat-fullscreen');
    document.querySelector('#supportRequestModal .modal-header')?.classList.add('d-none');
    const title = document.getElementById('supportModalTitle');
    if (title) title.innerHTML = '<i class="bi bi-headset me-2"></i>Atendimento do Suporte';

    const msgsId       = `supportMsgs_${ticketId}`;
    const inputId      = `supportInput_${ticketId}`;
    const previewId    = `supportPreview_${ticketId}`;
    const attachId     = `supportAttach_${ticketId}`;
    const attachLinkId = `supportAttachLink_${ticketId}`;
    const statusId     = `supportStatusBar_${ticketId}`;
    const logisticsId  = `supportLogistics_${ticketId}`;
    const logisticsBtnsId = `supportLogisticsBtns_${ticketId}`;

    const chatView = document.getElementById('supportChatView');
    if (chatView) {
        chatView.innerHTML = window.renderChatContainer({
            chatId: ticketId,
            partner: { name: 'Suporte', avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent('Suporte')}&background=ffc107&color=1c1c1c&size=40` },
            msgsId,
            inputId,
            previewId,
            attachPanelId: attachId,
            attachLinkId,
            statusBarId: statusId,
            onSend: 'window.sendMySupportMessage()',
            onBack: 'window.showSupportRequestForm()',
            onClose: 'window.closeSupportChatModal()',
            onToggleAttachPanel: 'window.toggleSupportAttachPanel()',
            onConfirmAttach: `window.confirmSupportAttach()`,
            onSendLocation: 'window.sendSupportChatLocation',
            onSendFile: 'window.sendSupportChatFile',
            showBackBtn: true,
            showCloseBtn: false,
            showAttach: true,
            showProductSummary: false,
            statusInfo: { text: '<i class="bi bi-headset me-1"></i>Solicitação Aberta', class: 'info' }
        });
        chatView.classList.remove('d-none');
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
    }, 1500);
}

function stopSupportChatPolling() {
    if (supportChatPollInterval) { clearInterval(supportChatPollInterval); supportChatPollInterval = null; }
}

/** Abre um modal listando as pessoas da conversa de suporte (igual ao
 *  botão de participantes dos outros chats): o usuário que abriu o
 *  chamado e a equipe de atendimento. */
window.openSupportParticipants = async function() {
    const ticketId = window._activeSupportTicketId;
    const body = document.getElementById('supportParticipantsBody');
    if (!ticketId || !body) return;
    body.innerHTML = '<div class="text-center text-muted py-3"><div class="spinner-border spinner-border-sm"></div></div>';
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = normalizeTicket(result?.[0]);
        if (!ticket) { body.innerHTML = '<p class="text-muted text-center">Chamado não encontrado.</p>'; }
        else {
            const requesterAvatar = safeParseImages(ticket.requester_avatar)[0] || `https://ui-avatars.com/api/?name=${encodeURIComponent((ticket.requester_name || '?').slice(0,2))}&background=e50914&color=fff&size=40`;
            const roleLabel = ticket.requester_role === 'ADMIN' ? 'Administrador' : (ticket.requester_role === 'VENDEDOR' ? 'Vendedor' : 'Cliente');
            body.innerHTML = `
                <div class="chat-participant-row">
                    <img src="${requesterAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=e50914&color=fff&size=40'">
                    <div class="chat-participant-info">
                        <strong>${ticket.requester_name || 'Visitante'}</strong>
                        <small>${ticket.requester_email || 'E-mail não informado'} • ${roleLabel} • Quem abriu o chamado</small>
                    </div>
                </div>
                <div class="chat-participant-row">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent('Suporte')}&background=ffc107&color=1c1c1c&size=40" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none'">
                    <div class="chat-participant-info">
                        <strong>Equipe de Suporte</strong>
                        <small>Atendimento ao cliente • ElectroMarket</small>
                    </div>
                </div>`;
        }
    } catch (e) {
        body.innerHTML = '<p class="text-muted text-center">Erro ao carregar participantes.</p>';
    }
    try { new bootstrap.Modal(document.getElementById('supportParticipantsModal')).show(); } catch (e) {}
};

/** Fecha o modal de suporte e para o polling — chamado pelo X do modal */
window.closeSupportChatModal = function() {
    stopSupportChatPolling();
    window._activeSupportTicketId = null;
    window._chatActiveElements = null;
    window.currentChat = null;
    window.currentReplyIndex = null;
    window.editingMessageIndex = null;
    const chatView = document.getElementById('supportChatView');
    if (chatView) { chatView.innerHTML = ''; chatView.classList.add('d-none'); }
    document.getElementById('supportRequestForm')?.classList.remove('d-none');
    document.getElementById('supportModalDialog')?.classList.remove('modal-fullscreen');
    document.body.classList.remove('support-chat-fullscreen');
    document.querySelector('#supportRequestModal .modal-header')?.classList.remove('d-none');
};

/** Corrige a visualização do chat de suporte no Android: quando o teclado
 *  abre, garante que a barra de input continue visível e o modal se ajuste. */
function bindSupportChatKeyboardFix() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindSupportChatKeyboardFix);
        return;
    }
    document.addEventListener('focusin', (e) => {
        if (e.target?.id && e.target.id.startsWith('supportInput_')) {
            setTimeout(() => {
                const inputBar = e.target.closest('.chat-input-bar');
                if (inputBar) inputBar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 300);
        }
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            const activeEl = document.activeElement;
            if (activeEl?.id?.startsWith('supportInput_')) {
                const inputBar = activeEl.closest('.chat-input-bar');
                if (inputBar) inputBar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    }
}
bindSupportChatKeyboardFix();

async function loadMySupportTicket(ticketId, silent = false) {
    const container = window._chatActiveElements?.container || document.getElementById('supportChatMessages');
    if (!container) return;
    if (!silent) container.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div><p class="small mt-2">Carregando conversa...</p></div>';

    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const raw = result?.[0];
        if (!raw) {
            stopSupportChatPolling();
            try { bootstrap.Modal.getInstance(document.getElementById('supportRequestModal'))?.hide(); } catch (e) {}
            try { localStorage.removeItem('electroGuestTicketId'); } catch (e) {}
            return;
        }
        const ticket = normalizeTicket(raw);

        let relatedOrder = null;
        const relatedOrderId = ticket.order_id || null;
        if (relatedOrderId) {
            try {
                const ord = await supabaseFetch(`orders?select=*&id=eq.${relatedOrderId}&limit=1`);
                relatedOrder = ord?.[0] || null;
            } catch (e) {}
        }

        const signature = JSON.stringify(raw.messages) + '|' + getChatClosed(raw);
        if (silent && signature === supportChatLastSignature) return;
        supportChatLastSignature = signature;

        const wasNearBottom = !silent || (container.scrollHeight - container.scrollTop - container.clientHeight < 120);

        window.__setupReactionHooks(ticket, c => supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages: c.messages }) }), () => loadMySupportTicket(ticketId, true));

        { const supportUser = getSavedUser(); let changed = false; (ticket.messages || []).forEach(m => { if (m.isStaff && !m.visto) { m.visto = true; changed = true; } }); if (changed) { supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages: ticket.messages }) }).catch(() => {}); } }

        const supportUser = getSavedUser();
        const myAvatarSrc = normalizeImageUrl(safeParseImages(supportUser?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(supportUser?.nome || 'Você')}&background=22c98e&color=fff&size=40`;
        const supportAvatarSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent('Suporte')}&background=ffc107&color=1c1c1c&size=40`;

        container.innerHTML = (ticket.messages || []).map((m, index) => window.renderMsgBubble(m, index, {
            userId: supportUser?.id || '',
            myAvatar: myAvatarSrc,
            partnerAvatar: supportAvatarSrc,
            actions: { reply: 'startReply', copy: 'copyMessageText', edit: 'startEdit', delete: 'deleteMessage' },
            useDropdown: true,
            enableGrouping: false
        })).join('') || '<div class="text-center text-muted py-4">Sem mensagens ainda.</div>';

        const statusBar = window._chatActiveElements?.statusBar;
        if (statusBar) {
            statusBar.innerHTML = ticket.status === 'closed'
                ? '<div class="alert alert-secondary mb-0 py-2 text-center small"><i class="bi bi-lock-fill me-1"></i>Atendimento encerrado</div>'
                : '<div class="alert alert-info mb-0 py-2 text-center small"><i class="bi bi-headset me-1"></i>Solicitação Aberta</div>';
        }

        const inputBar = window._chatActiveElements?.input?.closest('.chat-input-bar');
        if (inputBar) inputBar.classList.toggle('d-none', ticket.status === 'closed');

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

/**
 * Mostra o card de resumo do produto (foto + título + preço) no topo do chat
 * de suporte, igual ao chat de pedido cliente ? vendedor. Só aparece quando
 * o chamado está vinculado a um pedido (related_order_id).
 */
/** Envia uma nova mensagem do usuário dentro do chamado já aberto — ou salva
 *  a edição em andamento, se houver uma (ver window.startSupportEdit). */
window.sendMySupportMessage = async function() {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    const input = window._chatActiveElements?.input;
    const text  = input?.value.trim();
    if (!text && supportEditIndex === null) return;
    const user = getSavedUser();

    input.disabled = true;
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = result?.[0];
        if (!ticket) return;
        if (getChatClosed(ticket)) { showToast('Este atendimento já foi encerrado.', 'warning'); loadMySupportTicket(ticketId); return; }

        const messages = ticket.messages || [];

        if (supportEditIndex !== null) {
            if (messages[supportEditIndex]) {
                messages[supportEditIndex].text   = text;
                messages[supportEditIndex].edited = true;
            }
        } else {
            const newMessage = {
                senderId:   user?.id || 'anon',
                senderName: user?.nome || 'Visitante',
                text,
                timestamp:  new Date().toISOString()
            };
            if (supportReplyIndex !== null && messages[supportReplyIndex]) {
                const repliedMsg = messages[supportReplyIndex];
                newMessage.replyTo = {
                    text: repliedMsg.text,
                    senderName: repliedMsg.isStaff ? (repliedMsg.senderName || 'Suporte') : 'Você'
                };
            }
            messages.push(newMessage);
        }

        await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        input.value = '';
        window.cancelSupportReplyOrEdit();
        supportChatLastSignature = null;
        await loadMySupportTicket(ticketId);
    } catch (e) {
        showToast('Erro ao enviar mensagem.', 'error');
    } finally {
        input.disabled = false;
        input?.focus();
    }
};

/** Começa a responder a uma mensagem específica do chamado (preview acima do input) */
window.startSupportReply = async function(index) {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
    const msg = result?.[0]?.messages?.[index];
    if (!msg) return;

    supportReplyIndex = index;
    supportEditIndex  = null;

    const preview = window._chatActiveElements?.preview;
    if (preview) {
        preview.classList.remove('d-none');
        preview.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div class="small text-truncate" style="max-width: 85%;">
                    <strong class="text-primary d-block">Respondendo a ${msg.isStaff ? (msg.senderName || 'Suporte') : 'você mesmo'}</strong>
                    <span class="text-muted">${msg.text}</span>
                </div>
                <i class="bi bi-x-lg cursor-pointer" onclick="window.cancelSupportReplyOrEdit()"></i>
            </div>`;
    }
    window._chatActiveElements?.input?.focus();
};

/** Começa a editar uma mensagem já enviada pelo próprio usuário */
window.startSupportEdit = async function(index) {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
    const msg = result?.[0]?.messages?.[index];
    if (!msg) return;

    supportEditIndex  = index;
    supportReplyIndex = null;

    const input = window._chatActiveElements?.input;
    if (input) input.value = msg.text || '';

    const preview = window._chatActiveElements?.preview;
    if (preview) {
        preview.classList.remove('d-none');
        preview.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div class="small"><strong class="text-warning">Editando mensagem...</strong></div>
                <i class="bi bi-x-lg cursor-pointer" onclick="window.cancelSupportReplyOrEdit()"></i>
            </div>`;
    }
    input?.focus();
};

/** Cancela a resposta/edição em andamento no chamado de suporte */
window.cancelSupportReplyOrEdit = function() {
    supportReplyIndex = null;
    supportEditIndex  = null;
    const preview = window._chatActiveElements?.preview;
    if (preview) {
        preview.classList.add('d-none');
        preview.innerHTML = '';
    }
    const input = window._chatActiveElements?.input;
    if (input) input.value = '';
};

/** Copia o texto de uma mensagem do chamado de suporte */
window.copySupportMessageText = async function(index) {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const msg = result?.[0]?.messages?.[index];
        if (!msg?.text) return;
        await navigator.clipboard.writeText(msg.text);
        showToast('Mensagem copiada!', 'success', 1500);
    } catch (e) {
        showToast('Não foi possível copiar.', 'error');
    }
};

/** Apaga (soft-delete) uma mensagem própria dentro do chamado de suporte */
window.deleteSupportMessage = async function(index) {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    if (!confirm('Apagar esta mensagem para todos?')) return;
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = result?.[0];
        if (!ticket?.messages?.[index]) return;
        ticket.messages[index].text    = '';
        ticket.messages[index].image   = null;
        ticket.messages[index].file    = null;
        ticket.messages[index].deleted = true;
        await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages: ticket.messages }) });
        supportChatLastSignature = null;
        loadMySupportTicket(ticketId);
    } catch (e) {
        showToast('Erro ao apagar mensagem.', 'error');
    }
};

// -------- Anexo de imagem/arquivo no chat de suporte --------

window.toggleSupportAttachPanel = function() {
    window.toggleChatAttachPanel();
};

window.confirmSupportAttach = async function() {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    const attachPanel = window._chatActiveElements?.attachPanel;
    const input = attachPanel?.querySelector('input.form-control');
    const url   = input?.value?.trim();
    if (!url || !url.startsWith('http')) {
        showToast('Cole um link válido (começando com http).', 'warning');
        return;
    }
    const user = getSavedUser();

    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = result?.[0];
        if (!ticket) return;
        const messages = ticket.messages || [];

        if (currentSupportAttachType === 'image') {
            messages.push({
                senderId: user?.id || 'anon', senderName: user?.nome || 'Visitante',
                text: 'Imagem', image: normalizeImageUrl(url),
                timestamp: new Date().toISOString(), type: 'image'
            });
        } else {
            messages.push({
                senderId: user?.id || 'anon', senderName: user?.nome || 'Visitante',
                text: `Arquivo: ${url.split('/').pop()}`,
                file: { name: 'Arquivo Externo', url, size: 0 },
                timestamp: new Date().toISOString(), type: 'file'
            });
        }

        await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        input.value = '';
        window._chatActiveElements?.attachPanel?.classList.add('d-none');
        supportChatLastSignature = null;
        await loadMySupportTicket(ticketId);
    } catch (e) {
        showToast('Erro ao enviar anexo.', 'error');
    }
};

window.sendSupportChatFile = async function(input) {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    const user = getSavedUser();
    const btn = input?.closest('.chat-container')?.querySelector('label') || window._chatActiveElements?.attachPanel?.querySelector('label');
    const original = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Enviando...';
    try {
        const fd = new FormData();
        fd.append('file', file, file.name || 'arquivo');
        const res = await fetch('https://api.imgur.com/3/image', {
            method: 'POST',
            headers: { Authorization: `Client-ID ${window.CONFIG?.IMGUR_CLIENT_ID || window.CONFIG_LOCAL_FALLBACK?.IMGUR_CLIENT_ID || '546c25a59c58ad7'}` },
            body: fd
        });
        const json = await res.json().catch(() => null);
        if (btn) btn.innerHTML = original;
        if (json?.success && json?.data?.link) {
            const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
            const ticket = result?.[0];
            if (!ticket) { showToast('Chamado não encontrado.', 'error'); return; }
            const messages = ticket.messages || [];
            messages.push({
                senderId: user?.id || 'anon', senderName: user?.nome || 'Visitante',
                text: file.name || 'Arquivo', file: { name: file.name, url: json.data.link, size: file.size || 0 },
                timestamp: new Date().toISOString(), type: 'file'
            });
            await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
            window._chatActiveElements?.attachPanel?.classList.add('d-none');
            supportChatLastSignature = null;
            await loadMySupportTicket(ticketId);
        } else {
            showToast('Falha ao enviar arquivo.', 'error');
        }
    } catch (e) { if (btn) btn.innerHTML = original; showToast('Erro ao enviar arquivo.', 'error'); }
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

/** Abre um chamado de suporte no mesmo layout do chat cliente?vendedor, sem modal */
window.adminViewTicket = async function(ticketId) {
    const grid = document.getElementById('productsGrid');
    grid.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-danger"></div><p class="mt-2">Carregando chamado...</p></div>';
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = normalizeTicket(result?.[0]);
        if (!ticket) { showToast('Chamado não encontrado.', 'error'); adminRefreshCurrentView(); return; }

        const resolveSenderName = () => ticket.requester_name;
        const adminUser = getSavedUser();
        const myAvatar = normalizeImageUrl(safeParseImages(adminUser?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(adminUser?.nome || 'Suporte')}&background=ffc107&color=1c1c1c&size=40`;
        const requesterAvatar = safeParseImages(ticket.requester_avatar)[0] || `https://ui-avatars.com/api/?name=${encodeURIComponent((ticket.requester_name || '?').slice(0,2))}&background=e50914&color=fff&size=40`;
        let deleteOtherAccount = '';
        if (ticket.order_id) {
            const orderResult = await supabaseFetch(`orders?id=eq.${ticket.order_id}&select=seller_id,buyer_id&limit=1`);
            const orderData = orderResult?.[0];
            const otherId = orderData?.seller_id && orderData.seller_id !== ticket.requester_id ? orderData.seller_id
                : (orderData?.buyer_id && orderData.buyer_id !== ticket.requester_id ? orderData.buyer_id : null);
            if (otherId) {
                deleteOtherAccount = `window.adminDeleteUserAccount('${otherId}', 'Participante')`;
            }
        }
        window.__setupReactionHooks(ticket, c => supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages: c.messages }) }), () => window.adminViewTicket(ticketId));
        const msgsHtml = (ticket.messages || []).map((m, i) => adminMsgBubbleHtml(m, i, resolveSenderName, myAvatar, requesterAvatar)).join('')
            || '<div class="text-center text-muted py-4">Sem mensagens.</div>';

        // Igual — aba "Chats": some com a navbar inferior e o resto do painel
        // admin (título, cards de estatística) pra o chamado ocupar a tela toda.
        document.body.classList.add('wa-locked', 'admin-chat-fullscreen');

        grid.className = 'admin-panel-active';
        const msgCount   = (ticket.messages || []).filter(m => m.type !== 'system').length;
        const roleLabel  = ticket.requester_role === 'ADMIN' ? 'Administrador' : (ticket.requester_role === 'VENDEDOR' ? 'Vendedor' : 'Cliente');
        const reasonLabel = getTicketLabel(ticket);

        grid.innerHTML = `
            <div class="admin-standalone-page">
                <div class="wa-main admin-chat-main" style="margin:0;">
                    <section class="wa-chat" style="flex-grow:1;">
                        <div class="chat-container" style="height:100%;">
                            ${window.renderChatContainer({
                                chatId: ticketId,
                                chat: ticket,
                                partner: { name: ticket.requester_name || 'Visitante', avatar: requesterAvatar },
                                msgsId: 'adminChatMsgsBody',
                                inputId: 'adminChatInput',
                                previewId: 'adminTicketInputPreview',
                                attachPanelId: 'adminTicketAttachPanel',
                                attachLinkId: 'adminTicketAttachLinkInput',
                                participantsId: 'adminChatParticipants',
                                statusBarId: 'adminTicketStatusBar',
                                onSend: `window.adminSendTicketMessage('${ticketId}')`,
                                onBack: 'window.adminViewTicketBack()',
                                onClose: ticket.status !== 'closed' ? `window.adminCloseTicket('${ticketId}')` : '',
                                onDelete: `window.adminDeleteTicket('${ticketId}')`,
                                onCloseTicket: ticket.status !== 'closed' ? `window.adminCloseTicket('${ticketId}')` : '',
                                onChangeStatus: `window.adminChangeTicketStatus('${ticketId}')`,
                                onDeleteRequester: `window.adminDeleteUserAccount('${ticket.requester_id}', '${(ticket.requester_name || 'Solicitante').replace(/'/g, "\\'")}')`,
                                onDeleteOtherAccount: deleteOtherAccount,
                                onToggleParticipants: 'window.adminToggleParticipants()',
                                onToggleAttachPanel: 'window.toggleAdminTicketAttachPanel()',
                                onConfirmAttach: 'window.confirmAdminTicketAttach()',
                                onSendLocation: 'window.sendAdminTicketLocation()',
                                onSendFile: 'window.sendAdminTicketFile',
                                showBackBtn: true,
                                showCloseBtn: false,
                                showAttach: ticket.status !== 'closed',
                                showDeleteBtn: false,
                                statusInfo: { text: ticket.status === 'closed' ? '<i class="bi bi-lock-fill me-1"></i>Chamado Encerrado' : '<i class="bi bi-headset me-1"></i>Chamado Aberto', class: ticket.status === 'closed' ? 'secondary' : 'info' },
                                statusText: '',
                                extraHeaderHtml: ''
                            })}
                        </div>
                    </section>
                </div>
            </div>`;

        const msgsBody = document.getElementById('adminChatMsgsBody');
        if (msgsBody) { msgsBody.innerHTML = msgsHtml; msgsBody.scrollTop = msgsBody.scrollHeight; }
        const participantsPanel = document.getElementById('adminChatParticipants');
        if (participantsPanel) {
            participantsPanel.innerHTML = `
                <div class="chat-participant-row">
                    <img src="${requesterAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=3483fa&color=fff&size=40'">
                    <div class="chat-participant-info">
                        <strong>${ticket.requester_name || 'Visitante'}</strong>
                        <small>${ticket.requester_email || 'E-mail não informado'} • ${roleLabel}</small>
                    </div>
                </div>`;
        }
    } catch (e) {
        console.error(e);
        showToast('Erro ao carregar o chamado.', 'error');
    }
};

/** Volta do chamado em tela cheia pra lista de chamados de suporte */
window.adminViewTicketBack = function() {
    document.body.classList.remove('wa-locked', 'admin-chat-fullscreen');
    adminRefreshCurrentView();
};

// -------- Estado de resposta/edição no chamado de suporte (visão admin) --------
let adminTicketReplyIndex = null;
let adminTicketEditIndex  = null;
let adminTicketAttachType = 'image';

window.cancelAdminTicketReplyOrEdit = function() {
    adminTicketReplyIndex = null;
    adminTicketEditIndex  = null;
    const preview = document.getElementById('adminTicketInputPreview');
    if (preview) preview.classList.add('d-none');
};

window.startAdminTicketReply = async function(index) {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
    const msg = result?.[0]?.messages?.[index];
    if (!msg) return;
    adminTicketReplyIndex = index;
    adminTicketEditIndex  = null;
    const preview = document.getElementById('adminTicketInputPreview');
    if (preview) {
        preview.classList.remove('d-none');
        preview.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div class="small text-truncate" style="max-width:85%;">
                    <strong class="text-primary d-block">Respondendo a ${msg.senderName || (msg.isStaff ? 'Suporte' : 'Usuário')}</strong>
                    <span class="text-muted">${msg.text || (msg.image ? '[imagem]' : '')}</span>
                </div>
                <i class="bi bi-x-lg cursor-pointer" onclick="window.cancelAdminTicketReplyOrEdit()"></i>
            </div>`;
    }
    document.getElementById('adminChatInput')?.focus();
};

window.startAdminTicketEdit = async function(index) {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
    const msg = result?.[0]?.messages?.[index];
    if (!msg) return;
    adminTicketEditIndex  = index;
    adminTicketReplyIndex = null;
    const input = document.getElementById('adminChatInput');
    if (input) input.value = msg.text || '';
    const preview = document.getElementById('adminTicketInputPreview');
    if (preview) {
        preview.classList.remove('d-none');
        preview.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div class="small"><strong class="text-warning">Editando mensagem...</strong></div>
                <i class="bi bi-x-lg cursor-pointer" onclick="window.cancelAdminTicketReplyOrEdit()"></i>
            </div>`;
    }
    input?.focus();
};

window.copyAdminTicketMessageText = function(index) {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    supabaseFetch(`chats?id=eq.${ticketId}&limit=1`).then(r => {
        const msg = r?.[0]?.messages?.[index];
        if (msg?.text) { navigator.clipboard?.writeText(msg.text); showToast('Mensagem copiada.', 'success'); }
    });
};

window.deleteAdminTicketMessage = async function(index) {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    if (!confirm('Apagar esta mensagem?')) return;
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = result?.[0];
        if (!ticket) return;
        const messages = (ticket.messages || []).map((m, i) => i === index ? { ...m, deleted: true, text: '', image: null, file: null } : m);
        await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        window.adminViewTicket(ticketId);
    } catch (e) {
        showToast('Erro ao apagar mensagem.', 'error');
    }
};

window.sendAdminTicketLocation = async function() {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    const user = getSavedUser();
    const addr = user?.endereco || user?.cidade;
    if (!addr) { showToast('Cadastre um endereço no seu perfil para compartilhar.', 'info'); return; }
    const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = result?.[0];
        if (!ticket) return;
        const messages = ticket.messages || [];
        messages.push({
            senderId: user.id, senderName: `${user.nome} (Suporte)`,
            text: `?? ${addr}\n${mapsUrl}`,
            timestamp: new Date().toISOString(), type: 'location', isStaff: true
        });
        await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        document.getElementById('adminTicketAttachPanel')?.classList.add('d-none');
        window.adminViewTicket(ticketId);
        showToast('Localização enviada!', 'success');
    } catch (e) {
        showToast('Erro ao enviar localização.', 'error');
    }
};

window.toggleAdminTicketAttachPanel = function() {
    document.getElementById('adminTicketAttachPanel')?.classList.toggle('d-none');
};
window.setAdminTicketAttachType = function(type) {
    adminTicketAttachType = type;
    document.querySelectorAll('#adminTicketAttachPanel .chat-attach-tab').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-attach-type') === type);
    });
    const mapping = { image: 'adminTicketAttachPanelImageBox', file: 'adminTicketAttachPanelFileBox', location: 'adminTicketAttachPanelLocationBox' };
    Object.entries(mapping).forEach(([t, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('d-none', type !== t);
    });
};
window.confirmAdminTicketAttach = async function() {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    const link = document.getElementById('adminTicketAttachLinkInput')?.value.trim();
    if (!link) { showToast('Cole o link da imagem/arquivo.', 'warning'); return; }
    const user = getSavedUser();
    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = result?.[0];
        if (!ticket) return;
        const messages = ticket.messages || [];
        if (adminTicketAttachType === 'image') {
            messages.push({ senderId: user.id, senderName: `${user.nome} (Suporte)`, text: 'Imagem', image: link, timestamp: new Date().toISOString(), isStaff: true });
        } else {
            const nome = link.split('/').pop().split('?')[0] || 'Arquivo';
            messages.push({ senderId: user.id, senderName: `${user.nome} (Suporte)`, text: `Arquivo: ${nome}`, type: 'file', file: { name: nome, url: link }, timestamp: new Date().toISOString(), isStaff: true });
        }
        await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        document.getElementById('adminTicketAttachLinkInput').value = '';
        document.getElementById('adminTicketAttachPanel')?.classList.add('d-none');
        window.adminViewTicket(ticketId);
    } catch (e) {
        showToast('Erro ao enviar anexo.', 'error');
    }
};

/** Envia uma resposta da equipe de suporte dentro do chamado (ou salva edição em andamento) */
window.adminSendTicketMessage = async function(ticketId) {
    const input = document.getElementById('adminChatInput');
    const text  = input?.value.trim();
    if (!text && adminTicketEditIndex === null) return;
    const user = getSavedUser();

    try {
        const result = await supabaseFetch(`chats?id=eq.${ticketId}&limit=1`);
        const ticket = result?.[0];
        if (!ticket) return;

        const messages = ticket.messages || [];

        if (adminTicketEditIndex !== null) {
            if (messages[adminTicketEditIndex]) {
                messages[adminTicketEditIndex].text   = text;
                messages[adminTicketEditIndex].edited = true;
            }
            adminTicketEditIndex = null;
            adminTicketReplyIndex = null;
        } else {
            const replyTarget = (adminTicketReplyIndex !== null) ? messages[adminTicketReplyIndex] : null;
            const newMsg = {
                senderId:   user.id,
                senderName: `${user.nome} (Suporte)`,
                text,
                timestamp:  new Date().toISOString(),
                isStaff:    true
            };
            if (replyTarget) {
                newMsg.replyTo = { senderName: replyTarget.senderName || (replyTarget.isStaff ? 'Suporte' : 'Usuário'), text: replyTarget.text || (replyTarget.image ? '[imagem]' : '') };
            }
            messages.push(newMsg);
            adminTicketReplyIndex = null;
        }

        await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        input.value = '';
        window.cancelAdminTicketReplyOrEdit();
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

        const closedChat = withChatClosed({ messages }, true);
        await supabaseFetch(`chats?id=eq.${ticketId}`, { method: 'PATCH', body: JSON.stringify({ messages: closedChat.messages }) });
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
        document.body.classList.remove('wa-locked', 'admin-chat-fullscreen');
        adminRefreshCurrentView();
    } catch (e) { showToast('Erro ao remover o chamado.', 'error'); }
};

// ============================================
// COMPARTILHAR
// ============================================

window.shareProduct = function(pid) {
    const doShare = (item) => {
        if (!item) { showToast('Produto não encontrado.', 'error'); return; }
        const base = window.location.origin + window.location.pathname;
        const url  = `${base}#/produto/${pid}`;
        const text = `Confira: ${item.titulo} no ElectroMarket!`;

        if (navigator.share) {
            navigator.share({ title: 'ElectroMarket', text, url }).catch(console.error);
        } else {
            navigator.clipboard.writeText(url).then(() => showToast('Link do produto copiado!', 'success', 2000));
        }
    };
    const item = (window.allProductsCache || []).find(x => x.id === pid || x.id == pid);
    if (item) { doShare(item); return; }
    // Se não achou no cache, busca direto no banco
    supabaseFetch(`products?id=eq.${encodeURIComponent(pid)}&limit=1`).then(rows => {
        doShare(rows && rows.length ? rows[0] : null);
    }).catch(() => doShare(null));
};

/** Compartilha o perfil público de um vendedor (loja) via link direto */
window.shareSeller = function(sellerId, sellerName = '') {
    const base = window.location.origin + window.location.pathname;
    const url  = `${base}#/vendedor/${sellerId}`;
    const text = `Confira a loja ${sellerName || 'deste vendedor'} no ElectroMarket!`;

    if (navigator.share) {
        navigator.share({ title: 'ElectroMarket', text, url }).catch(console.error);
    } else {
        navigator.clipboard.writeText(url).then(() => showToast('Link da loja copiado!', 'success', 2000));
    }
};

// ============================================
// MOBILE NAV ACTIVE STATE
// ============================================

window.updateMobileNavActive = function(page) {
    document.querySelectorAll('.mobile-nav-row .nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll(`.mobile-nav-row .nav-item[data-page="${page}"]`).forEach(el => el.classList.add('active'));
};

// startReply, startEdit, cancelReplyOrEdit, copyMessageText, deleteMessage → movidos para script.js

