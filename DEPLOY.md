# 🚀 Guide de Déploiement - VPS Debian

## Architecture de l'application

```
┌─────────────────────────────────────────┐
│           VPS Debian                    │
├─────────────────────────────────────────┤
│  Nginx (Reverse Proxy)                  │
│  Port 80/443                            │
├──────────────┬──────────────────────────┤
│  Django      │  Node.js                 │
│  Gunicorn    │  Socket.io               │
│  Port 8000   │  Port 3001               │
├──────────────┴──────────────────────────┤
│  MySQL / MariaDB                        │
│  Port 3306                              │
└─────────────────────────────────────────┘
```

---

## Étape 1 : Préparation du VPS

### 1.1 Connexion au VPS

```bash
ssh root@votre_vps_ip
```

### 1.2 Mettre à jour le système

```bash
apt update && apt upgrade -y
```

### 1.3 Installer les dépendances système

```bash
apt install -y \
  python3-pip \
  python3-venv \
  nginx \
  mysql-server \
  git \
  curl \
  build-essential
```

---

## Étape 2 : Installer Node.js

```bash
# Installer Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Vérifier
node --version
npm --version
```

---

## Étape 3 : Configurer MySQL / MariaDB

### 3.1 Démarrer MySQL

```bash
systemctl start mysql
systemctl enable mysql
```

### 3.2 Sécuriser MySQL

```bash
mysql_secure_installation
```

Suivez les étapes :
- Définir un mot de passe root
- Supprimer les utilisateurs anonymes
- Désactiver root à distance
- Supprimer la base de test

### 3.3 Créer la base de données et l'utilisateur

```bash
mysql -u root -p
```

Exécutez ces commandes SQL :

```sql
-- Créer la base de données
CREATE DATABASE couveuse_db CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- Créer un utilisateur dédié
CREATE USER 'couveuse_user'@'localhost' IDENTIFIED BY 'VOTRE_MOT_DE_PASSE_FORT';

-- Donner les permissions
GRANT ALL PRIVILEGES ON couveuse_db.* TO 'couveuse_user'@'localhost';

-- Appliquer les changements
FLUSH PRIVILEGES;

-- Quitter
EXIT;
```

---

## Étape 4 : Déployer le code

### 4.1 Créer un utilisateur pour l'application

```bash
adduser --system --group --home /opt/couveuse couveuse
```

### 4.2 Cloner le projet

```bash
mkdir -p /opt/couveuse
cd /opt/couveuse
git clone <URL_DE_VOTRE_REPO> . 
# OU copier les fichiers manuellement via SCP
```

**Alternative avec SCP :**

```bash
# Sur votre machine locale (Windows)
scp -r c:\wamp64\www\projects\COUVEUSE\* root@votre_vps_ip:/opt/couveuse/
```

### 4.3 Ajuster les permissions

```bash
chown -R couveuse:couveuse /opt/couveuse
```

---

## Étape 5 : Configurer le Backend Django

### 5.1 Créer un environnement virtuel

```bash
cd /opt/couveuse/backend_django
python3 -m venv venv
source venv/bin/activate
```

### 5.2 Installer les dépendances

```bash
pip install --upgrade pip
pip install -r requirements.txt
pip install gunicorn  # Serveur de production pour Django
```

### 5.3 Configurer settings.py

Ouvrir `/opt/couveuse/backend_django/couveuse_project/settings.py` et modifier :

```python
# Modifier DEBUG
DEBUG = False

# Ajouter votre domaine
ALLOWED_HOSTS = ['votre_domaine.com', 'votre_vps_ip']

# Configurer la base de données
DATABASES = {
    'default': {
        'ENGINE': 'mysql.connector.django',
        'NAME': 'couveuse_db',
        'USER': 'couveuse_user',
        'PASSWORD': 'VOTRE_MOT_DE_PASSE_FORT',
        'HOST': 'localhost',
        'PORT': '3306',
        'OPTIONS': {
            'init_command': "SET sql_mode='STRICT_TRANS_TABLES'",
            'charset': 'utf8mb4',
        },
    }
}

# Configuration Static Files
STATIC_ROOT = '/opt/couveuse/backend_django/staticfiles'
```

### 5.4 Créer les tables

```bash
cd /opt/couveuse/backend_django
source venv/bin/activate
python manage.py makemigrations
python manage.py migrate
python manage.py createsuperuser  # Créer l'admin
```

### 5.5 Collecter les fichiers statiques

```bash
python manage.py collectstatic --noinput
```

### 5.6 Tester la configuration

```bash
python manage.py check
python manage.py runserver 0.0.0.0:8000
```

Accédez à `http://votre_vps_ip:8000` pour tester.

---

## Étape 6 : Configurer le Serveur Node.js

### 6.1 Installer les dépendances

```bash
cd /opt/couveuse/notifier
npm install
```

### 6.2 Configurer les variables d'environnement

Ouvrir `/opt/couveuse/notifier/.env` :

```env
PORT=3001
DB_HOST=localhost
DB_USER=couveuse_user
DB_PASSWORD=VOTRE_MOT_DE_PASSE_FORT
DB_NAME=couveuse_db
```

### 6.3 Tester le serveur

```bash
npm start
```

Vérifiez que vous voyez :
```
🥚 COUVEUSE NOTIFIER - SERVEUR DÉMARRÉ
```

---

## Étape 7 : Créer les Services Systemd

### 7.1 Service Django (Gunicorn)

Créer `/etc/systemd/system/couveuse-django.service` :

