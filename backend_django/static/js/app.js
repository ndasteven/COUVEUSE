// Configuration API
const API_URL = '/api';
const WS_URL = `${window.location.protocol}//${window.location.hostname}:3001`;
let serverClockPollingInterval = null;



function formatServerUtcDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '--';
    const pad = n => String(n).padStart(2, '0');
    const day = date.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'UTC'
    });
    const hours = pad(date.getUTCHours());
    const minutes = pad(date.getUTCMinutes());
    const seconds = pad(date.getUTCSeconds());
    return `${day} ${hours}:${minutes}:${seconds} UTC`;
}

function updateServerClockText(text) {
    const clock = document.getElementById('server-clock');
    const value = document.getElementById('server-clock-value');
    const mobileValue = document.getElementById('server-clock-mobile-value');
    if (clock && value) {
        clock.classList.remove('hidden');
        value.textContent = text;
    }
    if (mobileValue) {
        if (text === 'WS offline' || text === '--') {
            mobileValue.textContent = text;
        } else {
            const match = text.match(/(\d{2}:\d{2}:\d{2} UTC)$/);
            mobileValue.textContent = match ? match[1] : text;
        }
    }
}

async function fetchServerTimeHttp() {
    try {
        const response = await fetch(`${WS_URL}/server-time`, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        updateServerClockText(formatServerUtcDate(data.iso || data.timestamp));
        return true;
    } catch (error) {
        updateServerClockText('WS offline');
        return false;
    }
}

function startServerClockPolling() {
    if (serverClockPollingInterval) return;
    fetchServerTimeHttp();
    serverClockPollingInterval = setInterval(fetchServerTimeHttp, 1000);
}

function stopServerClockPolling() {
    if (!serverClockPollingInterval) return;
    clearInterval(serverClockPollingInterval);
    serverClockPollingInterval = null;
}

// Fonction pour récupérer le CSRF token depuis les cookies
function getCSRFToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) {
        const token = meta.getAttribute('content');
        if (token && token !== 'NOTPROVIDED') {
            return token;
        }
    }

    const match = document.cookie.match(/(^|;)\s*csrftoken=([^;]+)/);
    if (match) {
        return decodeURIComponent(match[2]);
    }

    return null;
}

// Override global fetch to ensure same-origin credentials and CSRF for state-changing requests
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
    const opts = { ...init };
    const request = input instanceof Request ? input : null;
    const method = request
        ? (opts.method || input.method || 'GET').toUpperCase()
        : (opts.method || 'GET').toUpperCase();

    opts.credentials = opts.credentials || 'same-origin';

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const headers = new Headers(opts.headers || (request ? request.headers : {}));
        if (!headers.has('X-CSRFToken')) {
            const token = getCSRFToken();
            if (token) {
                headers.set('X-CSRFToken', token);
            } else {
                console.warn('CSRF token missing for fetch', input, opts);
            }
        }
        if (!headers.has('X-Requested-With')) {
            headers.set('X-Requested-With', 'XMLHttpRequest');
        }
        opts.headers = headers;
    }

    return originalFetch(input, opts);
};

// État global
let state = {
    page: 'dashboard',
    alertes: [],
    depots: [],
    clients: [],
    races: [],
    categories: []
};

// Pagination pour le tableau de bord
let dashboardDepotsPagination = {
    page: 1,
    lignesParPage: 10,
    total: 0
};

// Pagination pour les clients
let clientsPagination = {
    page: 1,
    lignesParPage: 10,
    total: 0
};

// Socket.io connection
let socket = null;

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    const token = getCSRFToken();
    console.log('🥚 Couveuse Manager initialisé');
    console.log('🔐 CSRF token détecté:', token ? 'oui' : 'non', token ? token.slice(0, 8) + '...' : '');
    chargerPage('dashboard');
    chargerAlertes();
    demanderPermissionNotifications();
    
    // Connexion au serveur WebSocket
    connecterWebSocket();

    // Vérifier les alertes toutes les 30 secondes (backup)
    setInterval(chargerAlertes, 30000);

    // Gérer le statut de connexion
    window.addEventListener('online', updateStatutConnexion);
    window.addEventListener('offline', updateStatutConnexion);
    updateStatutConnexion();
});

// Connexion au WebSocket
function connecterWebSocket() {
    try {
        socket = io(WS_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: Infinity
        });
        
        socket.on('connect', () => {
            console.log('✅ Connecté au serveur WebSocket:', socket.id);
            updateStatutConnexion();
            stopServerClockPolling();
            
            // Demander les alertes initiales
            socket.emit('get_initial_alertes');
        });
        
        socket.on('disconnect', () => {
            console.log('❌ Déconnecté du serveur WebSocket');
            updateStatutConnexion();
            startServerClockPolling();
        });
        
        socket.on('connect_error', (error) => {
            console.log('⚠️ Erreur de connexion WebSocket:', error.message);
            updateStatutConnexion();
            startServerClockPolling();
        });
        
        // Recevoir les nouvelles alertes en temps réel
        socket.on('nouvelles_alertes', (alertes) => {
            console.log('🔔 Nouvelles alertes reçues:', alertes);
            verifierAlertesCritiques(alertes);
            chargerAlertes(); // Rafraîchir l'affichage
        });
        
        // Recevoir les alertes initiales
        socket.on('initial_alertes', (alertes) => {
            console.log('📋 Alertes initiales:', alertes.length);
            // Mettre à jour le state et déclencher la vérification
            state.alertes = alertes;
        });

        // Recevoir les alertes en retard (éclosions passées manquées)
        socket.on('alertes_retard', (alertes) => {
            console.log('⚠️ ALERTES EN RETARD REÇUES:', alertes.length);
            console.log('⏰ Ces éclosions sont passées et n\'ont pas été notifiées!');

            // Déclencher l'alarme avec le flag retard
            verifierAlertesRetard(alertes);
        });
        
        // Notification push pour éclosion urgente
        socket.on('notification_push', (notification) => {
            console.log('📬 Notification push:', notification);
            afficherNotificationBrowser(notification.title, notification.body, notification.icon);
            
            if (notification.urgent) {
                demarrerAlarme();
            }
        });
        
        // Mise à jour des statistiques
        socket.on('stats_update', (stats) => {
            console.log('📊 Stats mises à jour:', stats);
            if (state.page === 'dashboard') {
                chargerStatsDashboard();
            }
        });

        // Heure serveur UTC
        socket.on('server_time', (data) => {
            updateServerClockText(formatServerUtcDate(data.iso || data.timestamp));
            stopServerClockPolling();
        });
        
        // Nombre d'alertes
        socket.on('alertes_count', (count) => {
            console.log('🔢 Nombre d\'alertes:', count);
            const badge = document.getElementById('badge-notif');
            const menuBadge = document.getElementById('menu-badge-alertes');
            
            if (count > 0) {
                badge.textContent = count;
                badge.classList.remove('hidden');
                menuBadge.textContent = count;
                menuBadge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
                menuBadge.classList.add('hidden');
            }
        });
        
        // Mise à jour automatique des statuts
        socket.on('statuts_mis_a_jour', (data) => {
            console.log('🔄 Statuts mis à jour:', data);
            afficherNotification(data.message, 'info');

            // ✅ NOUVEAU : Traiter les alertes incluses (éclosions passées non notifiées)
            if (data.alertes && data.alertes.length > 0) {
                console.log('⚠️ Alertes de statut reçues:', data.alertes.length);

                // Ajouter aux alertes existantes
                state.alertes = [...state.alertes, ...data.alertes];

                // Déclencher l'alarme pour les alertes en retard
                verifierAlertesRetard(data.alertes);
            }

            // ✅ Recharger les alertes depuis l'API pour mettre à jour le dropdown
            chargerAlertes();

            // Rafraîchir la page si on est sur les dépôts ou le dashboard
            if (state.page === 'depots' || state.page === 'dashboard') {
                chargerPage(state.page);
            }
        });
        
        // Nombre de clients connectés
        socket.on('clients_count', (count) => {
            console.log('👥 Clients connectés:', count);
        });
        
    } catch (error) {
        console.error('❌ Erreur connexion WebSocket:', error);
    }
}

// Charger une page
async function chargerPage(page) {
    state.page = page;
    if (page === 'dashboard') dashboardDepotsPagination.page = 1;
    const content = document.getElementById('app-content');

    switch(page) {
        case 'dashboard':
            content.innerHTML = await getDashboardHTML();
            await chargerStatsDashboard();
            break;
        case 'calendrier':
            content.innerHTML = await getCalendrierHTML();
            await chargerCalendrier();
            break;
        case 'depots':
            content.innerHTML = await getDepotsHTML();
            await chargerDepots();
            break;
        case 'palettes':
            content.innerHTML = await getPalettesHTML();
            await chargerPalettes();
            break;
        case 'clients':
            content.innerHTML = await getClientsHTML();
            clientsPagination.page = 1;
            await chargerClients();
            break;
        case 'races':
            content.innerHTML = await getRacesHTML();
            await chargerRaces();
            break;
        case 'alertes':
            content.innerHTML = await getAlertesHTML();
            await chargerAlertes();
            break;
        case 'caisse':
            content.innerHTML = await getCaisseHTML();
            await chargerCaisse();
            break;
        case 'parametres':
            content.innerHTML = getParametresHTML();
            // Charger les paramètres APRÈS que le formulaire soit affiché
            setTimeout(() => chargerParametres(), 100);
            break;
    }

    // Fermer le drawer sur mobile
    document.getElementById('sidebar-drawer').checked = false;
}

// ==================== DASHBOARD ====================

