# 📖 MANUEL D'INSTALLATION - COUVEUSE MANAGER

## Guide complet pour installer le projet sur une nouvelle machine

---

## 📋 SOMMAIRE

1. [Prérequis système](#1-prérequis-système)
2. [Installation des logiciels requis](#2-installation-des-logiciels-requis)
3. [Téléchargement du projet](#3-téléchargement-du-projet)
4. [Configuration de la base de données](#4-configuration-de-la-base-de-données)
5. [Installation du Backend Django](#5-installation-du-backend-django)
6. [Installation du serveur Node.js](#6-installation-du-serveur-nodejs)
7. [Configuration finale](#7-configuration-finale)
8. [Démarrage de l'application](#8-démarrage-de-lapplication)
9. [Vérification et tests](#9-vérification-et-tests)
10. [Dépannage](#10-dépannage)

---

## 1. PRÉREQUIS SYSTÈME

### Système d'exploitation
- Windows 10 ou 11 (recommandé)
- Linux (Ubuntu 20.04+)
- macOS 10.15+

### Matériel recommandé
- RAM : 4 Go minimum
- Espace disque : 2 Go libres
- Connexion Internet (pour les téléchargements)

---

## 2. INSTALLATION DES LOGICIELS REQUIS

### 2.1 Installer Python 3.10+

**Windows :**
1. Télécharger Python depuis : https://www.python.org/downloads/
2. Exécuter l'installeur
3. ⚠️ **IMPORTANT** : Cocher "Add Python to PATH"
4. Vérifier l'installation :
```bash
python --version
# Doit afficher : Python 3.10.x ou supérieur
```

**Linux/macOS :**
```bash
# Python est généralement préinstallé, vérifier :
python3 --version
```

---

### 2.2 Installer Node.js 18+

**Windows :**
1. Télécharger Node.js LTS depuis : https://nodejs.org/
2. Exécuter l'installeur (inclut npm)
3. Vérifier l'installation :
```bash
node --version
# Doit afficher : v18.x.x ou supérieur
npm --version
# Doit afficher : 9.x.x ou supérieur
```

**Linux (Ubuntu/Debian) :**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**macOS (avec Homebrew) :**
```bash
brew install node
```

---

### 2.3 Installer MySQL

**Option A : WAMP (Windows - Recommandé)**

1. Télécharger WAMP depuis : https://www.wampserver.com/
2. Installer WAMP (inclut Apache, MySQL, PHP)
3. Démarrer WAMP et vérifier que l'icône devient **verte**
4. Accéder à phpMyAdmin : http://localhost/phpmyadmin

**Option B : MySQL Standalone**

1. Télécharger MySQL Community Server : https://dev.mysql.com/downloads/mysql/
2. Installer et configurer le mot de passe root
3. Démarrer le service MySQL

**Option C : XAMPP (Alternative Windows)**

1. Télécharger XAMPP : https://www.apachefriends.org/
2. Installer et démarrer MySQL depuis le panneau de contrôle

**Vérifier MySQL :**
```bash
mysql --version
# Doit afficher : mysql Ver 8.x.x
```

---

### 2.4 Installer Git (Optionnel mais recommandé)

**Windows :**
1. Télécharger depuis : https://git-scm.com/downloads
2. Installer avec les options par défaut

**Vérifier :**
```bash
git --version
```

---

## 3. TÉLÉCHARGEMENT DU PROJET

### Option A : Depuis un dépôt Git
```bash
cd c:\wamp64\www\projects
git clone <url-du-repo> COUVEUSE
```

### Option B : Copie manuelle
Copier le dossier `COUVEUSE` à l'emplacement souhaité, par exemple :
```
c:\wamp64\www\projects\COUVEUSE
```

---

## 4. CONFIGURATION DE LA BASE DE DONNÉES

### 4.1 Créer la base de données

**Méthode 1 : Via phpMyAdmin (WAMP)**

1. Ouvrir http://localhost/phpmyadmin
2. Cliquer sur "Nouvelle base de données"
3. Nom : `couveuse_db`
4. Interclassement : `utf8mb4_general_ci`
5. Cliquer sur "Créer"

**Méthode 2 : Via ligne de commande**

```bash
# Se connecter à MySQL
mysql -u root -p

# Créer la base
CREATE DATABASE couveuse_db CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

# Quitter
EXIT;
```

### 4.2 Noter les identifiants MySQL

| Paramètre | Valeur par défaut (WAMP) |
|-----------|--------------------------|
| Hôte | localhost |
| Port | 3306 |
| Utilisateur | root |
| Mot de passe | *(vide)* |

⚠️ **Si vous avez un mot de passe MySQL personnalisé, notez-le pour la suite.**

---

## 5. INSTALLATION DU BACKEND DJANGO

### 5.1 Ouvrir un terminal dans le dossier backend

```bash
cd c:\wamp64\www\projects\COUVEUSE\backend_django
```

### 5.2 Créer un environnement virtuel (Recommandé)

```bash
# Créer l'environnement virtuel
python -m venv venv

# Activer l'environnement virtuel
# Windows :
venv\Scripts\activate
# Linux/macOS :
source venv/bin/activate

#BASH :
source venv/Scripts/activate


### 5.3 Installer les dépendances Python

```bash
pip install django
pip install djangorestframework
pip install django-cors-headers
pip install mysql-connector-python
pip install python-decouple
```

**Ou créer un fichier requirements.txt et l'installer :**

Créer le fichier `requirements.txt` dans `backend_django/` :
```
Django>=5.0
djangorestframework>=3.14
django-cors-headers>=4.3
mysql-connector-python>=8.0
python-decouple>=3.8
```

Puis installer :
```bash
python.exe -m pip install --upgrade pip
python.exe -m pip install -r requirements.txt

pip install -r requirements.txt
```

### 5.4 Configurer la base de données

Ouvrir le fichier `couveuse_project/settings.py` et vérifier la configuration DATABASES :

```python
DATABASES = {
    'default': {
        'ENGINE': 'mysql.connector.django',
        'NAME': 'couveuse_db',
        'USER': 'root',
        'PASSWORD': '',  # Votre mot de passe MySQL ici
        'HOST': 'localhost',
        'PORT': '3306',
        'OPTIONS': {
            'init_command': "SET sql_mode='STRICT_TRANS_TABLES'",
            'charset': 'utf8mb4',
        },
    }
}
```

⚠️ **Modifier 'PASSWORD' si vous avez défini un mot de passe MySQL.**

### 5.5 Créer les tables de la base de données 

aller dans backend_django 

```bash
# Créer les migrations
python manage.py makemigrations

# Appliquer les migrations
python manage.py migrate
```

### 5.6 Créer un superutilisateur (Admin)

```bash
python manage.py createsuperuser
```

Répondre aux questions :
- Nom d'utilisateur : admin (ou autre)
- Email : admin@example.com
- Mot de passe : ********
- Confirmer le mot de passe : ********

### 5.7 (Optionnel) Insérer des données de démo

Dans phpMyAdmin ou en ligne de commande :
```bash
mysql -u root -p couveuse_db < c:\wamp64\www\projects\COUVEUSE\database\demo_data.sql
```

Ou via phpMyAdmin :
1. Sélectionner la base `couveuse_db`
2. Onglet "Importer"
3. Choisir le fichier `database/demo_data.sql`
4. Cliquer sur "Exécuter"

---

## 6. INSTALLATION DU SERVEUR NODE.JS

### 6.1 Ouvrir un terminal dans le dossier notifier

```bash
cd c:\wamp64\www\projects\COUVEUSE\notifier
```

### 6.2 Installer les dépendances

```bash
npm install
```

Cela installera automatiquement :
- express
- socket.io
- mysql2
- node-cron
- cors
- dotenv

### 6.3 Configurer les variables d'environnement

Le fichier `.env` existe déjà avec cette configuration :

```env
# Configuration du serveur
PORT=3001

# Configuration MySQL
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=couveuse_db
```

⚠️ **Modifier DB_PASSWORD si vous avez un mot de passe MySQL.**

---

## 7. CONFIGURATION FINALE

### 7.1 Vérifier l'arborescence

```
COUVEUSE/
├── backend_django/
│   ├── manage.py
│   ├── couveuse_project/
│   │   └── settings.py
│   ├── couveuse_app/
│   │   ├── models.py
│   │   ├── views.py
│   │   └── templates/
│   └── static/
├── notifier/
│   ├── server.js
│   ├── package.json
│   └── .env
├── database/
│   └── demo_data.sql
├── start.bat
├── stop.bat
└── README.md
```

### 7.2 Tester la connexion à la base de données

**Tester Django :**
```bash
cd c:\wamp64\www\projects\COUVEUSE\backend_django
python manage.py check
```

Si tout est OK : `System check identified no issues (0 silenced).`

---

## 8. DÉMARRAGE DE L'APPLICATION

### 8.1 Démarrage automatique (Windows)

Double-cliquer sur `start.bat` dans le dossier COUVEUSE.

### 8.2 Démarrage manuel

**Terminal 1 - Django :**
```bash
cd c:\wamp64\www\projects\COUVEUSE\backend_django
python manage.py runserver
```

**Terminal 2 - Node.js :**
```bash
cd c:\wamp64\www\projects\COUVEUSE\notifier
npm start
```

### 8.3 Accéder à l'application

| Service | URL |
|---------|-----|
| Application principale | http://127.0.0.1:8000/ |
| Administration Django | http://127.0.0.1:8000/admin/ |
| API REST | http://127.0.0.1:8000/api/ |
| Node.js Health | http://localhost:3001/health |

---

## 9. VÉRIFICATION ET TESTS

### 9.1 Vérifier que tout fonctionne

#### Backend Django
```bash
# Dans le terminal Django, vous devez voir :
Watching for file changes with StatReloader
Performing system checks...

System check identified no issues (0 silenced).
Django version 6.0.x, using settings 'couveuse_project.settings'
Starting development server at http://127.0.0.1:8000/
```

#### Serveur Node.js
```bash
# Dans le terminal Node.js, vous devez voir :
╔═══════════════════════════════════════════════════════════╗
║          🥚 COUVEUSE NOTIFIER - SERVEUR DÉMARRÉ          ║
╠═══════════════════════════════════════════════════════════╣
║  Port: 3001                                               ║
║  WebSocket: Actif                                         ║
║  MySQL: Connecté                                          ║
╚═══════════════════════════════════════════════════════════╝
```

### 9.2 Tester l'application

1. **Ouvrir** http://127.0.0.1:8000/
2. **Vérifier** que la page d'accueil s'affiche
3. **Aller** à http://127.0.0.1:8000/admin/
4. **Se connecter** avec le superutilisateur créé
5. **Vérifier** que l'interface d'administration fonctionne

### 9.3 Tester les alertes (avec données de démo)

1. Créer un dépôt avec une date d'éclosion = aujourd'hui
2. Retourner à l'accueil
3. L'alarme doit se déclencher 🔔

---

## 10. DÉPANNAGE

### ❌ Erreur : "ModuleNotFoundError: No module named 'django'"

**Solution :** Installer Django
```bash
pip install django
```

---

### ❌ Erreur : "ModuleNotFoundError: No module named 'mysql'"

**Solution :** Installer le connecteur MySQL
```bash
pip install mysql-connector-python
```

---

### ❌ Erreur : "Error: connect ECONNREFUSED 127.0.0.1:3306"

**Cause :** MySQL ne tourne pas

**Solution :**
- Démarrer WAMP (l'icône doit être verte)
- Ou démarrer le service MySQL

---

### ❌ Erreur : "Access denied for user 'root'@'localhost'"

**Cause :** Mot de passe MySQL incorrect

**Solution :**
1. Ouvrir `backend_django/couveuse_project/settings.py`
2. Modifier le mot de passe dans DATABASES
3. Faire de même dans `notifier/.env`

---

### ❌ Erreur : "Cannot find module 'mysql2'"

**Solution :**
```bash
cd c:\wamp64\www\projects\COUVEUSE\notifier
npm install
```

---

### ❌ Erreur : "Port 8000 is already in use"

**Cause :** Une autre application utilise le port 8000

**Solution 1 :** Fermer l'autre application

**Solution 2 :** Utiliser un autre port
```bash
python manage.py runserver 8001
```

---

### ❌ Le son ne fonctionne pas

**Solutions :**
1. Cliquer n'importe où sur la page (requis par les navigateurs)
2. Vérifier le volume de l'ordinateur
3. Autoriser le son dans le navigateur
4. Rafraîchir la page (F5)

---

### ❌ WebSocket ne se connecte pas

**Vérifications :**
1. Le serveur Node.js doit tourner
2. Vérifier la console du navigateur (F12 → Console)
3. Vérifier qu'aucun pare-feu ne bloque le port 3001

---

## 📋 CHECKLIST D'INSTALLATION

Imprimez cette liste et cochez chaque étape :

- [ ] Python 3.10+ installé
- [ ] Node.js 18+ installé
- [ ] MySQL/WAMP installé et démarré
- [ ] Base de données `couveuse_db` créée
- [ ] Projet téléchargé/copié
- [ ] Environnement virtuel Python créé et activé
- [ ] Dépendances Python installées
- [ ] Migrations Django appliquées
- [ ] Superutilisateur créé
- [ ] Dépendances Node.js installées (`npm install`)
- [ ] Fichiers de configuration vérifiés (settings.py, .env)
- [ ] Serveur Django démarré (port 8000)
- [ ] Serveur Node.js démarré (port 3001)
- [ ] Application accessible à http://127.0.0.1:8000/
- [ ] Admin accessible à http://127.0.0.1:8000/admin/
- [ ] Notifications et sons testés

---

## 🔄 MISE À JOUR DU PROJET

Pour mettre à jour le projet après des modifications :

```bash
# Backend
cd c:\wamp64\www\projects\COUVEUSE\backend_django
python manage.py makemigrations
python manage.py migrate

# Si nouvelles dépendances Python
pip install -r requirements.txt

# Node.js
cd c:\wamp64\www\projects\COUVEUSE\notifier
npm install
```

---

## 📞 SUPPORT

En cas de problème :

1. **Vérifier les logs :**
   - Django : Terminal où `python manage.py runserver` tourne
   - Node.js : Terminal où `npm start` tourne
   - Navigateur : F12 → Console

2. **Redémarrer les services :**
   - Arrêter avec `stop.bat` ou fermer les terminaux
   - Redémarrer avec `start.bat`

3. **Vérifier MySQL :**
   - WAMP doit être vert
   - phpMyAdmin doit être accessible

---

## 🎉 FIN DE L'INSTALLATION

Félicitations ! Votre application COUVEUSE MANAGER est prête.

Ouvrez http://127.0.0.1:8000/ et commencez à gérer votre couveuse ! 🥚🐣

---

*Document créé le 10/04/2026 - Version 1.0*