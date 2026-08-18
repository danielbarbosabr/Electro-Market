// ---------------------------------------------------------------
// Cache local de grupos que o usuário já saiu (evita grupos fantasmas)
// ---------------------------------------------------------------
function getLeftGroupIds() {
    if (!getSavedUser()) return [];
    try { return JSON.parse(localStorage.getItem(`leftGroups_${getSavedUser().id}`) || '[]'); }
    catch { return []; }
}
function addLeftGroupLocally(chatId) {
    const ids = getLeftGroupIds();
    if (!ids.includes(chatId)) ids.push(chatId);
    try { localStorage.setItem(`leftGroups_${getSavedUser().id}`, JSON.stringify(ids)); } catch {}
}

// ============================================
// CHAT DIRETO (Conversas Livres — WhatsApp-like)
// ============================================

/** Marca no menu lateral (ícones da esquerda) qual seção está aberta agora,
 *  deixando ela verde e tirando o destaque das demais. */
window.setWaRailActive = function (key) {
    const map = { conversas: 'waRailConversas', comunidade: 'waRailCommunity', arquivadas: 'waRailArchived', grupos: 'waRailGroups', filmes: 'waRailFilmes' };
    document.querySelectorAll('.wa-rail-btn').forEach(btn => btn.classList.remove('active'));
    const btn = document.getElementById(map[key]);
    if (btn) btn.classList.add('active');
};

/**
 * Abre a tela de "Conversas" — lista de todos os usuários do sistema,
 * reutilizando o layout split-panel do whatsappOrdersView.
 */