async function getDashboardHTML() {
    return `
        <div class="space-y-6">
            <div class="flex justify-between items-center">
                <h2 class="text-2xl font-bold">📊 Tableau de bord</h2>
                <button onclick="chargerPage('depots')" class="btn btn-primary">
                    <i class="fas fa-plus"></i> Nouveau dépôt
                </button>
            </div>
            
            <!-- Stats -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="stat bg-base-100 rounded-box shadow">
                    <div class="stat-figure text-primary">
                        <i class="fas fa-box text-3xl"></i>
                    </div>
                    <div class="stat-title">Dépôts en cours</div>
                    <div class="stat-value text-primary" id="stat-depots">-</div>
                    <div class="stat-desc">En incubation</div>
                </div>
                
                <div class="stat bg-base-100 rounded-box shadow">
                    <div class="stat-figure text-secondary">
                        <i class="fas fa-egg text-3xl"></i>
                    </div>
                    <div class="stat-title">Œufs totaux</div>
                    <div class="stat-value text-secondary" id="stat-oeufs">-</div>
                    <div class="stat-desc">Toutes races confondues</div>
                </div>
                
                <div class="stat bg-base-100 rounded-box shadow">
                    <div class="stat-figure text-accent">
                        <i class="fas fa-calendar-check text-3xl"></i>
                    </div>
                    <div class="stat-title">Éclosions aujourd'hui</div>
                    <div class="stat-value text-accent" id="stat-eclosions">-</div>
                    <div class="stat-desc">À surveiller</div>
                </div>
                
                <div class="stat bg-base-100 rounded-box shadow">
                    <div class="stat-figure text-error">
                        <i class="fas fa-bell text-3xl"></i>
                    </div>
                    <div class="stat-title">Alertes</div>
                    <div class="stat-value text-error" id="stat-alertes">-</div>
                    <div class="stat-desc">Non lues</div>
                </div>
            </div>
            
            <!-- Alertes récentes -->
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <h3 class="card-title">🔔 Alertes récentes</h3>
                    <div id="dashboard-alertes" class="space-y-2"></div>
                </div>
            </div>
            
            <!-- Dépôts récents -->
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="card-title">📦 Dépôts récents</h3>
                        <div class="flex items-center gap-2">
                            <span class="text-xs opacity-70">Afficher :</span>
                            <select id="dashboard-lignes-par-page" class="select select-bordered select-xs" onchange="changerLignesParPageDashboard()">
                                <option value="5" ${dashboardDepotsPagination.lignesParPage === 5 ? 'selected' : ''}>5</option>
                                <option value="10" ${dashboardDepotsPagination.lignesParPage === 10 ? 'selected' : ''}>10</option>
                                <option value="25" ${dashboardDepotsPagination.lignesParPage === 25 ? 'selected' : ''}>25</option>
                                <option value="50" ${dashboardDepotsPagination.lignesParPage === 50 ? 'selected' : ''}>50</option>
                            </select>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Client</th>
                                    <th>Race</th>
                                    <th>Quantité</th>
                                    <th>Date</th>
                                    <th>Jours restants</th>
                                    <th>Statut</th>
                                </tr>
                            </thead>
                            <tbody id="dashboard-depots"></tbody>
                        </table>
                    </div>
                    <!-- Pagination Dashboard -->
                    <div class="flex flex-wrap justify-between items-center mt-4 gap-2">
                        <div id="dashboard-pagination-info" class="text-sm text-gray-500"></div>
                        <div class="join">
                            <button class="join-item btn btn-sm" onclick="changerPageDashboard(-1)" title="Précédent">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                                </svg>
                            </button>
                            <button id="dashboard-current-page" class="join-item btn btn-sm btn-active">1</button>
                            <button class="join-item btn btn-sm" onclick="changerPageDashboard(1)" title="Suivant">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function chargerStatsDashboard() {
    try {
        const response = await fetch(`${API_URL}/depots/`);
        const depots = await response.json();
        state.depots = depots;
        
        const totalDepots = depots.filter(d => d.statut === 'en_cours').length;
        const totalOeufs = depots.reduce((sum, d) => sum + d.quantite_oeufs, 0);
        
        const aujourdHui = new Date().toISOString().split('T')[0];
        const eclosionsAujourdhui = depots.filter(d => d.date_eclosion_prevue === aujourdHui).length;
        
        document.getElementById('stat-depots').textContent = totalDepots;
        document.getElementById('stat-oeufs').textContent = totalOeufs;
        document.getElementById('stat-eclosions').textContent = eclosionsAujourdhui;
        document.getElementById('stat-alertes').textContent = state.alertes.length;
        
        afficherDepotsDashboard();
        
    } catch (error) {
        console.error('Erreur chargement stats:', error);
    }
}

function afficherDepotsDashboard() {
    const depots = state.depots || [];
    
    // Trier par date de dépôt décroissante (plus récents d'abord)
    let sortedDepots = [...depots];
    sortedDepots.sort((a, b) => new Date(b.date_heure_depôt) - new Date(a.date_heure_depôt));
    
    const total = sortedDepots.length;
    dashboardDepotsPagination.total = total;
    
    const start = (dashboardDepotsPagination.page - 1) * dashboardDepotsPagination.lignesParPage;
    const end = start + dashboardDepotsPagination.lignesParPage;
    const depotsPagines = sortedDepots.slice(start, end);
    
    const tbody = document.getElementById('dashboard-depots');
    if (tbody) {
        if (depotsPagines.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-gray-500">Aucun dépôt</td></tr>';
        } else {
            tbody.innerHTML = depotsPagines.map(depot => `
                <tr>
                    <td>${depot.client_nom} ${depot.client_prenom || ''}</td>
                    <td>${depot.race_nom} <span class="text-xs opacity-70">(${depot.categorie_nom})</span></td>
                    <td>${depot.quantite_oeufs}</td>
                    <td>${formatDate(depot.date_heure_depôt)}</td>
                    <td>${getJoursRestantsBadge(depot)}</td>
                    <td><span class="badge badge-${getStatutColor(depot.statut)}">${depot.statut}</span></td>
                </tr>
            `).join('');
        }
    }

    const info = document.getElementById('dashboard-pagination-info');
    const totalPages = Math.ceil(total / dashboardDepotsPagination.lignesParPage) || 1;
    if (info) {
        info.textContent = `Affichage ${Math.min(start + 1, total)}-${Math.min(end, total)} sur ${total}`;
    }
    const currentBtn = document.getElementById('dashboard-current-page');
    if (currentBtn) {
        currentBtn.textContent = `${dashboardDepotsPagination.page} / ${totalPages}`;
    }
}

function changerLignesParPageDashboard() {
    const select = document.getElementById('dashboard-lignes-par-page');
    if (select) {
        dashboardDepotsPagination.lignesParPage = parseInt(select.value);
        dashboardDepotsPagination.page = 1;
        afficherDepotsDashboard();
    }
}

function changerPageDashboard(delta) {
    const totalPages = Math.ceil(dashboardDepotsPagination.total / dashboardDepotsPagination.lignesParPage) || 1;
    const newPage = dashboardDepotsPagination.page + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        dashboardDepotsPagination.page = newPage;
        afficherDepotsDashboard();
    }
}

// ==================== CALENDRIER ====================

async function getCalendrierHTML() {
    return `
        <div class="space-y-4">
            <div class="flex justify-between items-center">
                <h2 class="text-2xl font-bold">📅 Calendrier des éclosions</h2>
                <div class="flex gap-2">
                    <button onclick="changerMois(-1)" class="btn btn-sm btn-ghost">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <span id="calendrier-mois" class="text-lg font-bold px-4"></span>
                    <button onclick="changerMois(1)" class="btn btn-sm btn-ghost">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            </div>
            
            <!-- Légende -->
            <div class="flex gap-4 text-sm">
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 rounded bg-success"></div>
                    <span>Éclosion passée</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 rounded bg-error"></div>
                    <span>Éclosion à venir</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 rounded bg-warning"></div>
                    <span>Aujourd'hui</span>
                </div>
            </div>
            
            <!-- Calendrier -->
            <div class="card bg-base-100 shadow">
                <div class="card-body p-0">
                    <div class="grid grid-cols-7 gap-1 p-4 bg-base-200">
                        <div class="text-center font-bold text-sm">Dim</div>
                        <div class="text-center font-bold text-sm">Lun</div>
                        <div class="text-center font-bold text-sm">Mar</div>
                        <div class="text-center font-bold text-sm">Mer</div>
                        <div class="text-center font-bold text-sm">Jeu</div>
                        <div class="text-center font-bold text-sm">Ven</div>
                        <div class="text-center font-bold text-sm">Sam</div>
                    </div>
                    <div id="calendrier-grid" class="grid grid-cols-7 gap-1 p-4"></div>
                </div>
            </div>
            
            <!-- Détails des éclosions du mois -->
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <h3 class="card-title">🥚 Éclosions du mois</h3>
                    <div id="calendrier-eclosions" class="space-y-2"></div>
                </div>
            </div>
        </div>
    `;
}

let calendrierDateActuelle = new Date();
let calendrierDepots = [];

async function chargerCalendrier() {
    try {
        const response = await fetch(`${API_URL}/depots/`);
        calendrierDepots = await response.json();
        afficherCalendrier();
        afficherEclosionsDuMois();
    } catch (error) {
        console.error('Erreur chargement calendrier:', error);
    }
}

function afficherCalendrier() {
    const grid = document.getElementById('calendrier-grid');
    const moisLabel = document.getElementById('calendrier-mois');
    
    const annee = calendrierDateActuelle.getFullYear();
    const mois = calendrierDateActuelle.getMonth();
    
    // Nom du mois
    const moisNoms = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 
                      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    moisLabel.textContent = `${moisNoms[mois]} ${annee}`;
    
    // Premier jour du mois et nombre de jours
    const premierJour = new Date(annee, mois, 1);
    const dernierJour = new Date(annee, mois + 1, 0);
    const nombreJours = dernierJour.getDate();
    const jourDepart = premierJour.getDay();
    
    // Aujourd'hui pour comparaison
    const aujourdHui = new Date();
    aujourdHui.setHours(0, 0, 0, 0);
    
    // Générer les cases du calendrier
    let html = '';
    
    // Cases vides avant le premier jour
    for (let i = 0; i < jourDepart; i++) {
        html += '<div class="h-24"></div>';
    }
    
    // Jours du mois
    for (let jour = 1; jour <= nombreJours; jour++) {
        const dateCourante = new Date(annee, mois, jour);
        dateCourante.setHours(0, 0, 0, 0);
        
        // Trouver les éclosions de ce jour
        const eclosionsDuJour = calendrierDepots.filter(d => {
            const dateEclo = new Date(d.date_eclosion_prevue);
            dateEclo.setHours(0, 0, 0, 0);
            return dateEclo.getTime() === dateCourante.getTime();
        });
        
        // Déterminer la couleur
        let couleurClass = '';
        let tooltip = '';
        
        if (eclosionsDuJour.length > 0) {
            if (dateCourante.getTime() < aujourdHui.getTime()) {
                couleurClass = 'bg-success'; // Éclosion passée
            } else if (dateCourante.getTime() > aujourdHui.getTime()) {
                couleurClass = 'bg-error'; // Éclosion à venir
            } else {
                couleurClass = 'bg-warning'; // Aujourd'hui
            }
            
            // Créer le tooltip avec les détails
            tooltip = eclosionsDuJour.map(d => 
                `${d.client_nom} - ${d.race_nom} (${d.quantite_oeufs} œufs)`
            ).join('\\n');
        }
        
        // Case du jour
        html += `
            <div class="h-24 border border-base-200 rounded p-2 relative group hover:border-primary transition-colors
                        ${couleurClass ? 'cursor-pointer' : ''}"
                 ${tooltip ? `data-tooltip="${tooltip}"` : ''}>
                <span class="text-sm font-medium ${dateCourante.getTime() === aujourdHui.getTime() ? 'text-primary font-bold' : ''}">
                    ${jour}
                </span>
                ${eclosionsDuJour.length > 0 ? `
                    <div class="absolute bottom-1 left-2 right-2 flex flex-wrap gap-1">
                        ${eclosionsDuJour.slice(0, 4).map(() => `
                            <div class="w-2 h-2 rounded-full ${couleurClass}"></div>
                        `).join('')}
                        ${eclosionsDuJour.length > 4 ? `<span class="text-xs">${eclosionsDuJour.length - 4}+</span>` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    grid.innerHTML = html;
    
    // Activer les tooltips
    grid.querySelectorAll('[data-tooltip]').forEach(el => {
        el.addEventListener('mouseenter', (e) => {
            const tooltip = e.target.getAttribute('data-tooltip');
            if (tooltip) {
                afficherTooltipCalendrier(e, tooltip);
            }
        });
        el.addEventListener('mouseleave', () => {
            const tooltipEl = document.getElementById('calendrier-tooltip');
            if (tooltipEl) tooltipEl.remove();
        });
    });
}

function afficherTooltipCalendrier(e, contenu) {
    const tooltip = document.createElement('div');
    tooltip.id = 'calendrier-tooltip';
    tooltip.className = 'fixed z-[9999] bg-base-300 shadow-xl rounded-lg p-3 max-w-xs border border-base-content/10';
    tooltip.innerHTML = `
        <p class="font-bold text-sm mb-2">🥚 Éclosions prévues :</p>
        <div class="space-y-1 text-xs">
            ${contenu.split('\\n').map(l => `<div>• ${l}</div>`).join('')}
        </div>
    `;
    
    document.body.appendChild(tooltip);
    
    const rect = e.target.getBoundingClientRect();
    tooltip.style.top = (rect.top - tooltip.offsetHeight - 10) + 'px';
    tooltip.style.left = (rect.left) + 'px';
}

function afficherEclosionsDuMois() {
    const container = document.getElementById('calendrier-eclosions');
    const annee = calendrierDateActuelle.getFullYear();
    const mois = calendrierDateActuelle.getMonth();
    
    // Filtrer les éclosions du mois
    const eclosionsDuMois = calendrierDepots.filter(d => {
        if (!d.date_eclosion_prevue) return false;
        const dateEclo = new Date(d.date_eclosion_prevue);
        return dateEclo.getFullYear() === annee && dateEclo.getMonth() === mois;
    });
    
    // Trier par date
    eclosionsDuMois.sort((a, b) => new Date(a.date_eclosion_prevue) - new Date(b.date_eclosion_prevue));
    
    if (eclosionsDuMois.length === 0) {
        container.innerHTML = '<p class="text-gray-500 italic">Aucune éclosion prévue ce mois-ci</p>';
        return;
    }
    
    const aujourdHui = new Date();
    aujourdHui.setHours(0, 0, 0, 0);
    
    container.innerHTML = eclosionsDuMois.map(d => {
        const dateEclo = new Date(d.date_eclosion_prevue);
        const estPasse = dateEclo < aujourdHui;
        const estAujourdhui = dateEclo.getTime() === aujourdHui.getTime();
        
        let badgeColor = estPasse ? 'success' : (estAujourdhui ? 'warning' : 'error');
        let statutText = estPasse ? 'Passée' : (estAujourdhui ? 'Aujourd\'hui' : 'À venir');
        
        return `
            <div class="flex justify-between items-center p-3 bg-base-200 rounded hover:bg-base-300 transition-colors">
                <div>
                    <p class="font-medium">${d.client_nom} ${d.client_prenom || ''} - ${d.race_nom} <span class="text-xs opacity-70">(${d.categorie_nom})</span></p>
                    <p class="text-sm text-gray-500">${d.quantite_oeufs} œufs</p>
                </div>
                <div class="text-right">
                    <p class="font-medium">${formatDate(d.date_eclosion_prevue)}</p>
                    <span class="badge badge-${badgeColor} badge-sm">${statutText}</span>
                </div>
            </div>
        `;
    }).join('');
}

function changerMois(delta) {
    calendrierDateActuelle.setMonth(calendrierDateActuelle.getMonth() + delta);
    afficherCalendrier();
    afficherEclosionsDuMois();
}

// ==================== DÉPÔTS ====================

// État de la pagination des dépôts
let depotsPagination = {
    page: 1,
    lignesParPage: 10,
    total: 0,
    tri: 'eclosion'  // 'eclosion', 'date_depot', 'client', 'quantite'
};

async function getDepotsHTML() {
    return `
        <div class="space-y-4">
            <div class="flex justify-between items-center">
                <h2 class="text-2xl font-bold">📦 Dépôts</h2>
                <button onclick="ouvrirModalNouveauDepot()" class="btn btn-primary">
                    <i class="fas fa-plus"></i> Nouveau dépôt
                </button>
            </div>

            <!-- Filtre multi-critères -->
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="card-title text-lg">
                            <i class="fas fa-filter"></i> Filtres avancés
                        </h3>
                        <div class="flex gap-2">
                            <button onclick="reinitialiserFiltres()" class="btn btn-sm btn-ghost">
                                <i class="fas fa-undo"></i> Réinitialiser
                            </button>
                            <button onclick="appliquerFiltres()" class="btn btn-sm btn-primary">
                                <i class="fas fa-search"></i> Rechercher
                            </button>
                        </div>
                    </div>
                    
                    <!-- Ligne 1 : Recherche texte + Statut -->
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div class="form-control">
                            <label class="label">
                                <span class="label-text">🔍 Recherche générale</span>
                            </label>
                            <input 
                                type="text" 
                                id="filtre-recherche" 
                                class="input input-bordered input-sm" 
                                placeholder="Client, téléphone, remarque..."
                                oninput="appliquerFiltres()"
                            >
                        </div>
                        <div class="form-control">
                            <label class="label">
                                <span class="label-text">📊 Statut</span>
                            </label>
                            <select id="filtre-statut" class="select select-bordered select-sm" onchange="appliquerFiltres()">
                                <option value="">Tous les statuts</option>
                                <option value="en_cours">En incubation</option>
                                <option value="eclos">Éclos</option>
                                <option value="echec">Échec</option>
                                <option value="annule">Annulé</option>
                            </select>
                        </div>
                        <div class="form-control">
                            <label class="label">
                                <span class="label-text">🧬 Race</span>
                            </label>
                            <select id="filtre-race" class="select select-bordered select-sm" onchange="appliquerFiltres()">
                                <option value="">Toutes les races</option>
                            </select>
                        </div>
                        <div class="form-control">
                            <label class="label">
                                <span class="label-text">📦 Palette</span>
                            </label>
                            <select id="filtre-palette" class="select select-bordered select-sm" onchange="appliquerFiltres()">
                                <option value="">Toutes les palettes</option>
                                <option value="sans">Sans palette</option>
                            </select>
                        </div>
                    </div>
                    
                    <!-- Ligne 2 : Dates + Jours restants -->
                    <div class="grid grid-cols-1 md:grid-cols-5 gap-4 mt-2">
                        <div class="form-control">
                            <label class="label">
                                <span class="label-text">📅 Dépôt du</span>
                            </label>
                            <input 
                                type="date" 
                                id="filtre-date-depot-debut" 
                                class="input input-bordered input-sm"
                                onchange="appliquerFiltres()"
                            >
                        </div>
                        <div class="form-control">
                            <label class="label">
                                <span class="label-text">📅 Au</span>
                            </label>
                            <input 
                                type="date" 
                                id="filtre-date-depot-fin" 
                                class="input input-bordered input-sm"
                                onchange="appliquerFiltres()"
                            >
                        </div>
                        <div class="form-control">
                            <label class="label">
                                <span class="label-text">🐣 Éclosion du</span>
                            </label>
                            <input 
                                type="date" 
                                id="filtre-date-eclo-debut" 
                                class="input input-bordered input-sm"
                                onchange="appliquerFiltres()"
                            >
                        </div>
                        <div class="form-control">
                            <label class="label">
                                <span class="label-text">🐣 Au</span>
                            </label>
                            <input 
                                type="date" 
                                id="filtre-date-eclo-fin" 
                                class="input input-bordered input-sm"
                                onchange="appliquerFiltres()"
                            >
                        </div>
                        <div class="form-control">
                            <label class="label">
                                <span class="label-text">⏰ Jours restants</span>
                            </label>
                            <select id="filtre-jours" class="select select-bordered select-sm" onchange="appliquerFiltres()">
                                <option value="">Tous</option>
                                <option value="critique">🚨 Critique (0-3 jours)</option>
                                <option value="bientot">⚠️ Bientôt (4-7 jours)</option>
                                <option value="normal">✅ Normal (8+ jours)</option>
                                <option value="depasse">⏰ Dépassé</option>
                            </select>
                        </div>
                    </div>

                    <!-- Filtres actifs -->
                    <div id="filtres-actifs" class="flex flex-wrap gap-2 mt-4 hidden">
                        <span class="text-sm text-gray-500">Filtres actifs :</span>
                        <div id="filtres-tags" class="flex flex-wrap gap-2"></div>
                    </div>
                </div>
            </div>

            <!-- Résultat du filtre -->
            <div id="filtre-info" class="alert alert-info hidden">
                <i class="fas fa-info-circle"></i>
                <span id="filtre-info-text"></span>
            </div>

            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <!-- Contrôles de tri et pagination -->
                    <div class="flex flex-wrap justify-between items-center gap-4 mb-4">
                        <div class="flex items-center gap-2">
                            <span class="text-sm">Trier par :</span>
                            <select id="tri-depots" class="select select-bordered select-sm" onchange="changerTri()">
                                <option value="eclosion">🐣 Éclosion proche → loin</option>
                                <option value="eclosion_desc">🐣 Éclosion loin → proche</option>
                                <option value="date_depot">📅 Dépôt récent</option>
                                <option value="date_depot_asc">📅 Dépôt ancien</option>
                                <option value="client">👤 Client A-Z</option>
                                <option value="quantite">📊 Quantité ↓</option>
                            </select>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-sm">Afficher :</span>
                            <select id="lignes-par-page" class="select select-bordered select-sm" onchange="changerLignesParPage()">
                                <option value="5">5 lignes</option>
                                <option value="10" selected>10 lignes</option>
                                <option value="25">25 lignes</option>
                                <option value="50">50 lignes</option>
                                <option value="100">100 lignes</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="overflow-x-auto">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Client</th>
                                    <th>Téléphone</th>
                                    <th>Race</th>
                                    <th>Palette</th>
                                    <th>Quantité</th>
                                    <th>Prix unit.</th>
                                    <th>Montant</th>
                                    <th>Date dépôt</th>
                                    <th>Éclosion prévue</th>
                                    <th>Jours restants</th>
                                    <th>Statut</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="depots-table"></tbody>
                        </table>
                    </div>
                    
                    <!-- Pagination -->
                    <div class="flex flex-wrap justify-between items-center mt-4 gap-2">
                        <div id="pagination-info" class="text-sm text-gray-500"></div>
                        <div class="join">
                            <button id="btn-premiere-page" class="join-item btn btn-sm" onclick="allerPage(1)" title="Début">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
                                </svg>
                            </button>
                            <button id="btn-page-precedente" class="join-item btn btn-sm" onclick="changerPage(-1)" title="Précédent">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                                </svg>
                            </button>
                            <span id="pagination-pages" class="join-item btn btn-sm btn-active"></span>
                            <button id="btn-page-suivante" class="join-item btn btn-sm" onclick="changerPage(1)" title="Suivant">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                                </svg>
                            </button>
                            <button id="btn-derniere-page" class="join-item btn btn-sm" onclick="allerPage(-1)" title="Fin">
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                                <path stroke-linecap="round" stroke-linejoin="round" d="m5.25 4.5 7.5 7.5-7.5 7.5m6-15 7.5 7.5-7.5 7.5" />
                              </svg>

                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function chargerDepots() {
    try {
        const response = await fetch(`${API_URL}/depots/`);
        const depots = await response.json();
        state.depots = depots;
        state.clients = await (await fetch(`${API_URL}/clients/`)).json();
        
        // Initialiser les filtres avec les données
        await initialiserFiltresDepots();
        
        afficherDepots(depots);

    } catch (error) {
        console.error('Erreur chargement dépôts:', error);
    }
}

// Fonction de tri des dépôts
function trierDepots(depots) {
    const typeTri = depotsPagination.tri;
    
    // Créer une copie pour ne pas modifier l'original
    let depotsTries = [...depots];
    
    switch(typeTri) {
        case 'eclosion': // Éclosion proche → loin (le plus proche d'abord)
            depotsTries.sort((a, b) => {
                // Les statuts non-en_cours à la fin
                if (a.statut !== 'en_cours' && b.statut === 'en_cours') return 1;
                if (a.statut === 'en_cours' && b.statut !== 'en_cours') return -1;
                // Ensuite par jours restants
                const ja = a.jours_restants ?? 999;
                const jb = b.jours_restants ?? 999;
                // Les valeurs négatives (dépassées) après les positives
                if (ja < 0 && jb >= 0) return 1;
                if (ja >= 0 && jb < 0) return -1;
                return ja - jb;
            });
            break;
            
        case 'eclosion_desc': // Éclosion loin → proche
            depotsTries.sort((a, b) => {
                if (a.statut !== 'en_cours' && b.statut === 'en_cours') return 1;
                if (a.statut === 'en_cours' && b.statut !== 'en_cours') return -1;
                const ja = a.jours_restants ?? -999;
                const jb = b.jours_restants ?? -999;
                return jb - ja;
            });
            break;
            
        case 'date_depot': // Dépôt récent
            depotsTries.sort((a, b) => new Date(b.date_heure_depôt) - new Date(a.date_heure_depôt));
            break;
            
        case 'date_depot_asc': // Dépôt ancien
            depotsTries.sort((a, b) => new Date(a.date_heure_depôt) - new Date(b.date_heure_depôt));
            break;
            
        case 'client': // Client A-Z
            depotsTries.sort((a, b) => (a.client_nom || '').localeCompare(b.client_nom || ''));
            break;
            
        case 'quantite': // Quantité décroissante
            depotsTries.sort((a, b) => (b.quantite_oeufs || 0) - (a.quantite_oeufs || 0));
            break;
    }
    
    return depotsTries;
}

// Fonction pour changer le tri
function changerTri() {
    depotsPagination.tri = document.getElementById('tri-depots').value;
    depotsPagination.page = 1;
    appliquerFiltres();
}

// Fonction pour changer le nombre de lignes par page
function changerLignesParPage() {
    depotsPagination.lignesParPage = parseInt(document.getElementById('lignes-par-page').value);
    depotsPagination.page = 1;
    appliquerFiltres();
}

// Fonction pour changer de page
function changerPage(delta) {
    const totalPages = Math.ceil(depotsPagination.total / depotsPagination.lignesParPage);
    depotsPagination.page = Math.max(1, Math.min(totalPages, depotsPagination.page + delta));
    appliquerFiltres();
}

// Fonction pour aller à une page spécifique
function allerPage(page) {
    const totalPages = Math.ceil(depotsPagination.total / depotsPagination.lignesParPage);
    if (page === -1) page = totalPages; // -1 = dernière page
    depotsPagination.page = Math.max(1, Math.min(totalPages, page));
    appliquerFiltres();
}

// Fonction pour mettre à jour les contrôles de pagination
function updatePaginationControls(totalItems) {
    depotsPagination.total = totalItems;
    
    const totalPages = Math.ceil(totalItems / depotsPagination.lignesParPage);
    const currentPage = depotsPagination.page;
    
    // Info pagination
    const infoEl = document.getElementById('pagination-info');
    if (infoEl) {
        const start = Math.min((currentPage - 1) * depotsPagination.lignesParPage + 1, totalItems);
        const end = Math.min(currentPage * depotsPagination.lignesParPage, totalItems);
        infoEl.textContent = 
            `Affichage ${start}-${end} sur ${totalItems} dépôt(s) — Page ${currentPage}/${totalPages || 1}`;
    }
    
    // Boutons
    const btnPremiere = document.getElementById('btn-premiere-page');
    const btnPrecedente = document.getElementById('btn-page-precedente');
    const btnSuivante = document.getElementById('btn-page-suivante');
    const btnDerniere = document.getElementById('btn-derniere-page');

    if (btnPremiere) {
        btnPremiere.disabled = currentPage === 1;
    }
    if (btnPrecedente) {
        btnPrecedente.disabled = currentPage === 1;
    }
    if (btnSuivante) {
        btnSuivante.disabled = currentPage >= totalPages;
    }
    if (btnDerniere) {
        btnDerniere.disabled = currentPage >= totalPages;
    }
    
    // Numéro de page
    const pagesEl = document.getElementById('pagination-pages');
    if (pagesEl) {
        pagesEl.textContent = `${currentPage} / ${totalPages || 1}`;
    }
}

function afficherDepots(depots) {
    const tbody = document.getElementById('depots-table');
    if (!depots || depots.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="text-center text-gray-500">Aucun dépôt trouvé</td></tr>';
        updatePaginationControls(0); // Toujours mettre à jour les contrôles, même s'il n'y a pas de dépôts
        return;
    }

    // Appliquer le tri
    const depotsTries = trierDepots(depots);
    
    // Calculer la pagination
    const total = depotsTries.length;
    const start = (depotsPagination.page - 1) * depotsPagination.lignesParPage;
    const end = start + depotsPagination.lignesParPage;
    const depotsPagines = depotsTries.slice(start, end);
    
    // Mettre à jour les contrôles
    updatePaginationControls(total);

    tbody.innerHTML = depotsPagines.map(depot => {
        // Trouver le téléphone du client
        const client = state.clients.find(c => c.id === depot.client);
        const telephone = client ? client.telephone : 'N/A';

        return `
            <tr>
                <td>${depot.client_nom} ${depot.client_prenom || ''}</td>
                <td class="font-mono">${telephone}</td>
                <td>${depot.race_nom} <span class="text-xs opacity-70">(${depot.categorie_nom})</span></td>
                <td>${depot.palette_numero ? `<span class="badge badge-primary">P${depot.palette_numero}</span>` : '-'}</td>
                <td>${depot.quantite_oeufs}</td>
                <td>${depot.prix_unitaire} FCFA</td>
                <td>${depot.montant_percu} FCFA</td>
                <td>${formatDate(depot.date_heure_depôt)}</td>
                <td>${formatDate(depot.date_eclosion_prevue)}</td>
                <td>${getJoursRestantsBadge(depot)}</td>
                <td><span class="badge badge-${getStatutColor(depot.statut)}">${depot.statut}</span></td>
                <td>
                    <button onclick="voirDepot(${depot.id})" class="btn btn-ghost btn-xs" data-tip="Voir">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button onclick="verifierPinEtModifier(${depot.id})" class="btn btn-ghost btn-xs" data-tip="Modifier">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="definirAlertePerso(${depot.id})" class="btn btn-ghost btn-xs text-info" data-tip="Définir alerte">
                        <i class="fas fa-bell"></i>
                    </button>
                    <button onclick="verifierPinEtSupprimer(${depot.id})" class="btn btn-ghost btn-xs text-error" data-tip="Supprimer">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// ==================== FILTRES AVANCÉS DÉPÔTS ====================

// Initialiser les filtres au chargement
async function initialiserFiltresDepots() {
    // Charger les races pour le filtre
    try {
        const response = await fetch(`${API_URL}/races/`);
        const races = await response.json();
        const selectRace = document.getElementById('filtre-race');
        if (selectRace) {
            selectRace.innerHTML = '<option value="">Toutes les races</option>' + 
                races.map(r => `<option value="${r.id}">${r.categorie_nom} - ${r.nom}</option>`).join('');
        }
        
        // Charger les palettes pour le filtre
        const palResponse = await fetch(`${API_URL}/palettes/`);
        const palettes = await palResponse.json();
        const selectPalette = document.getElementById('filtre-palette');
        if (selectPalette) {
            selectPalette.innerHTML = '<option value="">Toutes les palettes</option>' +
                '<option value="sans">Sans palette</option>' +
                palettes.map(p => `<option value="${p.id}">Palette ${p.numero}</option>`).join('');
        }
    } catch (error) {
        console.error('Erreur initialisation filtres:', error);
    }
}

// Appliquer tous les filtres
function appliquerFiltres() {
    const recherche = document.getElementById('filtre-recherche')?.value.toLowerCase().trim() || '';
    const statut = document.getElementById('filtre-statut')?.value || '';
    const raceId = document.getElementById('filtre-race')?.value || '';
    const paletteId = document.getElementById('filtre-palette')?.value || '';
    const dateDepotDebut = document.getElementById('filtre-date-depot-debut')?.value || '';
    const dateDepotFin = document.getElementById('filtre-date-depot-fin')?.value || '';
    const dateEcloDebut = document.getElementById('filtre-date-eclo-debut')?.value || '';
    const dateEcloFin = document.getElementById('filtre-date-eclo-fin')?.value || '';
    const joursFiltre = document.getElementById('filtre-jours')?.value || '';

    // Filtrer les dépôts
    let depotsFiltres = [...state.depots];
    const filtresActifs = [];

    // Filtre recherche générale (client, téléphone, remarque, race)
    if (recherche) {
        depotsFiltres = depotsFiltres.filter(depot => {
            const client = state.clients.find(c => c.id === depot.client);
            const matchClient = (depot.client_nom || '').toLowerCase().includes(recherche);
            const matchTel = client && (
                (client.telephone || '').replace(/[\s.-]/g, '').includes(recherche.replace(/[\s.-]/g, '')) ||
                (client.telephone_2 || '').replace(/[\s.-]/g, '').includes(recherche.replace(/[\s.-]/g, ''))
            );
            const matchRace = (depot.race_nom || '').toLowerCase().includes(recherche);
            const matchRemarque = (depot.remarque || '').toLowerCase().includes(recherche);
            const matchPalette = depot.palette_numero && `palette ${depot.palette_numero}`.includes(recherche);
            
            return matchClient || matchTel || matchRace || matchRemarque || matchPalette;
        });
        filtresActifs.push({ label: 'Recherche', value: recherche, icon: 'search' });
    }

    // Filtre statut
    if (statut) {
        depotsFiltres = depotsFiltres.filter(d => d.statut === statut);
        const statutLabels = { en_cours: 'En incubation', eclos: 'Éclos', echec: 'Échec', annule: 'Annulé' };
        filtresActifs.push({ label: 'Statut', value: statutLabels[statut] || statut, icon: 'chart-bar' });
    }

    // Filtre race
    if (raceId) {
        depotsFiltres = depotsFiltres.filter(d => d.race == raceId);
        const raceSelect = document.getElementById('filtre-race');
        const raceNom = raceSelect.options[raceSelect.selectedIndex]?.text || raceId;
        filtresActifs.push({ label: 'Race', value: raceNom, icon: 'dna' });
    }

    // Filtre palette
    if (paletteId) {
        if (paletteId === 'sans') {
            depotsFiltres = depotsFiltres.filter(d => !d.palette_numero);
            filtresActifs.push({ label: 'Palette', value: 'Sans palette', icon: 'box' });
        } else {
            depotsFiltres = depotsFiltres.filter(d => d.palette == paletteId);
            const paletteSelect = document.getElementById('filtre-palette');
            const paletteNom = paletteSelect.options[paletteSelect.selectedIndex]?.text || paletteId;
            filtresActifs.push({ label: 'Palette', value: paletteNom, icon: 'box' });
        }
    }

    // Filtre date dépôt
    if (dateDepotDebut) {
        depotsFiltres = depotsFiltres.filter(d => {
            const dateDepot = new Date(d.date_heure_depôt).toISOString().split('T')[0];
            return dateDepot >= dateDepotDebut;
        });
        filtresActifs.push({ label: 'Dépôt du', value: formatDateCourt(dateDepotDebut), icon: 'calendar' });
    }
    if (dateDepotFin) {
        depotsFiltres = depotsFiltres.filter(d => {
            const dateDepot = new Date(d.date_heure_depôt).toISOString().split('T')[0];
            return dateDepot <= dateDepotFin;
        });
        filtresActifs.push({ label: 'Dépôt au', value: formatDateCourt(dateDepotFin), icon: 'calendar' });
    }

    // Filtre date éclosion
    if (dateEcloDebut) {
        depotsFiltres = depotsFiltres.filter(d => d.date_eclosion_prevue >= dateEcloDebut);
        filtresActifs.push({ label: 'Éclosion du', value: formatDateCourt(dateEcloDebut), icon: 'egg' });
    }
    if (dateEcloFin) {
        depotsFiltres = depotsFiltres.filter(d => d.date_eclosion_prevue <= dateEcloFin);
        filtresActifs.push({ label: 'Éclosion au', value: formatDateCourt(dateEcloFin), icon: 'egg' });
    }

    // Filtre jours restants
    if (joursFiltre) {
        const aujourdHui = new Date();
        aujourdHui.setHours(0, 0, 0, 0);
        
        depotsFiltres = depotsFiltres.filter(d => {
            if (!d.date_eclosion_prevue) return false;
            const dateEclo = new Date(d.date_eclosion_prevue);
            dateEclo.setHours(0, 0, 0, 0);
            const diffDays = Math.ceil((dateEclo - aujourdHui) / (1000 * 60 * 60 * 24));
            
            switch (joursFiltre) {
                case 'critique': return diffDays >= 0 && diffDays <= 3;
                case 'bientot': return diffDays >= 4 && diffDays <= 7;
                case 'normal': return diffDays >= 8;
                case 'depasse': return diffDays < 0;
                default: return true;
            }
        });
        
        const joursLabels = { 
            critique: 'Critique (0-3j)', 
            bientot: 'Bientôt (4-7j)', 
            normal: 'Normal (8j+)', 
            depasse: 'Dépassé' 
        };
        filtresActifs.push({ label: 'Délai', value: joursLabels[joursFiltre], icon: 'clock' });
    }

    // Afficher les filtres actifs
    afficherFiltresActifs(filtresActifs);

    // Afficher le résultat
    const infoDiv = document.getElementById('filtre-info');
    const infoText = document.getElementById('filtre-info-text');
    
    if (depotsFiltres.length === 0) {
        infoDiv.className = 'alert alert-warning';
        infoText.textContent = `Aucun dépôt trouvé avec ces critères`;
        infoDiv.classList.remove('hidden');
    } else if (filtresActifs.length > 0) {
        infoDiv.className = 'alert alert-info';
        infoText.textContent = `${depotsFiltres.length} dépôt(s) trouvé(s) sur ${state.depots.length}`;
        infoDiv.classList.remove('hidden');
    } else {
        infoDiv.classList.add('hidden');
    }

    afficherDepots(depotsFiltres);
}

// Afficher les tags de filtres actifs
function afficherFiltresActifs(filtres) {
    const container = document.getElementById('filtres-actifs');
    const tagsContainer = document.getElementById('filtres-tags');
    
    if (!container || !tagsContainer) return;
    
    if (filtres.length === 0) {
        container.classList.add('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    tagsContainer.innerHTML = filtres.map((f, i) => `
        <div class="badge badge-primary gap-1">
            <i class="fas fa-${f.icon}"></i>
            <strong>${f.label}:</strong> ${f.value}
            <button onclick="supprimerFiltre(${i})" class="btn btn-ghost btn-xs">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

// Supprimer un filtre spécifique
function supprimerFiltre(index) {
    const filtres = ['filtre-recherche', 'filtre-statut', 'filtre-race', 'filtre-palette', 
                     'filtre-date-depot-debut', 'filtre-date-depot-fin', 
                     'filtre-date-eclo-debut', 'filtre-date-eclo-fin', 'filtre-jours'];
    
    // Mapper l'index aux champs
    const mapping = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    if (mapping[index] !== undefined) {
        const champ = document.getElementById(filtres[mapping[index]]);
        if (champ) champ.value = '';
    }
    
    appliquerFiltres();
}

// Réinitialiser tous les filtres
function reinitialiserFiltres() {
    const filtres = ['filtre-recherche', 'filtre-statut', 'filtre-race', 'filtre-palette', 
                     'filtre-date-depot-debut', 'filtre-date-depot-fin', 
                     'filtre-date-eclo-debut', 'filtre-date-eclo-fin', 'filtre-jours'];
    
    filtres.forEach(id => {
        const champ = document.getElementById(id);
        if (champ) champ.value = '';
    });
    
    appliquerFiltres();
}

// Formater une date au format court
function formatDateCourt(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function ouvrirModalNouveauDepot() {
    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');
    
    content.innerHTML = `
        <h3 class="text-xl font-bold mb-4">📦 Nouveau dépôt</h3>
        <form id="form-depot" class="space-y-4">
            <div class="form-control">
                <label class="label">Client *</label>
                <select id="depot-client" class="select select-bordered" required></select>
            </div>
            <div class="form-control">
                <label class="label">Race *</label>
                <select id="depot-race" class="select select-bordered" required></select>
            </div>
            <div class="form-control">
                <label class="label">Palette *</label>
                <select id="depot-palette" class="select select-bordered" required>
                    <option value="">-- Sélectionner une palette --</option>
                </select>
                <label class="label">
                    <span class="label-text-alt">Seules les palettes disponibles sont affichées</span>
                </label>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="form-control">
                    <label class="label">Quantité d'œufs *</label>
                    <input type="number" id="depot-quantite" class="input input-bordered" min="1" required>
                </div>
                <div class="form-control">
                    <label class="label">Prix unitaire (FCFA) *</label>
                    <input type="number" id="depot-prix" class="input input-bordered" min="0" step="0.01" required>
                </div>
            </div>
            <div class="form-control">
                <label class="label">Date et heure du dépôt *</label>
                <input type="datetime-local" id="depot-date" class="input input-bordered" required>
            </div>
            <div class="form-control">
                <label class="label">Remarque</label>
                <textarea id="depot-remarque" class="textarea textarea-bordered" rows="3"></textarea>
            </div>
            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Annuler</button>
                <button type="submit" class="btn btn-primary">Enregistrer</button>
            </div>
        </form>
    `;

    modal.showModal();

    // Charger les clients, races et palettes
    chargerSelectClients();
    chargerSelectRaces();
    chargerSelectPalettes();

    // Définir la date par défaut
    document.getElementById('depot-date').value = new Date().toISOString().slice(0, 16);

    // Gérer la soumission
    document.getElementById('form-depot').addEventListener('submit', async (e) => {
        e.preventDefault();
        await enregistrerDepot();
    });
}

async function chargerSelectClients() {
    const response = await fetch(`${API_URL}/clients/`);
    const clients = await response.json();
    const select = document.getElementById('depot-client');
    select.innerHTML = clients.map(c => 
        `<option value="${c.id}">${c.nom} ${c.prenom} (${c.telephone})</option>`
    ).join('');
}

async function chargerSelectRaces() {
    const response = await fetch(`${API_URL}/races/`);
    const races = await response.json();
    const select = document.getElementById('depot-race');
    select.innerHTML = races.map(r =>
        `<option value="${r.id}">${r.categorie_nom} - ${r.nom}</option>`
    ).join('');
}

async function chargerSelectPalettes() {
    const response = await fetch(`${API_URL}/palettes/`);
    const palettes = await response.json();
    const select = document.getElementById('depot-palette');
    
    if (palettes.length === 0) {
        select.innerHTML = '<option value="">Aucune palette configurée</option>';
    } else {
        select.innerHTML = '<option value="">-- Sélectionner une palette --</option>' + 
            palettes.map(p =>
                `<option value="${p.id}">Palette ${p.numero} (${p.depots_en_cours} dépôt(s), ${p.total_oeufs} œuf(s))</option>`
            ).join('');
    }
}

async function enregistrerDepot() {
    const data = {
        client: parseInt(document.getElementById('depot-client').value),
        race: parseInt(document.getElementById('depot-race').value),
        palette: parseInt(document.getElementById('depot-palette').value) || null,
        quantite_oeufs: parseInt(document.getElementById('depot-quantite').value),
        prix_unitaire: parseFloat(document.getElementById('depot-prix').value),
        date_heure_depôt: document.getElementById('depot-date').value,
        remarque: document.getElementById('depot-remarque').value
    };

    try {
        const response = await fetch(`${API_URL}/depots/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            document.getElementById('modal-universel').close();
            chargerPage('depots');
            afficherNotification('✅ Dépôt enregistré avec succès !', 'success');
        } else {
            afficherNotification('❌ Erreur lors de l\'enregistrement', 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

// Voir un dépôt
async function voirDepot(id) {
    try {
        const response = await fetch(`${API_URL}/depots/${id}/`);
        const depot = await response.json();
        
        const modal = document.getElementById('modal-universel');
        const content = document.getElementById('modal-content');
        
        content.innerHTML = `
            <h3 class="text-xl font-bold mb-4">📦 Détails du dépôt</h3>
            <div class="space-y-3">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <p class="text-sm text-gray-500">Client</p>
                        <p class="font-semibold">${depot.client_nom} ${depot.client_prenom || ''}</p>
                    </div>
                    <div>
                        <p class="text-sm text-gray-500">Race</p>
                        <p class="font-semibold">${depot.race_nom} (${depot.categorie_nom})</p>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <p class="text-sm text-gray-500">Palette</p>
                        <p class="font-semibold text-lg">${depot.palette_numero ? `Palette ${depot.palette_numero}` : 'Non assignée'}</p>
                    </div>
                    <div>
                        <p class="text-sm text-gray-500">Quantité d'œufs</p>
                        <p class="font-semibold text-lg">${depot.quantite_oeufs}</p>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <p class="text-sm text-gray-500">Prix unitaire</p>
                        <p class="font-semibold">${depot.prix_unitaire} FCFA</p>
                    </div>
                    <div>
                        <p class="text-sm text-gray-500">Montant perçu</p>
                        <p class="font-semibold text-lg text-primary">${depot.montant_percu} FCFA</p>
                    </div>
                </div>
                <div>
                    <p class="text-sm text-gray-500">Statut</p>
                    <span class="badge badge-${getStatutColor(depot.statut)}">${depot.statut}</span>
                </div>
                <div class="divider"></div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <p class="text-sm text-gray-500">Date de dépôt</p>
                        <p class="font-semibold">${formatDate(depot.date_heure_depôt)}</p>
                    </div>
                    <div>
                        <p class="text-sm text-gray-500">Éclosion prévue</p>
                        <p class="font-semibold">${formatDate(depot.date_eclosion_prevue)}</p>
                    </div>
                </div>
                <div>
                    <p class="text-sm text-gray-500">Jours restants</p>
                    ${getJoursRestantsBadge(depot)}
                </div>
                ${depot.remarque ? `
                <div>
                    <p class="text-sm text-gray-500">Remarque</p>
                    <p class="text-gray-700">${depot.remarque}</p>
                </div>
                ` : ''}
                <div class="divider"></div>
                <div>
                    <p class="text-sm text-gray-500">⏰ Alerte personnalisée</p>
                    ${depot.alerte_perso_active && depot.alerte_perso_date ? `
                        <div class="alert alert-info py-2 mt-2">
                            <i class="fas fa-clock"></i>
                            <div>
                                <p class="font-semibold">Activée — ${formatDate(depot.alerte_perso_date)}</p>
                                ${depot.alerte_perso_message ? `<p class="text-sm">${depot.alerte_perso_message}</p>` : ''}
                            </div>
                        </div>
                    ` : '<p class="text-gray-400 italic text-sm">Aucune alerte personnalisée définie</p>'}
                </div>
            </div>
            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Fermer</button>
                <button type="button" class="btn btn-info" onclick="definirAlertePerso(${depot.id})">
                    <i class="fas fa-bell"></i> ${depot.alerte_perso_active ? 'Modifier alerte' : 'Définir alerte'}
                </button>
                <button type="button" class="btn btn-primary" onclick="verifierPinEtModifier(${depot.id})">
                    <i class="fas fa-edit"></i> Modifier
                </button>
                <button type="button" class="btn btn-error" onclick="verifierPinEtSupprimer(${depot.id})">
                    <i class="fas fa-trash"></i> Supprimer
                </button>
            </div>
        `;
        
        modal.showModal();
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de chargement', 'error');
    }
}

// Modifier un dépôt
async function modifierDepot(id) {
    try {
        const response = await fetch(`${API_URL}/depots/${id}/`);
        const depot = await response.json();

        // Fermer le modal précédent si ouvert
        document.getElementById('modal-universel').close();

        const modal = document.getElementById('modal-universel');
        const content = document.getElementById('modal-content');

        // Formater la date pour le champ datetime-local
        const dateLocale = new Date(depot.date_heure_depôt);
        const dateInput = dateLocale.getFullYear() + '-' +
            String(dateLocale.getMonth() + 1).padStart(2, '0') + '-' +
            String(dateLocale.getDate()).padStart(2, '0') + 'T' +
            String(dateLocale.getHours()).padStart(2, '0') + ':' +
            String(dateLocale.getMinutes()).padStart(2, '0');

        content.innerHTML = `
            <h3 class="text-xl font-bold mb-4">✏️ Modifier le dépôt</h3>
            <form id="form-modifier-depot" class="space-y-4">
                <div class="form-control">
                    <label class="label">Client *</label>
                    <select id="modif-depot-client" class="select select-bordered" required></select>
                </div>
                <div class="form-control">
                    <label class="label">Race *</label>
                    <select id="modif-depot-race" class="select select-bordered" required></select>
                </div>
                <div class="form-control">
                    <label class="label">Palette *</label>
                    <select id="modif-depot-palette" class="select select-bordered" required>
                        <option value="">-- Sélectionner une palette --</option>
                    </select>
                    <label class="label">
                        <span class="label-text-alt">Changer de palette déplacera les œufs vers une autre palette</span>
                    </label>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div class="form-control">
                        <label class="label">Quantité d'œufs *</label>
                        <input type="number" id="modif-depot-quantite" class="input input-bordered" min="1" required>
                    </div>
                    <div class="form-control">
                        <label class="label">Prix unitaire (FCFA) *</label>
                        <input type="number" id="modif-depot-prix" class="input input-bordered" min="0" step="0.01" required>
                    </div>
                </div>
                <div class="form-control">
                    <label class="label">Date et heure du dépôt *</label>
                    <input type="datetime-local" id="modif-depot-date" class="input input-bordered" required>
                </div>
                <div class="form-control">
                    <label class="label">Statut</label>
                    <select id="modif-depot-statut" class="select select-bordered">
                        <option value="en_cours">En incubation</option>
                        <option value="eclos">Éclos</option>
                        <option value="echec">Échec</option>
                        <option value="annule">Annulé</option>
                    </select>
                </div>
                <div class="form-control">
                    <label class="label">Remarque</label>
                    <textarea id="modif-depot-remarque" class="textarea textarea-bordered" rows="3"></textarea>
                </div>
                <div class="modal-action">
                    <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Annuler</button>
                    <button type="submit" class="btn btn-primary">Enregistrer les modifications</button>
                </div>
            </form>
        `;

        modal.showModal();

        // Charger les clients, races et palettes
        await chargerSelectModifClients();
        await chargerSelectModifRaces();
        await chargerSelectModifPalettes();

        // Pré-remplir les champs avec les données existantes
        document.getElementById('modif-depot-client').value = depot.client;
        document.getElementById('modif-depot-race').value = depot.race;
        document.getElementById('modif-depot-palette').value = depot.palette || '';
        document.getElementById('modif-depot-quantite').value = depot.quantite_oeufs;
        document.getElementById('modif-depot-prix').value = depot.prix_unitaire;
        document.getElementById('modif-depot-date').value = dateInput;
        document.getElementById('modif-depot-statut').value = depot.statut;
        document.getElementById('modif-depot-remarque').value = depot.remarque || '';

        // Gérer la soumission
        document.getElementById('form-modifier-depot').addEventListener('submit', async (e) => {
            e.preventDefault();
            await enregistrerModificationDepot(id);
        });

    } catch (error) {
        console.error('Erreur chargement dépôt:', error);
        afficherNotification('❌ Erreur de chargement du dépôt', 'error');
    }
}

async function chargerSelectModifClients() {
    const response = await fetch(`${API_URL}/clients/`);
    const clients = await response.json();
    const select = document.getElementById('modif-depot-client');
    select.innerHTML = clients.map(c =>
        `<option value="${c.id}">${c.nom} ${c.prenom} (${c.telephone})</option>`
    ).join('');
}

async function chargerSelectModifRaces() {
    const response = await fetch(`${API_URL}/races/`);
    const races = await response.json();
    const select = document.getElementById('modif-depot-race');
    select.innerHTML = races.map(r =>
        `<option value="${r.id}">${r.categorie_nom} - ${r.nom}</option>`
    ).join('');
}

async function chargerSelectModifPalettes() {
    const response = await fetch(`${API_URL}/palettes/`);
    const palettes = await response.json();
    const select = document.getElementById('modif-depot-palette');
    select.innerHTML = '<option value="">-- Sélectionner une palette --</option>' +
        palettes.map(p =>
            `<option value="${p.id}">Palette ${p.numero} (${p.depots_en_cours} dépôt(s), ${p.total_oeufs} œuf(s))</option>`
        ).join('');
}

async function enregistrerModificationDepot(id) {
    const data = {
        client: parseInt(document.getElementById('modif-depot-client').value),
        race: parseInt(document.getElementById('modif-depot-race').value),
        palette: parseInt(document.getElementById('modif-depot-palette').value) || null,
        quantite_oeufs: parseInt(document.getElementById('modif-depot-quantite').value),
        prix_unitaire: parseFloat(document.getElementById('modif-depot-prix').value),
        date_heure_depôt: document.getElementById('modif-depot-date').value,
        statut: document.getElementById('modif-depot-statut').value,
        remarque: document.getElementById('modif-depot-remarque').value
    };

    try {
        const response = await fetch(`${API_URL}/depots/${id}/`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            document.getElementById('modal-universel').close();
            chargerPage('depots');
            afficherNotification('✅ Dépôt modifié avec succès !', 'success');
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur: ' + JSON.stringify(error), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

// Supprimer un dépôt
async function supprimerDepot(id) {
    // Récupérer les infos du dépôt pour la confirmation
    try {
        const depot = state.depots.find(d => d.id === id);
        if (!depot) {
            afficherNotification('❌ Dépôt non trouvé', 'error');
            return;
        }

        const message = `⚠️ Êtes-vous sûr de vouloir supprimer ce dépôt ?

Client : ${depot.client_nom}
Race : ${depot.race_nom}
Palette : ${depot.palette_numero ? 'Palette ' + depot.palette_numero : 'Non assignée'}
Quantité : ${depot.quantite_oeufs} œufs

Cette action est irréversible.`;

        const confirme = await afficherConfirmation('Supprimer ce dépôt ?', message);
        if (!confirme) {
            return;
        }

        const response = await fetch(`${API_URL}/depots/${id}/`, {
            method: 'DELETE'
        });

        if (response.ok) {
            chargerPage('depots');
            afficherNotification('✅ Dépôt supprimé avec succès !', 'success');
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur lors de la suppression: ' + JSON.stringify(error), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

// ==================== ALERTE PERSONNALISÉE ====================

async function definirAlertePerso(id) {
    try {
        const response = await fetch(`${API_URL}/depots/${id}/`);
        const depot = await response.json();

        // Fermer le modal précédent si ouvert
        document.getElementById('modal-universel').close();

        const modal = document.getElementById('modal-universel');
        const content = document.getElementById('modal-content');

        // Calculer la date d'éclosion pour proposer des suggestions
        const dateEclosion = depot.date_eclosion_prevue ? new Date(depot.date_eclosion_prevue) : null;

        // Date par défaut : utiliser la date existante si elle est configurée, sinon J-1 ou maintenant + 1h
        let dateDefaut = new Date();
        
        if (depot.alerte_perso_date) {
            // Utiliser la date existante de l'alerte personnalisée
            dateDefaut = new Date(depot.alerte_perso_date);
        } else if (dateEclosion) {
            dateDefaut = new Date(dateEclosion);
            dateDefaut.setDate(dateDefaut.getDate() - 1); // J-1 par défaut
        } else {
            dateDefaut.setHours(dateDefaut.getHours() + 1);
        }

        const dateInput = dateDefaut.getFullYear() + '-' +
            String(dateDefaut.getMonth() + 1).padStart(2, '0') + '-' +
            String(dateDefaut.getDate()).padStart(2, '0') + 'T' +
            String(dateDefaut.getHours()).padStart(2, '0') + ':' +
            String(dateDefaut.getMinutes()).padStart(2, '0');

        const messageDefaut = depot.alerte_perso_message || '';
        const activeCheck = depot.alerte_perso_active ? 'checked' : '';

        content.innerHTML = `
            <h3 class="text-xl font-bold mb-2">
                <i class="fas fa-bell text-info"></i> Alerte personnalisée
            </h3>
            <div class="alert alert-info mb-4">
                <i class="fas fa-info-circle"></i>
                <div>
                    <p class="font-semibold">${depot.client_nom} — ${depot.race_nom}</p>
                    <p class="text-sm">Éclosion prévue : ${depot.date_eclosion_prevue ? new Date(depot.date_eclosion_prevue).toLocaleDateString('fr-FR') : 'Non définie'}</p>
                </div>
            </div>

            <form id="form-alerte-perso" class="space-y-4">
                <div class="form-control">
                    <label class="label cursor-pointer">
                        <span class="label-text font-semibold">⏰ Activer cette alerte</span>
                        <input type="checkbox" id="alerte-perso-active" class="toggle toggle-info" ${activeCheck}>
                    </label>
                </div>

                <div class="form-control">
                    <label class="label">
                        <span class="label-text font-semibold">📅 Date et heure de l'alerte *</span>
                    </label>
                    <input type="datetime-local" id="alerte-perso-date" class="input input-bordered" value="${dateInput}" required>
                </div>

                <div class="form-control">
                    <label class="label">
                        <span class="label-text font-semibold">💬 Message de l'alerte</span>
                    </label>
                    <textarea id="alerte-perso-message" class="textarea textarea-bordered" rows="2"
                        placeholder="Ex: Préparer le matériel d'éclosion, appeler le client...">${messageDefaut}</textarea>
                    <label class="label">
                        <span class="label-text-alt">Ce message s'affichera dans la cloche de notification</span>
                    </label>
                </div>

                <!-- Suggestions rapides -->
                <div class="form-control">
                    <label class="label">
                        <span class="label-text font-semibold">⚡ Suggestions rapides</span>
                    </label>
                    <div class="flex flex-wrap gap-2">
                        <button type="button" onclick="appliquerSuggestionAlerte(${id}, 'j1')" class="btn btn-sm btn-outline">
                            <i class="fas fa-calendar-day"></i> 1 jour avant
                        </button>
                        <button type="button" onclick="appliquerSuggestionAlerte(${id}, 'h12')" class="btn btn-sm btn-outline">
                            <i class="fas fa-clock"></i> 12h avant
                        </button>
                        <button type="button" onclick="appliquerSuggestionAlerte(${id}, 'h1')" class="btn btn-sm btn-outline">
                            <i class="fas fa-hourglass-start"></i> 1h avant
                        </button>
                        <button type="button" onclick="appliquerSuggestionAlerte(${id}, 'min30')" class="btn btn-sm btn-outline">
                            <i class="fas fa-stopwatch"></i> 30 min avant
                        </button>
                    </div>
                </div>

                <div class="modal-action">
                    <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Annuler</button>
                    ${depot.alerte_perso_active ? `
                        <button type="button" onclick="desactiverAlertePerso(${id})" class="btn btn-warning">
                            <i class="fas fa-bell-slash"></i> Désactiver
                        </button>
                    ` : ''}
                    <button type="submit" class="btn btn-info">
                        <i class="fas fa-save"></i> Enregistrer
                    </button>
                </div>
            </form>
        `;

        modal.showModal();

        document.getElementById('form-alerte-perso').addEventListener('submit', async (e) => {
            e.preventDefault();
            await enregistrerAlertePerso(id);
        });

    } catch (error) {
        console.error('Erreur chargement dépôt:', error);
        afficherNotification('❌ Erreur de chargement', 'error');
    }
}

function appliquerSuggestionAlerte(id, type) {
    const depot = state.depots.find(d => d.id === id);
    if (!depot || !depot.date_eclosion_prevue) {
        afficherNotification('❌ Date d\'éclosion non définie', 'error');
        return;
    }

    const dateEclosion = new Date(depot.date_eclosion_prevue);
    let dateAlerte = new Date(dateEclosion);

    switch(type) {
        case 'j1':
            dateAlerte.setDate(dateAlerte.getDate() - 1);
            break;
        case 'h12':
            dateAlerte.setHours(dateAlerte.getHours() - 12);
            break;
        case 'h1':
            dateAlerte.setHours(dateAlerte.getHours() - 1);
            break;
        case 'min30':
            dateAlerte.setMinutes(dateAlerte.getMinutes() - 30);
            break;
    }

    const dateInput = dateAlerte.getFullYear() + '-' +
        String(dateAlerte.getMonth() + 1).padStart(2, '0') + '-' +
        String(dateAlerte.getDate()).padStart(2, '0') + 'T' +
        String(dateAlerte.getHours()).padStart(2, '0') + ':' +
        String(dateAlerte.getMinutes()).padStart(2, '0');

    document.getElementById('alerte-perso-date').value = dateInput;
    document.getElementById('alerte-perso-active').checked = true;
}

async function enregistrerAlertePerso(id) {
    const active = document.getElementById('alerte-perso-active').checked;
    const dateAlerte = document.getElementById('alerte-perso-date').value;
    const message = document.getElementById('alerte-perso-message').value;

    if (active && !dateAlerte) {
        afficherNotification('❌ La date est obligatoire', 'error');
        return;
    }

    let alertePersoDate = null;
    if (active && dateAlerte) {
        // Interpréter la date saisie comme UTC/GMT, pas comme heure locale
        alertePersoDate = new Date(`${dateAlerte}Z`).toISOString();
    }

    const data = {
        alerte_perso_active: active,
        alerte_perso_date: alertePersoDate,
        alerte_perso_message: message
    };

    try {
        const response = await fetch(`${API_URL}/depots/${id}/`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (response.ok) {
            document.getElementById('modal-universel').close();
            chargerPage('depots');
            afficherNotification('✅ Alerte personnalisée enregistrée !', 'success');
        } else {
            afficherNotification('❌ Erreur: ' + JSON.stringify(result), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

async function desactiverAlertePerso(id) {
    try {
        const response = await fetch(`${API_URL}/depots/${id}/`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                alerte_perso_active: false,
                alerte_perso_date: null,
                alerte_perso_message: ''
            })
        });

        if (response.ok) {
            document.getElementById('modal-universel').close();
            chargerPage('depots');
            afficherNotification('✅ Alerte personnalisée désactivée', 'success');
        } else {
            afficherNotification('❌ Erreur lors de la désactivation', 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

// Voir un client
async function voirClient(id) {
    try {
        const response = await fetch(`${API_URL}/clients/${id}/`);
        const client = await response.json();
        
        const modal = document.getElementById('modal-universel');
        const content = document.getElementById('modal-content');
        
        content.innerHTML = `
            <h3 class="text-xl font-bold mb-4">👥 Détails du client</h3>
            <div class="space-y-3">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <p class="text-sm text-gray-500">Nom</p>
                        <p class="font-semibold">${client.nom}</p>
                    </div>
                    <div>
                        <p class="text-sm text-gray-500">Prénom</p>
                        <p class="font-semibold">${client.prenom || '-'}</p>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <p class="text-sm text-gray-500">Téléphone</p>
                        <p class="font-semibold">${client.telephone}</p>
                    </div>
                    <div>
                        <p class="text-sm text-gray-500">Téléphone 2</p>
                        <p class="font-semibold">${client.telephone_2 || '-'}</p>
                    </div>
                </div>
                <div>
                    <p class="text-sm text-gray-500">Chat ID Telegram</p>
                    <p class="font-semibold">${client.telegram_chat_id || '-'}</p>
                </div>
                <div>
                    <p class="text-sm text-gray-500">Email</p>
                    <p class="font-semibold">${client.email || '-'}</p>
                </div>
                ${client.adresse ? `
                <div>
                    <p class="text-sm text-gray-500">Adresse</p>
                    <p class="text-gray-700">${client.adresse}</p>
                </div>
                ` : ''}
                <div>
                    <p class="text-sm text-gray-500">Statut</p>
                    <span class="badge badge-${client.est_actif ? 'success' : 'error'}">${client.est_actif ? 'Actif' : 'Inactif'}</span>
                </div>
                <div>
                    <p class="text-sm text-gray-500">Nombre de dépôts</p>
                    <p class="font-semibold">${client.nb_depots || 0}</p>
                </div>
            </div>
            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Fermer</button>
            </div>
        `;
        
        modal.showModal();
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de chargement', 'error');
    }
}

// Modifier un client
async function modifierClient(id) {
    try {
        const response = await fetch(`${API_URL}/clients/${id}/`);
        const client = await response.json();

        // Fermer le modal précédent si ouvert
        document.getElementById('modal-universel').close();

        const modal = document.getElementById('modal-universel');
        const content = document.getElementById('modal-content');

        content.innerHTML = `
            <h3 class="text-xl font-bold mb-4">✏️ Modifier le client</h3>
            <form id="form-modifier-client" class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div class="form-control">
                        <label class="label">Nom *</label>
                        <input type="text" id="modif-client-nom" class="input input-bordered" value="${client.nom}" required>
                    </div>
                    <div class="form-control">
                        <label class="label">Prénom</label>
                        <input type="text" id="modif-client-prenom" class="input input-bordered" value="${client.prenom || ''}">
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div class="form-control">
                        <label class="label">Téléphone *</label>
                        <input type="tel" id="modif-client-telephone" class="input input-bordered" value="${client.telephone}" required>
                    </div>
                    <div class="form-control">
                        <label class="label">Téléphone 2</label>
                        <input type="tel" id="modif-client-telephone2" class="input input-bordered" value="${client.telephone_2 || ''}">
                    </div>
                </div>
                <div class="form-control">
                    <label class="label">Chat ID Telegram</label>
                    <input type="text" id="modif-client-telegram-chat-id" class="input input-bordered" value="${client.telegram_chat_id || ''}">
                    <p class="text-xs text-gray-500 mt-1">Facultatif, pour envoyer les alertes directement au client</p>
                </div>
                <div class="form-control">
                    <label class="label">Email</label>
                    <input type="email" id="modif-client-email" class="input input-bordered" value="${client.email || ''}">
                </div>
                <div class="form-control">
                    <label class="label">Adresse</label>
                    <textarea id="modif-client-adresse" class="textarea textarea-bordered" rows="2">${client.adresse || ''}</textarea>
                </div>
                <div class="form-control">
                    <label class="label cursor-pointer">
                        <span class="label-text">Client actif</span>
                        <input type="checkbox" id="modif-client-actif" class="toggle toggle-success" ${client.est_actif ? 'checked' : ''}>
                    </label>
                </div>
                <div class="modal-action">
                    <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Annuler</button>
                    <button type="submit" class="btn btn-primary">Enregistrer les modifications</button>
                </div>
            </form>
        `;

        modal.showModal();

        document.getElementById('form-modifier-client').addEventListener('submit', async (e) => {
            e.preventDefault();
            await enregistrerModificationClient(id);
        });

    } catch (error) {
        console.error('Erreur chargement client:', error);
        afficherNotification('❌ Erreur de chargement du client', 'error');
    }
}

async function enregistrerModificationClient(id) {
    const data = {
        nom: document.getElementById('modif-client-nom').value,
        prenom: document.getElementById('modif-client-prenom').value,
        telephone: document.getElementById('modif-client-telephone').value,
        telephone_2: document.getElementById('modif-client-telephone2').value,
        telegram_chat_id: document.getElementById('modif-client-telegram-chat-id').value,
        email: document.getElementById('modif-client-email').value,
        adresse: document.getElementById('modif-client-adresse').value,
        est_actif: document.getElementById('modif-client-actif').checked
    };

    try {
        const response = await fetch(`${API_URL}/clients/${id}/`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            document.getElementById('modal-universel').close();
            chargerPage('clients');
            afficherNotification('✅ Client modifié avec succès !', 'success');
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur: ' + JSON.stringify(error), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

// Supprimer un client
async function supprimerClient(id) {
    const client = state.clients.find(c => c.id === id);
    if (!client) {
        afficherNotification('❌ Client non trouvé', 'error');
        return;
    }

    const message = `⚠️ Êtes-vous sûr de vouloir supprimer ce client ?

Nom: ${client.nom} ${client.prenom || ''}
Téléphone: ${client.telephone}
Dépôts: ${client.nb_depots || 0}

${client.nb_depots > 0 ? '⚠️ Ce client a des dépôts associés qui seront également affectés.' : ''}
Cette action est irréversible.`;

    const confirme = await afficherConfirmation('Supprimer ce client ?', message);
    if (!confirme) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/clients/${id}/`, {
            method: 'DELETE'
        });

        if (response.ok) {
            chargerPage('clients');
            afficherNotification('✅ Client supprimé avec succès !', 'success');
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur lors de la suppression: ' + JSON.stringify(error), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

// ==================== PALETTES ====================

// État de la pagination des palettes
let palettesPagination = {
    page: 1,
    lignesParPage: 10,
    total: 0,
    filtre: 'tous'  // 'tous', 'occupees', 'vides'
};

async function getPalettesHTML() {
    return `
        <div class="space-y-4">
            <div class="flex justify-between items-center">
                <h2 class="text-2xl font-bold">🎨 Gestion des Palettes</h2>
                <div class="space-x-2">
                    <button onclick="ouvrirModalNouvellePalette()" class="btn btn-primary">
                        <i class="fas fa-plus"></i> Nouvelle Palette
                    </button>
                    <button onclick="ouvrirModalAjouterPlusieursPalettes()" class="btn btn-secondary">
                        <i class="fas fa-layer-group"></i> Ajouter plusieurs
                    </button>
                </div>
            </div>

            <!-- Résumé -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="stat bg-base-100 rounded-box shadow">
                    <div class="stat-figure text-primary">
                        <i class="fas fa-layer-group text-3xl"></i>
                    </div>
                    <div class="stat-title">Total Palettes</div>
                    <div class="stat-value text-primary" id="stat-total-palettes">-</div>
                    <div class="stat-desc">Palettes configurées</div>
                </div>

                <div class="stat bg-base-100 rounded-box shadow">
                    <div class="stat-figure text-secondary">
                        <i class="fas fa-users text-3xl"></i>
                    </div>
                    <div class="stat-title">Palettes occupées</div>
                    <div class="stat-value text-secondary" id="stat-palettes-occupees">-</div>
                    <div class="stat-desc">Avec dépôts en cours</div>
                </div>

                <div class="stat bg-base-100 rounded-box shadow">
                    <div class="stat-figure text-accent">
                        <i class="fas fa-egg text-3xl"></i>
                    </div>
                    <div class="stat-title">Total œufs</div>
                    <div class="stat-value text-accent" id="stat-total-oeufs">-</div>
                    <div class="stat-desc">En incubation</div>
                </div>
            </div>

            <!-- Liste des palettes -->
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <!-- Filtres et pagination -->
                    <div class="flex flex-wrap justify-between items-center gap-4 mb-4">
                        <div class="flex items-center gap-2">
                            <span class="text-sm">Filtrer :</span>
                            <select id="filtre-palettes" class="select select-bordered select-sm" onchange="changerFiltrePalettes()">
                                <option value="tous">Toutes les palettes</option>
                                <option value="occupees">Palettes occupées</option>
                                <option value="vides">Palettes vides</option>
                            </select>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-sm">Afficher :</span>
                            <select id="lignes-par-page-palettes" class="select select-bordered select-sm" onchange="changerLignesParPagePalettes()">
                                <option value="5">5 lignes</option>
                                <option value="10" selected>10 lignes</option>
                                <option value="25">25 lignes</option>
                                <option value="50">50 lignes</option>
                            </select>
                        </div>
                    </div>
                    
                    <h3 class="card-title">📋 Liste des Palettes</h3>
                    <div class="overflow-x-auto">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>N° Palette</th>
                                    <th>Nb Dépôts</th>
                                    <th>Clients</th>
                                    <th>Races</th>
                                    <th>Total œufs</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="palettes-table"></tbody>
                        </table>
                    </div>
                    
                    <!-- Pagination -->
                    <div class="flex flex-wrap justify-between items-center mt-4 gap-2">
                        <div id="pagination-info-palettes" class="text-sm text-gray-500"></div>
                        <div class="join">
                            <button id="btn-premiere-page-palettes" class="join-item btn btn-sm" onclick="allerPagePalette(1)">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
                                </svg>
                            </button>
                            <button id="btn-page-precedente-palettes" class="join-item btn btn-sm" onclick="changerPagePalette(-1)">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                                </svg>
                            </button>
                            <span id="pagination-pages-palettes" class="join-item btn btn-sm btn-active"></span>
                            <button id="btn-page-suivante-palettes" class="join-item btn btn-sm" onclick="changerPagePalette(1)">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                                </svg>
                            </button>
                            <button id="btn-derniere-page-palettes" class="join-item btn btn-sm" onclick="allerPagePalette(-1)">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15L5.25 12l7.5-7.5" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function chargerPalettes() {
    try {
        const response = await fetch(`${API_URL}/palettes/`);
        const palettes = await response.json();
        state.palettes = palettes;

        // Mettre à jour les stats
        const total = palettes.length;
        const avecClients = palettes.filter(p => p.depots_en_cours > 0).length;
        const totalOeufsGlobal = palettes.reduce((sum, p) => {
            const clients = p.clients_sur_palette || [];
            return sum + clients.reduce((s, c) => s + c.quantite_oeufs, 0);
        }, 0);

        document.getElementById('stat-total-palettes').textContent = total;
        document.getElementById('stat-palettes-occupees').textContent = avecClients;
        document.getElementById('stat-total-oeufs').textContent = totalOeufsGlobal;

        // Appliquer le filtre
        afficherPalettesFiltrees();

    } catch (error) {
        console.error('Erreur chargement palettes:', error);
    }
}

// Fonctions de filtre et pagination pour palettes
function changerFiltrePalettes() {
    palettesPagination.filtre = document.getElementById('filtre-palettes').value;
    palettesPagination.page = 1;
    afficherPalettesFiltrees();
}

function changerLignesParPagePalettes() {
    palettesPagination.lignesParPage = parseInt(document.getElementById('lignes-par-page-palettes').value);
    palettesPagination.page = 1;
    afficherPalettesFiltrees();
}

function changerPagePalette(delta) {
    const totalPages = Math.ceil(palettesPagination.total / palettesPagination.lignesParPage);
    palettesPagination.page = Math.max(1, Math.min(totalPages, palettesPagination.page + delta));
    afficherPalettesFiltrees();
}

function allerPagePalette(page) {
    const totalPages = Math.ceil(palettesPagination.total / palettesPagination.lignesParPage);
    if (page === -1) page = totalPages;
    palettesPagination.page = Math.max(1, Math.min(totalPages, page));
    afficherPalettesFiltrees();
}

function afficherPalettesFiltrees() {
    const tbody = document.getElementById('palettes-table');
    let palettes = state.palettes || [];
    
    // Appliquer le filtre
    switch (palettesPagination.filtre) {
        case 'occupees':
            palettes = palettes.filter(p => p.depots_en_cours > 0);
            break;
        case 'vides':
            palettes = palettes.filter(p => p.depots_en_cours === 0);
            break;
    }
    
    palettesPagination.total = palettes.length;
    
    if (palettes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-gray-500">Aucune palette trouvée</td></tr>';
        updatePaginationControlsPalettes(0);
        return;
    }
    
    // Pagination
    const start = (palettesPagination.page - 1) * palettesPagination.lignesParPage;
    const end = start + palettesPagination.lignesParPage;
    const palettesPagines = palettes.slice(start, end);
    
    updatePaginationControlsPalettes(palettes.length);

    tbody.innerHTML = palettesPagines.map(palette => {
        const clients = palette.clients_sur_palette || [];
        // Afficher tous les clients avec leur quantité et statut
        const nomsClients = clients.length > 0 
            ? clients.map(c => {
                const statusColor = c.statut === 'en_cours' ? 'badge-warning' : 
                                    c.statut === 'eclos' ? 'badge-success' : 
                                    c.statut === 'echec' ? 'badge-error' : 'badge-ghost';
                return `<span class="badge ${statusColor} badge-sm mr-1 mb-1">${c.client_nom} ${c.client_prenom || ''} (${c.quantite_oeufs})</span>`;
            }).join(' ')
            : '-';
        const races = [...new Set(clients.map(c => `${c.race_nom} (${c.categorie_nom})`))].join(', ') || '-';
        const totalOeufs = clients.reduce((sum, c) => sum + c.quantite_oeufs, 0);

        return `
            <tr>
                <td class="font-bold text-lg">
                    <i class="fas fa-layer-group text-primary"></i> Palette ${palette.numero}
                </td>
                <td>
                    <span class="badge badge-${palette.depots_en_cours > 0 ? 'warning' : 'ghost'}">
                        ${palette.depots_en_cours} dépôt(s)
                    </span>
                </td>
                <td><div class="flex flex-wrap gap-1">${nomsClients}</div></td>
                <td>${races}</td>
                <td class="font-semibold">${totalOeufs > 0 ? totalOeufs + ' œufs' : '-'}</td>
                <td>
                    <button onclick="voirPalette(${palette.id})" class="btn btn-ghost btn-xs">
                        <i class="fas fa-eye"></i> Détails
                    </button>
                    <button onclick="supprimerPalette(${palette.id})" class="btn btn-ghost btn-xs text-error" ${palette.depots_en_cours > 0 ? 'disabled title="Palette utilisée"' : ''}>
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function updatePaginationControlsPalettes(totalItems) {
    palettesPagination.total = totalItems;
    
    const totalPages = Math.ceil(totalItems / palettesPagination.lignesParPage);
    const currentPage = palettesPagination.page;
    
    const start = Math.min((currentPage - 1) * palettesPagination.lignesParPage + 1, totalItems);
    const end = Math.min(currentPage * palettesPagination.lignesParPage, totalItems);
    
    const infoEl = document.getElementById('pagination-info-palettes');
    if (infoEl) {
        infoEl.textContent = `Affichage ${start}-${end} sur ${totalItems} palette(s) — Page ${currentPage}/${totalPages || 1}`;
    }
    
    const btnPremiere = document.getElementById('btn-premiere-page-palettes');
    const btnPrecedente = document.getElementById('btn-page-precedente-palettes');
    const btnSuivante = document.getElementById('btn-page-suivante-palettes');
    const btnDerniere = document.getElementById('btn-derniere-page-palettes');
    
    if (btnPremiere) btnPremiere.disabled = currentPage === 1;
    if (btnPrecedente) btnPrecedente.disabled = currentPage === 1;
    if (btnSuivante) btnSuivante.disabled = currentPage >= totalPages;
    if (btnDerniere) btnDerniere.disabled = currentPage >= totalPages;
    
    const pagesEl = document.getElementById('pagination-pages-palettes');
    if (pagesEl) {
        pagesEl.textContent = `${currentPage} / ${totalPages || 1}`;
    }
}

function ouvrirModalNouvellePalette() {
    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
        <h3 class="text-xl font-bold mb-4">🎨 Nouvelle Palette</h3>
        <form id="form-palette" class="space-y-4">
            <div class="form-control">
                <label class="label">Numéro de palette *</label>
                <input type="number" id="palette-numero" class="input input-bordered" min="1" required>
                <label class="label">
                    <span class="label-text-alt">Numéro unique pour identifier cette palette</span>
                </label>
            </div>
            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Annuler</button>
                <button type="submit" class="btn btn-primary">Enregistrer</button>
            </div>
        </form>
    `;

    modal.showModal();

    document.getElementById('form-palette').addEventListener('submit', async (e) => {
        e.preventDefault();
        await enregistrerPalette();
    });
}

function ouvrirModalAjouterPlusieursPalettes() {
    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
        <h3 class="text-xl font-bold mb-4">🎨 Ajouter plusieurs Palettes</h3>
        <form id="form-plusieurs-palettes" class="space-y-4">
            <div class="form-control">
                <label class="label">Numéro de départ *</label>
                <input type="number" id="palette-debut" class="input input-bordered" min="1" value="1" required>
            </div>
            <div class="form-control">
                <label class="label">Numéro de fin *</label>
                <input type="number" id="palette-fin" class="input input-bordered" min="1" value="12" required>
                <label class="label">
                    <span class="label-text-alt">Ex: 1 à 12 créera les palettes 1, 2, 3, ... 12</span>
                </label>
            </div>
            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Annuler</button>
                <button type="submit" class="btn btn-secondary">Créer toutes les palettes</button>
            </div>
        </form>
    `;

    modal.showModal();

    document.getElementById('form-plusieurs-palettes').addEventListener('submit', async (e) => {
        e.preventDefault();
        await enregistrerPlusieursPalettes();
    });
}

async function enregistrerPalette() {
    const data = {
        numero: parseInt(document.getElementById('palette-numero').value)
    };

    try {
        const response = await fetch(`${API_URL}/palettes/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            document.getElementById('modal-universel').close();
            chargerPage('palettes');
            afficherNotification('✅ Palette enregistrée !', 'success');
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur: ' + (error.non_field_errors ? error.non_field_errors[0] : JSON.stringify(error)), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

async function enregistrerPlusieursPalettes() {
    const debut = parseInt(document.getElementById('palette-debut').value);
    const fin = parseInt(document.getElementById('palette-fin').value);

    if (fin < debut) {
        afficherNotification('❌ Le numéro de fin doit être supérieur au numéro de début', 'error');
        return;
    }

    let succes = 0;
    let echec = 0;

    for (let i = debut; i <= fin; i++) {
        try {
            const response = await fetch(`${API_URL}/palettes/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numero: i })
            });

            if (response.ok) {
                succes++;
            } else {
                echec++;
            }
        } catch (error) {
            echec++;
        }
    }

    document.getElementById('modal-universel').close();
    chargerPage('palettes');
    
    let message = `✅ ${succes} palette(s) créée(s)`;
    if (echec > 0) {
        message += ` (❌ ${echec} échec(s) - palettes existantes)`;
    }
    afficherNotification(message, succes > 0 ? 'success' : 'error');
}

async function voirPalette(id) {
    const palette = state.palettes.find(p => p.id === id);
    if (!palette) return;

    const clients = palette.clients_sur_palette || [];

    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
        <h3 class="text-xl font-bold mb-4">
            <i class="fas fa-layer-group text-primary"></i> Palette ${palette.numero}
        </h3>
        
        <div class="alert alert-info mb-4">
            <i class="fas fa-info-circle"></i>
            <span>${clients.length} dépôt(s) en cours sur cette palette — ${clients.reduce((s, c) => s + c.quantite_oeufs, 0)} œufs au total</span>
        </div>

        ${clients.length > 0 ? `
            <div class="space-y-3">
                ${clients.map(c => {
                    const joursRestants = c.date_eclosion_prevue ? 
                        Math.ceil((new Date(c.date_eclosion_prevue) - new Date()) / (1000 * 60 * 60 * 24)) : '?';
                    return `
                        <div class="card bg-base-200 shadow-sm">
                            <div class="card-body py-3 px-4">
                                <div class="flex justify-between items-center">
                                    <div>
                                        <h4 class="font-bold">${c.client_nom} ${c.client_prenom || ''}</h4>
                                        <p class="text-sm text-gray-500">${c.race_nom} (${c.categorie_nom}) — ${c.quantite_oeufs} œufs</p>
                                    </div>
                                    <div class="text-right">
                                        <p class="text-sm text-gray-500">Éclosion prévue</p>
                                        <p class="font-semibold">${c.date_eclosion_prevue ? new Date(c.date_eclosion_prevue).toLocaleDateString('fr-FR') : '-'}</p>
                                        <span class="badge badge-${joursRestants <= 1 ? 'error' : joursRestants <= 3 ? 'warning' : 'success'} badge-sm">
                                            J-${joursRestants}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        ` : '<p class="text-gray-500 italic text-center py-8">Aucun dépôt sur cette palette</p>'}

        <div class="modal-action">
            <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Fermer</button>
        </div>
    `;

    modal.showModal();
}

async function supprimerPalette(id) {
    const palette = state.palettes.find(p => p.id === id);
    if (!palette) return;

    if (palette.depots_en_cours > 0) {
        afficherNotification('❌ Impossible de supprimer une palette qui a des dépôts en cours', 'error');
        return;
    }

    const confirme = await afficherConfirmation('Supprimer cette palette ?', `Êtes-vous sûr de vouloir supprimer la Palette ${palette.numero} ?\n\nCette action est irréversible.`);
    if (!confirme) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/palettes/${id}/`, {
            method: 'DELETE'
        });

        if (response.ok) {
            chargerPage('palettes');
            afficherNotification('✅ Palette supprimée !', 'success');
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur: ' + JSON.stringify(error), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

// ==================== CLIENTS ====================

async function getClientsHTML() {
    return `
        <div class="space-y-4">
            <div class="flex justify-between items-center">
                <h2 class="text-2xl font-bold">👥 Clients</h2>
                <button onclick="ouvrirModalNouveauClient()" class="btn btn-primary">
                    <i class="fas fa-plus"></i> Nouveau client
                </button>
            </div>
            
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <!-- Contrôles -->
                    <div class="flex flex-wrap justify-between items-center gap-4 mb-4">
                        <div class="flex items-center gap-2">
                             <span class="text-sm">Afficher :</span>
                             <select id="lignes-par-page-clients" class="select select-bordered select-sm" onchange="changerLignesParPageClient()">
                                 <option value="5">5 lignes</option>
                                 <option value="10" selected>10 lignes</option>
                                 <option value="25">25 lignes</option>
                                 <option value="50">50 lignes</option>
                             </select>
                        </div>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Nom</th>
                                    <th>Prénom</th>
                                    <th>Téléphone</th>
                                    <th>Email</th>
                                    <th>Dépôts</th>
                                    <th>Statut</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="clients-table"></tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="flex flex-wrap justify-between items-center mt-4 gap-2">
                        <div id="pagination-info-clients" class="text-sm text-gray-500"></div>
                        <div class="join">
                            <button id="btn-premiere-page-clients" class="join-item btn btn-sm" onclick="allerPageClient(1)" title="Début">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
                                </svg>
                            </button>
                            <button id="btn-page-precedente-clients" class="join-item btn btn-sm" onclick="changerPageClient(-1)" title="Précédent">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                                </svg>
                            </button>
                            <span id="pagination-pages-clients" class="join-item btn btn-sm btn-active"></span>
                            <button id="btn-page-suivante-clients" class="join-item btn btn-sm" onclick="changerPageClient(1)" title="Suivant">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                                </svg>
                            </button>
                            <button id="btn-derniere-page-clients" class="join-item btn btn-sm" onclick="allerPageClient(-1)" title="Fin">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15L5.25 12l7.5-7.5" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function chargerClients() {
    try {
        const response = await fetch(`${API_URL}/clients/`);
        const clients = await response.json();
        state.clients = clients;
        afficherClients();
    } catch (error) {
        console.error('Erreur chargement clients:', error);
    }
}

function afficherClients() {
    const tbody = document.getElementById('clients-table');
    const clients = state.clients || [];
    
    clientsPagination.total = clients.length;
    const start = (clientsPagination.page - 1) * clientsPagination.lignesParPage;
    const end = start + clientsPagination.lignesParPage;
    const clientsPagines = clients.slice(start, end);
    
    updatePaginationControlsClients(clients.length);

    tbody.innerHTML = clientsPagines.map(client => `
        <tr>
            <td>${client.nom}</td>
            <td>${client.prenom}</td>
            <td>${client.telephone}</td>
            <td>${client.email || '-'}</td>
            <td>${client.nb_depots || 0}</td>
            <td><span class="badge badge-${client.est_actif ? 'success' : 'error'}">${client.est_actif ? 'Actif' : 'Inactif'}</span></td>
            <td>
                <button onclick="voirClient(${client.id})" class="btn btn-ghost btn-xs" data-tip="Voir">
                    <i class="fas fa-eye"></i>
                </button>
                <button onclick="modifierClient(${client.id})" class="btn btn-ghost btn-xs" data-tip="Modifier">
                    <i class="fas fa-edit"></i>
                </button>
                <button onclick="supprimerClient(${client.id})" class="btn btn-ghost btn-xs text-error" data-tip="Supprimer">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function updatePaginationControlsClients(totalItems) {
    clientsPagination.total = totalItems;
    const totalPages = Math.ceil(totalItems / clientsPagination.lignesParPage);
    const currentPage = clientsPagination.page;
    const start = Math.min((currentPage - 1) * clientsPagination.lignesParPage + 1, totalItems);
    const end = Math.min(currentPage * clientsPagination.lignesParPage, totalItems);
    
    const infoEl = document.getElementById('pagination-info-clients');
    if (infoEl) infoEl.textContent = `Affichage ${start}-${end} sur ${totalItems} client(s) — Page ${currentPage}/${totalPages || 1}`;
    
    const btnPremiere = document.getElementById('btn-premiere-page-clients');
    const btnPrecedente = document.getElementById('btn-page-precedente-clients');
    const btnSuivante = document.getElementById('btn-page-suivante-clients');
    const btnDerniere = document.getElementById('btn-derniere-page-clients');
    
    if (btnPremiere) btnPremiere.disabled = currentPage === 1;
    if (btnPrecedente) btnPrecedente.disabled = currentPage === 1;
    if (btnSuivante) btnSuivante.disabled = currentPage >= totalPages;
    if (btnDerniere) btnDerniere.disabled = currentPage >= totalPages;
    
    const pagesEl = document.getElementById('pagination-pages-clients');
    if (pagesEl) pagesEl.textContent = `${currentPage} / ${totalPages || 1}`;
}

function changerPageClient(delta) {
    const totalPages = Math.ceil(clientsPagination.total / clientsPagination.lignesParPage);
    clientsPagination.page = Math.max(1, Math.min(totalPages, clientsPagination.page + delta));
    afficherClients();
}

function allerPageClient(page) {
    const totalPages = Math.ceil(clientsPagination.total / clientsPagination.lignesParPage);
    if (page === -1) page = totalPages;
    clientsPagination.page = Math.max(1, Math.min(totalPages, page));
    afficherClients();
}

function changerLignesParPageClient() {
    clientsPagination.lignesParPage = parseInt(document.getElementById('lignes-par-page-clients').value);
    clientsPagination.page = 1;
    afficherClients();
}

function ouvrirModalNouveauClient() {
    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');
    
    content.innerHTML = `
        <h3 class="text-xl font-bold mb-4">👥 Nouveau client</h3>
        <form id="form-client" class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
                <div class="form-control">
                    <label class="label">Nom *</label>
                    <input type="text" id="client-nom" class="input input-bordered" required>
                </div>
                <div class="form-control">
                    <label class="label">Prénom</label>
                    <input type="text" id="client-prenom" class="input input-bordered">
                </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="form-control">
                    <label class="label">Téléphone *</label>
                    <input type="tel" id="client-telephone" class="input input-bordered" required>
                </div>
                <div class="form-control">
                    <label class="label">Téléphone 2</label>
                    <input type="tel" id="client-telephone2" class="input input-bordered">
                </div>
            </div>
            <div class="form-control">
                <label class="label">Chat ID Telegram</label>
                <input type="text" id="client-telegram-chat-id" class="input input-bordered" placeholder="Ex: 123456789" />
                <p class="text-xs text-gray-500 mt-1">Facultatif, pour envoyer les alertes directement au client</p>
            </div>
            <div class="form-control">
                <label class="label">Email</label>
                <input type="email" id="client-email" class="input input-bordered">
            </div>
            <div class="form-control">
                <label class="label">Adresse</label>
                <textarea id="client-adresse" class="textarea textarea-bordered" rows="2"></textarea>
            </div>
            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Annuler</button>
                <button type="submit" class="btn btn-primary">Enregistrer</button>
            </div>
        </form>
    `;
    
    modal.showModal();
    
    document.getElementById('form-client').addEventListener('submit', async (e) => {
        e.preventDefault();
        await enregistrerClient();
    });
}

async function enregistrerClient() {
    const data = {
        nom: document.getElementById('client-nom').value,
        prenom: document.getElementById('client-prenom').value,
        telephone: document.getElementById('client-telephone').value,
        telephone_2: document.getElementById('client-telephone2').value,
        telegram_chat_id: document.getElementById('client-telegram-chat-id').value,
        email: document.getElementById('client-email').value,
        adresse: document.getElementById('client-adresse').value
    };
    
    try {
        const response = await fetch(`${API_URL}/clients/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            document.getElementById('modal-universel').close();
            chargerPage('clients');
            afficherNotification('✅ Client enregistré avec succès !', 'success');
        }
    } catch (error) {
        console.error('Erreur:', error);
    }
}

// ==================== RACES ====================

async function getRacesHTML() {
    return `
        <div class="space-y-4">
            <div class="flex justify-between items-center">
                <h2 class="text-2xl font-bold">🥚 Races & Catégories</h2>
                <div class="space-x-2">
                    <button onclick="ouvrirModalNouvelleCategorie()" class="btn btn-secondary">
                        <i class="fas fa-plus"></i> Catégorie
                    </button>
                    <button onclick="ouvrirModalNouvelleRace()" class="btn btn-primary">
                        <i class="fas fa-plus"></i> Race
                    </button>
                </div>
            </div>
            
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4" id="races-container"></div>
        </div>
    `;
}

async function chargerRaces() {
    const [catResponse, raceResponse] = await Promise.all([
        fetch(`${API_URL}/categories/`),
        fetch(`${API_URL}/races/`)
    ]);
    
    const categories = await catResponse.json();
    const races = await raceResponse.json();
    state.categories = categories;
    state.races = races;
    
    const container = document.getElementById('races-container');
    container.innerHTML = categories.map(cat => `
        <div class="card bg-base-100 shadow">
            <div class="card-body">
                <h3 class="card-title text-primary">
                    <i class="fas fa-egg"></i> ${cat.nom}
                    <span class="badge badge-sm">${cat.duree_incubation_jours} jours</span>
                </h3>
                <p class="text-sm text-gray-500">
                    Temp: ${cat.temperature_recommandee}°C | Humidité: ${cat.humidite_recommandee}%
                </p>
                <div class="divider my-2"></div>
                <div class="flex justify-between items-center mb-2">
                    <h4 class="font-semibold text-sm">Races associées</h4>
                    <button onclick="ouvrirModalNouvelleRace(${cat.id})" class="btn btn-xs btn-primary">
                        <i class="fas fa-plus"></i> Race
                    </button>
                </div>
                <div class="space-y-2">
                    ${races.filter(r => r.categorie === cat.id).map(race => `
                        <div class="flex justify-between items-center p-2 bg-base-200 rounded">
                            <div>
                                <span class="font-medium">${race.nom}</span>
                                <span class="text-xs text-gray-500 ml-2">${race.description || ''}</span>
                            </div>
                            <div class="space-x-1">
                                <button onclick="modifierRace(${race.id})" class="btn btn-ghost btn-xs">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button onclick="supprimerRace(${race.id})" class="btn btn-ghost btn-xs text-error">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                    ${races.filter(r => r.categorie === cat.id).length === 0 ? '<p class="text-sm text-gray-400 italic">Aucune race pour cette catégorie</p>' : ''}
                </div>
                <div class="card-actions justify-end mt-4">
                    <button onclick="modifierCategorie(${cat.id}, '${cat.nom}', ${cat.duree_incubation_jours}, ${cat.temperature_recommandee}, ${cat.humidite_recommandee})" class="btn btn-sm btn-ghost">
                        <i class="fas fa-edit"></i> Modifier
                    </button>
                    <button onclick="supprimerCategorie(${cat.id})" class="btn btn-sm btn-ghost text-error">
                        <i class="fas fa-trash"></i> Supprimer
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

// Ouvrir modal nouvelle catégorie
function ouvrirModalNouvelleCategorie() {
    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');
    
    content.innerHTML = `
        <h3 class="text-xl font-bold mb-4">🥚 Nouvelle catégorie d'œuf</h3>
        <form id="form-categorie" class="space-y-4">
            <div class="form-control">
                <label class="label">Nom de la catégorie *</label>
                <input type="text" id="categorie-nom" class="input input-bordered" placeholder="Ex: Poule, Pintade, Oie..." required>
            </div>
            <div class="form-control">
                <label class="label">Durée d'incubation (jours) *</label>
                <input type="number" id="categorie-duree" class="input input-bordered" min="1" max="60" placeholder="Ex: 21" required>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="form-control">
                    <label class="label">Température (°C)</label>
                    <input type="number" step="0.01" id="categorie-temp" class="input input-bordered" placeholder="37.50">
                </div>
                <div class="form-control">
                    <label class="label">Humidité (%)</label>
                    <input type="number" id="categorie-humidite" class="input input-bordered" placeholder="55">
                </div>
            </div>
            <div class="form-control">
                <label class="label">Description</label>
                <textarea id="categorie-description" class="textarea textarea-bordered" rows="2"></textarea>
            </div>
            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Annuler</button>
                <button type="submit" class="btn btn-secondary">Enregistrer</button>
            </div>
        </form>
    `;
    
    modal.showModal();
    
    document.getElementById('form-categorie').addEventListener('submit', async (e) => {
        e.preventDefault();
        await enregistrerCategorie();
    });
}

async function enregistrerCategorie() {
    const data = {
        nom: document.getElementById('categorie-nom').value,
        duree_incubation_jours: parseInt(document.getElementById('categorie-duree').value),
        temperature_recommandee: parseFloat(document.getElementById('categorie-temp').value) || 37.50,
        humidite_recommandee: parseInt(document.getElementById('categorie-humidite').value) || 55,
        description: document.getElementById('categorie-description').value
    };
    
    try {
        const response = await fetch(`${API_URL}/categories/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            document.getElementById('modal-universel').close();
            chargerPage('races');
            afficherNotification('✅ Catégorie enregistrée !', 'success');
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur: ' + JSON.stringify(error), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

// Ouvrir modal nouvelle race
function ouvrirModalNouvelleRace() {
    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');
    
    content.innerHTML = `
        <h3 class="text-xl font-bold mb-4">🐔 Nouvelle race</h3>
        <form id="form-race" class="space-y-4">
            <div class="form-control">
                <label class="label">Catégorie *</label>
                <select id="race-categorie" class="select select-bordered" required></select>
            </div>
            <div class="form-control">
                <label class="label">Nom de la race *</label>
                <input type="text" id="race-nom" class="input input-bordered" placeholder="Ex: Koeroler, Goliath, Sasso..." required>
            </div>
            <div class="form-control">
                <label class="label">Description</label>
                <textarea id="race-description" class="textarea textarea-bordered" rows="3"></textarea>
            </div>
            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Annuler</button>
                <button type="submit" class="btn btn-primary">Enregistrer</button>
            </div>
        </form>
    `;
    
    modal.showModal();
    
    chargerSelectCategories();
    
    document.getElementById('form-race').addEventListener('submit', async (e) => {
        e.preventDefault();
        await enregistrerRace();
    });
}

async function chargerSelectCategories() {
    const response = await fetch(`${API_URL}/categories/`);
    const categories = await response.json();
    const select = document.getElementById('race-categorie');
    select.innerHTML = categories.map(c => 
        `<option value="${c.id}">${c.nom} (${c.duree_incubation_jours} jours)</option>`
    ).join('');
}

async function enregistrerRace() {
    const data = {
        categorie: parseInt(document.getElementById('race-categorie').value),
        nom: document.getElementById('race-nom').value,
        description: document.getElementById('race-description').value
    };

    try {
        const response = await fetch(`${API_URL}/races/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            document.getElementById('modal-universel').close();
            chargerPage('races');
            afficherNotification('✅ Race enregistrée !', 'success');
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur: ' + JSON.stringify(error), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

// ==================== MODIFIER CATÉGORIE ====================

async function modifierCategorie(id, nom, duree, temp, humidite) {
    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
        <h3 class="text-xl font-bold mb-4">✏️ Modifier la catégorie</h3>
        <form id="form-modifier-categorie" class="space-y-4">
            <div class="form-control">
                <label class="label">Nom de la catégorie *</label>
                <input type="text" id="modif-categorie-nom" class="input input-bordered" value="${nom}" required>
            </div>
            <div class="form-control">
                <label class="label">Durée d'incubation (jours) *</label>
                <input type="number" id="modif-categorie-duree" class="input input-bordered" value="${duree}" min="1" max="60" required>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="form-control">
                    <label class="label">Température (°C)</label>
                    <input type="number" step="0.01" id="modif-categorie-temp" class="input input-bordered" value="${temp || 37.50}">
                </div>
                <div class="form-control">
                    <label class="label">Humidité (%)</label>
                    <input type="number" id="modif-categorie-humidite" class="input input-bordered" value="${humidite || 55}">
                </div>
            </div>
            <div class="form-control">
                <label class="label">Description</label>
                <textarea id="modif-categorie-description" class="textarea textarea-bordered" rows="2"></textarea>
            </div>
            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Annuler</button>
                <button type="submit" class="btn btn-secondary">Enregistrer les modifications</button>
            </div>
        </form>
    `;

    modal.showModal();

    document.getElementById('form-modifier-categorie').addEventListener('submit', async (e) => {
        e.preventDefault();
        await enregistrerModificationCategorie(id);
    });
}

async function enregistrerModificationCategorie(id) {
    const data = {
        nom: document.getElementById('modif-categorie-nom').value,
        duree_incubation_jours: parseInt(document.getElementById('modif-categorie-duree').value),
        temperature_recommandee: parseFloat(document.getElementById('modif-categorie-temp').value) || 37.50,
        humidite_recommandee: parseInt(document.getElementById('modif-categorie-humidite').value) || 55,
        description: document.getElementById('modif-categorie-description').value
    };

    try {
        const response = await fetch(`${API_URL}/categories/${id}/`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            document.getElementById('modal-universel').close();
            chargerPage('races');
            afficherNotification('✅ Catégorie modifiée !', 'success');
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur: ' + JSON.stringify(error), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

async function supprimerCategorie(id) {
    const confirme = await afficherConfirmation('Supprimer cette catégorie ?', 'Êtes-vous sûr de vouloir supprimer cette catégorie ?\n\nToutes les races associées seront également supprimées.');
    if (!confirme) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/categories/${id}/`, {
            method: 'DELETE'
        });

        if (response.ok) {
            chargerPage('races');
            afficherNotification('✅ Catégorie supprimée !', 'success');
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur: ' + JSON.stringify(error), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

// ==================== MODIFIER RACE ====================

async function modifierRace(id) {
    const race = state.races.find(r => r.id === id);
    if (!race) return;
    
    const nom = race.nom;
    const description = race.description || '';

    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
        <h3 class="text-xl font-bold mb-4">✏️ Modifier la race</h3>
        <form id="form-modifier-race" class="space-y-4">
            <div class="form-control">
                <label class="label">Nom de la race *</label>
                <input type="text" id="modif-race-nom" class="input input-bordered" value="${nom}" required>
            </div>
            <div class="form-control">
                <label class="label">Description</label>
                <textarea id="modif-race-description" class="textarea textarea-bordered" rows="3">${description}</textarea>
            </div>
            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Annuler</button>
                <button type="submit" class="btn btn-primary">Enregistrer les modifications</button>
            </div>
        </form>
    `;

    modal.showModal();

    document.getElementById('form-modifier-race').addEventListener('submit', async (e) => {
        e.preventDefault();
        await enregistrerModificationRace(id);
    });
}

async function enregistrerModificationRace(id) {
    const data = {
        nom: document.getElementById('modif-race-nom').value,
        description: document.getElementById('modif-race-description').value
    };

    try {
        const response = await fetch(`${API_URL}/races/${id}/`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            document.getElementById('modal-universel').close();
            chargerPage('races');
            afficherNotification('✅ Race modifiée !', 'success');
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur: ' + JSON.stringify(error), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

async function supprimerRace(id) {
    const confirme = await afficherConfirmation('Supprimer cette race ?', 'Êtes-vous sûr de vouloir supprimer cette race ?');
    if (!confirme) {
        return;
    }

    try {
        const response = await fetch(`${API_URL}/races/${id}/`, {
            method: 'DELETE'
        });

        if (response.ok) {
            chargerPage('races');
            afficherNotification('✅ Race supprimée !', 'success');
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur: ' + JSON.stringify(error), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

// ==================== ALERTES ====================

async function getAlertesHTML() {
    return `
        <div class="space-y-4">
            <h2 class="text-2xl font-bold">⚠️ Alertes</h2>
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <div id="alertes-list" class="space-y-2"></div>
                </div>
            </div>
        </div>
    `;
}

async function chargerAlertes() {
    try {
        const response = await fetch(`${API_URL}/alertes-non-lues/`);
        const alertes = await response.json();
        
        // Vérifier les NOUVELLES alertes (comparer avec l'ancien état)
        const anciennesAlertesIds = state.alertes.map(a => a.id);
        const nouvellesAlertes = alertes.filter(a => !anciennesAlertesIds.includes(a.id));
        
        state.alertes = alertes;

        // Mettre à jour le badge
        const badge = document.getElementById('badge-notif');
        const menuBadge = document.getElementById('menu-badge-alertes');

        if (alertes.length > 0) {
            badge.textContent = alertes.length;
            badge.classList.remove('hidden');
            menuBadge.textContent = alertes.length;
            menuBadge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
            menuBadge.classList.add('hidden');
        }

        // Afficher dans la liste dropdown
        const listeAlertes = document.getElementById('liste-alertes');
        if (alertes.length > 0) {
            listeAlertes.innerHTML = alertes.map(a => {
                const estPerso = a.type_alerte === 'perso';
                const estUrgent = a.type_alerte === 'jour_j';
                const estJ1 = a.type_alerte === 'j_1';
                
                // Couleur selon le type
                let alertClass = 'alert-warning';
                let iconClass = 'fa-exclamation-triangle text-warning';
                if (estPerso) {
                    alertClass = 'alert-info';
                    iconClass = 'fa-clock text-info';
                } else if (estUrgent) {
                    alertClass = 'alert-error';
                    iconClass = 'fa-exclamation-circle text-error';
                } else if (estJ1) {
                    alertClass = 'alert-warning';
                    iconClass = 'fa-exclamation text-warning';
                }
                
                // Formater le message avec des lignes séparées
                const lignes = a.message.split('\n');
                const messageFormate = lignes.map(l => {
                    if (l.startsWith('🚨') || l.startsWith('⚠️') || l.startsWith('📅') || l.startsWith('📋')) {
                        return `<div class="font-bold text-base mb-1">${l}</div>`;
                    } else if (l.startsWith('👤')) {
                        return `<div class="text-sm"><i class="fas fa-user mr-1"></i> ${l.replace('👤 ', '')}</div>`;
                    } else if (l.startsWith('📞')) {
                        return `<div class="text-sm text-primary font-mono"><i class="fas fa-phone mr-1"></i> ${l.replace('📞 ', '')}</div>`;
                    } else if (l.startsWith('🥚')) {
                        return `<div class="text-sm"><i class="fas fa-egg mr-1"></i> ${l.replace('🥚 ', '')}</div>`;
                    } else if (l.startsWith('🏷️')) {
                        return `<div class="text-sm badge badge-primary badge-sm">${l.replace('🏷️ ', '')}</div>`;
                    } else if (l.startsWith('❌')) {
                        return `<div class="text-sm badge badge-ghost badge-sm">${l}</div>`;
                    } else if (l.startsWith('📅 Déposé')) {
                        return `<div class="text-xs text-gray-500 mt-1"><i class="fas fa-calendar mr-1"></i> ${l.replace('📅 ', '')}</div>`;
                    }
                    return `<div class="text-sm">${l}</div>`;
                }).join('');
                
                return `
                    <div class="${alertClass} py-3 px-4 mb-3 rounded-lg shadow-md border-l-4 ${estUrgent ? 'border-error animate-pulse' : estJ1 ? 'border-warning' : estPerso ? 'border-info' : 'border-warning'}">
                        <div class="flex items-start gap-3">
                            <i class="fas ${iconClass} text-xl mt-1"></i>
                            <div class="flex-1">
                                ${messageFormate}
                                ${estPerso ? '<div class="text-xs text-info mt-2"><i class="fas fa-user-cog"></i> Alerte personnalisée</div>' : ''}
                                ${estUrgent ? '<div class="text-xs text-error mt-2 font-bold"><i class="fas fa-bell"></i> ACTION IMMÉDIATE REQUISE</div>' : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            listeAlertes.innerHTML = '<p class="text-sm text-gray-500">Aucune alerte</p>';
        }

        // Afficher dans la page alertes
        const alertesList = document.getElementById('alertes-list');
        if (alertesList && alertes.length > 0) {
            alertesList.innerHTML = alertes.map(a => {
                const estPerso = a.type_alerte === 'perso';
                const estUrgent = a.type_alerte === 'jour_j';
                const estJ1 = a.type_alerte === 'j_1';
                
                // Couleur selon le type
                let alertClass = 'alert-warning';
                let iconClass = 'fa-exclamation-triangle text-warning';
                if (estPerso) {
                    alertClass = 'alert-info';
                    iconClass = 'fa-clock text-info';
                } else if (estUrgent) {
                    alertClass = 'alert-error';
                    iconClass = 'fa-exclamation-circle text-error';
                } else if (estJ1) {
                    alertClass = 'alert-warning';
                    iconClass = 'fa-exclamation text-warning';
                }
                
                // Formater le message avec des lignes séparées
                const lignes = a.message.split('\n');
                const messageFormate = lignes.map(l => {
                    if (l.startsWith('🚨') || l.startsWith('⚠️') || l.startsWith('📅') || l.startsWith('📋')) {
                        return `<div class="font-bold text-lg mb-2">${l}</div>`;
                    } else if (l.startsWith('👤')) {
                        return `<div class="text-base py-1"><i class="fas fa-user mr-2 text-primary"></i> <strong>${l.replace('👤 ', '')}</strong></div>`;
                    } else if (l.startsWith('📞')) {
                        return `<div class="text-base py-1"><i class="fas fa-phone mr-2 text-success"></i> <a href="tel:${l.replace('📞 ', '')}" class="text-primary font-mono hover:underline">${l.replace('📞 ', '')}</a></div>`;
                    } else if (l.startsWith('🥚')) {
                        return `<div class="text-base py-1"><i class="fas fa-egg mr-2 text-warning"></i> ${l.replace('🥚 ', '')}</div>`;
                    } else if (l.startsWith('🏷️')) {
                        return `<div class="inline-block mt-2"><span class="badge badge-primary badge-lg">${l.replace('🏷️ ', '')}</span></div>`;
                    } else if (l.startsWith('❌')) {
                        return `<div class="inline-block mt-1"><span class="badge badge-ghost badge-md">${l}</span></div>`;
                    } else if (l.startsWith('📅 Déposé')) {
                        return `<div class="text-sm text-gray-500 mt-2 pt-2 border-t border-base-300"><i class="fas fa-calendar mr-2"></i>${l.replace('📅 ', '')}</div>`;
                    }
                    return `<div class="text-sm">${l}</div>`;
                }).join('');
                
                return `
                    <div class="${alertClass} mb-4 rounded-lg shadow-lg border-l-4 ${estUrgent ? 'border-error' : estJ1 ? 'border-warning' : estPerso ? 'border-info' : 'border-warning'}">
                        <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4 p-4">
                            <div class="flex items-start gap-4 flex-1">
                                <div class="text-3xl">${estUrgent ? '🚨' : estJ1 ? '⚠️' : estPerso ? '⏰' : '📢'}</div>
                                <div class="flex-1">
                                    ${messageFormate}
                                    ${estPerso ? '<div class="mt-3 text-sm text-info"><i class="fas fa-user-cog mr-1"></i> Alerte personnalisée</div>' : ''}
                                    ${estUrgent ? '<div class="mt-3 alert alert-error py-2"><i class="fas fa-bell mr-2"></i><strong>ACTION IMMÉDIATE REQUISE - Allez chercher les poussins !</strong></div>' : ''}
                                </div>
                            </div>
                            <div class="flex flex-col gap-2">
                                <button onclick="marquerAlerteLue(${a.id})" class="btn ${estUrgent ? 'btn-error' : estPerso ? 'btn-info' : 'btn-primary'}">
                                    <i class="fas fa-check"></i> Marquer comme lue
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } else if (alertesList) {
            alertesList.innerHTML = '<p class="text-gray-500 text-center py-8">Aucune alerte pour le moment</p>';
        }
        
        // 🚨 DÉCLENCHER L'ALARME POUR LES NOUVELLES ALERTES CRITIQUES
        if (nouvellesAlertes.length > 0) {
            verifierAlertesCritiques(nouvellesAlertes);
        }

    } catch (error) {
        console.error('Erreur chargement alertes:', error);
    }
}

async function marquerAlerteLue(id) {
    // Arrêter l'alarme sonore immédiatement
    if (typeof arreterAlarme === 'function') {
        arreterAlarme();
    }
    
    try {
        const response = await fetch(`${API_URL}/alertes/${id}/lire/`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'X-CSRFToken': getCSRFToken(),
            }
        });

        let data;
        try {
            data = await response.json();
        } catch (err) {
            console.error('Réponse non JSON pour marquerAlerteLue:', response.status, response.statusText);
            throw err;
        }

        if (!response.ok) {
            console.error('Erreur API marquerAlerteLue:', response.status, data);
            afficherNotification('❌ Impossible d\'arrêter l\'alerte. Voir console.', 'error');
            return;
        }

        if (data.success) {
            // Si le dépôt a été mis à jour (statut changé à "éclos")
            if (data.depot_updated) {
                afficherNotification(`✅ ${data.message}`, 'success');
                console.log(`📦 Dépôt #${data.depot_id} marqué comme ${data.nouveau_statut}`);
                
                // Rafraîchir les données
                chargerAlertes();
                if (state.page === 'depots' || state.page === 'dashboard') {
                    chargerPage(state.page);
                }
            } else {
                // Alertes simples (personnalisées ou autres)
                chargerAlertes();
            }
        }
    } catch (error) {
        console.error('Erreur marquage alerte:', error);
        afficherNotification('❌ Erreur lors du marquage de l\'alerte', 'error');
    }
    chargerAlertes();
    if (state.page === 'dashboard') chargerPage('dashboard');
}

// ==================== PARAMÈTRES ====================

function getParametresHTML() {
    return `
        <div class="space-y-4">
            <h2 class="text-2xl font-bold">⚙️ Paramètres</h2>
            
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <h3 class="card-title">🎨 Apparence</h3>
                    <div class="form-control">
                        <label class="label cursor-pointer">
                            <span class="label-text">Mode sombre</span>
                            <input type="checkbox" class="toggle" onchange="toggleTheme(this.checked)">
                        </label>
                    </div>
                </div>
            </div>
            
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <h3 class="card-title">🔔 Notifications</h3>
                    <div class="form-control">
                        <label class="label cursor-pointer">
                            <span class="label-text">Notifications navigateur</span>
                            <input type="checkbox" class="toggle" checked onchange="demanderPermissionNotifications()">
                        </label>
                    </div>
                    <div class="form-control">
                        <label class="label cursor-pointer">
                            <span class="label-text">Son des alarmes</span>
                            <input type="checkbox" class="toggle" checked id="toggle-son">
                        </label>
                    </div>
                </div>
            </div>
            
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <h3 class="card-title">💾 Données</h3>
                    <button onclick="exporterDonnees()" class="btn btn-outline">
                        <i class="fas fa-download"></i> Exporter les données
                    </button>
                </div>
            </div>
        </div>
    `;
}

// ==================== CONFIRMATION PERSONNALISÉE ====================

// Fonction pour afficher une boîte de confirmation personnalisée
function afficherConfirmation(titre, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-universel');
        const content = document.getElementById('modal-content');
        
        content.innerHTML = `
            <div class="text-center">
                <div class="text-6xl mb-4">⚠️</div>
                <h3 class="text-xl font-bold mb-4">${titre}</h3>
                <p class="text-gray-600 mb-6 whitespace-pre-line">${message}</p>
                <div class="modal-action justify-center">
                    <button type="button" class="btn btn-ghost" onclick="fermerConfirmation(false)">
                        <i class="fas fa-times"></i> Annuler
                    </button>
                    <button type="button" class="btn btn-error" onclick="fermerConfirmation(true)">
                        <i class="fas fa-check"></i> Confirmer
                    </button>
                </div>
            </div>
        `;
        
        modal.showModal();
        
        // Stocker la résolution pour l'utiliser dans le bouton
        window._confirmationResolve = resolve;
    });
}

// Fonction pour fermer la confirmation et résoudre la promesse
function fermerConfirmation(resultat) {
    const modal = document.getElementById('modal-universel');
    modal.close();
    
    if (window._confirmationResolve) {
        window._confirmationResolve(resultat);
        window._confirmationResolve = null;
    }
}

// ==================== UTILITAIRES ====================

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getJoursRestantsBadge(depot) {
    if (!depot.jours_restants && depot.jours_restants !== 0) return '-';
    
    const jours = depot.jours_restants;
    let color = 'success';
    if (jours <= 1) color = 'error';
    else if (jours <= 3) color = 'warning';
    
    return `<span class="badge badge-${color}">${jours}j</span>`;
}

function getStatutColor(statut) {
    const colors = {
        'en_cours': 'warning',
        'eclos': 'success',
        'echec': 'error',
        'annule': 'ghost'
    };
    return colors[statut] || 'ghost';
    
}

function afficherNotification(message, type = 'info') {
    // Créer un élément toast
    const toast = document.createElement('div');
    toast.className = `toast toast-end toast-top z-[9999]`;
    
    const colors = {
        'success': 'alert-success',
        'error': 'alert-error',
        'warning': 'alert-warning',
        'info': 'alert-info'
    };
    
    const icons = {
        'success': '✅',
        'error': '❌',
        'warning': '⚠️',
        'info': 'ℹ️'
    };
    
    toast.innerHTML = `
        <div class="alert ${colors[type] || colors.info} text-white shadow-lg">
            <span>${icons[type] || icons.info} ${message}</span>
        </div>
    `;
    
    document.body.appendChild(toast);
    
    // Supprimer après 3 secondes
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function updateStatutConnexion() {
    const status = document.getElementById('status-connexion');
    if (!status) {
        return;
    }
    const icon = status.querySelector('i');
    if (!icon) {
        return;
    }
    if (navigator.onLine) {
        icon.className = 'fas fa-wifi text-success text-xl';
        status.setAttribute('data-tip', 'En ligne');
    } else {
        icon.className = 'fas fa-wifi text-error text-xl';
        status.setAttribute('data-tip', 'Hors ligne');
    }
}

function toggleTheme(isDark) {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// Charger le thème sauvegardé
const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
}

// ==================== CAISSE ====================

let caisseCharts = {
    evolution: null,
    repartition: null
};

async function getCaisseHTML() {
    const today = new Date();
    const dateDebut = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const dateFin = today.toISOString().split('T')[0];
    
    return `
        <div class="space-y-4">
            <div class="flex justify-between items-center">
                <h2 class="text-2xl font-bold">💰 Gestion de Caisse</h2>
                <button onclick="ouvrirModalNouvelleTransaction()" class="btn btn-primary">
                    <i class="fas fa-plus"></i> Nouvelle transaction
                </button>
            </div>
            
            <!-- Filtres -->
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div class="form-control">
                            <label class="label">Période</label>
                            <select id="caisse-periode" class="select select-bordered select-sm" onchange="chargerCaisse()">
                                <option value="jour">Aujourd'hui</option>
                                <option value="semaine">Cette semaine</option>
                                <option value="mois" selected>Ce mois</option>
                                <option value="annee">Cette année</option>
                            </select>
                        </div>
                        <div class="form-control">
                            <label class="label">Date début</label>
                            <input type="date" id="caisse-date-debut" class="input input-bordered input-sm" value="${dateDebut}" onchange="chargerCaisse()">
                        </div>
                        <div class="form-control">
                            <label class="label">Date fin</label>
                            <input type="date" id="caisse-date-fin" class="input input-bordered input-sm" value="${dateFin}" onchange="chargerCaisse()">
                        </div>
                        <div class="form-control flex items-end">
                            <button onclick="exporterCaisse()" class="btn btn-sm btn-outline">
                                <i class="fas fa-file-export"></i> Exporter
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Synthèse -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div class="stat bg-base-100 rounded-box shadow">
                    <div class="stat-figure text-success">
                        <i class="fas fa-arrow-down text-3xl"></i>
                    </div>
                    <div class="stat-title">Total Entrées</div>
                    <div class="stat-value text-success text-2xl" id="caisse-entrees">0 FCFA</div>
                    <div class="stat-desc" id="caisse-nb-entrees">0 transaction(s)</div>
                </div>
                
                <div class="stat bg-base-100 rounded-box shadow">
                    <div class="stat-figure text-error">
                        <i class="fas fa-arrow-up text-3xl"></i>
                    </div>
                    <div class="stat-title">Total Sorties</div>
                    <div class="stat-value text-error text-2xl" id="caisse-sorties">0 FCFA</div>
                    <div class="stat-desc" id="caisse-nb-sorties">0 transaction(s)</div>
                </div>
                
                <div class="stat bg-base-100 rounded-box shadow">
                    <div class="stat-figure text-primary">
                        <i class="fas fa-wallet text-3xl"></i>
                    </div>
                    <div class="stat-title">Solde</div>
                    <div class="stat-value text-primary text-2xl" id="caisse-solde">0 FCFA</div>
                    <div class="stat-desc" id="caisse-solde-desc">Balance</div>
                </div>
                
                <div class="stat bg-base-100 rounded-box shadow">
                    <div class="stat-figure text-secondary">
                        <i class="fas fa-egg text-3xl"></i>
                    </div>
                    <div class="stat-title">Dépôts</div>
                    <div class="stat-value text-secondary text-2xl" id="caisse-depots">0</div>
                    <div class="stat-desc" id="caisse-oeufs">0 œufs</div>
                </div>
            </div>
            
            <!-- Graphiques -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div class="card bg-base-100 shadow">
                    <div class="card-body">
                        <h3 class="card-title">📈 Évolution</h3>
                        <div class="h-64">
                            <canvas id="chart-evolution"></canvas>
                        </div>
                    </div>
                </div>
                
                <div class="card bg-base-100 shadow">
                    <div class="card-body">
                        <h3 class="card-title">🥧 Répartition</h3>
                        <div class="h-64">
                            <canvas id="chart-repartition"></canvas>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Transactions récentes -->
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="card-title">📋 Transactions récentes</h3>
                        <div class="flex gap-2">
                            <select id="filtre-type-trans" class="select select-bordered select-sm" onchange="chargerTransactions()">
                                <option value="">Tous types</option>
                                <option value="entree">Entrées</option>
                                <option value="sortie">Sorties</option>
                            </select>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Type</th>
                                    <th>Catégorie</th>
                                    <th>Montant</th>
                                    <th>Description</th>
                                    <th>Client</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="transactions-table"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function chargerCaisse() {
    try {
        const periode = document.getElementById('caisse-periode').value;
        const dateDebut = document.getElementById('caisse-date-debut').value;
        const dateFin = document.getElementById('caisse-date-fin').value;
        
        // Charger les stats
        const response = await fetch(`${API_URL}/caisse/dashboard/?periode=${periode}&date_debut=${dateDebut}&date_fin=${dateFin}`);
        const data = await response.json();
        
        // Mettre à jour les stats
        document.getElementById('caisse-entrees').textContent = formatMontant(data.synthese.total_entrees);
        document.getElementById('caisse-sorties').textContent = formatMontant(data.synthese.total_sorties);
        document.getElementById('caisse-solde').textContent = formatMontant(data.synthese.solde);
        document.getElementById('caisse-nb-entrees').textContent = `${data.synthese.nb_entrees} transaction(s)`;
        document.getElementById('caisse-nb-sorties').textContent = `${data.synthese.nb_sorties} transaction(s)`;
        
        // Solde couleur
        const soldeEl = document.getElementById('caisse-solde');
        if (data.synthese.solde >= 0) {
            soldeEl.className = 'stat-value text-success text-2xl';
        } else {
            soldeEl.className = 'stat-value text-error text-2xl';
        }
        
        // Stats dépôts
        document.getElementById('caisse-depots').textContent = data.depots.nb_depots;
        document.getElementById('caisse-oeufs').textContent = `${data.depots.total_oeufs} œufs`;
        
        // Graphiques
        afficherGraphiqueEvolution(data.evolution);
        afficherGraphiqueRepartition(data.repartition);
        
        // Charger les transactions
        await chargerTransactions();
        
    } catch (error) {
        console.error('Erreur chargement caisse:', error);
        afficherNotification('❌ Erreur de chargement', 'error');
    }
}

async function chargerTransactions() {
    try {
        const typeFiltre = document.getElementById('filtre-type-trans')?.value || '';
        const dateDebut = document.getElementById('caisse-date-debut').value;
        const dateFin = document.getElementById('caisse-date-fin').value;
        
        let url = `${API_URL}/transactions/?date_debut=${dateDebut}&date_fin=${dateFin}`;
        if (typeFiltre) url += `&type=${typeFiltre}`;
        
        const response = await fetch(url);
        const transactions = await response.json();
        
        const tbody = document.getElementById('transactions-table');
        
        if (transactions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-gray-500">Aucune transaction</td></tr>';
            return;
        }
        
        tbody.innerHTML = transactions.slice(0, 20).map(t => `
            <tr>
                <td>${formatDateCourt(t.date_transaction)}</td>
                <td>
                    <span class="badge badge-${t.type_transaction === 'entree' ? 'success' : 'error'}">
                        <i class="fas fa-arrow-${t.type_transaction === 'entree' ? 'down' : 'up'}"></i>
                        ${t.type_display}
                    </span>
                </td>
                <td>${t.categorie_display}</td>
                <td class="font-semibold text-${t.type_transaction === 'entree' ? 'success' : 'error'}">
                    ${t.type_transaction === 'entree' ? '+' : '-'}${formatMontant(t.montant)}
                </td>
                <td>${t.description || '-'}</td>
                <td>${t.client_nom || '-'}</td>
                <td>
                    <button onclick="supprimerTransaction(${t.id})" class="btn btn-ghost btn-xs text-error">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('Erreur chargement transactions:', error);
    }
}

function afficherGraphiqueEvolution(evolution) {
    const ctx = document.getElementById('chart-evolution');
    if (!ctx) return;
    
    // Détruire le graphique existant
    if (caisseCharts.evolution) {
        caisseCharts.evolution.destroy();
    }
    
    const labels = evolution.entrees.map(e => formatDateCourt(e.date));
    
    caisseCharts.evolution = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Entrées',
                    data: evolution.entrees.map(e => e.total),
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Sorties',
                    data: evolution.sorties.map(e => e.total),
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString('fr-FR') + ' FCFA';
                        }
                    }
                }
            }
        }
    });
}

function afficherGraphiqueRepartition(repartition) {
    const ctx = document.getElementById('chart-repartition');
    if (!ctx) return;
    
    // Détruire le graphique existant
    if (caisseCharts.repartition) {
        caisseCharts.repartition.destroy();
    }
    
    // Combiner entrées et sorties
    const entreesData = repartition.entrees.slice(0, 5);
    const sortiesData = repartition.sorties.slice(0, 5);
    
    const labels = [...entreesData.map(e => e.categorie), ...sortiesData.map(e => e.categorie)];
    const data = [...entreesData.map(e => e.total), ...sortiesData.map(e => -e.total)];
    const colors = [
        ...entreesData.map(() => 'rgba(34, 197, 94, 0.8)'),
        ...sortiesData.map(() => 'rgba(239, 68, 68, 0.8)')
    ];
    
    caisseCharts.repartition = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Montant',
                data: data,
                backgroundColor: colors,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    ticks: {
                        callback: function(value) {
                            return Math.abs(value).toLocaleString('fr-FR') + ' FCFA';
                        }
                    }
                }
            }
        }
    });
}

