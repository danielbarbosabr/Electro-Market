// ============================================
// COMUNIDADE ElectroMarket — FEED ESTILO TWITTER
// (antes era um grupo de chat estilo WhatsApp com todo mundo;
//  agora é um feed de posts com curtidas, respostas e perfis,
//  igual ao modelo de um Twitter clone: https://github.com/AnkitYande/TwitterCopy)
// ============================================

window._twPendingImage = null;
window._twPostsCache = {};

function twEscape(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function twTimeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Math.max(0, (Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'agora';
    if (diff < 3600) return `${Math.floor(diff / 60)}min`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function twAvatarUrl(u) {
    return normalizeImageUrl(safeParseImages(u?.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(u?.nome || 'User')}&background=1d9bf0&color=fff`;
}

// ------------------------------------------------------------------
// Armazenamento da Comunidade — usa a tabela `chats` (a mesma dos
// papos normais), em vez da `app_data`. Cada thread (post original +
// respostas) vira UMA linha em `chats`, exatamente como um chat normal
// tem um cabeçalho ("Fulano · N mensagens") e um array `messages`: o
// post original é a messages[0] (id da mensagem = id da própria linha)
// e cada resposta (direta ou aninhada) é adicionada ao mesmo array,
// guardando `parentId` (o id da mensagem/post a que está respondendo)
// para manter a árvore de respostas.
//
// `order_id` recebe um valor ÚNICO por linha (prefixo + id da própria
// linha, ex.: "community_post_3f9a...") em vez de um texto fixo repetido
// — assim nunca colide com um eventual índice único em `order_id` (o
// mesmo motivo pelo qual chats diretos/grupos sempre usam order_id=null,
// nunca um texto fixo repetido). O prefixo ainda deixa fácil filtrar
// todas as linhas da Comunidade com "order_id=like.prefixo*", e como
// nenhum pedido real vai ter esse prefixo, não há risco de confundir
// com as conversas de pedido/diretas/grupos.
//
// "Seguir/deixar de seguir" também vira uma linha em `chats`, com o
// mesmo esquema de prefixo, usando as colunas que já existem:
// seller_id = quem é seguido, buyer_id = quem segue.
// ------------------------------------------------------------------

const TW_POST_PREFIX = 'community_post_';
const TW_FOLLOW_PREFIX = 'community_follow_';

/** Localiza a linha (thread) de `chats` que contém a mensagem/post com esse id
 *  — seja porque é o post original (id da linha) ou uma resposta guardada
 *  dentro do array `messages` dessa linha. */
async function twFindThreadRow(msgId) {
    if (!msgId) return null;
    const rootRows = await supabaseFetch(`chats?id=eq.${msgId}&select=*&limit=1`);
    if (rootRows?.[0]) return rootRows[0];
    const needle = encodeURIComponent(JSON.stringify([{ id: String(msgId) }]));
    const nestedRows = await supabaseFetch(`chats?id=like.${TW_POST_PREFIX}*&messages=cs.${needle}&select=*&limit=1`);
    return nestedRows?.[0] || null;
}

/** Converte uma mensagem (post ou resposta) dentro de uma linha `chats` de
 *  volta pro formato de "post" já usado pelo resto do código da Comunidade. */
function twMapPostRow(row, msgId) {
    if (!row) return null;
    const messages = Array.isArray(row.messages) ? row.messages : [];
    const msg = messages.find(m => String(m.id) === String(msgId)) || messages[0];
    if (!msg) return null;
    const repliesCount = messages.filter(m => m.parentId != null && String(m.parentId) === String(msg.id)).length;
    return {
        id: msg.id,
        author_id: msg.senderId,
        content: msg.text || '',
        image: msg.image || null,
        parent_id: msg.parentId ?? null,
        likes: Array.isArray(msg.likes) ? msg.likes : [],
        likesAt: msg.likesAt || {},
        reposts: Array.isArray(msg.reposts) ? msg.reposts : [],
        replies_count: repliesCount,
        created_at: msg.createdAt || row.created_at,
        _threadId: row.id
    };
}

/** Formata contagens grandes no estilo Threads (ex.: 1200 -> "1,2 mil") */
function twFormatCount(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 100000) {
        const v = (n / 1000).toFixed(1).replace('.', ',').replace(',0', '');
        return `${v} mil`;
    }
    return `${Math.round(n / 1000)} mil`;
}

/** Busca posts/respostas na Comunidade.
 *  params: { authorId, parentId: undefined|null|'not-null'|<id>, orderDir: 'asc'|'desc', limit, offset } */
async function twPostsQuery(params = {}) {
    const { authorId, parentId, orderDir = 'desc', limit, offset } = params;

    // Respostas diretas de um post específico (thread já conhecida).
    if (parentId !== undefined && parentId !== null && parentId !== 'not-null') {
        const row = await twFindThreadRow(parentId);
        if (!row) return [];
        const messages = Array.isArray(row.messages) ? row.messages : [];
        const result = messages
            .filter(m => m.parentId != null && String(m.parentId) === String(parentId))
            .map(m => twMapPostRow(row, m.id))
            .filter(Boolean);
        result.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        if (orderDir === 'desc') result.reverse();
        return result;
    }

    // Posts originais (raiz de cada thread) — cada um é a própria linha de `chats`.
    if (parentId === null) {
        let query = `chats?id=like.${TW_POST_PREFIX}*&select=*`;
        if (authorId) query += `&seller_id=eq.${authorId}`;
        query += `&order=created_at.${orderDir}`;
        if (limit) query += `&limit=${limit}`;
        if (offset) query += `&offset=${offset}`;
        const rows = await supabaseFetch(query);
        return (rows || []).map(row => twMapPostRow(row, row.messages?.[0]?.id)).filter(Boolean);
    }

    // Todas as respostas (de qualquer profundidade) de um autor, entre todas as threads.
    if (parentId === 'not-null' && authorId) {
        const needle = encodeURIComponent(JSON.stringify([{ senderId: String(authorId) }]));
        const rows = await supabaseFetch(`chats?id=like.${TW_POST_PREFIX}*&messages=cs.${needle}&select=*`);
        const result = [];
        (rows || []).forEach(row => {
            const messages = Array.isArray(row.messages) ? row.messages : [];
            messages
                .filter(m => m.parentId != null && String(m.senderId) === String(authorId))
                .forEach(m => { const p = twMapPostRow(row, m.id); if (p) result.push(p); });
        });
        result.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        if (orderDir === 'desc') result.reverse();
        return result;
    }

    return [];
}

async function twPostsGet(id) {
    if (!id) return null;
    const row = await twFindThreadRow(id);
    if (!row) return null;
    return twMapPostRow(row, id);
}

async function twPostCreate({ author_id, content, image, parent_id }) {
    const now = new Date().toISOString();
    const authorName = (await twFetchAuthors([author_id]))[String(author_id)]?.nome || '';

    if (!parent_id) {
        // Novo post original — cria uma nova thread (linha em `chats`).
        // O id da própria linha leva o prefixo (em vez do order_id, que tem
        // FK pra `orders` e não aceita um valor inventado); order_id fica
        // null, igual ao chat direto/grupo.
        const id = TW_POST_PREFIX + crypto.randomUUID();
        const newChat = {
            id,
            order_id: null,
            seller_id: author_id,
            seller_name: authorName,
            buyer_id: author_id,
            buyer_name: authorName,
            participants: [String(author_id)],
            messages: [{
                id, parentId: null, senderId: author_id, senderName: authorName,
                text: content || '', image: image || null, likes: [], reposts: [], createdAt: now
            }],
            closed: false,
            created_at: now
        };
        await supabaseFetch('chats', { method: 'POST', body: JSON.stringify(newChat) });
        return id;
    }

    // Resposta — entra no array `messages` da thread já existente.
    const row = await twFindThreadRow(parent_id);
    if (!row) throw new Error('Post original não encontrado.');
    const msgId = crypto.randomUUID();
    const messages = (Array.isArray(row.messages) ? row.messages : []).concat([{
        id: msgId, parentId: parent_id, senderId: author_id, senderName: authorName,
        text: content || '', image: image || null, likes: [], reposts: [], createdAt: now
    }]);
    const participants = Array.from(new Set([...(row.participants || []).map(String), String(author_id)]));
    await supabaseFetch(`chats?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ messages, participants })
    });

    // Espelha o comentário na conversa privada entre o autor da Thread e quem
    // comentou, deixando claro que a mensagem veio de uma Thread (com link
    // clicável de volta pro post original). Não faz nada se a pessoa estiver
    // comentando na própria Thread (não faz sentido mandar mensagem pra si mesma).
    const threadOwnerId = row.messages?.[0]?.senderId;
    if (threadOwnerId && String(threadOwnerId) !== String(author_id)) {
        try {
            await twMirrorReplyToDirectChat({
                threadOwnerId,
                commenterId: author_id,
                commenterName: authorName,
                content: content || '',
                image: image || null,
                threadRootId: row.id,
                replyId: msgId,
                createdAt: now
            });
        } catch (e) {
            // Falha ao espelhar não deve impedir o comentário na Thread de ir pra frente.
            console.error('Erro ao espelhar comentário na conversa privada:', e);
        }
    }

    return msgId;
}

/** Insere (uma única vez por comentário) uma mensagem de referência na conversa
 *  privada entre o autor da Thread e quem comentou, reaproveitando a mesma
 *  estrutura de `chats` usada pelas conversas diretas — cria a conversa se ela
 *  ainda não existir, do jeito que `startDirectChat` já faz. */
async function twMirrorReplyToDirectChat({ threadOwnerId, commenterId, commenterName, content, image, threadRootId, replyId, createdAt }) {
    const directChats = await supabaseFetch(`chats?order_id=is.null&select=*`);
    let chat = (directChats || []).find(c =>
        c.order_id === null &&
        c.participants && c.participants.length === 2 &&
        c.participants.some(p => String(p) === String(threadOwnerId)) &&
        c.participants.some(p => String(p) === String(commenterId)) &&
        c.messages && c.messages[0]?.type !== 'ticket_meta'
    );

    const refMessage = {
        type: 'thread_comment_ref',
        senderId: commenterId,
        senderName: commenterName,
        text: content || '',
        image: image || null,
        threadId: threadRootId,
        replyId,
        timestamp: createdAt
    };

    if (chat) {
        const messages = (Array.isArray(chat.messages) ? chat.messages : []).concat([refMessage]);
        await supabaseFetch(`chats?id=eq.${chat.id}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
        return;
    }

    // Ainda não existe conversa entre os dois — cria uma nova (mesmo formato
    // usado por startDirectChat), já com a mensagem de referência dentro.
    const ownerData = (await twFetchAuthors([threadOwnerId]))[String(threadOwnerId)];
    const newChat = {
        id: crypto.randomUUID(),
        order_id: null,
        buyer_id: commenterId,
        seller_id: threadOwnerId,
        buyer_name: commenterName,
        seller_name: ownerData?.nome || 'Usuário',
        participants: [String(commenterId), String(threadOwnerId)],
        messages: [
            { type: 'direct_chat_meta', createdBy: commenterId, createdByName: commenterName },
            refMessage
        ]
    };
    await supabaseFetch('chats', { method: 'POST', body: JSON.stringify(newChat) });
}

/** Atualiza campos de um post/resposta (ex.: likes) preservando o resto da mensagem. */
async function twPostPatch(id, patchFields) {
    const row = await twFindThreadRow(id);
    if (!row) return null;
    const messages = (Array.isArray(row.messages) ? row.messages : []).map(m => {
        if (String(m.id) !== String(id)) return m;
        const updated = { ...m };
        Object.keys(patchFields || {}).forEach(k => {
            if (k === 'replies_count') return; // derivado a partir do array, não precisa guardar
            updated[k] = patchFields[k];
        });
        return updated;
    });
    await supabaseFetch(`chats?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ messages }) });
    return twMapPostRow({ ...row, messages }, id);
}