window.renderDirectChats = async function(opts = {}) {
    const skipBoot = !!opts?.skipBoot;
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }

    window.exitWaOrdersView();
    window.setWaRailActive('conversas');
    document.getElementById('whatsappOrdersView')?.classList.remove('wa-community-mode', 'wa-filmes-mode');

    if (window.location.hash !== '#/chat/mensagem') {
        history.pushState(null, '', '#/chat/mensagem');
    }

    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('d-none');
    const gridMain = document.getElementById('productGridMain');
    if (gridMain) gridMain.classList.add('d-none');
    const grid = document.getElementById('productsGrid');
    if (grid) { grid.classList.remove('order-view-active'); grid.innerHTML = ''; grid.style.display = 'none'; }

    const waView = document.getElementById('whatsappOrdersView');
    const waList = document.getElementById('waContactList');
    const waTitle = document.getElementById('waSideTitle');
    const waSearch = document.getElementById('waContactSearch');

    if (waTitle) waTitle.textContent = 'Conversas';
    window.setWaSideActions?.(true);
    window.setWaSideProfile?.();
    document.getElementById('waSideMe')?.classList.remove('d-none');
    document.getElementById('waSideMyName')?.classList.remove('d-none');
    document.getElementById('waSideFullscreenBtn')?.classList.add('d-none');
    document.getElementById('waSideCloseBtn')?.classList.add('d-none');
    document.body.classList.remove('wa-fullscreen');
    window.updateWaEmptyState?.('conversas');
    if (waSearch) {
        waSearch.placeholder = 'Buscar pessoa...';
    }
    if (waView) {
        waView.classList.remove('d-none');
        waView.classList.remove('wa-order-mode');
    }
    document.body.classList.add('wa-locked', 'wa-fullscreen');

    window.closeWaChat();

    const bootScreen = document.getElementById('waBootScreen');
    const bootStartedAt = Date.now();
    if (bootScreen && !skipBoot) { bootScreen.classList.remove('d-none', 'wa-boot-fade-out'); }

    // Barra de progresso real: avança conforme cada consulta responde.
    const atualizarBootConversas = (pct) => {
        const fill = document.getElementById('waBootFill');
        const pctEl = document.getElementById('waBootPct');
        if (fill) fill.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
    };
    atualizarBootConversas(0);

    waList.innerHTML = '<div class="text-center py-5 w-100"><div class="spinner-border text-success"></div></div>';

    const hideBootScreen = async () => {
        if (!bootScreen || skipBoot) return;
        const elapsed = Date.now() - bootStartedAt;
        const remaining = Math.max(0, 1500 - elapsed);
        if (remaining) await new Promise(r => setTimeout(r, remaining));
        bootScreen.classList.add('wa-boot-fade-out');
        setTimeout(() => bootScreen.classList.add('d-none'), 400);
    };

    try {
        const allUsers = await supabaseFetch(`users?select=id,nome,avatar,last_seen&order=nome.asc`);
        atualizarBootConversas(50);
        const directChats = await supabaseFetch(`chats?order_id=is.null&select=*`);
        atualizarBootConversas(100);
        const leftIds = getLeftGroupIds();
        const myChats = directChats.filter(c =>
            c.participants && c.participants.some(p => String(p) === String(user.id)) &&
            c.messages && c.messages[0]?.type !== 'ticket_meta' &&
            !leftIds.includes(c.id)
        );

        const contactMap = {};
        myChats.forEach(chat => {
            if ((chat.messages?.[0]?.groupType === 'group') || (chat.participants && chat.participants.length > 2)) return;
            const otherId = chat.participants.find(p => String(p) !== String(user.id));
            if (otherId) contactMap[otherId] = chat;
        });

        const groupChats = myChats
            .filter(c => (c.messages?.[0]?.groupType === 'group' || (c.participants && c.participants.length > 2)) && c.seller_name !== 'Comunidade ElectroMarket' && c.id !== GLOBAL_GROUP_CHAT_ID)
            .map(chat => ({ chat, lastMsg: chat.messages?.[chat.messages.length - 1] }))
            .sort((a, b) => {
                const ta = a.lastMsg?.timestamp ? new Date(a.lastMsg.timestamp).getTime() : 0;
                const tb = b.lastMsg?.timestamp ? new Date(b.lastMsg.timestamp).getTime() : 0;
                return tb - ta;
            });

        const otherUsers = allUsers.filter(u => String(u.id) !== String(user.id) && String(u.id) !== AI_USER_ID);
        if (!otherUsers.length) {
            waList.innerHTML = `
                <div class="text-center py-5 px-3" style="color:#999;">
                    <i class="bi bi-people fs-1 d-block mb-2"></i>
                    <p class="small mb-0">Nenhum outro usuário encontrado.</p>
                </div>`;
            return;
        }

        const chatsWithMsgs = [];
        const archivedChats = [];
        const usersWithoutChat = [];

        otherUsers.forEach(u => {
            const chat = contactMap[u.id];
            if (chat) {
                const lastMsg = chat.messages?.[chat.messages.length - 1];
                const isArchived = chat.messages?.[0]?.archived === true;
                if (isArchived) {
                    archivedChats.push({ user: u, chat, lastMsg });
                } else {
                    chatsWithMsgs.push({ user: u, chat, lastMsg });
                }
            } else {
                usersWithoutChat.push(u);
            }
        });

        chatsWithMsgs.sort((a, b) => {
            const pa = a.chat.messages?.[0]?.pinned ? 1 : 0;
            const pb = b.chat.messages?.[0]?.pinned ? 1 : 0;
            if (pa !== pb) return pb - pa;
            const ta = a.lastMsg?.timestamp ? new Date(a.lastMsg.timestamp).getTime() : 0;
            const tb = b.lastMsg?.timestamp ? new Date(b.lastMsg.timestamp).getTime() : 0;
            return tb - ta;
        });
        archivedChats.sort((a, b) => {
            const ta = a.lastMsg?.timestamp ? new Date(a.lastMsg.timestamp).getTime() : 0;
            const tb = b.lastMsg?.timestamp ? new Date(b.lastMsg.timestamp).getTime() : 0;
            return tb - ta;
        });

        let html = '';

        // "Arquivadas" fica no topo, sempre recolhida — só mostra a lista ao
        // clicar no cabeçalho/ícone (igual ao WhatsApp).
        if (archivedChats.length > 0) {
            html += `<div class="wa-contact-section-header" style="cursor:pointer;user-select:none;" onclick="document.getElementById('archivedChatsList').classList.toggle('d-none');this.querySelector('.bi')?.classList.toggle('bi-chevron-down');this.querySelector('.bi')?.classList.toggle('bi-chevron-right');">
                <span><i class="bi bi-chevron-right me-1" style="font-size:0.7rem;"></i><i class="bi bi-archive me-1"></i>Arquivadas</span>
                <span class="small text-muted">${archivedChats.length}</span>
            </div>`;
            html += `<div id="archivedChatsList" class="d-none">`;
            html += archivedChats.map(({ user: u, chat, lastMsg }) => {
                const avatar = normalizeImageUrl(safeParseImages(u.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.nome || 'User')}&background=random&size=45`;
                const online = isRecentlyOnline(u.last_seen);
                const lastText = lastMsg?.type === 'image' ? '📷 Imagem' : lastMsg?.type === 'video' ? '🎬 Vídeo' : lastMsg?.type === 'location' ? '📍 Localização' : lastMsg?.type === 'file' ? '📄 Arquivo' : lastMsg?.type === 'thread_comment_ref' ? `💬 ${lastMsg.text || 'Comentário em Thread'}` : (lastMsg?.text || 'Iniciar conversa');
                const lastTime = lastMsg?.timestamp ? formatChatTime(lastMsg.timestamp) : '';
                const sentByMe = lastMsg && lastMsg.senderId && String(lastMsg.senderId) === String(user.id) && lastMsg.type !== 'system';
                const tickHtml = sentByMe
                    ? `<i class="bi ${lastMsg.visto ? 'bi-check-all is-read' : 'bi-check'} msg-tick"></i>`
                    : '';

                return `
                <div class="wa-contact" data-direct-chat-id="${chat.id}" data-contact-name="${(u.nome || '').toLowerCase()}" onclick="window.openDirectChat('${chat.id}')" style="opacity:0.65;">
                    <div style="position:relative;flex-shrink:0;">
                        <img src="${avatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&size=45'" style="width:50px;height:50px;border-radius:50%;object-fit:cover;">
                    </div>
                    <div class="wa-contact-textbox">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="wa-contact-name">${u.nome || 'Usuário'}</div>
                            <small style="white-space:nowrap;">${lastTime}</small>
                        </div>
                        <div class="wa-contact-text">${tickHtml}${truncateText(lastText, 40)}</div>
                    </div>
                </div>`;
            }).join('');
            html += `</div>`;
        }

        if (chatsWithMsgs.length > 0) {
            html += `<div class="wa-contact-section-header">Mensagens</div>`;
            html += chatsWithMsgs.map(({ user: u, chat, lastMsg }) => {
                const avatar = normalizeImageUrl(safeParseImages(u.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.nome || 'User')}&background=random&size=45`;
                const online = isRecentlyOnline(u.last_seen);
                const isPinned = chat.messages?.[0]?.pinned === true;
                const lastText = lastMsg?.type === 'image' ? '📷 Imagem' : lastMsg?.type === 'video' ? '🎬 Vídeo' : lastMsg?.type === 'location' ? '📍 Localização' : lastMsg?.type === 'file' ? '📄 Arquivo' : lastMsg?.type === 'thread_comment_ref' ? `💬 ${lastMsg.text || 'Comentário em Thread'}` : (lastMsg?.text || 'Iniciar conversa');
                const lastTime = lastMsg?.timestamp ? formatChatTime(lastMsg.timestamp) : '';
                const unread = (window.currentChat === chat.id) ? 0 : (chat.messages?.filter(m => m.senderId && String(m.senderId) !== String(user.id) && !m.visto).length || 0);
                const sentByMe = lastMsg && lastMsg.senderId && String(lastMsg.senderId) === String(user.id) && lastMsg.type !== 'system';
                const tickHtml = sentByMe
                    ? `<i class="bi ${lastMsg.visto ? 'bi-check-all is-read' : 'bi-check'} msg-tick"></i>`
                    : '';

                return `
                <div class="wa-contact${isPinned ? ' wa-contact-pinned' : ''}" data-direct-chat-id="${chat.id}" data-contact-name="${(u.nome || '').toLowerCase()}" onclick="window.openDirectChat('${chat.id}')">
                    <div style="position:relative;flex-shrink:0;">
                        <img src="${avatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&size=45'" style="width:50px;height:50px;border-radius:50%;object-fit:cover;">
                        <span class="presence-dot ${online ? 'online' : 'offline'}" style="width:12px;height:12px;border:2px solid #fff;"></span>
                    </div>
                    <div class="wa-contact-textbox">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="wa-contact-name">${isPinned ? '<i class="bi bi-pin-angle-fill me-1" style="font-size:0.7rem;color:#667781;"></i>' : ''}${u.nome || 'Usuário'}</div>
                            <small style="white-space:nowrap;">${lastTime}</small>
                        </div>
                        <div class="wa-contact-text" style="${unread ? 'font-weight:600;color:#111;' : ''}">${tickHtml}${truncateText(lastText, 40)}</div>
                    </div>
                    ${unread ? `<span class="wa-contact-badge">${unread}</span>` : ''}
                </div>`;
            }).join('');
        }

        if (groupChats.length > 0) {
            html += `<div class="wa-contact-section-header">Grupos</div>`;
            html += groupChats.map(({ chat, lastMsg }) => {
                const groupMeta = chat.messages?.[0]?.groupType === 'group' ? chat.messages[0] : {};
                const groupName = groupMeta.groupName || chat.seller_name || 'Grupo';
                const hasAvatar = !!groupMeta.groupAvatar;
                const avatarInner = hasAvatar
                    ? `<img src="${groupMeta.groupAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&size=45'">`
                    : `<i class="bi bi-people-fill wa-header-group-icon"></i>`;
                const lastSenderPrefix = (lastMsg && lastMsg.senderId && lastMsg.type !== 'system')
                    ? (String(lastMsg.senderId) === String(user.id) ? 'Você: ' : `${(lastMsg.senderName || 'Alguém').split(' ')[0]}: `)
                    : '';
                const lastText = lastMsg?.type === 'image' ? '📷 Imagem' : lastMsg?.type === 'video' ? '🎬 Vídeo' : lastMsg?.type === 'location' ? '📍 Localização' : lastMsg?.type === 'file' ? '📄 Arquivo' : (lastMsg?.text || 'Grupo criado');
                const lastTime = lastMsg?.timestamp ? formatChatTime(lastMsg.timestamp) : '';
                const unread = (window.currentChat === chat.id) ? 0 : (chat.messages?.filter(m => m.senderId && String(m.senderId) !== String(user.id) && !m.visto).length || 0);

                return `
                <div class="wa-contact" data-direct-chat-id="${chat.id}" data-contact-name="${groupName.toLowerCase()}" data-is-group="true" onclick="window.openDirectChat('${chat.id}')">
                    <div style="position:relative;flex-shrink:0;">
                        <div class="wa-avatar-circle" style="width:50px;height:50px;">
                            ${avatarInner}
                        </div>
                        ${hasAvatar ? '<span class="wa-group-badge"><i class="bi bi-people-fill"></i></span>' : ''}
                    </div>
                    <div class="wa-contact-textbox">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="wa-contact-name">${groupName}</div>
                            <small style="white-space:nowrap;">${lastTime}</small>
                        </div>
                        <div class="wa-contact-text" style="${unread ? 'font-weight:600;color:#111;' : ''}">${truncateText(lastSenderPrefix + lastText, 40)}</div>
                    </div>
                    ${unread ? `<span class="wa-contact-badge">${unread}</span>` : ''}
                </div>`;
            }).join('');
        }

        if (usersWithoutChat.length > 0) {
            html += `<div class="wa-contact-section-header">${chatsWithMsgs.length > 0 ? 'Outros Usuários' : 'Todos os Usuários'}</div>`;
            html += usersWithoutChat.map(u => {
                const avatar = normalizeImageUrl(safeParseImages(u.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.nome || 'User')}&background=random&size=45`;
                const online = isRecentlyOnline(u.last_seen);

                return `
                <div class="wa-contact" data-contact-name="${(u.nome || '').toLowerCase()}" onclick="window.startDirectChat('${u.id}')">
                    <div style="position:relative;flex-shrink:0;">
                        <img src="${avatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&size=45'" style="width:50px;height:50px;border-radius:50%;object-fit:cover;">
                        <span class="presence-dot ${online ? 'online' : 'offline'}" style="width:12px;height:12px;border:2px solid #fff;"></span>
                    </div>
                    <div class="wa-contact-textbox">
                        <div class="wa-contact-name">${u.nome || 'Usuário'}</div>
                        <div class="wa-contact-text">Iniciar conversa</div>
                    </div>
                </div>`;
            }).join('');
        }

        waList.innerHTML = html || `
            <div class="text-center py-5 px-3" style="color:#999;">
                <i class="bi bi-people fs-1 d-block mb-2"></i>
                <p class="small mb-0">Nenhum usuário encontrado.</p>
            </div>`;

        window.closeMobileMenu();
        await hideBootScreen();
        if (opts.openChatId) {
            setTimeout(() => window.openDirectChat(opts.openChatId), 300);
        }
    } catch (e) {
        console.error('Erro ao carregar conversas:', e);
        atualizarBootConversas(100);
        waList.innerHTML = '<div class="text-center py-5" style="color:#999;"><h6>Erro ao carregar conversas.</h6></div>';
        await hideBootScreen();
        if (opts.openChatId) {
            setTimeout(() => window.openDirectChat(opts.openChatId), 600);
        }
    }
};

/**
 * Mostra/esconde os botões de "Nova conversa" e menu (⋮) no cabeçalho da lista lateral.
 * Só fazem sentido na aba "Conversas" (chat livre), não em "Minhas Vendas/Compras".
 */
/**
 * Preenche o avatar do próprio usuário no cabeçalho da lista lateral (estilo WhatsApp Web),
 * clicável para abrir a edição do perfil.
 */
window.toggleWaChatFullscreen = function() {
    const btn = document.getElementById('waSideFullscreenBtn');
    const isFull = document.body.classList.toggle('wa-fullscreen');
    if (btn) {
        btn.innerHTML = isFull ? '<i class="bi bi-fullscreen-exit"></i>' : '<i class="bi bi-arrows-fullscreen"></i>';
        btn.title = isFull ? 'Sair da tela cheia' : 'Tela cheia';
    }
};

window.updateWaEmptyState = function(type) {
    const el = document.getElementById('waEmptyState');
    if (!el) return;
    if (type === 'conversas') {
        el.innerHTML = `
            <div class="wa-empty-illustration">
                <img src="https://stories.freepiklabs.com/storage/11989/Hacker-01.svg" alt="ElectroMarket" class="wa-empty-img" loading="lazy" referrerpolicy="no-referrer">
            </div>
            <p class="wa-empty-title">ElectroMarket</p>
            <p class="wa-empty-sub">Envie e receba mensagens direto por aqui.<br>Selecione uma conversa ao lado para começar.</p>`;
    } else if (type === 'buyer') {
        el.innerHTML = `<i class="bi bi-bag-check"></i><p class="wa-empty-sub">Nenhuma conversa de compra selecionada.<br>Escolha um pedido ao lado para conversar.</p>`;
    } else if (type === 'seller') {
        el.innerHTML = `<i class="bi bi-shop"></i><p class="wa-empty-sub">Nenhuma conversa de venda selecionada.<br>Escolha um pedido ao lado para conversar.</p>`;
    }
};

window.setWaSideProfile = function() {
    const img = document.getElementById('waSideMyAvatar');
    const railImg = document.getElementById('waRailAvatar');
    const nameEl = document.getElementById('waSideMyName');
    const user = getSavedUser();
    if (!user) return;
    const avatar = normalizeImageUrl(safeParseImages(user.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.nome || 'User')}&background=random&size=64`;
    if (img) img.src = avatar;
    if (railImg) railImg.src = avatar;
    if (nameEl) nameEl.textContent = user.nome || '';
};

window.setWaSideActions = function(show) {
    document.getElementById('waNewChatBtn')?.classList.toggle('d-none', !show);
    document.getElementById('waHeaderSearchBtn')?.classList.toggle('d-none', !show);
    document.getElementById('waSideMenuWrap')?.classList.toggle('d-none', !show);
    // A barra de busca fica sempre visível na tela de Conversas Recentes.
    document.getElementById('waSideSearchBar')?.classList.remove('d-none');
};

/** Ícone de lupa no cabeçalho: abre/fecha a busca ao lado dele (estilo WhatsApp Web). */

/** Item do menu (⋮): foca a busca para o usuário iniciar uma nova conversa */

/** Botão "Arquivadas" do menu lateral: mostra/esconde a lista de conversas arquivadas
 *  e reflete isso no destaque verde do ícone. */
window.toggleArchivedSection = function() {
    const list = document.getElementById('archivedChatsList');
    if (!list) { showToast('Nenhuma conversa arquivada.', 'info'); return; }
    const willShow = list.classList.contains('d-none');
    list.classList.toggle('d-none', !willShow);
    if (willShow) {
        window.setWaRailActive('arquivadas');
        list.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        window.setWaRailActive('conversas');
    }
};

/**
 * Filtro de busca em tempo real da lista lateral (estilo WhatsApp Web), usado
 * tanto na aba "Conversas" (contatos/grupos) quanto em "Minhas Vendas/Compras"
 * (pedidos). Funciona a cada tecla digitada (oninput), sem precisar apertar Enter.
 * Cada item da lista (.wa-contact) expõe seu texto pesquisável via
 * data-contact-name (nome do contato/grupo, ou nome+produto no caso de pedidos).
 */
window.filterWaContacts = function(query) {
    const q = (query || '').trim().toLowerCase();
    const list = document.getElementById('waContactList');
    if (!list) return;

    let anyVisible = false;
    list.querySelectorAll('.wa-contact').forEach(el => {
        const name = el.dataset.contactName || el.querySelector('.wa-contact-name')?.textContent?.toLowerCase() || '';
        const show = !q || name.includes(q);
        el.style.display = show ? '' : 'none';
        if (show) anyVisible = true;
    });
    list.querySelectorAll('.wa-contact-section-header').forEach(el => {
        el.style.display = q ? 'none' : '';
    });

    let emptyMsg = document.getElementById('directSearchEmptyMsg');
    if (!anyVisible && q) {
        if (!emptyMsg) {
            emptyMsg = document.createElement('div');
            emptyMsg.id = 'directSearchEmptyMsg';
            emptyMsg.className = 'text-center py-4 px-3';
            emptyMsg.style.color = '#999';
            emptyMsg.innerHTML = '<i class="bi bi-search fs-4 d-block mb-2"></i><p class="small mb-0">Nenhum resultado encontrado.</p>';
            list.appendChild(emptyMsg);
        }
    } else if (emptyMsg) {
        emptyMsg.remove();
    }
};

/** Alias mantido por compatibilidade — usa o mesmo filtro em tempo real acima. */
window.filterDirectContacts = function(query) {
    window.filterWaContacts(query);
};

window.startDirectChat = async function(targetUserId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }

    showToast('Abrindo conversa...', 'info', 1500);

    try {
        const directChats = await supabaseFetch(`chats?order_id=is.null&select=*`);
        const existing = directChats.find(c =>
            c.order_id === null &&
            c.participants && c.participants.length === 2 &&
            c.participants.some(p => String(p) === String(user.id)) && c.participants.some(p => String(p) === String(targetUserId)) &&
            c.messages && c.messages[0]?.type !== 'ticket_meta'
        );

        if (existing) {
            window.openDirectChat(existing.id);
            return;
        }

        const targetData = String(targetUserId) === AI_USER_ID
            ? [AI_USER_DATA]
            : await supabaseFetch(`users?select=nome,avatar&id=eq.${targetUserId}&limit=1`);
        const target = targetData?.[0];
        const targetName = target?.nome || 'Usuário';

        const newChat = {
            id: crypto.randomUUID(),
            order_id: null,
            buyer_id: user.id,
            seller_id: String(targetUserId) === AI_USER_ID ? user.id : targetUserId,
            buyer_name: user.nome,
            seller_name: targetName,
            participants: [user.id, targetUserId],
            messages: [
                { type: 'direct_chat_meta', createdBy: user.id, createdByName: user.nome },
                { senderId: user.id, senderName: user.nome, text: `Olá! 👋`, timestamp: new Date().toISOString(), type: 'message' }
            ]
        };

        await supabaseFetch('chats', { method: 'POST', body: JSON.stringify(newChat) });

        await window.renderDirectChats({ skipBoot: true });
        if (String(targetUserId) === AI_USER_ID) {
            setTimeout(async () => {
                await window.openDirectChat(newChat.id);
                _respondIfAiChat(newChat);
            }, 500);
        } else {
            setTimeout(() => window.openDirectChat(newChat.id), 300);
        }
    } catch (e) {
        console.error('Erro ao criar conversa:', e);
        showToast('Erro ao abrir conversa.', 'error');
    }
};

// -------- GRUPO GERAL: conversa coletiva única com todos os usuários --------
// ---------------------------------------------------------------
// Sem fluxo de criação/gestão: o ícone de grupo abre direto uma única
// conversa compartilhada (id fixo), incluindo automaticamente todos os
// usuários cadastrados no sistema.
// ---------------------------------------------------------------

let _selectedMembers = {};
let _allUsersCache = [];

// ---------------------------------------------------------------
// GRUPO GERAL ÚNICO: garante que a linha do grupo exista (id fixo) e
// a mantém com todos os usuários como participantes automaticamente.
// ---------------------------------------------------------------

const GLOBAL_GROUP_CHAT_ID = 'grupo_global_electromarket';
const GLOBAL_GROUP_NAME = 'Grupo Geral ElectroMarket';

/** Avatar padrão do grupo (ícone de pessoas em círculo verde) para os casos em
 *  que o grupo não tem foto própria — usado nos balões quando não há avatar do
 *  remetente (ex.: remetente removido). Os avatares do header/lista/painel usam
 *  a classe CSS .wa-header-group-icon. */
const GROUP_PEOPLE_ICON_SRC = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="40" height="40">' +
    '<circle cx="8" cy="8" r="8" fill="#00A884"/>' +
    '<path fill="#fff" d="M16 7a5 5 0 0 1-4 4.9v.03a6 6 0 0 1 3 5.2V17h3v-1a3 3 0 0 0-2-2.8Zm-8 1.8a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-1.3v.087A3.5 3.5 0 1 0 12 3.155 5 5 0 0 1 16 7.5ZM8 11a5.5 5.5 0 0 0-5.5 5.5V17h11v-.5A5.5 5.5 0 0 0 8 11Z"/></svg>'
);

async function ensureGlobalGroup() {
  const user = getSavedUser();
  if (!user) return null;

  let chat = null;
  try {
    const chatResult = await supabaseFetch(`chats?id=eq.${GLOBAL_GROUP_CHAT_ID}&limit=1`);
    chat = chatResult?.[0];
  } catch (e) { /* tenta criar abaixo */ }

  const allUsers = await supabaseFetch('users?select=id,nome&order=nome.asc');
  const allIds = (allUsers || []).map(u => String(u.id));

  if (!chat) {
    const now = new Date().toISOString();
    const meta = {
      type: 'direct_chat_meta',
      createdBy: user.id,
      createdByName: user.nome,
      groupType: 'group',
      groupName: GLOBAL_GROUP_NAME,
      groupDescription: '',
      groupAvatar: '',
      groupCreatedAt: now,
      groupAdmins: [],
      groupSettings: {}
    };
    const row = {
      id: GLOBAL_GROUP_CHAT_ID,
      order_id: null,
      buyer_id: user.id,
      seller_id: user.id,
      buyer_name: user.nome,
      seller_name: GLOBAL_GROUP_NAME,
      participants: allIds,
      messages: [meta]
    };
    try {
      await supabaseFetch('chats', { method: 'POST', body: JSON.stringify(row) });
    } catch (e) {
      // Corrida entre dois usuários abrindo ao mesmo tempo: se alguém já criou, usa a linha existente.
      const chatResult = await supabaseFetch(`chats?id=eq.${GLOBAL_GROUP_CHAT_ID}&limit=1`);
      chat = chatResult?.[0];
      if (!chat) throw e;
    }
    return GLOBAL_GROUP_CHAT_ID;
  }

  // Grupo já existe: garante que usuários novos entrem automaticamente.
  const current = (chat.participants || []).map(String);
  const missing = allIds.filter(id => !current.includes(id));
  if (missing.length) {
    const participants = Array.from(new Set([...current, ...allIds]));
    chat.participants = participants;
    const meta = chat.messages?.[0];
    if (meta && typeof meta === 'object' && meta.type === 'direct_chat_meta') {
      meta.groupType = 'group';
      meta.groupName = meta.groupName || GLOBAL_GROUP_NAME;
      meta.groupSettings = meta.groupSettings || {};
      chat.messages[0] = meta;
    }
    await supabaseFetch(`chats?id=eq.${GLOBAL_GROUP_CHAT_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ participants, messages: chat.messages, seller_name: chat.seller_name || GLOBAL_GROUP_NAME })
    });
  }

  return GLOBAL_GROUP_CHAT_ID;
}

/** Abre (criando se preciso) a conversa coletiva única com todos os usuários */
window.openGlobalGroupChat = async function () {
  const user = getSavedUser();
  if (!user) { showToast('Faça login!', 'warning'); return; }

  try {
    const chatId = await ensureGlobalGroup();
    if (!chatId) return;
    await window.renderDirectChats({ skipBoot: true });
    setTimeout(() => window.openDirectChat(chatId), 250);
  } catch (e) {
    console.error('Erro ao abrir o grupo geral:', e);
    showToast('Erro ao abrir o grupo geral.', 'error');
  }
};

// ---------------------------------------------------------------
// 3. NOVA CONVERSA (individual) — modal de seleção de pessoa
// ---------------------------------------------------------------

/** Abre o modal para iniciar nova conversa individual */
window.openNewConversationModal = async function () {
  const user = getSavedUser();
  if (!user) { showToast('Faça login!', 'warning'); return; }

  const modalEl = document.getElementById('newGroupModal');
  if (!modalEl) return;
  modalEl.dataset.mode = 'single';

  // Adapta UI para modo single
  document.getElementById('newGroupModalTitle').textContent = 'Nova conversa';
  document.getElementById('newGroupModalSubtitle').textContent = 'Selecione uma pessoa para conversar';
  document.getElementById('newGroupParticipantTitle').textContent = 'Selecionar pessoa';
  document.getElementById('newGroupSelectLabel').textContent = 'Escolha um usuário';
  document.getElementById('newGroupCreateBtn').innerHTML = '<i class="bi bi-chat-dots me-2"></i>Conversar';

  _selectedMembers = {};

  const searchInput = document.getElementById('newGroupMemberSearch');
  if (searchInput) searchInput.value = '';

  const modal = window.bootstrap ? bootstrap.Modal.getOrCreateInstance(modalEl) : null;
  modal?.show();

  const list = document.getElementById('newGroupMemberList');
  if (list) list.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm text-success"></div></div>';

  try {
    const allUsers = await supabaseFetch('users?select=id,nome,avatar&order=nome.asc');
    _allUsersCache = allUsers.filter(u => String(u.id) !== String(user.id));
    _renderMemberList();
  } catch (e) {
    if (list) list.innerHTML = '<div class="text-center py-4 text-muted small">Erro ao carregar pessoas.</div>';
  }
};

function _renderMemberList(query) {
  const list = document.getElementById('newGroupMemberList');
  if (!list) return;
  const modalEl = document.getElementById('newGroupModal');
  const isSingle = modalEl?.dataset?.mode === 'single';
  const q = (query || '').trim().toLowerCase();
  const users = _allUsersCache.filter(u => !q || (u.nome || '').toLowerCase().includes(q));

  if (!users.length) {
    list.innerHTML = '<div class="text-center py-4 text-muted small">Ninguém encontrado.</div>';
    return;
  }

  list.innerHTML = users.map(u => {
    const checked = !!_selectedMembers[u.id];
    return `
    <div class="ca-cat-list-item${checked ? ' ca-cat-list-item-selected' : ''}" onclick="window.toggleNewGroupMember('${u.id}')">
      <div class="d-flex align-items-center gap-2">
        <div style="width:8px;height:8px;border-radius:50%;background:#00A884;flex-shrink:0;${checked ? '' : 'display:none;'}"></div>
        ${u.nome || 'Usuário'}
      </div>
    </div>`;
  }).join('');

  _updateSelectedCount();
}

function _updateSelectedCount() {
  const count = Object.keys(_selectedMembers).length;
  const label = document.getElementById('newGroupSelectedCount');
  if (label) label.textContent = count > 0
    ? `Usuário selecionado.`
    : 'Nenhum usuário selecionado.';
  const btn = document.getElementById('newGroupCreateBtn');
  if (btn) btn.disabled = count < 1;
}

/** Filtro de busca na lista de pessoas */
window.filterNewGroupMembers = function (query) {
  _renderMemberList(query);
};

/** Alterna seleção (conversa individual: só uma pessoa por vez) */
window.toggleNewGroupMember = function (userId) {
  if (_selectedMembers[userId]) {
    delete _selectedMembers[userId];
  } else {
    _selectedMembers = {};
    _selectedMembers[userId] = true;
  }
  const searchInput = document.getElementById('newGroupMemberSearch');
  _renderMemberList(searchInput?.value || '');
};

async function _uploadToImgur(file) {
  const clientId = window.CONFIG?.IMGUR_CLIENT_ID || window.CONFIG_LOCAL_FALLBACK?.IMGUR_CLIENT_ID || '546c25a59c58ad7';
  try {
    const fd = new FormData();
    fd.append('image', file, file.name);
    const res = await fetch('https://api.imgur.com/3/image', {
      method: 'POST',
      headers: { Authorization: `Client-ID ${clientId}` },
      body: fd
    });
    const json = await res.json();
    if (json?.success && json?.data?.link) return json.data.link;
  } catch (e) { /* fallback silencioso */ }
  return null;
}

/** Cria conversa individual conforme o modo do modal (só existe o modo single) */
window.createGroupChat = async function () {
  const modalEl = document.getElementById('newGroupModal');
  const mode = modalEl?.dataset?.mode || 'single';

  const memberIds = Object.keys(_selectedMembers);
  if (!memberIds.length) { showToast('Selecione uma pessoa.', 'warning'); return; }

  const modal = window.bootstrap ? bootstrap.Modal.getInstance(modalEl) : null;
  if (modal) {
    modal.hide();
    modalEl.addEventListener('hidden.bs.modal', function onHidden() {
      modalEl.removeEventListener('hidden.bs.modal', onHidden);
      document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('padding-right');
      window.startDirectChat(memberIds[0]);
    });
  } else {
    window.startDirectChat(memberIds[0]);
  }
};

// ---------------------------------------------------------------
// 4. INFORMAÇÕES DO GRUPO — REMOVIDO
//     O grupo geral não tem tela de informações/gestão; os dados do
//     grupo são vistos no painel de participantes do próprio chat.
// ---------------------------------------------------------------

// (seção 4.5, 5, 6, 7 e 8 removidas: sem criação, edição, admins,
//  participantes, sair/excluir grupo — tudo substituído pelo grupo geral único)

// ---------------------------------------------------------------
// 11. LEITURA DE MENSAGENS EM GRUPO (read receipts)
// ---------------------------------------------------------------

/**
 * Marca mensagens como lidas para grupos. Para cada mensagem não lida
 * de outro remetente, adiciona o ID do usuário logado ao array `readBy`.
 */
window.markGroupMessagesRead = async function (chat) {
  const user = getSavedUser();
  if (!user || !chat || !chat.messages) return false;

  let changed = false;
  const now = new Date().toISOString();

  chat.messages.forEach(msg => {
    if (msg.type === 'system' || msg.type === 'direct_chat_meta') return;
    if (String(msg.senderId) === String(user.id)) return;
    if (msg.readBy && msg.readBy.some(r => String(r) === String(user.id))) return;

    if (!msg.readBy) msg.readBy = [];
    msg.readBy.push(user.id);
    changed = true;
  });

  if (changed) {
    try {
      await supabaseFetch(`chats?id=eq.${chat.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ messages: chat.messages })
      });
      // Atualiza badge
      const contactEl = document.querySelector(`.wa-contact[data-direct-chat-id="${chat.id}"]`);
      if (contactEl) {
        contactEl.querySelector('.wa-contact-badge')?.remove();
        const textEl = contactEl.querySelector('.wa-contact-text');
        if (textEl) textEl.style.removeProperty('font-weight');
      }
    } catch (e) { /* silencioso */ }
  }

  return changed;
};

