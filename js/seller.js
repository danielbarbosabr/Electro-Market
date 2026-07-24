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

        // Busca chats para calcular não lidas
        const _orderIds = orders.map(o => o.id);
        const _chats = await supabaseFetch('chats?select=order_id,messages,participants&order_id=in.(' + _orderIds.map(id => '"' + id + '"').join(',') + ')');
        const _unreadMap = {};
        const _lastTimeMap = {};
        (_chats || []).forEach(c => {
            if (!c.participants || !c.participants.some(p => String(p) === String(user.id))) return;
            const u = c.messages?.filter(m => m.senderId && String(m.senderId) !== String(user.id) && !m.visto).length || 0;
            if (u > 0) _unreadMap[c.order_id] = u;
            const lastMsg = c.messages?.[c.messages.length - 1];
            if (lastMsg?.timestamp) _lastTimeMap[c.order_id] = lastMsg.timestamp;
        });

        waList.innerHTML = orders.map(order => {
            const st        = ORDER_STATUS_MAP[order.status] || { text: order.status, class: 'bg-secondary' };
            const isPending = order.status === 'pending' || order.status === 'offer_pending';
            const isBuyer   = user.id === order.buyer_id;
            const partnerName = isBuyer ? order.seller_name : order.buyer_name;
            const _unread  = _unreadMap[order.id] || 0;
            const _lastTime = _lastTimeMap[order.id] ? new Date(_lastTimeMap[order.id]).toLocaleString('pt-BR', { hour:'2-digit', minute:'2-digit' }) : '';

            const isFinished = order.status === 'cancelled' || order.status === 'finished';

            let actionsHtml = '';
            if (isPending && type === 'buyer') {
                actionsHtml = `<button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); window.cancelOrderBuyer('${order.id}')">${order.status === 'offer_pending' ? 'Cancelar Oferta' : 'Cancelar Pedido'}</button>`;
            }

            return `
            <div class="wa-contact" data-order-id="${order.id}" data-contact-name="${((partnerName || '') + ' ' + (order.product_title || '')).toLowerCase()}" onclick="${!isPending && !isFinished ? `window.showChat('${order.id}')` : ''}" style="${isPending || isFinished ? 'cursor:default;' : ''}">
                <img src="${order.product_img || ''}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://placehold.co/45'">
                <div class="wa-contact-textbox">
                    <div class="wa-contact-name">${partnerName || 'Usuário'}</div>
                    <div class="wa-contact-text" style="${_unread ? 'font-weight:600;color:#111;' : ''}">${order.product_title || 'Produto'} · ${order.status === 'offer_pending' ? `Oferta: ${formatPreco(order.offer_amount, {htmlGratis:false})}` : formatPreco(order.total, {htmlGratis:false})}</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
                    ${_lastTime ? `<small class="text-muted" style="font-size:0.65rem;line-height:1;">${_lastTime}</small>` : ''}
                    ${_unread ? `<span class="badge bg-success wa-contact-badge" style="position:static;">${_unread}</span>` : ''}
                    <span class="badge ${st.class} wa-contact-badge" style="position:static;">${st.text}</span>
                    ${isFinished ? `<button type="button" class="btn btn-sm btn-outline-danger py-0 px-1" style="font-size:0.6rem;line-height:1.4;" onclick="event.stopPropagation(); window.removeOrderFromHistory('${order.id}', '${type}')"><i class="bi bi-trash"></i> Remover</button>` : ''}
                    ${actionsHtml}
                </div>
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

    const grid = document.getElementById('productsGrid');
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
        window.setWaSideActions?.(false);
        window.setWaSideProfile?.();
        document.getElementById('waSideMe')?.classList.add('d-none');
        document.getElementById('waSideMyName')?.classList.add('d-none');
        document.getElementById('waSideFullscreenBtn')?.classList.remove('d-none');
        document.getElementById('waSideCloseBtn')?.classList.remove('d-none');
        window.updateWaEmptyState?.(type === 'buyer' ? 'buyer' : 'seller');

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

        // Busca chats para calcular não lidas
        const orderIds = orders.map(o => o.id);
        const chats = await supabaseFetch('chats?select=order_id,messages,participants&order_id=in.(' + orderIds.map(id => '"' + id + '"').join(',') + ')');
        const unreadMap = {};
        const lastTimeMap = {};
        (chats || []).forEach(c => {
            if (!c.participants || !c.participants.some(p => String(p) === String(user.id))) return;
            const u = c.messages?.filter(m => m.senderId && String(m.senderId) !== String(user.id) && !m.visto).length || 0;
            if (u > 0) unreadMap[c.order_id] = u;
            const lastMsg = c.messages?.[c.messages.length - 1];
            if (lastMsg?.timestamp) lastTimeMap[c.order_id] = lastMsg.timestamp;
        });

        waList.innerHTML = orders.map(order => {
            const st        = ORDER_STATUS_MAP[order.status] || { text: order.status, class: 'bg-secondary' };
            const isPending = order.status === 'pending' || order.status === 'offer_pending';
            const isBuyer   = user.id === order.buyer_id;
            const partnerName = isBuyer ? order.seller_name : order.buyer_name;
            const unread    = unreadMap[order.id] || 0;
            const lastTime = lastTimeMap[order.id] ? new Date(lastTimeMap[order.id]).toLocaleString('pt-BR', { hour:'2-digit', minute:'2-digit' }) : '';

            const isFinished = order.status === 'cancelled' || order.status === 'finished';

            let actionsHtml = '';
            if (isPending && type === 'buyer') {
                actionsHtml = `<button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); window.cancelOrderBuyer('${order.id}')">${order.status === 'offer_pending' ? 'Cancelar Oferta' : 'Cancelar Pedido'}</button>`;
            }

            return `
            <div class="wa-contact" data-order-id="${order.id}" data-contact-name="${((partnerName || '') + ' ' + (order.product_title || '')).toLowerCase()}" onclick="${!isPending && !isFinished ? `window.showChat('${order.id}')` : ''}" style="${isPending || isFinished ? 'cursor:default;' : ''}">
                <img src="${order.product_img || ''}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://placehold.co/45'">
                <div class="wa-contact-textbox">
                    <div class="wa-contact-name">${partnerName || 'Usuário'}</div>
                    <div class="wa-contact-text" style="${unread ? 'font-weight:600;color:#111;' : ''}">${order.product_title || 'Produto'} · ${order.status === 'offer_pending' ? `Oferta: ${formatPreco(order.offer_amount, {htmlGratis:false})}` : formatPreco(order.total, {htmlGratis:false})}</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
                    ${lastTime ? `<small class="text-muted" style="font-size:0.65rem;line-height:1;">${lastTime}</small>` : ''}
                    ${unread ? `<span class="badge bg-success wa-contact-badge" style="position:static;">${unread}</span>` : ''}
                    <span class="badge ${st.class} wa-contact-badge" style="position:static;">${st.text}</span>
                    ${isFinished ? `<button type="button" class="btn btn-sm btn-outline-danger py-0 px-1" style="font-size:0.6rem;line-height:1.4;" onclick="event.stopPropagation(); window.removeOrderFromHistory('${order.id}', '${type}')"><i class="bi bi-trash"></i> Remover</button>` : ''}
                    ${actionsHtml}
                </div>
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
                        <img src="${order.product_img || ''}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://placehold.co/70'"
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
                    <div class="d-flex flex-column gap-2 mt-2">
                        <button class="ml-attach ml-attach-success w-100" onclick="window.updateOrderStatus('${order.id}', 'accepted')">
                            <i class="bi bi-check-lg me-1"></i>${isOffer ? 'Aceitar Oferta' : 'Aceitar'}
                        </button>
                        <button class="ml-attach ml-attach-danger w-100" onclick="window.updateOrderStatus('${order.id}', 'cancelled')">
                            <i class="bi bi-x-lg me-1"></i>${isOffer ? 'Recusar Oferta' : 'Recusar'}
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
        await supabaseFetch(`chats?order_id=eq.${orderId}`, { method: 'DELETE' });
        await supabaseFetch(`orders?id=eq.${orderId}`, { method: 'DELETE' });
        showToast('Pedido removido do histórico!', 'info');
        window.renderOrderManagement(type);
    } catch (err) { 
        console.error("Erro ao remover:", err);
        showToast('Erro ao remover registro. Verifique a conexão.', 'error'); 
    }
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

/** Abre uma disputa no pedido — envia e-mail para o suporte e registra no chat. */
window.requestOrderSupport = async function(orderId, category) {
    if (!confirm('Enviar solicitação de suporte para este pedido?')) return;
    try {
        const user = getSavedUser();
        const nome = user?.nome || 'Usuário';
        const userEmail = user?.email || '';
        const labels = { produto_nao_recebido: 'Não recebi o produto', entrega_sem_confirmacao: 'Entreguei, mas o comprador não confirmou' };
        const assunto = labels[category] || 'Problema com o pedido';

        // Busca dados do pedido para incluir no e-mail
        let produtoInfo = '';
        let orderData;
        try {
            orderData = await supabaseFetch(`orders?id=eq.${orderId}&limit=1`);
            const order = orderData?.[0];
            if (order) {
                produtoInfo = `Produto: ${order.product_title || 'N/A'}