/** Exclui um post/resposta. Se for o post original, apaga a thread inteira
 *  (linha em `chats`); se for uma resposta, remove só ela (e quem responder
 *  a ela, em cascata) do array `messages`, mantendo o resto da thread. */
async function twPostDelete(id) {
    const row = await twFindThreadRow(id);
    if (!row) return;
    const messages = Array.isArray(row.messages) ? row.messages : [];
    const isRoot = messages[0] && String(messages[0].id) === String(id);
    if (isRoot) {
        await supabaseFetch(`chats?id=eq.${row.id}`, { method: 'DELETE' });
        return;
    }
    const idsToRemove = new Set([String(id)]);
    let changed = true;
    while (changed) {
        changed = false;
        messages.forEach(m => {
            if (m.parentId != null && idsToRemove.has(String(m.parentId)) && !idsToRemove.has(String(m.id))) {
                idsToRemove.add(String(m.id));
                changed = true;
            }
        });
    }
    const remaining = messages.filter(m => !idsToRemove.has(String(m.id)));
    await supabaseFetch(`chats?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ messages: remaining }) });
}

async function twFollowExists(followerId, followedId) {
    const rows = await supabaseFetch(`chats?id=like.${TW_FOLLOW_PREFIX}*&buyer_id=eq.${followerId}&seller_id=eq.${followedId}&select=id&limit=1`);
    return rows?.[0]?.id || null;
}

async function twFollowersOf(userId) {
    const rows = await supabaseFetch(`chats?id=like.${TW_FOLLOW_PREFIX}*&seller_id=eq.${userId}&select=buyer_id`);
    return (rows || []).map(r => r.buyer_id).filter(Boolean);
}

async function twFollowingOf(userId) {
    const rows = await supabaseFetch(`chats?id=like.${TW_FOLLOW_PREFIX}*&buyer_id=eq.${userId}&select=seller_id`);
    return (rows || []).map(r => r.seller_id).filter(Boolean);
}

async function twFollowCreate(followerId, followedId) {
    const now = new Date().toISOString();
    const id = TW_FOLLOW_PREFIX + crypto.randomUUID();
    await supabaseFetch('chats', {
        method: 'POST',
        body: JSON.stringify({
            id,
            order_id: null,
            seller_id: followedId,
            buyer_id: followerId,
            seller_name: '',
            buyer_name: '',
            participants: [String(followerId), String(followedId)],
            messages: [{ type: 'follow', senderId: followerId, text: 'seguiu', timestamp: now }],
            closed: false,
            created_at: now
        })
    });
}

async function twFollowDelete(rowId) {
    await supabaseFetch(`chats?id=eq.${rowId}`, { method: 'DELETE' });
}

/** Monta o pequeno cartão "respondendo a" (quote do post pai), exibido no topo
 *  das respostas — igual ao jeito que o Threads mostra o post original acima
 *  do comentário quando a resposta aparece fora da própria thread (ex.: no
 *  perfil do usuário, aba Respostas). */
function renderQuotedContext(parentPost, parentAuthor) {
    if (!parentPost) return '';
    const name = twEscape(parentAuthor?.nome || 'Usuário removido');
    const avatar = twAvatarUrl(parentAuthor);
    const text = parentPost.content
        ? twEscape(parentPost.content).slice(0, 200)
        : (parentPost.image ? '📷 Imagem' : '');
    return `<div class="tw-quoted-context" onclick="event.stopPropagation();window.openCommunityThread('${parentPost.id}')">
        <img class="tw-avatar-xs" src="${avatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=1d9bf0&color=fff'">
        <span class="tw-quoted-name">${name}</span>
        <span class="tw-quoted-time">${twTimeAgo(parentPost.created_at)}</span>
        <div class="tw-quoted-text">${text}</div>
    </div>`;
}

function renderCommunitySkeleton() {
    let h = '';
    for (let i = 0; i < 3; i++) {
        h += `<div class="tw-skeleton"><div class="tw-skel-avatar"></div><div class="tw-skel-body"><div class="tw-skel-line" style="width:30%;"></div><div class="tw-skel-line" style="width:80%;"></div><div class="tw-skel-line" style="width:50%;"></div></div></div>`;
    }
    return h;
}

/** Expande/colapsa o texto longo de um post da Comunidade (estilo Facebook). */
window.fbToggleClamp = function(el) {
    if (!el) return;
    if (el.classList.contains('fb-clamped')) {
        el.classList.remove('fb-clamped');
    } else if (el.scrollHeight > el.clientHeight + 4) {
        el.classList.add('fb-clamped');
    }
};

/** Foca o campo de resposta da thread aberta (botão "Responder" dos comentários). */
window.focusThreadReply = function() {
    const t = document.getElementById('twReplyText');
    if (t) {
        t.focus();
        t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

async function twFetchAuthors(ids) {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean).map(String)));
    if (!uniqueIds.length) return {};
    const idFilter = uniqueIds.map(id => `"${id}"`).join(',');
    try {
        const users = await supabaseFetch(`users?select=id,nome,avatar&id=in.(${idFilter})`);
        const byId = {};
        (users || []).forEach(u => { byId[String(u.id)] = u; });
        return byId;
    } catch (e) { return {}; }
}

window.loadCommunityPosts = async function() {
    const list = document.getElementById('communityPostsList');
    if (!list) return;
    try {
        const posts = await twPostsQuery({ parentId: null, orderDir: 'desc', limit: 100 });
        window._twPostsCache = {};
        (posts || []).forEach(p => { window._twPostsCache[p.id] = p; });

        if (!posts || !posts.length) {
            list.innerHTML = `<div class="tw-empty-feed"><i class="bi bi-people"></i>Ainda não tem nenhum post por aqui.<br>Seja o primeiro a postar!</div>`;
            return;
        }

        const authors = await twFetchAuthors(posts.map(p => p.author_id));
        const me = getSavedUser();
        list.innerHTML = posts.map(p => renderCommunityPostCard(p, authors[String(p.author_id)], me)).join('');
        window.refreshCommunityNotifs().catch(() => {});
    } catch (e) {
        console.error('Erro ao carregar posts:', e);
        list.innerHTML = `<div class="tw-empty-feed"><i class="bi bi-exclamation-triangle"></i>Erro ao carregar a Comunidade.<br><small>${twEscape(e?.message || '')}</small></div>`;
    }
};

function renderCommunityPostCard(post, author, me, parentCtxHtml, asReply, noInline) {
    const name = twEscape(author?.nome || 'Usuário removido');
    const verified = author?.tipo === 'ADMIN';
    const nameHtml = name + (verified ? '<i class="bi bi-patch-check-fill tw-verified" title="Verificado"></i>' : '');
    const avatar = twAvatarUrl(author);
    const likes = Array.isArray(post.likes) ? post.likes : [];
    const liked = me && likes.some(id => String(id) === String(me.id));
    const isMine = me && String(post.author_id) === String(me.id);
    const postId = post.id;
    const repliesCount = post.replies_count || 0;
    const likesCount = likes.length;
    const reposts = Array.isArray(post.reposts) ? post.reposts : [];
    const reposted = me && reposts.some(id => String(id) === String(me.id));
    const content = post.content || '';
    const textHtml = content
        ? `<div class="tw-post-text ${content.length > 180 ? 'fb-clamped' : ''}" onclick="event.stopPropagation();window.fbToggleClamp(this)">${twEscape(content)}</div>`
        : '';
    const imgHtml = post.image
        ? `<img class="tw-post-img ${asReply ? 'fb-comment-img' : ''}" src="${post.image}" referrerpolicy="no-referrer" onclick="window.openImageFull?.('${String(post.image).replace(/'/g, "\\'")}')">`
        : '';
    const menuHtml = `
        <div class="tw-post-menu-wrap">
            <button type="button" class="tw-post-menu-btn" onclick="event.stopPropagation();this.nextElementSibling.classList.toggle('d-none')" title="Mais">
                <i class="bi bi-three-dots"></i>
            </button>
            <div class="tw-post-dropdown d-none">
                ${isMine ? `<button type="button" class="tw-dropdown-item" onclick="event.stopPropagation();window.startEditCommunityPost('${postId}')"><i class="bi bi-pencil me-2"></i>Editar</button>` : ''}
                ${isMine ? `<button type="button" class="tw-dropdown-item text-danger" onclick="event.stopPropagation();window.deleteCommunityPost('${postId}')"><i class="bi bi-trash3 me-2"></i>Excluir</button>` : ''}
                <button type="button" class="tw-dropdown-item" onclick="event.stopPropagation();window.shareCommunityPost('${postId}')"><i class="bi bi-share me-2"></i>Compartilhar</button>
                <button type="button" class="tw-dropdown-item" onclick="event.stopPropagation();window.toggleCommunityRepost('${postId}', null)"><i class="bi bi-arrow-repeat me-2"></i>${reposted ? 'Desfazer repost' : 'Repostar'}</button>
            </div>
        </div>`;

    // Comentário (resposta) em balão, estilo Facebook
    if (asReply) {
        return `
        <div class="tw-post tw-bubble-comment" data-post-id="${postId}">
            <img class="tw-post-avatar" src="${avatar}" referrerpolicy="no-referrer" onclick="window.openCommunityProfile('${post.author_id}')" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=1d9bf0&color=fff'">
            <div class="fb-comment-bubble">
                <div class="fb-comment-head">
                    <span class="tw-post-name" onclick="window.openCommunityProfile('${post.author_id}')">${nameHtml}</span>
                    <span class="tw-post-time">${twTimeAgo(post.created_at)}</span>
                    ${menuHtml}
                </div>
                ${textHtml.replace('tw-post-text', 'tw-post-text fb-comment-text')}
                ${imgHtml}
                ${parentCtxHtml || ''}
                <div class="fb-comment-actions">
                    <button type="button" class="tw-action-btn ${liked ? 'tw-like-active' : ''}" onclick="window.toggleCommunityLike('${postId}', this)" title="Curtir">
                        <i class="bi ${liked ? 'bi-heart-fill' : 'bi-heart'}"></i>
                    </button>
                    <button type="button" class="tw-action-btn" onclick="window.focusThreadReply()" title="Responder">
                        <i class="bi bi-chat"></i>
                    </button>
                    <button type="button" class="tw-action-btn ${reposted ? 'tw-repost-active' : ''}" onclick="window.toggleCommunityRepost('${postId}', this)" title="Repostar">
                        <i class="bi bi-arrow-repeat"></i>
                    </button>
                    <button type="button" class="tw-action-btn" onclick="window.shareCommunityPost('${postId}')" title="Compartilhar">
                        <i class="bi bi-share"></i>
                    </button>
                </div>
            </div>
        </div>`;
    }

    // Post (card principal), estilo Facebook
    const hasCounts = likesCount > 0 || repliesCount > 0;
    return `
    <div class="tw-post" data-post-id="${postId}">
        <div class="fb-card-header">
            <img class="tw-post-avatar" src="${avatar}" referrerpolicy="no-referrer" onclick="window.openCommunityProfile('${post.author_id}')" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=1d9bf0&color=fff'">
            <div class="fb-card-id">
                <span class="tw-post-name" onclick="window.openCommunityProfile('${post.author_id}')">${nameHtml}</span>
                <span class="tw-post-time">${twTimeAgo(post.created_at)}</span>
            </div>
            ${menuHtml}
        </div>
        ${textHtml}
        ${imgHtml}
        ${parentCtxHtml || ''}
        <div class="fb-card-stats">
            ${likesCount > 0 ? `<span class="fb-stats-likes" onclick="window.showCommunityPostActivity('${postId}')"><i class="bi bi-heart-fill"></i>${twFormatCount(likesCount)}</span>` : '<span></span>'}
            ${repliesCount > 0 ? `<span class="fb-stats-comments" onclick="window.twToggleInlineComments('${postId}')">${twFormatCount(repliesCount)} comentários</span>` : ''}
        </div>
        ${hasCounts ? '<div class="fb-card-divider"></div>' : ''}
        <div class="tw-post-actions">
            <button type="button" class="tw-action-btn ${liked ? 'tw-like-active' : ''}" onclick="window.toggleCommunityLike('${postId}', this)" title="Curtir">
                <i class="bi ${liked ? 'bi-heart-fill' : 'bi-heart'}"></i>
            </button>
            <button type="button" class="tw-action-btn" onclick="window.startPostReplyInChat('${postId}')" title="Responder">
                <i class="bi bi-chat"></i>
            </button>
            <button type="button" class="tw-action-btn ${reposted ? 'tw-repost-active' : ''}" onclick="window.toggleCommunityRepost('${postId}', this)" title="Repostar">
                <i class="bi bi-arrow-repeat"></i>
            </button>
            <button type="button" class="tw-action-btn" onclick="window.shareCommunityPost('${postId}')" title="Compartilhar">
                <i class="bi bi-share"></i>
            </button>
        </div>
        ${noInline ? '' : twInlineCommentsShell(postId)}
    </div>`;
}

