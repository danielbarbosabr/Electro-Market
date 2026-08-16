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
    const map = { conversas: 'waRailConversas', comunidade: 'waRailCommunity', arquivadas: 'waRailArchived', grupos: 'waRailGroups' };
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
    document.getElementById('whatsappOrdersView')?.classList.remove('wa-community-mode');

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
        const directChats = await supabaseFetch(`chats?order_id=is.null&select=*`);
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
            .filter(c => (c.messages?.[0]?.groupType === 'group' || (c.participants && c.participants.length > 2)) && c.seller_name !== 'Comunidade ElectroMarket')
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
                const avatar = groupMeta.groupAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(groupName)}&background=00A884&color=fff&size=45&bold=true`;
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
                            <img src="${avatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&size=45'">
                        </div>
                        <span class="wa-group-badge"><i class="bi bi-people-fill"></i></span>
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
                <img src="https://raw.githubusercontent.com/Guiidtk/tela-de-login/6d511e1e677c6cbdef0a206d9b394e29cee80b2f/Assets/IMG/hacker-animate.svg" alt="ElectroMarket" style="width:220px;height:220px;object-fit:contain;">
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

// -------- SISTEMA DE GRUPOS (WhatsApp-style) --------
// ---------------------------------------------------------------
// 1. CONSTANTES E ESTADO GLOBAL
// ---------------------------------------------------------------

const GROUP_COLOR = '#00A884';

// Estado do fluxo de criação
let _selectedMembers = {};
let _allUsersCache = [];
let _groupAvatarUrl = '';

// ---------------------------------------------------------------
// 2. GRUPO: FUNÇÕES AUXILIARES
// ---------------------------------------------------------------

/** Verifica se um chat é grupo */
function isGroupChat(chat) {
  return chat && Array.isArray(chat.participants) && chat.participants.length > 2;
}

/** Retorna a meta message do grupo (messages[0]) */
function getGroupMeta(chat) {
  if (!chat || !chat.messages?.[0]) return null;
  const m = chat.messages[0];
  if (m.groupType === 'group') return m;
  // Fallback: o buyer_id é o criador do chat → é um grupo antigo
  if (isGroupChat(chat)) return m;
  return null;
}

/** Verifica se o usuário logado é admin do grupo */
function isGroupAdmin(chat, userId) {
  if (!chat || !userId) return false;
  const meta = getGroupMeta(chat);
  // 1. Se o meta tem createdBy, esse é o criador (sempre admin)
  if (meta?.createdBy && String(meta.createdBy) === String(userId)) return true;
  // 2. Se está na lista de groupAdmins
  const admins = meta?.groupAdmins || [];
  if (admins.some(a => String(a) === String(userId))) return true;
  // 3. Fallback: buyer_id é sempre admin (criador do chat no DB)
  if (chat.buyer_id && String(chat.buyer_id) === String(userId)) return true;
  // 4. Último fallback: se é grupo, o primeiro participante é admin
  if (isGroupChat(chat) && chat.participants?.length) {
    const owner = chat.participants[0];
    if (owner && String(owner) === String(userId)) return true;
  }
  return false;
}

/** Obtém o creator (primeiro admin) – meta ou fallback */
function getGroupCreator(chat) {
  const meta = getGroupMeta(chat);
  if (meta?.createdBy) return String(meta.createdBy);
  if (chat?.buyer_id) return String(chat.buyer_id);
  if (chat?.participants?.length) return String(chat.participants[0]);
  return null;
}

/** Obtém settings do grupo da meta com defaults */
function getGroupSettings(chat) {
  const meta = getGroupMeta(chat);
  return {
    admins_only_edit_info: true,
    admins_only_send_msg: false,
    admins_only_add_members: false,
    approval_required: false,
    ...(meta?.groupSettings || {})
  };
}

/** Obtém descrição do grupo da meta */
function getGroupDescription(chat) {
  const meta = getGroupMeta(chat);
  return meta?.groupDescription || chat.group_description || '';
}

/** Gera avatar default do grupo */
function getGroupAvatar(chat) {
  const meta = getGroupMeta(chat);
  const name = meta?.groupName || chat.seller_name || chat.buyer_name || 'Grupo';
  const avatar = meta?.groupAvatar || chat.group_avatar || '';
  return avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${GROUP_COLOR.replace('#','')}&color=fff&size=80&bold=true`;
}

// ---------------------------------------------------------------
// 3. CRIAÇÃO DE GRUPO / NOVA CONVERSA — FLUXO REAPROVEITADO
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
  document.getElementById('newGroupInfoSection')?.classList.add('d-none');
  document.getElementById('newGroupCreateBtn').innerHTML = '<i class="bi bi-chat-dots me-2"></i>Conversar';

  _selectedMembers = {};
  _groupAvatarUrl = '';

  const nameInput = document.getElementById('newGroupNameInput');
  const searchInput = document.getElementById('newGroupMemberSearch');
  if (nameInput) nameInput.value = '';
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

/**
 * Abre o modal de criação de grupo (estilo Falar com o Suporte)
 */
window.openNewGroupModal = async function () {
  const user = getSavedUser();
  if (!user) { showToast('Faça login!', 'warning'); return; }

  const modalEl = document.getElementById('newGroupModal');
  if (!modalEl) return;
  modalEl.dataset.mode = 'group';

  // Restaura UI para modo grupo
  document.getElementById('newGroupModalTitle').textContent = 'Criar novo grupo';
  document.getElementById('newGroupModalSubtitle').textContent = 'Selecione os participantes e defina as informações';
  document.getElementById('newGroupParticipantTitle').textContent = 'Participantes';
  document.getElementById('newGroupSelectLabel').textContent = 'Selecione pelo menos 2 pessoas';
  document.getElementById('newGroupInfoSection')?.classList.remove('d-none');
  document.getElementById('newGroupCreateBtn').innerHTML = '<i class="bi bi-check2 me-2"></i>Criar grupo';

  _selectedMembers = {};
  _groupAvatarUrl = '';

  // Limpa campos
  const nameInput = document.getElementById('newGroupNameInput');
  const searchInput = document.getElementById('newGroupMemberSearch');
  const preview = document.getElementById('newGroupAvatarPreview');
  const placeholder = document.getElementById('newGroupAvatarPlaceholder');
  const avatarLinkInput = document.getElementById('newGroupAvatarLink');
  if (nameInput) nameInput.value = '';
  if (searchInput) searchInput.value = '';
  if (preview) { preview.src = ''; preview.classList.add('d-none'); }
  if (placeholder) placeholder.style.display = '';
  if (avatarLinkInput) avatarLinkInput.value = '';

  // Mostra modal
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
  _updateParticipantSummary();
}

function _updateSelectedCount() {
  const modalEl = document.getElementById('newGroupModal');
  const isSingle = modalEl?.dataset?.mode === 'single';
  const count = Object.keys(_selectedMembers).length;
  const label = document.getElementById('newGroupSelectedCount');
  if (label) label.textContent = count > 0
    ? `Usuário selecionado.`
    : 'Nenhum usuário selecionado.';
  const btn = document.getElementById('newGroupCreateBtn');
  if (btn) btn.disabled = isSingle ? count < 1 : count < 2;
}