Valor: R$ ${parseFloat(order.total || order.price || 0).toFixed(2)}
Status: ${order.status || 'N/A'}`;
            }
        } catch (e) {}

        // Marca o pedido como disputa
        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'dispute', updated_at: new Date().toISOString() })
        });

        // Adiciona registro de disputa no chat do pedido
        try {
            const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
            const chat = chatData[0];
            if (chat) {
                chat.messages.push({
                    type: 'dispute_report',
                    category,
                    subject: assunto,
                    reportedBy: nome,
                    reportedByEmail: userEmail || '',
                    reportedByRole: user?.tipo || 'Visitante',
                    timestamp: new Date().toISOString()
                });
                chat.messages.push({
                    senderId: 'system',
                    text: `Disputa aberta: ${assunto}. A equipe de suporte foi notificada por e-mail.`,
                    timestamp: new Date().toISOString(),
                    type: 'system'
                });
                await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
            }
        } catch (e) {}

        // Envia e-mail
        const body = `
Nova solicitação de suporte:

━━━━ DADOS DO SOLICITANTE ━━━━
Nome: ${nome}
E-mail: ${userEmail || 'não informado'}
Tipo: ${user?.tipo || 'Visitante'}

━━━━ PEDIDO ━━━━
ID: ${orderId}
${produtoInfo}

