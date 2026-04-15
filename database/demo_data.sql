-- 🥚 Couveuse Manager - Données de démo
-- Exécuter dans phpMyAdmin ou en ligne de commande

USE couveuse_db;

-- Insérer des palettes (ex: 12 palettes)
INSERT INTO couveuse_app_palette (numero) VALUES
(1), (2), (3), (4), (5), (6),
(7), (8), (9), (10), (11), (12);

-- Insérer des catégories d'œufs
INSERT INTO couveuse_app_categorieoeuf (nom, duree_incubation_jours, temperature_recommandee, humidite_recommandee, description) VALUES
('Poule', 21, 37.50, 55, 'Œufs de poule domestique'),
('Pintade', 26, 37.50, 60, 'Œufs de pintade'),
('Oie', 30, 37.50, 65, 'Œufs d''oie'),
('Caille', 17, 37.50, 55, 'Œufs de caille'),
('Canard', 28, 37.50, 60, 'Œufs de canard'),
('Dinde', 28, 37.50, 60, 'Œufs de dinde');

-- Insérer des races pour les poules
INSERT INTO couveuse_app_race (categorie_id, nom, description) VALUES
(1, 'Koeroler', 'Poule locale rustique'),
(1, 'Goliath', 'Race à croissance rapide'),
(1, 'Sasso', 'Poulet de chair robuste'),
(1, 'Brahama', 'Grande race ornementale'),
(1, 'Poule Locale', 'Race locale traditionnelle');

-- Insérer des races pour les pintades
INSERT INTO couveuse_app_race (categorie_id, nom, description) VALUES
(2, 'Pintade Locale', 'Pintade commune'),
(2, 'Pintade Blanche', 'Variété blanche');

-- Insérer des races pour les oies
INSERT INTO couveuse_app_race (categorie_id, nom, description) VALUES
(3, 'Oie de Toulouse', 'Grosse race française'),
(3, 'Oie Locale', 'Race locale');

-- Insérer un client de démo
INSERT INTO couveuse_app_client (nom, prenom, telephone, telephone_2, email, adresse, notes, est_actif, date_inscription) VALUES
('Kouassi', 'Jean', '0102030405', '0708091011', 'jean.kouassi@email.com', 'Abidjan, Cocody', 'Client fidèle', 1, NOW()),
('Konan', 'Marie', '0203040506', '', 'marie.konan@email.com', 'Abidjan, Yopougon', '', 1, NOW()),
('Diarra', 'Moussa', '0304050607', '0809101112', '', 'Abidjan, Adjamé', 'Préfère les œufs de pintade', 1, NOW());

-- Insérer un dépôt de démo (éclosion aujourd'hui pour tester l'alarme)
-- Ajuster la date selon la date actuelle
INSERT INTO couveuse_app_depot (client_id, race_id, palette_id, date_heure_depôt, quantite_oeufs, quantite_eclos, montant_percu, prix_unitaire, statut, date_eclosion_prevue, remarque, created_at) VALUES
(1, 1, 1, DATE_SUB(NOW(), INTERVAL 21 DAY), 50, 0, 25000, 500, 'en_cours', DATE(NOW()), 'Test alarme - Éclosion aujourd''hui', NOW()),
(1, 2, 2, DATE_SUB(NOW(), INTERVAL 20 DAY), 30, 0, 15000, 500, 'en_cours', DATE_ADD(NOW(), INTERVAL 1 DAY), 'Éclosion demain', NOW()),
(2, 3, 3, DATE_SUB(NOW(), INTERVAL 18 DAY), 20, 0, 10000, 500, 'en_cours', DATE_ADD(NOW(), INTERVAL 3 DAY), 'J-3', NOW()),
(3, 4, 10, DATE_SUB(NOW(), INTERVAL 10 DAY), 100, 0, 30000, 300, 'en_cours', DATE_ADD(NOW(), INTERVAL 7 DAY), 'J-7', NOW());

-- Afficher un récapitulatif
SELECT '✅ Données de démo insérées avec succès !' as Resultat;

-- Vérifier les dépôts
SELECT
    d.id,
    c.nom as client,
    r.nom as race,
    pal.numero as palette,
    d.quantite_oeufs,
    d.date_heure_depôt,
    d.date_eclosion_prevue,
    DATEDIFF(d.date_eclosion_prevue, CURDATE()) as jours_restants,
    d.statut
FROM couveuse_app_depot d
JOIN couveuse_app_client c ON d.client_id = c.id
JOIN couveuse_app_race r ON d.race_id = r.id
LEFT JOIN couveuse_app_palette pal ON d.palette_id = pal.id
ORDER BY d.date_eclosion_prevue;
