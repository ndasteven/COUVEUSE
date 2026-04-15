// Gestion des alarmes et notifications

let alarmSound = document.getElementById('alarm-sound');
let alarmInterval = null;
let alarmesDejaSonores = new Set(); // Éviter les alarmes en double
let audioDebloque = false; // Suivre si l'audio est débloqué
let sonsPersonnalises = {
    jour_j: '/static/audio/alarm.mp3',
    j_1: '/static/audio/alarm.mp3',
    j_3: '/static/audio/alarm.mp3',
    perso: '/static/audio/alarm.mp3'
};
let sonsCharges = false; // Suivre si les sons sont chargés depuis la BDD

// Préchauffer l'audio au premier clic utilisateur (contourne l'autoplay policy)
document.addEventListener('click', function debloquerAudioGlobal() {
    if (audioDebloque) return;

    console.log('🔓 Déverrouillage audio par interaction utilisateur');

    // Créer un audio silencieux très court pour débloquer le contexte audio
    const audioUnlock = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodLq8Pn5+fn5+fn5+fn5+fn5+Q==');
    audioUnlock.volume = 0.01;
    audioUnlock.play().then(() => {
        audioDebloque = true;
        console.log('✅ Audio débloqué pour toute la session');
    }).catch(() => {
        console.log('⚠️ Audio toujours bloqué');
    });

    document.removeEventListener('click', debloquerAudioGlobal);
}, { once: true });

// Demander la permission pour les notifications
function demanderPermissionNotifications() {
    if (!('Notification' in window)) {
        console.log('❌ Notifications non supportées');
        return false;
    }

    if (Notification.permission === 'granted') {
        console.log('✅ Notifications autorisées');
        return true;
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            console.log('Permission:', permission);
            return permission === 'granted';
        });
    }
    return false;
}

// Afficher une notification navigateur
function afficherNotificationBrowser(title, body, icon = '🥚') {
    if (Notification.permission === 'granted') {
        new Notification(title, {
            body: body,
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><text y="32" font-size="48">' + icon + '</text></svg>',
            requireInteraction: true,
            tag: 'couveuse-alert',
            renotify: true
        });
    }
}

// Charger les sons personnalisés depuis les paramètres
async function chargerSonsPersonnalises() {
    try {
        const response = await fetch('/api/parametres/');
        if (response.ok) {
            const data = await response.json();
            console.log('📦 Réponse brute /api/parametres/:', data);
            
            // L'API ViewSet retourne un format paginé: { count, results: [...] }
            // Ou un objet direct si c'est une vue personnalisée
            let params;
            if (data.results && Array.isArray(data.results)) {
                params = data.results[0];
            } else if (data.sons) {
                params = data;
            } else {
                params = data;
            }
            
            if (params && params.sons) {
                sonsPersonnalises = {
                    jour_j: params.sons.jour_j || '/static/audio/alarm.mp3',
                    j_1: params.sons.j_1 || '/static/audio/alarm.mp3',
                    j_3: params.sons.j_3 || '/static/audio/alarm.mp3',
                    perso: params.sons.perso || '/static/audio/alarm.mp3'
                };
                sonsCharges = true;
                console.log('🔊 Sons personnalisés chargés:', sonsPersonnalises);
            } else {
                console.warn('⚠️ Champ "sons" non trouvé dans la réponse API');
                sonsCharges = true; // Quand même marquer comme chargé (valeurs par défaut)
            }
        }
    } catch (e) {
        console.error('❌ Erreur chargement sons:', e);
    }
}

