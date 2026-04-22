/**
 * 🥚 Couveuse Notifier - Serveur de notifications en temps réel
 * Technologies: Node.js + Express + Socket.io + MySQL
 */

process.env.TZ = 'UTC';
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
const cron = require('node-cron');
const cors = require('cors');
const fetch = globalThis.fetch || require('node-fetch');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const TELEGRAM_ENABLED = process.env.TELEGRAM_ENABLED === 'true';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

async function sendTelegramMessage(chatId, text) {
    if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN || !chatId) {
        return false;
    }

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'HTML'
            })
        });

        const result = await response.json();
        if (!result.ok) {
            console.error(`❌ Telegram erreur pour chat_id=${chatId}:`, result);
            return false;
        }
        return true;
    } catch (error) {
        console.error(`❌ Échec Telegram pour chat_id=${chatId}:`, error.message || error);
        return false;
    }
}

// Configuration Socket.io avec CORS
const io = socketIo(server, {
    cors: {
        origin: true,
        methods: ['GET', 'POST'],
        credentials: true
    }
});

const PORT = process.env.PORT || 3001;

const getServerUtcNow = () => {
    const now = new Date();
    return {
        iso: now.toISOString(),
        timestamp: now.getTime()
    };
};

// Configuration MySQL
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'couveuse_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: 'Z'
};

let db;
let connectedClients = new Set();

const serverTimeInterval = setInterval(() => {
    if (connectedClients.size > 0) {
        io.emit('server_time', getServerUtcNow());
    }
}, 1000);

const utcDate = dateValue => {
    if (!dateValue) return null;
    if (dateValue instanceof Date) return new Date(dateValue.toISOString());
    const normalized = String(dateValue).replace(' ', 'T');
    return normalized.endsWith('Z') ? new Date(normalized) : new Date(`${normalized}Z`);
};

const formatUtcDate = (dateValue, locale = 'fr-FR', options = {}) => {
    const date = utcDate(dateValue);
    if (!date || Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(locale, { timeZone: 'UTC', ...options });
};

// Initialisation de la base de données
async function initDB() {
    try {
        db = await mysql.createConnection(dbConfig);
        console.log('✅ Connecté à MySQL');
        
        // Forcer la timezone UTC pour les fonctions de date MySQL (NOW(), CURDATE(), etc.)
        await db.query("SET time_zone = '+00:00'");
        
        // Tester la connexion
        await db.ping();
        console.log('🟢 Connexion MySQL vérifiée');
    } catch (error) {
        console.error('❌ Erreur de connexion MySQL:', error.message);
        setTimeout(initDB, 5000); // Réessayer dans 5 secondes
    }
}

// Middleware
app.use(cors());
app.use(express.json());

// Route de santé
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        clients: connectedClients.size,
        uptime: process.uptime()
    });
});

// Endpoint pour l'heure serveur en UTC
app.get('/server-time', (req, res) => {
    res.json(getServerUtcNow());
});

// Gestion des connexions Socket.io
io.on('connection', (socket) => {
    console.log('🔌 Client connecté:', socket.id);
    connectedClients.add(socket.id);
    
    // Envoyer le nombre de clients connectés
    io.emit('clients_count', connectedClients.size);

    // Envoyer l'heure serveur immédiatement
    socket.emit('server_time', getServerUtcNow());
    
    // Gérer la demande d'alertes initiales
    socket.on('get_initial_alertes', async () => {
        try {
            const alertes = await getAlertesNonLues();

            // Envoyer toutes les alertes non lues
            socket.emit('initial_alertes', alertes);

            // Séparer les alertes en retard (éclosions passées non notifiées)
            const alertesEnRetard = alertes.filter(a => a.en_retard);

            if (alertesEnRetard.length > 0) {
                console.log(`⚠️ Envoi de ${alertesEnRetard.length} alerte(s) en retard au client ${socket.id}`);

                // Envoyer les alertes en retard séparément avec un événement dédié
                socket.emit('alertes_retard', alertesEnRetard);
            }
        } catch (error) {
            console.error('Erreur get_initial_alertes:', error);
        }
    });
    
    // Gérer la déconnexion
    socket.on('disconnect', () => {
        console.log('🔌 Client déconnecté:', socket.id);
        connectedClients.delete(socket.id);
        io.emit('clients_count', connectedClients.size);
    });
    
    // Gérer les erreurs
    socket.on('error', (error) => {
        console.error('Erreur socket:', error);
    });
});