// ---------------------------------------------------------------
// 12. ESTATÍSTICAS DE LEITURA (exibe "Visto por X pessoas")
// ---------------------------------------------------------------


window._groupUsersCache = {};

// Patches loadDirectChatMessages to add group read receipts
(function patchGroupReadReceipts() {
  const origLoad = window.loadDirectChatMessages;
  if (typeof origLoad !== 'function') return;

  window.loadDirectChatMessages = async function (chatId, silent = false) {
    await origLoad(chatId, silent);
    try {
      const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
      const chat = chatResult?.[0];
      if (chat && (chat.messages?.[0]?.groupType === 'group' || (chat.participants && chat.participants.length > 2))) {
        await window.markGroupMessagesRead(chat);
      }
    } catch (e) { /* silencioso */ }
  };
})();

/** Abre a Comunidade ElectroMarket (antigo "Chat Geral"). Na primeira vez, cria o
 *  grupo já com todo mundo cadastrado; nas próximas, só garante que usuários novos
 *  (cadastrados depois) entrem também.
 *  Não usa um id fixo — identifica o grupo por order_id nulo + seller_name dentre os
 *  nomes conhecidos (atual + nome antigo "Chat Geral", para não duplicar o grupo em
 *  bases que já tinham o grupo criado antes da renomeação), reaproveitando as colunas
 *  que os chats diretos já usam (sem precisar de coluna nova). */