```ini
[Unit]
Description=Couveuse Django Backend
After=network.target mysql.service

[Service]
Type=notify
User=couveuse
Group=couveuse
WorkingDirectory=/opt/couveuse/backend_django
Environment="PATH=/opt/couveuse/backend_django/venv/bin"
ExecStart=/opt/couveuse/backend_django/venv/bin/gunicorn \
  --workers 3 \
  --bind 0.0.0.0:8000 \
  couveuse_project.wsgi:application
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 7.2 Service Node.js

Créer `/etc/systemd/system/couveuse-notifier.service` :

```ini
[Unit]
Description=Couveuse Notifier (Node.js WebSocket)
After=network.target mysql.service

[Service]
Type=simple
User=couveuse
Group=couveuse
WorkingDirectory=/opt/couveuse/notifier
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 7.3 Démarrer les services

```bash
# Recharger systemd
systemctl daemon-reload

# Activer les services au démarrage
systemctl enable couveuse-django
systemctl enable couveuse-notifier

# Démarrer les services
systemctl start couveuse-django
systemctl start couveuse-notifier

# Vérifier le statut
systemctl status couveuse-django
systemctl status couveuse-notifier
```

---

## Étape 8 : Configurer Nginx (Reverse Proxy)

### 8.1 Créer la configuration Nginx

Créer `/etc/nginx/sites-available/couveuse` :

```nginx
server {
    listen 80;
    server_name votre_domaine.com votre_vps_ip;

    # Logs
    access_log /var/log/nginx/couveuse_access.log;
    error_log /var/log/nginx/couveuse_error.log;

    # Django Backend
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_redirect off;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket pour Node.js
    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Fichiers statiques
    location /static/ {
        alias /opt/couveuse/backend_django/staticfiles/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Limite de taille pour uploads
    client_max_body_size 10M;
}
```

### 8.2 Activer le site

```bash
# Créer le lien symbolique
ln -s /etc/nginx/sites-available/couveuse /etc/nginx/sites-enabled/

# Supprimer le site par défaut (optionnel)
rm /etc/nginx/sites-enabled/default

# Tester la configuration
nginx -t

# Redémarrer Nginx
systemctl restart nginx
systemctl enable nginx
```

---

## Étape 9 : (Optionnel) Configurer HTTPS avec Let's Encrypt

### 9.1 Installer Certbot

```bash
apt install -y certbot python3-certbot-nginx
```

### 9.2 Générer le certificat

```bash
certbot --nginx -d votre_domaine.com
```

Suivez les instructions et choisissez de rediriger HTTP vers HTTPS.

### 9.3 Renouvellement automatique

```bash
# Tester le renouvellement
certbot renew --dry-run

# Le cron est automatiquement configuré
# Vérifier avec :
systemctl status certbot.timer
```

---

## Étape 10 : Configurer le Pare-feu (UFW)

```bash
# Installer UFW si nécessaire
apt install -y ufw

# Configurer les règles
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw allow 3306/tcp  # MySQL (optionnel, seulement si accès distant nécessaire)

# Activer le pare-feu
ufw enable

# Vérifier
ufw status
```

---

## Étape 11 : Importer les données de démo (optionnel)

```bash
mysql -u couveuse_user -p couveuse_db < /opt/couveuse/database/demo_data.sql
```

---

## Étape 12 : Monitoring et Logs

### 12.1 Voir les logs

```bash
# Logs Django
journalctl -u couveuse-django -f

# Logs Node.js
journalctl -u couveuse-notifier -f

# Logs Nginx
tail -f /var/log/nginx/couveuse_access.log
tail -f /var/log/nginx/couveuse_error.log
```

### 12.2 Redémarrer les services

```bash
systemctl restart couveuse-django
systemctl restart couveuse-notifier
systemctl restart nginx
```

### 12.3 Arrêter les services

```bash
systemctl stop couveuse-django
systemctl stop couveuse-notifier
```

---

## Checklist de déploiement

- [ ] VPS mis à jour (`apt update && apt upgrade`)
- [ ] Dépendances système installées
- [ ] Node.js installé
- [ ] MySQL/MariaDB installé et sécurisé
- [ ] Base de données `couveuse_db` créée
- [ ] Utilisateur MySQL `couveuse_user` créé
- [ ] Code déployé dans `/opt/couveuse`
- [ ] Environnement virtuel Python créé
- [ ] Dépendances Python installées
- [ ] Migrations Django appliquées
- [ ] Superutilisateur créé
- [ ] Fichiers statiques collectés
- [ ] Service Gunicorn configuré et démarré
- [ ] Service Node.js configuré et démarré
- [ ] Nginx configuré (reverse proxy + WebSocket)
- [ ] Certificat SSL installé (Let's Encrypt)
- [ ] Pare-feu configuré (UFW)
- [ ] Application accessible via HTTP/HTTPS
- [ ] Notifications WebSocket fonctionnelles
- [ ] Logs surveillés

---

## URLs finales

| Service | URL |
|---------|-----|
| Application | `http://votre_domaine.com` |
| Admin Django | `http://votre_domaine.com/admin/` |
| API REST | `http://votre_domaine.com/api/` |
| WebSocket | `ws://votre_domaine.com/ws` |

---

## Dépannage rapide

### Problème : "502 Bad Gateway"

```bash
# Vérifier que Gunicorn tourne
systemctl status couveuse-django

# Vérifier les logs
journalctl -u couveuse-django -n 50
```

### Problème : WebSocket ne se connecte pas

```bash
# Vérifier le service Node.js
systemctl status couveuse-notifier

# Vérifier la config Nginx pour WebSocket
nginx -t
```

### Problème : Erreur de base de données

```bash
# Vérifier que MySQL tourne
systemctl status mysql

# Tester la connexion
mysql -u couveuse_user -p couveuse_db -e "SHOW TABLES;"
```

---

*Guide créé le 15/04/2026 - Compatible Debian 11/12*
