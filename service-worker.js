// Optimized Service Worker for cache management
// This ensures users always see the latest version of the site

const CACHE_VERSION = 'v-1763793234723'; // Dynamically set based on build time
const STATIC_CACHE = 'wtfun-static-' + CACHE_VERSION;
const DYNAMIC_CACHE = 'wtfun-dynamic-' + CACHE_VERSION;
const IMAGE_CACHE = 'wtfun-images-' + CACHE_VERSION;

// Only cache essential files immediately - lazy load the rest
const STATIC_FILES = [
  '/',
  '/index.html',
  '/main.js',
  '/css/critical.css'
];

// Cache strategy per resource type
const CACHE_STRATEGIES = {
  // HTML - Network first (always try to get fresh content)
  html: 'network-first',
  // JS/CSS - Stale-while-revalidate (serve cached, update in background)
  scripts: 'stale-while-revalidate',
  // Images - Cache first with expiration
  images: 'cache-first',
  // API calls - Network only (never cache)
  api: 'network-only'
};

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...', CACHE_VERSION);
  
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_FILES).catch((err) => {
        console.warn('[SW] Failed to cache some assets:', err);
      });
    }).then(() => {
      return self.skipWaiting(); // Activate immediately
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating new service worker...', CACHE_VERSION);
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete all caches that don't match current version
          if (cacheName.startsWith('wtfun-') && 
              cacheName !== STATIC_CACHE && 
              cacheName !== DYNAMIC_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim(); // Take control of all pages immediately
    })
  );
});

// Fetch event - Smart caching strategies based on resource type
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip API calls, Netlify functions, and external domains
  if (url.pathname.includes('/api/') ||
      url.pathname.includes('/.netlify/') ||
      url.pathname.includes('airtable.com') ||
      url.pathname.includes('cloudinary.com') ||
      url.hostname !== self.location.hostname) {
    return;
  }

  // Determine resource type and apply appropriate strategy
  const isImage = /\.(png|jpg|jpeg|gif|webp|svg|avif)$/i.test(url.pathname);
  const isScript = /\.(js|mjs)$/i.test(url.pathname);
  const isStyle = /\.css$/i.test(url.pathname);
  const isHTML = request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/';

  // Image caching strategy: Cache-first with 7-day expiration
  if (isImage) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then((cache) => {
        return cache.match(request).then((cached) => {
          if (cached) {
            // Check if cached image is less than 7 days old
            const cachedDate = new Date(cached.headers.get('sw-cached-date'));
            const now = Date.now();
            if (now - cachedDate < 7 * 24 * 60 * 60 * 1000) {
              return cached;
            }
          }

          // Fetch new image and cache it
          return fetch(request).then((response) => {
            if (response.ok) {
              const responseToCache = response.clone();
              const headers = new Headers(responseToCache.headers);
              headers.append('sw-cached-date', new Date().toISOString());

              cache.put(request, new Response(responseToCache.body, {
                status: responseToCache.status,
                statusText: responseToCache.statusText,
                headers: headers
              }));
            }
            return response;
          }).catch(() => cached || new Response('Image unavailable', { status: 404 }));
        });
      })
    );
    return;
  }

  // JS/CSS caching strategy: Stale-while-revalidate
  if (isScript || isStyle) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) => {
        return cache.match(request).then((cached) => {
          const fetchPromise = fetch(request).then((response) => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(() => cached);

          // Return cached immediately if available, fetch in background
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // HTML caching strategy: Network-first with timeout
  if (isHTML) {
    event.respondWith(
      Promise.race([
        fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, responseClone);
            }).catch((err) => {
              console.warn('[SW] Failed to cache HTML response:', err);
            });
          }
          return response;
        }),
        new Promise((resolve, reject) =>
          setTimeout(() => reject(new Error('Network timeout')), 3000)
        )
      ]).catch(() => {
        return caches.match(request).then((cached) => {
          return cached || new Response('Offline - content not available', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'Content-Type': 'text/html' })
          });
        });
      })
    );
    return;
  }

  // Default strategy: Network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const responseToCache = response.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          return cached || new Response('Offline - content not available', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'Content-Type': 'text/plain' })
          });
        });
      })
  );
});

// Listen for messages from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName.startsWith('wtfun-')) {
              return caches.delete(cacheName);
            }
          })
        );
      }).then(() => {
        return self.clients.matchAll();
      }).then((clients) => {
        clients.forEach(client => client.postMessage({ type: 'CACHE_CLEARED' }));
      })
    );
  }
});