// Démarrer l'alarme sonore avec son personnalisé
function demarrerAlarme(typeAlerte = 'jour_j') {
    console.log('🚨 [demarrerAlarme] APPELÉ avec type:', typeAlerte);

    const toggleSon = document.getElementById('toggle-son');
    const sonActif = toggleSon ? toggleSon.checked : true;

    console.log('🔊 Son activé dans le toggle:', sonActif);
    console.log('🔓 Audio débloqué:', audioDebloque);

    if (!sonActif) {
        console.log('🔇 Son désactivé par l\'utilisateur');
        return;
    }

    console.log('🔔 Démarrage alarme sonore pour:', typeAlerte);

    // Déterminer quel son jouer selon le type d'alerte
    let sonUrl = sonsPersonnalises.jour_j || '/static/audio/alarm.mp3';
    if (typeAlerte === 'j_1' || typeAlerte === 'j_3') {
        sonUrl = sonsPersonnalises[typeAlerte] || sonsPersonnalises.jour_j || '/static/audio/alarm.mp3';
    } else if (typeAlerte === 'perso') {
        sonUrl = sonsPersonnalises.perso || '/static/audio/alarm.mp3';
    }

    console.log('🎵 URL du son:', sonUrl);

    // Créer un nouvel élément audio avec le son personnalisé
    const audio = new Audio(sonUrl);
    audio.loop = false;
    audio.volume = 1.0;

    console.log('🎶 Tentative de lecture audio...');

    // IMPORTANT: Les navigateurs modernes bloquent l'autoplay audio
    audio.play()
        .then(() => {
            console.log('✅ ALARME JOUÉE AVEC SUCCÈS');
        })
        .catch(e => {
            console.error('❌ ERREUR lecture son:', e.name, e.message);

            if (e.name === 'NotAllowedError') {
                console.log('⚠️ Blocage autoplay détecté!');
                afficherNotificationBrowser(
                    '🔔 Son bloqué',
                    'Cliquez sur la page pour activer le son des alertes',
                    '🔔'
                );

                // Deblocage au prochain clic
                const debloquer = () => {
                    audio.play()
                        .then(() => console.log('✅ Son débloqué et joué!'))
                        .catch(err => console.error('❌ Échec:', err));
                    document.removeEventListener('click', debloquer);
                };
                document.addEventListener('click', debloquer, { once: true });
            }
        });

    // Répéter toutes les 3 secondes
    if (alarmInterval) clearInterval(alarmInterval);
    alarmInterval = setInterval(() => {
        const newAudio = new Audio(sonUrl);
        newAudio.play().catch(e => console.log('Erreur son:', e));
    }, 3000);
    
    // Stocker l'audio pour pouvoir l'arrêter
    alarmSound = audio;
}

// Arrêter l'alarme
function arreterAlarme() {
    console.log('🔕 Arrêt alarme');
    
    if (alarmInterval) {
        clearInterval(alarmInterval);
        alarmInterval = null;
    }
    if (alarmSound) {
        alarmSound.pause();
        alarmSound.currentTime = 0;
    }
}

// Vérifier les alertes critiques
async function verifierAlertesCritiques(alertes) {
    console.log('🔍 Vérification alertes critiques:', alertes.length);
    console.log('🔊 Sons chargés?', sonsCharges);

    // Attendre que les sons soient chargés depuis la BDD (max 3 secondes)
    if (!sonsCharges) {
        console.log('⏳ Attente du chargement des sons...');
        let attempts = 0;
        while (!sonsCharges && attempts < 30) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }
        console.log('🔊 Sons prêts après attente:', sonsCharges);
    }

    const alertesJourJ = alertes.filter(a => a.type_alerte === 'jour_j' && !a.en_retard && !a.message.includes('MANQUÉE') && a.jours_restants >= 0);
    const alertesRetard = alertes.filter(a => (a.type_alerte === 'jour_j' && (a.en_retard || a.message.includes('MANQUÉE') || a.jours_restants < 0)));
    const alertesJ1 = alertes.filter(a => a.type_alerte === 'j_1');
    const alertesPerso = alertes.filter(a => a.type_alerte === 'perso' || a.est_perso);

    // ✅ Traiter d'abord les alertes en retard
    if (alertesRetard.length > 0) {
        const ids = alertesRetard.map(a => `retard-${a.id}`).join('-');

        if (!alarmesDejaSonores.has(ids)) {
            alarmesDejaSonores.add(ids);
            verifierAlertesRetard(alertesRetard);
        }
    }

    // Alarme pour éclosion du jour (priorité maximale)
    if (alertesJourJ.length > 0) {
        const ids = alertesJourJ.map(a => a.id).join('-');

        // Éviter les alarmes en double pour les mêmes alertes
        if (!alarmesDejaSonores.has(ids)) {
            alarmesDejaSonores.add(ids);

            afficherNotificationBrowser(
                '🚨 ÉCLOSION AUJOURD\'HUI !',
                `${alertesJourJ.length} panier(s) à surveiller immédiatement !`,
                '🚨'
            );

            demarrerAlarme();
            afficherModalAlarme(alertesJourJ, 'jour_j');
        }
    }

    // Notification pour J-1 (priorité moyenne)
    if (alertesJ1.length > 0 && alertesJourJ.length === 0) {
        afficherNotificationBrowser(
            '⚠️ Éclosion demain !',
            `${alertesJ1.length} panier(s) éclosent demain`,
            '⚠️'
        );
    }

    // ⏰ Alertes personnalisées
    if (alertesPerso.length > 0) {
        // Jouer le son personnalisé
        demarrerAlarme('perso');

        alertesPerso.forEach(alerte => {
            afficherNotificationBrowser(
                '⏰ RAPPEL PERSONNALISÉ',
                alerte.message,
                '⏰'
            );
        });

        // Afficher le modal
        afficherModalAlarmePerso(alertesPerso);
    }
}

