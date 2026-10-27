// ============================================
// FILMES — Tela estilo Netflix com dados reais
// Fontes: Invidious (rotaciona instâncias),
//         Piped (rotaciona instâncias),
//         Odysee (Lighthouse),
//         GamerPower, Jogos Retrô,
//         Rádios (Radio Browser)
// CORRIGIDO PARA FUNCIONAR LOCALMENTE E NO VERCEL
// ============================================
(function () {
    // ---------------------------------------------------------------
    // HELPERS COMPARTILHADOS
    // ---------------------------------------------------------------
    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function gerarId(fonte, titulo) {
        try {
            const str = `${fonte}-${titulo}`.slice(0, 80);
            return btoa(unescape(encodeURIComponent(str))).replace(/=/g, '').slice(0, 20);
        } catch {
            return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        }
    }

    function deduplicar(arr) {
        const seen = new Set();
        return arr.filter(item => {
            if (!item?.titulo) return false;
            const k = (item.titulo + (item.fonte || '')).toLowerCase().replace(/\s/g, '');
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    }

    function getLista() {
        try { return JSON.parse(localStorage.getItem('electroFilmesLista')) || []; } catch { return []; }
    }
    function setLista(list) {
        try { localStorage.setItem('electroFilmesLista', JSON.stringify(list)); } catch {}
    }
    function inLista(id) { return getLista().includes(id); }

    // Decodifica entidades HTML (ex.: "Exterm&iacute;nio" -> "Extermínio")
    // vindas nas respostas das APIs (TV Maze, etc).
    function decodificarEntidades(s) {
        if (!s) return s;
        const mapa = {
            amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0',
            aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
            atilde: 'ã', otilde: 'õ', auml: 'ä', ouml: 'ö', uuml: 'ü',
            ccedil: 'ç', ntilde: 'ñ', agrave: 'à', egrave: 'è', igrave: 'ì',
            ograve: 'ò', ugrave: 'ù', aring: 'å', szlig: 'ß', yacute: 'ý',
            Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
            Atilde: 'Ã', Otilde: 'Õ', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
            Ccedil: 'Ç', Ntilde: 'Ñ', Agrave: 'À', Egrave: 'È', Igrave: 'Ì',
            Ograve: 'Ò', Ugrave: 'Ù', Aring: 'Å',
            deg: '°', middot: '·', hellip: '…', ndash: '–', mdash: '—',
            lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•',
            times: '×', divide: '÷', euro: '€', pound: '£', cent: '¢',
            yen: '¥', copy: '©', reg: '®', trade: '™'
        };
        return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, ent) => {
            if (ent[0] === '#') {
                const n = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
                try { return String.fromCodePoint(n); } catch { return m; }
            }
            return Object.prototype.hasOwnProperty.call(mapa, ent) ? mapa[ent] : m;
        });
    }

    const ITEMS_CACHE = new Map();
    function cacheItems(items) {
        (items || []).forEach(it => {
            if (!it?.id) return;
            if (it.titulo) it.titulo = decodificarEntidades(it.titulo);
            if (it.descricao) it.descricao = decodificarEntidades(it.descricao);
            if (it.sinopse) it.sinopse = decodificarEntidades(it.sinopse);
            ITEMS_CACHE.set(it.id, it);
        });
    }

    // Pool persistido: garante conteúdo imediato na tela, mesmo que todas as
    // fontes externas estejam lentas/indisponíveis no momento da visita.
    // (versão 2: descarta qualquer item antigo de fontes removidas)
    const POOL_KEY = 'electroFilmesPoolV2';
    // Fontes que já foram removidas: itens antigos delas saem do pool.
    const FONTES_REMOVIDAS = new Set(['Steam (Oficial)', 'GOG (Oficial)', 'PokeAPI', 'Pirate Bay', '1337x']);
    function salvarPool() {
        try {
            const arr = [...ITEMS_CACHE.values()].slice(0, 400);
            if (arr.length) localStorage.setItem(POOL_KEY, JSON.stringify(arr));
        } catch {}
    }
    function obterPoolSalvo() {
        try {
            const arr = JSON.parse(localStorage.getItem(POOL_KEY));
            if (!Array.isArray(arr)) return [];
            // Mapa reverso: nome/fonte do item -> chave da fonte
            const mapa = {};
            FONTES_SIDEBAR.forEach(f => { mapa[f.label] = f.key; mapa[f.heading] = f.key; });
            mapa['Nozu.me'] = 'animes';
            mapa['MyAnimeList'] = 'animes';
            return arr.filter(item => {
                if (!item) return false;
                if (FONTES_REMOVIDAS.has(item.fonte)) return false;
                const key = item.fonte ? (mapa[item.fonte] || null) : null;
                return !key || isFonteAtiva(key);
            });
        } catch { return []; }
    }

    // Rota da Mídia: id único e persistente da área (padrão das conversas,
    // ex.: #/chat/midia_9f17...). O mesmo id retorna em visitas futuras,
    // permitindo links diretos funcionarem após recarregar a página.
    const MIDIA_ID_KEY = 'electroMidiaId';
    const MIDIA_PREFIX = 'midia_';
    function obterMidiaId() {
        let id = null;
        try { id = localStorage.getItem(MIDIA_ID_KEY) || null; } catch {}
        if (!id) {
            id = (window.crypto && crypto.randomUUID)
                ? crypto.randomUUID()
                : ('m' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
            try { localStorage.setItem(MIDIA_ID_KEY, id); } catch {}
        }
        return MIDIA_PREFIX + id;
    }


    // PROXY UNIVERSAL (funciona localmente e no Vercel)
    // Cada caminho é tentado com timeout próprio para não travar a busca inteira
    // caso um deles esteja fora do ar ou muito lento.
    const PROXIES = [
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
        (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
        (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`
    ];

    async function fetchComTimeout(url, ms, headers) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        try {
            return await fetch(url, { signal: controller.signal, headers });
        } finally {
            clearTimeout(timer);
        }
    }

    // Converte a resposta em JSON. Retorna undefined se não for um JSON válido.
    function parseJsonResponse(text) {
        const s = String(text).trim().replace(/^\uFEFF/, '');
        if (!s) return undefined;
        try {
            const parsed = JSON.parse(s);
            // O endpoint /get do allorigins embrulha a resposta em { contents }
            if (parsed && typeof parsed === 'object' && 'contents' in parsed && parsed.contents) {
                try { return JSON.parse(parsed.contents); } catch { return parsed.contents; }
            }
            return parsed;
        } catch {
            return undefined;
        }
    }

    // ---------------------------------------------------------------
    // LOCALIZAÇÃO / REGIÃO DO USUÁRIO
    // Usa dados do cadastro quando logado, ou detecção de IP quando
    // for visitante. Fallback: idioma do navegador.
    // ---------------------------------------------------------------
    const REGIAO_CACHE_KEY = 'electroMidiaRegiao';
    function obterRegiaoUsuario() {
        try {
            const cached = localStorage.getItem(REGIAO_CACHE_KEY);
            if (cached) {
                const reg = JSON.parse(cached);
                if (reg?.ts && Date.now() - reg.ts < 1000 * 60 * 30) return reg.data;
            }
        } catch {}

        const user = (typeof window.getSavedUser === 'function') ? window.getSavedUser() : null;
        const lang = (navigator.language || navigator.userLanguage || 'pt-BR').split('-')[0];
        const country = (navigator.language || navigator.userLanguage || 'pt-BR').split('-')[1]?.toUpperCase() || 'BR';

        let state = null;
        let city = null;

        if (user) {
            state = user.estado || user.state || null;
            city = user.cidade || user.city || null;
        } else if (typeof window.guestDetectedRegion !== 'undefined' && window.guestDetectedRegion) {
            state = window.guestDetectedRegion.estado || window.guestDetectedRegion.state || null;
            city = window.guestDetectedRegion.cidade || window.guestDetectedRegion.city || null;
        }

        const data = {
            country,
            lang,
            state,
            city,
            isBrazil: state ? /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/.test(String(state).toUpperCase()) : country === 'BR',
            isLatinAmerica: ['BR','PT','AO','CV','GW','MZ','ST','TL','GQ','MO'].includes(country)
        };

        try { localStorage.setItem(REGIAO_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
        return data;
    }

    function termoRegionalizado(termo, regiao) {
        const base = String(termo || '').trim();
        if (!base || !regiao) return base;
        const sufixos = regiao.isBrazil ? ['brasileiro','brasileira','pt-br','português','portuguese','dublado','nacional'] : [];
        if (sufixos.length && !sufixos.some(s => base.toLowerCase().includes(s))) {
            return `${base} ${sufixos[0]}`;
        }
        return base;
    }

    async function fetchWithProxy(url, { timeout = 9000, headers = {} } = {}) {
        // Tenta o acesso direto (quando a API permite CORS) e depois os
        // proxies. Todos os caminhos rodam EM PARALELO: o primeiro que
        // retornar um JSON válido vence. Assim o tempo de espera fica
        // limitado a um único salto (em vez da soma de todos), evitando que
        // a busca marque a fonte como "indisponível" só porque a cadeia de
        // proxies ficou lenta.
        const caminhos = [
            () => fetchComTimeout(url, timeout, headers)
        ].concat(PROXIES.map(prox => () => fetchComTimeout(prox(url), timeout, headers)));

        return new Promise((resolve, reject) => {
            let pendentes = caminhos.length;
            let ultimoErro = null;
            caminhos.forEach((caminho) => {
                Promise.resolve()
                    .then(caminho)
                    .then((response) => {
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        return response.text();
                    })
                    .then((text) => {
                        const parsed = parseJsonResponse(text);
                        if (parsed === undefined) throw new Error('Resposta inválida');
                        return parsed;
                    })
                    .then(resolve)
                    .catch((e) => {
                        ultimoErro = e;
                        if (--pendentes === 0) reject(ultimoErro || new Error('Todos os caminhos falharam'));
                    });
            });
        });
    }

    async function carregarFonte(fn, termo, limite) {
        try {
            const regiao = obterRegiaoUsuario();
            const termoAjustado = termoRegionalizado(termo, regiao);
            const itens = await fn(termoAjustado, limite);
            const lista = Array.isArray(itens) ? itens : [];
            const final = lista.length && regiao ? priorizarRegional(lista, regiao) : lista;
            return { ok: true, itens: final };
        } catch (error) {
            console.warn('Fonte indisponível:', error);
            return { ok: false, itens: [] };
        }
    }

    function priorizarRegional(itens, regiao) {
        if (!Array.isArray(itens) || !itens.length) return itens;
        const alvo = (regiao.country || '').toUpperCase();
        const lang = (regiao.lang || '').toLowerCase();

        const score = (item) => {
            const texto = `${item.titulo || ''} ${item.descricao || ''} ${item.sinopse || ''} ${item.fonte || ''}`.toLowerCase();
            let s = 0;
            if (alvo === 'BR') {
                if (/\bbrasil\b|\bbrasileiro\b|\bbrasileira\b|\bpt-br\b|\bdublado\b|\bnacional\b|\bportugu(e|ê)s\b/.test(texto)) s += 40;
            } else if (alvo) {
                if (new RegExp(`\\b${alvo.toLowerCase()}\\b`).test(texto)) s += 40;
            }
            if (lang && new RegExp(`\\b${lang}\\b`).test(texto)) s += 20;
            return s;
        };

        return itens
            .map(item => ({ item, score: score(item) }))
            .sort((a, b) => (b.score - a.score) || 0)
            .map(({ item }) => item);
    }

    // ---------------------------------------------------------------
    // FONTE 1: Invidious (YouTube - via instâncias públicas + proxy)
    // ---------------------------------------------------------------
    const INSTANCIAS_INVIDIOUS_FIXAS = [
        'https://invidious.materialio.us',
        'https://inv.nadeko.net',
        'https://invidious.nerdvpn.de',
        'https://invidious.f5.si',
        'https://yt.chocolatemoo53.com',
        'https://invidious.tiekoetter.com'
    ];
    let _instanciasInvidiousCache = null;

    async function obterInstanciasInvidious() {
        if (_instanciasInvidiousCache) return _instanciasInvidiousCache;
        const instancias = [...INSTANCIAS_INVIDIOUS_FIXAS];
        try {
            const data = await fetchWithProxy('https://api.invidious.io/instances.json', { timeout: 5000, headers: { Accept: 'application/json' } });
            if (Array.isArray(data)) {
                const dinamicas = data
                    .filter(([, d]) => d && d.type === 'https' && typeof d.uri === 'string' && d.uri.startsWith('https://'))
                    .sort((a, b) => (b[1]?.stats?.usage?.users?.total || 0) - (a[1]?.stats?.usage?.users?.total || 0))
                    .map(([, d]) => d.uri);
                dinamicas.forEach(u => { if (!instancias.includes(u)) instancias.push(u); });
            }
        } catch (e) { /* mantém a lista fixa */ }
        _instanciasInvidiousCache = instancias;
        return instancias;
    }

    async function buscarInvidious(termo = '', limite = 20) {
        const regiao = obterRegiaoUsuario();
        const query = termo || 'populares';
        const instancias = await obterInstanciasInvidious();
        let ultimoErro = null;
        let houveRespostaValida = false;

        for (const instancia of instancias) {
            const url = `${instancia}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance&region=${regiao.country}&hl=${regiao.lang}`;
            try {
                const data = await fetchWithProxy(url, { timeout: 8000, headers: { Accept: 'application/json' } });
                if (!Array.isArray(data)) { ultimoErro = new Error('Resposta inválida'); continue; }
                houveRespostaValida = true;

                const itens = data
                    .filter(item => item.type === 'video' && item.videoId && item.title)
                    .slice(0, limite)
                    .map(item => {
                        const duration = item.lengthSeconds || 0;
                        const minutes = Math.floor(duration / 60);
                        const seconds = duration % 60;
                        const duracao = duration > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : '';
                        const thumbnail = item.videoThumbnails?.[item.videoThumbnails.length - 1]?.url || 
                                         item.videoThumbnails?.[0]?.url || null;

                        return {
                            id: gerarId('Invidious', item.videoId),
                            titulo: item.title,
                            descricao: item.description || `${item.author || 'Canal desconhecido'} • ${duracao}`,
                            ano: item.publishedText || '',
                            capa: thumbnail,
                            poster: thumbnail,
                            link: `https://www.youtube.com/watch?v=${item.videoId}`,
                            fonte: 'Invidious (YouTube)',
                            categoria: 'video',
                            genero: 'Vídeo',
                            nota: Math.min(10, Math.round((item.viewCount || 0) / 1000000 + 5)),
                            emoji: '▶️',
                            grad: ['#ff0000', '#cc0000'],
                            views: item.viewCount || 0,
                            likes: item.likeCount || 0,
                            sinopse: item.description || `Vídeo de ${item.author || 'YouTube'}`
                        };
                    });

                if (itens.length) return itens;
            } catch (error) {
                ultimoErro = error;
            }
        }

        // Se alguma instância respondeu (mesmo sem resultados), é "sem resultados".
        // Se nenhuma respondeu, a fonte está indisponível.
        if (houveRespostaValida) return [];
        throw ultimoErro || new Error('Invidious indisponível');
    }

    // ---------------------------------------------------------------
    // FONTE 2: Piped (YouTube - via instâncias públicas + proxy)
    // ---------------------------------------------------------------
    const INSTANCIAS_PIPED_FIXAS = [
        'https://api.piped.private.coffee',
        'https://pipedapi.kavin.rocks'
    ];
    let _instanciasPipedCache = null;

    async function obterInstanciasPiped() {
        if (_instanciasPipedCache) return _instanciasPipedCache;
        const instancias = [...INSTANCIAS_PIPED_FIXAS];
        try {
            const data = await fetchWithProxy('https://piped-instances.kavin.rocks/', { timeout: 5000, headers: { Accept: 'application/json' } });
            if (Array.isArray(data)) {
                const dinamicas = data
                    .filter(i => i && typeof i.api_url === 'string' && i.api_url.startsWith('https://') && Number(i.uptime_24h) >= 90)
                    .sort((a, b) => Number(b.uptime_24h || 0) - Number(a.uptime_24h || 0))
                    .map(i => i.api_url);
                dinamicas.forEach(u => { if (!instancias.includes(u)) instancias.push(u); });
            }
        } catch (e) { /* mantém a lista fixa */ }
        _instanciasPipedCache = instancias;
        return instancias;
    }

    async function buscarPiped(termo = '', limite = 20) {
        const regiao = obterRegiaoUsuario();
        const query = termo || 'populares';
        const instancias = await obterInstanciasPiped();
        let ultimoErro = null;
        let houveRespostaValida = false;

        for (const instancia of instancias) {
            const url = `${instancia}/search?q=${encodeURIComponent(query)}&filter=videos&region=${regiao.country}&lang=${regiao.lang}`;
            try {
                const data = await fetchWithProxy(url, { timeout: 8000, headers: { Accept: 'application/json' } });
                // As instâncias Piped podem responder em dois formatos:
                // array puro ou objeto { items: [...] }.
                const lista = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : null);
                if (!lista) { ultimoErro = new Error('Resposta inválida'); continue; }
                houveRespostaValida = true;

                const origem = new URL(instancia).origin;
                const absoluto = (p) => (p && !/^https?:\/\//i.test(p)) ? origem + p : p;

                const itens = lista
                    .filter(item => item.url && item.title && (!item.type || item.type === 'stream'))
                    .slice(0, limite)
                    .map(item => {
                        const duration = item.duration || 0;
                        const minutes = Math.floor(duration / 60);
                        const seconds = duration % 60;
                        const duracao = duration > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : '';

                        return {
                            id: gerarId('Piped', item.url),
                            titulo: item.title,
                            descricao: item.uploaderName || 'Canal desconhecido',
                            ano: item.uploadedDate || '',
                            capa: absoluto(item.thumbnail),
                            poster: absoluto(item.thumbnail),
                            link: absoluto(item.url) || '#',
                            fonte: 'Piped (YouTube)',
                            categoria: 'video',
                            genero: 'Vídeo',
                            nota: Math.min(10, Math.round((item.views || 0) / 1000000 + 5)),
                            emoji: '▶️',
                            grad: ['#ff0000', '#cc0000'],
                            views: item.views || 0,
                            sinopse: item.uploaderName || 'Vídeo do YouTube'
                        };
                    });

                if (itens.length) return itens;
            } catch (error) {
                ultimoErro = error;
            }
        }

        if (houveRespostaValida) return [];
        throw ultimoErro || new Error('Piped indisponível');
    }

    

    // ---------------------------------------------------------------
    // FONTE 4: Odysee (API pública do Lighthouse - permite CORS)
    // ---------------------------------------------------------------
    async function buscarOdysee(termo = '', limite = 20) {
        const query = termo || 'populares';
        const url = `https://lighthouse.odysee.tv/search?s=${encodeURIComponent(query)}&size=${Math.min(50, limite * 2)}&from=0&claimType=stream&mediaType=video&resolve=true&nsfw=false`;

        const data = await fetchWithProxy(url, { timeout: 10000, headers: { Accept: 'application/json' } });

        if (!Array.isArray(data)) throw new Error('Resposta inválida do Odysee');
        if (!data.length) return [];

        return data
            .filter(item => item.name && item.claimId)
            .slice(0, limite)
            .map(item => {
                const duration = item.duration || 0;
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                const duracao = duration > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : '';
                return {
                    id: gerarId('Odysee', item.claimId),
                    titulo: item.title || item.name,
                    descricao: (item.channel || 'Canal do Odysee') + (duracao ? ` • ${duracao}` : ''),
                    ano: item.release_time ? new Date(item.release_time).getFullYear().toString() : '',
                    capa: item.thumbnail_url || null,
                    poster: item.thumbnail_url || null,
                    link: `https://odysee.com/${item.name}:${item.claimId}`,
                    fonte: 'Odysee',
                    categoria: 'video',
                    genero: 'Vídeo',
                    nota: 7,
                    emoji: '📹',
                    grad: ['#2c3e50', '#e67e22'],
                    views: 0,
                    likes: 0,
                    sinopse: `${item.title || item.name} • ${item.channel || 'Odysee'}`
                };
            });
    }

    // ---------------------------------------------------------------
    // FONTE: MangaDex
    // ---------------------------------------------------------------
    async function buscarMangaDex(termo = '', limite = 20) {
        try {
            const query = termo || 'popular';
            const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=${limite}&order[followedCount]=desc&includes[]=cover_art`;

            const data = await fetchWithProxy(url, { timeout: 10000, headers: { Accept: 'application/json' } });

            if (!data || !data.data || !Array.isArray(data.data)) {
                throw new Error('Resposta inválida do MangaDex');
            }

            const resultados = data.data.filter(item => item && item.id);
            if (resultados.length === 0) return [];

            return resultados.map(item => {
                const attrs = item.attributes || {};
                const titulo = attrs.title?.en || attrs.title?.ja || Object.values(attrs.title || {})[0] || 'Sem título';

                let capa = null;
                const coverRelation = item.relationships?.find(r => r.type === 'cover_art');
                if (coverRelation && coverRelation.id) {
                    capa = `https://uploads.mangadex.org/covers/${item.id}/${coverRelation.id}.256.jpg`;
                }

                return {
                    id: gerarId('MangaDex', item.id),
                    titulo,
                    descricao: `${attrs.status || 'Mangá'} • ${attrs.publicationDemographic || ''}`,
                    ano: attrs.year?.toString() || '',
                    capa,
                    poster: capa,
                    link: `https://mangadex.org/title/${item.id}`,
                    fonte: 'MangaDex',
                    categoria: 'geek',
                    genero: (attrs.tags || []).slice(0, 3).map(t => t.attributes?.name?.en).filter(Boolean).join(', ') || 'Mangá',
                    nota: 7,
                    emoji: '📖',
                    grad: ['#2c3e50', '#e74c3c'],
                    views: attrs.followedCount || 0,
                    sinopse: (attrs.description?.en || attrs.description?.ja || 'Mangá disponível no MangaDex').slice(0, 200)
                };
            });
        } catch (error) {
            console.warn('Erro ao buscar MangaDex:', error);
            throw error;
        }
    }

    // ---------------------------------------------------------------
