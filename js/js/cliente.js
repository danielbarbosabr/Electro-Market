// ============================================
// CLIENTE — Funções exclusivas do comprador
// ============================================

// ============================================
// CARRINHO
// ============================================

function updateCartBadge() {
    const count = cart.reduce((a, i) => a + (i.qtd || 1), 0);
    document.querySelectorAll('#cartBadgeDesktop, #cartBadgeMobile').forEach(el => {
        if (el) { el.textContent = count; el.classList.toggle('d-none', count === 0); }
    });
}

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
        <div class="cart-item">
            <div class="d-flex gap-2 align-items-start">
                <img src="${thumb || 'https://placehold.co/60'}" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/60/e9ecef/6c757d?text=%20'">
                <div class="flex-grow-1" style="min-width:0">
                    <div class="cart-item-title text-truncate">${item.titulo}</div>
                    <div class="cart-item-price">${(item.preco || 0) === 0 ? 'GRÁTIS' : `R$ ${(item.preco || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}`}</div>
                    <div class="d-flex align-items-center gap-2 mt-2">
                        <button class="btn btn-outline-secondary" onclick="window.updateCartQty(${i}, -1)">−</button>
                        <span class="small fw-bold">${item.qtd || 1}</span>
                        <button class="btn btn-outline-secondary" onclick="window.updateCartQty(${i}, +1)">+</button>
                    </div>
                </div>
            </div>
            <div class="d-flex gap-1 mt-2">
                <button class="btn btn-sm btn-outline-danger flex-grow-1" onclick="window.removeFromCart(${i})">
                    <i class="bi bi-trash"></i>
                </button>
                <button class="btn btn-sm btn-outline-primary flex-grow-1" onclick="window.buyItem(${i})">
                    Solicitar Compra
                </button>
            </div>
        </div>`;
    }).join('');

    if (totalEl) totalEl.textContent = formatPreco(total, {htmlGratis:false});
    updateCartBadge();
    localStorage.setItem('electroCart', JSON.stringify(cart));
}

window.esvaziarCarrinho = function() {
    if (cart.length === 0) { showToast('Seu carrinho já está vazio.', 'info'); return; }
    if (!confirm('Tem certeza que deseja remover todos os itens do carrinho?')) return;
    cart.length = 0;
    localStorage.setItem('electroCart', JSON.stringify(cart));
    window.renderCart();
    showToast('Carrinho esvaziado.', 'info');
};

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

window.addToCart = function(productId, options = {}) {
    if (!getSavedUser()) {
        window.showAuthScreen?.();
        return showToast('Faça login para adicionar ao carrinho!', 'warning');
    }
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
    window.renderCart();
    if (!silent) showToast(`"${p.titulo.substring(0,30)}..." adicionado ao carrinho!`, 'success');

    if (openCart) bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('cartOffcanvas')).show();
};

window.removeFromCart = function(i) {
    cart.splice(i, 1);
    window.renderCart();
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
    newQty < 1 ? window.removeFromCart(i) : (item.qtd = newQty, window.renderCart());
};

// ============================================
// COMPRA DIRETA (buyItem)
// ============================================

window.buyItem = async function(i) {
    const item = cart[i];
    const user = getSavedUser();
    if (!user) { showToast('Faça login para comprar!', 'warning'); return; }

    const btn          = document.querySelector(`button[onclick="window.buyItem(${i})"], button[onclick="buyItem(${i})"]`);
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
                id:           crypto.randomUUID(),
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
        window.renderCart();
        ordersCache.push(order);
        bootstrap.Offcanvas.getInstance(document.getElementById('cartOffcanvas'))?.hide();

        createPersistentNotification(`Pedido #${orderId.slice(-6).toUpperCase()} realizado com sucesso!`, 'success');
        showToast('Pedido enviado ao vendedor! Aguarde aprovação.', 'success');
        window.renderOrderManagement('buyer');

    } catch (err) {
        console.error(err);
        showToast('Erro ao enviar pedido! ' + (err.message || 'Tente novamente.'), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
};

// ============================================
// OFERTA
// ============================================

window.showOfferPage = function(pid) {
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    const gridTitleEl = document.getElementById('gridTitle');
    if (gridTitleEl) gridTitleEl.textContent = '';
    document.getElementById('storefrontBanner')?.replaceChildren();

    const grid = document.getElementById('productsGrid');
    if (!grid.classList.contains('product-detail-active') && !grid.classList.contains('profile-page-active') && !grid.classList.contains('seller-profile-active') && !grid.classList.contains('create-ad-active') && !grid.classList.contains('offer-page-active')) {
        window._preDetailState = {
            html: grid.innerHTML,
            gridClass: grid.className,
            gridDisplay: grid.style.display,
            title: document.getElementById('gridTitle')?.textContent || '',
            heroHidden: document.getElementById('heroSection')?.classList.contains('d-none') ?? true
        };
    }

    grid.className = 'offer-page-active';
    grid.style.display = 'block';

    const user = getSavedUser();
    if (!user) { showToast('Faça login para enviar uma oferta!', 'warning'); window.closeProductDetail(); return; }

    const item = allProductsCache.find(x => x.id == pid || x.id === pid);
    if (!item) { showToast('Produto não encontrado.', 'error'); window.closeProductDetail(); return; }
    if (user.id === item.vendedor_id) { showToast('Você não pode fazer uma oferta no seu próprio anúncio.', 'warning'); window.closeProductDetail(); return; }

    const preco = parseFloat(item.preco) || 0;

    grid.innerHTML = `
    <div class="detail-page">
        <button type="button" class="detail-back-btn" onclick="window.closeProductDetail()">
            <i class="bi bi-arrow-left"></i> Voltar
        </button>

        <div class="create-ad-wrap">
            <div class="create-ad-header">
                <div>
                    <h4>Fazer Oferta</h4>
                    <p class="text-muted small mb-0">Proponha um valor para este produto</p>
                </div>
            </div>

            <form id="offerForm" class="create-ad-form" onsubmit="window.submitOffer(event)">
                <div class="create-ad-section">
                    <div class="create-ad-section-title">
                        <i class="bi bi-box-seam-fill"></i>
                        <span>Produto</span>
                    </div>
                    <div class="create-ad-section-body">
                        <div class="d-flex align-items-center gap-3 mb-3 pb-3 border-bottom">
                            <img id="offerProductImg" src="${safeParseImages(item.img)[0] || 'https://placehold.co/60'}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://placehold.co/60'"
                                 style="width:60px;height:60px;object-fit:cover;border-radius:8px;flex-shrink:0;">
                            <div class="flex-grow-1">
                                <h6 class="fw-bold mb-1">${item.titulo}</h6>
                                <small class="text-muted">Preço anunciado: <strong>${formatPreco(preco)}</strong></small>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="create-ad-section">
                    <div class="create-ad-section-title">
                        <i class="bi bi-tag-fill"></i>
                        <span>Sua Oferta</span>
                    </div>
                    <div class="create-ad-section-body">
                        <div class="mb-3">
                            <div class="ml-field">
                                <input type="number" id="offerAmount" step="0.01" min="0.01"${preco > 0 ? ` max="${preco - 0.01}"` : ''} placeholder=" " required>
                                <label for="offerAmount">Seu valor (R$) *</label>
                            </div>
                        </div>
                        <div class="mb-3">
                            <div class="ml-field">
                                <input type="number" id="offerQty" min="1" value="1" max="${Math.max(1, item.quantidade ?? 9999)}" placeholder=" " required>
                                <label for="offerQty">Quantidade *</label>
                            </div>
                        </div>
                        <p class="small text-muted mb-0"><i class="bi bi-info-circle me-1"></i>O vendedor pode aceitar ou recusar sua oferta em até alguns dias. Você será avisado assim que ele responder.</p>
                    </div>
                </div>

                <div class="create-ad-footer">
                    <button type="button" class="ml-btn ml-btn-outline" onclick="window.closeProductDetail()">
                        <i class="bi bi-x-lg me-2"></i>Cancelar
                    </button>
                    <button type="submit" class="ml-btn ml-btn-primary">
                        <i class="bi bi-send me-2"></i>Enviar Oferta
                    </button>
                </div>
            </form>
        </div>
    </div>`;

    document.getElementById('offerForm').dataset.pid = pid;
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.openOfferModal = function(pid) { window.showOfferPage(pid); };

window.submitOffer = async function(event) {
    event.preventDefault();
    const user = getSavedUser();
    if (!user) { showToast('Faça login para enviar uma oferta!', 'warning'); return; }

    const form = document.getElementById('offerForm');
    const pid  = form.dataset.pid;
    const item = allProductsCache.find(x => x.id == pid || x.id === pid);
    if (!item) { showToast('Produto não encontrado.', 'error'); return; }

    const preco      = parseFloat(item.preco) || 0;
    const offerValue = parseFloat(document.getElementById('offerAmount').value);
    const qty        = parseInt(document.getElementById('offerQty').value) || 1;

    if (!offerValue || offerValue <= 0) { showToast('Informe um valor de oferta válido.', 'warning'); return; }
    if (preco > 0 && offerValue >= preco) {
        showToast('A oferta deve ser menor que o preço anunciado. Pra pagar o valor cheio, use "Solicitar Compra".', 'warning');
        return;
    }

    const btn          = form.querySelector('button[type="submit"]');
    const originalText = btn?.textContent || 'Enviar Oferta';
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

    try {
        const orderId = `ord_${Date.now()}`;
        const imgs = safeParseImages(item.img);
        const order = {
            id:                   orderId,
            seller_id:            item.vendedor_id || 'system',
            seller_name:          item.loja || 'Vendedor',
            buyer_id:             user.id,
            buyer_name:           user.nome,
            product_id:           item.id,
            product_title:        item.titulo,
            product_img:          (imgs.length > 0 ? imgs[0] : ''),
            total:                offerValue * qty,
            quantity:             qty,
            status:               'offer_pending',
            offer_amount:         offerValue,
            offer_original_price: preco,
            realiza_entrega:      !!(item.realiza_entrega ?? item.realizaEntrega ?? true),
            agree_buyer:          false,
            agree_seller:         false,
            created_at:           new Date().toISOString(),
            updated_at:           new Date().toISOString()
        };

        await supabaseFetch('orders', { method: 'POST', body: JSON.stringify(order) });

        await supabaseFetch('chats', {
            method: 'POST',
            body: JSON.stringify({
                id:           crypto.randomUUID(),
                order_id:     orderId,
                seller_id:    order.seller_id,
                seller_name:  order.seller_name,
                buyer_id:     order.buyer_id,
                buyer_name:   order.buyer_name,
                participants: [order.seller_id, order.buyer_id],
                logistics_agreed: false,
                messages: [{
                    senderId:  'system',
                    text:      `Oferta enviada para "${item.titulo}"!\nValor oferecido: ${formatPreco(offerValue, {htmlGratis:false})} (preço anunciado: ${formatPreco(preco, {htmlGratis:false})})\nAguardando resposta do vendedor...`,
                    timestamp: new Date().toISOString()
                }]
            })
        });

        ordersCache.push(order);
        window.closeProductDetail();

        createPersistentNotification(`Oferta enviada para "${item.titulo}"!`, 'success');
        showToast('Oferta enviada ao vendedor!', 'success');
        window.renderOrderManagement('buyer');

    } catch (err) {
        console.error(err);
        showToast('Erro ao enviar oferta: ' + (err.message || 'Tente novamente.'), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
};

// ============================================
// CURTIR / LIKES
// ============================================

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

    const grid = document.getElementById('productsGrid');
    if (grid?.classList.contains('product-detail-active')) {
        window.refreshDetailLikeBtn(pid);
    } else {
        renderGrid(allProductsCache);
    }
};

// ============================================
// CANCELAR PEDIDO (comprador)
// ============================================

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

// ============================================
// CONFIRMAR RECEBIMENTO (comprador)
// ============================================

window.confirmReceipt = async function(orderId) {
    if (!confirm('Confirmar que recebeu o produto? Esta ação finalizará o pedido.')) return;
    try {
        const orderData = await supabaseFetch(`orders?id=eq.${orderId}&limit=1`);
        const order = orderData?.[0];

        await supabaseFetch(`orders?id=eq.${orderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'finished', updated_at: new Date().toISOString() })
        });

        if (order?.product_id) {
            await window.baixarEstoqueProduto(order.product_id, order.quantity || 1);
        }

        const chatData = await supabaseFetch(`chats?order_id=eq.${orderId}&limit=1`);
        const chat = chatData[0];
        if (chat) {
            chat.messages.push({ senderId: 'system', text: 'O comprador confirmou o recebimento. Compra finalizada!', timestamp: new Date().toISOString(), type: 'system' });
            await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        }
        showToast('Pedido finalizado!', 'success');
        window.loadChatMessages(orderId);
        window.openReviewModal(orderId, 'buyer_rates_seller');
    } catch { showToast('Erro ao confirmar recebimento.', 'error'); }
};

// ============================================
// CHECKOUT GLOBAL (placeholder)
// ============================================


// ============================================
// FUNÇÕES DE TELA (visualização de produto, etc.)
// ============================================

window.renderLikedProducts = function() {
    const grid = document.getElementById('productsGrid');
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    if (!likedProducts.length) {
        grid.innerHTML = '<div class="col-12 text-center py-5"><i class="bi bi-heartbreak fs-1 text-muted d-block mb-3"></i><h5>Nenhum produto curtido ainda.</h5></div>';
        grid.style.display = 'flex';
        grid.className = '';
        document.getElementById('gridTitle').textContent = 'Meus Curtidos';
        return;
    }
    const likedItems = allProductsCache.filter(p => likedProducts.includes(p.id));
    document.getElementById('gridTitle').textContent = 'Meus Curtidos';
    renderGrid(likedItems);
};

window.renderAccessHistory = function() {
    const grid = document.getElementById('productsGrid');
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    if (!accessHistory.length) {
        grid.innerHTML = '<div class="col-12 text-center py-5"><i class="bi bi-clock-history fs-1 text-muted d-block mb-3"></i><h5>Nenhum produto visitado recentemente.</h5></div>';
        grid.style.display = 'flex';
        grid.className = '';
        document.getElementById('gridTitle').textContent = 'Visitados Recentemente';
        return;
    }
    const historyItems = accessHistory.map(id => allProductsCache.find(p => p.id == id)).filter(Boolean);
    document.getElementById('gridTitle').textContent = 'Visitados Recentemente';
    renderGrid(historyItems);
};