// ------------------------------------------------------------------
// Comentários inline estilo sociobook (balões direto no card)
// ------------------------------------------------------------------

const TW_INLINE_COMMENT_AVATAR_ERR = "this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=1d9bf0&color=fff'";

/** Bloco colapsável de comentários que vive dentro de cada card de post. */
function twInlineCommentsShell(postId) {
    const me = getSavedUser();
    const myAvatar = twAvatarUrl(me || {});
    return `
    <div class="tw-inline-comments fb-inline-comments" data-comments-for="${postId}">
        <div class="fb-inline-list"></div>
        <div class="fb-inline-load" hidden>
            <button type="button" class="fb-see-more" onclick="event.stopPropagation();window.twExpandInlineComments('${postId}')">
                Ver mais comentários <i class="bi bi-chevron-down" style="font-size:11px;"></i>
            </button>
        </div>
        <div class="fb-inline-input-wrap">
            <img class="tw-avatar-xs" src="${myAvatar}" referrerpolicy="no-referrer" onerror="${TW_INLINE_COMMENT_AVATAR_ERR}">
            <div class="fb-inline-input">
                <input type="text" placeholder="Escreva um comentário..." autocomplete="off"
                    id="fbInlineInput_${postId}"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();window.twSubmitInlineComment(document.getElementById('fbInlineInput_${postId}'),'${postId}')}"
                    onclick="event.stopPropagation();this.focus()">
                <button type="button" class="fb-send" title="Enviar comentário"
                    onclick="event.stopPropagation();window.twSubmitInlineComment(document.getElementById('fbInlineInput_${postId}'),'${postId}')">
                    <i class="bi bi-send"></i>
                </button>
            </div>
        </div>
    </div>`;
}

/** Alterna a abertura do bloco de comentários inline de um post. */
window.twToggleInlineComments = async function(postId, btnEl) {
    const wrap = document.querySelector(`.tw-inline-comments[data-comments-for="${postId}"]`);
    if (!wrap) return;
    const open = wrap.classList.toggle('open');
    if (btnEl) btnEl.classList.toggle('tw-action-active', open);
    if (open && !wrap.dataset.loaded) {
        wrap.dataset.loaded = '1';
        await window.twRefreshInlineComments(postId, wrap);
    }
};

/** Busca os comentários do post e renderiza (mais novos primeiro, batch de 3). */
window.twRefreshInlineComments = async function(postId, wrap) {
    wrap = wrap || document.querySelector(`.tw-inline-comments[data-comments-for="${postId}"]`);
    if (!wrap) return [];
    const listEl = wrap.querySelector('.fb-inline-list');
    if (!listEl) return [];
    try {
        const comments = await twPostsQuery({ parentId: postId, orderDir: 'desc' });
        const authorIds = [...new Set((comments || []).map(c => c.author_id).filter(Boolean))];
        const authors = authorIds.length ? await twFetchAuthors(authorIds) : {};
        window._twInlineCache = window._twInlineCache || {};
        window._twInlineAuthors = Object.assign({}, window._twInlineAuthors || {}, authors);
        window._twInlineCache[postId] = comments || [];

        const SHOW = 3;
        const shown = (comments || []).slice(0, SHOW);
        const loadEl = wrap.querySelector('.fb-inline-load');
        if (loadEl) loadEl.hidden = (comments || []).length <= SHOW;

        const me = getSavedUser();
        listEl.innerHTML = shown.length
            ? shown.map(c => twInlineCommentItem(c, authors[String(c.author_id)], me)).join('')
            : `<div class="fb-inline-empty"><i class="bi bi-chat"></i>Seja o primeiro a comentar!</div>`;

        twUpdateCommentCount(wrap, (comments || []).length);
        return comments || [];
    } catch (e) {
        console.error('Erro ao carregar comentários:', e);
        listEl.innerHTML = `<div class="fb-inline-empty"><i class="bi bi-exclamation-triangle"></i>Erro ao carregar comentários.</div>`;
        return [];
    }
};

/** Renderiza TODOS os comentários já carregados (botão "Ver mais"). */
window.twExpandInlineComments = function(postId) {
    const wrap = document.querySelector(`.tw-inline-comments[data-comments-for="${postId}"]`);
    const listEl = wrap?.querySelector('.fb-inline-list');
    if (!wrap || !listEl) return;
    const comments = (window._twInlineCache || {})[postId] || [];
    const loadEl = wrap.querySelector('.fb-inline-load');
    if (loadEl) loadEl.hidden = true;
    const me = getSavedUser();
    const authors = window._twInlineAuthors || {};
    listEl.innerHTML = comments.length
        ? comments.map(c => twInlineCommentItem(c, authors[String(c.author_id)], me)).join('')
        : `<div class="fb-inline-empty"><i class="bi bi-chat"></i>Seja o primeiro a comentar!</div>`;
};

/** Item de comentário (avatar + balão + nome + hora + curtir/excluir). */
function twInlineCommentItem(c, author, me) {
    const name = twEscape(author?.nome || 'Usuário removido');
    const verified = author?.tipo === 'ADMIN';
    const nameHtml = name + (verified ? '<i class="bi bi-patch-check-fill tw-verified" title="Verificado"></i>' : '');
    const avatar = twAvatarUrl(author);
    const likes = Array.isArray(c.likes) ? c.likes : [];
    const liked = me && likes.some(id => String(id) === String(me.id));
    const isMine = me && String(c.author_id) === String(me.id);
    const content = c.content || '';
    return `
    <div class="tw-post tw-bubble-comment fb-comment-inline" data-comment-id="${c.id}">
        <img class="tw-post-avatar" src="${avatar}" referrerpolicy="no-referrer" onclick="window.openCommunityProfile('${c.author_id}')" onerror="${TW_INLINE_COMMENT_AVATAR_ERR}">
        <div class="fb-comment-bubble">
            <div class="fb-comment-head">
                <span class="tw-post-name" onclick="window.openCommunityProfile('${c.author_id}')">${nameHtml}</span>
                <span class="tw-post-time">${twTimeAgo(c.created_at)}</span>
                ${isMine ? `<button type="button" class="fb-comment-del" onclick="event.stopPropagation();window.deleteCommunityComment('${c.id}')" title="Excluir comentário"><i class="bi bi-x-lg"></i></button>` : ''}
            </div>
            ${content ? `<div class="tw-post-text fb-comment-text">${twEscape(content)}</div>` : ''}
            <div class="fb-comment-actions">
                <button type="button" class="tw-action-btn fb-mini-action ${liked ? 'tw-like-active' : ''}" onclick="window.toggleCommunityLike('${c.id}', this)" title="Curtir">
                    <i class="bi ${liked ? 'bi-heart-fill' : 'bi-heart'}"></i>
                </button>
                ${likes.length ? `<button type="button" class="tw-action-btn fb-mini-action" onclick="window.showCommunityPostActivity('${c.id}')" title="Curtidas"><i class="bi bi-people"></i><span>${twFormatCount(likes.length)}</span></button>` : ''}
            </div>
        </div>
    </div>`;
}

/** Atualiza o contador de comentários do card + cache após mudanças. */
function twUpdateCommentCount(wrap, count) {
    const card = wrap?.closest('.tw-post');
    if (!card) return;
    const pid = wrap.dataset.commentsFor;
    if (pid && window._twPostsCache?.[pid]) window._twPostsCache[pid].replies_count = count;
    const el = card.querySelector('.fb-stats-comments');
    if (el) {
        if (count > 0) el.textContent = `${twFormatCount(count)} comentários`;
    }
}

/** Publica um comentário direto do card (espelha automaticamente na conversa). */
window.twSubmitInlineComment = async function(inputEl, postId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }
    const content = (inputEl?.value || '').trim();
    if (!content) { showToast('Escreva algo antes de comentar.', 'warning'); return; }
    inputEl.disabled = true;
    try {
        await twPostCreate({ author_id: user.id, content, image: null, parent_id: postId });
        inputEl.value = '';
        showToast('Comentário publicado!', 'success');
        const wrap = document.querySelector(`.tw-inline-comments[data-comments-for="${postId}"]`);
        if (wrap) await window.twRefreshInlineComments(postId, wrap);
    } catch (e) {
        console.error('Erro ao comentar:', e);
        showToast(`Erro ao comentar: ${e?.message || e?.details || 'tente novamente.'}`, 'error');
    } finally {
        inputEl.disabled = false;
        inputEl.focus();
    }
};

/** Exclui um comentário publicado no card (só o autor vê o botão). */
window.deleteCommunityComment = async function(commentId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }
    const el = document.querySelector(`.fb-comment-inline[data-comment-id="${commentId}"]`);
    if (!confirm('Excluir este comentário?')) return;
    try {
        await twPostDelete(commentId);
        const wrap = el ? el.closest('.tw-inline-comments') : null;
        const pid = wrap?.dataset.commentsFor;
        el?.remove();
        if (pid) {
            const wrapEl = document.querySelector(`.tw-inline-comments[data-comments-for="${pid}"]`);
            if (wrapEl) await window.twRefreshInlineComments(pid, wrapEl);
        }
        showToast('Comentário excluído.', 'success');
    } catch (e) {
        console.error('Erro ao excluir comentário:', e);
        showToast(`Erro ao excluir: ${e?.message || e?.details || 'tente novamente.'}`, 'error');
    }
};

// ------------------------------------------------------------------
// Notificações da Comunidade (estilo sociobook) — calculadas a partir
// dos próprios posts (curtidas/comentários de terceiros em `chats`),
// sem precisar de tabela nova. O marcador de "visto" e os itens
// descartados ficam em localStorage por usuário.
// ------------------------------------------------------------------

const TW_NOTIF_SEEN_KEY = 'twNotifSeen_';
const TW_NOTIF_DISMISS_KEY = 'twNotifDismissed_';

/** Botão sino usado no header da Comunidade (feed dedicado ou chat). */
window.twNotifBellHtml = function() {
    return `<button type="button" class="tw-notif-bell" onclick="event.stopPropagation();window.toggleCommunityNotifs(this)" title="Notificações" aria-label="Notificações">` +
        `<i class="bi bi-bell"></i><span class="tw-notif-dot d-none" id="twNotifDot"></span></button>`;
};

