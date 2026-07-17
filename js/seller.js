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
            <div class="col-12">
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
                        <button class="btn btn-ml-primary fw-bold flex-grow-1" onclick="window.updateOrderStatus('${order.id}', 'accepted')">
                            <i class="bi bi-check-lg me-1"></i>${isOffer ? 'Aceitar Oferta' : 'Aceitar'}
                        </button>
                        <button class="btn btn-ml-secondary flex-grow-1" onclick="window.updateOrderStatus('${order.id}', 'cancelled')">
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

    // Antes isso assumia que quem não é o comprador é sempre o vendedor — o que
    // fazia um terceiro (ex: administrador) que caísse nesta tela ser tratado
    // como se fosse o vendedor do pedido. Agora identificamos os dois papéis
    // explicitamente pelo id.
    const isBuyerHere  = user.id === order.buyer_id;
    const isSellerHere = user.id === order.seller_id;
    const otherId   = isBuyerHere ? order.seller_id   : (isSellerHere ? order.buyer_id   : null);
    const otherName = isBuyerHere ? order.seller_name : (isSellerHere ? order.buyer_name  : `${order.buyer_name || 'Comprador'} ↔ ${order.seller_name || 'Vendedor'}`);
    document.getElementById('chatPartnerNameHeader').textContent = otherName || 'Chat';

    const avatarEl = document.getElementById('chatPartnerAvatar');
    const dotEl = document.getElementById('chatPartnerStatusDot');
    avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(otherName || 'User')}&background=random&size=40`; // placeholder enquanto busca a foto real
    dotEl?.classList.remove('online', 'offline');
    try {
        if (otherId) {
            const partnerData = await supabaseFetch(`users?select=avatar,last_seen&id=eq.${otherId}&limit=1`);
            const realAvatar = normalizeImageUrl(partnerData?.[0]?.avatar);
            if (realAvatar) avatarEl.src = realAvatar;
            if (dotEl) dotEl.classList.add(isRecentlyOnline(partnerData?.[0]?.last_seen) ? 'online' : 'offline');
        }
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
                id:           crypto.randomUUID(),
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
        // Avatar fixo pra mensagens da equipe de suporte (admin) — nunca deve usar
        // o avatar do vendedor/comprador (partnerAvatarSrc), senão a mensagem do
        // admin aparece com a cara da outra parte e parece ter sido ela quem falou.
        const supportAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent('Suporte')}&background=ffc107&color=1c1c1c&size=40`;

        container.innerHTML = chat.messages.map((msg, index) => {
            if (msg.type === 'system' || msg.senderId === 'system') {
                return `<div class="text-center my-3">
                    <span class="system-chip">
                        <i class="bi bi-info-circle-fill"></i>${stripLegacyEmoji(msg.text)}
                    </span>
                </div>`;
            }

            const isMe = msg.senderId === user.id;
            // Mensagens injetadas pelo admin/suporte (ver adminChatsTabSend/adminSendChatMessage
            // em admin.js) vêm marcadas com isStaff — nunca são nem "eu" nem a outra parte do
            // pedido, então precisam de um estilo e avatar próprios, senão ficam indistinguíveis
            // da mensagem do vendedor (mesma bolha "is-them", mesmo avatar da outra parte).
            const isStaff = !!msg.isStaff;
            const avatarForThem = isStaff ? supportAvatar : partnerAvatarSrc;
            // Agrupamento estilo WhatsApp: some com o nome/margem quando a mensagem
            // anterior é da mesma pessoa em sequência.
            const prevMsg = chat.messages[index - 1];
            const isGrouped = prevMsg && prevMsg.senderId === msg.senderId && prevMsg.type !== 'system' && !!prevMsg.isStaff === isStaff;

            if (msg.deleted) {
                return `
                <div class="msg-row ${isMe ? 'is-me' : 'is-them'}" style="${isGrouped ? 'margin-top:-4px;' : ''}">
                    ${!isMe ? `<img class="msg-avatar" src="${avatarForThem}" referrerpolicy="no-referrer">` : ''}
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
                ${!isMe ? `<img class="msg-avatar" src="${avatarForThem}" referrerpolicy="no-referrer">` : ''}
                <div class="msg-bubble ${isMe ? 'is-me' : 'is-them'}${isStaff ? ' is-staff' : ''}">

                    <div class="d-flex justify-content-between align-items-center mb-1 gap-2">
                        ${!isGrouped ? `<span class="msg-sender">${isMe ? 'Você' : (msg.senderName || 'Usuário')}${isStaff ? ' <i class="bi bi-patch-check-fill" title="Suporte"></i>' : ''}</span>` : '<span></span>'}
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
                id:             crypto.randomUUID(),
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
