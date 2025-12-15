// Optimized Service Worker for cache management
// This ensures users always see the latest version of the site

const CACHE_VERSION = 'v-' + Date.now(); // Auto-updated during build
const STATIC_CACHE = 'wtfun-static-' + CACHE_VERSION;
const DYNAMIC_CACHE = 'wtfun-dynamic-' + CACHE_VERSION;
const IMAGE_CACHE = 'wtfun-images-' + CACHE_VERSION;
const FONT_CACHE = 'wtfun-fonts-' + CACHE_VERSION;

// Maximum cache sizes to prevent storage bloat
const MAX_IMAGE_CACHE_SIZE = 100;
const MAX_DYNAMIC_CACHE_SIZE = 50;
const IMAGE_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const FONT_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

// Only cache essential files immediately - lazy load the rest
const STATIC_FILES = [
  '/',
  '/index.html',
  '/dist/main.bundle.js',
  '/css/critical.css'
];

// Preload essential resources in the background during idle time
const BACKGROUND_PRELOAD = [
  '/css/deferred.css',
  '/dist/crm.bundle.js'
];

// Cache strategy per resource type
const CACHE_STRATEGIES = {
  // HTML - Network first (always try to get fresh content)
  html: 'network-first',
  // JS/CSS - Stale-while-revalidate (serve cached, update in background)
  scripts: 'stale-while-revalidate',
  // Images - Cache first with expiration
  images: 'cache-first',
  // Fonts - Cache first (long-lived)
  fonts: 'cache-first',
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
              cacheName !== DYNAMIC_CACHE &&
              cacheName !== IMAGE_CACHE &&
              cacheName !== FONT_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Background preload additional resources
      return caches.open(STATIC_CACHE).then((cache) => {
        console.log('[SW] Background preloading additional resources...');
        return Promise.allSettled(
          BACKGROUND_PRELOAD.map(url =>
            cache.add(url).catch(err => console.log('[SW] Preload skipped:', url))
          )
        );
      });
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

  // Skip API calls, Netlify functions, and external domains (except Netlify Image CDN)
  if (url.pathname.includes('/api/') ||
      (url.pathname.includes('/.netlify/') && !url.pathname.includes('/.netlify/images')) ||
      url.pathname.includes('airtable.com') ||
      (url.hostname !== self.location.hostname && !url.pathname.includes('/.netlify/images'))) {
    return;
  }

  // Determine resource type and apply appropriate strategy
  const isImage = /\.(png|jpg|jpeg|gif|webp|svg|avif)$/i.test(url.pathname) ||
                  url.pathname.includes('/.netlify/images') ||
                  url.hostname.includes('cloudinary.com');
  const isFont = /\.(woff2?|ttf|otf|eot)$/i.test(url.pathname);
  const isScript = /\.(js|mjs)$/i.test(url.pathname);
  const isStyle = /\.css$/i.test(url.pathname);
  const isHTML = request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/';

  // Font caching strategy: Cache-first with 30-day expiration (fonts rarely change)
  if (isFont) {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) => {
        return cache.match(request).then((cached) => {
          if (cached) {
            return cached;
          }

          return fetch(request).then((response) => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(() => new Response('Font unavailable', { status: 404 }));
        });
      })
    );
    return;
  }

  // Image caching strategy: Cache-first with 7-day expiration
  // Also cache Netlify Image CDN responses for faster subsequent loads
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

/**
 * Limit cache size by removing oldest entries
 * @param {string} cacheName - Name of the cache to limit
 * @param {number} maxSize - Maximum number of entries allowed
 */
async function limitCacheSize(cacheName, maxSize) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxSize) {
    // Remove oldest entries (first ones in the list)
    const toDelete = keys.slice(0, keys.length - maxSize);
    await Promise.all(toDelete.map(key => cache.delete(key)));
    console.log(`[SW] Cleaned ${toDelete.length} entries from ${cacheName}`);
  }
}

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

  // Prefetch images for upcoming content
  if (event.data && event.data.type === 'PREFETCH_IMAGES') {
    const images = event.data.images || [];
    if (images.length > 0) {
      event.waitUntil(
        caches.open(IMAGE_CACHE).then((cache) => {
          return Promise.allSettled(
            images.map(url => {
              return cache.match(url).then(cached => {
                if (!cached) {
                  return fetch(url).then(response => {
                    if (response.ok) {
                      const headers = new Headers(response.headers);
                      headers.append('sw-cached-date', new Date().toISOString());
                      return cache.put(url, new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: headers
                      }));
                    }
                  }).catch(() => {});
                }
              });
            })
          );
        }).then(() => {
          // Limit image cache size after prefetching
          return limitCacheSize(IMAGE_CACHE, MAX_IMAGE_CACHE_SIZE);
        })
      );
    }
  }

  // Get cache statistics
  if (event.data && event.data.type === 'GET_CACHE_STATS') {
    event.waitUntil(
      Promise.all([
        caches.open(STATIC_CACHE).then(c => c.keys()).then(k => k.length),
        caches.open(DYNAMIC_CACHE).then(c => c.keys()).then(k => k.length),
        caches.open(IMAGE_CACHE).then(c => c.keys()).then(k => k.length),
        caches.open(FONT_CACHE).then(c => c.keys()).then(k => k.length)
      ]).then(([staticCount, dynamicCount, imageCount, fontCount]) => {
        event.source.postMessage({
          type: 'CACHE_STATS',
          stats: {
            static: staticCount,
            dynamic: dynamicCount,
            images: imageCount,
            fonts: fontCount,
            version: CACHE_VERSION
          }
        });
      })
    );
  }
});
