const CACHE_NAME = "zxh-mdfire-v1";

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json"
];


// ==================================================
// INSTALL
// ==================================================

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});


// ==================================================
// ACTIVATE
// ==================================================

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        );
      })
      .then(() => self.clients.claim())
  );
});


// ==================================================
// SKIP WAITING
// ==================================================

self.addEventListener("message", (event) => {
  if (
    event.data &&
    event.data.type === "SKIP_WAITING"
  ) {
    self.skipWaiting();
  }
});


// ==================================================
// FETCH
// ==================================================

self.addEventListener("fetch", (event) => {

  const request = event.request;

  // Only handle GET requests
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // Never cache API requests
  if (
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  // Never cache external requests
  if (
    url.origin !== self.location.origin
  ) {
    return;
  }


  // --------------------------------------------------
  // HTML navigation
  // Network first → cache fallback
  // --------------------------------------------------

  if (
    request.mode === "navigate"
  ) {

    event.respondWith(
      fetch(request)
        .then((response) => {

          if (
            response &&
            response.ok
          ) {
            const copy =
              response.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(
                  request,
                  copy
                );
              });
          }

          return response;
        })
        .catch(() => {
          return caches.match(
            request
          ).then((cached) => {
            return (
              cached ||
              caches.match(
                "/index.html"
              )
            );
          });
        })
    );

    return;
  }


  // --------------------------------------------------
  // Static assets
  // Cache first → network fallback
  // --------------------------------------------------

  event.respondWith(
    caches.match(request)
      .then((cached) => {

        if (cached) {
          return cached;
        }

        return fetch(request)
          .then((response) => {

            if (
              response &&
              response.ok &&
              response.type === "basic"
            ) {

              const copy =
                response.clone();

              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(
                    request,
                    copy
                  );
                });
            }

            return response;
          });

      })
  );

});