// Récupérer les alertes non lues depuis la BDD
async function getAlertesNonLues() {
    try {
        const [rows] = await db.query(`
            SELECT a.*,
                   CONCAT(c.nom, ' ', IFNULL(c.prenom, ''), ' - ', r.nom, ' (', p.quantite_oeufs, ' œufs)') as depot_nom,
                   c.nom as client_nom,
                   c.prenom as client_prenom,
                   c.telephone as client_telephone,
                   r.nom as race_nom,
                   cat.nom as categorie_nom,
                   pal.numero as palette_numero,
                   p.date_eclosion_prevue,
                   p.date_heure_depôt,
                   DATEDIFF(CURDATE(), p.date_eclosion_prevue) as jours_retard
            FROM couveuse_app_alerte a
            JOIN couveuse_app_depot p ON a.depot_id = p.id
            JOIN couveuse_app_client c ON p.client_id = c.id
            JOIN couveuse_app_race r ON p.race_id = r.id
            JOIN couveuse_app_categorieoeuf cat ON r.categorie_id = cat.id
            LEFT JOIN couveuse_app_palette pal ON p.palette_id = pal.id
            WHERE a.est_lue = FALSE
            ORDER BY a.date_prevue DESC
        `);

        // Marquer les alertes en retard (éclosion passée)
        const alertesAvecRetard = rows.map(alerte => {
            const estEnRetard = alerte.jours_retard > 0 && alerte.type_alerte === 'jour_j';
            return {
                ...alerte,
                en_retard: estEnRetard,
                jours_retard: alerte.jours_retard || 0
            };
        });

        return alertesAvecRetard;
    } catch (error) {
        console.error('Erreur getAlertesNonLues:', error);
        return [];
    }
}