━━━━ SOLICITAÇÃO ━━━━
Assunto: ${assunto}

━━━━━━━━━━━━━━━━━━━━━━
ElectroMarket - Plataforma de E-commerce
        `.trim();

        const mailto = `mailto:dannybarbosadelimabr@gmail.com?subject=${encodeURIComponent('[Suporte ElectroMarket] ' + assunto)}&body=${encodeURIComponent(body)}`;
        window.location.href = mailto;
        showToast('E-mail de suporte aberto e disputa registrada!', 'success');
        loadChatMessages(orderId);
    } catch (e) {
        console.error(e);
        showToast('Erro ao enviar solicitação de suporte.', 'error');
    }
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
        const alreadyReviewed = isSellerRatingBuyer ? order.seller_reviewed : order.buyer_reviewed;
        if (alreadyReviewed) return;
        // Fallback local para coluna que pode não existir no banco
        try { if (localStorage.getItem(`reviewed_${orderId}_${getSavedUser()?.id}`)) return; } catch (e) {}

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

    const comment = document.getElementById('reviewComment')?.value.trim() || '';
    const img1 = document.getElementById('reviewImage1')?.value.trim() || '';
    const img2 = document.getElementById('reviewImage2')?.value.trim() || '';
    const img3 = document.getElementById('reviewImage3')?.value.trim() || '';
    const reviewImages = [img1, img2, img3].filter(Boolean);
    const reviewVideo = '';

    try {
        // Atualiza a média de quem está sendo avaliado (se a coluna existir)
        const ratingField = isSellerRatingBuyer ? 'comprador_rating'       : 'vendedor_rating';
        const countField   = isSellerRatingBuyer ? 'comprador_rating_count' : 'rating_count';

        try {
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
        } catch (e2) {
            // coluna não existe no banco (ex: comprador_rating) — ignora
        }

        // Marca o pedido como já avaliado (se a coluna existir)
        const reviewedField = isSellerRatingBuyer ? 'seller_reviewed' : 'buyer_reviewed';
        try {
            await supabaseFetch(`orders?id=eq.${orderId}`, {
                method: 'PATCH',
                body: JSON.stringify({ [reviewedField]: true })
            });
        } catch (e3) {
            // coluna não existe no banco — ignora
        }
        // Fallback local para evitar re-avaliação (caso coluna não exista)
        try { localStorage.setItem(`reviewed_${orderId}_${user.id}`, '1'); } catch (e3) {};
        const cachedOrder = ordersCache.find(o => o.id === orderId);
        if (cachedOrder) cachedOrder[reviewedField] = true;

        // Envia a avaliação como mensagem no chat
        const reviewerAvatar = (() => { try { const links = safeParseImages(user.avatar); return links[0] || ''; } catch { return ''; } })();
        try {
            const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
            const chat = chatData?.[0];
            if (chat) {
                const targetName = isSellerRatingBuyer ? (chat.buyer_name || 'Comprador') : (chat.seller_name || 'Vendedor');
                const stars = '★'.repeat(currentReviewRating) + '☆'.repeat(5 - currentReviewRating);
                let reviewText = isSellerRatingBuyer ? `Avaliação do comprador` : `Avaliação do vendedor`;
                reviewText += `\nNota: ${currentReviewRating}/5\n\n`;
                if (comment) reviewText += `${comment}\n\n`;
                reviewText += `— ${user.nome || 'Usuário'}`;
                const newMsg = {
                    senderId:        user.id,
                    senderName:      user.nome || 'Usuário',
                    text:            reviewText,
                    timestamp:       new Date().toISOString(),
                    type:            'review',
                    avaliadoId:      targetId,
                    avaliadoNome:    targetName,
                    rating:          currentReviewRating,
                    reviewComment:   comment || '',
                    avaliadorAvatar: reviewerAvatar
                };
                if (reviewImages.length > 0) {
                    newMsg.image = reviewImages[0];
                    newMsg.reviewImages = reviewImages;
                }
                chat.messages = chat.messages || [];
                chat.messages.push(newMsg);
                await supabaseFetch(`chats?order_id=eq.${orderId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ messages: chat.messages })
                });
            }
        } catch (e) {
            console.error('Erro ao enviar avaliação pro chat:', e);
        }

        // Salva na tabela avaliacoes (persistente, sobrevive à exclusão do chat)
        try {
            await supabaseFetch('avaliacoes', {
                method: 'POST',
                body: JSON.stringify({
                    order_id:       orderId,
                    tipo:           mode,
                    avaliador_nome: user.nome || 'Usuário',
                    avaliado_id:    targetId,
                    rating:         currentReviewRating,
                    comment:        comment || '',
                    images:         reviewImages.length > 0 ? JSON.stringify(reviewImages) : '[]',
                    videos:         '[]'
                })
            });
        } catch (e) {
            console.warn('Erro ao salvar avaliação na tabela:', e);
        }

        bootstrap.Modal.getInstance(document.getElementById('reviewModal'))?.hide();
        showToast(isSellerRatingBuyer ? 'Obrigado por avaliar o comprador!' : 'Obrigado por avaliar o vendedor!', 'success');

        if (currentChat === orderId) {
            loadChatMessages(orderId, true);
            updateChatLogistics(cachedOrder || { id: orderId, status: 'finished', [reviewedField]: true }, user);
        }

        // Limpa campos do modal
        document.getElementById('reviewComment').value = '';
        document.getElementById('reviewImage1').value = '';
        document.getElementById('reviewImage2').value = '';
        document.getElementById('reviewImage3').value = '';
        const videoEl = document.getElementById('reviewVideo');
        if (videoEl) videoEl.value = '';
    } catch (e) {
        console.error('[Review] Erro ao enviar avaliação:', e);
        showToast('Erro ao enviar avaliação: ' + (e?.message || e?.details || e?.error || 'Tente novamente.'), 'error');
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
                <button class="btn btn-primary mt-2" onclick="window.showCreateAdPage()">
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

window.handleReviewImageUpload = async function(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    let slot = 1;
    while (slot <= 3 && document.getElementById(`reviewImage${slot}`).value.trim()) slot++;
    for (const file of files) {
        if (slot > 3) break;
        const field = document.getElementById(`reviewImage${slot}`);
        const preview = document.getElementById(`reviewFotoPreview${slot}`);
        field.value = 'Enviando...';
        const url = await uploadImageToHost(file);
        if (url) {
            field.value = url;
            if (preview) preview.style.backgroundImage = `url('${url}')`;
        } else {
            field.value = '';
            showToast('Falha ao enviar imagem.', 'error');
        }
        slot++;
    }
    input.value = '';
};

// ============================================
