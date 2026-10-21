/**
 * Retirement stub for the former offline service worker (cached shell,
 * RPC data, and assets served while offline — see git history). The site
 * runs on Vercel and is always reachable, so nothing is saved for offline
 * use anymore.
 *
 * The stub exists only to clean up visitors whose browser still has the
 * old worker registered: on their next navigation the browser fetches this
 * script, sees it differs, and swaps it in. The activate handler deletes
 * every cache the old worker owned and unregisters the worker, after which
 * this URL is just an inert static file and new visitors never register
 * anything. There is deliberately no fetch handler, so a worker in transition
 * answers nothing and every request goes to the network.
 */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name.startsWith("tabquest-"))
          .map((name) => caches.delete(name))
      )
      await self.registration.unregister()
    })()
  )
})
