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
                                    ${(() => {
                                        const pid = order.buyer_id || c.buyer_id;
                                        const u = (window._adminUsersCache || []).find(x => x.id === pid);
                                        const av = normalizeImageUrl(u?.avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent((order.buyer_name || '?').slice(0,2))}&background=22c98e&color=fff&size=40`;
                                        return `<img src="${av}" class="admin-row-avatar" referrerpolicy="no-referrer" onerror="this.src='https://ui-avatars.com/api/?name=%3F&background=22c98e&color=fff&size=40'">`;
                                    })()}
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
                                    <img src="${t.requester_avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent((t.requester_name || '?').slice(0,2)) + '&background=e50914&color=fff&size=40')}" class="admin-row-avatar" referrerpolicy="no-referrer" onerror="this.src='https://ui-avatars.com/api/?name=%3F&background=e50914&color=fff&size=40'">
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

                    <div class="admin-tab-panel" id="admin-support">
                        <!-- Lista de conversas de pedido no MESMO padrão visual das outras abas do
                             admin (Publicações/Usuários): admin-card + admin-row, nada de sidebar
                             estilo WhatsApp. Ao clicar numa conversa, ela é substituída pelo chat em
                             tela cheia. -->
                        <div id="adminChatsTabListWrap">
                            <div class="admin-card">
                                <div class="admin-card-title d-flex align-items-center justify-content-between gap-2 flex-wrap">
                                    <span><i class="bi bi-chat-dots-fill me-2"></i>Conversas de Pedido</span>
                                </div>
                                <div id="adminChatsTabList"></div>
                            </div>
                        </div>

                        <div id="adminChatsTabActiveWrap" class="d-none">
                            <div id="adminChatsTabActive" class="chat-container admin-chat-standalone"></div>
                        </div>

                        <!-- Chamados de suporte, logo abaixo das conversas de pedido,
                             separados por um título próprio. -->
                        <div class="admin-card mt-3">
                            <div class="admin-card-title d-flex align-items-center justify-content-between gap-2 flex-wrap">
                                <span><i class="bi bi-headset me-2"></i>Chamados de Suporte</span>
                            </div>
                            <div id="adminSupportTabList">
                            ${tickets.length === 0 ? `
                                <p class="text-muted text-center py-4 mb-0">Nenhum chamado de suporte ainda. Assim que um cliente ou vendedor esquecer a senha, relatar um problema com a entrega ou pedir ajuda, o chamado aparece aqui automaticamente.</p>
                            ` : tickets.slice().sort((a, b) => (a.status === b.status) ? 0 : (a.status === 'closed' ? 1 : -1)).map(t => {
                                const msgCount = (t.messages || []).filter(m => m.type !== 'system').length;
                                const lastMsg = (t.messages || [])[t.messages.length - 1];
                                return `
                                <div class="admin-row admin-row-wrap">
                                    <img src="${t.requester_avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent((t.requester_name || '?').slice(0,2)) + '&background=e50914&color=fff&size=40')}" class="admin-row-avatar" referrerpolicy="no-referrer" onerror="this.src='https://ui-avatars.com/api/?name=%3F&background=e50914&color=fff&size=40'">
                                    <div class="admin-row-info">
                                        <strong>${SUPPORT_CATEGORY_LABELS[t.category] || t.subject || 'Chamado'} <span class="admin-row-badge ${t.status === 'closed' ? 'badge-muted' : 'badge-open'} ms-1">${t.status === 'closed' ? 'Encerrado' : 'Aberto'}</span></strong>
                                        <small class="d-block">${t.requester_name || 'Visitante'}${t.requester_email ? ' • ' + t.requester_email : ''}${t.requester_role ? ' • ' + (t.requester_role === 'ADMIN' ? 'Administrador' : (t.requester_role === 'VENDEDOR' ? 'Vendedor' : 'Cliente')) : ''} • ${msgCount} mensagens</small>
                                        ${lastMsg ? `<small class="text-muted fst-italic d-block text-truncate" style="max-width:320px;">"${(lastMsg.text || '[mídia]').slice(0,60)}"</small>` : ''}
                                    </div>
                                    <div class="d-flex gap-1 justify-content-end">
                                        <button class="admin-icon-btn" onclick="window.adminViewTicket('${t.id}')" title="Ver Chamado">
                                            <i class="bi bi-eye"></i>
                                        </button>
                                        <button class="admin-icon-btn danger" onclick="window.adminDeleteTicket('${t.id}')" title="Apagar chamado">
                                            <i class="bi bi-trash-fill"></i>
                                        </button>
                                    </div>
                                </div>`;
                            }).join('')}
                            </div>
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
        // em vez de sempre cair no Início. Mapeia a aba "admin-chats" (antiga)
        // para a aba unificada "admin-support".
        if (window._adminActiveTab === 'admin-chats') window._adminActiveTab = 'admin-support';
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
    // Sai do modo "chat em tela cheia": restaura a navbar inferior (footer) e o resto do painel admin
    if (tabId !== 'admin-support') document.body.classList.remove('wa-locked', 'admin-chat-fullscreen');
    const titles = {
        'admin-overview': 'Início',
        'admin-content': 'Conteúdo',
        'admin-cats': 'Categorias',
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
function adminMsgBubbleHtml(m, index, resolveSenderName, myAvatarSrc, partnerAvatarSrc) {
    if (m.type === 'system' || m.senderId === 'system') {
        return `<div class="text-center my-3"><span class="system-chip"><i class="bi bi-info-circle-fill"></i>${m.text}</span></div>`;
    }
    const isStaff = !!m.isStaff;
    const senderLabel = m.senderName || resolveSenderName(m) || 'Usuário';
    const avatarForThem = isStaff ? myAvatarSrc : partnerAvatarSrc;
    const replyHtml = m.replyTo ? `
        <div class="p-2 mb-2 rounded ${isStaff ? 'bg-white bg-opacity-25' : 'bg-secondary bg-opacity-10'} small border-start border-4 border-info">
            <div class="fw-bold" style="font-size: 0.7rem;">${m.replyTo.senderName}</div>
            <div class="text-truncate chat-reply-preview">${(m.replyTo.text || '').replace(/</g, '&lt;')}</div>
        </div>
    ` : '';
    let bodyHtml;
    if (m.deleted) {
        bodyHtml = `<em class="small">Mensagem apagada</em>`;
    } else if (m.image) {
        bodyHtml = `${replyHtml}<div class="msg-image-wrap"><img class="msg-image" src="${normalizeImageUrl(m.image)}" referrerpolicy="no-referrer" onclick="window.openImageFull('${encodeURIComponent(normalizeImageUrl(m.image))}')"></div><div class="chat-bubble-text" style="white-space:pre-wrap;">${(m.text ? m.text.replace(/</g, '&lt;') : '')}</div>`;
    } else if (m.type === 'file' && m.file) {
        bodyHtml = `${replyHtml}<a class="msg-file-chip" href="${normalizeImageUrl(m.file.url)}" target="_blank" rel="noopener"><i class="bi bi-paperclip"></i> ${m.file.name || 'Arquivo'}</a><div class="chat-bubble-text" style="white-space:pre-wrap;">${(m.text ? m.text.replace(/</g, '&lt;') : '')}</div>`;
    } else {
        bodyHtml = `${replyHtml}<div class="chat-bubble-text" style="white-space:pre-wrap;">${(m.text ? m.text.replace(/</g, '&lt;') : '')}</div>`;
    }
    return `
        <div class="msg-row ${isStaff ? 'is-me' : 'is-them'}">
            ${!isStaff ? `<img class="msg-avatar" src="${avatarForThem || partnerAvatarSrc}" referrerpolicy="no-referrer" onerror="this.src='https://ui-avatars.com/api/?name=%3F&background=22c98e&color=fff&size=40'">` : ''}
            <div class="msg-bubble ${isStaff ? 'is-me is-staff' : 'is-them'}">
                <div class="d-flex justify-content-between align-items-center mb-1 gap-2">
                    <span class="msg-sender">${senderLabel}${isStaff ? ' <i class="bi bi-patch-check-fill"></i>' : ''}</span>
                    <div class="msg-actions-visible">
                        <i class="bi bi-reply" onclick="window.startAdminTicketReply(${index})" title="Responder"></i>
                        <i class="bi bi-clipboard" onclick="window.copyAdminTicketMessageText(${index})" title="Copiar"></i>
                        ${isStaff ? `<i class="bi bi-pencil" onclick="window.startAdminTicketEdit(${index})" title="Editar"></i>` : ''}
                        ${isStaff ? `<i class="bi bi-trash text-danger" onclick="window.deleteAdminTicketMessage(${index})" title="Apagar"></i>` : ''}
                    </div>
                </div>
                ${bodyHtml}
                <div class="msg-time">${m.edited ? '<span>(editada)</span> ' : ''}${new Date(m.timestamp).toLocaleString('pt-BR')}</div>
            </div>
            ${isStaff ? `<img class="msg-avatar" src="${myAvatarSrc}" referrerpolicy="no-referrer" onerror="this.src='https://ui-avatars.com/api/?name=%3F&background=ffc107&color=1c1c1c&size=40'">` : ''}
        </div>`;
}

// -------- Bolha de mensagem com opções (aba "Chats" do admin) --------
// Mesmo conjunto de recursos do chat de suporte: responder, copiar,
// editar/apagar (só nas próprias mensagens da equipe).

let adminChatsTabReplyIndex = null;
let adminChatsTabEditIndex  = null;

function adminChatsTabMsgBubbleHtml(m, index, resolveSenderName) {
    if (m.type === 'system' || m.senderId === 'system') {
        return `<div class="text-center my-3"><span class="system-chip"><i class="bi bi-info-circle-fill"></i>${m.text}</span></div>`;
    }

    const isStaff = !!m.isStaff;
    const senderLabel = m.senderName || resolveSenderName(m) || 'Usuário';

    if (m.deleted) {
        return `
            <div class="msg-row ${isStaff ? 'is-me' : 'is-them'}">
                <div class="msg-bubble ${isStaff ? 'is-me is-staff' : 'is-them'} msg-deleted">
                    <i class="bi bi-slash-circle me-1"></i><em>Mensagem apagada</em>
                </div>
            </div>`;
    }

    const replyHtml = m.replyTo ? `
        <div class="p-2 mb-2 rounded ${isStaff ? 'bg-white bg-opacity-25' : 'bg-secondary bg-opacity-10'} small border-start border-4 border-info">
            <div class="fw-bold" style="font-size: 0.7rem;">${m.replyTo.senderName}</div>
            <div class="text-truncate chat-reply-preview">${(m.replyTo.text || '').replace(/</g, '&lt;')}</div>
        </div>
    ` : '';

    const fileChipHtml = (m.type === 'file' && m.file) ? `
        <a href="${m.file.url}" target="_blank" rel="noopener" class="chat-file-chip mb-2">
            <i class="bi bi-file-earmark-arrow-down-fill"></i>
            <span class="chat-file-name">${(m.text || '').replace(/^Arquivo:\s*/, '').replace(/</g, '&lt;') || m.file.name || 'Arquivo'}</span>
        </a>
    ` : '';

    const showTextCaption = m.text && !(m.image && m.text === 'Imagem') && !(m.type === 'file' && m.file);
    const bodyHtml = showTextCaption ? `<div class="chat-bubble-text" style="white-space:pre-wrap;">${m.text.replace(/</g, '&lt;')}</div>` : '';

    return `
        <div class="msg-row ${isStaff ? 'is-me' : 'is-them'}">
            <div class="msg-bubble ${isStaff ? 'is-me is-staff' : 'is-them'}">
                <div class="d-flex justify-content-between align-items-center mb-1 gap-2">
                    <span class="msg-sender">${senderLabel}${isStaff ? ' <i class="bi bi-patch-check-fill"></i>' : ''}</span>
                    <div class="msg-actions-visible">
                        <i class="bi bi-reply" onclick="window.startAdminChatsTabReply(${index})" title="Responder"></i>
                        <i class="bi bi-clipboard" onclick="window.copyAdminChatsTabMessageText(${index})" title="Copiar"></i>
                        ${isStaff ? `<i class="bi bi-pencil" onclick="window.startAdminChatsTabEdit(${index})" title="Editar"></i>` : ''}
                        ${isStaff ? `<i class="bi bi-trash text-danger" onclick="window.deleteAdminChatsTabMessage(${index})" title="Apagar"></i>` : ''}
                    </div>
                </div>

                ${replyHtml}
                ${m.image ? `
                    <img src="${m.image}" class="img-fluid rounded mb-2" referrerpolicy="no-referrer"
                         style="max-width:220px;cursor:pointer;"
                         onclick="window.openImageFull('${m.image}')">
                ` : ''}
                ${fileChipHtml}
                ${bodyHtml}
                <div class="msg-time">
                    ${m.edited ? '<span>(editada)</span> ' : ''}${new Date(m.timestamp).toLocaleString('pt-BR')}
                </div>
            </div>
        </div>`;
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

// -------- Anexo de imagem/arquivo na aba "Chats" do admin (mesmo padrão do chat cliente ↔ vendedor / suporte) --------

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
        const adminChatMyAvatar = normalizeImageUrl(adminUser?.avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent(adminUser?.nome || 'Suporte')}&background=ffc107&color=1c1c1c&size=40`;
        const partnerFromCache = (window._adminUsersCache || []).find(u => u.id === order?.buyer_id);
        const adminChatPartnerAvatar = normalizeImageUrl(partnerFromCache?.avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent((order?.buyer_name || '?').slice(0,2))}&background=22c98e&color=fff&size=40`;
        const msgsHtml = (chat.messages || []).map((m, i) => adminMsgBubbleHtml(m, i, resolveSenderName, adminChatMyAvatar, adminChatPartnerAvatar)).join('')
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
                                    <span class="chat-header-order-id">${order?.buyer_name || '?'} ↔ ${order?.seller_name || '?'} · #${orderId.slice(-6).toUpperCase()} · ${msgCount} mensagens${chat.closed ? ' · <i class="bi bi-lock-fill"></i> Encerrado' : ''}</span>
                                </div>
                                <button type="button" class="chat-header-close" onclick="window.adminToggleParticipants()" title="Ver usuários da conversa">
                                    <i class="bi bi-people-fill"></i>
                                </button>
                                <div class="dropdown">
                                    <button type="button" class="chat-header-close" data-bs-toggle="dropdown" aria-label="Opções">
                                        <i class="bi bi-three-dots-vertical"></i>
                                    </button>
                                    <ul class="dropdown-menu dropdown-menu-end shadow-sm">
                                        ${!chat.closed ? `<li><a class="dropdown-item small" href="javascript:void(0)" onclick="window.adminCloseChat('${orderId}')"><i class="bi bi-check-circle-fill me-2"></i>Encerrar Atendimento</a></li>` : ''}
                                        <li><a class="dropdown-item small text-danger" href="javascript:void(0)" onclick="window.adminDeleteChat('${orderId}')"><i class="bi bi-trash me-2"></i>Apagar conversa e pedido</a></li>
                                    </ul>
                                </div>
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
        const adminUser = getSavedUser();
        const adminChatMyAvatar = normalizeImageUrl(adminUser?.avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent(adminUser?.nome || 'Suporte')}&background=ffc107&color=1c1c1c&size=40`;
        const partnerFromCache = (window._adminUsersCache || []).find(u => u.id === order?.buyer_id);
        const adminChatPartnerAvatar = normalizeImageUrl(partnerFromCache?.avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent((order?.buyer_name || '?').slice(0,2))}&background=22c98e&color=fff&size=40`;
        const msgsHtml = (chat.messages || []).map((m, i) => adminMsgBubbleHtml(m, i, resolveSenderName, adminChatMyAvatar, adminChatPartnerAvatar)).join('')
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
                    <span class="chat-header-order-id">${order?.buyer_name || '?'} ↔ ${order?.seller_name || '?'} · #${orderId.slice(-6).toUpperCase()} · ${msgCount} mensagens</span>
                </div>
                <button type="button" class="chat-header-close" onclick="window.adminToggleParticipants('adminChatsModalParticipants')" title="Ver usuários da conversa">
                    <i class="bi bi-people-fill"></i>
                </button>
                <div class="dropdown">
                    <button type="button" class="chat-header-close" data-bs-toggle="dropdown" aria-label="Opções">
                        <i class="bi bi-three-dots-vertical"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end shadow-sm">
                        ${!chat.closed ? `<li><a class="dropdown-item small" href="javascript:void(0)" onclick="window.adminChatsModalCloseChat('${orderId}')"><i class="bi bi-check-circle-fill me-2"></i>Encerrar Atendimento</a></li>` : ''}
                        <li><a class="dropdown-item small text-danger" href="javascript:void(0)" onclick="window.adminChatsModalDelete('${orderId}')"><i class="bi bi-trash me-2"></i>Apagar conversa e pedido</a></li>
                    </ul>
                </div>
            </div>

            <div class="chat-status-bar">
                <span class="badge ${st.class}">${st.text}</span>
                ${order ? `<span class="small fw-bold text-success ms-2">${formatPreco(order.total, {htmlGratis:false})}</span>` : ''}
                ${chat.closed ? `<span class="small text-muted ms-2"><i class="bi bi-lock-fill me-1"></i>Atendimento encerrado</span>` : ''}
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
            ` : ''}`;

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
// ela ocupa a tela toda no lugar da lista — igual ao chat cliente ↔
// vendedor (mesmas classes chat-header-pro/chat-product-summary/chat-
// messages/chat-input-bar), só que sem lista lateral do lado, e com as
// ações de administrador (encerrar/apagar) integradas ao próprio chat.

/** Preenche a lista da aba "Chats" com as conversas já carregadas pelo renderAdminPanel */
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
                <div class="admin-row admin-row-wrap" data-order-id="${c.order_id}">
                    <img src="${order.product_img || 'https://placehold.co/45'}" class="admin-row-avatar" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/45'">
                    <div class="admin-row-info">
                        <strong>${order.product_title || 'Pedido #' + c.order_id?.slice(-6)} <span class="admin-row-badge ${c.closed ? 'badge-muted' : 'badge-open'} ms-1">${c.closed ? 'Encerrado' : 'Aberto'}</span></strong>
                        <small class="d-block">${order.buyer_name || '?'} ↔ ${order.seller_name || '?'} • ${msgCount} mensagens</small>
                        ${lastMsg ? `<small class="text-muted fst-italic d-block text-truncate" style="max-width:320px;">"${(lastMsg.text || '[mídia]').slice(0,60)}"</small>` : ''}
                    </div>
                    <div class="d-flex gap-1 justify-content-end">
                        <button class="admin-icon-btn" onclick="window.adminChatsTabSelect('${c.order_id}')" title="Ver Conversa">
                            <i class="bi bi-eye"></i>
                        </button>
                        <button class="admin-icon-btn danger" onclick="window.adminChatsTabDelete('${c.order_id}')" title="Apagar conversa e pedido">
                            <i class="bi bi-trash-fill"></i>
                        </button>
                    </div>
                </div>`;
            }).join('');
    };
    window._adminChatsTabRenderList();

    // Se a aba "Suporte" já estava aberta com uma conversa selecionada (ex: o
    // admin encerrou/apagou algo e o painel recarregou), reabre a mesma
    // conversa em vez de voltar pra lista.
    if (window._adminActiveTab === 'admin-support' && window._adminActiveChatOrderId &&
        window._adminChatsTabData.chats.some(c => c.order_id === window._adminActiveChatOrderId)) {
        window.adminChatsTabSelect(window._adminActiveChatOrderId);
    }
};

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
        const msgsHtml = (chat.messages || []).map((m, i) => adminChatsTabMsgBubbleHtml(m, i, resolveSenderName)).join('')
            || '<div class="text-center text-muted py-4">Sem mensagens.</div>';
        const msgCount = (chat.messages || []).filter(m => m.type !== 'system').length;
        const st = ORDER_STATUS_MAP[order?.status] || { text: order?.status || '—', class: 'bg-secondary' };
        const closed = getChatClosed(chat);

        activeEl.innerHTML = `
            <div class="chat-header-pro">
                <button type="button" class="chat-header-close" onclick="window.adminChatsTabBack()" style="margin-right:4px;" title="Voltar para a lista">
                    <i class="bi bi-arrow-left"></i>
                </button>
                <div class="chat-header-avatar-wrap">
                    <img src="${order?.product_img || 'https://placehold.co/45/e9ecef/6c757d?text=%20'}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/45/e9ecef/6c757d?text=%20'">
                </div>
                <div class="chat-header-info">
                    <span class="chat-header-name">${order?.product_title || 'Pedido #' + orderId.slice(-6)}</span>
                    <span class="chat-header-order-id">${order?.buyer_name || '?'} ↔ ${order?.seller_name || '?'} · #${orderId.slice(-6).toUpperCase()} · ${msgCount} mensagens</span>
                </div>
                <button type="button" class="chat-header-close" onclick="window.adminToggleParticipants('adminChatsTabParticipants')" title="Ver usuários da conversa">
                    <i class="bi bi-people-fill"></i>
                </button>
                <div class="dropdown">
                    <button type="button" class="chat-header-close" data-bs-toggle="dropdown" aria-label="Opções">
                        <i class="bi bi-three-dots-vertical"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end shadow-sm">
                        ${!closed ? `<li><a class="dropdown-item small" href="javascript:void(0)" onclick="window.adminChatsTabCloseChat('${orderId}')"><i class="bi bi-check-circle-fill me-2"></i>Encerrar Atendimento</a></li>` : ''}
                        <li><a class="dropdown-item small text-danger" href="javascript:void(0)" onclick="window.adminChatsTabDelete('${orderId}')"><i class="bi bi-trash me-2"></i>Apagar conversa e pedido</a></li>
                    </ul>
                </div>
            </div>

            <div class="chat-status-bar">
                <span class="badge ${st.class}">${st.text}</span>
                ${order ? `<span class="small fw-bold text-success ms-2">${formatPreco(order.total, {htmlGratis:false})}</span>` : ''}
                ${closed ? `<span class="small text-muted ms-2"><i class="bi bi-lock-fill me-1"></i>Atendimento encerrado</span>` : ''}
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

            ${!closed ? `
                <div id="adminChatsTabInputPreview" class="p-2 bg-warning bg-opacity-10 border-bottom d-none"></div>

                <!-- Painel de Anexo (mesmo padrão do chat cliente ↔ vendedor / suporte) -->
                <div id="adminChatsTabAttachPanel" class="p-3 bg-light border-top d-none">
                    <div class="d-flex gap-2 mb-2">
                        <button type="button" class="btn btn-sm flex-grow-1 chat-attach-tab active" data-attach-type="image" onclick="window.setAdminChatsTabAttachType('image')">
                            <i class="bi bi-image me-1"></i>Imagem
                        </button>
                        <button type="button" class="btn btn-sm flex-grow-1 chat-attach-tab" data-attach-type="file" onclick="window.setAdminChatsTabAttachType('file')">
                            <i class="bi bi-file-earmark me-1"></i>Arquivo
                        </button>
                    </div>
                    <div class="input-group input-group-sm mb-2">
                        <span class="input-group-text"><i class="bi bi-link-45deg"></i></span>
                        <input type="url" id="adminChatsTabAttachLinkInput" class="form-control" placeholder="Cole o link da imagem...">
                    </div>
                    <div class="d-flex gap-2">
                        <button type="button" class="btn btn-primary btn-sm flex-grow-1" onclick="window.confirmAdminChatsTabAttach('${orderId}')">
                            <i class="bi bi-send me-1"></i>Enviar
                        </button>
                    </div>
                </div>

                <div class="chat-input-bar">
                    <div class="d-flex gap-2 align-items-center">
                        <button type="button" class="chat-icon-btn" onclick="window.toggleAdminChatsTabAttachPanel()" title="Anexar imagem ou arquivo">
                            <i class="bi bi-paperclip"></i>
                        </button>
                        <input type="text" id="adminChatsTabMessageInput" class="chat-text-input" placeholder="Responder como Suporte..." autocomplete="off"
                               onkeypress="if(event.key==='Enter'){event.preventDefault(); window.adminChatsTabSend('${orderId}');}">
                        <button type="button" class="chat-send-btn" onclick="window.adminChatsTabSend('${orderId}')"><i class="bi bi-send-fill"></i></button>
                    </div>
                </div>
            ` : ''}`;

        const msgsBody = document.getElementById('adminChatsTabMsgsBody');
        if (msgsBody) msgsBody.scrollTop = msgsBody.scrollHeight;
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
    // Tenta achar o avatar do requerente: primeiro no próprio metadata do
    // chamado, depois no cache de usuários do admin (buscando pelo buyer_id).
    const cachedUser = (window._adminUsersCache || []).find(u => u.id === raw.buyer_id);
    const requesterAvatar = meta.requester_avatar || cachedUser?.avatar || null;
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
        // order_id fica NULL de propósito: é o que marca esta linha como um
        // chamado de suporte (todo chat de pedido de verdade tem order_id).
        order_id:   null,
        buyer_id:   user?.id || null,
        buyer_name: user?.nome || 'Visitante',
        messages: [
            {
                // "Mensagem" de metadados: não é exibida na conversa, só carrega
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
 *  encerramento é guardado DENTRO do jsonb `messages` (em messages[0].closed),
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
    window.cancelSupportReplyOrEdit();
    document.getElementById('supportChatAttachPanel')?.classList.add('d-none');
    document.getElementById('supportRequestForm')?.classList.remove('d-none');
    document.getElementById('supportChatView')?.classList.add('d-none');
    document.getElementById('supportModalDialog')?.classList.remove('modal-fullscreen');
    document.body.classList.remove('support-chat-fullscreen');
    document.querySelector('#supportRequestModal .modal-header')?.classList.remove('d-none');
    const title = document.getElementById('supportModalTitle');
    if (title) title.innerHTML = '<i class="bi bi-headset me-2"></i>Falar com o Suporte';
};

/** Mostra um estado de carregamento rápido enquanto checa se já existe um chamado em aberto */
window.showSupportChatLoading = function() {
    document.getElementById('supportRequestForm')?.classList.add('d-none');
    const chatView = document.getElementById('supportChatView');
    chatView?.classList.remove('d-none');
    document.getElementById('supportModalDialog')?.classList.add('modal-fullscreen');
    document.body.classList.add('support-chat-fullscreen');
    document.getElementById('supportChatAttachPanel')?.classList.add('d-none');
    const container = document.getElementById('supportChatMessages');
    if (container) container.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>';
    document.getElementById('supportChatInputBar')?.classList.add('d-none');
    document.querySelector('#supportRequestModal .modal-header')?.classList.add('d-none');
};

/** Entra na etapa 2 (conversa) do modal de suporte, pro chamado indicado */
window.enterSupportChatMode = function(ticketId) {
    window._activeSupportTicketId = ticketId;
    supportChatLastSignature = null;
    window.cancelSupportReplyOrEdit();
    document.getElementById('supportChatAttachPanel')?.classList.add('d-none');
    document.getElementById('supportRequestForm')?.classList.add('d-none');
    document.getElementById('supportChatView')?.classList.remove('d-none');
    document.getElementById('supportModalDialog')?.classList.add('modal-fullscreen');
    document.body.classList.add('support-chat-fullscreen');
    document.querySelector('#supportRequestModal .modal-header')?.classList.add('d-none');
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
            const requesterAvatar = ticket.requester_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((ticket.requester_name || '?').slice(0,2))}&background=e50914&color=fff&size=40`;
            const roleLabel = ticket.requester_role === 'ADMIN' ? 'Administrador' : (ticket.requester_role === 'VENDEDOR' ? 'Vendedor' : 'Cliente');
            body.innerHTML = `
                <div class="chat-participant-row">
                    <img src="${requesterAvatar}" referrerpolicy="no-referrer" onerror="this.src='https://ui-avatars.com/api/?name=%3F&background=e50914&color=fff&size=40'">
                    <div class="chat-participant-info">
                        <strong>${ticket.requester_name || 'Visitante'}</strong>
                        <small>${ticket.requester_email || 'E-mail não informado'} • ${roleLabel} • Quem abriu o chamado</small>
                    </div>
                </div>
                <div class="chat-participant-row">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent('Suporte')}&background=ffc107&color=1c1c1c&size=40" referrerpolicy="no-referrer">
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

        const signature = JSON.stringify(raw.messages) + '|' + getChatClosed(raw);
        if (silent && signature === supportChatLastSignature) return;
        supportChatLastSignature = signature;

        const wasNearBottom = !silent || (container.scrollHeight - container.scrollTop - container.clientHeight < 120);

        container.innerHTML = (ticket.messages || []).map((m, index) => supportMsgBubbleHtml(m, index)).join('')
            || '<div class="text-center text-muted py-4">Sem mensagens ainda.</div>';

        const inputBar = document.getElementById('supportChatInputBar');
        if (inputBar) inputBar.classList.toggle('d-none', ticket.status === 'closed');

        const statusBar = document.getElementById('supportChatStatusBar');
        if (statusBar) {
            statusBar.innerHTML = ticket.status === 'closed'
                ? '<span class="admin-row-badge badge-muted"><i class="bi bi-lock-fill me-1"></i>Atendimento encerrado</span>'
                : `<span class="admin-row-badge badge-open"><i class="bi bi-headset me-1"></i>${SUPPORT_CATEGORY_LABELS[ticket.category] || ticket.subject || 'Chamado'}</span>`;
        }

        const headerStatus = document.getElementById('supportChatHeaderStatus');
        if (headerStatus) {
            headerStatus.textContent = ticket.status === 'closed'
                ? 'Atendimento encerrado'
                : (SUPPORT_CATEGORY_LABELS[ticket.category] || ticket.subject || 'Suporte ao cliente');
        }

        const ticketSummary = document.getElementById('supportChatTicketSummary');
        if (ticketSummary) ticketSummary.classList.add('d-none');

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
 *  as respostas da equipe de suporte (isStaff) ficam à esquerda em destaque.
 *  Mesmo conjunto de recursos do chat cliente ↔ vendedor: responder, copiar,
 *  editar/apagar (só nas próprias mensagens) e anexos de imagem/arquivo. */