function _updateParticipantSummary() {
  const summary = document.getElementById('newGroupSelectedSummary');
  if (!summary) return;
  const users = _allUsersCache.filter(u => _selectedMembers[u.id]);
  summary.innerHTML = users.length
    ? users.map(u => {
        const avatar = normalizeImageUrl(safeParseImages(u.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.nome || 'User')}&background=random&size=30`;
        return `<img src="${avatar}" title="${u.nome}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:-6px;border:2px solid #fff;">`;
      }).join('')
    : '<span class="text-muted small">Nenhum participante selecionado.</span>';
}

/** Filtro de busca na lista de membros */
window.filterNewGroupMembers = function (query) {
  _renderMemberList(query);
};

/** Alterna seleção de um membro */
window.toggleNewGroupMember = function (userId) {
  const modalEl = document.getElementById('newGroupModal');
  const isSingle = modalEl?.dataset?.mode === 'single';
  console.log('toggleNewGroupMember', userId, 'mode:', isSingle ? 'single' : 'group');

  if (isSingle) {
    if (_selectedMembers[userId]) {
      delete _selectedMembers[userId];
    } else {
      _selectedMembers = {};
      _selectedMembers[userId] = true;
    }
  } else {
    if (_selectedMembers[userId]) {
      delete _selectedMembers[userId];
    } else {
      _selectedMembers[userId] = true;
    }
  }
  console.log('_selectedMembers keys:', Object.keys(_selectedMembers));
  const searchInput = document.getElementById('newGroupMemberSearch');
  _renderMemberList(searchInput?.value || '');
};

/** Upload de foto do grupo */
window.uploadGroupAvatar = function (input) {
  const file = input?.files?.[0];
  if (!file) return;
  // Preview local
  const reader = new FileReader();
  reader.onload = function (e) {
    const preview = document.getElementById('newGroupAvatarPreview');
    const placeholder = document.getElementById('newGroupAvatarPlaceholder');
    if (preview) {
      preview.src = e.target.result;
      preview.classList.remove('d-none');
    }
    if (placeholder) placeholder.style.display = 'none';
    // Upload para Imgur
    _uploadToImgur(file).then(url => {
      if (url) {
        _groupAvatarUrl = url;
        const linkInput = document.getElementById('newGroupAvatarLink');
        if (linkInput) linkInput.value = url;
      }
    }).catch(() => {});
  };
  reader.readAsDataURL(file);
};

/** Usa o link colado no campo "Link da foto" como avatar do grupo (mesmo padrão do perfil) */
window.setGroupAvatarFromLink = function (url) {
  url = (url || '').trim();
  _groupAvatarUrl = url;
  const preview = document.getElementById('newGroupAvatarPreview');
  const placeholder = document.getElementById('newGroupAvatarPlaceholder');
  if (url) {
    if (preview) { preview.src = url; preview.classList.remove('d-none'); }
    if (placeholder) placeholder.style.display = 'none';
  } else {
    if (preview) { preview.src = ''; preview.classList.add('d-none'); }
    if (placeholder) placeholder.style.display = '';
  }
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

/** Cria grupo ou inicia conversa conforme o modo do modal */
window.createGroupChat = async function () {
  const modalEl = document.getElementById('newGroupModal');
  const mode = modalEl?.dataset?.mode || 'group';

  // ---- MODO SINGLE: inicia conversa individual ----
  if (mode === 'single') {
    const memberIds = Object.keys(_selectedMembers);
    if (!memberIds.length) { showToast('Selecione uma pessoa.', 'warning'); return; }
    console.log('createGroupChat single mode, selected:', memberIds[0]);

    const modal = window.bootstrap ? bootstrap.Modal.getInstance(modalEl) : null;
    if (modal) {
      modal.hide();
      modalEl.addEventListener('hidden.bs.modal', function onHidden() {
        modalEl.removeEventListener('hidden.bs.modal', onHidden);
        document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
        console.log('Modal fechado, chamando startDirectChat');
        window.startDirectChat(memberIds[0]);
      });
    } else {
      window.startDirectChat(memberIds[0]);
    }
    return;
  }

  // ---- MODO GROUP: cria grupo ----
  const user = getSavedUser();
  if (!user) { showToast('Faça login!', 'warning'); return; }

  const nameInput = document.getElementById('newGroupNameInput');
  const groupName = nameInput?.value?.trim();
  const groupDesc = '';
  const memberIds = Object.keys(_selectedMembers);

  if (!groupName) { showToast('Dê um nome para o grupo.', 'warning'); return; }
  if (memberIds.length < 2) { showToast('Selecione pelo menos 2 participantes.', 'warning'); return; }

  const allMemberIds = [user.id, ...memberIds];
  const groupId = crypto.randomUUID();
  const now = new Date().toISOString();

  const meta = {
    type: 'direct_chat_meta',
    createdBy: user.id,
    createdByName: user.nome,
    groupType: 'group',
    groupName: groupName,
    groupDescription: groupDesc,
    groupAvatar: _groupAvatarUrl || '',
    groupCreatedAt: now,
    groupAdmins: [user.id],
    groupSettings: {
      admins_only_edit_info: true,
      admins_only_send_msg: false,
      admins_only_add_members: false,
      approval_required: false
    }
  };

  const systemMessages = [
    { senderId: 'system', text: `${user.nome} criou o grupo "${groupName}"`, timestamp: now, type: 'system', systemType: 'group_created' }
  ];

  memberIds.forEach(id => {
    const nome = _allUsersCache.find(u => String(u.id) === String(id))?.nome || 'um participante';
    systemMessages.push({ senderId: 'system', text: `${user.nome} adicionou ${nome}`, timestamp: now, type: 'system', systemType: 'member_added' });
  });

  try {
    const newGroup = {
      id: groupId, order_id: null, buyer_id: user.id, seller_id: user.id,
      buyer_name: user.nome, seller_name: groupName,
      participants: allMemberIds, messages: [meta, ...systemMessages]
    };
    await supabaseFetch('chats', { method: 'POST', body: JSON.stringify(newGroup) });

    const modal = window.bootstrap ? bootstrap.Modal.getInstance(modalEl) : null;
    modal?.hide();

    showToast(`Grupo "${groupName}" criado!`, 'success');
    await window.renderDirectChats({ skipBoot: true });
    setTimeout(() => window.openDirectChat(groupId), 400);
  } catch (e) {
    console.error('Erro ao criar grupo:', e);
    showToast(`Erro: ${e?.message || e?.details || 'Erro ao criar grupo.'}`, 'error');
  }
};

// ---------------------------------------------------------------
// 4. INFORMAÇÕES DO GRUPO (tela estilo WhatsApp)
// ---------------------------------------------------------------

/**
 * Abre a tela de informações do grupo (sobreposição)
 */
window.openGroupInfo = async function (chatId) {
  const user = getSavedUser();
  if (!user || !chatId) return;

  try {
    const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
    const chat = chatResult?.[0];
    if (!chat || !isGroupChat(chat)) return;

    const participantIds = (chat.participants || []).map(String);
    const idFilter = participantIds.map(id => `"${id}"`).join(',');
    const users = await supabaseFetch(`users?select=id,nome,avatar,last_seen&id=in.(${idFilter})`);
    const usersById = {};
    (users || []).forEach(u => { usersById[String(u.id)] = u; });

    const meta = getGroupMeta(chat);
    const isAdmin = isGroupAdmin(chat, user.id);
    const creatorId = getGroupCreator(chat);
    const groupName = meta?.groupName || chat.seller_name || 'Grupo';
    const groupAvatar = getGroupAvatar(chat);
    const createdAt = meta?.groupCreatedAt
      ? new Date(meta.groupCreatedAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
      : '???';
    const settings = getGroupSettings(chat);
    const groupAdmins = meta?.groupAdmins || [];

    // Cria container fullscreen se não existir
    let container = document.getElementById('groupInfoContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'groupInfoContainer';
      container.className = 'wa-group-info-overlay';
      document.body.appendChild(container);
    }

    // Monta lista de participantes
    const participantRows = participantIds.map(id => {
      const u = usersById[id];
      const nome = u?.nome || 'Usuário removido';
      const avatarUrl = normalizeImageUrl(safeParseImages(u?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(nome)}&background=random&color=fff`;
      const isMe = String(id) === String(user.id);
      const isCreator = creatorId && String(id) === String(creatorId);
      const isAdminUser = groupAdmins.some(a => String(a) === String(id));
      const online = isRecentlyOnline(u?.last_seen);

      return `
      <div class="wa-gi-participant" data-user-id="${id}">
        <div class="wa-gi-participant-avatar ${online ? 'online' : ''}">
          <img src="${avatarUrl}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(nome)}&background=random&color=fff'">
          ${online ? '<span class="wa-gi-dot"></span>' : ''}
        </div>
        <div class="wa-gi-participant-info">
          <strong>${nome}${isMe ? ' <small style="color:#667781;font-weight:400;">(você)</small>' : ''}</strong>
          <div class="wa-gi-participant-badges">
            ${isCreator ? '<span class="wa-gi-badge wa-gi-badge-creator"><i class="bi bi-star-fill"></i> Criador</span>' : ''}
            ${isAdminUser && !isCreator ? '<span class="wa-gi-badge wa-gi-badge-admin"><i class="bi bi-shield-fill-check"></i> Admin</span>' : ''}
          </div>
        </div>
        ${isAdmin && !isMe ? `
        <div class="wa-gi-participant-actions dropdown">
          <button class="wa-gi-action-btn" data-bs-toggle="dropdown"><i class="bi bi-three-dots-vertical"></i></button>
          <ul class="dropdown-menu dropdown-menu-end shadow-sm">
            ${!isAdminUser ? `<li><a class="dropdown-item small" href="javascript:void(0)" onclick="window.groupPromoteAdmin('${chatId}','${id}')"><i class="bi bi-shield-fill-check me-2"></i>Promover a admin</a></li>` : ''}
            ${isAdminUser && !isCreator ? `<li><a class="dropdown-item small" href="javascript:void(0)" onclick="window.groupDemoteAdmin('${chatId}','${id}')"><i class="bi bi-shield-slash me-2"></i>Remover admin</a></li>` : ''}
            <li><a class="dropdown-item small text-danger" href="javascript:void(0)" onclick="window.groupRemoveMember('${chatId}','${id}','${nome.replace(/'/g, "\\'")}')"><i class="bi bi-person-x me-2"></i>Remover do grupo</a></li>
          </ul>
        </div>` : ''}
      </div>`;
    }).join('');

    container.innerHTML = `
      <div class="wa-gi-backdrop" onclick="window.closeGroupInfo()"></div>
      <div class="wa-gi-panel">
        <div class="wa-gi-header">
          <button class="wa-gi-close" onclick="window.closeGroupInfo()"><i class="bi bi-arrow-left"></i></button>
          <h6>Informações do Grupo</h6>
        </div>

        <div class="wa-gi-body">
          <!-- Avatar e nome -->
          <div class="wa-gi-hero text-center py-4">
            <div class="wa-gi-hero-avatar" onclick="${isAdmin ? `window.groupChangePhoto('${chatId}')` : ''}" style="${isAdmin ? 'cursor:pointer;' : ''}">
              <img src="${groupAvatar}" id="groupInfoAvatar" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=00A884&color=fff&size=80'">
              ${isAdmin ? '<div class="wa-gi-hero-overlay"><i class="bi bi-camera-fill"></i></div>' : ''}
            </div>
            <h5 id="groupInfoName" class="mt-2 mb-0">${groupName}</h5>
            ${isAdmin ? `
            <button class="btn btn-sm btn-outline-secondary mt-1" onclick="window.groupEditName('${chatId}')" style="font-size:0.75rem;">
              <i class="bi bi-pencil me-1"></i>Editar nome
            </button>` : ''}
            <div class="wa-gi-meta mt-2">
              <small class="text-muted">Grupo criado em ${createdAt}</small>
            </div>
          </div>

          <!-- Configurações -->
          ${isAdmin ? `
          <div class="wa-gi-section">
            <div class="wa-gi-section-title"><i class="bi bi-gear-fill me-2"></i>Configurações do Grupo</div>
            <div class="wa-gi-setting" onclick="window.groupToggleSetting('${chatId}','admins_only_edit_info')">
              <div>
                <div class="small fw-bold">Apenas admins alteram informações</div>
                <small class="text-muted">Nome, foto e descrição</small>
              </div>
              <div class="form-check form-switch mb-0">
                <input class="form-check-input" type="checkbox" ${settings.admins_only_edit_info !== false ? 'checked' : ''} onclick="event.stopPropagation();window.groupToggleSetting('${chatId}','admins_only_edit_info')">
              </div>
            </div>
            <div class="wa-gi-setting" onclick="window.groupToggleSetting('${chatId}','admins_only_send_msg')">
              <div>
                <div class="small fw-bold">Apenas admins enviam mensagens</div>
                <small class="text-muted">Modo anúncio</small>
              </div>
              <div class="form-check form-switch mb-0">
                <input class="form-check-input" type="checkbox" ${settings.admins_only_send_msg ? 'checked' : ''} onclick="event.stopPropagation();window.groupToggleSetting('${chatId}','admins_only_send_msg')">
              </div>
            </div>
            <div class="wa-gi-setting" onclick="window.groupToggleSetting('${chatId}','admins_only_add_members')">
              <div>
                <div class="small fw-bold">Apenas admins adicionam membros</div>
                <small class="text-muted">Restringir convites</small>
              </div>
              <div class="form-check form-switch mb-0">
                <input class="form-check-input" type="checkbox" ${settings.admins_only_add_members ? 'checked' : ''} onclick="event.stopPropagation();window.groupToggleSetting('${chatId}','admins_only_add_members')">
              </div>
            </div>
          </div>` : ''}

          <!-- Participantes -->
          <div class="wa-gi-section">
            <div class="wa-gi-section-title d-flex justify-content-between align-items-center">
              <span><i class="bi bi-people-fill me-2"></i>${participantIds.length} participantes</span>
              ${isAdmin ? `<button class="btn btn-sm btn-outline-success" onclick="window.groupAddMembers('${chatId}')" style="font-size:0.75rem;"><i class="bi bi-person-plus me-1"></i>Adicionar</button>` : ''}
            </div>
            <div class="wa-gi-search">
              <i class="bi bi-search"></i>
              <input type="text" placeholder="Buscar participante..." oninput="window.filterGroupParticipants(this.value)">
            </div>
            <div id="groupParticipantsList" class="wa-gi-participants">
              ${participantRows}
            </div>
          </div>

          <!-- Ações do grupo -->
          <div class="wa-gi-section">
            <button class="btn btn-outline-warning w-100 mb-2" onclick="window.groupLeave('${chatId}')">
              <i class="bi bi-box-arrow-left me-2"></i>Sair do grupo
            </button>
            ${isAdmin ? `
            <button class="btn btn-outline-danger w-100" onclick="window.groupDelete('${chatId}')">
              <i class="bi bi-trash me-2"></i>Excluir grupo
            </button>` : ''}
          </div>
        </div>
      </div>`;

    container.classList.remove('d-none');
    container.style.display = '';
    // Animação de entrada
    requestAnimationFrame(() => {
      const panel = container.querySelector('.wa-gi-panel');
      if (panel) panel.classList.add('wa-gi-open');
    });

  } catch (e) {
    console.error('Erro ao carregar informações do grupo:', e);
    showToast('Erro ao carregar informações.', 'error');
  }
};

