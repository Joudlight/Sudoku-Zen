/* Sudoku Zen — Service Worker
 *
 * Strategy:
 *   - On install: pre-cache the app shell (HTML, manifest, social JS).
 *   - On fetch:   cache-first for same-origin GET requests; fall back to
 *                 network, then to the cached index.html as a final
 *                 offline fallback for navigations.
 *   - Cross-origin requests (Google Fonts, Supabase CDN, QR server) are
 *     always sent to the network and NEVER cached (they have their own
 *     CDN caching, and caching them risks stale/blocked assets).
 *   - On activate: evict old shell versions from previous deploys.
 *
 * Bump CACHE_VERSION on every deploy that changes index.html — that's
 * what triggers the activate-step cleanup of old caches.
 */

const CACHE_VERSION = 'sudoku-zen-v1';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './sudoku-social.js',
  './sudoku-social-ui.js'
];

// ── Install: pre-cache the app shell ──────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // addAll is atomic — if any single request fails, none are cached.
      // We catch per-asset below to make install resilient to one missing
      // file (e.g. social JS failing to load on a constrained network).
      await Promise.all(
        SHELL_ASSETS.map(async (url) => {
          try { await cache.add(url); } catch (_) { /* skip failed asset */ }
        })
      );
      // Activate immediately — don't wait for the old SW to release.
      await self.skipWaiting();
    })()
  );
});

// ── Activate: clean up old caches + claim clients ─────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// ── Fetch: cache-first for same-origin, network-only for cross-origin ─
self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GET — POST/PUT/etc always go to network.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cross-origin: never cache, always go to network. This covers Google
  // Fonts, the Supabase CDN, the QR-server, and any other third-party
  // resource. They have their own CDN caching; caching them in the SW
  // risks serving stale assets and complicates offline behavior.
  if (url.origin !== self.location.origin) {
    return; // let the browser handle it normally
  }

  // Navigation requests (page loads / reloads): try cache first, fall back
  // to network, then to the cached shell. This makes reloads while offline
  // still work — they serve the cached index.html.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const net = await fetch(req);
          // Network succeeded — refresh the cached shell in the background.
          const cache = await caches.open(CACHE_VERSION);
          cache.put('./index.html', net.clone()).catch(() => {});
          return net;
        } catch (_) {
          const cache = await caches.open(CACHE_VERSION);
          const cached = await cache.match('./index.html');
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Same-origin non-navigation GET (JS, CSS-in-HTML, icons, etc.):
  // cache-first with network fallback, and write-through to cache.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const net = await fetch(req);
        // Only cache successful, basic (same-origin) responses.
        if (net.ok && net.type === 'basic') {
          cache.put(req, net.clone()).catch(() => {});
        }
        return net;
      } catch (_) {
        // Offline and not cached — nothing useful we can return.
        return Response.error();
      }
    })()
  );
});

// ── Message handler: allow the page to trigger an immediate update ────
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