/** Abre conversa com o assistente DuckDuckGo */


/** Mostra/esconde (e monta, na primeira vez) o painel com a lista de participantes
 *  de um grupo, integrado ao próprio chat — sem precisar abrir modal. */
window.toggleDirectChatParticipants = async function(chatId, forceReload) {
    const panel = document.getElementById(`dparticipants_${chatId}`);
    if (!panel) return;

    if (forceReload) {
        panel.classList.remove('d-none');
    } else {
        const willShow = panel.classList.contains('d-none');
        panel.classList.toggle('d-none');
        if (!willShow) return;
    }

    panel.innerHTML = '<div class="text-center py-2"><div class="spinner-border spinner-border-sm text-success"></div></div>';

    try {
        const chatData = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
        const chat = chatData?.[0];
        const participantIds = (chat?.participants || []).map(String).filter(id => String(id) !== AI_USER_ID);

        if (!participantIds.length) {
            panel.innerHTML = '<div class="small text-muted px-1">Nenhum participante encontrado.</div>';
            return;
        }

        const idFilter = participantIds.map(id => `"${id}"`).join(',');
        const users = await supabaseFetch(`users?select=id,nome,avatar,tipo&id=in.(${idFilter})`);
        const usersById = {};
        (users || []).forEach(u => { usersById[String(u.id)] = u; });

        const directMeta = chat.messages?.[0]?.type === 'direct_chat_meta' ? chat.messages[0] : null;
        const me = getSavedUser();

        const groupName = directMeta?.groupName || chat.seller_name || 'Grupo';
        const groupAvatarHtml = directMeta?.groupAvatar
            ? `<img src="${directMeta.groupAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(groupName)}&background=00A884&color=fff&bold=true'">`
            : `<div class="wa-header-group-icon" style="width:44px;height:44px;flex-shrink:0;"><i class="bi bi-people-fill"></i></div>`;

        const groupHeaderHtml = `
        <div class="chat-group-info-header" id="dGroupInfoView_${chatId}">
            ${groupAvatarHtml}
            <div class="chat-group-info-name">${groupName}</div>
        </div>`;

        const rows = participantIds.map(id => {
            const u = usersById[id];
            const isAI = id === AI_USER_ID;
            const nome = u?.nome || (isAI ? 'DuckDuckGo' : 'Usuário removido');
            const avatarUrl = isAI
                ? AI_USER_DATA.avatar
                : (normalizeImageUrl(safeParseImages(u?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(nome)}&background=random&color=fff`);
            const isMe = String(id) === String(me?.id);
            const tipo = u?.tipo || 'CLIENTE';
            const tipoLabel = tipo === 'ADMIN' ? 'Administrador' : (tipo === 'VENDEDOR' ? 'Vendedor' : 'Cliente');

            return `<div class="chat-participant-row">
                <img src="${avatarUrl}" referrerpolicy="no-referrer" style="cursor:pointer;" onclick="window.openImageFull('${avatarUrl.replace(/'/g, "\\'")}')" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(nome)}&background=random&color=fff'">
                <div class="chat-participant-info">
                    <strong>${nome}${isMe ? ' (você)' : ''}</strong>
                    <small>${tipoLabel}</small>
                </div>
            </div>`;
        }).join('');

        panel.innerHTML = `${groupHeaderHtml}<div class="small fw-bold mb-1 mt-2" style="color:#667781;"><i class="bi bi-people-fill me-1"></i>${participantIds.length} participantes</div>${rows}`;
    } catch (e) {
        console.error('Erro ao carregar participantes:', e);
        panel.innerHTML = '<div class="small text-danger px-1">Erro ao carregar participantes.</div>';
    }
};

window.openDirectChat = async function(chatId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }
    // Saindo das Threads (Comunidade) para uma conversa privada: restaura a
    // lateral de contatos, que fica escondida enquanto a Comunidade está aberta.
    document.getElementById('whatsappOrdersView')?.classList.remove('wa-community-mode', 'wa-filmes-mode');
    if (window.location.hash !== '#/chat/mensagem_' + chatId) {
        history.pushState(null, '', '#/chat/mensagem_' + chatId);
    }
    if (window.currentChat !== chatId) window.lastChatSignature = null;
    window.currentChat = chatId;
    window.currentPostReplyContext = null;

    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Conversa não encontrada.', 'error'); return; }

        const isGroup = Array.isArray(chat.participants) && chat.participants.length > 2;
        const otherId = isGroup ? null : chat.participants.find(p => String(p) !== String(user.id));
        let otherName = 'Usuário';
        let otherAvatar = `https://ui-avatars.com/api/?name=User&background=random&size=40`;
        let otherLastSeen = null;
        let otherEmail = '';
        let otherPhone = '';

        if (isGroup) {
            const groupMeta = chat.messages?.[0]?.groupType === 'group' ? chat.messages[0] : {};
            otherName = groupMeta.groupName || chat.seller_name || 'Grupo';
            otherAvatar = groupMeta.groupAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(otherName)}&background=00A884&color=fff&size=40&bold=true`;
        } else if (otherId) {
            if (String(otherId) === AI_USER_ID) {
                otherName = 'DuckDuckGo';
                otherAvatar = 'https://tse1.mm.bing.net/th/id/OIP.RWeIgcAIhZe99xrj3sLLQAHaHa?r=0&rs=1&pid=ImgDetMain&o=7&rm=3';
                otherEmail = '';
                otherPhone = '';
            } else {
                const otherData = await supabaseFetch(`users?select=nome,avatar,last_seen,email,telefone&id=eq.${otherId}&limit=1`);
                const other = otherData?.[0];
                if (other) {
                    otherName = other.nome || otherName;
                    const realAvatar = normalizeImageUrl(safeParseImages(other.avatar)[0]);
                    if (realAvatar) otherAvatar = realAvatar;
                    otherLastSeen = other.last_seen;
                    otherEmail = other.email || '';
                    otherPhone = other.telefone || '';
                }
            }
        }

        // Comunidade: configura header
        if (chat.seller_name === 'Comunidade ElectroMarket' || chat.buyer_name === 'Comunidade ElectroMarket') {
            otherName = 'Comunidade ElectroMarket';
            otherAvatar = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        }
        const msgsId = `dmsgs_${chatId}`;
        const isCommunity = chat.seller_name === 'Comunidade ElectroMarket' || chat.buyer_name === 'Comunidade ElectroMarket';
        const inputId = `dinput_${chatId}`;
        const previewId = `dpreview_${chatId}`;
        const attachId = `dattachPanel_${chatId}`;
        const attachLinkId = `dattachLink_${chatId}`;
        const statusBarId = `dstatusBar_${chatId}`;

        const partnerDotClass = isGroup ? '' : (isRecentlyOnline(otherLastSeen) ? 'online' : 'offline');

            const html = window.renderChatContainer({
                chatId,
                chat,
                partner: { name: otherName, avatar: otherAvatar },
                msgsId,
                inputId,
                previewId,
                attachPanelId: attachId,
                attachLinkId,
                participantsId: `dparticipants_${chatId}`,
                statusBarId,
                onToggleParticipants: isGroup ? `window.toggleDirectChatParticipants('${chatId}')` : '',
                onCall: (!isGroup && otherId && String(otherId) !== AI_USER_ID) ? `window.callChatContact('${otherPhone}', '${(otherName || '').replace(/\'/g, "\\\\\'")}')` : '',
                onSend: 'window.sendDirectChatMessage(event)',
                onTyping: `window.notifyDirectChatTyping('${chatId}')`,
                onBack: 'window.closeDirectChat()',
                onClose: 'window.closeDirectChat()',
                onViewProfile: isGroup ? '' : `window.viewDirectChatPartnerProfile('${otherId}')`,
                onPin: `window.pinDirectChat('${chatId}')`,
                onMute: `window.muteDirectChat('${chatId}')`,
                onArchive: `window.archiveDirectChat('${chatId}')`,
                onBlock: isGroup ? '' : `window.blockDirectChatUser('${otherId}')`,
                onToggleAttachPanel: 'window.toggleChatAttachPanel()',
                onConfirmAttach: 'window.confirmDirectChatAttach()',
                onSendLocation: 'window.sendDirectChatLocation',
                onSendFile: 'window.sendDirectChatImageFile',
                showBackBtn: true,
                showCloseBtn: false,
                showDeleteBtn: true,
                onDelete: `window.deleteDirectChat('${chatId}')`,
                showProductSummary: false,
                showAttach: true,
                headerSubtitle: '',
                statusInfo: null,
                isGroupChat: isGroup,
                isDirectChat: true,
                onClearChat: `window.clearDirectChat('${chatId}')`,
            });

        const panel = document.getElementById('waChatActive');
        if (panel) {
            panel.innerHTML = html;
            panel.classList.remove('d-none', 'tw-chat-community', 'community-active');
            panel.classList.add('d-flex');

            // Grupo geral (sem foto própria): ícone de pessoas no lugar do avatar
            if (isGroup && !isCommunity && !chat.messages?.[0]?.groupAvatar) {
                const avatarWrap = panel.querySelector('.chat-header-avatar-wrap');
                if (avatarWrap) {
                    const img = avatarWrap.querySelector('img');
                    if (img) img.style.display = 'none';
                    let icon = avatarWrap.querySelector('.wa-header-group-icon');
                    if (!icon) {
                        icon = document.createElement('div');
                        icon.className = 'wa-header-group-icon';
                        icon.innerHTML = '<i class="bi bi-people-fill"></i>';
                        avatarWrap.insertBefore(icon, avatarWrap.firstChild);
                    }
                }
            }

            // Comunidade: remove header, troca avatar e substitui input por composer
            if (chat.seller_name === 'Comunidade ElectroMarket' || chat.buyer_name === 'Comunidade ElectroMarket') {
                panel.classList.add('tw-chat-community', 'community-active');
                const avatarWrap = panel.querySelector('.chat-header-avatar-wrap');
                if (avatarWrap) {
                    const img = avatarWrap.querySelector('img');
                    if (img) img.style.display = 'none';
                    let icon = avatarWrap.querySelector('.wa-header-group-icon');
                    if (!icon) {
                        icon = document.createElement('div');
                        icon.className = 'wa-header-group-icon';
                        icon.innerHTML = '<i class="bi bi-people-fill"></i>';
                        avatarWrap.insertBefore(icon, avatarWrap.firstChild);
                    }
                }
                // Substitui input bar pelo composer estilo Facebook
                const inputBar = panel.querySelector('.chat-input-bar');
                if (inputBar) {
                    const myAvatar = normalizeImageUrl(safeParseImages(user.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.nome || 'User')}&background=1d9bf0&color=fff`;
                    inputBar.innerHTML = `
                        <div class="tw-composer tw-composer-inline">
                            <img class="tw-avatar" src="${myAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=1d9bf0&color=fff'">
<textarea id="dcomposer_${chatId}" class="tw-composer-textarea" placeholder="Quais são as novidades?" rows="1" oninput="this.style.height='auto';this.style.height=(this.scrollHeight)+'px'"></textarea>
                            <div id="dcomposerPreview_${chatId}" class="tw-composer-preview d-none"></div>
                            <label class="tw-icon-btn" title="Adicionar imagem" style="cursor:pointer;">
                                <i class="bi bi-image"></i>
                                <input type="file" accept="image/*" class="d-none" onchange="window.communityPickImageFromChat('${chatId}', this)">
                            </label>
                            <button type="button" class="tw-post-btn" onclick="window.submitCommunityPostFromChat('${chatId}')">Postar</button>
                        </div>`;
                }
            }
        }

        if (partnerDotClass) {
            document.getElementById(`${msgsId}Dot`)?.classList.add(partnerDotClass);
        }

        window._chatActiveElements = {
            input: document.getElementById(inputId),
            container: document.getElementById(msgsId),
            statusBar: document.getElementById(statusBarId),
            attachPanel: document.getElementById(attachId),
            preview: document.getElementById(previewId)
        };

        document.getElementById('waEmptyState')?.classList.add('d-none');
        document.getElementById('whatsappOrdersView')?.classList.add('wa-chat-open');
        document.querySelectorAll('#waContactList .wa-contact').forEach(el => {
            el.classList.toggle('active-chat', el.dataset.directChatId === chatId);
        });

        await loadDirectChatMessages(chatId);
        startDirectChatPolling(chatId);
        startDirectTypingWatcher(chatId, otherId, msgsId);
    } catch (e) {
        console.error('Erro ao abrir conversa:', e);
        showToast('Erro ao abrir conversa.', 'error');
    }
};