/** Fecha o painel de informações do grupo */
window.closeGroupInfo = function () {
  const container = document.getElementById('groupInfoContainer');
  if (container) {
    const panel = container.querySelector('.wa-gi-panel');
    if (panel) panel.classList.remove('wa-gi-open');
    setTimeout(() => { container.classList.add('d-none'); }, 300);
  }
};

// ---------------------------------------------------------------
// 4.5 EDIÇÃO DE DADOS DO GRUPO EM MODAL (nome + foto + descrição)
//     Substitui a abertura do painel lateral (openGroupInfo) por um
//     modal no mesmo estilo do modal de criação de grupo.
// ---------------------------------------------------------------
let _editGroupAvatarUrl = '';
let _editGroupChatId = null;
let _editGroupIsAdmin = false;
let _editGroupCreatorId = null;
let _editGroupSelectedMembers = {};   // { userId: true } - estado atual da seleção (participantes atuais + adicionados)
let _editGroupOriginalParticipants = []; // ids que já estavam no grupo ao abrir o modal
let _editGroupAllUsersCache = [];     // todos os usuários do sistema (para busca/seleção)

/** Abre o modal de edição de dados do grupo */
window.openEditGroupModal = async function (chatId) {
  const user = getSavedUser();
  if (!user || !chatId) return;

  try {
    const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
    const chat = chatResult?.[0];
    if (!chat || !isGroupChat(chat)) return;

    const meta = getGroupMeta(chat);
    const groupName = meta?.groupName || chat.seller_name || 'Grupo';
    const groupAvatar = meta?.groupAvatar || chat.group_avatar || '';

    _editGroupChatId = chatId;
    _editGroupAvatarUrl = groupAvatar;
    _editGroupIsAdmin = isGroupAdmin(chat, user.id);
    _editGroupCreatorId = getGroupCreator(chat);
    _editGroupOriginalParticipants = (chat.participants || []).map(String);
    _editGroupSelectedMembers = {};
    _editGroupOriginalParticipants.forEach(id => { _editGroupSelectedMembers[id] = true; });

    const preview = document.getElementById('editGroupAvatarPreview');
    const linkInput = document.getElementById('editGroupAvatarLink');
    const nameInput = document.getElementById('editGroupNameInput');
    if (preview) preview.src = groupAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(groupName)}&background=00A884&color=fff&size=80&bold=true`;
    if (linkInput) linkInput.value = groupAvatar;
    if (nameInput) nameInput.value = groupName;

    const searchInput = document.getElementById('editGroupMemberSearch');
    if (searchInput) searchInput.value = '';

    const modalEl = document.getElementById('editGroupModal');
    const modal = window.bootstrap ? bootstrap.Modal.getOrCreateInstance(modalEl) : null;
    modal?.show();

    const listEl = document.getElementById('editGroupParticipantsList');
    if (listEl) listEl.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm text-success"></div></div>';

    const allUsers = await supabaseFetch('users?select=id,nome,avatar&order=nome.asc');
    _editGroupAllUsersCache = allUsers || [];
    _renderEditGroupMemberList();
  } catch (e) {
    console.error('Erro ao carregar dados do grupo:', e);
    showToast('Erro ao carregar dados do grupo.', 'error');
  }
};

/** Renderiza a lista de pessoas do modal de edição (mesmo estilo do modal de criar grupo).
 *  Quem já está no grupo aparece pré-selecionado; para adicionar, basta selecionar mais. */
function _renderEditGroupMemberList(query) {
  const listEl = document.getElementById('editGroupParticipantsList');
  const countEl = document.getElementById('editGroupParticipantsCount');
  if (!listEl) return;

  const user = getSavedUser();
  const q = (query || '').trim().toLowerCase();
  const users = _editGroupAllUsersCache.filter(u => !q || (u.nome || '').toLowerCase().includes(q));

  if (!users.length) {
    listEl.innerHTML = '<div class="text-center py-4 text-muted small">Ninguém encontrado.</div>';
  } else {
    listEl.innerHTML = users.map(u => {
      const id = String(u.id);
      const checked = !!_editGroupSelectedMembers[id];
      const isMe = String(user?.id) === id;
      const isCreator = _editGroupCreatorId && String(_editGroupCreatorId) === id;
      // Você mesmo não pode se remover por aqui (use "Sair do grupo"), e só admin mexe na lista.
      const locked = isMe || !_editGroupIsAdmin;
      return `
      <div class="ca-cat-list-item${checked ? ' ca-cat-list-item-selected' : ''}" style="${locked ? 'cursor:default;opacity:' + (isMe ? '1' : '0.85') + ';' : ''}" ${locked ? '' : `onclick="window.toggleEditGroupMember('${id}')"`}>
        <div class="d-flex align-items-center gap-2">
          <div style="width:8px;height:8px;border-radius:50%;background:#00A884;flex-shrink:0;${checked ? '' : 'display:none;'}"></div>
          ${u.nome || 'Usuário'}${isMe ? ' <span class="text-muted small">(você)</span>' : ''}${isCreator ? ' <i class="bi bi-star-fill text-warning" title="Criador" style="font-size:0.7rem;"></i>' : ''}
        </div>
      </div>`;
    }).join('');
  }

  const count = Object.keys(_editGroupSelectedMembers).length;
  if (countEl) countEl.textContent = `${count} participante${count !== 1 ? 's' : ''} selecionado${count !== 1 ? 's' : ''}`;
}

/** Filtro de busca na lista de pessoas do modal de edição */
window.filterEditGroupMembers = function (query) {
  _renderEditGroupMemberList(query);
};

/** Alterna seleção de uma pessoa no modal de edição (adiciona/remove do grupo ao salvar) */
window.toggleEditGroupMember = function (userId) {
  if (!_editGroupIsAdmin) { showToast('Só administradores podem alterar os participantes.', 'warning'); return; }
  const id = String(userId);
  if (_editGroupSelectedMembers[id]) {
    delete _editGroupSelectedMembers[id];
  } else {
    _editGroupSelectedMembers[id] = true;
  }
  const searchInput = document.getElementById('editGroupMemberSearch');
  _renderEditGroupMemberList(searchInput?.value || '');
};

/** Upload de nova foto do grupo dentro do modal de edição */
window.uploadEditGroupModalAvatar = function (input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    const preview = document.getElementById('editGroupAvatarPreview');
    if (preview) preview.src = e.target.result;
    _uploadToImgur(file).then(url => {
      if (url) {
        _editGroupAvatarUrl = url;
        const linkInput = document.getElementById('editGroupAvatarLink');
        if (linkInput) linkInput.value = url;
        if (preview) preview.src = url;
      }
    }).catch(() => {});
  };
  reader.readAsDataURL(file);
};

/** Usa o link colado no campo "Link da foto" como avatar do grupo */
window.setEditGroupModalAvatarFromLink = function (url) {
  url = (url || '').trim();
  _editGroupAvatarUrl = url;
  const preview = document.getElementById('editGroupAvatarPreview');
  if (preview && url) preview.src = url;
};

/** Salva nome/foto/descrição do grupo a partir do modal de edição */
window.saveEditGroupModal = async function () {
  const chatId = _editGroupChatId;
  if (!chatId) return;

  const nameInput = document.getElementById('editGroupNameInput');
  const newName = (nameInput?.value || '').trim();
  if (!newName) { showToast('Dê um nome para o grupo.', 'warning'); return; }

  try {
    const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
    const chat = chatResult?.[0];
    if (!chat) { showToast('Erro ao carregar grupo.', 'error'); return; }

    const meta = getGroupMeta(chat) || chat.messages[0];
    const user = getSavedUser();
    const nameChanged = meta.groupName !== newName;

    meta.groupName = newName;
    meta.groupAvatar = _editGroupAvatarUrl || '';

    if (nameChanged) await addSystemMessage(chat, `${user.nome} alterou o nome do grupo para "${newName}"`, 'group_renamed');

    // ---- Aplica mudanças de participantes feitas na lista de seleção ----
    let participantsChanged = false;
    if (_editGroupIsAdmin) {
      const currentParticipants = (chat.participants || []).map(String);
      const selectedIds = Object.keys(_editGroupSelectedMembers);
      const toAdd = selectedIds.filter(id => !currentParticipants.includes(id));
      const toRemove = _editGroupOriginalParticipants.filter(id => !_editGroupSelectedMembers[id]);

      let participants = currentParticipants.slice();
      toAdd.forEach(id => {
        if (!participants.includes(id)) {
          participants.push(id);
          const nome = _editGroupAllUsersCache.find(u => String(u.id) === id)?.nome || 'Alguém';
          chat.messages.push({ senderId: 'system', text: `${user.nome} adicionou ${nome}`, timestamp: new Date().toISOString(), type: 'system', systemType: 'member_added' });
        }
      });
      toRemove.forEach(id => {
        participants = participants.filter(p => String(p) !== id);
        meta.groupAdmins = (meta.groupAdmins || []).filter(a => String(a) !== id);
        const nome = _editGroupAllUsersCache.find(u => String(u.id) === id)?.nome || 'Um participante';
        chat.messages.push({ senderId: 'system', text: `${nome} foi removido do grupo por ${user.nome}`, timestamp: new Date().toISOString(), type: 'system', systemType: 'member_removed' });
      });
      participantsChanged = toAdd.length > 0 || toRemove.length > 0;
      chat.participants = participants;
    }

    const extraFields = { seller_name: newName };
    if (participantsChanged) extraFields.participants = chat.participants;
    await updateGroupMeta(chat, meta, extraFields);

    showToast('Dados do grupo atualizados!', 'success');

    // Atualiza o cabeçalho do chat aberto, se for o caso
    const msgsId = `dmsgs_${chatId}`;
    const headerAvatar = document.getElementById(`${msgsId}Avatar`);
    if (headerAvatar) headerAvatar.src = _editGroupAvatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(newName)}&background=00A884&color=fff&bold=true`;
    const headerNameEl = headerAvatar?.closest('.chat-header-pro')?.querySelector('.chat-header-name');
    if (headerNameEl) headerNameEl.textContent = newName;

    const modalEl = document.getElementById('editGroupModal');
    const modal = window.bootstrap ? bootstrap.Modal.getInstance(modalEl) : null;
    modal?.hide();

    window.renderDirectChats?.({ skipBoot: true });
    if (window.currentChat === chatId) {
      setTimeout(() => window.openDirectChat(chatId), 200);
    }
  } catch (e) {
    console.error('Erro ao salvar dados do grupo:', e);
    showToast('Erro ao salvar dados do grupo.', 'error');
  }
};