function supportMsgBubbleHtml(m, index) {
    if (m.type === 'system' || m.senderId === 'system') {
        return `<div class="text-center my-3"><span class="system-chip"><i class="bi bi-info-circle-fill"></i>${m.text}</span></div>`;
    }

    const isMe = !m.isStaff;
    const senderLabel = m.isStaff ? (m.senderName || 'Suporte') : 'Você';

    const supportUser = getSavedUser();
    const myAvatarSrc = normalizeImageUrl(supportUser?.avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent(supportUser?.nome || 'Você')}&background=22c98e&color=fff&size=40`;
    const supportAvatarSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent('Suporte')}&background=ffc107&color=1c1c1c&size=40`;
    const bubbleAvatar = isMe ? myAvatarSrc : supportAvatarSrc;

    if (m.deleted) {
        return `
            <div class="msg-row ${isMe ? 'is-me' : 'is-them'}">
                <div class="msg-bubble ${isMe ? 'is-me' : 'is-them is-staff'} msg-deleted">
                    <i class="bi bi-slash-circle me-1"></i><em>Mensagem apagada</em>
                </div>
            </div>`;
    }

    const cleanText = stripLegacyEmoji(m.text || '');
    const replyHtml = m.replyTo ? `
        <div class="p-2 mb-2 rounded ${isMe ? 'bg-white bg-opacity-25' : 'bg-secondary bg-opacity-10'} small border-start border-4 border-info">
            <div class="fw-bold" style="font-size: 0.7rem;">${m.replyTo.senderName}</div>
            <div class="text-truncate chat-reply-preview">${stripLegacyEmoji(m.replyTo.text)}</div>
        </div>
    ` : '';

    const fileChipHtml = (m.type === 'file' && m.file) ? `
        <a href="${m.file.url}" target="_blank" rel="noopener" class="chat-file-chip mb-2">
            <i class="bi bi-file-earmark-arrow-down-fill"></i>
            <span class="chat-file-name">${cleanText.replace(/^Arquivo:\s*/, '') || m.file.name || 'Arquivo'}</span>
        </a>
    ` : '';

    const showTextCaption = cleanText && !(m.image && cleanText === 'Imagem') && !(m.type === 'file' && m.file);

    return `
        <div class="msg-row ${isMe ? 'is-me' : 'is-them'}">
            <div class="msg-bubble ${isMe ? 'is-me' : 'is-them is-staff'}">
                <div class="d-flex justify-content-between align-items-center mb-1 gap-2">
                    <span class="d-flex align-items-center gap-1">
                        <img src="${bubbleAvatar}" class="msg-avatar-inline" referrerpolicy="no-referrer" onerror="this.src='https://ui-avatars.com/api/?name=%3F&background=22c98e&color=fff&size=40'">
                        <span class="msg-sender">${senderLabel}${m.isStaff ? ' <i class="bi bi-patch-check-fill"></i>' : ''}</span>
                    </span>
                    <div class="dropdown">
                        <i class="bi bi-chevron-down cursor-pointer opacity-50" data-bs-toggle="dropdown" style="font-size: 0.8rem;"></i>
                        <ul class="dropdown-menu dropdown-menu-end shadow-sm">
                            <li><a class="dropdown-item py-1 small" href="javascript:void(0)" onclick="window.startSupportReply(${index})"><i class="bi bi-reply me-2"></i>Responder</a></li>
                            <li><a class="dropdown-item py-1 small" href="javascript:void(0)" onclick="window.copySupportMessageText(${index})"><i class="bi bi-clipboard me-2"></i>Copiar</a></li>
                            ${isMe ? `<li><a class="dropdown-item py-1 small" href="javascript:void(0)" onclick="window.startSupportEdit(${index})"><i class="bi bi-pencil me-2"></i>Editar</a></li>` : ''}
                            ${isMe ? `<li><a class="dropdown-item py-1 small text-danger" href="javascript:void(0)" onclick="window.deleteSupportMessage(${index})"><i class="bi bi-trash me-2"></i>Apagar</a></li>` : ''}
                        </ul>
                    </div>
                </div>

                ${replyHtml}

                ${m.image ? `
                    <img src="${m.image}" class="img-fluid rounded mb-2" referrerpolicy="no-referrer"
                         style="max-width:220px;cursor:pointer;"
                         onclick="window.openImageFull('${m.image}')">
                ` : ''}
                ${fileChipHtml}
                ${showTextCaption ? `<div class="chat-bubble-text" style="white-space:pre-wrap;">${formatLinks(cleanText)}</div>` : ''}
                <div class="msg-time">
                    ${m.edited ? '<span>(editada)</span> ' : ''}${new Date(m.timestamp).toLocaleString('pt-BR')}
                </div>
            </div>
        </div>`;
}