function twTimeAgoFull(dateStr) {
    if (!dateStr) return '';
    const diff = Math.max(0, Date.now() - new Date(dateStr).getTime());
    const min = Math.floor(diff / 60000);
    if (diff < 60000) return 'agora mesmo';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h} h`;
    return `há ${Math.floor(h / 24)} d`;
}

/** Monta a lista de notificações a partir dos posts do usuário em `chats`. */
async function twComputeCommunityNotifs() {
    const me = getSavedUser();
    if (!me) return [];
    const rows = await supabaseFetch(`chats?id=like.${TW_POST_PREFIX}*&seller_id=eq.${me.id}&select=id,created_at,messages&limit=100`);
    let dismissed = [];
    try { dismissed = JSON.parse(localStorage.getItem(TW_NOTIF_DISMISS_KEY + me.id) || '[]'); } catch (e) {}
    const dismissedSet = new Set(dismissed);
    const notifs = [];
    (rows || []).forEach(row => {
        const msgs = Array.isArray(row.messages) ? row.messages : [];
        msgs.forEach(m => {
            const myMsg = String(m.senderId) === String(me.id);
            const likes = Array.isArray(m.likes) ? m.likes : [];
            likes.forEach(uid => {
                if (!uid || String(uid) === String(me.id)) return;
                const key = `like:${m.id}:${uid}`;
                if (dismissedSet.has(key)) return;
                notifs.push({
                    key, type: 'like', actorId: uid, postId: m.id, threadId: row.id,
                    preview: m.text || '',
                    createdAt: (m.likesAt && m.likesAt[String(uid)]) || m.createdAt || row.created_at
                });
            });
            if (m.parentId != null && !myMsg) {
                const key = `comment:${m.id}:${m.senderId}`;
                if (dismissedSet.has(key)) return;
                notifs.push({
                    key, type: 'comment', actorId: m.senderId, postId: m.id, threadId: row.id,
                    preview: m.text || '',
                    createdAt: m.createdAt || row.created_at
                });
            }
        });
    });

    // Seguidores novos: linhas community_follow_* onde seller_id = eu
    // (seller_id = quem é seguido, buyer_id = quem segue).
    const followRows = await supabaseFetch(`chats?id=like.${TW_FOLLOW_PREFIX}*&seller_id=eq.${me.id}&select=id,buyer_id,created_at`);
    (followRows || []).forEach(row => {
        if (!row.buyer_id || String(row.buyer_id) === String(me.id)) return;
        const key = `follow:${row.id}`;
        if (dismissedSet.has(key)) return;
        notifs.push({
            key, type: 'follow', actorId: row.buyer_id, postId: null, threadId: row.id,
            preview: '', createdAt: row.created_at
        });
    });

    notifs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return notifs.slice(0, 40);
}

function twNotifItemHtml(n) {
    const a = (window._twNotifActors || {})[String(n.actorId)] || {};
    const avatar = twAvatarUrl(a);
    const name = twEscape(a?.nome || 'Alguém');
    const iconHtml = n.type === 'like'
        ? `<div class="tw-notif-type-icon tw-notif-like"><i class="bi bi-heart-fill"></i></div>`
        : n.type === 'follow'
            ? `<div class="tw-notif-type-icon tw-notif-like"><i class="bi bi-person-plus-fill"></i></div>`
            : `<div class="tw-notif-type-icon tw-notif-comment"><i class="bi bi-chat-left-fill"></i></div>`;
    const text = n.type === 'like'
        ? `${name} curtiu seu post${n.preview ? `: <i class="tw-notif-quote">${twEscape(n.preview.slice(0, 80))}</i>` : ''}`
        : n.type === 'follow'
            ? `${name} começou a seguir você`
            : `${name} comentou seu post: <i class="tw-notif-quote">${twEscape((n.preview || '').slice(0, 80))}</i>`;
    const openAction = n.type === 'follow'
        ? `window.openCommunityProfile('${n.actorId}')`
        : `window.openCommunityThread('${n.postId}')`;
    return `
    <div class="tw-notif-item" onclick="window.closeCommunityNotifs();${openAction}">
        <div class="tw-notif-avatar-wrap">
            <img class="tw-notif-avatar" src="${avatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=1d9bf0&color=fff'">
            ${iconHtml}
        </div>
        <div class="tw-notif-body">
            <div class="tw-notif-text">${text}</div>
            <div class="tw-notif-time">${twTimeAgoFull(n.createdAt)}</div>
        </div>
        <button type="button" class="tw-notif-del" onclick="event.stopPropagation();window.dismissCommunityNotif('${n.key}')" title="Excluir notificação"><i class="bi bi-x-lg"></i></button>
    </div>`;
}

/** Computa as notificações, atualiza o ponto vermelho e (se aberto) o painel. */
window.refreshCommunityNotifs = async function() {
    try {
        const me = getSavedUser();
        if (!me) return;
        const notifs = await twComputeCommunityNotifs();
        window._twNotifs = notifs;
        const actorIds = [...new Set(notifs.map(n => n.actorId).filter(Boolean))];
        window._twNotifActors = actorIds.length ? await twFetchAuthors(actorIds) : {};
        const seen = localStorage.getItem(TW_NOTIF_SEEN_KEY + me.id);
        const hasUnseen = notifs.length > 0 && (seen === null || notifs.some(n => new Date(n.createdAt) > new Date(seen)));
        const dot = document.getElementById('twNotifDot');
        if (dot) dot.classList.toggle('d-none', !hasUnseen);
        const listEl = document.getElementById('twNotifList');
        if (listEl) {
            listEl.innerHTML = notifs.length
                ? notifs.map(twNotifItemHtml).join('')
                : `<div class="tw-notif-empty"><i class="bi bi-bell-slash"></i><span>Quiet on the Notification Front</span></div>`;
        }
    } catch (e) {
        console.error('Erro ao carregar notificações da Comunidade:', e);
    }
};

/** Abre/fecha o painel de notificações (e marca tudo como visto ao abrir). */
window.toggleCommunityNotifs = async function(anchor) {
    const me = getSavedUser();
    if (!me) { showToast('Faça login!', 'warning'); return; }
    let panel = document.getElementById('twNotifPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'twNotifPanel';
        panel.className = 'tw-notif-popover d-none';
        panel.innerHTML = `<div class="tw-notif-header">Notificações</div><div class="tw-notif-list" id="twNotifList"></div>`;
        document.body.appendChild(panel);
    }
    const opening = panel.classList.contains('d-none');
    if (opening) {
        localStorage.setItem(TW_NOTIF_SEEN_KEY + me.id, new Date().toISOString());
        const dot = document.getElementById('twNotifDot');
        if (dot) dot.classList.add('d-none');
        if (anchor) {
            const r = anchor.getBoundingClientRect();
            panel.style.top = (r.bottom + 6) + 'px';
            panel.style.left = Math.max(8, Math.min(window.innerWidth - 356, r.right - 340)) + 'px';
        }
        panel.classList.remove('d-none');
        await window.refreshCommunityNotifs();
    } else {
        panel.classList.add('d-none');
    }
};

window.closeCommunityNotifs = function() {
    const panel = document.getElementById('twNotifPanel');
    if (panel) panel.classList.add('d-none');
};

/** Descarta uma notificação (esconde de forma persistente por usuário). */
window.dismissCommunityNotif = function(key) {
    const me = getSavedUser();
    if (!me) return;
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(TW_NOTIF_DISMISS_KEY + me.id) || '[]'); } catch (e) {}
    if (!arr.includes(key)) arr.push(key);
    try { localStorage.setItem(TW_NOTIF_DISMISS_KEY + me.id, JSON.stringify(arr)); } catch (e) {}
    window._twNotifs = (window._twNotifs || []).filter(n => n.key !== key);
    const listEl = document.getElementById('twNotifList');
    if (listEl) {
        listEl.innerHTML = window._twNotifs.length
            ? window._twNotifs.map(twNotifItemHtml).join('')
            : `<div class="tw-notif-empty"><i class="bi bi-bell-slash"></i><span>Quiet on the Notification Front</span></div>`;
    }
    const atvEl = document.getElementById('twAtividadeList');
    if (atvEl) {
        const n2 = window._twNotifs || [];
        const ids = [...new Set(n2.map(n => n.actorId).filter(Boolean))];
        twFetchAuthors(ids).then(actors => {
            atvEl.innerHTML = n2.length
                ? n2.map(n => twAtividadeItemHtml(n, actors)).join('')
                : twEmptyAtividadeHtml('Nenhuma atividade por enquanto. Curtidas, comentários e novos seguidores aparecem aqui.');
        }).catch(() => {});
    }
};

// ------------------------------------------------------------------
// Busca de usuários estilo sociobook
// ------------------------------------------------------------------

function twSearchInputHtml() {
    return `<div class="tw-search">
        <i class="bi bi-search"></i>
        <input type="text" id="twSearchInput" placeholder="Buscar no ElectroMarket" autocomplete="off"
            oninput="window.twSearchUsers(this)"
            onkeydown="if(event.key==='Escape')window.twCloseSearch()">
        <div class="tw-search-results d-none" id="twSearchResults"></div>
    </div>`;
}

window.twSearchUsers = async function(input) {
    clearTimeout(window._twSearchTimer);
    const t = input.value || '';
    window._twSearchTimer = setTimeout(async () => {
        const term = t.trim();
        const box = document.getElementById('twSearchResults');
        if (!box) return;
        if (term.length < 2) { box.classList.add('d-none'); return; }
        try {
            const users = await supabaseFetch(`users?select=id,nome,avatar&nome=ilike.*${encodeURIComponent(term)}*&limit=8`);
        if (!users || !users.length) {
            box.innerHTML = `<div class="tw-search-empty">Nenhum resultado para “${twEscape(term)}”</div>`;
        } else {
            box.innerHTML = `<div class="tw-search-label">Pessoas</div>` + users.map(u => {
                const av = twAvatarUrl(u);
                return `<div class="tw-search-row" onclick="window.twGoToProfile('${u.id}')">` +
                    `<img class="tw-avatar-xs" src="${av}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=1d9bf0&color=fff'">` +
                    `<span>${twEscape(u.nome || 'Usuário')}</span></div>`;
            }).join('');
        }
        box.classList.remove('d-none');
    } catch (e) {
        console.error('Erro na busca:', e);
        box.classList.add('d-none');
    }
});
};

window.twGoToProfile = function(userId) {
    window.twCloseSearch();
    window.openCommunityProfile(userId);
};

window.twCloseSearch = function() {
    const i = document.getElementById('twSearchInput');
    if (i) i.value = '';
    const b = document.getElementById('twSearchResults');
    if (b) b.classList.add('d-none');
};

/** Barra com sino de notificações + ícone de busca, usada no topo do feed.
 *  A busca não fica mais aberta o tempo todo entre os posts — agora é só um
 *  ícone; ao clicar, abre a página de busca dedicada (Pesquisar).
 *  `includeBell=false` no modo chat (o sino já fica no cabeçalho ali). */
window.twFeedToolbarHtml = function(includeBell) {
    return `<div class="tw-feed-toolbar">${includeBell ? window.twNotifBellHtml() : ''}<button type="button" class="tw-notif-bell tw-search-toggle-btn" title="Pesquisar" onclick="window.twSidebarGoSearch()"><i class="bi bi-search"></i></button></div>`;
};

/** Caixa "No que você está pensando?" — renderizada dentro do feed rolável
 *  (não numa barra fixa), logo abaixo do cabeçalho "Para você", com a mesma
 *  largura dos posts. Rola junto com o conteúdo, igual ao app de referência. */
window.twComposerBoxHtml = function(chatId) {
    const user = getSavedUser();
    if (!user) return '';
    const myAvatar = normalizeImageUrl(safeParseImages(user.avatar)[0]) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.nome || 'User')}&background=1d9bf0&color=fff`;
    return `
        <div class="tw-composer tw-composer-inline">
            <img class="tw-avatar" src="${myAvatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=1d9bf0&color=fff'">
            <textarea id="dcomposer_${chatId}" class="tw-composer-textarea" placeholder="No que você está pensando, ${user.nome ? twEscape(user.nome) : ''}?" rows="1" oninput="this.style.height='auto';this.style.height=(this.scrollHeight)+'px'"></textarea>
            <div id="dcomposerPreview_${chatId}" class="tw-composer-preview d-none"></div>
            <label class="tw-icon-btn" title="Adicionar imagem" style="cursor:pointer;">
                <i class="bi bi-image"></i>
                <input type="file" accept="image/*" class="d-none" onchange="window.communityPickImageFromChat('${chatId}', this)">
            </label>
            <button type="button" class="tw-post-btn" onclick="window.submitCommunityPostFromChat('${chatId}')">Postar</button>
        </div>`;
};

// Fecha busca e painel de notificações ao clicar fora.
document.addEventListener('click', function(e) {
    if (!e.target.closest('.tw-search')) window.twCloseSearch();
    if (!e.target.closest('.tw-notif-bell') && !e.target.closest('#twNotifPanel')) window.closeCommunityNotifs();
});