// ---------------------------------------------------------------
// 5. ADMINISTRAÇÃO DO GRUPO
// ---------------------------------------------------------------

/** Atualiza a meta do grupo (messages[0]) no banco */
async function updateGroupMeta(chat, newMeta, extraFields) {
  if (!chat || !newMeta) return;
  newMeta.groupType = 'group';
  newMeta.type = newMeta.type || 'direct_chat_meta';
  chat.messages[0] = newMeta;
  const payload = { messages: chat.messages, ...(extraFields || {}) };
  await supabaseFetch(`chats?id=eq.${chat.id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

/** Adiciona uma mensagem de sistema e persiste */
async function addSystemMessage(chat, text, systemType) {
  chat.messages.push({
    senderId: 'system', text, timestamp: new Date().toISOString(),
    type: 'system', systemType
  });
}

/** Promover a administrador */
window.groupPromoteAdmin = async function (chatId, userId) {
  const user = getSavedUser();
  if (!user || !chatId || !userId) return;
  try {
    const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
    const chat = chatResult?.[0];
    if (!chat || !isGroupAdmin(chat, user.id)) return;
    const meta = getGroupMeta(chat);
    const admins = meta?.groupAdmins || [];
    if (admins.some(a => String(a) === String(userId))) { showToast('Já é admin.', 'info'); return; }
    admins.push(userId);
    meta.groupAdmins = admins;
    await addSystemMessage(chat, `${user.nome} promoveu um participante a administrador`, 'admin_promoted');
    await updateGroupMeta(chat, meta);
    showToast('Administrador promovido.', 'success');
    window.closeGroupInfo();
    setTimeout(() => window.openGroupInfo(chatId), 300);
  } catch (e) { showToast('Erro ao promover admin.', 'error'); }
};

/** Remover administrador */
window.groupDemoteAdmin = async function (chatId, userId) {
  const user = getSavedUser();
  if (!user || !chatId || !userId) return;
  try {
    const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
    const chat = chatResult?.[0];
    if (!chat || !isGroupAdmin(chat, user.id)) return;
    const meta = getGroupMeta(chat);
    if (!meta) return;
    meta.groupAdmins = (meta.groupAdmins || []).filter(a => String(a) !== String(userId));
    await addSystemMessage(chat, `${user.nome} removeu administrador`, 'admin_demoted');
    await updateGroupMeta(chat, meta);
    showToast('Admin removido.', 'info');
    window.closeGroupInfo();
    setTimeout(() => window.openGroupInfo(chatId), 300);
  } catch (e) { showToast('Erro ao remover admin.', 'error'); }
};

/** Editar nome do grupo */
window.groupEditName = async function (chatId) {
  const newName = prompt('Novo nome do grupo:');
  if (!newName || !newName.trim()) return;
  try {
    const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
    const chat = chatResult?.[0];
    if (!chat) return;
    const user = getSavedUser();
    const meta = getGroupMeta(chat);
    if (!meta) return;
    meta.groupName = newName.trim();
    chat.seller_name = newName.trim();
    chat.messages[0] = meta;
    await addSystemMessage(chat, `${user.nome} alterou o nome do grupo para "${newName.trim()}"`, 'group_renamed');
    await supabaseFetch(`chats?id=eq.${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ seller_name: newName.trim(), messages: chat.messages })
    });
    showToast('Nome do grupo alterado.', 'success');
    window.closeGroupInfo();
    if (window.currentChat === chatId) {
      setTimeout(() => window.openDirectChat(chatId), 200);
    }
  } catch (e) { showToast('Erro ao alterar nome.', 'error'); }
};