/** Envia uma nova mensagem do usuário dentro do chamado já aberto — ou salva
 *  a edição em andamento, se houver uma (ver window.startSupportEdit). */
window.sendMySupportMessage = async function() {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    const input = document.getElementById('supportChatInput');
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

    const preview = document.getElementById('supportChatInputPreview');
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
    document.getElementById('supportChatInput')?.focus();
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

    const input = document.getElementById('supportChatInput');
    if (input) input.value = msg.text || '';

    const preview = document.getElementById('supportChatInputPreview');
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
    const preview = document.getElementById('supportChatInputPreview');
    if (preview) {
        preview.classList.add('d-none');
        preview.innerHTML = '';
    }
    const input = document.getElementById('supportChatInput');
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

// -------- Anexo de imagem/arquivo no chat de suporte (mesmo painel do chat cliente ↔ vendedor) --------

window.toggleSupportAttachPanel = function() {
    const panel = document.getElementById('supportChatAttachPanel');
    if (!panel) return;
    panel.classList.toggle('d-none');
    if (!panel.classList.contains('d-none')) {
        document.getElementById('supportAttachLinkInput')?.focus();
    }
};

window.setSupportAttachType = function(type) {
    supportAttachType = type;
    document.querySelectorAll('#supportChatAttachPanel .chat-attach-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.attachType === type);
    });
    const input = document.getElementById('supportAttachLinkInput');
    if (input) input.placeholder = type === 'image' ? 'Cole o link da imagem...' : 'Cole o link do arquivo...';
};