/** Abre a edição inline de um post/resposta da Comunidade (só o autor vê a opção).
 *  Troca o texto exibido por um textarea + botões Salvar/Cancelar, sem precisar
 *  recarregar a lista — funciona tanto no feed quanto dentro de uma thread. */
window.startEditCommunityPost = function(postId) {
    const card = document.querySelector(`.tw-post[data-post-id="${postId}"]`);
    if (!card) return;
    if (card.querySelector('.tw-post-edit-wrap')) return; // já está editando
    card.querySelector('.tw-post-dropdown')?.classList.add('d-none');

    const textEl = card.querySelector('.tw-post-text');
    const currentText = textEl ? textEl.textContent : '';
    if (textEl) textEl.classList.add('d-none');

    const editWrap = document.createElement('div');
    editWrap.className = 'tw-post-edit-wrap';
    editWrap.innerHTML = `
        <textarea class="tw-composer-textarea tw-post-edit-textarea" rows="2" oninput="this.style.height='auto';this.style.height=(this.scrollHeight)+'px'"></textarea>
        <div class="tw-post-edit-actions">
            <button type="button" class="tw-edit-cancel-btn" onclick="event.stopPropagation();window.cancelCommunityPostEdit('${postId}')">Cancelar</button>
            <button type="button" class="tw-post-btn" onclick="event.stopPropagation();window.saveCommunityPostEdit('${postId}')">Salvar</button>
        </div>`;
    (textEl || card.querySelector('.fb-card-header')).insertAdjacentElement('afterend', editWrap);

    const textarea = editWrap.querySelector('textarea');
    textarea.value = currentText;
    textarea.style.height = 'auto';
    textarea.style.height = (textarea.scrollHeight) + 'px';
    textarea.focus();
};

/** Cancela a edição em andamento e volta a mostrar o texto original. */
window.cancelCommunityPostEdit = function(postId) {
    const card = document.querySelector(`.tw-post[data-post-id="${postId}"]`);
    if (!card) return;
    card.querySelector('.tw-post-edit-wrap')?.remove();
    card.querySelector('.tw-post-text')?.classList.remove('d-none');
};

/** Salva a edição de um post/resposta da Comunidade. */
window.saveCommunityPostEdit = async function(postId) {
    const card = document.querySelector(`.tw-post[data-post-id="${postId}"]`);
    if (!card) return;
    const editWrap = card.querySelector('.tw-post-edit-wrap');
    const textarea = editWrap?.querySelector('textarea');
    const newText = (textarea?.value || '').trim();
    if (!newText) { showToast('A mensagem não pode ficar vazia.', 'warning'); return; }

    const saveBtn = editWrap?.querySelector('.tw-post-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Salvando...'; }
    try {
        await twPostPatch(postId, { text: newText });
        editWrap?.remove();
        let textEl = card.querySelector('.tw-post-text');
        if (textEl) {
            textEl.textContent = newText;
            textEl.classList.remove('d-none');
            textEl.classList.remove('fb-clamped');
        } else {
            const newEl = document.createElement('div');
            newEl.className = 'tw-post-text';
            newEl.textContent = newText;
            card.querySelector('.fb-card-header').insertAdjacentElement('afterend', newEl);
        }
        if (window._twPostsCache?.[postId]) window._twPostsCache[postId].content = newText;
        showToast('Mensagem atualizada!', 'success');
    } catch (e) {
        console.error('Erro ao editar post:', e);
        showToast(`Erro ao editar: ${e?.message || e?.details || 'tente novamente.'}`, 'error');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Salvar'; }
    }
};

window.toggleCommunityLike = async function(postId, btnEl) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }
    try {
        const post = await twPostsGet(postId);
        if (!post) return;
        let likes = Array.isArray(post.likes) ? post.likes.map(String) : [];
        const uid = String(user.id);
        const alreadyLiked = likes.includes(uid);
        likes = alreadyLiked ? likes.filter(id => id !== uid) : [...likes, uid];

        // Registra o momento de cada curtida (pra alimentar as notificações da
        // Comunidade com data real de quem curtiu; posts/curtidas antigos caem
        // no fallback de created_at da mensagem).
        const likesAt = Object.assign({}, post.likesAt || {});
        if (alreadyLiked) delete likesAt[uid];
        else likesAt[uid] = new Date().toISOString();

        await twPostPatch(postId, { likes, likesAt });

        if (btnEl) {
            btnEl.classList.toggle('tw-like-active', !alreadyLiked);
            const icon = btnEl.querySelector('i');
            if (icon) icon.className = `bi ${!alreadyLiked ? 'bi-heart-fill' : 'bi-heart'}`;
            const statsEl = btnEl.closest('.tw-post')?.querySelector('.fb-stats-likes');
            if (statsEl) {
                if (likes.length > 0) statsEl.innerHTML = `<i class="bi bi-heart-fill"></i>${twFormatCount(likes.length)}`;
                else statsEl.remove();
            }
        }
        if (window._twPostsCache[postId]) window._twPostsCache[postId].likes = likes;
        if (window._twPostsCache[postId]) window._twPostsCache[postId].likesAt = likesAt;
    } catch (e) {
        console.error('Erro ao curtir:', e);
        showToast(`Erro ao curtir: ${e?.message || e?.details || 'tente novamente.'}`, 'error');
    }
};

/** Reposta/desfaz repost de um post da Comunidade */
window.toggleCommunityRepost = async function(postId, btnEl) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }
    try {
        const post = await twPostsGet(postId);
        if (!post) return;
        let reposts = Array.isArray(post.reposts) ? post.reposts.map(String) : [];
        const uid = String(user.id);
        const alreadyReposted = reposts.includes(uid);
        reposts = alreadyReposted ? reposts.filter(id => id !== uid) : [...reposts, uid];

        await twPostPatch(postId, { reposts });

        if (btnEl) {
            btnEl.classList.toggle('tw-repost-active', !alreadyReposted);
            let span = btnEl.querySelector('.action-count');
            if (reposts.length > 0) {
                if (!span) {
                    span = document.createElement('span');
                    span.className = 'action-count';
                    btnEl.appendChild(span);
                }
                span.textContent = twFormatCount(reposts.length);
            } else if (span) {
                span.remove();
            }
        }
        if (window._twPostsCache?.[postId]) window._twPostsCache[postId].reposts = reposts;
        showToast(alreadyReposted ? 'Repost desfeito.' : 'Repostado!', 'success');
    } catch (e) {
        console.error('Erro ao repostar:', e);
        showToast(`Erro ao repostar: ${e?.message || e?.details || 'tente novamente.'}`, 'error');
    }
};

/** Exclui um post da Comunidade (apenas o autor pode excluir) */
window.deleteCommunityPost = async function(postId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }
    if (!confirm('Tem certeza que deseja excluir este post?')) return;
    try {
        const post = await twPostsGet(postId);
        if (!post) { showToast('Post não encontrado.', 'error'); return; }
        if (String(post.author_id) !== String(user.id)) { showToast('Você só pode excluir seus próprios posts.', 'error'); return; }
        await twPostDelete(postId);
        showToast('Post excluído.', 'success');
        // Recarrega o feed
        const container = window._chatActiveElements?.container;
        if (container) await renderCommunityFeedInChat(container, false);
        const feedList = document.getElementById('communityPostsList');
        if (feedList) await window.loadCommunityPosts();
    } catch (e) {
        console.error('Erro ao excluir post:', e);
        showToast(`Erro ao excluir post: ${e?.message || e?.details || 'tente novamente.'}`, 'error');
    }
};

/** Compartilha um post copiando o link para a área de transferência */
window.shareCommunityPost = function(postId) {
    const url = `${window.location.origin}${window.location.pathname}?post=${postId}`;
    navigator.clipboard.writeText(url).then(() => {
        showToast('Link copiado!', 'success');
    }).catch(() => {
        showToast('Erro ao copiar link.', 'error');
    });
};

/** Mostra quem curtiu um post (modal simples) */
window.showCommunityPostActivity = async function(postId) {
    try {
        const post = await twPostsGet(postId);
        if (!post || !Array.isArray(post.likes) || !post.likes.length) { showToast('Nenhuma curtida ainda.', 'info'); return; }
        const users = await twFetchAuthors(post.likes);
        const list = post.likes.map(id => {
            const u = users[String(id)];
            const name = u?.nome || 'Usuário';
            const avatarUrl = twAvatarUrl(u);
            return `<div class="tw-activity-user"><img src="${avatarUrl}" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=1d9bf0&color=fff'"><span>${twEscape(name)}</span></div>`;
        }).join('');
        showToast(`<div class="tw-activity-modal"><strong style="display:block;margin-bottom:8px;">Curtidas</strong>${list}</div>`);
    } catch (e) {
        console.error('Erro ao carregar atividade:', e);
    }
};

/** Botão "Comentar" de um post da Comunidade — em vez de abrir a tela pública da
 *  Thread, abre (ou cria) a conversa privada com o autor do post e deixa o post
 *  "marcado" ali em cima do campo de digitação, igual ao "responder a uma
 *  mensagem" do chat normal. Ao enviar, sendDirectChatMessage() detecta esse
 *  contexto e publica o comentário de verdade (via twPostCreate), que por sua
 *  vez já espelha a mensagem na conversa (twMirrorReplyToDirectChat) — juntando
 *  os dois fluxos (Thread + conversa) numa coisa só. */