/** Alternar configuração do grupo */
window.groupToggleSetting = async function (chatId, setting) {
  try {
    const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
    const chat = chatResult?.[0];
    if (!chat) return;
    const meta = getGroupMeta(chat);
    if (!meta) return;
    if (!meta.groupSettings) meta.groupSettings = {};
    meta.groupSettings[setting] = !meta.groupSettings[setting];
    await updateGroupMeta(chat, meta);
  } catch (e) { showToast('Erro ao alterar configuração.', 'error'); }
};

/** Alterar foto do grupo */
window.groupChangePhoto = async function (chatId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async function (e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await _uploadToImgur(file);
    if (!url) { showToast('Erro ao fazer upload da foto.', 'error'); return; }
    try {
      const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
      const chat = chatResult?.[0];
      if (!chat) return;
      const meta = getGroupMeta(chat);
      const user = getSavedUser();
      meta.groupAvatar = url;
      await addSystemMessage(chat, `${user.nome} alterou a foto do grupo`, 'photo_changed');
      await updateGroupMeta(chat, meta);
      showToast('Foto do grupo alterada.', 'success');
      window.closeGroupInfo();
      if (window.currentChat === chatId) {
        setTimeout(() => window.openDirectChat(chatId), 200);
      }
    } catch (e) { showToast('Erro ao alterar foto.', 'error'); }
  };
  input.click();
};