// 🔄 Mettre à jour les statuts des dépôts dont la date d'éclosion est passée
async function mettreAJourStatutsDepasses() {
    try {
        // 1) Récupérer les dépôts qui vont être mis à jour (avant de les modifier)
        const [depotsConcernes] = await db.query(`
            SELECT
                p.id,
                CONCAT(c.nom, ' ', IFNULL(c.prenom, ''), ' - ', r.nom) as depot_nom,
                p.quantite_oeufs,
                p.statut,
                p.date_eclosion_prevue,
                p.date_heure_depôt,
                c.nom as client_nom,
                c.prenom as client_prenom,
                c.telephone as client_telephone,
                r.nom as race_nom,
                cat.nom as categorie_nom,
                cat.duree_incubation_jours,
                pal.numero as palette_numero,
                DATEDIFF(p.date_eclosion_prevue, CURDATE()) as jours_restants
            FROM couveuse_app_depot p
            JOIN couveuse_app_client c ON p.client_id = c.id
            JOIN couveuse_app_race r ON p.race_id = r.id
            JOIN couveuse_app_categorieoeuf cat ON r.categorie_id = cat.id
            LEFT JOIN couveuse_app_palette pal ON p.palette_id = pal.id
            WHERE p.statut = 'en_cours'
            AND p.date_eclosion_prevue < CURDATE()
        `);

        if (depotsConcernes.length === 0) return;

        // 2) Mettre à jour le statut en base
        const [result] = await db.query(`
            UPDATE couveuse_app_depot
            SET statut = 'eclos'
            WHERE statut = 'en_cours'
            AND date_eclosion_prevue < CURDATE()
        `);

        console.log(`🔄 ${result.affectedRows} dépôt(s) automatiquement passé(s) au statut "éclos"`);

        // 3) Créer les alertes pour chaque dépôt passé (sans émettre via WebSocket car le frontend gère via statuts_mis_a_jour)
        const alertesCreees = [];
        for (const depot of depotsConcernes) {
            // Vérifier si l'alerte existe déjà
            const [existing] = await db.query(`
                SELECT id FROM couveuse_app_alerte
                WHERE depot_id = ? AND type_alerte = 'jour_j'
            `, [depot.id]);

            if (existing.length === 0) {
                const joursRetard = Math.abs(depot.jours_restants);
                const clientComplet = depot.client_prenom
                    ? `${depot.client_nom} ${depot.client_prenom}`
                    : depot.client_nom;
                const telephoneInfo = depot.client_telephone
                    ? `📞 ${depot.client_telephone}`
                    : '';
                const paletteInfo = depot.palette_numero
                    ? `🏷️ Palette ${depot.palette_numero}`
                    : '❌ Sans palette';
                const categorieInfo = depot.categorie_nom || '';
                const dateDepotFormatted = formatUtcDate(depot.date_heure_depôt, 'fr-FR', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                });

                const message = `⚠️ ÉCLOSION MANQUÉE - IL Y A ${joursRetard} JOUR(S) !\n` +
                    `👤 Client: ${clientComplet}\n` +
                    `${telephoneInfo}\n` +
                    `🥚 ${depot.quantite_oeufs} œufs de ${depot.race_nom}${categorieInfo ? ` (${categorieInfo})` : ''}\n` +
                    `${paletteInfo}\n` +
                    `📅 Déposé le: ${dateDepotFormatted}`;

                // Insérer l'alerte en base
                const [insertResult] = await db.query(`
                    INSERT INTO couveuse_app_alerte
                    (depot_id, type_alerte, message, date_prevue, est_lue, created_at)
                    VALUES (?, 'jour_j', ?, NOW(), FALSE, NOW())
                `, [depot.id, message]);

                alertesCreees.push({
                    id: insertResult.insertId,
                    depot_id: depot.id,
                    depot_nom: depot.depot_nom,
                    client_nom: depot.client_nom,
                    client_prenom: depot.client_prenom,
                    client_telephone: depot.client_telephone,
                    race_nom: depot.race_nom,
                    categorie_nom: categorieInfo,
                    quantite_oeufs: depot.quantite_oeufs,
                    palette_numero: depot.palette_numero,
                    type_alerte: 'jour_j',
                    message: message,
                    jours_restants: depot.jours_restants,
                    jours_retard: joursRetard,
                    en_retard: true,
                    date_prevue: new Date().toISOString(),
                    est_perso: false
                });

                console.log(`  ⚠️ Alerte rétro-créée: jour_j pour ${clientComplet} (retard: ${joursRetard} jours)`);
            }
        }

        // 4) Notifier les clients connectés avec les alertes créées
        if (alertesCreees.length > 0 && connectedClients.size > 0) {
            console.log(`  📢 Envoi de ${alertesCreees.length} alerte(s) de statut aux clients`);

            // Envoyer via nouvel_eventement pour déclencher l'alarme
            io.emit('statuts_mis_a_jour', {
                count: result.affectedRows,
                message: `${result.affectedRows} dépôt(s) passé(s) au statut "éclos"`,
                alertes: alertesCreees  // Inclure les alertes pour le frontend
            });
        }
    } catch (error) {
        console.error('❌ Erreur mise à jour statuts:', error.message);
    }
}

// Récupérer les dépôts avec leurs informations
async function getDepotsEnCours() {
    try {
        const [rows] = await db.query(`
            SELECT
                p.id,
                CONCAT(c.nom, ' ', IFNULL(c.prenom, ''), ' - ', r.nom) as depot_nom,
                p.quantite_oeufs,
                p.statut,
                p.date_eclosion_prevue,
                p.date_heure_depôt,
                c.nom as client_nom,
                c.prenom as client_prenom,
                c.telephone as client_telephone,
                c.telegram_chat_id as client_telegram_chat_id,
                r.nom as race_nom,
                cat.nom as categorie_nom,
                cat.duree_incubation_jours,
                pal.numero as palette_numero,
                p.alerte_perso_active,
                p.alerte_perso_date,
                p.alerte_perso_message,
                DATEDIFF(p.date_eclosion_prevue, CURDATE()) as jours_restants
            FROM couveuse_app_depot p
            JOIN couveuse_app_client c ON p.client_id = c.id
            JOIN couveuse_app_race r ON p.race_id = r.id
            JOIN couveuse_app_categorieoeuf cat ON r.categorie_id = cat.id
            LEFT JOIN couveuse_app_palette pal ON p.palette_id = pal.id
            WHERE p.statut = 'en_cours'
            ORDER BY p.date_eclosion_prevue ASC
        `);
        return rows;
    } catch (error) {
        console.error('Erreur getDepotsEnCours:', error);
        return [];
    }
}

