@media (max-width: 576px) {
    #productsGrid,
    .products-grid-uniform {
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
        padding: 5px;
    }
    .product-card-img-container {
        height: 150px;
        padding: 10px;
    }
}
@media (min-width: 577px) and (max-width: 900px) {
    .products-grid-uniform {
        grid-template-columns: repeat(3, 1fr);
    }
}
@media (max-width: 576px) {
    #productsGrid.order-view-active {
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
        padding: 10px;
        border-radius: 12px;
    }
}
@media (max-width: 767px) {
    .detail-page {
        border: none;
        border-radius: 0;
        padding: 10px;
    }
}
@media (max-width: 480px) {
    .profile-links-screen { padding: 24px 10px 50px; }
    .profile-links-card { padding: 26px 16px 22px; }
}
@media (max-width: 768px) {
    .wa-main {
        min-height: 400px;
    }
    .wa-side { width: 100%; }
    .wa-chat { display: none; }
    .wa-main.wa-chat-open .wa-side { display: none; }
    .wa-main.wa-chat-open .wa-chat { display: flex; }
}
@media (max-width: 768px) {
    .chat-sidebar {
        position: absolute;
        z-index: 100;
        height: 100%;
        transform: translateX(-100%);
        transition: 0.3s;
        background-color: var(--card-bg);
    }
    
    .chat-sidebar.show {
        transform: translateX(0);
    }
    
    .section-title span {
        padding: 0.5rem 1.5rem;
        font-size: 1.2rem;
    }
}
@media (max-width: 480px) {
    .toast-container-custom {
        top: 15px;
        right: 12px;
        left: 12px;
    }
    .toast-custom {
        min-width: 0;
        max-width: 100%;
        padding: 14px 16px !important;
    }
}
@media (max-width: 768px) {
    .auth-wrapper {
        width: 100vw !important;
        height: 100dvh !important; /* dVH é melhor para mobile Android/Chrome */
        max-width: 100% !important;
        max-height: 100% !important;
        border-radius: 0 !important;
        background: var(--card-bg) !important;
    }
    .auth-wrapper::before {
        display: none !important;
    }
    .auth-column-side {
        display: none !important;
    }
    .auth-column-form {
        width: 100% !important;
        padding: 50px 20px 20px !important; /* Aumentado padding superior para dar espaço ao botão de fechar */
        background: var(--card-bg) !important;
        justify-content: flex-start !important; /* Alinha ao topo para evitar que o conteúdo suma em telas pequenas */
        height: 100% !important;
        overflow-y: auto !important; /* Habilita scroll para formulários longos como o de Cadastro */
        -webkit-overflow-scrolling: touch;
    }
    .auth-content {
        position: absolute !important; /* Volta para absolute para as telas não empilharem */
        inset: 0 !important;
        flex-direction: column !important;
    }
    .auth-close-btn {
        position: fixed !important; /* Muda de absolute para fixed para ignorar o scroll do formulário */
        top: 20px !important; 
        right: 15px !important;
        background: transparent !important; /* Remove o fundo circular (a bolota) */
        width: 44px !important; /* Mantém área de clique boa para o polegar */
        height: 44px !important;
        border-radius: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        z-index: 999999 !important; /* Z-index máximo para garantir que fique no topo de tudo */
        box-shadow: none !important; /* Remove a sombra da bolota */
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: all !important; /* Força a detecção de clique */
        cursor: pointer !important;
        display: flex !important;
    }

    .auth-close-btn i, 
    .auth-close-btn img {
        display: block !important; /* Mostra o ícone original novamente */
        filter: none !important; 
        color: #ff0000 !important; /* Define a cor do X como vermelho */
        font-size: 2rem !important; /* Ajusta o tamanho do ícone */
        pointer-events: none !important; /* O clique deve passar para o botão pai */
    }
    .login-icon-v3 {
        width: 100px; /* Reduzido levemente para economizar espaço vertical */
        height: 100px;
        margin-top: 5px;
        margin-bottom: 5px;
    }
    .auth-form-v2 {
        max-width: 100%;
    }
    .auth-form-v2 input, .auth-form-v2 select {
        margin-bottom: 10px !important;
        padding: 8px 12px !important; /* Inputs um pouco mais compactos no mobile */
    }
    /* Remove animações de deslocamento horizontal que causam "pulos" na visualização mobile */
    body.sign-in-js .first-content .second-column,
    body.sign-up-js .second-content .second-column {
        animation: none !important;
    }
}
@media (max-width: 576px) {
    .ml-auth-card { padding: 28px 20px; border-radius: 0; box-shadow: none; }
    .ml-auth-overlay { padding: 0; }
    .ml-auth-wrapper { max-width: 100%; }
    .ml-step-line { width: 30px; }
    .ml-auth-close { border-radius: 0; top: 4px; right: 4px; }
}
@media (max-width: 768px) {
    body.dark-theme .wa-side { background: var(--card-bg); }
}
@media (max-width: 576px) {
    .admin-stats-row {
        grid-template-columns: repeat(2, 1fr);
        gap: 0.6rem;
        margin-bottom: 1rem;
    }
    .admin-stat-card {
        padding: 0.7rem 0.6rem;
        gap: 0.5rem;
        min-width: 0;
    }
    .admin-stat-card i {
        font-size: 1.05rem;
        width: 34px;
        height: 34px;
    }
    .admin-stat-card h3 {
        font-size: 1.1rem;
    }
    .admin-stat-card span {
        font-size: 0.62rem;
        display: block;
        line-height: 1.2;
        white-space: normal;
    }
    .admin-stat-card > div {
        min-width: 0;
    }
}
@media (max-width: 900px) {
    .admin-reports-grid {
        grid-template-columns: 1fr;
    }
    .admin-chart-wrap {
        height: 240px;
    }
}
@media (max-width: 900px) {
    .admin-navbar-mobile {
        position: static;
    }
    .admin-stats-row {
        grid-template-columns: repeat(2, 1fr);
    }
}