// ---------------------------------------------------------------
// 6. PARTICIPANTES
// ---------------------------------------------------------------

/** Adicionar membros ao grupo */
window.groupAddMembers = async function (chatId) {
  const user = getSavedUser();
  if (!user || !chatId) return;
  try {
    const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
    const chat = chatResult?.[0];
    if (!chat) return;
    const settings = getGroupSettings(chat);
    if (!isGroupAdmin(chat, user.id) && settings.admins_only_add_members !== false) {
      showToast('Só administradores podem adicionar membros.', 'warning');
      return;
    }

    const currentParticipants = (chat.participants || []).map(String);
    const allUsers = await supabaseFetch('users?select=id,nome,avatar&order=nome.asc');
    const available = allUsers.filter(u => !currentParticipants.includes(String(u.id)));

    if (!available.length) { showToast('Todos os usuários já estão no grupo.', 'info'); return; }

    // Modal de seleção simples
    const modalHtml = `
      <div class="modal fade" id="groupAddMemberModal" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h6 class="modal-title"><i class="bi bi-person-plus me-2" style="color:${GROUP_COLOR};"></i>Adicionar participantes</h6>
              <button type="button" class="ml-auth-close" data-bs-dismiss="modal" style="border-radius:50%;width:34px;height:34px;font-size:0.9rem;"><i class="bi bi-x-lg"></i></button>
            </div>
            <div class="modal-body">
              <input type="text" id="groupAddMemberSearch" class="form-control form-control-sm mb-2" placeholder="Buscar..." oninput="window._filterGroupAddMembers(this.value)">
              <div id="groupAddMemberList" class="wa-group-member-list"></div>
            </div>
            <div class="modal-footer">
              <button type="button" class="ml-btn ml-btn-outline" data-bs-dismiss="modal">Cancelar</button>
              <button type="button" class="ml-btn ml-btn-primary" onclick="window._confirmAddMembers('${chatId}')"><i class="bi bi-check2 me-1"></i>Adicionar</button>
            </div>
          </div>
        </div>
      </div>`;

    let existing = document.getElementById('groupAddMemberModal');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    window._groupAddSelected = {};
    window._groupAddAvailable = available;

    _renderAddMemberList();

    const modal = new bootstrap.Modal(document.getElementById('groupAddMemberModal'));
    modal.show();

  } catch (e) { showToast('Erro ao carregar usuários.', 'error'); }
};

function _renderAddMemberList(query) {
  const list = document.getElementById('groupAddMemberList');
  if (!list) return;
  const q = (query || '').trim().toLowerCase();
  const users = window._groupAddAvailable.filter(u => !q || (u.nome || '').toLowerCase().includes(q));
  if (!users.length) {
    list.innerHTML = '<div class="text-center py-4 text-muted small">Ninguém encontrado.</div>';
    return;
  }
  list.innerHTML = users.map(u => {
    const avatar = normalizeImageUrl(safeParseImages(u.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.nome || 'User')}&background=random&size=40`;
    const checked = !!window._groupAddSelected[u.id];
    return `
    <div class="wa-group-member-row${checked ? ' selected' : ''}" onclick="window._toggleGroupAddMember('${u.id}')">
      <input type="checkbox" class="form-check-input" ${checked ? 'checked' : ''} onclick="event.stopPropagation();window._toggleGroupAddMember('${u.id}')">
      <img src="${avatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&size=40'">
      <span class="small">${u.nome || 'Usuário'}</span>
    </div>`;
  }).join('');
}

window._toggleGroupAddMember = function (userId) {
  if (window._groupAddSelected[userId]) {
    delete window._groupAddSelected[userId];
  } else {
    window._groupAddSelected[userId] = true;
  }
  const search = document.getElementById('groupAddMemberSearch');
  _renderAddMemberList(search?.value || '');
};

window._filterGroupAddMembers = function (query) {
  _renderAddMemberList(query);
};

window._confirmAddMembers = async function (chatId) {
  const user = getSavedUser();
  const selected = Object.keys(window._groupAddSelected);
  if (!selected.length) { showToast('Selecione pelo menos um participante.', 'warning'); return; }
  try {
    const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
    const chat = chatResult?.[0];
    if (!chat) return;
    let participants = chat.participants || [];
    const now = new Date().toISOString();
    selected.forEach(id => {
      if (!participants.some(p => String(p) === String(id))) {
        participants.push(id);
        const nome = window._groupAddAvailable.find(u => String(u.id) === String(id))?.nome || 'Alguém';
        chat.messages.push({
          senderId: 'system',
          text: `${user.nome} adicionou ${nome}`,
          timestamp: now,
          type: 'system',
          systemType: 'member_added'
        });
      }
    });
    chat.participants = participants;
    await supabaseFetch(`chats?id=eq.${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ participants, messages: chat.messages })
    });
    bootstrap.Modal.getInstance(document.getElementById('groupAddMemberModal'))?.hide();
    showToast(`${selected.length} participante${selected.length > 1 ? 's' : ''} adicionado${selected.length > 1 ? 's' : ''}.`, 'success');
    window.closeGroupInfo();
  } catch (e) { showToast('Erro ao adicionar.', 'error'); }
};