// FONTE 6.1: Animes (Nozu.me API - pública com CORS)
    // → API pronta para uso: https://nozu.me/api/v1
    // Fallback: Jikan API (MyAnimeList) caso a Nozu.me esteja indisponível.
    // ---------------------------------------------------------------
    const CONSUMET_BASE = 'https://nozu.me/api/v1'; // Nozu.me API (pronta para uso, sem necessidade de chave)

    async function buscarAnimes(termo = '', limite = 20) {
        const query = termo || 'top';
        try {
            const url = `${CONSUMET_BASE}/search?q=${encodeURIComponent(query)}&type=anime&per_page=${limite}`;
            const data = await fetchWithProxy(url, { timeout: 10000 });
            if (!data.success || !Array.isArray(data.data)) throw new Error('Resposta inválida Nozu.me');
            const results = data.data;
            if (!results.length) throw new Error('Nenhum resultado encontrado');

            return results.slice(0, limite).map(a => {
                const titulo = a.title?.english || a.title?.romaji || a.title?.native || 'Anime';
                const capa = a.cover_image || null;
                const ano = a.start_year ? a.start_year.toString() : '';
                const genero = Array.isArray(a.genres) ? a.genres.join(', ') : 'Anime';
                const nota = a.average_score ? Math.min(10, Math.round(a.average_score / 10)) : 7;
                return {
                    id: gerarId('Anime', a.id + titulo),
                    titulo,
                    descricao: `${a.format} • ${a.episodes || '?'} eps • ${a.status || ''}`,
                    ano,
                    capa,
                    poster: capa,
                    link: a.url || `https://nozu.me/anime/${a.slug}`,
                    fonte: 'Nozu.me',
                    categoria: 'geek',
                    genero,
                    nota,
                    emoji: '🎬',
                    grad: ['#6a11cb', '#2575fc'],
                    views: a.popularity || 0,
                    sinopse: (a.description || '').replace(/<[^>]+>/g, '').slice(0, 200) || `Anime: ${titulo}`
                };
            });
        } catch (error) {
            console.warn('Consumet indisponível, usando Jikan:', error);
            // Fallback: Jikan API
            const jurl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=${limite}&sfw=true`;
            const jdata = await fetchWithProxy(jurl, { timeout: 10000 });
            if (!jdata?.data?.length) throw new Error('Resposta inválida Jikan');
            return jdata.data.map(anime => ({
                id: gerarId('Anime', anime.mal_id + anime.title),
                titulo: anime.title,
                descricao: `${anime.type || 'Anime'} • ${anime.episodes || '?'} eps • ${anime.status || ''}`,
                ano: anime.aired?.prop?.from?.year?.toString() || '',
                capa: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || null,
                poster: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || null,
                link: anime.url || `https://myanimelist.net/anime/${anime.mal_id}`,
                fonte: 'MyAnimeList',
                categoria: 'geek',
                genero: anime.genres?.slice(0, 3).map(g => g.name).join(', ') || 'Anime',
                nota: anime.score ? Math.min(10, Math.round(anime.score)) : 7,
                emoji: '🎬',
                grad: ['#6a11cb', '#2575fc'],
                views: anime.members || 0,
                sinopse: anime.synopsis?.replace(/<[^>]+>/g, '').slice(0, 200) || `Anime: ${anime.title}`
            }));
        }
    }

    // ---------------------------------------------------------------
    // FONTE: Epic Games (API Oficial)
    // ---------------------------------------------------------------
    async function buscarEpic_Oficial(termo = '', limite = 20) {
        try {
            const url = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=pt-BR&country=BR';
            const data = await fetchWithProxy(url, { timeout: 10000 });

            if (!data || !data.data || !data.data.Catalog) throw new Error('Resposta inválida da Epic');

            let jogos = data.data.Catalog.searchStore.elements || [];

            if (termo) {
                const termoLower = termo.toLowerCase();
                jogos = jogos.filter(jogo => jogo.title?.toLowerCase().includes(termoLower));
            }

            return jogos.slice(0, limite).map(jogo => {
                const titulo = jogo.title || 'Jogo Epic';
                const capa = jogo.keyImages?.find(img => img.type === 'Thumbnail')?.url ||
                             jogo.keyImages?.find(img => img.type === 'DieselStoreFrontWide')?.url || null;
                const preco = jogo.price?.totalPrice?.fmtPrice?.originalPrice || 'Grátis';
                const link = `https://store.epicgames.com/pt-BR/p/${jogo.productSlug || jogo.id}`;
                const isFree = jogo.price?.totalPrice?.discountPrice === 0 || !jogo.price;

                return {
                    id: gerarId('Epic_Official', jogo.id),
                    titulo,
                    descricao: `🎮 ${isFree ? '🔴 GRÁTIS' : preco} • ${jogo.developer || ''}`,
                    ano: jogo.releaseDate || '',
                    capa,
                    poster: capa,
                    link,
                    fonte: 'Epic Games (Oficial)',
                    categoria: 'jogo',
                    genero: jogo.genre || 'Jogo',
                    nota: 7,
                    emoji: '🎮',
                    grad: isFree ? ['#2d5016', '#4a8c1c'] : ['#1a1a2e', '#16213e'],
                    sinopse: `${titulo} • ${isFree ? 'Grátis!' : preco} • ${jogo.developer || 'Epic Games'}`
                };
            });
        } catch (error) {
            console.warn('Erro ao buscar Epic:', error);
            throw error;
        }
    }

    // ---------------------------------------------------------------
    // FONTE 6: GamerPower (Jogos Grátis - API pública sem CORS)
    // ---------------------------------------------------------------
    async function buscarGamerPower(termo = '', limite = 20) {
        try {
            const url = `https://www.gamerpower.com/api/giveaways${termo ? `?title=${encodeURIComponent(termo)}` : ''}`;
            const response = await fetchComTimeout(url, 9000);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!Array.isArray(data)) throw new Error('Resposta inválida');

            return data
                .filter(game => game.title && game.open_giveaway_url)
                .map(game => ({
                    id: gerarId('GamerPower', game.title),
                    titulo: game.title,
                    descricao: game.description || `${game.platform || 'PC'} | ${game.type || 'Grátis'}`,
                    ano: game.published_date ? new Date(game.published_date).getFullYear().toString() : '',
                    capa: game.image || null,
                    poster: game.thumbnail || game.image || null,
                    link: game.open_giveaway_url || game.link || '#',
                    fonte: 'GamerPower',
                    categoria: 'jogo',
                    genero: 'Grátis',
                    nota: game.worth && game.worth !== 'N/A' ? Math.min(10, Math.round(parseInt(game.worth))) : 7.5,
                    emoji: '🎁',
                    grad: ['#2d5016', '#4a8c1c'],
                    plataforma: game.platform || 'PC',
                    likes: game.users || 0,
                    worth: game.worth || 'Grátis',
                    sinopse: `${game.type || 'Jogo'} gratuito por tempo limitado!`
                }))
                .sort((a, b) => (b.likes || 0) - (a.likes || 0))
                .slice(0, limite);

        } catch (error) {
            console.warn('GamerPower fetch error:', error);
            throw error;
        }
    }

    // ---------------------------------------------------------------
    // FONTE 7: Jogos Retrô (Internet Archive via proxy)
    // ---------------------------------------------------------------
    async function buscarJogosRetro(termo = '', limite = 20) {
        try {
            const colecoes = [
                'internetarcade',
                'softwarelibrary_msdos'
            ];
            
            const resultados = [];
            let houveFalha = false;
            await Promise.allSettled(colecoes.map(async (col) => {
                try {
                    const q = termo
                        ? `collection:${col} AND (title:(${encodeURIComponent(termo)}) OR subject:(${encodeURIComponent(termo)}))`
                        : `collection:${col}`;
                    const url = `https://archive.org/advancedsearch.php?q=${q}&fl=identifier,title,year&rows=5&output=json&sort[]=downloads+desc`;
                    
                    const data = await fetchWithProxy(url);
                    
                    (data.response?.docs || []).forEach(i => {
                        resultados.push({
                            id: gerarId('Retro', i.identifier),
                            titulo: i.title || 'Jogo Retrô',
                            descricao: `Coleção: ${col === 'internetarcade' ? 'Arcade' : 'MS-DOS'}`,
                            ano: i.year?.toString() || '',
                            capa: i.identifier ? `https://archive.org/services/img/${i.identifier}` : null,
                            link: `https://archive.org/details/${i.identifier}`,
                            fonte: 'Internet Archive',
                            categoria: 'jogo',
                            genero: col === 'internetarcade' ? 'Arcade' : 'MS-DOS',
                            nota: 7.5,
                            emoji: col === 'internetarcade' ? '👾' : '💾',
                            grad: ['#2c3e50', '#e74c3c'],
                            sinopse: `Jogo disponível no Internet Archive (${col})`
                        });
                    });
                } catch (e) { houveFalha = true; }
            }));

            if (termo && resultados.length === 0 && !houveFalha) {
                const fallbackUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(termo)}&fl=identifier,title,year&rows=${limite}&output=json&sort[]=downloads+desc`;
                const data = await fetchWithProxy(fallbackUrl);
                (data.response?.docs || []).forEach(i => {
                    resultados.push({
                        id: gerarId('Retro', i.identifier),
                        titulo: i.title || 'Jogo Retrô',
                        descricao: 'Internet Archive',
                        ano: i.year?.toString() || '',
                        capa: i.identifier ? `https://archive.org/services/img/${i.identifier}` : null,
                        link: `https://archive.org/details/${i.identifier}`,
                        fonte: 'Internet Archive',
                        categoria: 'jogo',
                        genero: 'Retrô',
                        nota: 7.5,
                        emoji: '🕹️',
                        grad: ['#2c3e50', '#e74c3c'],
                        sinopse: `Jogo disponível no Internet Archive`
                    });
                });
            }

            if (resultados.length === 0 && houveFalha) throw new Error('Internet Archive indisponível');
            return resultados;
                
        } catch (error) {
            console.warn('Erro ao buscar jogos retrô:', error);
            throw error;
        }
    }

    // ---------------------------------------------------------------
    // FONTE: Epic Games (API Oficial)
    // ---------------------------------------------------------------
    async function buscarEpic_Oficial(termo = '', limite = 20) {
        try {
            const url = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=pt-BR&country=BR';
            const data = await fetchWithProxy(url, { timeout: 10000 });

            if (!data || !data.data || !data.data.Catalog) throw new Error('Resposta inválida da Epic');

            let jogos = data.data.Catalog.searchStore.elements || [];

            if (termo) {
                const termoLower = termo.toLowerCase();
                jogos = jogos.filter(jogo => jogo.title?.toLowerCase().includes(termoLower));
            }

            return jogos.slice(0, limite).map(jogo => {
                const titulo = jogo.title || 'Jogo Epic';
                const capa = jogo.keyImages?.find(img => img.type === 'Thumbnail')?.url ||
                             jogo.keyImages?.find(img => img.type === 'DieselStoreFrontWide')?.url || null;
                const isFree = jogo.price?.totalPrice?.discountPrice === 0 || !jogo.price;
                const preco = jogo.price?.totalPrice?.fmtPrice?.originalPrice || 'Grátis';

                return {
                    id: gerarId('Epic_Oficial', jogo.id),
                    titulo,
                    descricao: `🎮 ${isFree ? '🔴 GRÁTIS' : preco} • ${jogo.developer || ''}`,
                    ano: jogo.releaseDate || '',
                    capa,
                    poster: capa,
                    link: `https://store.epicgames.com/pt-BR/p/${jogo.productSlug || jogo.id}`,
                    fonte: 'Epic Games (Oficial)',
                    categoria: 'jogo',
                    genero: jogo.genre || 'Jogo',
                    nota: 7,
                    emoji: '🎮',
                    grad: isFree ? ['#2d5016', '#4a8c1c'] : ['#1a1a2e', '#16213e'],
                    sinopse: `${titulo} • ${isFree ? 'Grátis!' : preco}`
                };
            });
        } catch (error) {
            console.warn('Erro ao buscar Epic:', error);
            throw error;
        }
    }

    // ---------------------------------------------------------------
    // FONTE 9: iTunes Search API (músicas, filmes, livros, podcasts, apps)
    // API pública, sem chave, sem CORS.
    // ---------------------------------------------------------------
    async function buscarItunes(termo = '', limite = 20) {
        const regiao = obterRegiaoUsuario();
        try {
            const entityMap = { video: 'movie', audio: 'song', jogo: 'software', livro: 'ebook' };
            const entity = termo ? (entityMap[termo] || 'all') : 'song';
            const url = `https://itunes.apple.com/search?term=${encodeURIComponent(termo || 'top')}&entity=${entity}&limit=${limite}&country=${regiao.country}&lang=${regiao.lang}`;

            const data = await fetchWithProxy(url);

            if (!Array.isArray(data?.results)) throw new Error('Resposta inválida iTunes');

            return data.results
                .filter(item => item.trackName || item.collectionName)
                .slice(0, limite)
                .map(item => ({
                    id: gerarId('iTunes', item.trackId || item.collectionId || item.trackName),
                    titulo: item.trackName || item.collectionName || 'Sem título',
                    descricao: `${item.artistName || ''} • ${item.primaryGenreName || ''}`,
                    ano: item.releaseDate ? new Date(item.releaseDate).getFullYear().toString() : '',
                    capa: item.artworkUrl100 || item.artworkUrl60 || null,
                    poster: item.artworkUrl100 || item.artworkUrl60 || null,
                    link: item.trackViewUrl || item.collectionViewUrl || '#',
                    fonte: 'iTunes',
                    categoria: item.kind === 'song' ? 'audio' : item.kind === 'feature-movie' ? 'video' : item.kind === 'ebook' ? 'livro' : 'app',
                    genero: item.primaryGenreName || 'Mídia',
                    nota: Math.min(10, Math.round((item.trackPrice || 0) > 0 ? 5 : 7)),
                    emoji: '🎵',
                    grad: ['#1a1a2e', '#16213e'],
                    views: 0,
                    sinopse: item.longDescription || item.shortDescription || item.collectionName || ''
                }));
        } catch (error) {
            console.warn('iTunes fetch error:', error);
            throw error;
        }
    }

    

    // ---------------------------------------------------------------
    // FONTE 13: Wikipedia (artigos aleatórios)
    // API pública, sem chave, sem CORS.
    // ---------------------------------------------------------------
    async function buscarWikipedia(termo = '', limite = 20) {
        const regiao = obterRegiaoUsuario();
        try {
            const langMap = { pt: 'pt', en: 'en', es: 'es', fr: 'fr', de: 'de', it: 'it', ru: 'ru', ja: 'ja', ko: 'ko', zh: 'zh' };
            const lang = langMap[regiao.lang] || 'pt';
            const base = `https://${lang}.wikipedia.org/w/api.php?origin=*`;
            let url;

            if (termo) {
                url = `${base}&action=query&list=search&srsearch=${encodeURIComponent(termo)}&srlimit=${limite}&format=json`;
                const data = await fetchWithProxy(url);

                if (!data?.query?.search) throw new Error('Resposta inválida Wikipedia');

                return data.query.search
                    .filter(page => page.title)
                    .slice(0, limite)
                    .map(page => ({
                        id: gerarId('Wiki', page.pageid),
                        titulo: page.title,
                        descricao: 'Wikipedia',
                        ano: '',
                        capa: null,
                        poster: null,
                        link: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
                        fonte: 'Wikipedia',
                        categoria: 'livro',
                        genero: 'Artigo',
                        nota: 7,
                        emoji: '📚',
                        grad: ['#1a1a2e', '#16213e'],
                        views: 0,
                        sinopse: page.snippet?.replace(/<[^>]+>/g, '') || `Artigo sobre ${page.title}`
                    }));
            } else {
                url = `${base}&action=query&list=random&rnnamespace=0&rnlimit=${limite}&format=json`;
                const data = await fetchWithProxy(url);

                if (!data?.query?.random) throw new Error('Resposta inválida Wikipedia');

                return data.query.random
                    .filter(page => page.title)
                    .slice(0, limite)
                    .map(page => ({
                        id: gerarId('Wiki', page.id),
                        titulo: page.title,
                        descricao: 'Wikipedia',
                        ano: '',
                        capa: null,
                        poster: null,
                        link: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
                        fonte: 'Wikipedia',
                        categoria: 'livro',
                        genero: 'Artigo',
                        nota: 7,
                        emoji: '📚',
                        grad: ['#1a1a2e', '#16213e'],
                        views: 0,
                        sinopse: `Artigo aleatório: ${page.title}`
                    }));
            }
        } catch (error) {
            console.warn('Wikipedia fetch error:', error);
            throw error;
        }
    }

    // ---------------------------------------------------------------
    // FONTE 14: TV Maze (séries de TV)
    // API pública, sem chave, sem CORS.
    // ---------------------------------------------------------------
    async function buscarTVMaze(termo = '', limite = 20) {
        try {
            const url = termo
                ? `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(termo)}`
                : 'https://api.tvmaze.com/shows?page=0';

            const data = await fetchWithProxy(url);

            const lista = termo ? (data?.map(item => item.show) || []) : (data || []);

            if (!lista.length) throw new Error('Resposta inválida TV Maze');

            return lista
                .filter(show => show.name)
                .slice(0, limite)
                .map(show => ({
                    id: gerarId('TVMaze', show.id),
                    titulo: show.name,
                    descricao: `${show.status || ''} • ${show.language || 'EN'}`,
                    ano: show.premiered ? new Date(show.premiered).getFullYear().toString() : '',
                    capa: show.image?.medium || show.image?.original || null,
                    poster: show.image?.original || show.image?.medium || null,
                    link: show.url || `https://www.tvmaze.com/shows/${show.id}`,
                    fonte: 'TV Maze',
                    categoria: 'video',
                    genero: show.genres?.slice(0, 3).join(', ') || 'Série',
                    nota: show.rating?.average ? Math.min(10, Math.round(show.rating.average)) : 7,
                    emoji: '📺',
                    grad: ['#1a1a2e', '#16213e'],
                    views: 0,
                    sinopse: show.summary?.replace(/<[^>]+>/g, '') || `Série: ${show.name}`
                }));
        } catch (error) {
            console.warn('TV Maze fetch error:', error);
            throw error;
        }
    }

    // ---------------------------------------------------------------
    // FONTE 15: Open Library (livros)
    // API pública, sem chave, sem CORS.
    // ---------------------------------------------------------------
    async function buscarOpenLibrary(termo = '', limite = 20) {
        try {
            const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(termo || 'fiction')}&limit=${limite}`;
            const data = await fetchWithProxy(url);

            if (!data?.docs?.length) throw new Error('Resposta inválida Open Library');

            return data.docs
                .filter(book => book.title)
                .slice(0, limite)
                .map(book => {
                    const coverId = book.cover_i;
                    const capa = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : null;
                    return {
                        id: gerarId('OpenLib', book.key || book.title),
                        titulo: book.title,
                        descricao: `${book.author_name?.slice(0, 3).join(', ') || 'Autor desconhecido'} • ${book.first_publish_year || 'Ano desconhecido'}`,
                        ano: book.first_publish_year?.toString() || '',
                        capa,
                        poster: capa,
                        link: `https://openlibrary.org${book.key}`,
                        fonte: 'Open Library',
                        categoria: 'livro',
                        genero: book.subject?.slice(0, 3).join(', ') || 'Livro',
                        nota: 7,
                        emoji: '📖',
                        grad: ['#1a1a2e', '#16213e'],
                        views: 0,
                        sinopse: book.title_suggest || `Livro: ${book.title}`
                    };
                });
        } catch (error) {
            console.warn('Open Library fetch error:', error);
            throw error;
        }
    }

    // ---------------------------------------------------------------
    // FONTE 8: Radio Browser (Rádios ao Vivo - API pública sem CORS)
    // ---------------------------------------------------------------
    async function buscarRadios(termo = '', limite = 20) {
        const regiao = obterRegiaoUsuario();
        try {
            const countryParam = regiao.country !== 'US' ? `&country=${encodeURIComponent(regiao.country)}` : '';
            const query = termo ? `byname/${encodeURIComponent(termo)}${countryParam}` : `topvote${countryParam}`;
            const url = `https://de1.api.radio-browser.info/json/stations/${query}?limit=${limite}`;
            
            const response = await fetchComTimeout(url, 9000);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            if (!Array.isArray(data)) throw new Error('Resposta inválida');
            
            return (data || [])
                .filter(station => station.name && station.url_resolved)
                .map(station => ({
                    id: gerarId('Radio', station.name),
                    titulo: station.name,
                    descricao: `${station.country || 'Internacional'} | ${station.tags?.split(',').slice(0, 3).join(', ') || 'Rádio ao Vivo'}`,
                    ano: '',
                    capa: station.favicon || null,
                    poster: station.favicon || null,
                    link: station.url_resolved || station.url,
                    fonte: 'Radio Browser',
                    categoria: 'audio',
                    genero: 'Rádio',
                    nota: Math.min(10, Math.round((station.votes || 0) / 100 + 5) * 10) / 10,
                    emoji: '📻',
                    grad: ['#2c3e50', '#3498db'],
                    votes: station.votes || 0,
                    sinopse: `Estação de rádio de ${station.country || 'vários países'}`
                }))
                .sort((a, b) => (b.votes || 0) - (a.votes || 0))
                .slice(0, limite);

        } catch (error) {
            console.warn('Radio Browser fetch error:', error);
            throw error;
        }
    }

    



    // ---------------------------------------------------------------


    // ---------------------------------------------------------------
    // SEÇÕES DA TELA
    // ---------------------------------------------------------------
    const SECTIONS = [
        { key: 'invidious', heading: 'Vídeos (Invidious)', filter: () => carregarFonte(buscarInvidious, '', 20) },
        { key: 'piped', heading: 'Vídeos (Piped)', filter: () => carregarFonte(buscarPiped, '', 20) },
        { key: 'odysee', heading: 'Vídeos (Odysee)', filter: () => carregarFonte(buscarOdysee, '', 20) },
        { key: 'animes', heading: 'Animes', filter: () => carregarFonte(buscarAnimes, '', 20) },
        { key: 'gamerpower', heading: 'Jogos Grátis (GamerPower)', filter: () => carregarFonte(buscarGamerPower, '', 20) },
        { key: 'internetarchive', heading: 'Jogos Retrô (Internet Archive)', filter: () => carregarFonte(buscarJogosRetro, '', 20) },
        { key: 'itunes', heading: 'Músicas (iTunes)', filter: () => carregarFonte(buscarItunes, '', 20) },
        { key: 'radiobrowser', heading: 'Rádios (Radio Browser)', filter: () => carregarFonte(buscarRadios, '', 20) },
        { key: 'wikipedia', heading: 'Artigos (Wikipedia)', filter: () => carregarFonte(buscarWikipedia, '', 20) },
        { key: 'tvmaze', heading: 'Séries (TV Maze)', filter: () => carregarFonte(buscarTVMaze, '', 20) },
        { key: 'openlibrary', heading: 'Livros (Open Library)', filter: () => carregarFonte(buscarOpenLibrary, '', 20) },
        { key: 'mangadex', heading: 'Mangás (MangaDex)', filter: () => carregarFonte(buscarMangaDex, '', 20) },
        { key: 'epic_oficial', heading: 'Epic Games (Oficial)', filter: () => carregarFonte(buscarEpic_Oficial, '', 20) }
    ];

    // ---------------------------------------------------------------
    // ÍCONES DAS CATEGORIAS/FONTES (Bootstrap Icons - consistente)
    // ---------------------------------------------------------------