window.confirmSupportAttach = async function() {
    const ticketId = window._activeSupportTicketId;
    if (!ticketId) return;
    const input = document.getElementById('supportAttachLinkInput');
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

        if (supportAttachType === 'image') {
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
        document.getElementById('supportChatAttachPanel')?.classList.add('d-none');
        supportChatLastSignature = null;
        await loadMySupportTicket(ticketId);
    } catch (e) {
        showToast('Erro ao enviar anexo.', 'error');
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
        const adminUser = getSavedUser();
        const myAvatar = normalizeImageUrl(adminUser?.avatar) || `https://ui-avatars.com/api/?name=${encodeURIComponent(adminUser?.nome || 'Suporte')}&background=ffc107&color=1c1c1c&size=40`;
        const requesterAvatar = ticket.requester_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((ticket.requester_name || '?').slice(0,2))}&background=e50914&color=fff&size=40`;
        const msgsHtml = (ticket.messages || []).map((m, i) => adminMsgBubbleHtml(m, i, resolveSenderName, myAvatar, requesterAvatar)).join('')
            || '<div class="text-center text-muted py-4">Sem mensagens.</div>';

        // Igual à aba "Chats": some com a navbar inferior e o resto do painel
        // admin (título, cards de estatística) pra o chamado ocupar a tela toda.
        document.body.classList.add('wa-locked', 'admin-chat-fullscreen');

        grid.className = 'admin-panel-active';
        const msgCount   = (ticket.messages || []).filter(m => m.type !== 'system').length;
        const roleLabel  = ticket.requester_role === 'ADMIN' ? 'Administrador' : (ticket.requester_role === 'VENDEDOR' ? 'Vendedor' : 'Cliente');
        const reasonLabel = SUPPORT_CATEGORY_LABELS[ticket.category] || ticket.subject || 'Chamado';

        grid.innerHTML = `
            <div class="admin-standalone-page">
                <div class="wa-main admin-chat-main" style="margin:0;">
                    <section class="wa-chat" style="flex-grow:1;">
                        <div class="chat-container" style="height:100%;">
                            <div class="chat-header-pro">
                                <button type="button" class="chat-header-close" onclick="window.adminViewTicketBack()" style="margin-right:4px;" title="Voltar para a lista">
                                    <i class="bi bi-arrow-left"></i>
                                </button>
                                <div class="chat-header-avatar-wrap">
                                    <img src="${requesterAvatar}" referrerpolicy="no-referrer" onerror="this.src='https://ui-avatars.com/api/?name=%3F&background=e50914&color=fff&size=40'">
                                </div>
                                <div class="chat-header-info">
                                    <span class="chat-header-name">${ticket.requester_name || 'Visitante'}</span>
                                    <span class="chat-header-order-id">${roleLabel} · ${reasonLabel}${ticket.order_id ? ' · Pedido #' + ticket.order_id.slice(-6).toUpperCase() : ''} · ${msgCount} mensagens</span>
                                </div>
                                <button type="button" class="chat-header-close" onclick="window.adminToggleParticipants()" title="Ver usuário do chamado">
                                    <i class="bi bi-people-fill"></i>
                                </button>
                                <div class="dropdown">
                                    <button type="button" class="chat-header-close" data-bs-toggle="dropdown" aria-label="Opções">
                                        <i class="bi bi-three-dots-vertical"></i>
                                    </button>
                                    <ul class="dropdown-menu dropdown-menu-end shadow-sm">
                                        ${ticket.status !== 'closed' ? `<li><a class="dropdown-item small" href="javascript:void(0)" onclick="window.adminCloseTicket('${ticketId}')"><i class="bi bi-check-circle-fill me-2"></i>Encerrar Chamado</a></li>` : ''}
                                        <li><a class="dropdown-item small text-danger" href="javascript:void(0)" onclick="window.adminDeleteTicket('${ticketId}')"><i class="bi bi-trash me-2"></i>Apagar chamado</a></li>
                                    </ul>
                                </div>
                            </div>

                            <div class="chat-status-bar">
                                <span class="admin-row-badge ${ticket.status === 'closed' ? 'badge-muted' : 'badge-open'}">${ticket.status === 'closed' ? 'Encerrado' : 'Aberto'}</span>
                                ${ticket.status === 'closed' ? `<span class="small text-muted ms-2"><i class="bi bi-lock-fill me-1"></i>Chamado encerrado</span>` : ''}
                            </div>

                            <div id="adminChatParticipants" class="chat-participants-panel d-none">
                                <div class="chat-participant-row">
                                    <img src="${requesterAvatar}" referrerpolicy="no-referrer" onerror="this.src='https://ui-avatars.com/api/?name=%3F&background=3483fa&color=fff&size=40'">
                                    <div class="chat-participant-info">
                                        <strong>${ticket.requester_name || 'Visitante'}</strong>
                                        <small>${ticket.requester_email || 'E-mail não informado'} • ${roleLabel}</small>
                                    </div>
                                </div>
                            </div>

                            <div id="adminChatMsgsBody" class="chat-messages">${msgsHtml}</div>

                            ${ticket.status !== 'closed' ? `
                                <div id="adminTicketInputPreview" class="p-2 bg-warning bg-opacity-10 border-bottom d-none"></div>
                                <div id="adminTicketAttachPanel" class="p-3 bg-light border-top d-none">
                                    <div class="d-flex gap-2 mb-2">
                                        <button type="button" class="btn btn-sm flex-grow-1 chat-attach-tab active" data-attach-type="image" onclick="window.setAdminTicketAttachType('image')">
                                            <i class="bi bi-image me-1"></i>Imagem
                                        </button>
                                        <button type="button" class="btn btn-sm flex-grow-1 chat-attach-tab" data-attach-type="file" onclick="window.setAdminTicketAttachType('file')">
                                            <i class="bi bi-file-earmark me-1"></i>Arquivo
                                        </button>
                                    </div>
                                    <div class="input-group input-group-sm mb-2">
                                        <span class="input-group-text"><i class="bi bi-link-45deg"></i></span>
                                        <input type="url" id="adminTicketAttachLinkInput" class="form-control" placeholder="Cole o link da imagem...">
                                    </div>
                                    <div class="d-flex gap-2">
                                        <button type="button" class="btn btn-outline-secondary btn-sm flex-grow-1" onclick="window.abrirUploadExterno()">
                                            <i class="bi bi-box-arrow-up-right me-1"></i>Fazer upload (Imgur)
                                        </button>
                                        <button type="button" class="btn btn-primary btn-sm flex-grow-1" onclick="window.confirmAdminTicketAttach()">
                                            <i class="bi bi-send me-1"></i>Enviar
                                        </button>
                                    </div>
                                </div>
                                <div class="chat-input-bar">
                                    <div class="d-flex gap-2 align-items-center">
                                        <button type="button" class="chat-icon-btn" onclick="window.toggleAdminTicketAttachPanel()" title="Anexar imagem ou arquivo">
                                            <i class="bi bi-paperclip"></i>
                                        </button>
                                        <input type="text" id="adminChatInput" class="chat-text-input" placeholder="Responder como Suporte..." autocomplete="off"
                                               onkeypress="if(event.key==='Enter'){event.preventDefault(); window.adminSendTicketMessage('${ticketId}');}">
                                        <button type="button" class="chat-send-btn" onclick="window.adminSendTicketMessage('${ticketId}')"><i class="bi bi-send-fill"></i></button>
                                    </div>
                                </div>
                            ` : ''}
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

window.toggleAdminTicketAttachPanel = function() {
    document.getElementById('adminTicketAttachPanel')?.classList.toggle('d-none');
};
window.setAdminTicketAttachType = function(type) {
    adminTicketAttachType = type;
    document.querySelectorAll('#adminTicketAttachPanel .chat-attach-tab').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-attach-type') === type);
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