// ✅ NOUVEAU : Vérifier les alertes en retard (éclosions passées manquées)
async function verifierAlertesRetard(alertes) {
    console.log('🔍 Vérification alertes en retard:', alertes.length);
    console.log('🔊 Sons chargés?', sonsCharges);

    // Attendre que les sons soient chargés depuis la BDD (max 3 secondes)
    if (!sonsCharges) {
        console.log('⏳ Attente du chargement des sons...');
        let attempts = 0;
        while (!sonsCharges && attempts < 30) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }
        console.log('🔊 Sons prêts après attente:', sonsCharges);
    }

    if (alertes.length === 0) return;

    // Grouper par jours de retard
    const alertesParRetard = {};
    alertes.forEach(alerte => {
        const jours = alerte.jours_retard || 0;
        if (!alertesParRetard[jours]) {
            alertesParRetard[jours] = [];
        }
        alertesParRetard[jours].push(alerte);
    });

    // Préparer les messages avec le retard
    const alertesModifiees = alertes.map(alerte => {
        const jours = alerte.jours_retard || 0;
        let messageRetard;

        if (jours === 1) {
            messageRetard = `⚠️ ÉCLOSION MANQUÉE - IL Y A 1 JOUR !\n`;
        } else {
            messageRetard = `⚠️ ÉCLOSION MANQUÉE - IL Y A ${jours} JOURS !\n`;
        }

        // Extraire les informations du message original et ajouter le retard
        const lignesOriginales = alerte.message.split('\n').filter(l =>
            !l.startsWith('🚨') && !l.startsWith('⚠️')
        );
        const messageComplet = messageRetard + lignesOriginales.join('\n');

        return {
            ...alerte,
            message: messageComplet,
            jours_retard: jours
        };
    });

    // Déclencher l'alarme sonore
    const ids = alertes.map(a => `retard-${a.id}`).join('-');
    if (!alarmesDejaSonores.has(ids)) {
        alarmesDejaSonores.add(ids);

        const titreNotification = alertes.length === 1
            ? `⚠️ Éclosion manquée il y a ${alertes[0].jours_retard || 1} jour(s) !`
            : `⚠️ ${alertes.length} éclosions manquées !`;

        afficherNotificationBrowser(
            '⚠️ ÉCLOSION(S) MANQUÉE(S) !',
            `${alertes.length} panier(s) ont éclos sans notification. Cliquez pour voir les détails.`,
            '⚠️'
        );

        demarrerAlarme('jour_j');
        afficherModalAlarmeRetard(alertesModifiees);
    }
}

