# 🥚 Couveuse Manager - Système de gestion d'incubation

Application web complète pour gérer une couveuse d'œufs avec alertes en temps réel.

---

## 🚀 Démarrage rapide

### 1. Lancer Django (Backend API)

```bash
cd c:\wamp64\www\COUVEUSE\backend_django
python manage.py runserver
```

**URL:** http://127.0.0.1:8000/

---

### 2. Lancer Node.js (Notifications temps réel)

```bash
cd c:\wamp64\www\COUVEUSE\notifier
npm install
npm start
```

**Port:** 3001 (WebSocket)

---

## 📁 Structure du projet

```
COUVEUSE/
├── backend_django/          # Backend Python/Django
│   ├── manage.py
│   ├── couveuse_project/    # Configuration Django
│   ├── couveuse_app/        # Application principale
│   │   ├── models.py        # Modèles de données
│   │   ├── views.py         # API REST
│   │   ├── serializers.py   # Sérialiseurs
│   │   └── templates/       # Templates HTML
│   └── static/              # CSS, JS
│
├── notifier/                # Serveur Node.js
│   ├── server.js            # Serveur WebSocket
│   ├── package.json
│   └── .env
│
└── database/
    └── couveuse.sql         # Script SQL
```

---

## 🔔 Système d'alertes

### Types d'alertes automatiques

| Type | Quand | Action |
|------|-------|--------|
| **J-7** | 7 jours avant | 📋 Rappel surveillance |
| **J-3** | 3 jours avant | 📅 Préparer éclosion |
| **J-1** | 1 jour avant | ⚠️ Alerte demain |
| **Jour J** | Jour même | 🚨 **ALARME SONORE !** |

### Fonctionnalités d'alerte

- ✅ **Notification navigateur** (pop-up)
- ✅ **Alarme sonore** (bip répétitif)
- ✅ **Temps réel** via WebSocket (Node.js)
- ✅ **Backup polling** (30 secondes)
- ✅ **Évite les doublons**
- ✅ **Bouton arrêter l'alarme**

---

## 🛠️ Technologies utilisées

| Composant | Technologie |
|-----------|-------------|
| Backend | Django 5.0 + Python |
| API | Django REST Framework |
| Frontend | HTML + Tailwind CSS + DaisyUI |
| WebSocket | Node.js + Socket.io |
| Base de données | MySQL (via mysql-connector) |
| Notifications | Browser Notification API |

---

## 📊 Fonctionnalités

- ✅ **Tableau de bord** avec statistiques
- ✅ **Gestion des dépôts** d'œufs par client
- ✅ **Suivi des races** (Koeroler, Goliath, Sasso, Brahama...)
- ✅ **Calcul automatique** des dates d'éclosion
- ✅ **Alertes automatiques** J-7, J-3, J-1, Jour J
- ✅ **Notifications sonores** et visuelles
- ✅ **Interface responsive** (mobile, tablette, desktop)
- ✅ **Mode hors ligne** (PWA ready)
- ✅ **Administration Django** incluse

---

## 🔧 Configuration

### Fichier `.env` (notifier/)

```env
PORT=3001
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=couveuse_db
```

### Fichier `settings.py` (Django)

```python
DATABASES = {
    'default': {
        'ENGINE': 'mysql.connector.django',
        'NAME': 'couveuse_db',
        'USER': 'root',
        'PASSWORD': '',
        'HOST': 'localhost',
        'PORT': '3306',
    }
}
```

---

## 🎯 Utilisation

### 1. Ajouter une catégorie d'œuf

- Via l'admin Django: http://127.0.0.1:8000/admin/
- Ou via l'interface dans "Races"

### 2. Ajouter un client

- Menu "Clients" → "Nouveau client"
- Remplir: Nom, Prénom, Téléphone, Email

### 3. Ajouter un dépôt

- Menu "Dépôts" → "Nouveau dépôt"
- Sélectionner: Client, Race, Quantité, Prix
- La date d'éclosion est calculée automatiquement !

### 4. Recevoir les alertes

- Garder l'onglet ouvert
- Autoriser les notifications navigateur
- Activer le son

---

## 🐛 Dépannage

### Le son ne marche pas ?

1. Cliquer n'importe où sur la page (requis par les navigateurs)
2. Vérifier le volume
3. Activer le son dans "Paramètres"

### WebSocket ne se connecte pas ?

```bash
# Vérifier que Node.js tourne
cd c:\wamp64\www\COUVEUSE\notifier
npm start

# Doit afficher:
# 🥚 COUVEUSE NOTIFIER - SERVEUR DÉMARRÉ
```

### Erreur de base de données ?

```bash
# Vérifier que MySQL tourne
# Ouvrir phpMyAdmin: http://localhost/phpmyadmin
# Vérifier que la base 'couveuse_db' existe
```

---

## 📞 Support

Pour toute question ou problème, consultez les logs :

- **Django:** Terminal où `python manage.py runserver` tourne
- **Node.js:** Terminal où `npm start` tourne
- **Navigateur:** F12 → Console

---

## 🎉 Prêt !

Ouvre http://127.0.0.1:8000/ et profite de ton application !
