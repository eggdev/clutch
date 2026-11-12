/**
 * The inline boot script of the root HTML. It runs before the first paint.
 *
 * - It marks the start of the app, for the first-load measures.
 * - On a warm visit, a service worker controls the page and holds the sync
 *   chunks. The script preloads them from its cache, so the sync engine starts
 *   sooner. A cold visit never preloads them. The build step
 *   `tools/web/service-worker.ts` fills the list.
 * - It puts the `dark` class on <html> for the stored scheme, or for the
 *   scheme of the system, so the page never flashes.
 *
 * It is plain JavaScript in a string, so the build and the browser render the
 * same text. See docs/principles/fast-first-load.md.
 */
export const bootScript = `performance.mark('appStart');
const syncChunks = [];
if (navigator.serviceWorker && navigator.serviceWorker.controller) {
  for (const href of syncChunks) {
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = href;
    document.head.append(link);
  }
}
try {
  const scheme = localStorage.getItem('scheme');
  const dark = scheme ? scheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
} catch (error) {}`;