function ouvrirModalNouvelleTransaction() {
    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');
    
    content.innerHTML = `
        <h3 class="text-xl font-bold mb-4">💰 Nouvelle transaction</h3>
        <form id="form-transaction" class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
                <div class="form-control">
                    <label class="label">Type *</label>
                    <select id="trans-type" class="select select-bordered" required onchange="updateCategories()">
                        <option value="entree">Entrée</option>
                        <option value="sortie">Sortie</option>
                    </select>
                </div>
                <div class="form-control">
                    <label class="label">Montant (FCFA) *</label>
                    <input type="number" id="trans-montant" class="input input-bordered" min="0" required>
                </div>
            </div>
            
            <div class="form-control">
                <label class="label">Catégorie *</label>
                <select id="trans-categorie" class="select select-bordered" required>
                    <option value="depot_client">Dépôt client</option>
                    <option value="eclosion">Éclosion payée</option>
                    <option value="autre_entree">Autre entrée</option>
                </select>
            </div>
            
            <div class="form-control">
                <label class="label">Client</label>
                <select id="trans-client" class="select select-bordered">
                    <option value="">-- Sélectionner un client --</option>
                </select>
            </div>
            
            <div class="grid grid-cols-2 gap-4">
                <div class="form-control">
                    <label class="label">Date *</label>
                    <input type="date" id="trans-date" class="input input-bordered" value="${new Date().toISOString().split('T')[0]}" required>
                </div>
                <div class="form-control">
                    <label class="label">Référence</label>
                    <input type="text" id="trans-reference" class="input input-bordered" placeholder="N° reçu...">
                </div>
            </div>
            
            <div class="form-control">
                <label class="label">Description</label>
                <textarea id="trans-description" class="textarea textarea-bordered" rows="2"></textarea>
            </div>
            
            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Annuler</button>
                <button type="submit" class="btn btn-primary">Enregistrer</button>
            </div>
        </form>
    `;
    
    modal.showModal();
    
    // Charger les clients
    chargerSelectClientsTransaction();
    
    document.getElementById('form-transaction').addEventListener('submit', async (e) => {
        e.preventDefault();
        await enregistrerTransaction();
    });
}

