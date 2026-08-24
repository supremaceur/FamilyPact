/*
 * FamiliPact — service worker.
 *
 * STRATEGIE DE CACHE VOLONTAIREMENT CONSERVATRICE.
 *
 * Aucune donnee familiale n'est mise en cache. Ni un score, ni une tache, ni une
 * sanction : ces informations concernent des mineurs et n'ont rien a faire dans
 * un stockage persistant que l'utilisateur ne controle pas, sur un appareil
 * potentiellement partage.
 *
 * Concretement :
 *   - les requetes vers /api/** sont TOUJOURS en reseau seul, jamais servies
 *     depuis le cache et jamais stockees ;
 *   - les navigations sont en reseau d'abord, avec une page hors-ligne neutre
 *     en repli — jamais une page applicative memorisee ;
 *   - seuls les fichiers statiques immuables de Next (/_next/static/**, dont le
 *     nom contient une empreinte de contenu) et les icones sont mis en cache.
 *
 * Consequence assumee : FamiliPact exige une connexion pour agir. Une file
 * d'attente de mutations hors ligne serait incompatible avec l'integrite du
 * ledger de points (voir docs/architecture.md).
 */

const CACHE_VERSION = 'familipact-v1';
const OFFLINE_URL = '/hors-ligne';

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Ressource statique immuable, sure a mettre en cache indefiniment. */
const isImmutableAsset = (url) =>
  url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Seules les lectures sont eligibles au cache : une mutation part toujours
  // au reseau, sans repli, pour que le serveur reste l'unique source de verite.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Donnees applicatives : reseau seul, aucune trace en cache.
  if (url.pathname.startsWith('/api/')) return;

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
      ),
    );
  }
});
