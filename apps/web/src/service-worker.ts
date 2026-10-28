function register() {
  void navigator.serviceWorker.register('/sw.js');
}

/**
 * Registers the service worker after the page loads, in a production build
 * only. The worker precaches the build, so the next visit loads nothing from
 * the network. The build step `tools/web/service-worker.ts` writes `sw.js`.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return;
  }
  // main.tsx awaits the local database first, so the page can already be loaded.
  if (document.readyState === 'complete') {
    register();
  } else {
    addEventListener('load', register);
  }
}
