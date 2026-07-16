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
        document.getElementById('chatAttachPanel')?.classList.add('d-none');
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
    alert('Funcionalidade de Checkout Global em desenvolvimento. Por enquanto, utilize o botão "Solicitar Compra" em cada item.');
};