const ICONES_FONTE = {
        'Invidious (YouTube)': '<i class="bi bi-youtube"></i>',
        'Piped (YouTube)': '<i class="bi bi-youtube"></i>',
        'Odysee': '<i class="bi bi-camera-video"></i>',
        'MyAnimeList': '<i class="bi bi-film"></i>',
        'GamerPower': '<i class="bi bi-gift"></i>',
        'Internet Archive': '<i class="bi bi-archive"></i>',
        'iTunes': '<i class="bi bi-music-note-beamed"></i>',
        'Radio Browser': '<i class="bi bi-broadcast"></i>',
        'Wikipedia': '<i class="bi bi-book"></i>',
        'TV Maze': '<i class="bi bi-tv"></i>',
        'Open Library': '<i class="bi bi-book-half"></i>',
        'MangaDex': '<i class="bi bi-book"></i>',
        'Epic Games (Oficial)': '<i class="bi bi-controller"></i>'
    };

    const FONTES_SIDEBAR = [
        { key: 'invidious', label: 'Invidious', icon: 'bi-youtube', heading: 'Vídeos (Invidious)' },
        { key: 'piped', label: 'Piped', icon: 'bi-youtube', heading: 'Vídeos (Piped)' },
        { key: 'odysee', label: 'Odysee', icon: 'bi-camera-video', heading: 'Vídeos (Odysee)' },
        { key: 'animes', label: 'Animes', icon: 'bi-film', heading: 'Animes' },
        { key: 'gamerpower', label: 'GamerPower', icon: 'bi-gift', heading: 'Jogos Grátis (GamerPower)' },
        { key: 'internetarchive', label: 'Internet Archive', icon: 'bi-archive', heading: 'Jogos Retrô (Internet Archive)' },
        { key: 'itunes', label: 'iTunes', icon: 'bi-music-note-beamed', heading: 'Músicas (iTunes)' },
        { key: 'radiobrowser', label: 'Radio Browser', icon: 'bi-broadcast', heading: 'Rádios (Radio Browser)' },
        { key: 'wikipedia', label: 'Wikipedia', icon: 'bi-book', heading: 'Artigos (Wikipedia)' },
        { key: 'tvmaze', label: 'TV Maze', icon: 'bi-tv', heading: 'Séries (TV Maze)' },
        { key: 'openlibrary', label: 'Open Library', icon: 'bi-book-half', heading: 'Livros (Open Library)' },
        { key: 'mangadex', label: 'MangaDex', icon: 'bi-book', heading: 'Mangás (MangaDex)' },
        { key: 'epic_oficial', label: 'Epic Games', icon: 'bi-controller', heading: 'Epic Games (Oficial)' }
    ];

    // ---------------------------------------------------------------
    // FONTES ATIVAS (o usuário liga/desliga quais fontes aparecem)
    // ---------------------------------------------------------------
    const FONTES_ATIVAS_KEY = 'electroFilmesFontesAtivas';
    function getFontesAtivas() {
        try {
            const arr = JSON.parse(localStorage.getItem(FONTES_ATIVAS_KEY));
            if (Array.isArray(arr) && arr.length) return new Set(arr);
        } catch {}
        return null;
    }
    function isFonteAtiva(key) {
        const ativas = getFontesAtivas();
        if (!ativas) return true;
        return ativas.has(key);
    }
    function toggleFonteAtiva(key, on) {
        let ativas = getFontesAtivas();
        if (!ativas) ativas = new Set(SECTIONS.map(s => s.key));
        if (on) ativas.add(key); else ativas.delete(key);
        try { localStorage.setItem(FONTES_ATIVAS_KEY, JSON.stringify([...ativas])); } catch {}
    }
    function getSecoesAtivas() {
        if (!getFontesAtivas()) return SECTIONS;
        return SECTIONS.filter(s => isFonteAtiva(s.key));
    }
    function getFontesSidebarAtivas() {
        return FONTES_SIDEBAR.filter(f => isFonteAtiva(f.key));
    }

    function atualizarStatusFontes() {
        FONTES_SIDEBAR.forEach(f => {
            [['ytFonteIcon-', f.key], ['ytFonteIconModal-', f.key]].forEach(([prefix]) => {
                const el = document.getElementById(prefix + f.key);
                if (!el) return;
                el.classList.remove('ok', 'warn', 'error');
                if (_fontesIndisponiveis.has(f.heading)) {
                    el.classList.add('error');
                } else if ([...ITEMS_CACHE.values()].some(it => it.fonte === f.label || it.fonte === f.heading)) {
                    el.classList.add('ok');
                } else {
                    el.classList.add('warn');
                }
            });
        });
    }

    // ---------------------------------------------------------------
    // ORDENAÇÃO DINÂMICA (estilo YouTube/Netflix)
    //   - Views locais (acessos desta visita/guardados) + views da API
    //   - Recência (data de publicação) e relevância (nota)
    // ---------------------------------------------------------------
    function scoreViews(item) {
        return (item.views || 0) + (item.acessos || 0);
    }
    function scoreRelevancia(item) {
        return (item.nota || 5) * 10 + Math.min(scoreViews(item) / 1000000, 10);
    }
    function scoreRecencia(item) {
        const ano = parseInt(String(item.ano || ''), 10);
        return isNaN(ano) ? 0 : ano;
    }
    function ordenarPor(tipo, itens) {
        const arr = [...itens];
        if (tipo === 'views') return arr.sort((a, b) => scoreViews(b) - scoreViews(a));
        if (tipo === 'relevancia') return arr.sort((a, b) => scoreRelevancia(b) - scoreRelevancia(a));
        if (tipo === 'recencia') return arr.sort((a, b) => scoreRecencia(b) - scoreRecencia(a));
        return arr;
    }

    // ---------------------------------------------------------------
    // SEÇÕES DINÂMICAS (estilo Netflix): Em Alta, Recentes,
    // Recomendados + categorias agregadas das fontes. Ordenadas por
    // popularidade, recência e relevância, sem repetir itens entre si.
    // ---------------------------------------------------------------
    const SECOES_DINAMICAS = [
        { id: 'em-alta', heading: 'Em Alta', icone: '<i class="bi bi-fire"></i>', tipo: 'views', feature: true, limite: 12 },
        { id: 'recentes', heading: 'Recentes', icone: '<i class="bi bi-clock-history"></i>', tipo: 'recencia', limite: 12 },
        { id: 'recomendados', heading: 'Recomendados', icone: '<i class="bi bi-star-fill"></i>', tipo: 'relevancia', limite: 12 },
        { id: 'video', heading: 'Vídeos & Séries', icone: '<i class="bi bi-play-btn-fill"></i>', tipo: 'categoria', categoria: 'video', limite: 20 },
        { id: 'audio', heading: 'Áudio & Rádio', icone: '<i class="bi bi-broadcast"></i>', tipo: 'categoria', categoria: 'audio', limite: 20 },
        { id: 'jogo', heading: 'Jogos', icone: '<i class="bi bi-controller"></i>', tipo: 'categoria', categoria: 'jogo', limite: 20 },
        { id: 'livro', heading: 'Livros & Curiosidades', icone: '<i class="bi bi-book-half"></i>', tipo: 'categoria', categoria: 'livro', limite: 20 },
        { id: 'geek', heading: 'Geek: Animes & Mangás', icone: '<i class="bi bi-stars"></i>', tipo: 'categoria', categoria: 'geek', limite: 20 }
    ];
    // Categorias "reais" da página (usadas pela nav de chips do mobile e pelo
    // header do desktop). Mantidas em um único lugar pra não duplicar a lista
    // em vários pontos do arquivo.
    const CATEGORIAS_NAV = [
        { id: 'inicio', label: 'Início', icone: 'bi-house-door-fill', acao: "window.nflxRecarregar()" },
        { id: 'video', label: 'Vídeos', icone: 'bi-play-btn-fill', acao: "window.nflxBuscarCategoria('video')" },
        { id: 'audio', label: 'Áudio', icone: 'bi-broadcast', acao: "window.nflxBuscarCategoria('audio')" },
        { id: 'jogo', label: 'Jogos', icone: 'bi-controller', acao: "window.nflxBuscarCategoria('jogo')" },
        { id: 'livro', label: 'Livros', icone: 'bi-book-half', acao: "window.nflxBuscarCategoria('livro')" },
        { id: 'geek', label: 'Geek', icone: 'bi-stars', acao: "window.nflxBuscarCategoria('geek')" }
    ];

    // ---------------------------------------------------------------
    // ACESSOS LOCAIS (localStorage) — usados para priorizar
    // popularidade com base no que o usuário realmente assiste.
    // ---------------------------------------------------------------
    const ACESSOS_KEY = 'electroFilmesAcessos';
    function getAcessos() {
        try { return JSON.parse(localStorage.getItem(ACESSOS_KEY)) || {}; } catch { return {}; }
    }
    function registrarAcesso(id) {
        if (!id) return;
        const a = getAcessos();
        a[id] = (Number(a[id]) || 0) + 1;
        try { localStorage.setItem(ACESSOS_KEY, JSON.stringify(a)); } catch {}
    }

    function getHistorico() {
        const acessos = getAcessos();
        return Object.entries(acessos)
            .map(([id, count]) => ({ id, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 50);
    }

    // ---------------------------------------------------------------
    // ESTADO LOCAL
    // ---------------------------------------------------------------
    let _hero = null;
    let _scrolled = false;
    const _fontesIndisponiveis = new Set();

    // Progresso real da introdução: só avança quando cada fonte responde.
    const _intro = { total: 0, concluido: 0, inicio: 0, revelar: null };

    function art(f) {
        if (f.grad) return `linear-gradient(160deg, ${f.grad.join(', ')})`;
        return `linear-gradient(160deg, #1a1a2e, #16213e)`;
    }

    function matchPct(f) {
        const nota = f.nota || 5;
        return `${Math.round(nota * 10)}% relevância`;
    }

    function labelFonte(f) {
        if (f.categoria === 'audio') return 'Ouvir';
        if (f.categoria === 'jogo') return 'Jogar / Resgatar';
        if (f.fonte === 'Open Library' || f.fonte === 'Wikipedia' || f.fonte === 'MangaDex') return 'Ler';
        return 'Assistir';
    }

    // ---------------------------------------------------------------
    // HTML DOS COMPONENTES
    // ---------------------------------------------------------------
    function roundBtn(f, type) {
        const map = {
            play: `<i class="bi ${f.categoria === 'audio' ? 'bi-play-fill' : 'bi-play-fill'}"></i>`,
            add: `<i class="bi ${inLista(f.id) ? 'bi-check-lg' : 'bi-plus'}" id="nflxAddIcon_${f.id}"></i>`,
            like: '<i class="bi bi-hand-thumbs-up"></i>',
            dislike: '<i class="bi bi-hand-thumbs-down"></i>',
            down: '<i class="bi bi-chevron-down"></i>'
        };
        const onclick = type === 'play'
            ? `window.nflxPlay('${f.id}')`
            : type === 'add'
                ? `window.nflxToggleLista('${f.id}')`
                : type === 'down'
                    ? `window.nflxOpenInfo('${f.id}')`
                    : `window.nflxReagir('${type}', '${f.id}')`;
        return `<button type="button" class="nflx-round${type === 'play' ? ' nflx-round-play' : ''}" onclick="${onclick}" title="${type}">${map[type]}</button>`;
    }

    function cardActions(f) {
        return `
            <div class="nflx-actionRow">
                <div class="nflx-actionRow">
                    ${roundBtn(f, 'play')}${roundBtn(f, 'add')}${roundBtn(f, 'like')}${roundBtn(f, 'dislike')}
                </div>
                ${roundBtn(f, 'down')}
            </div>`;
    }

    function cardDetails(f) {
        return `
            <strong class="nflx-card-title">${escapeHtml(f.titulo)}</strong>
            <div class="nflx-row">
                <span class="nflx-green">${matchPct(f)}</span>
                ${f.ano ? `<span class="nflx-text">${escapeHtml(f.ano)}</span>` : ''}
            </div>
            <div class="nflx-row">
                <span class="nflx-text">${escapeHtml(f.genero || f.categoria || 'Geral')}</span>
                ${f.fonte ? `<span class="nflx-text">• ${escapeHtml(f.fonte)}</span>` : ''}
            </div>`;
    }

    function renderCard(f) {
        const fallbackStyle = `background: ${art(f)};`;
        const capa = f.capa || f.poster || '';
        const titulo = escapeHtml(f.titulo);
        const fonte = escapeHtml(f.fonte || 'ElectroMarket');
        const sinopse = escapeHtml((f.sinopse || f.descricao || '').slice(0, 100));

        return `
        <div class="yt-video-card" onclick="window.nflxOpenInfo('${f.id}')">
            <div class="yt-video-thumb" style="${capa ? `background-image: url('${escapeHtml(capa)}'); background-size: cover; background-position: center;` : fallbackStyle}">
                ${!capa ? `<span class="yt-video-emoji">${f.emoji || '🎬'}</span>` : ''}
                <button type="button" class="yt-video-play" aria-hidden="true"><i class="bi bi-play-fill"></i></button>
            </div>
            <div class="yt-video-info">
                <div class="yt-video-details">
                    <div class="yt-video-title">${titulo}</div>
                    <div class="yt-video-channel">${fonte}</div>
                    <div class="yt-video-meta">${sinopse}</div>
                </div>
            </div>
        </div>`;
    }

    function renderFeatureCard(f) {
        const rank = f._rank != null ? `<span class="yt-feature-rank">#${f._rank}</span>` : '';
        const fallbackStyle = `background: ${art(f)};`;
        const viewsText = f.views ? `${(f.views / 1000).toFixed(1).replace('.0', '')}K visualizações` : '';
        const dateText = f.ano || '';
        const capa = f.capa || f.poster || '';

        return `
        <div class="yt-video-card" onclick="window.nflxOpenInfo('${f.id}')">
            <div class="yt-video-thumb" style="${capa ? `background-image: url('${escapeHtml(capa)}'); background-size: cover; background-position: center;` : fallbackStyle}">
                ${rank}${!capa ? `<span class="yt-video-emoji">${f.emoji || '🎬'}</span>` : ''}
            </div>
            <div class="yt-video-info">
                <img class="yt-video-avatar" src="https://ui-avatars.com/api/?name=${encodeURIComponent(f.fonte || 'EM')}&background=e50914&color=fff&size=64" alt="" onerror="this.style.display='none'">
                <div class="yt-video-details">
                    <div class="yt-video-title">${escapeHtml(f.titulo)}</div>
                    <div class="yt-video-channel">${escapeHtml(f.fonte || 'ElectroMarket')}</div>
                    <div class="yt-video-meta">${viewsText}${dateText ? ' • ' + escapeHtml(dateText) : ''}</div>
                </div>
            </div>
        </div>`;
    }

    window.nflxImgFallback = function(img, emoji) {
        if (!img || !img.parentNode) return;
        img.remove();
        const span = document.createElement('span');
        span.className = 'yt-video-emoji';
        span.textContent = emoji || '🎬';
        img.parentNode.appendChild(span);
    };

    function renderSection(section) {
        const rowId = `section-${section.id}`;
        return `
        <section class="yt-section" data-section="${section.heading}" data-secao-id="${section.id}">
            <h2 class="yt-section-title">${section.icone || ''} ${section.heading}</h2>
            <div class="yt-video-grid" id="${rowId}">
                <div class="yt-loading">Carregando...</div>
            </div>
        </section>`;
    }

    function renderBanner() {
        const banner = document.getElementById('ytBanner');
        if (!banner) return;

        const pool = [...ITEMS_CACHE.values()];
        if (!pool.length) {
            banner.innerHTML = '';
            return;
        }

        const acessos = getAcessos();
        const sorted = [...pool].sort((a, b) => (b.acessos || b.views || 0) - (a.acessos || a.views || 0));
        const destaque = sorted[0];

        const capa = destaque.capa || '';
        const fallbackStyle = `background: ${art(destaque)};`;
        const avatarSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(destaque.fonte || 'EM')}&background=e50914&color=fff&size=64`;

        banner.innerHTML = `
        <div class="yt-banner-card" onclick="window.nflxOpenInfo('${destaque.id}')">
            <div class="yt-banner-media" style="${fallbackStyle}">
                ${capa ? `<img src="${escapeHtml(capa)}" alt="${escapeHtml(destaque.titulo)}" loading="eager" onerror="window.nflxImgFallback(this, '🎬')">` : `<span class="yt-video-emoji">🎬</span>`}
                <div class="yt-banner-mask"></div>
            </div>
            <div class="yt-banner-info">
                <h2 class="yt-banner-title">${escapeHtml(destaque.titulo)}</h2>
                <p class="yt-banner-meta">${escapeHtml(destaque.fonte || 'ElectroMarket')} • ${(destaque.views || 0) > 0 ? ((destaque.views / 1000).toFixed(1).replace('.0', '') + 'K visualizações') : ''}</p>
                <div class="yt-banner-actions">
                    <button type="button" class="yt-banner-btn yt-banner-btn-primary" onclick="event.stopPropagation(); window.nflxPlay?.('${destaque.id}')">
                        <i class="bi bi-play-fill"></i> Assistir
                    </button>
                    <button type="button" class="yt-banner-btn yt-banner-btn-secondary" onclick="event.stopPropagation(); window.nflxOpenInfo('${destaque.id}')">
                        <i class="bi bi-info-circle"></i> Mais informações
                    </button>
                </div>
            </div>
        </div>`;
    }

    // Selo estilo "N SÉRIE" da Netflix, adaptado às categorias reais do app.
    function heroBadge(f) {
        const map = {
            video: 'VÍDEO',
            jogo: 'JOGO',
            audio: 'RÁDIO AO VIVO'
        };
        const texto = map[f.categoria] || 'DESTAQUE';
        return `
            <div class="nflx-banner-badge">
                <span class="nflx-banner-badge-mark"><i class="bi bi-play-fill"></i></span>
                <span class="nflx-banner-badge-text">${escapeHtml(texto)}</span>
            </div>`;
    }

    function renderHero() {
        if (!_hero) {
            return `
            <div class="nflx-banner">
                <div class="nflx-banner-art" style="background: linear-gradient(160deg, #1a1a2e, #16213e);"></div>
                <div class="nflx-banner-mask"></div>
                <div class="nflx-banner-details">
                    <h1 class="nflx-banner-title">Bem-vindo ao Mídias</h1>
                    <p class="nflx-banner-synopsis">Descubra vídeos, jogos grátis, jogos retrô e rádios em um só lugar.</p>
                </div>
            </div>`;
        }

        return `
        <div class="nflx-banner">
            <div class="nflx-banner-art" style="${_hero.capa ? `background-image: url('${escapeHtml(_hero.capa)}'); background-size: cover; background-position: center;` : `background:${art(_hero)}`}">
                ${!_hero.capa ? `<span class="nflx-art-emoji-hero">${_hero.emoji || '🎬'}</span>` : ''}
            </div>
            <div class="nflx-banner-mask"></div>
            <div class="nflx-banner-details">
                ${heroBadge(_hero)}
                <h1 class="nflx-banner-title">${escapeHtml(_hero.titulo)}</h1>
                <p class="nflx-banner-synopsis">${escapeHtml(_hero.descricao || _hero.sinopse || '')}</p>
                <div class="nflx-banner-buttons">
                    <button type="button" class="nflx-btn nflx-btn-play" onclick="window.nflxPlay('${_hero.id}')"><i class="bi bi-play-fill"></i>${labelFonte(_hero)}</button>
                    <button type="button" class="nflx-btn nflx-btn-info" onclick="window.nflxOpenInfo('${_hero.id}')"><i class="bi bi-info-circle"></i>Mais informações</button>
                </div>
            </div>
        </div>`;
    }

    function renderNav(filledClass) {
        const user = window.getSavedUser ? window.getSavedUser() : {};
        // O campo user.avatar é salvo como string JSON (ex.: ["fotoPerfil","banner"]),
        // então precisa ser desempacotado (como já é feito no restante do app) antes
        // de virar a src de uma <img>; usar o valor bruto aqui é o que fazia o menu
        // sempre cair no ícone genérico de pessoa.
        const avatarUrl = window.splitAvatarField
            ? window.splitAvatarField(user?.avatar).avatar
            : (window.safeParseImages ? window.safeParseImages(user?.avatar)[0] : '');
        const avatarNormalizado = window.normalizeImageUrl ? window.normalizeImageUrl(avatarUrl) : avatarUrl;
        const avatar = avatarNormalizado || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.nome || 'U')}&background=e50914&color=fff&size=64`;
        return `
        <header class="nflx-nav${filledClass}" id="nflxNav">
            <div class="nflx-nav-left">
                <button type="button" class="nflx-back" onclick="window.filmesVoltar()" title="Voltar às conversas"><i class="bi bi-arrow-left"></i></button>
                <span class="nflx-brand">Mídias</span>
                <span class="nflx-nav-options">
                    <span class="nflx-nav-item active" onclick="window.nflxRecarregar()">Início</span>
                    <span class="nflx-nav-item" onclick="window.nflxBuscarCategoria('video')">Vídeos</span>
                    <span class="nflx-nav-item" onclick="window.nflxBuscarCategoria('jogo')">Jogos</span>
                    <span class="nflx-nav-item" onclick="window.nflxBuscarGeek()">Geek</span>
                    <span class="nflx-nav-item" onclick="window.nflxBuscarMusicas()">Música</span>
                    <span class="nflx-nav-item" onclick="window.nflxBuscarCategoria('openlibrary')">Livros</span>
                </span>
            </div>
            <div class="nflx-nav-right">
                <div class="nflx-search" id="nflxSearch">
                    <i class="bi bi-search" onclick="window.nflxFocarBusca()"></i>
                    <input id="nflxSearchInput" type="text" placeholder="Títulos, jogos, rádios..." autocomplete="off"
                        oninput="window.nflxBuscar(this.value)"
                        onfocus="window.nflxExpandirBusca()"
                        onblur="window.nflxRecolherBusca()">
                    <button type="button" class="nflx-search-clear" id="nflxSearchClear" onclick="window.nflxLimparBusca()" title="Limpar busca"><i class="bi bi-x-lg"></i></button>
                </div>
                <div class="nflx-profile" id="nflxProfile">
                    <button type="button" class="nflx-avatar-btn" onclick="window.nflxToggleMenu()" title="Opções">
                        <span class="nflx-avatar-wrap">
                            <img class="nflx-avatar" src="${escapeHtml(avatar)}" alt="Você" referrerpolicy="no-referrer" onerror="this.onerror=null;this.style.display='none';this.parentNode.querySelector('.nflx-avatar-fallback')?.classList.remove('d-none')">
                            <i class="bi bi-person-fill nflx-avatar-fallback d-none" aria-hidden="true"></i>
                        </span>
                        <i class="bi bi-caret-down-fill"></i>
                    </button>
                    <div class="nflx-menu" id="nflxMenu">
                        <button type="button" class="nflx-menu-item" onclick="window.nflxCloseMenu(); window.showProfileEdit?.()"><i class="bi bi-person-gear"></i><span>Editar meu perfil</span></button>
                        <button type="button" class="nflx-menu-item" onclick="window.nflxCloseMenu(); window.filmesVoltar()"><i class="bi bi-chat-left-text"></i><span>Acessar conversas</span></button>
                        <button type="button" class="nflx-menu-item" onclick="window.nflxCloseMenu(); window.openCommunityInChat?.()"><i class="bi bi-threads"></i><span>Comunidade</span></button>
                        <button type="button" class="nflx-menu-item" onclick="window.nflxCloseMenu(); window.toggleTema?.()"><i class="bi bi-moon-stars"></i><span>Alterar tema</span></button>
                    </div>
                </div>
            </div>
        </header>`;
    }

    // ---------------------------------------------------------------
    // CARREGAMENTO DAS SEÇÕES
    // ---------------------------------------------------------------
    async function carregarSecoes() {
        const root = document.getElementById('nflxRoot');
        if (!root) return;

        if (root.dataset.loadingSecoes === '1') return;
        root.dataset.loadingSecoes = '1';

        ITEMS_CACHE.clear();
        // Remove o pool antigo (versão anterior) para eliminar itens de
        // fontes removidas que ficavam na seção de Jogos.
        try { localStorage.removeItem('electroFilmesPool'); } catch {}
        const poolSalvo = obterPoolSalvo();
        if (poolSalvo.length) {
            cacheItems(poolSalvo);
            preencherSecoesDinamicas();
        }

        const aplicaResultado = () => {
            preencherSecoesDinamicas();
            salvarPool();
            atualizarStatusFontes();
            renderBanner();
        };

        const secoes = getSecoesAtivas();
        const sectionPromises = secoes.map(async (section) => {
            let ok = false;
            try {
                const res = await comTimeout(section.filter(), 15000);
                if (res.ok && res.itens.length > 0) {
                    cacheItems(res.itens);
                    _fontesIndisponiveis.delete(section.heading);
                    ok = true;
                } else if (!res.ok) {
                    _fontesIndisponiveis.add(section.heading);
                }
            } catch (error) {
                console.warn(`Erro ao carregar seção ${section.heading}:`, error);
                _fontesIndisponiveis.add(section.heading);
            }

            _intro.concluido = Math.min(_intro.total || secoes.length, _intro.concluido + 1);
            atualizarIntro();
            aplicaResultado();

            return ok;
        });

        await Promise.allSettled(sectionPromises);
        aplicaResultado();
    }

    // ---------------------------------------------------------------
    // PREENCHIMENTO DAS SEÇÕES DINÂMICAS
    //   Em Alta (mais acessados), Recentes, Recomendados e categorias
    //   (Vídeos, Jogos, Rádios) — sem repetir itens entre elas.
    // ---------------------------------------------------------------
    function preencherSecoesDinamicas() {
        const acessos = getAcessos();
        const pool = deduplicar([...ITEMS_CACHE.values()]).map(item => {
            if (acessos[item.id]) return { ...item, acessos: Number(acessos[item.id]) || 0 };
            return item;
        });
        const usados = new Set();

        const poolPorCategoria = (categoria) =>
            pool.filter(item => item?.categoria === categoria);
        const poolPorFonte = (fonte) =>
            pool.filter(item => item?.fonte === fonte);

        function reservar(itens, limite) {
            const livres = [];
            for (const item of itens) {
                if (usados.has(item.id)) continue;
                livres.push(item);
                usados.add(item.id);
                if (livres.length >= limite) break;
            }
            return livres;
        }

        SECOES_DINAMICAS.forEach((sec) => {
            const container = document.getElementById(`section-${sec.id}`);
            if (!container) return;

            let itens = [];
            if (sec.tipo === 'views') itens = reservar(ordenarPor('views', poolPorCategoria('video')), sec.limite);
            else if (sec.tipo === 'recencia') itens = reservar(ordenarPor('recencia', pool), sec.limite);
            else if (sec.tipo === 'relevancia') itens = reservar(ordenarPor('relevancia', pool), sec.limite);
            else if (sec.tipo === 'categoria') {
                const candidatos = sec.fonte ? poolPorFonte(sec.fonte) : poolPorCategoria(sec.categoria);
                itens = reservar(ordenarPor('relevancia', candidatos), sec.limite);
            }

            if (!itens.length) {
                const videos = poolPorCategoria('video').length;
                const fonteFora = sec.fonte && _fontesIndisponiveis.has(sec.fonte);
                const mensagem = (videos === 0 && sec.tipo === 'views') || fonteFora
                    ? 'Serviço temporariamente indisponível.'
                    : 'Nenhum resultado encontrado.';
                container.innerHTML = `<div class="yt-empty">${mensagem}</div>`;
                return;
            }

            if (sec.feature) {
                const ranking = itens.map((item, i) => ({ ...item, _rank: i + 1 }));
                container.innerHTML = ranking.map(item => renderFeatureCard(item)).join('');
                if (!_hero) _hero = ranking[0];
            } else {
                container.innerHTML = itens.map(item => renderCard(item)).join('');
                if (!_hero) _hero = itens[0];
            }
        });
    }

    function setupCarousels() {
        document.querySelectorAll('.nflx-row-wrap').forEach(wrap => {
            const row = wrap.querySelector('.nflx-card-row');
            const left = wrap.querySelector('.nflx-arrow-left');
            const right = wrap.querySelector('.nflx-arrow-right');
            if (!row || !left || !right) return;
            if (row.dataset.carouselReady) { const u = row._nflxUpdate; if (u) { u(); setTimeout(u, 300); } return; }
            row.dataset.carouselReady = '1';

            const update = () => {
                const max = row.scrollWidth - row.clientWidth - 4;
                left.classList.toggle('nflx-arrow-hidden', row.scrollLeft <= 4);
                right.classList.toggle('nflx-arrow-hidden', row.scrollLeft >= max || max <= 0);
            };
            row._nflxUpdate = update;
            row.addEventListener('scroll', update, { passive: true });
            update();
            setTimeout(update, 600);
            window.addEventListener('resize', update);
        });
    }

    window.nflxScrollRow = function(rowId, dir) {
        const row = document.getElementById(rowId);
        if (!row) return;
        const amount = Math.round(row.clientWidth * 0.85) * dir;
        row.scrollBy({ left: amount, behavior: 'smooth' });
    };

    // ---------------------------------------------------------------
    // RENDERIZAÇÃO PRINCIPAL
    // ---------------------------------------------------------------
    function renderRoot() {
        const panel = document.getElementById('waChatActive');
        if (!panel) return;

        const user = window.getSavedUser ? window.getSavedUser() : {};
        const avatarUrl = window.splitAvatarField
            ? window.splitAvatarField(user?.avatar).avatar
            : (window.safeParseImages ? window.safeParseImages(user?.avatar)[0] : '');
        const avatarNormalizado = window.normalizeImageUrl ? window.normalizeImageUrl(avatarUrl) : avatarUrl;
        const avatar = avatarNormalizado || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.nome || 'U')}&background=e50914&color=fff&size=64`;

        panel.classList.remove('d-none');
        panel.classList.add('d-flex', 'filmes-active');
        panel.innerHTML = `
        <div class="yt-root" id="nflxRoot">
            <header class="yt-header" id="ytMainHeader">
                <div class="yt-header-left">
                    <button type="button" class="yt-menu-btn d-none d-lg-flex" onclick="window.toggleSidebar?.()" title="Menu">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3 18H21V16H3V18ZM3 13H21V11H3V13ZM3 6V8H21V6H3Z" fill="currentColor"/>
                        </svg>
                    </button>
                    <div class="yt-logo">
                        <svg class="yt-logo-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                            <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        <span>Mídias</span>
                    </div>
                </div>
                <nav class="yt-header-nav d-none d-lg-flex" aria-label="Categorias">
                    ${CATEGORIAS_NAV.map(c => `<a class="yt-header-nav-item" onclick="${c.acao}">${c.label}</a>`).join('')}
                </nav>
                <div class="yt-header-center">
                    <div class="yt-search-wrap">
                        <div class="yt-search" id="nflxSearch">
                            <input id="nflxSearchInput" type="text" placeholder="Pesquisar" autocomplete="off"
                                oninput="window.nflxBuscar(this.value)"
                                onfocus="window.nflxExpandirBusca()"
                                onblur="window.nflxRecolherBusca()">
                            <button type="button" class="yt-search-btn" onclick="window.nflxFocarBusca()"><i class="bi bi-search"></i></button>
                            <button type="button" class="nflx-search-clear" id="nflxSearchClear" onclick="window.nflxLimparBusca()" title="Limpar busca"><i class="bi bi-x-lg"></i></button>
                        </div>
                        <button type="button" class="yt-mic-btn" onclick="window.nflxBuscaVoz()" title="Pesquisar por voz">
                            <i class="bi bi-mic"></i>
                        </button>
                    </div>
                </div>
                <div class="yt-header-right">
                    <button type="button" class="yt-icon-btn d-lg-none" title="Pesquisar" onclick="window.nflxAbrirBuscaMobile?.()">
                        <i class="bi bi-search"></i>
                    </button>
                    <button type="button" class="yt-icon-btn yt-notif-btn d-none d-lg-flex" title="Notificações" onclick="event.preventDefault(); window.showNotifications?.()">
                        <i class="bi bi-bell"></i>
                        <span class="yt-notif-badge">3</span>
                    </button>
                    <div class="nflx-profile" id="nflxProfile">
                        <button type="button" class="yt-avatar" onclick="window.nflxToggleMenu()" title="Opções">
                            <img src="${escapeHtml(avatar)}" alt="Você" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'">
                        </button>
                        <div class="nflx-menu" id="nflxMenu">
                            <button type="button" class="nflx-menu-item" onclick="window.nflxCloseMenu(); window.showProfileEdit?.()"><i class="bi bi-person-gear"></i><span>Editar meu perfil</span></button>
                            <button type="button" class="nflx-menu-item" onclick="window.nflxCloseMenu(); window.filmesVoltar()"><i class="bi bi-chat-left-text"></i><span>Acessar conversas</span></button>
                            <button type="button" class="nflx-menu-item" onclick="window.nflxCloseMenu(); window.openCommunityInChat?.()"><i class="bi bi-threads"></i><span>Comunidade</span></button>
                            <button type="button" class="nflx-menu-item" onclick="window.nflxCloseMenu(); window.toggleTema?.()"><i class="bi bi-moon-stars"></i><span>Alterar tema</span></button>
                            <hr class="yt-sidebar-hr" style="margin:8px 0">
                            <button type="button" class="nflx-menu-item" onclick="window.nflxCloseMenu(); window.filmesVoltar()"><i class="bi bi-box-arrow-right"></i><span>Sair do Mídias</span></button>
                        </div>
                    </div>
                </div>
            </header>
            <nav class="yt-chips d-lg-none" id="ytChipsNav" aria-label="Categorias">
                ${CATEGORIAS_NAV.map((c, i) => `
                    <button type="button" class="yt-chip${i === 0 ? ' active' : ''}" data-chip="${c.id}" onclick="window.nflxChipClick('${c.id}', this)">
                        <i class="bi ${c.icone}"></i><span>${c.label}</span>
                    </button>
                `).join('')}
            </nav>
            <header class="yt-header yt-mobile-search-header d-none" id="ytMobileSearchHeader">
                <div class="yt-mobile-search-bar">
                    <button type="button" class="yt-mobile-search-back" onclick="window.nflxFecharBuscaMobile?.()" title="Voltar">
                        <i class="bi bi-arrow-left"></i>
                    </button>
                    <input id="nflxMobileSearchInput" type="search" placeholder="Pesquisar" autocomplete="off" oninput="window.nflxBuscar(this.value)">
                    <button type="button" class="yt-mobile-search-action" id="mobileKeyboardToggle" title="Teclado">
                        <i class="bi bi-keyboard"></i>
                    </button>
                    <button type="button" class="yt-mobile-search-action" onclick="window.nflxBuscar(document.getElementById('nflxMobileSearchInput').value)" title="Buscar">
                        <i class="bi bi-search"></i>
                    </button>
                    <button type="button" class="yt-mobile-search-action" onclick="window.nflxBuscaVoz?.()" title="Pesquisar por voz">
                        <i class="bi bi-mic"></i>
                    </button>
                </div>
            </header>
            <div class="yt-body">
                <nav class="yt-sidebar">
                    <div class="yt-sidebar-label">Fontes</div>
                    <div id="ytSidebarFontes">
                        ${getFontesSidebarAtivas().map(f => `
                            <a class="yt-nav-item" onclick="window.nflxBuscarCategoria('${f.key}')">
                                <i class="bi ${f.icon} yt-fonte-icon" id="ytFonteIcon-${f.key}"></i>
                                <span>${f.label}</span>
                            </a>
                        `).join('')}
                    </div>
                    <a class="yt-nav-item" onclick="window.nflxGerenciarFontes()"><i class="bi bi-sliders"></i><span>Gerenciar fontes</span></a>
                    <hr class="yt-sidebar-hr">
                    <div class="yt-sidebar-label">Biblioteca</div>
                    <a class="yt-nav-item" onclick="window.mostrarHistorico()"><i class="bi bi-clock-history"></i><span>Histórico</span></a>
                    <a class="yt-nav-item" onclick="window.mostrarMinhaLista()"><i class="bi bi-bookmark-star"></i><span>Minha Lista</span></a>
                </nav>
                <div class="yt-main">
                    <main class="yt-content" id="nflxBrowseContent">
                        <div class="yt-banner" id="ytBanner"></div>
                        ${SECOES_DINAMICAS.map(renderSection).join('')}
                    </main>
                    <main class="yt-content d-none" id="nflxSearchContent"></main>
                </div>
            </div>
            <nav class="yt-bottom-nav d-lg-none" id="ytBottomNav" aria-label="Navegação inferior">
                <a class="yt-bottom-nav-item active" onclick="window.nflxRecarregar()" title="Início">
                    <i class="bi bi-house-door-fill"></i>
                    <span>Início</span>
                </a>
                <a class="yt-bottom-nav-item" onclick="window.nflxBuscarCategoria('video')" title="Em Alta">
                    <i class="bi bi-fire"></i>
                    <span>Em Alta</span>
                </a>
                <a class="yt-bottom-nav-item" onclick="window.nflxBuscarCategoria('jogo')" title="Jogos">
                    <i class="bi bi-controller"></i>
                    <span>Jogos</span>
                </a>
                <a class="yt-bottom-nav-item" onclick="window.nflxBuscarCategoria('geek')" title="Geek">
                    <i class="bi bi-stars"></i>
                    <span>Geek</span>
                </a>
                <a class="yt-bottom-nav-item" onclick="window.nflxGerenciarFontes?.()" title="Fontes">
                    <i class="bi bi-puzzle"></i>
                    <span>Fontes</span>
                </a>
            </nav>
        </div>`;

        carregarSecoes();
        atualizarStatusFontes();
        setupChipsScrollSpy();
    }

    // Clique num chip da barra mobile: navega pra categoria e já marca ele
    // como ativo na hora (sem esperar o scroll), pra dar feedback imediato.
    window.nflxChipClick = function(id, el) {
        document.querySelectorAll('.yt-chip').forEach(c => c.classList.remove('active'));
        if (el) el.classList.add('active');
        if (id === 'inicio') { window.nflxRecarregar(); return; }
        window.nflxBuscarCategoria(id);
    };

    // "Índices andando com a página": conforme o usuário rola o feed de
    // Mídias, a barra de chips acompanha e destaca a seção visível — igual
    // à barra de categorias do YouTube.
    let _chipsObserver = null;
    function setupChipsScrollSpy() {
        if (_chipsObserver) { _chipsObserver.disconnect(); _chipsObserver = null; }
        const content = document.getElementById('nflxBrowseContent');
        const chips = document.querySelectorAll('#ytChipsNav .yt-chip');
        if (!content || !chips.length) return;

        _chipsObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const id = entry.target.dataset.secaoId;
                if (!id) return;
                chips.forEach(c => c.classList.toggle('active', c.dataset.chip === id));
            });
        }, { root: content, rootMargin: '-45% 0px -50% 0px', threshold: 0 });

        content.querySelectorAll('.yt-section').forEach(sec => _chipsObserver.observe(sec));
    }

    window.toggleSidebar = function() {
        const sidebar = document.querySelector('.yt-sidebar');
        if (!sidebar) return;
        sidebar.classList.toggle('collapsed');
    };

    window.mostrarHistorico = function() {
        const historico = getHistorico();
        const browse = document.getElementById('nflxBrowseContent');
        const search = document.getElementById('nflxSearchContent');
        if (!browse || !search) return;

        search.classList.remove('d-none');
        browse.classList.add('d-none');

        if (!historico.length) {
            search.innerHTML = `<div class="yt-empty"><i class="bi bi-clock-history"></i> Nenhum histórico ainda.</div>`;
            return;
        }

        const itens = historico
            .map(h => ITEMS_CACHE.get(h.id))
            .filter(Boolean);

        search.innerHTML = `
            <section class="yt-section">
                <h2 class="yt-section-title"><i class="bi bi-clock-history"></i> Histórico</h2>
                <div class="yt-video-grid">
                    ${itens.map(item => renderCard(item)).join('')}
                </div>
            </section>
        `;
    };

    window.mostrarMinhaLista = function() {
        const lista = getLista();
        const browse = document.getElementById('nflxBrowseContent');
        const search = document.getElementById('nflxSearchContent');
        if (!browse || !search) return;

        search.classList.remove('d-none');
        browse.classList.add('d-none');

        if (!lista.length) {
            search.innerHTML = `<div class="yt-empty"><i class="bi bi-bookmark-star"></i> Sua lista está vazia.</div>`;
            return;
        }

        const itens = lista
            .map(id => ITEMS_CACHE.get(id))
            .filter(Boolean);

        search.innerHTML = `
            <section class="yt-section">
                <h2 class="yt-section-title"><i class="bi bi-bookmark-star"></i> Minha Lista</h2>
                <div class="yt-video-grid">
                    ${itens.map(item => renderCard(item)).join('')}
                </div>
            </section>
        `;
    };

    // ---------------------------------------------------------------
    // GERENCIAMENTO DE FONTES ATIVAS
    // ---------------------------------------------------------------
    window.renderSidebarFontes = function() {
        const container = document.getElementById('ytSidebarFontes');
        if (!container) return;
        container.innerHTML = getFontesSidebarAtivas().map(f => `
            <a class="yt-nav-item" onclick="window.nflxBuscarCategoria('${f.key}')">
                <i class="bi ${f.icon} yt-fonte-icon" id="ytFonteIcon-${f.key}"></i>
                <span>${f.label}</span>
            </a>
        `).join('');
        atualizarStatusFontes();
    };

    window.nflxGerenciarFontes = function() {
        const lista = FONTES_SIDEBAR.map(f => {
            const ativa = isFonteAtiva(f.key);
            return `
                <div class="yt-fonte-item">
                    <div class="yt-fonte-info">
                        <i class="bi ${f.icon} yt-fonte-icon" id="ytFonteIconModal-${f.key}"></i>
                        <div>
                            <div class="yt-fonte-label">${escapeHtml(f.label)}</div>
                            <div class="yt-fonte-heading">${escapeHtml(f.heading)}</div>
                        </div>
                    </div>
                    <label class="yt-switch" title="${ativa ? 'Ativa' : 'Desativada'}">
                        <input type="checkbox" data-fonte="${f.key}" ${ativa ? 'checked' : ''} onchange="window.nflxToggleFonte('${f.key}', this.checked)">
                        <span class="yt-switch-slider"></span>
                    </label>
                </div>`;
        }).join('');

        const countAtivas = FONTES_SIDEBAR.filter(f => isFonteAtiva(f.key)).length;

        let wrap = document.getElementById('nflxFontesModal');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'nflxFontesModal';
            wrap.className = 'nflx-modal-wrap';
            document.body.appendChild(wrap);
        }
        wrap.innerHTML = `
            <div class="nflx-modal-backdrop" onclick="window.nflxFecharFontes()"></div>
            <div class="modal-content border-0 shadow-lg" style="width:min(90vw,460px);border-radius:16px;max-height:86vh;overflow:hidden;">
                <div class="modal-header border-0 pb-0 justify-content-center position-relative">
                    <div class="text-center">
                        <h5 class="modal-title fw-bold" style="font-size:1.1rem;"><i class="bi bi-sliders me-2"></i>Gerenciar fontes</h5>
                        <p class="text-muted small mb-0">Somente as fontes ativas aparecem no menu e carregam no Mídias. <strong>${countAtivas} de ${FONTES_SIDEBAR.length}</strong> ativas.</p>
                    </div>
                    <button type="button" class="ml-auth-close" onclick="window.nflxFecharFontes()" aria-label="Fechar"><i class="bi bi-x-lg"></i></button>
                </div>
                <div class="modal-body pt-2" style="overflow-y:auto;">
                    <div class="create-ad-section">
                        <div class="create-ad-section-title"><i class="bi bi-sliders"></i><span>Fontes disponíveis</span></div>
                        <div class="create-ad-section-body" style="padding:10px;">
                            <div style="display:flex;flex-direction:column;gap:6px;">
                                ${lista}
                            </div>
                        </div>
                    </div>
                    <div class="d-flex gap-2 mt-3">
                        <button type="button" class="ml-btn ml-btn-primary flex-grow-1" onclick="window.nflxFecharFontes()"><i class="bi bi-check-lg me-2"></i>Concluir</button>
                    </div>
                </div>
            </div>`;
        wrap.classList.remove('d-none');
        atualizarStatusFontes();
    };

    window.nflxFecharFontes = function() {
        const wrap = document.getElementById('nflxFontesModal');
        if (wrap) wrap.classList.add('d-none');
    };

    window.nflxToggleFonte = function(key, on) {
        toggleFonteAtiva(key, on);
        window.renderSidebarFontes();
        // Recarrega as seções para refletir as fontes ativas na home
        const root = document.getElementById('nflxRoot');
        if (root) delete root.dataset.loadingSecoes;
        carregarSecoes();
        showToast(on
            ? '<i class="bi bi-check-circle"></i> Fonte ativada.'
            : '<i class="bi bi-slash-circle"></i> Fonte desativada.', on ? 'success' : 'info', 1500);
    };

    // ---------------------------------------------------------------
    // PLAYER DE ÁUDIO
    // ---------------------------------------------------------------
    function abrirPlayerAudio(f) {
        let bar = document.getElementById('nflxAudioBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'nflxAudioBar';
            bar.className = 'nflx-audio-bar';
            document.body.appendChild(bar);
        }
        bar.innerHTML = `
            <div class="nflx-audio-info">
                <span class="nflx-audio-emoji"><i class="bi bi-broadcast"></i></span>
                <div class="nflx-audio-text">
                    <strong>${escapeHtml(f.titulo)}</strong>
                    <span>${escapeHtml(f.descricao || 'Rádio ao vivo')}</span>
                </div>
            </div>
            <audio controls autoplay src="${encodeURI(f.link)}" style="height:36px;max-width:280px;"></audio>
            <button type="button" class="nflx-audio-close" onclick="document.getElementById('nflxAudioBar')?.remove()"><i class="bi bi-x-lg"></i></button>
        `;
    }

    // ---------------------------------------------------------------
    // MODAL DE DETALHES
    // ---------------------------------------------------------------
    function renderModal(f) {
        let modalWrap = document.getElementById('nflxModalWrap');
        if (!modalWrap) {
            modalWrap = document.createElement('div');
            modalWrap.id = 'nflxModalWrap';
            document.body.appendChild(modalWrap);
        }
        const imagem = f.capa || f.poster;
        modalWrap.className = 'nflx-modal-wrap';
        modalWrap.innerHTML = `
            <div class="nflx-modal-backdrop" onclick="window.nflxCloseInfo()"></div>
            <div class="nflx-modal">
                <div class="nflx-modal-art" style="${imagem ? `background-image:url('${imagem}');background-size:cover;background-position:center;` : `background:${art(f)}`}">
                    ${!imagem ? `<span class="nflx-art-emoji-hero">${f.emoji || '🎬'}</span>` : ''}
                </div>
                <div class="nflx-modal-mask"></div>
                <div class="nflx-modal-x" onclick="window.nflxCloseInfo()"><i class="bi bi-x-lg"></i></div>
                <div class="nflx-modal-details">
                    <h2 class="nflx-modal-title">${escapeHtml(f.titulo)}</h2>
                    <div class="nflx-row">
                        ${roundBtn(f, 'play')}<span class="nflx-round-label">${labelFonte(f)}</span>
                        ${roundBtn(f, 'add')}
                        ${roundBtn(f, 'like')}
                        ${roundBtn(f, 'dislike')}
                    </div>
                    <div class="nflx-green nflx-modal-match">${matchPct(f)}</div>
                </div>
                <div class="nflx-modal-body">
                    <div class="nflx-modal-col">${escapeHtml(f.descricao || f.sinopse || 'Sem descrição disponível.')}</div>
                    <div class="nflx-modal-col">
                        <span class="nflx-modal-genre-label">Categoria: ${escapeHtml(f.genero || f.categoria)}</span>
                        <span class="nflx-modal-meta">${f.ano ? `<i class="bi bi-calendar3"></i> ${escapeHtml(f.ano)}` : ''}</span>
                        <span class="nflx-modal-source"><i class="bi bi-globe2"></i> Fonte: ${escapeHtml(f.fonte)}</span>
                    </div>
                </div>
            </div>`;
        modalWrap.classList.remove('d-none');
        document.body.classList.add('wa-locked', 'wa-fullscreen');
    }

    // ---------------------------------------------------------------
    // AÇÕES PÚBLICAS
    // ---------------------------------------------------------------
    window.nflxPlay = function(id) {
        const f = ITEMS_CACHE.get(id);
        if (!f) { showToast('Item não encontrado.', 'warning'); return; }
        registrarAcesso(id);

        if (f.fonte === 'iTunes') {
            window.open(f.link, '_blank', 'noopener');
            showToast('<i class="bi bi-music-note-beamed"></i> Abrindo no iTunes / Apple Music', 'info', 2500);
            return;
        }

        if (f.categoria === 'audio') {
            abrirPlayerAudio(f);
            showToast(`<i class="bi bi-broadcast"></i> Tocando ${f.titulo}`, 'success', 2000);
            return;
        }
        if (f.categoria === 'jogo') {
            window.open(f.link, '_blank', 'noopener');
            showToast('<i class="bi bi-controller"></i> Abrindo página do jogo', 'info', 2500);
            return;
        }
        // Vídeos em geral
        window.open(f.link, '_blank', 'noopener');
        showToast(`<i class="bi bi-play-fill"></i> Abrindo ${f.titulo}`, 'info', 2500);
    };

    window.nflxReagir = function(type, id) {
        registrarAcesso(id);
        const label = type === 'like'
            ? '<i class="bi bi-hand-thumbs-up-fill"></i> Curtiu!'
            : '<i class="bi bi-hand-thumbs-down-fill"></i> Não curtiu.';
        showToast(label, 'info', 1500);
    };

    window.nflxToggleLista = function(id) {
        let lista = getLista();
        const on = lista.includes(id);
        lista = on ? lista.filter(x => x !== id) : [...lista, id];
        setLista(lista);
        document.querySelectorAll(`#nflxAddIcon_${id}`).forEach(icon => {
            icon.className = `bi ${on ? 'bi-plus' : 'bi-check-lg'}`;
        });
        showToast(on ? 'Removido da Minha Lista.' : 'Adicionado à Minha Lista!', on ? 'info' : 'success', 1500);
    };

    window.nflxOpenInfo = function(id) {
        const f = ITEMS_CACHE.get(id);
        if (!f) { showToast('Detalhes indisponíveis para este item.', 'warning'); return; }
        registrarAcesso(id);
        renderModal(f);
    };

    window.nflxCloseInfo = function() {
        const wrap = document.getElementById('nflxModalWrap');
        if (wrap) wrap.classList.add('d-none');
        const waView = document.getElementById('whatsappOrdersView');
        if (!waView || waView.classList.contains('d-none')) {
            document.body.classList.remove('wa-locked', 'wa-fullscreen');
        }
    };

    window.nflxToggleMenu = function() {
        const menu = document.getElementById('nflxMenu');
        if (!menu) return;
        menu.classList.toggle('open');
    };

    window.nflxCloseMenu = function() {
        document.getElementById('nflxMenu')?.classList.remove('open');
    };

    // ---------------------------------------------------------------
    // BUSCA — pesquisa de verdade nas fontes (Invidious, Piped,
    // Odysee, GamerPower, Jogos Retrô, Rádios), com debounce
    // ---------------------------------------------------------------
    const FONTES_BUSCA = [
        { key: 'invidious', icone: ICONES_FONTE['Invidious (YouTube)'], heading: 'Vídeos (Invidious)', busca: (q) => carregarFonte(buscarInvidious, q, 12) },
        { key: 'piped', icone: ICONES_FONTE['Piped (YouTube)'], heading: 'Vídeos (Piped)', busca: (q) => carregarFonte(buscarPiped, q, 12) },
        { key: 'odysee', icone: ICONES_FONTE['Odysee'], heading: 'Vídeos (Odysee)', busca: (q) => carregarFonte(buscarOdysee, q, 12) },
        { key: 'animes', icone: ICONES_FONTE['MyAnimeList'], heading: 'Animes', busca: (q) => carregarFonte(buscarAnimes, q, 12) },
        { key: 'gamerpower', icone: ICONES_FONTE['GamerPower'], heading: 'Jogos Grátis (GamerPower)', busca: (q) => carregarFonte(buscarGamerPower, q, 12) },
        { key: 'internetarchive', icone: ICONES_FONTE['Internet Archive'], heading: 'Jogos Retrô (Internet Archive)', busca: (q) => carregarFonte(buscarJogosRetro, q, 12) },
        { key: 'epic_oficial', icone: ICONES_FONTE['Epic Games (Oficial)'], heading: 'Epic Games (Oficial)', busca: (q) => carregarFonte(buscarEpic_Oficial, q, 12) }
    ];

    let _buscaTimer = null;
    let _buscaAtual = 0; // token para ignorar respostas de buscas antigas/já substituídas

    // ---------------------------------------------------------------
    // BUSCA LOCAL (dados reais já carregados em ITEMS_CACHE)
    //   Compara título, descrição, sinopse, gênero, categoria, fonte e
    //   plataforma ignorando caixa alta/baixa e acentuação.
    // ---------------------------------------------------------------
    function normalizarTexto(s) {
        return String(s || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function buscarNoCache(termo) {
        const tokens = normalizarTexto(termo).split(/\s+/).filter(Boolean);
        if (!tokens.length) return [];

        // Busca no cache da visita + no pool salvo (conteúdo que já aparece
        // no Início). Assim, mesmo com as APIs caindo, o que já foi carregado
        // continua respondendo à busca.
        const todos = new Map();
        [...ITEMS_CACHE.values(), ...obterPoolSalvo()].forEach(it => {
            if (it?.id) todos.set(it.id, it);
        });

        return [...todos.values()]
            .map(item => {
                const alvo = normalizarTexto(
                    `${item.titulo || ''} ${item.descricao || ''} ${item.sinopse || ''} ${item.genero || ''} ${item.categoria || ''} ${item.fonte || ''} ${item.plataforma || ''}`
                );
                const pontos = tokens.reduce((acc, t) => acc + (alvo.includes(t) ? 1 : 0), 0);
                return { item, pontos };
            })
            .filter(x => x.pontos > 0)
            .sort((a, b) => b.pontos - a.pontos || scoreRelevancia(b.item) - scoreRelevancia(a.item))
            .slice(0, 12)
            .map(x => x.item);
    }

    // Quando uma fonte cai durante a busca, tenta reaproveitar o conteúdo
    // já salvo dela (pool/cache) em vez de devolver a seção vazia.
    function buscarNoCachePorFonte(termo, fonte) {
        const f = FONTES_SIDEBAR.find(x => x.heading === fonte || x.label === fonte);
        const alvos = f ? [f.label, f.heading] : [fonte];
        const tokens = normalizarTexto(termo).split(/\s+/).filter(Boolean);
        const todos = new Map();
        [...ITEMS_CACHE.values(), ...obterPoolSalvo()].forEach(it => {
            if (it?.id) todos.set(it.id, it);
        });
        return [...todos.values()]
            .filter(item => alvos.includes(item.fonte) && (!tokens.length || tokens.every(t => normalizarTexto(item.titulo).includes(t))))
            .slice(0, 24);
    }

    // Conteúdo já salvo de uma categoria (ex.: animes) para usar como
    // reserva quando a fonte original cair.
    function buscarNoCachePorCategoria(termo, categoria, limite = 24) {
        const tokens = normalizarTexto(termo).split(/\s+/).filter(Boolean);
        const todos = new Map();
        [...ITEMS_CACHE.values(), ...obterPoolSalvo()].forEach(it => {
            if (it?.id) todos.set(it.id, it);
        });
        return [...todos.values()]
            .filter(item => item.categoria === categoria && (!tokens.length || tokens.every(t => normalizarTexto(item.titulo).includes(t))))
            .slice(0, limite);
    }

    // Garante que nenhuma fonte segure a busca inteira: cada fonte tem um
    // prazo próprio; se estourar, é tratada como indisponível no momento.
    function comTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise(resolve => setTimeout(() => resolve({ ok: false, itens: [], timeout: true }), ms))
        ]);
    }

    function renderSecaoBusca(i, heading, icone, itens) {
        return `
        <section class="yt-section" data-section="${escapeHtml(heading)}">
            <h2 class="yt-section-title">${icone || ''} ${escapeHtml(heading)}</h2>
            <div class="yt-video-grid">
                ${itens.map(item => renderCard(item)).join('')}
            </div>
        </section>`;
    }

    window.nflxFocarBusca = function() {
        if (window.innerWidth <= 991) {
            window.nflxAbrirBuscaMobile?.();
            return;
        }
        document.getElementById('nflxSearchInput')?.focus();
    };

    window.nflxExpandirBusca = function() {
        if (window.innerWidth <= 991) {
            window.nflxAbrirBuscaMobile?.();
            return;
        }
        document.getElementById('nflxSearch')?.classList.add('expanded');
    };

    window.nflxRecolherBusca = function() {
        const input = document.getElementById('nflxSearchInput');
        if (window.innerWidth <= 991) {
            window.nflxFecharBuscaMobile?.();
            return;
        }
        if (input && !input.value.trim()) {
            document.getElementById('nflxSearch')?.classList.remove('expanded');
        }
    };

    window.nflxLimparBusca = function() {
        const mainInput = document.getElementById('nflxSearchInput');
        const mobileInput = document.getElementById('nflxMobileSearchInput');
        if (mainInput) mainInput.value = '';
        if (mobileInput) mobileInput.value = '';
        document.getElementById('nflxSearch')?.classList.remove('expanded');
        window.nflxBuscar('');
        mainInput?.blur();
        mobileInput?.blur();
        window.nflxFecharBuscaMobile?.();
    };

    window.nflxAbrirBuscaMobile = function() {
        const mainHeader = document.getElementById('ytMainHeader');
        const mobileHeader = document.getElementById('ytMobileSearchHeader');
        const input = document.getElementById('nflxMobileSearchInput');
        if (!mainHeader || !mobileHeader || !input) return;
        mainHeader.classList.add('d-none');
        mobileHeader.classList.remove('d-none');
        setTimeout(() => input.focus(), 50);
    };

    window.nflxFecharBuscaMobile = function() {
        const mainHeader = document.getElementById('ytMainHeader');
        const mobileHeader = document.getElementById('ytMobileSearchHeader');
        const input = document.getElementById('nflxMobileSearchInput');
        if (!mainHeader || !mobileHeader || !input) return;
        mobileHeader.classList.add('d-none');
        mainHeader.classList.remove('d-none');
        input.value = '';
        window.nflxBuscar('');
        input.blur();
    };

    window.nflxBuscaVoz = function() {
        const input = window.innerWidth <= 991
            ? document.getElementById('nflxMobileSearchInput')
            : document.getElementById('nflxSearchInput');
        if (!input) return;

        if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
            showToast('A busca por voz não é suportada neste navegador.', 'warning');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.lang = 'pt-BR';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = function() {
            showToast('🎤 Ouvindo... fale agora', 'info', 2000);
        };

        recognition.onresult = function(event) {
            const transcript = event.results[0][0].transcript;
            input.value = transcript;
            window.nflxBuscar(transcript);
            showToast(`Pesquisando por: "${transcript}"`, 'success', 2500);
        };

        recognition.onerror = function(event) {
            showToast('Erro no reconhecimento de voz. Tente novamente.', 'warning');
        };

        recognition.start();
    };

    window.nflxBuscar = function(q) {
        q = (q || '').trim();
        const clearBtn = document.getElementById('nflxSearchClear');
        if (clearBtn) clearBtn.classList.toggle('show', q.length > 0);

        clearTimeout(_buscaTimer);

        if (!q) {
            // Sem termo: volta para a navegação normal (sem refazer requisições)
            document.getElementById('nflxSearchContent')?.classList.add('d-none');
            document.getElementById('nflxBrowseContent')?.classList.remove('d-none');
            return;
        }

        // Aguarda o usuário parar de digitar antes de disparar as buscas
        _buscaTimer = setTimeout(() => executarBuscaGlobal(q), 450);
    };

    async function executarBuscaGlobal(termo) {
        const meuToken = ++_buscaAtual;
        const browse = document.getElementById('nflxBrowseContent');
        const results = document.getElementById('nflxSearchContent');
        if (!browse || !results) return;

        browse.classList.add('d-none');
        results.classList.remove('d-none');

        // 1) Busca local imediata: dados reais já carregados nas seções.
        //    Se houver correspondência, exibe na hora (sem depender das fontes).
        const locais = buscarNoCache(termo);

        // 2) Estado "Buscando por..." aparece apenas enquanto há processamento.
        results.innerHTML = `<div class="yt-loading"><i class="bi bi-hourglass-split"></i> Buscando por "<strong>${escapeHtml(termo)}</strong>"...</div>`;

        // 3) Fontes externas, cada uma com prazo máximo próprio — nenhuma
        //    fonte lenta segura a tela inteira (era a causa do travamento).
        const fontesBusca = FONTES_BUSCA.filter(f => isFonteAtiva(f.key));
        const resultados = await Promise.all(
            fontesBusca.map(fonte =>
                comTimeout(
                    fonte.busca(termo).catch(err => {
                        console.warn(`Busca em ${fonte.heading} falhou:`, err);
                        return { ok: false, itens: [] };
                    }),
                    15000
                ).then(res => ({ fonte, res }))
            )
        );

        if (meuToken !== _buscaAtual) return; // uma busca mais nova já assumiu a tela

        const comResultado = resultados
            .map(r => {
                if (r.res.ok && r.res.itens.length > 0) return r;
                const reserva = buscarNoCachePorFonte(termo, r.fonte.heading);
                return reserva.length ? { ...r, res: { ok: true, itens: reserva } } : r;
            })
            .filter(r => r.res.ok && r.res.itens.length > 0);

        const indisponiveis = resultados.filter(r => !r.res.ok).map(r => r.fonte.heading);

        // Busca local sempre tem prioridade visual (resultados relevantes na hora)
        const jaVistos = new Set();
        const secoesLocais = locais.length
            ? [{
                heading: 'Encontrados no Mídias',
                icone: '<i class="bi bi-collection-play"></i>',
                res: { itens: locais }
            }]
            : [];
        locais.forEach(item => jaVistos.add(item.id));

        const secoesFontes = comResultado
            .map(sec => {
                const naoRepetidos = sec.res.itens.filter(item => !jaVistos.has(item.id));
                naoRepetidos.forEach(item => jaVistos.add(item.id));
                return naoRepetidos.length ? { heading: sec.fonte.heading, icone: sec.fonte.icone, res: { itens: naoRepetidos } } : null;
            })
            .filter(Boolean);

        const secoes = [...secoesLocais, ...secoesFontes].filter(sec => sec.res.itens.length > 0);

        // Deduplicação adicional entre fontes (mesmo título em fontes diferentes)
        const vistosFinal = new Set();
        secoes.forEach(sec => {
            sec.res.itens = sec.res.itens.filter(item => {
                const k = (item.titulo + (item.fonte || '')).toLowerCase().replace(/\s/g, '');
                if (vistosFinal.has(k)) return false;
                vistosFinal.add(k);
                return true;
            });
        });

        comResultado.forEach(({ res }) => cacheItems(res.itens));
        locais.forEach(item => cacheItems([item]));

        const totalItens = secoes.reduce((acc, s) => acc + s.res.itens.length, 0);

        if (totalItens === 0) {
            // Nada encontrado em lugar nenhum: mensagem adequada por estado.
            const todasIndisponiveis = indisponiveis.length === resultados.length && resultados.length > 0;
            results.innerHTML = `
                <div class="yt-loading">
                    ${todasIndisponiveis
                        ? `<i class="bi bi-wifi-off"></i> Serviço temporariamente indisponível: ${indisponiveis.join(', ')}.`
                        : `<i class="bi bi-emoji-frown"></i> Nenhum conteúdo encontrado para "<strong>${escapeHtml(termo)}</strong>".`}
                </div>`;
            return;
        }

        // 4) Resultados consolidados (fontes + dados locais reais)
        results.innerHTML = `
            <div class="yt-loading"><i class="bi bi-search"></i> Resultados para "<strong>${escapeHtml(termo)}</strong>" (${totalItens})</div>
            ${secoes.map((sec, idx) => renderSecaoBusca(idx, sec.heading, sec.icone, sec.res.itens)).join('')}
            ${indisponiveis.length ? `
                <section class="yt-section">
                    <h2 class="yt-section-title"><i class="bi bi-exclamation-triangle"></i> Fontes indisponíveis</h2>
                    <div class="yt-empty">Serviço temporariamente indisponível: ${indisponiveis.join(', ')}</div>
                </section>` : ''}
        `;

        setupCarousels();
    }

    // Mapa de fontes com carregamento direto (sem depender da busca por texto).
    const FONTES_DIRETAS = {
        invidious: { heading: 'Vídeos (Invidious)', carregar: () => buscarInvidious('', 24) },
        piped: { heading: 'Vídeos (Piped)', carregar: () => buscarPiped('', 24) },
        odysee: { heading: 'Vídeos (Odysee)', carregar: () => buscarOdysee('', 24) },
        animes: { heading: 'Animes', carregar: () => buscarAnimes('', 24) },
        gamerpower: { heading: 'Jogos Grátis (GamerPower)', carregar: () => buscarGamerPower('', 24) },
        internetarchive: { heading: 'Jogos Retrô (Internet Archive)', carregar: () => buscarJogosRetro('', 24) },
        itunes: { heading: 'Mídias (Música)', carregar: () => buscarItunes('', 24) },
        radiobrowser: { heading: 'Mídias (Rádios)', carregar: () => buscarRadios('', 24) },
        wikipedia: { heading: 'Mídias (Wikipedia)', carregar: () => buscarWikipedia('', 24) },
        tvmaze: { heading: 'Séries (TV Maze)', carregar: () => buscarTVMaze('', 24) },
        openlibrary: { heading: 'Mídias (Livros)', carregar: () => buscarOpenLibrary('', 24) },
        mangadex: { heading: 'Mangás (MangaDex)', carregar: () => buscarMangaDex('', 24) },
        epic_oficial: { heading: 'Epic Games (Oficial)', carregar: () => buscarEpic_Oficial('', 24) }
    };

    window.nflxBuscarCategoria = async function(categoria) {
        window.nflxLimparBusca();
        const sectionMap = { video: 'video', jogo: 'jogo', geek: 'geek', audio: 'audio', livro: 'livro' };
        const sourceMap = {
            invidious: 'Vídeos (Invidious)',
            piped: 'Vídeos (Piped)',
            odysee: 'Vídeos (Odysee)',
            gamerpower: 'Jogos Grátis (GamerPower)',
            internetarchive: 'Jogos Retrô (Internet Archive)',
            radiobrowser: 'Mídias (Rádios)',
            itunes: 'Mídias (Música)',
            wikipedia: 'Mídias (Wikipedia)',
            tvmaze: 'Séries (TV Maze)',
            openlibrary: 'Mídias (Livros)',
            mangadex: 'Mangás (MangaDex)',
            epic_oficial: 'Epic Games (Oficial)'
        };
        const sourceName = sourceMap[categoria];

        if (sectionMap[categoria]) {
            const sections = document.querySelectorAll('#nflxBrowseContent .yt-section');
            const alvo = sectionMap[categoria];
            for (const sec of sections) {
                if (sec.dataset.secaoId === alvo) { sec.scrollIntoView({ behavior: 'smooth' }); break; }
            }
            return;
        }

        const fonte = FONTES_DIRETAS[categoria];
        if (fonte) {
            if (!isFonteAtiva(categoria)) {
                showToast('Esta fonte está desativada. Ative-a em "Gerenciar fontes".', 'warning');
                return;
            }
            const browse = document.getElementById('nflxBrowseContent');
            const results = document.getElementById('nflxSearchContent');
            if (!browse || !results) return;
            browse.classList.add('d-none');
            results.classList.remove('d-none');
            results.innerHTML = `<div class="yt-loading"><i class="bi bi-hourglass-split"></i> Carregando "<strong>${escapeHtml(fonte.heading)}</strong>"...</div>`;
            const res = await comTimeout(fonte.carregar().then(itens => ({ ok: true, itens })).catch(() => ({ ok: false, itens: [] })), 15000);
            if (res.ok && res.itens.length) {
                cacheItems(res.itens);
                results.innerHTML = renderSecaoBusca(0, fonte.heading, ICONES_FONTE[fonte.heading] || ICONES_FONTE[sourceName] || '', res.itens);
            } else {
                const reserva = buscarNoCachePorFonte('', fonte.heading);
                if (reserva.length) {
                    cacheItems(reserva);
                    results.innerHTML = renderSecaoBusca(0, fonte.heading, ICONES_FONTE[fonte.heading] || ICONES_FONTE[sourceName] || '', reserva);
                } else {
                    results.innerHTML = `<div class="yt-loading"><i class="bi bi-wifi-off"></i> Serviço temporariamente indisponível — tente novamente em instantes.</div>`;
                }
            }
            setupCarousels();
            return;
        }

        if (sourceName) {
            document.getElementById('nflxSearchInput').value = sourceName;
            executarBuscaGlobal(sourceName);
        }
    };

    // Navegação "Geek": junta Animes + Mangás em uma única tela.
    window.nflxBuscarGeek = async function() {
        const browse = document.getElementById('nflxBrowseContent');
        const results = document.getElementById('nflxSearchContent');
        if (!browse || !results) return;

        browse.classList.add('d-none');
        results.classList.remove('d-none');
        results.innerHTML = `<div class="yt-loading"><i class="bi bi-hourglass-split"></i> Carregando "<strong>Geek</strong>"...</div>`;

        const fontes = ['animes', 'mangadex'].filter(k => isFonteAtiva(k));
        if (!fontes.length) {
            results.innerHTML = `<div class="yt-loading"><i class="bi bi-emoji-frown"></i> As fontes de Animes e Mangás estão desativadas. Ative-as em "Gerenciar fontes".</div>`;
            return;
        }

        const secao = await Promise.all(fontes.map(async (k) => {
            const f = FONTES_SIDEBAR.find(x => x.key === k);
            const direta = FONTES_DIRETAS[k];
            let itens = [];
            const res = await comTimeout(
                direta.carregar().then(i => ({ ok: true, itens: i })).catch(() => ({ ok: false, itens: [] })),
                15000
            );
            if (res.ok && res.itens.length) {
                itens = res.itens;
            } else {
                itens = k === 'animes'
                    ? buscarNoCachePorCategoria('', 'anime')
                    : buscarNoCachePorFonte('', direta.heading);
            }
            if (itens.length) cacheItems(itens);
            return { heading: direta.heading, icone: `<i class="bi ${f.icon}"></i>`, itens };
        }));

        const secoesHtml = secao
            .filter(s => s.itens.length)
            .map((s, i) => renderSecaoBusca(i, s.heading, s.icone, s.itens))
            .join('');

        if (!secoesHtml) {
            results.innerHTML = `<div class="yt-loading"><i class="bi bi-wifi-off"></i> Serviço temporariamente indisponível — tente novamente em instantes.</div>`;
        } else {
            results.innerHTML = `<div class="yt-loading"><i class="bi bi-joystick"></i> Geek — Animes & Mangás</div>${secoesHtml}`;
        }
        setupCarousels();
    };

    // Navegação "Música": junta Músicas (iTunes) + Rádios em uma única tela.
    window.nflxBuscarMusicas = async function() {
        const browse = document.getElementById('nflxBrowseContent');
        const results = document.getElementById('nflxSearchContent');
        if (!browse || !results) return;

        browse.classList.add('d-none');
        results.classList.remove('d-none');
        results.innerHTML = `<div class="yt-loading"><i class="bi bi-hourglass-split"></i> Carregando "<strong>Música & Rádios</strong>"...</div>`;

        const fontes = ['itunes', 'radiobrowser'].filter(k => isFonteAtiva(k));
        if (!fontes.length) {
            results.innerHTML = `<div class="yt-loading"><i class="bi bi-emoji-frown"></i> As fontes de Música e Rádios estão desativadas. Ative-as em "Gerenciar fontes".</div>`;
            return;
        }

        const secao = await Promise.all(fontes.map(async (k) => {
            const f = FONTES_SIDEBAR.find(x => x.key === k);
            const direta = FONTES_DIRETAS[k];
            let itens = [];
            const res = await comTimeout(
                direta.carregar().then(i => ({ ok: true, itens: i })).catch(() => ({ ok: false, itens: [] })),
                15000
            );
            if (res.ok && res.itens.length) {
                itens = res.itens;
            } else {
                itens = k === 'radiobrowser'
                    ? buscarNoCachePorCategoria('', 'audio')
                    : buscarNoCachePorFonte('', f ? f.heading : direta.heading);
            }
            if (itens.length) cacheItems(itens);
            return { heading: direta.heading, icone: `<i class="bi ${f.icon}"></i>`, itens };
        }));

        const secoesHtml = secao
            .filter(s => s.itens.length)
            .map((s, i) => renderSecaoBusca(i, s.heading, s.icone, s.itens))
            .join('');

        if (!secoesHtml) {
            results.innerHTML = `<div class="yt-loading"><i class="bi bi-wifi-off"></i> Serviço temporariamente indisponível — tente novamente em instantes.</div>`;
        } else {
            results.innerHTML = `<div class="yt-loading"><i class="bi bi-music-note-beamed"></i> Música & Rádios</div>${secoesHtml}`;
        }
        setupCarousels();
    };

    // Navegação "Vídeos": junta Invidious/Piped/Odysee em uma única tela.
    window.nflxBuscarVideos = async function() {
        const browse = document.getElementById('nflxBrowseContent');
        const results = document.getElementById('nflxSearchContent');
        if (!browse || !results) return;

        browse.classList.add('d-none');
        results.classList.remove('d-none');
        results.innerHTML = `<div class="yt-loading"><i class="bi bi-hourglass-split"></i> Carregando "<strong>Vídeos</strong>"...</div>`;

        const fontes = ['invidious', 'piped', 'odysee'].filter(k => isFonteAtiva(k));
        if (!fontes.length) {
            results.innerHTML = `<div class="yt-loading"><i class="bi bi-emoji-frown"></i> As fontes de Vídeos estão desativadas. Ative-as em "Gerenciar fontes".</div>`;
            return;
        }

        const secao = await Promise.all(fontes.map(async (k) => {
            const f = FONTES_SIDEBAR.find(x => x.key === k);
            const direta = FONTES_DIRETAS[k];
            let itens = [];
            const res = await comTimeout(
                direta.carregar().then(i => ({ ok: true, itens: i })).catch(() => ({ ok: false, itens: [] })),
                15000
            );
            if (res.ok && res.itens.length) {
                itens = res.itens;
            } else {
                itens = buscarNoCachePorFonte('', f ? f.heading : direta.heading);
            }
            if (itens.length) cacheItems(itens);
            return { heading: direta.heading, icone: `<i class="bi ${f.icon}"></i>`, itens };
        }));

        const secoesHtml = secao
            .filter(s => s.itens.length)
            .map((s, i) => renderSecaoBusca(i, s.heading, s.icone, s.itens))
            .join('');

        if (!secoesHtml) {
            results.innerHTML = `<div class="yt-loading"><i class="bi bi-wifi-off"></i> Serviço temporariamente indisponível — tente novamente em instantes.</div>`;
        } else {
            results.innerHTML = `<div class="yt-loading"><i class="bi bi-play-btn-fill"></i> Vídeos</div>${secoesHtml}`;
        }
        setupCarousels();
    };

    window.nflxRecarregar = function() {
        _hero = null;
        window.openFilmes({ skipIntro: true });
    };

    window.nflxAbrirBuscaMobile = function() {
        const mobileHeader = document.getElementById('ytMobileSearchHeader');
        const input = document.getElementById('nflxMobileSearchInput');
        if (!mobileHeader || !input) return;
        mobileHeader.classList.add('mobile-search-active');
        setTimeout(() => input.focus(), 50);
    };

    window.nflxFecharBuscaMobile = function() {
        const mobileHeader = document.getElementById('ytMobileSearchHeader');
        const input = document.getElementById('nflxMobileSearchInput');
        if (!mobileHeader || !input) return;
        mobileHeader.classList.remove('mobile-search-active');
        input.value = '';
        window.nflxBuscar('');
        input.blur();
    };

    // ---------------------------------------------------------------
    // TELA DE CARREGAMENTO (estilo YouTube): overlay com logo,
    // barra de progresso linear e porcentagem. Só libera o acesso
    // quando todas as fontes estiverem carregadas.
    // ---------------------------------------------------------------
    function mostrarIntroYouTube(callback) {
        _intro.total = getSecoesAtivas().length;
        _intro.concluido = 0;
        _intro.inicio = Date.now();
        _intro.revelar = null;

        let intro = document.getElementById('ytIntro');
        if (!intro) {
            intro = document.createElement('div');
            intro.id = 'ytIntro';
            intro.className = 'yt-intro-overlay';
            intro.setAttribute('aria-hidden', 'true');
            intro.innerHTML = `
                <svg class="yt-intro-logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#f1f1f1" stroke-width="2" stroke-linejoin="round"/>
                    <path d="M2 17L12 22L22 17" stroke="#f1f1f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M2 12L12 17L22 12" stroke="#f1f1f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <h1 class="yt-intro-title">Mídias</h1>
                <div class="yt-intro-bar">
                    <div class="yt-intro-fill" id="ytIntroFill"></div>
                </div>
                <div class="yt-intro-pct" id="ytIntroPct">0%</div>
            `;
            document.body.appendChild(intro);
        }

        intro.classList.remove('fade-out');
        intro.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        _intro.revelar = () => {
            intro.classList.add('fade-out');
            document.body.style.overflow = '';
            setTimeout(() => {
                intro.style.display = 'none';
                if (typeof callback === 'function') callback();
            }, 400);
        };

        setTimeout(() => atualizarIntro(), 100);
        setTimeout(() => { if (_intro.revelar && _intro.concluido < _intro.total) _intro.revelar(); }, 30000);

        carregarSecoes();
    }

    function atualizarIntro() {
        const total = Math.max(1, _intro.total || SECTIONS.length);
        const pct = Math.min(100, Math.round((_intro.concluido / total) * 100));
        const fill = document.getElementById('ytIntroFill');
        const pctEl = document.getElementById('ytIntroPct');
        if (fill) fill.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
        if (_intro.concluido >= total && _intro.revelar && Date.now() - _intro.inicio >= 800) {
            _intro.revelar();
        }
    }

    window.openFilmes = function(opts = {}) {
        const user = window.getSavedUser ? window.getSavedUser() : null;
        if (!user) {
            if (window.showToast) window.showToast('Faça login!', 'warning');
            return;
        }

        if (window.exitWaOrdersView) window.exitWaOrdersView();
        if (window.setWaRailActive) window.setWaRailActive('filmes');

        window.lastChatSignature = null;

        const hero = document.getElementById('heroSection');
        if (hero) hero.classList.add('d-none');
        const gridMain = document.getElementById('productGridMain');
        if (gridMain) gridMain.classList.add('d-none');
        const grid = document.getElementById('productsGrid');
        if (grid) { grid.classList.remove('order-view-active'); grid.style.display = 'none'; }

        const waView = document.getElementById('whatsappOrdersView');
        if (waView) {
            waView.classList.remove('d-none');
            waView.classList.remove('wa-order-mode', 'wa-community-mode');
            waView.classList.add('wa-filmes-mode');
        }
        document.body.classList.add('wa-locked', 'wa-fullscreen');

        if (window.closeWaChat) window.closeWaChat();
        if (window.closeDirectChat) window.closeDirectChat();

        // Rota própria e persistente da Mídia: #/chat/midia_<uuid> (padrão
        // das conversas). Links diretos para esse id voltam pra mesma tela
        // mesmo após recarregar a página. Fica DEPOIS do closeWaChat/
        // closeDirectChat: eles limpam o currentChat e reescrevem o hash de
        // #/chat/... para #/chat/mensagem, e a rota precisa ser a última
        // palavra sobre a URL da área.
        if (window.stopDirectChatPolling) window.stopDirectChatPolling();
        if (window.stopDirectTypingWatcher) window.stopDirectTypingWatcher();
        window.currentChat = obterMidiaId();
        const rotaMidia = '#/chat/' + window.currentChat;
        if (window.location.hash !== rotaMidia) {
            history.pushState(null, '', rotaMidia);
        }

        // O root (#nflxRoot) precisa existir ANTES de carregarSecoes() ser
        // chamada — ela procura o elemento e sai sem fazer nada se ele não
        // estiver no DOM ainda. Antes, renderRoot() só rodava dentro de
        // "abrir" (o callback da intro), ou seja, depois que a busca pelas
        // fontes já teria sido tentada e abortada. Isso deixava a intro
        // presa até o timeout de 30s e a tela sempre vazia. Agora o root é
        // montado primeiro (fica coberto pelo overlay da intro, que tem
        // fundo opaco) e só então as seções começam a carregar de verdade.
        renderRoot();

        const abrir = () => {
            const emptyState = document.getElementById('waEmptyState');
            if (emptyState) emptyState.classList.add('d-none');
            const ordersView = document.getElementById('whatsappOrdersView');
            if (ordersView) ordersView.classList.add('wa-chat-open');
            if (window.closeMobileMenu) window.closeMobileMenu();
        };

        if (opts.skipIntro) {
            // Sem tela de intro (recarregar/"Início", ou reabertura via rota
            // #/chat/midia_...): ainda assim as seções precisam ser buscadas,
            // senão a tela fica travada em "Carregando..." para sempre.
            abrir();
            carregarSecoes();
        } else {
            mostrarIntroYouTube(abrir);
        }
    };

    window.filmesVoltar = function() {
        document.getElementById('nflxAudioBar')?.remove();
        const waView = document.getElementById('whatsappOrdersView');
        if (waView) waView.classList.remove('wa-filmes-mode');
        if (window.renderDirectChats) window.renderDirectChats({ skipBoot: true });
    };

    // ---------------------------------------------------------------
    // EXPORTA FUNÇÕES
    // ---------------------------------------------------------------
    window.buscarInvidious = buscarInvidious;
    window.buscarPiped = buscarPiped;
    window.buscarOdysee = buscarOdysee;
    window.buscarGamerPower = buscarGamerPower;
    window.buscarJogosRetro = buscarJogosRetro;
    window.buscarItunes = buscarItunes;
    window.buscarWikipedia = buscarWikipedia;
    window.buscarTVMaze = buscarTVMaze;
    window.buscarOpenLibrary = buscarOpenLibrary;
    window.buscarMangaDex = buscarMangaDex;
    window.buscarEpic_Oficial = buscarEpic_Oficial;

    })();