function updateCategories() {
    const type = document.getElementById('trans-type').value;
    const select = document.getElementById('trans-categorie');
    
    if (type === 'entree') {
        select.innerHTML = `
            <option value="depot_client">Dépôt client</option>
            <option value="eclosion">Éclosion payée</option>
            <option value="autre_entree">Autre entrée</option>
        `;
    } else {
        select.innerHTML = `
            <option value="achat_materiel">Achat matériel</option>
            <option value="electricite">Électricité</option>
            <option value="eau">Eau</option>
            <option value="salaire">Salaire</option>
            <option value="maintenance">Maintenance</option>
            <option value="transport">Transport</option>
            <option value="autre_sortie">Autre sortie</option>
        `;
    }
}

async function chargerSelectClientsTransaction() {
    const response = await fetch(`${API_URL}/clients/`);
    const clients = await response.json();
    const select = document.getElementById('trans-client');
    select.innerHTML = '<option value="">-- Sélectionner un client --</option>' + 
        clients.map(c => `<option value="${c.id}">${c.nom} ${c.prenom || ''} (${c.telephone})</option>`).join('');
}

async function enregistrerTransaction() {
    const data = {
        type_transaction: document.getElementById('trans-type').value,
        montant: parseFloat(document.getElementById('trans-montant').value),
        categorie: document.getElementById('trans-categorie').value,
        client: document.getElementById('trans-client').value || null,
        date_transaction: document.getElementById('trans-date').value,
        reference: document.getElementById('trans-reference').value,
        description: document.getElementById('trans-description').value
    };
    
    try {
        const response = await fetch(`${API_URL}/transactions/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            document.getElementById('modal-universel').close();
            chargerCaisse();
            afficherNotification('✅ Transaction enregistrée !', 'success');
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur: ' + JSON.stringify(error), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

async function supprimerTransaction(id) {
    const confirme = await afficherConfirmation('Supprimer cette transaction ?', 'Êtes-vous sûr de vouloir supprimer cette transaction ?\n\nCette action est irréversible.');
    if (!confirme) return;
    
    try {
        const response = await fetch(`${API_URL}/transactions/${id}/`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            chargerCaisse();
            afficherNotification('✅ Transaction supprimée', 'success');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de suppression', 'error');
    }
}

function exporterCaisse() {
    afficherNotification('📊 Export en cours...', 'info');
    // TODO: Implémenter l'export CSV/PDF
}

function formatMontant(montant) {
    return Math.round(montant).toLocaleString('fr-FR') + ' FCFA';
}

// ==================== PARAMÈTRES ====================

// État des paramètres
let parametresState = {
    parametres: null,
    codePinVerifie: false
};

function getParametresHTML() {
    return `
        <div class="space-y-6">
            <div class="flex justify-between items-center">
                <h2 class="text-2xl font-bold">⚙️ Paramètres</h2>
            </div>
            
            <!-- Informations entreprise -->
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <h3 class="card-title">
                        <i class="fas fa-building"></i> Informations de l'entreprise
                    </h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="form-control">
                            <label class="label">Nom de l'entreprise</label>
                            <input type="text" id="param-nom-entreprise" class="input input-bordered" placeholder="Ma Couveuse">
                        </div>
                        <div class="form-control">
                            <label class="label">Téléphone</label>
                            <input type="tel" id="param-telephone" class="input input-bordered" placeholder="+225 XX XX XX XX XX">
                        </div>
                        <div class="form-control">
                            <label class="label">Email</label>
                            <input type="email" id="param-email" class="input input-bordered" placeholder="contact@couveuse.com">
                        </div>
                        <div class="form-control">
                            <label class="label">Adresse</label>
                            <input type="text" id="param-adresse" class="input input-bordered" placeholder="Ville, Quartier...">
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Sécurité - Code PIN -->
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <h3 class="card-title">
                        <i class="fas fa-shield-alt"></i> Sécurité
                    </h3>
                    <p class="text-sm text-gray-500 mb-4">
                        Protégez les actions sensibles (modification, suppression) avec un code PIN à 4 chiffres.
                    </p>
                    
                    <div class="flex items-center gap-4 mb-4">
                        <div class="form-control">
                            <label class="label cursor-pointer gap-4">
                                <input type="checkbox" id="param-pin-actif" class="toggle toggle-primary" onchange="togglePinActif()">
                                <span class="label-text font-semibold">Activer le code PIN</span>
                            </label>
                        </div>
                    </div>
                    
                    <div id="pin-config-section" class="hidden">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <!-- Section création PIN - visible uniquement si aucun PIN n'est défini -->
                            <div id="pin-create-section" class="form-control">
                                <label class="label">Définir un code PIN (4 chiffres)</label>
                                <div class="join">
                                    <input type="password" id="param-pin-new" class="input input-bordered join-item w-full" maxlength="4" placeholder="****">
                                    <button onclick="activerPin()" class="btn btn-primary join-item">
                                        <i class="fas fa-check"></i>
                                    </button>
                                </div>
                            </div>
                            <!-- Section changement PIN - visible uniquement si un PIN est déjà défini -->
                            <div id="pin-change-section" class="form-control hidden">
                                <label class="label">Changer le code PIN</label>
                                <button onclick="ouvrirModalChangerPin()" class="btn btn-outline">
                                    <i class="fas fa-key"></i> Changer le code
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Sons d'alerte -->
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <h3 class="card-title">
                        <i class="fas fa-volume-up"></i> Sons d'alerte
                    </h3>
                    
                    <div class="form-control mb-4">
                        <label class="label cursor-pointer">
                            <span class="label-text">Activer les sons</span>
                            <input type="checkbox" id="param-son-actif" class="toggle toggle-success" checked>
                        </label>
                    </div>
                    
                    <div class="overflow-x-auto">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Type d'alerte</th>
                                    <th>Son actuel</th>
                                    <th>Tester</th>
                                    <th>Changer</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>
                                        <span class="badge badge-error">Jour J</span>
                                        <span class="text-sm ml-2">Éclosion imminente</span>
                                    </td>
                                    <td id="son-jour-j-nom">alarm_critical.mp3</td>
                                    <td>
                                        <button onclick="testerSon('jour_j')" class="btn btn-sm btn-ghost">
                                            <i class="fas fa-play"></i>
                                        </button>
                                    </td>
                                    <td>
                                        <input type="file" id="son-file-jour_j" accept=".mp3,.wav,.ogg" class="hidden" onchange="uploaderSon('jour_j')">
                                        <button onclick="document.getElementById('son-file-jour_j').click()" class="btn btn-sm btn-outline">
                                            <i class="fas fa-upload"></i>
                                        </button>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <span class="badge badge-warning">J-1</span>
                                        <span class="text-sm ml-2">Veille d'éclosion</span>
                                    </td>
                                    <td id="son-j-1-nom">alarm_warning.mp3</td>
                                    <td>
                                        <button onclick="testerSon('j_1')" class="btn btn-sm btn-ghost">
                                            <i class="fas fa-play"></i>
                                        </button>
                                    </td>
                                    <td>
                                        <input type="file" id="son-file-j_1" accept=".mp3,.wav,.ogg" class="hidden" onchange="uploaderSon('j_1')">
                                        <button onclick="document.getElementById('son-file-j_1').click()" class="btn btn-sm btn-outline">
                                            <i class="fas fa-upload"></i>
                                        </button>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <span class="badge badge-info">J-3</span>
                                        <span class="text-sm ml-2">3 jours avant</span>
                                    </td>
                                    <td id="son-j-3-nom">alarm_info.mp3</td>
                                    <td>
                                        <button onclick="testerSon('j_3')" class="btn btn-sm btn-ghost">
                                            <i class="fas fa-play"></i>
                                        </button>
                                    </td>
                                    <td>
                                        <input type="file" id="son-file-j_3" accept=".mp3,.wav,.ogg" class="hidden" onchange="uploaderSon('j_3')">
                                        <button onclick="document.getElementById('son-file-j_3').click()" class="btn btn-sm btn-outline">
                                            <i class="fas fa-upload"></i>
                                        </button>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <span class="badge badge-secondary">Perso</span>
                                        <span class="text-sm ml-2">Alerte personnalisée</span>
                                    </td>
                                    <td id="son-perso-nom">alarm_perso.mp3</td>
                                    <td>
                                        <button onclick="testerSon('perso')" class="btn btn-sm btn-ghost">
                                            <i class="fas fa-play"></i>
                                        </button>
                                    </td>
                                    <td>
                                        <input type="file" id="son-file-perso" accept=".mp3,.wav,.ogg" class="hidden" onchange="uploaderSon('perso')">
                                        <button onclick="document.getElementById('son-file-perso').click()" class="btn btn-sm btn-outline">
                                            <i class="fas fa-upload"></i>
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    
                    <div class="form-control mt-4">
                        <label class="label">
                            <span class="label-text">Nombre de répétitions d'alarme</span>
                        </label>
                        <input type="number" id="param-repetition" class="input input-bordered w-32" min="1" max="10" value="3">
                    </div>
                </div>
            </div>
            
            <!-- Notifications -->
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <h3 class="card-title">
                        <i class="fas fa-bell"></i> Notifications
                    </h3>
                    <div class="form-control">
                        <label class="label cursor-pointer">
                            <span class="label-text">Notifications navigateur</span>
                            <input type="checkbox" id="param-notifications" class="toggle toggle-info" checked>
                        </label>
                    </div>
                </div>
            </div>
            
            <!-- Paramètres d'incubation -->
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <h3 class="card-title">
                        <i class="fas fa-thermometer-half"></i> Paramètres d'incubation par défaut
                    </h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="form-control">
                            <label class="label">Température par défaut (°C)</label>
                            <input type="number" id="param-temperature" class="input input-bordered" step="0.01" value="37.50">
                        </div>
                        <div class="form-control">
                            <label class="label">Humidité par défaut (%)</label>
                            <input type="number" id="param-humidite" class="input input-bordered" value="55">
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Bouton sauvegarder -->
            <div class="flex justify-end">
                <button onclick="sauvegarderParametres()" class="btn btn-primary btn-lg">
                    <i class="fas fa-save"></i> Sauvegarder les paramètres
                </button>
            </div>
        </div>
    `;
}

// Charger les paramètres depuis l'API
async function chargerParametres() {
    try {
        // Ajouter un paramètre anti-cache pour éviter les problèmes de cache navigateur
        const response = await fetch('/api/parametres/?_t=' + Date.now());
        if (response.ok) {
            const params = await response.json();
            console.log('📋 Paramètres chargés:', params);
            console.log('🔐 code_pin_actif:', params.code_pin_actif);
            parametresState.parametres = params;
            remplirFormulaireParametres(params);
        }
    } catch (error) {
        console.error('Erreur chargement paramètres:', error);
    }
}

// Remplir le formulaire avec les paramètres existants
function remplirFormulaireParametres(params) {
    // Vérifier si les éléments existent (la page paramètres doit être chargée)
    const nomEntreprise = document.getElementById('param-nom-entreprise');
    if (!nomEntreprise) {
        // Les éléments du formulaire n'existent pas encore, on stocke juste les paramètres
        return;
    }
    
    // Informations entreprise
    nomEntreprise.value = params.nom_entreprise || '';
    document.getElementById('param-telephone').value = params.telephone_entreprise || '';
    document.getElementById('param-email').value = params.email_entreprise || '';
    document.getElementById('param-adresse').value = params.adresse_entreprise || '';
    
    // Sécurité
    document.getElementById('param-pin-actif').checked = params.code_pin_actif || false;
    if (params.code_pin_actif) {
        document.getElementById('pin-config-section').classList.remove('hidden');
        // PIN déjà activé : masquer le formulaire de création, afficher le bouton de changement
        document.getElementById('pin-create-section').classList.add('hidden');
        document.getElementById('pin-change-section').classList.remove('hidden');
    } else {
        // PIN non activé : afficher le formulaire de création, masquer le bouton de changement
        const createSection = document.getElementById('pin-create-section');
        const changeSection = document.getElementById('pin-change-section');
        if (createSection) createSection.classList.remove('hidden');
        if (changeSection) changeSection.classList.add('hidden');
    }
    
    // Sons
    document.getElementById('param-son-actif').checked = params.son_actif !== false;
    document.getElementById('param-repetition').value = params.repetition_alarme || 3;
    
    // Afficher les noms des fichiers son (depuis le champ JSON sons)
    const sons = params.sons || {};
    if (sons.jour_j) {
        document.getElementById('son-jour-j-nom').textContent = sons.jour_j.split('/').pop();
    }
    if (sons.j_1) {
        document.getElementById('son-j-1-nom').textContent = sons.j_1.split('/').pop();
    }
    if (sons.j_3) {
        document.getElementById('son-j-3-nom').textContent = sons.j_3.split('/').pop();
    }
    if (sons.perso) {
        document.getElementById('son-perso-nom').textContent = sons.perso.split('/').pop();
    }
    
    // Notifications
    document.getElementById('param-notifications').checked = params.notifications_actives !== false;
    
    // Incubation
    document.getElementById('param-temperature').value = params.temperature_defaut || 37.50;
    document.getElementById('param-humidite').value = params.humidite_defaut || 55;
}

// Toggle section PIN
function togglePinActif() {
    const actif = document.getElementById('param-pin-actif').checked;
    const section = document.getElementById('pin-config-section');
    
    if (actif) {
        section.classList.remove('hidden');
    } else {
        // Demander le code PIN pour désactiver
        verifierPinAvantAction((codePin) => {
            section.classList.add('hidden');
            // Appeler l'API pour désactiver avec le code vérifié
            desactiverPin(codePin);
        }, () => {
            // Annulation : remettre la case cochée
            document.getElementById('param-pin-actif').checked = true;
        });
    }
}

// Activer le PIN avec un nouveau code
async function activerPin() {
    const code = document.getElementById('param-pin-new').value;
    
    if (!code || code.length !== 4 || !/^\d{4}$/.test(code)) {
        afficherNotification('❌ Le code PIN doit contenir exactement 4 chiffres', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/parametres/activer-code/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activer: true, code: code })
        });
        
        const data = await response.json();
        
        if (data.success) {
            afficherNotification('✅ Code PIN activé avec succès !', 'success');
            document.getElementById('param-pin-new').value = '';
            // Rafraîchir les paramètres pour masquer le formulaire de création
            await chargerParametres();
        } else {
            afficherNotification('❌ ' + data.message, 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

// Désactiver le PIN
async function desactiverPin(codePin) {
    try {
        const response = await fetch('/api/parametres/activer-code/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activer: false, code: codePin || '' })
        });
        
        const data = await response.json();
        
        if (data.success) {
            afficherNotification('✅ Code PIN désactivé', 'success');
            // Recharger les paramètres pour mettre à jour l'interface
            await chargerParametres();
        } else {
            afficherNotification('❌ ' + data.message, 'error');
            // En cas d'erreur, remettre la case cochée
            document.getElementById('param-pin-actif').checked = true;
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
        // En cas d'erreur, remettre la case cochée
        document.getElementById('param-pin-actif').checked = true;
    }
}

// Modal pour changer le code PIN
function ouvrirModalChangerPin() {
    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');
    
    content.innerHTML = `
        <h3 class="text-xl font-bold mb-4">🔑 Changer le code PIN</h3>
        <form id="form-changer-pin" class="space-y-4">
            <div class="form-control">
                <label class="label">Ancien code PIN</label>
                <input type="password" id="old-pin" class="input input-bordered text-center text-2xl tracking-widest" maxlength="4" placeholder="****" required>
            </div>
            <div class="form-control">
                <label class="label">Nouveau code PIN</label>
                <input type="password" id="new-pin" class="input input-bordered text-center text-2xl tracking-widest" maxlength="4" placeholder="****" required>
            </div>
            <div class="form-control">
                <label class="label">Confirmer le nouveau code</label>
                <input type="password" id="confirm-pin" class="input input-bordered text-center text-2xl tracking-widest" maxlength="4" placeholder="****" required>
            </div>
            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('modal-universel').close()">Annuler</button>
                <button type="submit" class="btn btn-primary">Changer</button>
            </div>
        </form>
    `;
    
    modal.showModal();
    
    document.getElementById('form-changer-pin').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const oldPin = document.getElementById('old-pin').value;
        const newPin = document.getElementById('new-pin').value;
        const confirmPin = document.getElementById('confirm-pin').value;
        
        if (newPin !== confirmPin) {
            afficherNotification('❌ Les codes ne correspondent pas', 'error');
            return;
        }
        
        if (!/^\d{4}$/.test(newPin)) {
            afficherNotification('❌ Le code doit contenir 4 chiffres', 'error');
            return;
        }
        
        try {
            const response = await fetch('/api/parametres/changer-code/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ancien_code: oldPin, nouveau_code: newPin })
            });
            
            const data = await response.json();
            
            if (data.success) {
                modal.close();
                afficherNotification('✅ Code PIN modifié avec succès !', 'success');
            } else {
                afficherNotification('❌ ' + data.message, 'error');
            }
        } catch (error) {
            console.error('Erreur:', error);
            afficherNotification('❌ Erreur de connexion', 'error');
        }
    });
}

// Vérifier le PIN avant une action sensible
async function verifierPinAvantAction(onSuccess, onCancel) {
    const params = parametresState.parametres;
    
    // Si le PIN n'est pas activé, on autorise directement
    if (!params || !params.code_pin_actif) {
        onSuccess(null);
        return;
    }
    
    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');
    
    content.innerHTML = `
        <h3 class="text-xl font-bold mb-4">🔐 Code PIN requis</h3>
        <p class="text-gray-500 mb-4">Entrez votre code PIN pour effectuer cette action.</p>
        <form id="form-verifier-pin" class="space-y-4">
            <div class="form-control">
                <input type="password" id="pin-input" class="input input-bordered text-center text-3xl tracking-widest" maxlength="4" placeholder="• • • •" required autofocus>
            </div>
            <div id="pin-error" class="text-error text-sm hidden">Code PIN incorrect</div>
            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('modal-universel').close(); ${onCancel ? 'onCancel()' : ''}">Annuler</button>
                <button type="submit" class="btn btn-primary">Valider</button>
            </div>
        </form>
    `;
    
    modal.showModal();
    
    document.getElementById('form-verifier-pin').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const code = document.getElementById('pin-input').value;
        
        try {
            const response = await fetch('/api/parametres/verifier-code/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code })
            });
            
            const data = await response.json();
            
            if (data.valid) {
                modal.close();
                parametresState.codePinVerifie = true;
                // Passer le code vérifié au callback
                onSuccess(code);
            } else {
                document.getElementById('pin-error').classList.remove('hidden');
                document.getElementById('pin-input').value = '';
                document.getElementById('pin-input').focus();
            }
        } catch (error) {
            console.error('Erreur:', error);
            afficherNotification('❌ Erreur de connexion', 'error');
        }
    });
}

// Tester un son
function testerSon(type) {
    const params = parametresState.parametres;
    let sonUrl = '/static/audio/alarm.mp3';  // Par défaut
    
    if (params && params.sons) {
        sonUrl = params.sons[type] || sonUrl;
    }
    
    console.log('🔊 Test son:', type, '→', sonUrl);
    const audio = new Audio(sonUrl);
    audio.play().catch(e => {
        console.error('Erreur lecture son:', e);
        afficherNotification('❌ Impossible de jouer le son', 'error');
    });
}

// Uploader un son
async function uploaderSon(type) {
    const fileInput = document.getElementById(`son-file-${type}`);
    const file = fileInput.files[0];
    
    if (!file) return;
    
    const formData = new FormData();
    formData.append('fichier', file);
    formData.append('type_alerte', type);
    
    try {
        const response = await fetch('/api/parametres/upload-son/', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            afficherNotification('✅ ' + data.message, 'success');
            // Mettre à jour l'affichage
            document.getElementById(`son-${type.replace('_', '-')}-nom`).textContent = data.chemin.split('/').pop();
            // Recharger les paramètres
            await chargerParametres();
            // Recharger les sons dans alarm.js
            if (window.chargerSonsPersonnalises) {
                window.chargerSonsPersonnalises();
            }
        } else {
            afficherNotification('❌ ' + data.message, 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur lors de l\'upload', 'error');
    }
}

// Sauvegarder tous les paramètres
async function sauvegarderParametres() {
    const data = {
        nom_entreprise: document.getElementById('param-nom-entreprise').value,
        telephone_entreprise: document.getElementById('param-telephone').value,
        email_entreprise: document.getElementById('param-email').value,
        adresse_entreprise: document.getElementById('param-adresse').value,
        son_actif: document.getElementById('param-son-actif').checked,
        repetition_alarme: parseInt(document.getElementById('param-repetition').value) || 3,
        notifications_actives: document.getElementById('param-notifications').checked,
        temperature_defaut: parseFloat(document.getElementById('param-temperature').value) || 37.50,
        humidite_defaut: parseInt(document.getElementById('param-humidite').value) || 55
    };
    // NOTE: code_pin, code_pin_actif et les sons sont gérés par des endpoints dédiés
    // On NE les envoie PAS ici pour éviter de les écraser
    
    try {
        const response = await fetch('/api/parametres/update/', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            afficherNotification('✅ Paramètres sauvegardés avec succès !', 'success');
            await chargerParametres();
        } else {
            const error = await response.json();
            afficherNotification('❌ Erreur: ' + JSON.stringify(error), 'error');
        }
    } catch (error) {
        console.error('Erreur:', error);
        afficherNotification('❌ Erreur de connexion', 'error');
    }
}

// Charger les paramètres au démarrage
document.addEventListener('DOMContentLoaded', () => {
    chargerParametres();
});

// ==================== WRAPPERS AVEC VÉRIFICATION PIN ====================

// Vérifier le PIN puis modifier un dépôt
async function verifierPinEtModifier(id) {
    verifierPinAvantAction(() => {
        modifierDepot(id);
    });
}

// Vérifier le PIN puis supprimer un dépôt
async function verifierPinEtSupprimer(id) {
    verifierPinAvantAction(() => {
        supprimerDepot(id);
    });
}
