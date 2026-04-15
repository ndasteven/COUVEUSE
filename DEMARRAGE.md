# 🚀 GUIDE DE DÉMARRAGE RAPIDE

## ⚡ En 3 étapes !

### Étape 1 : Vérifier que MySQL tourne

✅ Ouvre **WAMP** et assure-toi qu'il est vert (tous les services démarrés)

---

### Étape 2 : Lancer l'application

**Option A : Utiliser le script automatique** (Recommandé)

```
Double-clique sur : c:\wamp64\www\COUVEUSE\start.bat
```

**Option B : Lancer manuellement**

Ouvre 2 terminaux :

**Terminal 1 - Django :**
```bash
cd c:\wamp64\www\COUVEUSE\backend_django
python manage.py runserver
```

**Terminal 2 - Node.js :**
```bash
cd c:\wamp64\www\COUVEUSE\notifier
npm start
```

---

### Étape 3 : Ouvrir l'application

Dans ton navigateur :
```
http://127.0.0.1:8000/
```

---

## 🎯 Première utilisation

### 1. Se connecter à l'admin

```
http://127.0.0.1:8000/admin/
```

Utilise le superutilisateur que tu as créé.

---

### 2. Ajouter des données

**Dans l'ordre :**

1. **Catégories d'œufs** → Ajouter :
   - Poule (21 jours)
   - Pintade (26 jours)
   - Oie (30 jours)
   - Caille (17 jours)

2. **Races** → Ajouter pour "Poule" :
   - Koeroler
   - Goliath
   - Sasso
   - Brahama

3. **Clients** → Ajouter un client test

4. **Dépôts** → Ajouter un dépôt test
   - Pour tester l'alarme, mets une date telle que :
     `Date mise + Durée incubation = AUJOURD'HUI`

---

### 3. Tester l'alarme

1. Crée un dépôt avec éclosion **aujourd'hui**
2. Retourne à l'accueil : http://127.0.0.1:8000/
3. **L'alarme devrait se déclencher !** 🔔

---

## 🔧 Problèmes courants

### ❌ "ModuleNotFoundError: No module named 'mysql'"

```bash
cd c:\wamp64\www\COUVEUSE\backend_django
python -m pip install mysql-connector-python
```

---

### ❌ "Error: connect ECONNREFUSED 127.0.0.1:3306"

→ MySQL ne tourne pas. Démarre WAMP.

---

### ❌ "Cannot find module 'mysql2'"

```bash
cd c:\wamp64\www\COUVEUSE\notifier
npm install
```

---

### ❌ Le son ne marche pas

1. Clique n'importe où sur la page (requis par les navigateurs)
2. Monte le volume
3. Actualise la page (F5)

---

### ❌ "WebSocket ne se connecte pas"

Vérifie que Node.js tourne :
```bash
cd c:\wamp64\www\COUVEUSE\notifier
npm start
```

Doit afficher :
```
╔═══════════════════════════════════════════════════════════╗
║          🥚 COUVEUSE NOTIFIER - SERVEUR DÉMARRÉ          ║
╠═══════════════════════════════════════════════════════════╣
║  Port: 3001                                               ║
║  WebSocket: Actif                                         ║
║  MySQL: Connecté                                          ║
╚═══════════════════════════════════════════════════════════╝
```

---

## 📊 URLs importantes

| Page | URL |
|------|-----|
| **Accueil** | http://127.0.0.1:8000/ |
| **Admin Django** | http://127.0.0.1:8000/admin/ |
| **API Depots** | http://127.0.0.1:8000/api/depots/ |
| **API Clients** | http://127.0.0.1:8000/api/clients/ |
| **Node.js Health** | http://localhost:3001/health |

---

## 🛑 Arrêter l'application

**Option A :** Double-clique sur `stop.bat`

**Option B :** Ferme les fenêtres de terminal

---

## 📞 Besoin d'aide ?

Ouvre la console du navigateur (F12) et regarde les messages d'erreur.

---

## ✅ Checklist de démarrage

- [ ] WAMP est vert (MySQL tourne)
- [ ] Django tourne (port 8000)
- [ ] Node.js tourne (port 3001)
- [ ] Navigateur ouvert sur http://127.0.0.1:8000/
- [ ] Notifications autorisées dans le navigateur
- [ ] Volume activé

---

## 🎉 C'est prêt !

Bon courage pour la gestion de ta couveuse ! 🥚🐣