window.closeDirectChat = function() {
    stopDirectChatPolling();
    stopDirectTypingWatcher();
    window.currentChat = null;
    window.lastChatSignature = null;
    window._chatActiveElements = null;
    window.currentPostReplyContext = null;
    const panel = document.getElementById('waChatActive');
    if (panel) {
        panel.innerHTML = '';
        panel.classList.add('d-none');
        panel.classList.remove('d-flex', 'tw-chat-community', 'community-active');
    }
    // Tela de "Conversas" (ilustração + texto) já pronta — só não era chamada
    // em lugar nenhum, então o painel ficava em branco ao voltar da Comunidade
    // (ou de qualquer conversa direta) pra cá.
    window.updateWaEmptyState?.('conversas');
    document.getElementById('waEmptyState')?.classList.remove('d-none');
    document.getElementById('whatsappOrdersView')?.classList.remove('wa-chat-open');
    document.querySelectorAll('#waContactList .wa-contact').forEach(el => el.classList.remove('active-chat'));
};

const _directChatPoller = window.ChatCore.createPoller(
    (id, silent) => loadDirectChatMessages(id, silent),
    (id) => {
        const panel = document.getElementById('waChatActive');
        return !!panel && !panel.classList.contains('d-none') && window.currentChat === id;
    },
    4000
);
function startDirectChatPolling(chatId) { _directChatPoller.start(chatId); }
function stopDirectChatPolling() { _directChatPoller.stop(); }