/** Remover membro do grupo */
window.groupRemoveMember = async function (chatId, userId, userName) {
  if (!confirm(`Remover ${userName || 'este participante'} do grupo?`)) return;
  const user = getSavedUser();
  try {
    const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
    const chat = chatResult?.[0];
    if (!chat) return;
    if (!isGroupAdmin(chat, user.id)) { showToast('Só administradores podem remover membros.', 'warning'); return; }
    const meta = getGroupMeta(chat);
    chat.participants = (chat.participants || []).filter(p => String(p) !== String(userId));
    if (meta) {
      meta.groupAdmins = (meta.groupAdmins || []).filter(a => String(a) !== String(userId));
      chat.messages[0] = meta;
    }
    await addSystemMessage(chat, `${userName || 'Um participante'} foi removido do grupo por ${user.nome}`, 'member_removed');
    await supabaseFetch(`chats?id=eq.${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ participants: chat.participants, messages: chat.messages })
    });
    showToast(`${userName || 'Participante'} removido.`, 'info');
    window.closeGroupInfo();
    if (window.currentChat === chatId) {
      setTimeout(() => window.openDirectChat(chatId), 200);
    }
  } catch (e) { showToast('Erro ao remover.', 'error'); }
};

/** Sair do grupo */
window.groupLeave = async function (chatId) {
  if (!confirm('Tem certeza que deseja sair deste grupo?')) return;
  const user = getSavedUser();
  try {
    const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
    const chat = chatResult?.[0];
    if (!chat) return;
    const meta = getGroupMeta(chat);
    chat.participants = (chat.participants || []).filter(p => String(p) !== String(user.id));
    if (meta) {
      meta.groupAdmins = (meta.groupAdmins || []).filter(a => String(a) !== String(user.id));
      chat.messages[0] = meta;
    }
    addLeftGroupLocally(chatId);
    await addSystemMessage(chat, `${user.nome} saiu do grupo`, 'member_left');
    await supabaseFetch(`chats?id=eq.${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ participants: chat.participants, messages: chat.messages })
    });
    showToast('Você saiu do grupo.', 'info');
    window.closeGroupInfo();
    window.closeDirectChat();
    window.renderDirectChats({ skipBoot: true });
  } catch (e) { showToast('Erro ao sair do grupo.', 'error'); }
};

/** Excluir grupo (só criador) */
window.groupDelete = async function (chatId) {
  if (!confirm('Tem certeza que deseja excluir este grupo?\nEssa ação não pode ser desfeita.')) return;
  const user = getSavedUser();
  try {
    const chatResult = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
    const chat = chatResult?.[0];
    if (!chat) return;
    if (!isGroupAdmin(chat, user.id)) { showToast('Só administradores podem excluir o grupo.', 'warning'); return; }
    await supabaseFetch(`chats?id=eq.${chatId}`, { method: 'DELETE' });
    showToast('Grupo excluído.', 'info');
    window.closeGroupInfo();
    window.closeDirectChat();
    window.renderDirectChats({ skipBoot: true });
  } catch (e) { showToast('Erro ao excluir grupo.', 'error'); }
};

// ---------------------------------------------------------------
// 7. LINK DE CONVITE
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// 8. FILTRO DE PARTICIPANTES NA TELA DE INFO
// ---------------------------------------------------------------

window.filterGroupParticipants = function (query) {
  const q = (query || '').trim().toLowerCase();
  const list = document.getElementById('groupParticipantsList');
  if (!list) return;
  list.querySelectorAll('.wa-gi-participant').forEach(el => {
    const name = el.querySelector('strong')?.textContent?.toLowerCase() || '';
    el.style.display = !q || name.includes(q) ? '' : 'none';
  });
};

// ---------------------------------------------------------------
// 9. CORES DO AVATAR (click handlers)
// ---------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
  const colors = document.getElementById('groupAvatarColors');
  if (colors) {
    colors.querySelectorAll('[data-color]').forEach(el => {
      el.addEventListener('click', function () {
        const c = this.dataset.color;
        const preview = document.getElementById('newGroupAvatarPreview');
        const placeholder = document.getElementById('newGroupAvatarPlaceholder');
        if (preview) {
          preview.src = `https://ui-avatars.com/api/?name=G&background=${c}&color=fff&size=80`;
          preview.classList.remove('d-none');
        }
        if (placeholder) placeholder.classList.add('d-none');
      });
    });
  }
});

// ---------------------------------------------------------------
// 10. INTEGRAÇÃO — ADICIONA BOTÃO INFO NO HEADER DO CHAT
// ---------------------------------------------------------------

window._initGroupUI = function () {
  const origOpenDirectChat = window.openDirectChat;
  if (!window._groupPatched && typeof origOpenDirectChat === 'function') {
    window._origOpenDirectChat = origOpenDirectChat;
    window.openDirectChat = async function (chatId) {
      await window._origOpenDirectChat(chatId);
      setTimeout(() => {
        try {
          const chatActive = document.getElementById('waChatActive');
          if (!chatActive || chatActive.classList.contains('d-none')) return;
          const header = chatActive.querySelector('.chat-header');
          if (!header || header.querySelector('[data-group-info-btn]')) return;
          const chatEl = document.querySelector(`.wa-contact[data-direct-chat-id="${chatId}"]`);
          const isGroup = chatEl?.querySelector('.wa-group-badge');
          if (!isGroup) return;
          // Não adiciona botão info para a Comunidade ou DuckDuckGo
          const isSpecial = chatEl?.dataset?.contactName === 'comunidade electromarket' || chatEl?.dataset?.contactName === 'duckduckgo';
          if (isGroup && !isSpecial) {
            const actionsDiv = header.querySelector('.d-flex.align-items-center.gap-1');
            if (actionsDiv) {
              const infoBtn = document.createElement('button');
              infoBtn.type = 'button';
              infoBtn.className = 'chat-icon-btn';
              infoBtn.setAttribute('data-group-info-btn', '');
              infoBtn.innerHTML = '<i class="bi bi-info-circle"></i>';
              infoBtn.title = 'Informações do grupo';
              infoBtn.onclick = async () => await window.openEditGroupModal(chatId);
              actionsDiv.prepend(infoBtn);
            }
          }
        } catch (e) { /* silencioso */ }
      }, 300);
    };
    window._groupPatched = true;
  }
};

// Inicializa após carregamento
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window._initGroupUI);
} else {
  window._initGroupUI();
}

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
        const creatorId = directMeta?.createdBy ? String(directMeta.createdBy) : null;
        const me = getSavedUser();
        const isAdmin = !!(directMeta?.groupAdmins || []).map(String).includes(String(me?.id));

        const groupName = directMeta?.groupName || chat.seller_name || 'Grupo';
        const groupAvatar = directMeta?.groupAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(groupName)}&background=00A884&color=fff&bold=true`;

        const groupHeaderHtml = `
        <div class="chat-group-info-header" id="dGroupInfoView_${chatId}">
            <img src="${groupAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(groupName)}&background=00A884&color=fff&bold=true'">
            <div class="chat-group-info-name">${groupName}</div>
            ${isAdmin ? `<button type="button" class="profile-link-icon" style="width:30px;height:30px;" title="Editar dados do grupo" onclick="window.startEditGroupInfo('${chatId}')"><i class="bi bi-pencil-fill" style="font-size:0.75rem;"></i></button>` : ''}
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
        panel.dataset.groupName = groupName;
        panel.dataset.groupAvatar = groupAvatar;
    } catch (e) {
        console.error('Erro ao carregar participantes:', e);
        panel.innerHTML = '<div class="small text-danger px-1">Erro ao carregar participantes.</div>';
    }
};

