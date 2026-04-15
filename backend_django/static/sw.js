// Service Worker pour Couveuse Manager - Mode hors ligne

const CACHE_NAME = 'couveuse-v3';
const urlsToCache = [
  '/',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/js/alarm.js',
  // Fichiers vendor pour fonctionnement hors ligne
  '/static/css/vendor/daisyui.min.css',
  '/static/css/vendor/fontawesome-local.css',
  '/static/js/vendor/tailwind.min.js',
  '/static/js/vendor/socket.io.min.js',
  // Webfonts Font Awesome
  '/static/webfonts/fa-solid-900.woff2',
  '/static/webfonts/fa-regular-400.woff2',
  '/static/webfonts/fa-brands-400.woff2',
  // Audio alarme
  '/static/audio/alarm.mp3',
];

// Installation du Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Cache ouvert - Téléchargement des ressources...');
        // Utiliser Promise.allSettled pour ne pas échouer si un fichier manque
        return Promise.allSettled(
          urlsToCache.map(url => 
            cache.add(url).catch(err => {
              console.warn('⚠️ Impossible de mettre en cache:', url, err.message);
              return null;
            })
          )
        );
      })
      .then(() => {
        console.log('✅ Service Worker installé - Mode hors ligne prêt');
      })
  );
  // Forcer l'activation immédiate
  self.skipWaiting();
});

// Activation et nettoyage des anciens caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Suppression ancien cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker activé');
      // Prendre le contrôle immédiatement
      return self.clients.claim();
    })
  );
});

// Interception des requêtes réseau
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ignorer les requêtes API (toujours en ligne si possible)
  if (url.pathname.includes('/api/')) {
    return;
  }

  // Ignorer les requêtes WebSocket
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  // IMPORTANT: Ne pas cacher les fichiers JS en dev (toujours aller chercher la dernière version)
  if (url.pathname.includes('/static/js/')) {
    return; // Laisser le navigateur charger directement depuis le serveur
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - retourner la réponse depuis le cache
        if (response) {
          return response;
        }
        
        // Pas de cache - essayer le réseau
        return fetch(event.request)
          .then(networkResponse => {
            // Vérifier si la réponse est valide
            if (!networkResponse || networkResponse.status !== 200) {
              return networkResponse;
            }
            
            // Cloner la réponse pour la mettre en cache
            const responseToCache = networkResponse.clone();
            
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            
            return networkResponse;
          })
          .catch(err => {
            console.warn('⚠️ Mode hors ligne - Impossible de charger:', event.request.url);
            // Retourner une réponse d'erreur basique
            return new Response('Ressource non disponible hors ligne', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});

// Notification en arrière-plan (quand le navigateur est fermé)
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/')
  );
});

// Gestion des messages du client
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('🥚 Service Worker Couveuse Manager chargé ✅');