// -------- Indicador "digitando..." do chat direto (Conversas) --------
// Não temos websocket, então usamos um polling leve (só a coluna messages)
// bem mais rápido que o polling normal de mensagens, só pra checar se a
// outra pessoa está com o campo de texto ativo há pouco tempo.
let _directTypingInterval = null;
let _directTypingLastSent = {};

function startDirectTypingWatcher(chatId, otherId, msgsId) {
    stopDirectTypingWatcher();
    if (!otherId) return;
    const infoLine = document.getElementById(`${msgsId}InfoLine`);
    const typingLabel = document.getElementById(`${msgsId}TypingLabel`);
    if (!typingLabel) return;
    _directTypingInterval = setInterval(async () => {
        if (window.currentChat !== chatId) { stopDirectTypingWatcher(); return; }
        try {
            const res = await supabaseFetch(`chats?id=eq.${chatId}&select=messages&limit=1`);
            const meta = res?.[0]?.messages?.[0];
            const typing = meta?.typing;
            const isTyping = !!(typing && String(typing.userId) === String(otherId) &&
                (Date.now() - new Date(typing.ts).getTime()) < 3500);
            typingLabel.classList.toggle('d-none', !isTyping);
            typingLabel.style.display = isTyping ? 'block' : 'none';
            if (infoLine) infoLine.style.display = isTyping ? 'none' : 'block';
        } catch (e) { /* silencioso — só um indicador visual, sem toast de erro */ }
    }, 1800);
}
function stopDirectTypingWatcher() {
    if (_directTypingInterval) { clearInterval(_directTypingInterval); _directTypingInterval = null; }
}

/** Chamado a cada tecla digitada no campo do chat direto; grava (com throttle
 *  de ~2.5s) que este usuário está digitando, pra outra ponta mostrar "digitando...". */