// Vérifier et envoyer les alertes
async function checkAndSendAlertes() {
    try {
        console.log('🔍 Vérification des alertes...', new Date().toLocaleTimeString('fr-FR', { timeZone: 'UTC' }));
        
        // 🔄 Mettre à jour les statuts des dépôts dont la date d'éclosion est passée
        await mettreAJourStatutsDepasses();
        
        const depots = await getDepotsEnCours();
        const aujourdHui = utcDate(new Date());
        const alertesEnvoyees = [];
        
        for (const depot of depots) {
            const joursRestants = depot.jours_restants;
            const dateEclo = utcDate(depot.date_eclosion_prevue);

            // Calculer la différence en jours
            const diffTime = dateEclo - aujourdHui;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            console.log(`  📦 ${depot.depot_nom} - ${depot.client_nom} - J-${diffDays}`);

            let typeAlerte = null;
            let message = '';

            // Informations détaillées pour le gérant
            const clientComplet = depot.client_prenom
                ? `${depot.client_nom} ${depot.client_prenom}`
                : depot.client_nom;
            const telephoneInfo = depot.client_telephone
                ? `📞 ${depot.client_telephone}`
                : '';
            const paletteInfo = depot.palette_numero
                ? `🏷️ Palette ${depot.palette_numero}`
                : '❌ Sans palette';
            const categorieInfo = depot.categorie_nom || '';
            const dateDepotFormatted = formatUtcDate(depot.date_heure_depôt, 'fr-FR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });

            if (diffDays === 0) {
                typeAlerte = 'jour_j';
                message = `🚨 ÉCLOSION AUJOURD'HUI !\n` +
                    `👤 Client: ${clientComplet}\n` +
                    `${telephoneInfo}\n` +
                    `🥚 ${depot.quantite_oeufs} œufs de ${depot.race_nom}${categorieInfo ? ` (${categorieInfo})` : ''}\n` +
                    `${paletteInfo}\n` +
                    `📅 Déposé le: ${dateDepotFormatted}`;
            } else if (diffDays === 1) {
                typeAlerte = 'j_1';
                message = `⚠️ ÉCLOSION DEMAIN !\n` +
                    `👤 Client: ${clientComplet}\n` +
                    `${telephoneInfo}\n` +
                    `🥚 ${depot.quantite_oeufs} œufs de ${depot.race_nom}${categorieInfo ? ` (${categorieInfo})` : ''}\n` +
                    `${paletteInfo}`;
            } else if (diffDays === 3) {
                typeAlerte = 'j_3';
                message = `📅 Éclosion dans 3 jours\n` +
                    `👤 Client: ${clientComplet}\n` +
                    `${telephoneInfo}\n` +
                    `🥚 ${depot.quantite_oeufs} œufs de ${depot.race_nom}\n` +
                    `${paletteInfo}`;
            } else if (diffDays === 7) {
                typeAlerte = 'j_7';
                message = `📋 Éclosion dans 7 jours\n` +
                    `👤 Client: ${clientComplet}\n` +
                    `${telephoneInfo}\n` +
                    `🥚 ${depot.quantite_oeufs} œufs de ${depot.race_nom}\n` +
                    `${paletteInfo}`;
            }

            // ✅ NOUVEAU : Créer rétroactivement l'alerte jour_j pour les éclosions passées non notifiées
            if (diffDays < 0) {
                // Vérifier si l'alerte jour_j existe déjà
                const [existingJourJ] = await db.query(`
                    SELECT id FROM couveuse_app_alerte
                    WHERE depot_id = ? AND type_alerte = 'jour_j'
                `, [depot.id]);

                if (existingJourJ.length === 0) {
                    // L'éclosion est passée mais aucune alerte jour_j n'a été créée
                    const joursRetard = Math.abs(diffDays);
                    typeAlerte = 'jour_j';
                    message = `⚠️ ÉCLOSION MANQUÉE - IL Y A ${joursRetard} JOUR(S) !\n` +
                        `👤 Client: ${clientComplet}\n` +
                        `${telephoneInfo}\n` +
                        `🥚 ${depot.quantite_oeufs} œufs de ${depot.race_nom}${categorieInfo ? ` (${categorieInfo})` : ''}\n` +
                        `${paletteInfo}\n` +
                        `📅 Déposé le: ${dateDepotFormatted}`;
                    console.log(`  ⚠️ RETRO-CRÉATION alerte jour_j pour ${depot.client_nom} (retard: ${joursRetard} jours)`);
                }
            }

            if (typeAlerte) {
                // Vérifier si l'alerte existe déjà en BDD (lue ou non lue)
                const [existing] = await db.query(`
                    SELECT id FROM couveuse_app_alerte
                    WHERE depot_id = ? AND type_alerte = ?
                `, [depot.id, typeAlerte]);

                if (existing.length === 0) {
                    // Créer l'alerte en BDD
                    await db.query(`
                        INSERT INTO couveuse_app_alerte
                        (depot_id, type_alerte, message, date_prevue, est_lue, created_at)
                        VALUES (?, ?, ?, NOW(), FALSE, NOW())
                    `, [depot.id, typeAlerte, message]);

                    // ✅ Détecter si c'est une alerte en retard (éclosion passée)
                    const estEnRetard = diffDays < 0;

                    alertesEnvoyees.push({
                        id: Date.now() + Math.random(),
                        depot_id: depot.id,
                        depot_nom: depot.depot_nom,
                        client_nom: depot.client_nom,
                        race_nom: depot.race_nom,
                        type_alerte: typeAlerte,
                        message: message,
                        jours_restants: diffDays,
                        jours_retard: estEnRetard ? Math.abs(diffDays) : 0,
                        en_retard: estEnRetard,
                        date_prevue: new Date().toISOString(),
                        est_perso: false
                    });

                    console.log(`  ✅ Alerte créée: ${typeAlerte} pour ${depot.client_nom}${estEnRetard ? ` (RETARD: ${Math.abs(diffDays)} jours)` : ''}`);
                }
            }

            // ✅ Vérifier les alertes personnalisées
            if (depot.alerte_perso_active && depot.alerte_perso_date) {
                const alertePersoDate = utcDate(depot.alerte_perso_date);
                const maintenant = utcDate(new Date());
                const diffMs = alertePersoDate - maintenant;
                const withinWindow = diffMs <= 2 * 60 * 1000 && diffMs >= -2 * 60 * 1000;
                const missedWindow = diffMs < -2 * 60 * 1000;

                if (withinWindow || missedWindow) {
                    console.log(`    🔔 Alerte perso candidate pour ${depot.depot_nom} à ${formatUtcDate(alertePersoDate, 'fr-FR', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit'
                    })} UTC (maintenant ${formatUtcDate(maintenant, 'fr-FR', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit'
                    })} UTC, diffMs=${diffMs})`);

                    // Vérifier si l'alerte perso a déjà été envoyée
                    const [existingPerso] = await db.query(`
                        SELECT id FROM couveuse_app_alerte
                        WHERE depot_id = ? AND type_alerte = 'perso'
                    `, [depot.id]);

                    if (existingPerso.length === 0) {
                        const messagePerso = depot.alerte_perso_message ||
                            `⏰ RAPPEL PERSO : ${depot.client_nom} - ${depot.race_nom} - ${depot.alerte_perso_message}`;

                        // Créer l'alerte perso en BDD
                        await db.query(`
                            INSERT INTO couveuse_app_alerte
                            (depot_id, type_alerte, message, date_prevue, est_lue, created_at)
                            VALUES (?, 'perso', ?, NOW(), FALSE, NOW())
                        `, [depot.id, messagePerso]);

                        alertesEnvoyees.push({
                            id: Date.now() + Math.random(),
                            depot_id: depot.id,
                            depot_nom: depot.depot_nom,
                            client_nom: depot.client_nom,
                            client_telegram_chat_id: depot.client_telegram_chat_id,
                            race_nom: depot.race_nom,
                            type_alerte: 'perso',
                            message: messagePerso,
                            alerte_perso_date: depot.alerte_perso_date,
                            jours_restants: diffDays,
                            date_prevue: new Date().toISOString(),
                            est_perso: true
                        });

                        console.log(`  ⏰ Alerte perso envoyée: ${messagePerso}`);
                    } else {
                        console.log(`    ✅ Alerte perso déjà envoyée pour le dépôt ${depot.depot_nom}`);
                    }
                }
            }
        }
        
        // Envoyer les nouvelles alertes via WebSocket
        if (alertesEnvoyees.length > 0 && connectedClients.size > 0) {
            console.log(`  📢 Envoi de ${alertesEnvoyees.length} alertes aux ${connectedClients.size} clients`);

            io.emit('nouvelles_alertes', alertesEnvoyees);

            // Envoyer aussi une notification push
            alertesEnvoyees.forEach(alerte => {
                if (alerte.type_alerte === 'jour_j') {
                    io.emit('notification_push', {
                        title: '🚨 ÉCLOSION AUJOURD\'HUI !',
                        body: alerte.message,
                        icon: '🚨',
                        urgent: true
                    });
                } else if (alerte.type_alerte === 'perso' && alerte.est_perso) {
                    // Notification push personnalisée avec icône différente
                    io.emit('notification_push', {
                        title: '⏰ RAPPEL PERSONNALISÉ',
                        body: alerte.message,
                        icon: '⏰',
                        urgent: false,
                        est_perso: true
                    });
                }
            });

            const telegramAlerts = alertesEnvoyees.filter(a => a.type_alerte === 'perso');
            for (const alerte of telegramAlerts) {
                if (!alerte.client_telegram_chat_id) {
                    console.log(`    ⚠️ Pas de chat_id Telegram client pour le dépôt ${alerte.depot_nom}`);
                    continue;
                }

                const telegramText = `<b>⏰ Alerte personnalisée</b>\n` +
                    `${alerte.message}\n\n` +
                    `<b>Dépôt</b> : ${alerte.depot_nom}\n` +
                    `<b>Client</b> : ${alerte.client_nom}\n` +
                    `<b>Date alerte</b> : ${formatUtcDate(alerte.alerte_perso_date, 'fr-FR', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit'
                    })} UTC`;

                await sendTelegramMessage(alerte.client_telegram_chat_id, telegramText);
            }
        }
        
        // Mettre à jour le compteur d'alertes
        const [totalAlertes] = await db.query(`
            SELECT COUNT(*) as total FROM couveuse_app_alerte WHERE est_lue = FALSE
        `);
        io.emit('alertes_count', totalAlertes[0].total);
        
    } catch (error) {
        console.error('❌ Erreur checkAndSendAlertes:', error.message);
    }
}

// Planifier la vérification des alertes
// Toutes les minutes
cron.schedule('* * * * *', () => {
    checkAndSendAlertes();
});

// Vérification toutes les heures pour les statistiques
cron.schedule('0 * * * *', async () => {
    console.log('📊 Vérification horaire...');
    const depots = await getDepotsEnCours();
    io.emit('stats_update', {
        total_depots: depots.length,
        total_oeufs: depots.reduce((sum, d) => sum + parseInt(d.quantite_oeufs), 0),
        eclosions_aujourdhui: depots.filter(d => d.jours_restants === 0).length
    });
});

// Démarrer le serveur
async function startServer() {
    await initDB();
    
    server.listen(PORT, () => {
        console.log('');
        console.log('╔═══════════════════════════════════════════════════════════╗');
        console.log('║          🥚 COUVEUSE NOTIFIER - SERVEUR DÉMARRÉ          ║');
        console.log('╠═══════════════════════════════════════════════════════════╣');
        console.log(`║  Port: ${PORT}                                                  ║`);
        console.log('║  WebSocket: Actif                                           ║');
        console.log('║  MySQL: Connecté                                            ║');
        console.log('║  Cron: Vérification toutes les minutes                      ║');
        console.log('╚═══════════════════════════════════════════════════════════╝');
        console.log('');
    });
}

// Gérer la fermeture propre
process.on('SIGINT', async () => {
    console.log('\n🛑 Arrêt du serveur...');
    if (db) {
        await db.end();
    }
    server.close(() => {
        console.log('✅ Serveur arrêté');
        process.exit(0);
    });
});

// Lancer le serveur
startServer();