function afficherModalAlarmePerso(alertes) {
    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
        <div class="text-center">
            <div class="text-6xl mb-4">⏰</div>
            <h2 class="text-2xl font-bold text-info mb-4">Rappel Personnalisé</h2>
            <div class="space-y-2 mb-6">
                ${alertes.map(a => `
                    <div class="alert alert-info">
                        <i class="fas fa-clock"></i>
                        <span>${a.message}</span>
                    </div>
                `).join('')}
            </div>
            <button onclick="arreterAlarme(); document.getElementById('modal-universel').close();"
                    class="btn btn-info btn-lg">
                <i class="fas fa-check"></i> Compris !
            </button>
            <button onclick="window.location.reload()"
                    class="btn btn-outline btn-lg ml-2">
                <i class="fas fa-sync"></i> Actualiser
            </button>
        </div>
    `;

    modal.showModal();

    // Fermer le modal si l'utilisateur clique en dehors
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            arreterAlarme();
            modal.close();
        }
    });
}

// ✅ NOUVEAU : Modal pour les alertes en retard (éclosions passées)
function afficherModalAlarmeRetard(alertes) {
    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');

    // Fonction pour formater le message avec les détails
    function formaterMessageAlerteRetard(message) {
        const lignes = message.split('\n');
        return lignes.map(l => {
            if (l.startsWith('⚠️') && l.includes('ÉCLOSION MANQUÉE')) {
                return `<div class="font-bold text-lg text-error mb-2">${l}</div>`;
            } else if (l.startsWith('👤')) {
                return `<div class="text-base py-1 flex items-center gap-2">
                    <i class="fas fa-user text-primary"></i>
                    <strong>${l.replace('👤 ', '')}</strong>
                </div>`;
            } else if (l.startsWith('📞')) {
                const tel = l.replace('📞 ', '');
                return `<div class="text-base py-1 flex items-center gap-2">
                    <i class="fas fa-phone text-success"></i>
                    <a href="tel:${tel}" class="text-primary font-mono hover:underline text-lg">${tel}</a>
                </div>`;
            } else if (l.startsWith('🥚')) {
                return `<div class="text-base py-1 flex items-center gap-2">
                    <i class="fas fa-egg text-warning"></i>
                    ${l.replace('🥚 ', '')}
                </div>`;
            } else if (l.startsWith('🏷️')) {
                return `<div class="mt-2">
                    <span class="badge badge-warning badge-lg">${l.replace('🏷️ ', '')}</span>
                </div>`;
            } else if (l.startsWith('📅 Déposé')) {
                return `<div class="text-sm text-gray-500 mt-2 pt-2 border-t border-base-300">
                    <i class="fas fa-calendar mr-2"></i>${l.replace('📅 ', '')}
                </div>`;
            }
            return `<div class="text-sm">${l}</div>`;
        }).join('');
    }

    content.innerHTML = `
        <div class="text-center">
            <div class="text-6xl mb-4 animate-pulse">⚠️</div>
            <h2 class="text-2xl font-bold text-warning mb-2">🕐 ÉCLOSION(S) MANQUÉE(S) !</h2>
            <p class="text-base mb-6 text-base-content/70">
                Ces éclosions ont eu lieu pendant votre absence.
            </p>

            <div class="text-left space-y-4 mb-6 max-h-[60vh] overflow-y-auto">
                ${alertes.map((a, index) => `
                    <div class="alert alert-warning p-4 rounded-lg shadow-lg border-l-4 border-warning">
                        <div class="flex items-start gap-3">
                            <div class="text-3xl">⚠️</div>
                            <div class="flex-1">
                                ${formaterMessageAlerteRetard(a.message)}
                                ${a.jours_retard ? `<div class="mt-2 badge badge-warning badge-sm">Il y a ${a.jours_retard} jour(s)</div>` : ''}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="flex flex-col sm:flex-row gap-2 justify-center">
                <button onclick="arreterAlarme(); document.getElementById('modal-universel').close();"
                        class="btn btn-warning btn-lg">
                    <i class="fas fa-check"></i> Compris, je vais vérifier
                </button>
                <button onclick="window.location.reload()"
                        class="btn btn-outline btn-lg">
                    <i class="fas fa-sync"></i> Actualiser
                </button>
            </div>
        </div>
    `;

    modal.showModal();

    // Fermer le modal si l'utilisateur clique en dehors
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            arreterAlarme();
        }
    });
}