window.startPostReplyInChat = async function(postId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }

    try {
        const post = await twPostsGet(postId);
        if (!post) { showToast('Post não encontrado.', 'error'); return; }

        const authors = await twFetchAuthors([post.author_id]);
        const author = authors[String(post.author_id)];
        const authorName = author?.nome || 'Usuário';

        // Não dá pra abrir uma conversa consigo mesmo — mantém o comportamento
        // antigo (Thread pública) só nesse caso.
        if (String(post.author_id) === String(user.id)) {
            return window.openCommunityThread(postId);
        }

        const directChats = await supabaseFetch(`chats?order_id=is.null&select=*`);
        const existing = (directChats || []).find(c =>
            c.order_id === null &&
            c.participants && c.participants.length === 2 &&
            c.participants.some(p => String(p) === String(user.id)) &&
            c.participants.some(p => String(p) === String(post.author_id)) &&
            c.messages && c.messages[0]?.type !== 'ticket_meta'
        );

        let chatId = existing?.id;
        if (!chatId) {
            chatId = crypto.randomUUID();
            const newChat = {
                id: chatId,
                order_id: null,
                buyer_id: user.id,
                seller_id: post.author_id,
                buyer_name: user.nome,
                seller_name: authorName,
                participants: [user.id, post.author_id],
                messages: [
                    { type: 'direct_chat_meta', createdBy: user.id, createdByName: user.nome }
                ]
            };
            await supabaseFetch('chats', { method: 'POST', body: JSON.stringify(newChat) });
            await window.renderDirectChats?.({ skipBoot: true });
        }

        await window.openDirectChat(chatId);

        window.currentPostReplyContext = {
            postId,
            authorName,
            text: post.content || '',
            image: post.image || null
        };
        window.currentReplyIndex = null;
        window.editingMessageIndex = null;

        const preview = window._chatActiveElements?.preview;
        if (preview) {
            const rawSnippet = (post.content || '').slice(0, 80);
            const snippet = twEscape(rawSnippet) + (post.content && post.content.length > 80 ? '…' : '');
            preview.classList.remove('d-none');
            preview.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div class="small text-truncate" style="max-width: 85%;">
                        <strong class="text-primary d-block"><i class="bi bi-chat-left-text me-1"></i>Respondendo ao post de ${twEscape(authorName)}</strong>
                        <span class="text-muted">${snippet || (post.image ? 'Imagem' : 'Post')}</span>
                    </div>
                    <i class="bi bi-x-lg cursor-pointer" onclick="window.cancelReplyOrEdit()"></i>
                </div>`;
        }
        window._chatActiveElements?.input?.focus();
    } catch (e) {
        console.error('Erro ao abrir a conversa a partir do post:', e);
        showToast('Erro ao abrir a conversa.', 'error');
    }
};

/** Abre a thread de um post: post original + composer de resposta + lista de respostas */
window.openCommunityThread = async function(postId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }

    // A Comunidade só abre dentro do painel de Conversas (communityChatMsgs).
    const grid = document.getElementById('communityChatMsgs');
    if (!grid) return;

    grid.innerHTML = `
    <div class="detail-page">
        <div class="tw-feed-wrap">
            <div class="tw-feed-header">
                <button type="button" class="tw-icon-btn" style="margin:0;" title="Voltar" onclick="window.twSidebarGoFeed()">
                    <i class="bi bi-arrow-left"></i>
                </button>
                <div><h4>Post</h4></div>
            </div>
            <div id="twThreadContent">${renderCommunitySkeleton()}</div>
        </div>
    </div>`;

    try {
        const post = await twPostsGet(postId);
        if (!post) { document.getElementById('twThreadContent').innerHTML = `<div class="tw-empty-feed"><i class="bi bi-emoji-frown"></i>Post não encontrado.</div>`; return; }

        const replies = await twPostsQuery({ parentId: postId, orderDir: 'asc' });
        const authorIds = [post.author_id, ...(replies || []).map(r => r.author_id)];
        const authors = await twFetchAuthors(authorIds);
        const me = getSavedUser();

        const originalHtml = renderCommunityPostCard(post, authors[String(post.author_id)], me, null, false, true).replace('class="tw-post"', 'class="tw-post tw-thread-original"');

        // Guarda o estado da thread pra dar pra reordenar as respostas sem recarregar tudo.
        window._twThread = { postId, replies: replies || [], authors, sort: 'relevantes' };

        const sortRowHtml = `
        <div class="tw-thread-sort-row">
            <div class="tw-post-menu-wrap">
                <button type="button" class="tw-thread-sort-btn" onclick="event.stopPropagation();this.nextElementSibling.classList.toggle('d-none')">
                    <i class="bi bi-arrow-down-up"></i> <span id="twThreadSortLabel">Mais relevantes</span> <i class="bi bi-chevron-down" style="font-size:11px;"></i>
                </button>
                <div class="tw-post-dropdown d-none">
                    <button type="button" class="tw-dropdown-item" onclick="event.stopPropagation();window.communitySortReplies('relevantes')">Mais relevantes</button>
                    <button type="button" class="tw-dropdown-item" onclick="event.stopPropagation();window.communitySortReplies('recentes')">Mais recentes</button>
                </div>
            </div>
            <span class="tw-thread-activity-link" onclick="window.showCommunityPostActivity('${postId}')">Ver atividade <i class="bi bi-chevron-right" style="font-size:11px;"></i></span>
        </div>`;

        const replyComposerHtml = `
        <div class="tw-composer fb-reply-composer">
            <div class="fb-composer-top">
                <img class="tw-avatar" src="${twAvatarUrl(me)}" referrerpolicy="no-referrer">
                <textarea id="twReplyText" class="tw-composer-textarea" placeholder="Escreva um comentário..." rows="1" oninput="this.style.height='auto';this.style.height=(this.scrollHeight)+'px'"></textarea>
            </div>
            <div id="twReplyPreview" class="tw-composer-preview d-none"></div>
            <div class="fb-composer-actions">
                <label class="fb-photo-btn" style="cursor:pointer;">
                    <i class="bi bi-image"></i> Foto
                    <input type="file" accept="image/*" class="d-none" onchange="window.communityPickReplyImage(this)">
                </label>
                <button type="button" class="tw-post-btn" onclick="window.submitCommunityReply('${postId}')">Postar</button>
            </div>
        </div>`;

        document.getElementById('twThreadContent').innerHTML = originalHtml + sortRowHtml + replyComposerHtml + `<div id="twRepliesList"></div>`;
        window._renderThreadReplies();
    } catch (e) {
        console.error('Erro ao abrir post:', e);
        document.getElementById('twThreadContent').innerHTML = `<div class="tw-empty-feed"><i class="bi bi-exclamation-triangle"></i>Erro ao carregar o post.</div>`;
    }
};

/** Renderiza a lista de respostas da thread aberta, respeitando a ordenação escolhida */
window._renderThreadReplies = function() {
    const state = window._twThread;
    const listEl = document.getElementById('twRepliesList');
    if (!state || !listEl) return;
    const me = getSavedUser();
    let replies = [...state.replies];
    if (state.sort === 'relevantes') {
        replies.sort((a, b) => ((b.likes?.length || 0) + (b.reposts?.length || 0)) - ((a.likes?.length || 0) + (a.reposts?.length || 0)));
    } else {
        replies.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    listEl.innerHTML = replies.length
        ? `<div class="tw-reply-list">${replies.map(r => renderCommunityPostCard(r, state.authors[String(r.author_id)], me, null, true)).join('')}</div>`
        : `<div class="tw-empty-feed"><i class="bi bi-chat"></i>Nenhuma resposta ainda. Seja o primeiro!</div>`;
};

/** Troca a ordenação das respostas (Mais relevantes / Mais recentes) */
window.communitySortReplies = function(sort) {
    if (!window._twThread) return;
    window._twThread.sort = sort;
    const label = document.getElementById('twThreadSortLabel');
    if (label) label.textContent = sort === 'relevantes' ? 'Mais relevantes' : 'Mais recentes';
    document.querySelectorAll('.tw-thread-sort-row .tw-post-dropdown').forEach(el => el.classList.add('d-none'));
    window._renderThreadReplies();
};

/** Seleciona/remove a imagem anexada à resposta da thread */
window.communityPickReplyImage = function(input) {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const wrap = document.getElementById('twReplyPreview');
    if (!wrap) return;
    wrap.classList.remove('d-none');
    wrap.innerHTML = `<div class="tw-composer-preview"><img src="${URL.createObjectURL(file)}"><button type="button" class="tw-remove-img" onclick="window.communityRemoveReplyImage()"><i class="bi bi-x-lg"></i></button></div>`;
    window._twReplyPendingImage = 'uploading';
    _uploadToImgur(file).then(url => {
        window._twReplyPendingImage = url || null;
        if (!url) { showToast('Falha ao enviar imagem.', 'error'); wrap.innerHTML = ''; wrap.classList.add('d-none'); }
    });
};

window.communityRemoveReplyImage = function() {
    window._twReplyPendingImage = null;
    const wrap = document.getElementById('twReplyPreview');
    if (wrap) { wrap.innerHTML = ''; wrap.classList.add('d-none'); }
};

window.submitCommunityReply = async function(parentId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }
    const textEl = document.getElementById('twReplyText');
    const content = (textEl?.value || '').trim();
    if (!content && !window._twReplyPendingImage) { showToast('Escreva algo ou adicione uma imagem.', 'warning'); return; }
    if (window._twReplyPendingImage === 'uploading') { showToast('Aguarde a imagem terminar de enviar...', 'info'); return; }
    try {
        await twPostCreate({ author_id: user.id, content, image: window._twReplyPendingImage || null, parent_id: parentId });
        window._twReplyPendingImage = null;
        showToast('Resposta enviada!', 'success');
        await window.openCommunityThread(parentId);
    } catch (e) {
        console.error('Erro ao responder:', e);
        showToast(`Erro ao enviar resposta: ${e?.message || e?.details || 'tente novamente.'}`, 'error');
    }
};

/** Perfil de um usuário dentro da Comunidade: posts, seguidores/seguindo, seguir/deixar de seguir */
window.openCommunityProfile = async function(userId) {
    const me = getSavedUser();
    if (!me) { showToast('Faça login!', 'warning'); return; }
    // A Comunidade só abre dentro do painel de Conversas (communityChatMsgs) —
    // antes esta função sempre escrevia em #productsGrid, que fica escondido
    // atrás do painel de chat, então clicar num avatar parecia não fazer nada.
    const grid = document.getElementById('communityChatMsgs');
    if (!grid) return;

    grid.innerHTML = `
    <div class="detail-page">
        <div class="tw-feed-wrap">
            <div id="twProfileContent">${renderCommunitySkeleton()}</div>
        </div>
    </div>`;

    try {
        const userResult = await supabaseFetch(`users?select=id,nome,avatar,tipo,created_at&id=eq.${userId}&limit=1`);
        const profileUser = userResult?.[0];
        if (!profileUser) { document.getElementById('twProfileContent').innerHTML = `<div class="tw-empty-feed"><i class="bi bi-emoji-frown"></i>Usuário não encontrado.</div>`; return; }

        const posts = await twPostsQuery({ authorId: userId, parentId: null, orderDir: 'desc' });

        const memberSince = profileUser.created_at ? new Date(profileUser.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '—';
        const avatar = twAvatarUrl(profileUser);

        // Badge de tipo de conta — mesma informação (e mesmas cores) exibidas
        // no Electro Market ("Meu Perfil"), em vez do bloco de seguindo/seguidores.
        const tipoLabel = profileUser.tipo === 'ADMIN' ? 'Administrador' : (profileUser.tipo === 'VENDEDOR' ? 'Vendedor' : 'Cliente');
        const tipoClass = 'tipo-' + (profileUser.tipo === 'ADMIN' ? 'admin' : (profileUser.tipo === 'VENDEDOR' ? 'vendedor' : 'cliente'));

        const profileHeaderHtml = `
        <div class="tw-profile-card">
            <div class="tw-profile-cover"></div>
            <div class="tw-profile-info">
                <div class="d-flex justify-content-between align-items-end">
                    <img class="tw-avatar-lg" src="${avatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=1d9bf0&color=fff'">
                </div>
                <h5 class="fw-bold mt-2 mb-0">${twEscape(profileUser.nome || 'Usuário')}</h5>
                <span class="profile-links-badge ${tipoClass}" style="margin:6px 0 4px;">${tipoLabel}</span>
                <p class="text-muted small mb-0"><i class="bi bi-calendar3 me-1"></i>Na comunidade desde ${memberSince}</p>
                <div class="tw-profile-stats">
                    <span><strong>${posts?.length || 0}</strong> posts</span>
                </div>
            </div>
        </div>`;

        const authors = await twFetchAuthors([userId]);
        const postsHtml = (posts && posts.length)
            ? posts.map(p => renderCommunityPostCard(p, authors[String(userId)], me)).join('')
            : `<div class="tw-empty-feed"><i class="bi bi-chat-square-text"></i>Nenhum post ainda.</div>`;

        document.getElementById('twProfileContent').innerHTML = profileHeaderHtml + `<div id="twProfileTabPosts">${postsHtml}</div>`;
    } catch (e) {
        console.error('Erro ao carregar perfil:', e);
        document.getElementById('twProfileContent').innerHTML = `<div class="tw-empty-feed"><i class="bi bi-exclamation-triangle"></i>Erro ao carregar o perfil.</div>`;
    }
};

window.toggleCommunityFollow = async function(userId) {
    const me = getSavedUser();
    if (!me) { showToast('Faça login!', 'warning'); return; }
    const btn = document.getElementById('twFollowBtn');
    const countEl = document.getElementById('twFollowersCount');
    try {
        const existingId = await twFollowExists(me.id, userId);
        const isFollowing = !!existingId;
        if (isFollowing) {
            await twFollowDelete(existingId);
        } else {
            await twFollowCreate(me.id, userId);
        }
        if (btn) {
            btn.classList.toggle('following', !isFollowing);
            btn.textContent = !isFollowing ? 'Seguindo' : 'Seguir';
        }
        if (countEl) {
            const current = parseInt(countEl.textContent, 10) || 0;
            countEl.textContent = isFollowing ? Math.max(0, current - 1) : current + 1;
        }
    } catch (e) {
        console.error('Erro ao seguir/deixar de seguir:', e);
        showToast(`Erro ao atualizar: ${e?.message || e?.details || 'tente novamente.'}`, 'error');
    }
};

/** Abre a Comunidade dentro do painel de chat (ao lado, na tela de Conversas),
 *  igual a uma conversa normal — só que sem depender de nenhuma linha da
 *  tabela `chats` (essa dependência foi removida: antes a função procurava um
 *  grupo chamado "Comunidade ElectroMarket" que nunca era criado em lugar
 *  nenhum do código, e por isso o link sempre falhava com "Comunidade não
 *  encontrada"). O cabeçalho/rodapé são montados com renderChatContainer
 *  (mesmo usado pelas conversas diretas) e o conteúdo é o feed estilo
 *  Threads já existente, alimentado pela tabela `chats`. */
window.openCommunityInChat = async function() {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }
    window.setWaRailActive('comunidade');

    if (window.location.hash !== '#/chat/comunidade') {
        history.pushState(null, '', '#/chat/comunidade');
    }
    window.currentChat = 'community';
    window.lastChatSignature = null;
    stopDirectChatPolling();
    stopDirectTypingWatcher();

    const chatId = 'community';
    const msgsId = 'communityChatMsgs';

    const html = window.renderChatContainer({
        chatId,
        chat: {},
        partner: { name: 'Para você', avatar: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' },
        msgsId,
        inputId: `dinput_${chatId}`,
        previewId: `dpreview_${chatId}`,
        attachPanelId: `dattachPanel_${chatId}`,
        attachLinkId: `dattachLink_${chatId}`,
        statusBarId: `dstatusBar_${chatId}`,
        onBack: 'window.closeCommunityChat()',
        onClose: 'window.closeCommunityChat()',
        showBackBtn: true,
        showCloseBtn: true,
        showAttach: false,
        showProductSummary: false,
        headerSubtitle: 'Feed da comunidade'
    });

    const panel = document.getElementById('waChatActive');
    if (!panel) return;
    panel.innerHTML = html;
    panel.classList.remove('d-none');
    panel.classList.add('d-flex', 'tw-chat-community', 'community-active');
    // Splash de carregamento (ícone central + rótulo), igual telas de apps
    // nativos, cobrindo o painel até o feed inicial terminar de carregar.
    panel.insertAdjacentHTML('beforeend', `
        <div class="tw-community-splash" id="twCommunitySplash">
            <i class="bi bi-threads"></i>
            <div class="tw-community-splash-from">
                <span>de</span>
                <strong>Electro Market</strong>
            </div>
        </div>`);
    // Marca o instante em que o splash apareceu, pra garantir um tempo
    // mínimo de exibição mais à frente (o feed às vezes carrega rápido
    // demais e o splash sumia quase instantaneamente).
    const splashShownAt = Date.now();
    // Threads em tela inteira: some com a lateral de contatos/conversas
    // (.wa-rail + .wa-side) enquanto a Comunidade estiver aberta.
    document.getElementById('whatsappOrdersView')?.classList.add('wa-community-mode');

    // Ícone de comunidade no lugar do avatar (igual ao grupo antigo)
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
    const infoLine = document.getElementById(`${msgsId}InfoLine`);
    if (infoLine) infoLine.textContent = 'Feed da comunidade';
    // Remove o ícone de busca padrão do cabeçalho de conversa (não se aplica
    // ao feed da Comunidade, que não tem "mensagens" pra pesquisar).
    panel.querySelector('.chat-header-pro [title="Pesquisar na conversa"]')?.remove();
    // Remove o menu "..." do cabeçalho — o sino de notificações do Electro
    // Market fica no lugar, e "Voltar para Conversas" segue na sidebar.
    panel.querySelector('.chat-header-pro .dropdown')?.remove();
    // Remove o X (fechar) do cabeçalho — a saída é pela sidebar (Mensagens).
    panel.querySelector('.chat-header-pro .chat-header-x')?.remove();
    // Sino de notificações no cabeçalho (o botão de alterar tema foi removido
    // daqui). O sino abre as MESMAS notificações do Electro Market
    // (window.showNotifications, o dropdown global do site), com o mesmo
    // ícone bi-bell usado no header da plataforma.
    const headerPro = panel.querySelector('.chat-header-pro');
    if (headerPro) headerPro.insertAdjacentHTML('beforeend',
        `<button type="button" class="tw-notif-bell" onclick="event.preventDefault();window.showNotifications()" title="Notificações" aria-label="Notificações"><i class="bi bi-bell"></i></button>`
    );

    // O composer ("No que você está pensando?") não fica mais preso numa
    // barra fixa fora da área de rolagem — ele é renderizado dentro do
    // próprio feed (ver twComposerBoxHtml/loadMorePosts), logo abaixo do
    // cabeçalho "Para você", e rola junto com os posts como no app de
    // referência. A barra antiga de mensagens fica escondida.
    const inputBar = panel.querySelector('.chat-input-bar');
    if (inputBar) inputBar.classList.add('d-none');

    // A Comunidade já ocupa o painel inteiro por padrão — não faz sentido
    // oferecer a opção de "tela cheia" aqui (o botão fica escondido).
    // OBS: não mexe na classe wa-fullscreen do body — a tela "Conversas"
    // já conta com ela sempre ativa pra esconder a navbar do site; remover
    // aqui só fazia a navbar reaparecer por cima da Comunidade.
    document.getElementById('waSideFullscreenBtn')?.classList.add('d-none');

    document.getElementById('waEmptyState')?.classList.add('d-none');
    document.getElementById('whatsappOrdersView')?.classList.add('wa-chat-open');
    document.querySelectorAll('#waContactList .wa-contact').forEach(el => el.classList.remove('active-chat'));

    window._chatActiveElements = {
        input: null,
        container: document.getElementById(msgsId),
        statusBar: document.getElementById(`dstatusBar_${chatId}`),
        attachPanel: null,
        preview: null
    };

    const container = document.getElementById(msgsId);
    if (container) await renderCommunityFeedInChat(container, false);

    // Tira o splash de carregamento só depois de um tempo mínimo visível
    // (o feed às vezes carrega rápido demais e o splash sumia quase na
    // hora, dando a impressão de que não tinha introdução nenhuma), com
    // um fade de saída mais lento, pra não sumir seco.
    const MIN_SPLASH_MS = 900;
    const elapsed = Date.now() - splashShownAt;
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
    setTimeout(() => {
        const splash = document.getElementById('twCommunitySplash');
        if (splash) {
            splash.classList.add('tw-splash-out');
            setTimeout(() => splash.remove(), 500);
        }
    }, remaining);
};

/** Troca o nome exibido no cabeçalho do painel da Comunidade (onde normalmente
 *  fica "Para você") pelo título da tela aberta (Pesquisar, Atividade,
 *  Seguindo, Repostados...). Chamada por cada uma das telas da sidebar; o
 *  twSidebarGoFeed devolve o nome padrão "Para você" ao voltar pro feed. */
function twSetCommunityHeaderTitle(title) {
    const nameEl = document.querySelector('#waChatActive .chat-header-pro .chat-header-name');
    if (nameEl) nameEl.textContent = title;
}

/** Itens da barra lateral do Threads (ver #twSidebar no index.html). Os que
 *  ainda não têm uma tela própria só avisam que estão a caminho, em vez de
 *  ficarem quebrados/sem reação. */
window.twSidebarGoFeed = function() {
    const container = document.getElementById('communityChatMsgs');
    if (container) {
        container.scrollTop = 0;
        renderCommunityFeedInChat(container, false);
    }
    twSetCommunityHeaderTitle('Para você');
};

window.twSidebarNovaThread = function() {
    const textarea = document.getElementById('dcomposer_community');
    if (textarea) {
        textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        textarea.focus();
    }
};

window.twSidebarGoProfile = function() {
    const user = getSavedUser();
    if (!user) { showToast('Faça login para editar seu perfil.', 'warning'); return; }
    window.showProfileEdit();
};

function twPageLoadingHtml() {
    return `<div class="tw-page-loading"><div class="spinner-border spinner-border-sm text-muted me-2"></div>Carregando...</div>`;
}

/** Página de busca da Comunidade (item "Pesquisar" da sidebar): posts + pessoas,
 *  usando só o banco atual (users + threads de chat). */
window.twSidebarGoSearch = function() {
    const container = document.getElementById('communityChatMsgs');
    if (!container) return;
    twSetCommunityHeaderTitle('Pesquisar');
    container.innerHTML = `
        <div class="tw-search-page">
            <div class="tw-search-box">
                <i class="bi bi-search"></i>
                <input type="text" id="twPageSearchInput" placeholder="Buscar posts e pessoas..." autocomplete="off"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();window.twRunCommunitySearch(this.value)}">
            </div>
            <div class="tw-search-hints"><small>Digite o termo e pressione Enter.</small></div>
            <div class="tw-chat-feed" id="twPageSearchResults"></div>
        </div>`;
    const input = document.getElementById('twPageSearchInput');
    if (input) input.focus();
};

window.twRunCommunitySearch = async function(raw) {
    const term = (raw || '').trim();
    const list = document.getElementById('twPageSearchResults');
    if (!list) return;
    if (term.length < 2) { list.innerHTML = '<div class="tw-empty-feed"><small>Digite pelo menos 2 letras.</small></div>'; return; }
    list.innerHTML = twPageLoadingHtml().replace('Carregando...', 'Buscando...');
    const termLower = term.toLowerCase();
    try {
        let userHtml = '';
        const usersRaw = await supabaseFetch(`users?select=id,nome,avatar&nome=ilike.*${encodeURIComponent(term)}*&limit=20`);
        const seenUserIds = new Set();
        const users = (usersRaw || []).filter(u => (seenUserIds.has(String(u.id)) ? false : (seenUserIds.add(String(u.id)), true)));
        if (users?.length) {
            userHtml = `<div class="tw-search-section-head">Pessoas</div>` + users.map(u => {
                const av = twAvatarUrl(u);
                return `<div class="tw-search-user-row" onclick="window.openCommunityProfile('${u.id}')">` +
                    `<img src="${av}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=1d9bf0&color=fff'">` +
                    `<span>${twEscape(u.nome || 'Usuário')}</span></div>`;
            }).join('');
        }

        const posts = await twPostsQuery({ parentId: null, orderDir: 'desc', limit: 200, offset: 0 });
        const seenPostIds = new Set();
        const matched = (posts || [])
            .filter(p => (p.content || '').toLowerCase().includes(termLower))
            .filter(p => (seenPostIds.has(String(p.id)) ? false : (seenPostIds.add(String(p.id)), true)))
            .slice(0, 30);
        let postHtml = '';
        if (matched.length) {
            const authors = await twFetchAuthors(matched.map(p => p.author_id));
            const me = getSavedUser();
            postHtml = `<div class="tw-search-section-head">Posts</div>` + matched.map(p => renderCommunityPostCard(p, authors[String(p.author_id)], me)).join('');
        }

        if (!userHtml && !postHtml) {
            list.innerHTML = `<div class="tw-empty-feed"><i class="bi bi-search"></i>Nada encontrado para “${twEscape(term)}”.</div>`;
            return;
        }
        list.innerHTML = `${userHtml}${postHtml}`;
    } catch (e) {
        console.error('Erro na busca da Comunidade:', e);
        list.innerHTML = `<div class="tw-empty-feed"><i class="bi bi-exclamation-triangle"></i>Erro ao buscar.</div>`;
    }
};

function twEmptyAtividadeHtml(msg) {
    return `<div class="tw-empty-feed"><i class="bi bi-heart"></i><span>${twEscape(msg)}</span></div>`;
}

function twAtividadeItemHtml(n, actors) {
    const a = actors[String(n.actorId)] || {};
    const avatar = twAvatarUrl(a);
    const name = twEscape(a?.nome || 'Alguém');
    const iconHtml = n.type === 'follow'
        ? `<div class="tw-notif-type-icon tw-notif-like"><i class="bi bi-person-plus-fill"></i></div>`
        : n.type === 'like'
            ? `<div class="tw-notif-type-icon tw-notif-like"><i class="bi bi-heart-fill"></i></div>`
            : `<div class="tw-notif-type-icon tw-notif-comment"><i class="bi bi-chat-left-fill"></i></div>`;
    const text = n.type === 'follow'
        ? `${name} começou a seguir você`
        : n.type === 'like'
            ? `${name} curtiu seu post${n.preview ? `: <i class="tw-notif-quote">${twEscape(n.preview.slice(0, 80))}</i>` : ''}`
            : `${name} comentou seu post: <i class="tw-notif-quote">${twEscape((n.preview || '').slice(0, 80))}</i>`;
    const openAction = n.postId
        ? `window.openCommunityThread('${n.postId}')`
        : `window.openCommunityProfile('${n.actorId}')`;
    return `
    <div class="tw-notif-item" onclick="${openAction}">
        <div class="tw-notif-avatar-wrap">
            <img class="tw-notif-avatar" src="${avatar}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=%3F&background=1d9bf0&color=fff'">
            ${iconHtml}
        </div>
        <div class="tw-notif-body">
            <div class="tw-notif-text">${text}</div>
            <div class="tw-notif-time">${twTimeAgoFull(n.createdAt)}</div>
        </div>
        <button type="button" class="tw-notif-del" onclick="event.stopPropagation();window.dismissCommunityNotif('${n.key}')" title="Excluir notificação"><i class="bi bi-x-lg"></i></button>
    </div>`;
}

/** Página de Atividade (item "Atividade" da sidebar): curtidas, comentários e
 *  novos seguidores, calculados só do banco atual (chats + users). */
window.twSidebarGoAtividade = async function() {
    const container = document.getElementById('communityChatMsgs');
    if (!container) return;
    twSetCommunityHeaderTitle('Atividade');
    container.innerHTML = `<div class="tw-chat-feed"><div id="twAtividadeList">${twPageLoadingHtml()}</div></div>`;
    const list = document.getElementById('twAtividadeList');
    if (!list) return;
    try {
        const me = getSavedUser();
        if (!me) { list.innerHTML = twEmptyAtividadeHtml('Faça login para ver sua atividade.'); return; }
        const notifs = await twComputeCommunityNotifs();
        const actorIds = [...new Set(notifs.map(n => n.actorId).filter(Boolean))];
        const actors = actorIds.length ? await twFetchAuthors(actorIds) : {};
        list.innerHTML = notifs.length
            ? notifs.map(n => twAtividadeItemHtml(n, actors)).join('')
            : twEmptyAtividadeHtml('Nenhuma atividade por enquanto. Curtidas, comentários e novos seguidores aparecem aqui.');
    } catch (e) {
        console.error('Erro ao carregar Atividade:', e);
        list.innerHTML = twEmptyAtividadeHtml('Erro ao carregar a Atividade.');
    }
};

/** Feed "Seguindo" (item Seguindo da sidebar): posts de quem eu sigo, com base
 *  nas linhas community_follow_* e nos posts da própria tabela `chats`. */
window.twSidebarGoFollowing = async function() {
    const container = document.getElementById('communityChatMsgs');
    if (!container) return;
    twSetCommunityHeaderTitle('Seguindo');
    container.innerHTML = `<div class="tw-chat-feed" id="twSeguindoFeed">${twPageLoadingHtml()}</div>`;
    const feed = document.getElementById('twSeguindoFeed');
    if (!feed) return;
    try {
        const me = getSavedUser();
        if (!me) { showToast('Faça login!', 'warning'); window.twSidebarGoFeed(); return; }
        const following = await twFollowingOf(me.id);
        const followingSet = new Set(following.map(String));
        const posts = await twPostsQuery({ parentId: null, orderDir: 'desc', limit: 100, offset: 0 });
        const seenSeguindoIds = new Set();
        const filtered = (posts || [])
            .filter(p => followingSet.has(String(p.author_id)))
            .filter(p => (seenSeguindoIds.has(String(p.id)) ? false : (seenSeguindoIds.add(String(p.id)), true)));
        if (!filtered.length) {
            feed.innerHTML = `<div class="tw-empty-feed"><i class="bi bi-people"></i>Nenhum post de quem você segue por aqui.<br><small>Quando as pessoas que você segue postarem, aparecerá aqui.</small></div>`;
            return;
        }
        const authors = await twFetchAuthors(filtered.map(p => p.author_id));
        const user = getSavedUser();
        feed.innerHTML = filtered.map(p => renderCommunityPostCard(p, authors[String(p.author_id)], user)).join('');
    } catch (e) {
        console.error('Erro ao carregar feed Seguindo:', e);
        feed.innerHTML = `<div class="tw-empty-feed"><i class="bi bi-exclamation-triangle"></i>Erro ao carregar.</div>`;
    }
};

/** Página "Repostados": mostra os posts (originais e respostas) que o usuário
 *  repostou — campo `reposts` (array de ids) guardado em cada mensagem do chat. */
window.twSidebarGoReposts = async function() {
    const container = document.getElementById('communityChatMsgs');
    if (!container) return;
    twSetCommunityHeaderTitle('Repostados');
    container.innerHTML = `<div class="tw-chat-feed" id="twRepostsFeed">${twPageLoadingHtml()}</div>`;
    const feed = document.getElementById('twRepostsFeed');
    if (!feed) return;
    try {
        const me = getSavedUser();
        if (!me) { showToast('Faça login!', 'warning'); window.twSidebarGoFeed(); return; }
        const rows = await supabaseFetch(`chats?id=like.${TW_POST_PREFIX}*&select=id,messages&limit=100`);
        const posts = [];
        const seenRepostIds = new Set();
        (rows || []).forEach(row => {
            const msgs = Array.isArray(row.messages) ? row.messages : [];
            msgs.forEach(m => {
                const reposts = Array.isArray(m.reposts) ? m.reposts : [];
                if (reposts.some(id => String(id) === String(me.id)) && !seenRepostIds.has(String(m.id))) {
                    const p = twMapPostRow(row, m.id);
                    if (p) { posts.push(p); seenRepostIds.add(String(m.id)); }
                }
            });
        });
        posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        if (!posts.length) {
            feed.innerHTML = `<div class="tw-empty-feed"><i class="bi bi-arrow-repeat"></i>Nenhum post repostado ainda.<br><small>Quando você repostar algo (menu ⋮ de um post), aparecerá aqui.</small></div>`;
            return;
        }
        const authors = await twFetchAuthors(posts.map(p => p.author_id));
        feed.innerHTML = posts.map(p => renderCommunityPostCard(p, authors[String(p.author_id)], me)).join('');
    } catch (e) {
        console.error('Erro ao carregar Repostados:', e);
        feed.innerHTML = `<div class="tw-empty-feed"><i class="bi bi-exclamation-triangle"></i>Erro ao carregar.</div>`;
    }
};

window.twSidebarComingSoon = function(label) {
    showToast(`${label}: em breve`, 'info');
};

/** Fecha a Comunidade e volta pro estado normal da tela de Conversas. */
window.closeCommunityChat = function() {
    window.closeDirectChat();
    document.getElementById('whatsappOrdersView')?.classList.remove('wa-community-mode');
    document.getElementById('waSideFullscreenBtn')?.classList.add('d-none');
    // Não remove wa-fullscreen aqui: a tela "Conversas" pra onde estamos
    // voltando também depende dela pra manter a navbar do site escondida.
    // Removê-la fazia a navbar reaparecer ao sair da Comunidade.
};

/** Renderiza feed de posts da Comunidade dentro do chat com paginação */
let _twFeedOffset = 0;
const _TW_FEED_LIMIT = 20;

async function renderCommunityFeedInChat(container, silent) {
    _twFeedOffset = 0;
    await loadMorePosts(container, silent, true);
}

async function loadMorePosts(container, silent, reset = false) {
    try {
        const posts = await twPostsQuery({ parentId: null, orderDir: 'desc', limit: _TW_FEED_LIMIT, offset: _twFeedOffset });
        if (!posts || !posts.length) {
            if (reset) {
                container.innerHTML = `<div class="tw-feed-card">${window.twComposerBoxHtml('community')}<div class="tw-chat-feed"><div class="tw-empty-feed"><i class="bi bi-people"></i>Nenhum post ainda.<br><small>Seja o primeiro a postar!</small></div></div></div>`;
            }
            return;
        }
        const authorIds = [...new Set((posts || []).map(p => p.author_id).filter(Boolean))];
        const authors = authorIds.length ? await twFetchAuthors(authorIds) : {};
        const user = getSavedUser();

        const feedHtml = (posts || []).map(p => renderCommunityPostCard(p, authors[String(p.author_id)], user)).join('');
        const more = posts.length >= _TW_FEED_LIMIT;

        if (reset) {
            container.innerHTML = `<div class="tw-feed-card">${window.twComposerBoxHtml('community')}<div class="tw-chat-feed">${feedHtml}</div></div>`;
        } else {
            container.querySelector('.tw-chat-feed')?.insertAdjacentHTML('beforeend', feedHtml);
        }

        if (more) {
            _twFeedOffset += _TW_FEED_LIMIT;
            const loadMoreId = 'twLoadMore';
            const existing = document.getElementById(loadMoreId);
            if (existing) existing.remove();
            const btn = document.createElement('button');
            btn.id = loadMoreId;
            btn.className = 'tw-load-more';
            btn.textContent = 'Carregar mais';
            btn.onclick = async () => {
                btn.textContent = 'Carregando...';
                btn.disabled = true;
                await loadMorePosts(container, true, false);
                btn.remove();
            };
            container.querySelector('.tw-chat-feed')?.appendChild(btn);
        }

        if (!silent && reset) container.scrollTop = 0;
        if (reset) window.refreshCommunityNotifs().catch(() => {});
    } catch (e) {
        console.error('Erro ao carregar feed da Comunidade:', e);
        if (reset) container.innerHTML = `<div class="tw-feed-card">${window.twComposerBoxHtml('community')}<div class="text-center py-4 text-danger">Erro ao carregar Comunidade.</div></div>`;
    }
}

window.communityPickImageFromChat = function(chatId, input) {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const wrap = document.getElementById(`dcomposerPreview_${chatId}`);
    if (!wrap) return;
    wrap.classList.remove('d-none');
    wrap.innerHTML = `<div class="tw-composer-preview"><img src="${URL.createObjectURL(file)}"><button type="button" class="tw-remove-img" onclick="window.communityRemoveImageFromChat('${chatId}')"><i class="bi bi-x-lg"></i></button></div>`;
    window._twPendingImage = 'uploading';
    _uploadToImgur(file).then(url => {
        window._twPendingImage = url || null;
        if (!url) { showToast('Falha ao enviar imagem.', 'error'); wrap.innerHTML = ''; wrap.classList.add('d-none'); }
    });
};

window.communityRemoveImageFromChat = function(chatId) {
    window._twPendingImage = null;
    const wrap = document.getElementById(`dcomposerPreview_${chatId}`);
    if (wrap) { wrap.innerHTML = ''; wrap.classList.add('d-none'); }
};

window.submitCommunityPostFromChat = async function(chatId) {
    const user = getSavedUser();
    if (!user) { showToast('Faça login!', 'warning'); return; }
    const textEl = document.getElementById(`dcomposer_${chatId}`);
    const content = (textEl?.value || '').trim();
    if (!content && !window._twPendingImage) { showToast('Escreva algo ou adicione uma imagem.', 'warning'); return; }
    if (window._twPendingImage === 'uploading') { showToast('Aguarde a imagem terminar de enviar...', 'info'); return; }

    const btn = textEl?.closest('.tw-composer')?.querySelector('.tw-post-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Postando...'; }
    try {
        await twPostCreate({ author_id: user.id, content, image: window._twPendingImage || null, parent_id: null });
        if (textEl) { textEl.value = ''; textEl.style.height = 'auto'; }
        window.communityRemoveImageFromChat(chatId);
        showToast('Postado!', 'success');
        const container = window._chatActiveElements?.container;
        if (container) await renderCommunityFeedInChat(container, false);
    } catch (e) {
        console.error('Erro ao postar (chat):', e);
        showToast(`Erro ao postar: ${e?.message || e?.details || 'tente novamente.'}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Postar'; }
    }
};
