// Busca a config do Supabase na função serverless (api/config.js), que por
// sua vez le as variaveis de ambiente do SERVIDOR. Dessa forma a chave nunca
// fica escrita aqui no codigo do front-end.
//
// window._configReady e uma Promise que o script.js aguarda antes de
// inicializar o app, ja que esse fetch e assincrono.
(function () {
    window._configReady = fetch('/api/config', { cache: 'no-store' })
        .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(function (cfg) {
            if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) throw new Error('Config incompleta.');
            window.CONFIG = { SUPABASE_URL: cfg.SUPABASE_URL, SUPABASE_KEY: cfg.SUPABASE_KEY };
            window.dispatchEvent(new Event('config:ready'));
        })
        .catch(function (err) {
            console.error('Falha ao carregar a config do Supabase:', err);
            document.addEventListener('DOMContentLoaded', function () {
                document.body.innerHTML =
                    '<div style="display:flex;align-items:center;justify-content:center;height:100vh;' +
                    'font-family:sans-serif;text-align:center;padding:20px;color:#b00020;">' +
                    '<div><h2>Não foi possível carregar as configurações do site.</h2>' +
                    '<p>Tente novamente em instantes. Se o problema continuar, contate o suporte.</p></div></div>';
            });
        });
})();