function afficherModalAlarme(alertes, type) {
    const modal = document.getElementById('modal-universel');
    const content = document.getElementById('modal-content');
    
    const titre = type === 'jour_j' ? '🚨 ÉCLOSION AUJOURD\'HUI !' : '⚠️ Éclosion prochaine';
    const couleur = type === 'jour_j' ? 'text-error' : 'text-warning';
    const alertClass = type === 'jour_j' ? 'alert-error' : 'alert-warning';

    // Fonction pour formater le message avec les détails
    function formaterMessageAlerte(message) {
        const lignes = message.split('\n');
        return lignes.map(l => {
            if (l.startsWith('🚨') || l.startsWith('⚠️') || l.startsWith('📅') || l.startsWith('📋')) {
                return `<div class="font-bold text-lg mb-2">${l}</div>`;
            } else if (l.startsWith('👤')) {
                return `<div class="text-base py-1 flex items-center gap-2">
                    <i class="fas fa-user text-primary"></i> 
                    <strong>${l.replace('👤 ', '')}</strong>
                </div>`;
            } else if (l.startsWith('📞')) {
                const tel = l.replace('📞 ', '');
                return `<div class="text-base py-1 flex items-center gap-2">
                    <i class="fas fa-phone text-success"></i> 
                    <a href="tel:${tel}" class="text-primary font-mono hover:underline text-lg">${tel}</a>
                </div>`;
            } else if (l.startsWith('🥚')) {
                return `<div class="text-base py-1 flex items-center gap-2">
                    <i class="fas fa-egg text-warning"></i> 
                    ${l.replace('🥚 ', '')}
                </div>`;
            } else if (l.startsWith('🏷️')) {
                return `<div class="mt-2">
                    <span class="badge badge-primary badge-lg">${l.replace('🏷️ ', '')}</span>
                </div>`;
            } else if (l.startsWith('❌')) {
                return `<div class="mt-1">
                    <span class="badge badge-ghost badge-md">${l}</span>
                </div>`;
            } else if (l.startsWith('📅 Déposé')) {
                return `<div class="text-sm text-gray-500 mt-2 pt-2 border-t border-base-300">
                    <i class="fas fa-calendar mr-2"></i>${l.replace('📅 ', '')}
                </div>`;
            }
            return `<div class="text-sm">${l}</div>`;
        }).join('');
    }

    content.innerHTML = `
        <div class="text-center">
            <div class="text-6xl mb-4 animate-bounce">${type === 'jour_j' ? '🚨' : '⚠️'}</div>
            <h2 class="text-2xl font-bold ${couleur} mb-6">${titre}</h2>
            
            <div class="text-left space-y-4 mb-6 max-h-[60vh] overflow-y-auto">
                ${alertes.map((a, index) => `
                    <div class="${alertClass} p-4 rounded-lg shadow-lg border-l-4 ${type === 'jour_j' ? 'border-error' : 'border-warning'}">
                        <div class="flex items-start gap-3">
                            <div class="text-3xl">${type === 'jour_j' ? '🚨' : '⚠️'}</div>
                            <div class="flex-1">
                                ${formaterMessageAlerte(a.message)}
                            </div>
                        </div>
                        ${type === 'jour_j' ? '<div class="mt-3 text-error font-bold text-sm"><i class="fas fa-bell mr-2"></i>ACTION IMMÉDIATE REQUISE</div>' : ''}
                    </div>
                `).join('')}
            </div>
            
            <div class="flex flex-col sm:flex-row gap-2 justify-center">
                <button onclick="arreterAlarme(); document.getElementById('modal-universel').close();" 
                        class="btn btn-error btn-lg">
                    <i class="fas fa-bell-slash"></i> Arrêter l'alarme
                </button>
                <button onclick="window.location.reload()" 
                        class="btn btn-outline btn-lg">
                    <i class="fas fa-sync"></i> Actualiser
                </button>
            </div>
        </div>
    `;

    modal.showModal();
    
    // Fermer le modal si l'utilisateur clique en dehors
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            arreterAlarme();
        }
    });
}

// Réinitialiser les alarmes sonores après lecture
function resetAlarmesSonores() {
    alarmesDejaSonores.clear();
    console.log('🔄 Alarmes sonores réinitialisées');
}

// Exporter pour utilisation globale
window.demarrerAlarme = demarrerAlarme;
window.arreterAlarme = arreterAlarme;
window.demanderPermissionNotifications = demanderPermissionNotifications;
window.afficherNotificationBrowser = afficherNotificationBrowser;
window.verifierAlertesCritiques = verifierAlertesCritiques;
window.verifierAlertesRetard = verifierAlertesRetard;
window.resetAlarmesSonores = resetAlarmesSonores;
window.chargerSonsPersonnalises = chargerSonsPersonnalises;

// Charger les sons personnalisés au démarrage
document.addEventListener('DOMContentLoaded', () => {
    chargerSonsPersonnalises();
});
