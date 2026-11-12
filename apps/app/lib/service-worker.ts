function register() {
  void navigator.serviceWorker.register('/sw.js');
}

/**
 * Registers the service worker after the page loads, in a production build
 * of the web only. The worker precaches the build, so the next visit loads
 * nothing from the network. The build step `tools/web/service-worker.ts`
 * writes `sw.js`. The native bundler picks `service-worker.native.ts`.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return;
  }
  // The app reads the local database first, so the page can already be loaded.
  if (document.readyState === 'complete') {
    register();
  } else {
    addEventListener('load', register);
  }
}
