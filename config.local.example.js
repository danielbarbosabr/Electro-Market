// Busca a config do Supabase na função serverless (api/config.js), que por
// sua vez lê as variáveis de ambiente do SERVIDOR — a chave não fica
// escrita aqui no código do front-end.
//
// window._configReady é uma Promise que o script.js aguarda antes de
// inicializar o app, já que esse fetch é assíncrono.
//
// Se api/config.js não responder (ex: testando com Live Server ou outro
// servidor estático simples, que não roda função serverless nenhuma),
// cai num fallback SÓ DE DESENVOLVIMENTO: js/config.local.js — um arquivo
// que fica de fora do Git (ver .gitignore) e nunca é publicado.
(function () {
    function setConfig(cfg) {
        window.CONFIG = { SUPABASE_URL: cfg.SUPABASE_URL, SUPABASE_KEY: cfg.SUPABASE_KEY };
        window.dispatchEvent(new Event('config:ready'));
    }

    // Tenta carregar js/config.local.js (script normal, então funciona
    // igual em Live Server) e usar o CONFIG_LOCAL_FALLBACK que ele define.
    function tryLocalDevFallback() {
        return new Promise(function (resolve, reject) {
            const script = document.createElement('script');
            script.src = 'js/config.local.js';
            script.onload = function () {
                const local = window.CONFIG_LOCAL_FALLBACK;
                if (local && local.SUPABASE_URL && local.SUPABASE_KEY) {
                    setConfig(local);
                    resolve();
                } else {
                    reject(new Error('js/config.local.js existe mas está sem os valores preenchidos.'));
                }
            };
            script.onerror = function () {
                reject(new Error('js/config.local.js não encontrado.'));
            };
            document.head.appendChild(script);
        });
    }

    function showErrorScreen(devHint) {
        document.addEventListener('DOMContentLoaded', function () {
            const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
            document.body.innerHTML =
                '<div style="display:flex;align-items:center;justify-content:center;height:100vh;' +
                'font-family:sans-serif;text-align:center;padding:20px;color:#b00020;">' +
                '<div><h2>Não foi possível carregar as configurações do site.</h2>' +
                (isLocal
                    ? '<p style="color:#555;max-width:520px;">' + devHint + '</p>'
                    : '<p>Tente novamente em instantes. Se o problema continuar, contate o suporte.</p>') +
                '</div></div>';
        });
    }

    window._configReady = fetch('/api/config', { cache: 'no-store' })
        .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(function (cfg) {
            if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) throw new Error('Config incompleta.');
            setConfig(cfg);
        })
        .catch(function (err) {
            console.warn('api/config indisponível (' + err.message + '), tentando fallback de dev local (js/config.local.js)...');
            return tryLocalDevFallback().catch(function (err2) {
                console.error('Falha ao carregar a config do Supabase:', err2);
                showErrorScreen(
                    'Rodando com Live Server / servidor estático: copie js/config.local.example.js para ' +
                    'js/config.local.js e preencha com os valores do Supabase. Para testar exatamente ' +
                    'como em produção, use "vercel dev" no lugar do Live Server.'
                );
            });
        });
})();