/** Troca o cabeçalho do painel "Dados do grupo" para o modo de edição
 *  (nome + foto), permitindo alterar de verdade as informações do grupo. */
window._groupEditAvatarUrls = window._groupEditAvatarUrls || {};
window.startEditGroupInfo = function(chatId) {
    const panel = document.getElementById(`dparticipants_${chatId}`);
    const view = document.getElementById(`dGroupInfoView_${chatId}`);
    if (!panel || !view) return;

    const currentName = panel.dataset.groupName || '';
    const currentAvatar = panel.dataset.groupAvatar || '';
    window._groupEditAvatarUrls[chatId] = currentAvatar;

    view.outerHTML = `
    <div class="chat-group-info-header chat-group-info-edit" id="dGroupInfoView_${chatId}">
        <div class="text-center mb-2">
            <div class="position-relative d-inline-block">
                <img id="dGroupEditAvatarPreview_${chatId}" src="${currentAvatar}" class="rounded-circle border" style="width:64px;height:64px;object-fit:cover;border:3px solid #00A884;" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(currentName)}&background=00A884&color=fff&bold=true'">
                <label class="position-absolute bottom-0 end-0 bg-success rounded-circle d-flex align-items-center justify-content-center" style="width:22px;height:22px;cursor:pointer;border:2px solid #fff;">
                    <i class="bi bi-plus text-white" style="font-size:0.7rem;"></i>
                    <input type="file" accept="image/*" hidden onchange="window.uploadEditGroupAvatar(this, '${chatId}')">
                </label>
            </div>
        </div>
        <div class="profile-link-inline mb-2">
            <button type="button" class="profile-link-icon" onclick="window.abrirUploadExterno()" title="Subir no Imgur">
                <i class="bi bi-box-arrow-up-right"></i>
            </button>
            <label class="profile-link-icon profile-link-icon-ghost" style="cursor:pointer;" title="Escolher do PC">
                <i class="bi bi-cloud-upload"></i>
                <input type="file" accept="image/*" hidden onchange="window.uploadEditGroupAvatar(this, '${chatId}')">
            </label>
            <div class="ml-field flex-grow-1 mb-0">
                <input type="url" id="dGroupEditAvatarLink_${chatId}" placeholder=" " value="${currentAvatar.replace(/"/g, '&quot;')}" oninput="window._groupEditAvatarUrls['${chatId}']=this.value; document.getElementById('dGroupEditAvatarPreview_${chatId}').src=this.value;">
                <label for="dGroupEditAvatarLink_${chatId}">Link da foto (opcional)</label>
            </div>
        </div>
        <div class="ml-field mb-2">
            <input type="text" id="dGroupEditNameInput_${chatId}" placeholder=" " maxlength="60" value="${currentName.replace(/"/g, '&quot;')}">
            <label for="dGroupEditNameInput_${chatId}">Nome do grupo</label>
        </div>
        <div class="d-flex gap-2">
            <button type="button" class="ml-btn ml-btn-primary flex-grow-1" onclick="window.saveEditGroupInfo('${chatId}')"><i class="bi bi-check2 me-1"></i>Salvar</button>
            <button type="button" class="ml-btn ml-btn-outline flex-grow-1" onclick="window.toggleDirectChatParticipants('${chatId}', true)"><i class="bi bi-x-lg me-1"></i>Cancelar</button>
        </div>
    </div>`;
};

/** Upload de nova foto do grupo direto no modo de edição do painel "Dados do grupo". */
window.uploadEditGroupAvatar = function(input, chatId) {
    const file = input?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const preview = document.getElementById(`dGroupEditAvatarPreview_${chatId}`);
        if (preview) preview.src = e.target.result;
        _uploadToImgur(file).then(url => {
            if (url) {
                window._groupEditAvatarUrls[chatId] = url;
                const linkInput = document.getElementById(`dGroupEditAvatarLink_${chatId}`);
                if (linkInput) linkInput.value = url;
                if (preview) preview.src = url;
            }
        }).catch(() => {});
    };
    reader.readAsDataURL(file);
};

/** Salva de verdade o nome/foto do grupo (PATCH no chat) e atualiza cabeçalho, painel e lista lateral. */
window.saveEditGroupInfo = async function(chatId) {
    const nameInput = document.getElementById(`dGroupEditNameInput_${chatId}`);
    const newName = (nameInput?.value || '').trim();
    if (!newName) { showToast('Dê um nome para o grupo.', 'warning'); return; }
    const newAvatar = window._groupEditAvatarUrls[chatId] || '';

    try {
        const chatData = await supabaseFetch(`chats?id=eq.${chatId}&limit=1`);
        const chat = chatData?.[0];
        if (!chat || chat.messages?.[0]?.type !== 'direct_chat_meta') { showToast('Erro ao carregar grupo.', 'error'); return; }

        chat.messages[0].groupName = newName;
        chat.messages[0].groupAvatar = newAvatar;
        await supabaseFetch(`chats?id=eq.${chatId}`, { method: 'PATCH', body: JSON.stringify({ messages: chat.messages, seller_name: newName }) });

        showToast('Dados do grupo atualizados!', 'success');

        // Atualiza o cabeçalho da conversa aberta (avatar + nome)
        const msgsId = `dmsgs_${chatId}`;
        const headerAvatar = document.getElementById(`${msgsId}Avatar`);
        if (headerAvatar) headerAvatar.src = newAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(newName)}&background=00A884&color=fff&bold=true`;
        const headerNameEl = headerAvatar?.closest('.chat-header-pro')?.querySelector('.chat-header-name');
        if (headerNameEl) headerNameEl.textContent = newName;

        // Recarrega o painel (volta pro modo de visualização) e a lista lateral
        await window.toggleDirectChatParticipants(chatId, true);
        window.renderDirectChats?.({ skipBoot: true });
    } catch (e) {
        console.error('Erro ao salvar dados do grupo:', e);
        showToast('Erro ao salvar dados do grupo.', 'error');
    }
};

window.openDirectChat = async function(chatId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }
    // Saindo das Threads (Comunidade) para uma conversa privada: restaura a
    // lateral de contatos, que fica escondida enquanto a Comunidade está aberta.
    document.getElementById('whatsappOrdersView')?.classList.remove('wa-community-mode');
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
                onAddMember: isGroup ? `window.groupAddMembers('${chatId}')` : '',
                onLeaveGroup: isGroup ? `window.groupLeave('${chatId}')` : '',
                onClearChat: `window.clearDirectChat('${chatId}')`,
            });

        const panel = document.getElementById('waChatActive');
        if (panel) {
            panel.innerHTML = html;
            panel.classList.remove('d-none', 'tw-chat-community', 'community-active');
            panel.classList.add('d-flex');

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
            ? (chat.messages?.[0]?.groupAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(chat.messages?.[0]?.groupName || chat.seller_name || 'Grupo')}&background=00A884&color=fff&size=40&bold=true`)
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