window.notifyDirectChatTyping = async function(chatId) {
    const user = getSavedUser();
    if (!user || !chatId) return;
    const now = Date.now();
    if (_directTypingLastSent[chatId] && (now - _directTypingLastSent[chatId]) < 2500) return;
    _directTypingLastSent[chatId] = now;
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
        const chat = chatResult?.[0];
        const meta = chat?.messages?.[0];
        if (!meta || meta.type !== 'direct_chat_meta') return;
        meta.typing = { userId: user.id, ts: new Date().toISOString() };
        chat.messages[0] = meta;
        await supabaseFetch(`chats?id=eq.${chatId}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
    } catch (e) { /* indicador de digitação não é crítico, ignora falha silenciosamente */ }
};

async function loadDirectChatMessages(chatId, silent = false) {
    const container = window._chatActiveElements?.container;
    if (!container) return;
    const user = getSavedUser();
    if (!user) return;
    const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
    const chat = chatResult?.[0];
    if (!chat) return;

    // Comunidade: renderiza feed de posts em vez de mensagens
    if (chat.seller_name === 'Comunidade ElectroMarket' || chat.buyer_name === 'Comunidade ElectroMarket') {
        await renderCommunityFeedInChat(container, silent);
        return;
    }

    if (!chat?.messages) {
        if (!silent) container.innerHTML = '<div class="text-center py-4 text-muted">Nenhuma mensagem ainda.</div>';
        return;
    }

    try {
        window.__setupReactionHooks(chat,
            (c) => supabaseFetch(`chats?id=eq.${chatId}`, { method: 'PATCH', body: JSON.stringify({ messages: c.messages }) }),
            () => loadDirectChatMessages(chatId, true)
        );

        window.ChatCore.markSeenAndClearBadge(
            chat, user,
            (messages) => supabaseFetch(`chats?id=eq.${chatId}`, { method: 'PATCH', body: JSON.stringify({ messages }) }),
            `.wa-contact[data-direct-chat-id="${chatId}"]`
        );

        const { skip, isNewIncoming } = window.ChatCore.diffSignature(chat, silent);
        if (skip) return;

        const wasNearBottom = !silent || (container.scrollHeight - container.scrollTop - container.clientHeight < 120);
        const myAvatar = normalizeImageUrl(safeParseImages(user.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.nome || 'Você')}&background=22c98e&color=fff&size=40`;

        const chatIsGroup = Array.isArray(chat.participants) && chat.participants.length > 2;
        const otherId = chatIsGroup ? null : chat.participants.find(p => String(p) !== String(user.id));
        let partnerAvatarSrc = chatIsGroup
            ? (chat.messages?.[0]?.groupAvatar || GROUP_PEOPLE_ICON_SRC)
            : `https://ui-avatars.com/api/?name=User&background=random&size=40`;
        let resolveSenderAvatar = null;
        try {
            if (chatIsGroup) {
                // Em grupos/comunidade cada mensagem pode ser de uma pessoa diferente:
                // busca (com cache) a foto real de cada remetente pra abrir corretamente.
                window._groupAvatarCache = window._groupAvatarCache || {};
                const avatarMap = window._groupAvatarCache[chatId] || (window._groupAvatarCache[chatId] = {});
                const missingIds = [...new Set(chat.messages
                    .map(m => m.senderId)
                    .filter(id => id && id !== 'system' && id !== AI_USER_ID && !avatarMap[id]))];
                if (missingIds.length) {
                    const idFilter = missingIds.map(id => `"${id}"`).join(',');
const users = await supabaseFetch(`users?select=id,nome,avatar,tipo&id=in.(${idFilter})`);
                    (users || []).forEach(u => {
                        avatarMap[u.id] = normalizeImageUrl(safeParseImages(u.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.nome || 'User')}&background=random&color=fff&size=40`;
                    });
                }
                avatarMap[AI_USER_ID] = 'https://tse1.mm.bing.net/th/id/OIP.RWeIgcAIhZe99xrj3sLLQAHaHa?r=0&rs=1&pid=ImgDetMain&o=7&rm=3';
                resolveSenderAvatar = (msg) => avatarMap[msg.senderId] || null;
            } else if (otherId) {
                if (String(otherId) === AI_USER_ID) {
                    partnerAvatarSrc = 'https://tse1.mm.bing.net/th/id/OIP.RWeIgcAIhZe99xrj3sLLQAHaHa?r=0&rs=1&pid=ImgDetMain&o=7&rm=3';
                } else {
                    const pd = await supabaseFetch(`users?select=avatar&id=eq.${otherId}&limit=1`);
                    const ra = normalizeImageUrl(safeParseImages(pd?.[0]?.avatar)[0]);
                    if (ra) partnerAvatarSrc = ra;
                }
            }
        } catch (e) {}

        container.innerHTML = chat.messages.map((msg, index) => {
            return window.renderMsgBubble(msg, index, {
                userId: user.id, myAvatar, partnerAvatar: partnerAvatarSrc, supportAvatar: partnerAvatarSrc,
                resolveSenderName: () => msg.senderName || '',
                resolveSenderAvatar,
                actions: { reply: 'startReply', copy: 'copyMessageText', edit: 'startEdit', delete: 'deleteMessage', star: 'toggleStarMessage' },
                useDropdown: true, enableGrouping: true, allMessages: chat.messages
            });
        }).join('');

        if (wasNearBottom) {
            container.scrollTop = container.scrollHeight;
        } else if (isNewIncoming) {
            showToast('Nova mensagem recebida.', 'info', 2000);
            showBrowserNotification('Nova mensagem', chat.seller_name || 'Conversa direta');
        }
    } catch (e) {
        if (silent) return;
        console.error(e);
        container.innerHTML = `<div class="text-center py-4 text-danger"><i class="bi bi-exclamation-triangle fs-1 d-block mb-2"></i><p>Erro ao carregar mensagens</p><button class="btn btn-primary btn-sm" onclick="loadDirectChatMessages('${chatId}')">Tentar novamente</button></div>`;
    }
}

window.sendDirectChatMessage = async function(event) {
    if (event?.preventDefault) event.preventDefault();
    const input = window._chatActiveElements?.input;
    const text = input?.value?.trim();
    const user = getSavedUser();
    if ((!text && window.editingMessageIndex === null) || !user || !window.currentChat) return;

    // Post "marcado" via startPostReplyInChat: em vez de mandar uma mensagem
    // comum, publica o comentário de verdade na Thread (twPostCreate), que já
    // se encarrega de espelhar essa mensagem aqui na conversa (thread_comment_ref).
    if (window.currentPostReplyContext && text) {
        const { postId } = window.currentPostReplyContext;
        try {
            await twPostCreate({ author_id: user.id, content: text, image: null, parent_id: postId });
            input.value = '';
            window.cancelReplyOrEdit();
            await loadDirectChatMessages(window.currentChat);
        } catch (e) {
            console.error('Erro ao comentar no post:', e);
            showToast('Erro ao enviar comentário.', 'error');
        }
        return;
    }

    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${window.currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Conversa não encontrada.', 'error'); return; }

        if (window.editingMessageIndex !== null) {
            chat.messages[window.editingMessageIndex].text = text;
            chat.messages[window.editingMessageIndex].edited = true;
        } else {
            const newMessage = { senderId: user.id, senderName: user.nome, text, timestamp: new Date().toISOString(), type: 'message' };
            if (window.currentReplyIndex !== null) {
                const repliedMsg = chat.messages[window.currentReplyIndex];
                newMessage.replyTo = { text: repliedMsg.text, senderName: repliedMsg.senderName };
            }
            chat.messages.push(newMessage);
        }

        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        input.value = '';
        window.cancelReplyOrEdit();
        await loadDirectChatMessages(window.currentChat);
        if (chat.participants?.some(p => String(p) === AI_USER_ID)) {
            _respondIfAiChat(chat);
        }
    } catch (e) { showToast('Erro ao enviar mensagem.', 'error'); }
};

window.sendDirectChatImageFile = async function(inputFile) {
    const file = inputFile?.files?.[0];
    if (inputFile) inputFile.value = '';
    if (!file) return;
    const btn = inputFile?.closest('.chat-container')?.querySelector('label') || document.querySelector('#chatAttachPanel label');
    const original = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Enviando...';
    const clientId = window.CONFIG?.IMGUR_CLIENT_ID || window.CONFIG_LOCAL_FALLBACK?.IMGUR_CLIENT_ID || '546c25a59c58ad7';
    try {
        const fd = new FormData();
        fd.append('image', file, file.name || 'imagem.jpg');
        const res = await fetch('https://api.imgur.com/3/image', { method: 'POST', headers: { Authorization: `Client-ID ${clientId}` }, body: fd });
        const json = await res.json().catch(() => null);
        if (btn) btn.innerHTML = original;
        if (json?.success && json?.data?.link) {
            await window.sendDirectChatImage(json.data.link);
            window._chatActiveElements?.attachPanel?.classList.add('d-none');
        } else {
            showToast('Falha ao enviar imagem (tente um link).', 'error');
        }
    } catch (e) { if (btn) btn.innerHTML = original; showToast('Erro ao enviar imagem.', 'error'); }
};

window.sendDirectChatImage = async function(urlParam) {
    const rawUrl = urlParam;
    if (!rawUrl || !(rawUrl.startsWith('http') || rawUrl.startsWith('data:'))) { showToast('Link inválido!', 'warning'); return; }
    const url = normalizeImageUrl(rawUrl);
    const user = getSavedUser();
    if (!user || !window.currentChat) return;
    const isVideo = /\.(mp4|webm|ogg|mov)$/i.test(url) || /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
    const isGif = /\.gif$/i.test(url);
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${window.currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Conversa não encontrada.', 'error'); return; }
        const msg = { senderId: user.id, senderName: user.nome, text: isVideo ? 'Vídeo' : (isGif ? 'GIF' : 'Imagem'), timestamp: new Date().toISOString() };
        if (isVideo) { msg.type = 'video'; msg.video = url; }
        else { msg.type = 'image'; msg.image = url; }
        chat.messages.push(msg);
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        await loadDirectChatMessages(window.currentChat);
        if (chat.participants?.some(p => String(p) === AI_USER_ID)) _respondIfAiChat(chat);
    } catch (e) { showToast('Erro ao processar o link.', 'error'); }
};

window.sendDirectChatFile = async function(urlParam) {
    const url = urlParam;
    if (!url || !url.startsWith('http')) { showToast('Link inválido!', 'warning'); return; }
    const user = getSavedUser();
    if (!user || !window.currentChat) return;
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${window.currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) return;
        chat.messages.push({ senderId: user.id, senderName: user.nome, text: `Arquivo: ${url.split('/').pop()}`, file: { name: 'Arquivo Externo', url, size: 0 }, timestamp: new Date().toISOString(), type: 'file' });
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        await loadDirectChatMessages(window.currentChat);
        if (chat.participants?.some(p => String(p) === AI_USER_ID)) _respondIfAiChat(chat);
    } catch { showToast('Erro ao enviar arquivo.', 'error'); }
};

window.confirmDirectChatAttach = async function() {
    const suffix = chatAttachType === 'file' ? 'File' : '';
    const input = document.getElementById(`dattachLink_${window.currentChat}${suffix}`) || document.getElementById(`attachLink_${window.currentChat}${suffix}`);
    const url = input?.value?.trim();
    if (!url || !url.startsWith('http')) { showToast('Cole um link válido (começando com http).', 'warning'); return; }
    if (chatAttachType === 'image') await window.sendDirectChatImage(url);
    else await window.sendDirectChatFile(url);
    input.value = '';
    window._chatActiveElements?.attachPanel?.classList.add('d-none');
};

window.sendDirectChatLocation = async function(kind) {
    const user = getSavedUser();
    if (!user || !window.currentChat) return;
    if (kind === 'current') {
        if (!navigator.geolocation) { showToast('Geolocalização não suportada.', 'error'); return; }
        showToast('Obtendo sua localização...', 'info');
        navigator.geolocation.getCurrentPosition(async (pos) => {
            try {
                const { latitude, longitude } = pos.coords;
                const maps = `https://www.google.com/maps?q=${latitude},${longitude}`;
                await sendDirectLocationMessage(maps, `Localização atual: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
            } catch (e) { showToast('Erro ao enviar localização.', 'error'); }
        }, () => showToast('Não foi possível obter a localização. Verifique se o GPS está ativo e o navegador tem permissão.', 'error'), { enableHighAccuracy: true, timeout: 10000 });
        return;
    }
    if (kind === 'stored') {
        const u = getSavedUser() || {};
        const endereco = [u.endereco, u.cidade, u.estado, u.cep].filter(Boolean).join(', ');
        const maps = u.maps || (endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}` : '');
        if (!maps) { showToast('Você não tem endereço cadastrado no perfil.', 'warning'); return; }
        sendDirectLocationMessage(maps, `📍 Meu endereço cadastrado: ${endereco || maps}`);
        return;
    }
    const input = document.getElementById(`dattachLink_${window.currentChat}Loc`) || document.getElementById(`attachLink_${window.currentChat}Loc`);
    const url = input?.value?.trim();
    if (!url || !url.startsWith('http')) { showToast('Cole um link de endereço válido.', 'warning'); return; }
    sendDirectLocationMessage(url, `Endereço (link): ${url}`);
    input.value = '';
    window._chatActiveElements?.attachPanel?.classList.add('d-none');
};

async function sendDirectLocationMessage(mapsUrl, text) {
    const user = getSavedUser();
    if (!user || !window.currentChat) return;
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${window.currentChat}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) return;
        chat.messages.push({ senderId: user.id, senderName: user.nome, text, location: mapsUrl, timestamp: new Date().toISOString(), type: 'location' });
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        await loadDirectChatMessages(window.currentChat);
        if (chat.participants?.some(p => String(p) === AI_USER_ID)) _respondIfAiChat(chat);
    } catch { showToast('Erro ao enviar localização.', 'error'); }
}

window.viewDirectChatPartnerProfile = async function(partnerId) {
    if (!partnerId) return;
    if (String(partnerId) === AI_USER_ID) {
        const modalHtml = `
        <div class="modal-dialog modal-dialog-centered modal-sm">
            <div class="modal-content border-0 shadow-lg" style="border-radius:16px;">
                <div class="modal-body text-center p-4">
                    <button type="button" class="ml-auth-close" data-bs-dismiss="modal" aria-label="Fechar" style="border-radius:50%;width:34px;height:34px;font-size:0.9rem;"><i class="bi bi-x-lg"></i></button>
                    <img src="https://tse1.mm.bing.net/th/id/OIP.RWeIgcAIhZe99xrj3sLLQAHaHa?r=0&rs=1&pid=ImgDetMain&o=7&rm=3" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #e9ecef;" referrerpolicy="no-referrer">
                    <h5 class="mt-3 mb-1">DuckDuckGo</h5>
                    <p class="text-muted small mb-2"><i class="bi bi-search me-1"></i>Busca na Web</p>
                    <p class="small text-muted mb-0">Pesquisa via DuckDuckGo Instant Answer<br>Digite sua pergunta e eu busco a resposta</p>
                </div>
            </div>
        </div>`;
        let modalEl = document.getElementById('partnerProfileModal');
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.id = 'partnerProfileModal';
            modalEl.className = 'modal fade';
            modalEl.tabIndex = -1;
            document.body.appendChild(modalEl);
        }
        modalEl.innerHTML = modalHtml;
        const bsModal = new bootstrap.Modal(modalEl);
        bsModal.show();
        return;
    }
    let partner = null;
    try {
        const r = await supabaseFetch(`users?select=nome,avatar,vendedor_rating,rating_count,created_at,last_seen&id=eq.${partnerId}&limit=1`);
        partner = r?.[0];
    } catch (e) {}
    const avatar = normalizeImageUrl(safeParseImages(partner?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(partner?.nome || 'User')}&background=random&size=100`;
    const rating = partner?.vendedor_rating ? parseFloat(partner.vendedor_rating).toFixed(1) : '—';
    const ratingCount = partner?.rating_count || 0;
    const memberSince = partner?.created_at ? new Date(partner.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '—';
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
                    <button type="button" class="ml-auth-close" data-bs-dismiss="modal" aria-label="Fechar" style="border-radius:50%;width:34px;height:34px;font-size:0.9rem;"><i class="bi bi-x-lg"></i></button>
                    <div class="position-relative d-inline-block mb-3">
                        <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;" class="border" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&size=80'">
                        <span class="presence-dot ${online ? 'online' : 'offline'}" style="width:16px;height:16px;border:2px solid #fff;"></span>
                    </div>
                    <h5 class="fw-bold mb-1">${partner?.nome || 'Usuário'}</h5>
                    <p class="small mb-2 fw-bold ${online ? 'text-success' : 'text-muted'}">${online ? '● Online agora' : '○ Offline'}</p>
                    <p class="text-muted small mb-3"><i class="bi bi-calendar3 me-1"></i>Na plataforma desde ${memberSince}</p>
                    <div class="d-flex justify-content-center align-items-center gap-2 mb-3">
                        <i class="bi bi-star-fill text-warning"></i>
                        <span class="fw-bold">${rating}</span>
                        <span class="text-muted small">(${ratingCount} avaliações)</span>
                    </div>
                    <button class="ml-attach w-100 mb-2" onclick="window.showUserReviews('${partnerId}','${partner?.nome || 'Usuário'}')">
                        <i class="bi bi-star me-1"></i>Ver avaliações
                    </button>
                </div>
            </div>
        </div>`;
    new bootstrap.Modal(modalEl).show();
};

window.pinDirectChat = async function(chatId) {
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) return;
        const meta = chat.messages?.[0] || {};
        meta.pinned = !meta.pinned;
        chat.messages[0] = meta;
        await supabaseFetch(`chats?id=eq.${chatId}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        showToast(meta.pinned ? 'Conversa fixada no topo.' : 'Conversa desafixada.', 'info');
        // Reordena a lista lateral primeiro (renderDirectChats fecha o chat ativo),
        // depois reabre a mesma conversa pra atualizar o rótulo do menu "...".
        await window.renderDirectChats({ skipBoot: true });
        await window.openDirectChat(chatId);
    } catch (e) { showToast('Erro ao fixar conversa.', 'error'); }
};

window.muteDirectChat = async function(chatId) {
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) return;
        const meta = chat.messages?.[0] || {};
        meta.muted = !meta.muted;
        chat.messages[0] = meta;
        await supabaseFetch(`chats?id=eq.${chatId}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        showToast(meta.muted ? 'Conversa silenciada.' : 'Notificações reativadas.', 'info');
    } catch (e) { showToast('Erro ao alterar notificações.', 'error'); }
};

window.archiveDirectChat = async function(chatId) {
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) return;
        const meta = chat.messages?.[0] || {};
        meta.archived = !meta.archived;
        chat.messages[0] = meta;
        await supabaseFetch(`chats?id=eq.${chatId}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        showToast(meta.archived ? 'Conversa arquivada.' : 'Conversa desarquivada.', 'info');
        window.closeDirectChat();
        window.renderDirectChats({ skipBoot: true });
    } catch (e) { showToast('Erro ao arquivar conversa.', 'error'); }
};

window.blockDirectChatUser = async function(targetId) {
    if (!confirm('Tem certeza que deseja bloquear este usuário? Ele não poderá enviar mensagens para você.')) return;
    try {
        const user = getSavedUser();
        const directChats = await supabaseFetch(`chats?order_id=is.null&select=*`);
        const chat = directChats.find(c =>
            c.order_id === null &&
            c.participants && c.participants.some(p => String(p) === String(user.id)) && c.participants.some(p => String(p) === String(targetId)) &&
            c.messages && c.messages[0]?.type !== 'ticket_meta'
        );
        if (chat) {
            const meta = chat.messages?.[0] || {};
            meta.blocked_by = user.id;
            chat.messages[0] = meta;
            await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages }) });
        }
        showToast('Usuário bloqueado.', 'info');
        window.closeDirectChat();
        window.renderDirectChats({ skipBoot: true });
    } catch (e) { showToast('Erro ao bloquear usuário.', 'error'); }
};

window.deleteDirectChat = async function(chatId) {
    if (!confirm('Tem certeza que deseja apagar esta conversa?\nEssa ação não pode ser desfeita.')) return;
    try {
        await supabaseFetch(`chats?id=eq.${chatId}`, { method: 'DELETE' });
        showToast('Conversa apagada.', 'info');
        window.closeDirectChat();
        window.renderDirectChats({ skipBoot: true });
    } catch (e) {
        showToast('Erro ao apagar conversa.', 'error');
    }
};

/** Apaga todas as mensagens da conversa (mantém o grupo/contato na lista, só limpa o histórico).
 *  IMPORTANTE: isso NUNCA apaga a conversa em si (nunca faz DELETE na tabela `chats`) —
 *  só faz um PATCH no campo `messages`, preservando sempre a mensagem de metadados
 *  (nome/foto/config do grupo) quando ela existir, pra não perder essas configurações. */
window.clearDirectChat = async function(chatId) {
    if (!chatId) return;
    if (!confirm('Limpar todas as mensagens desta conversa?\nO contato/grupo continua na sua lista, só o histórico de mensagens é apagado.\nEssa ação não pode ser desfeita.')) return;
    try {
        const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
        const chat = chatResult?.[0];
        if (!chat) { showToast('Conversa não encontrada.', 'error'); return; }

        // Mantém a mensagem de metadados (nome/foto/config do grupo ou config do contato), se houver.
        const firstMsg = chat.messages?.[0];
        const isMeta = firstMsg && (firstMsg.type === 'direct_chat_meta' || firstMsg.groupType === 'group');
        const keepMeta = isMeta ? [firstMsg] : [];

        // Só atualiza `messages` — nunca apaga a linha da conversa nem mexe em `participants`.
        await supabaseFetch(`chats?id=eq.${chatId}`, { method: 'PATCH', body: JSON.stringify({ messages: keepMeta }) });

        showToast('Mensagens apagadas. A conversa continua na sua lista.', 'info');
        await window.loadDirectChatMessages?.(chatId);
        // Atualiza só a prévia dessa conversa na lista lateral, sem recarregar tudo.
        const rowEl = document.querySelector(`.wa-contact[data-direct-chat-id="${chatId}"] .wa-contact-text`);
        if (rowEl) { rowEl.textContent = 'Iniciar conversa'; rowEl.style.removeProperty('font-weight'); }
        document.querySelector(`.wa-contact[data-direct-chat-id="${chatId}"] .wa-contact-badge`)?.remove();
    } catch (e) {
        console.error('Erro ao limpar conversa:', e);
        showToast('Erro ao limpar conversa.', 'error');
    }
};

function formatChatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
        return 'Ontem';
    } else if (diffDays < 7) {
        return date.toLocaleDateString('pt-BR', { weekday: 'short' });
    } else {
        return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }
}

function truncateText(text, max) {
    if (!text) return '';
    return text.length > max ? text.substring(0, max) + '...' : text;
}

