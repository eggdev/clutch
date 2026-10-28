# Fast first load

Ship less code, in more pieces, in one parallel batch. The first visit loads
only what paints the first screen. The second visit loads nothing from the
network.

## Rules

- Build for current browsers only. Ship no legacy syntax and no polyfills.
- Split code by route. Put each dependency in its own chunk, so a version bump
  changes one cached file and keeps the others.
- Declare each chunk that the first screen needs in the HTML `<head>` with
  `modulepreload`. The browser fetches them in parallel, with no import
  waterfall. Each preload uses the same `crossorigin` value as the entry
  script, so the browser reuses the fetch.
- Never preload the sync chunk on a cold visit. It holds the Effect code, and
  it loads after the first paint. The first screen holds no Effect code.
- After the first load, a service worker precaches every file of the build:
  the page, each chunk and each style sheet. A warm visit reads each of them
  from the cache, the sync chunk too.
- On a warm visit, the service worker controls the page. The boot script then
  adds a `modulepreload` for each sync chunk, from the cache. The build writes
  the chunk names into the boot script.
- Inline the CSS that paints the app shell. An inline script reads the last
  shell settings from device storage, such as the theme and the sidebar width.
  It applies them before the first paint. This boot script in `index.html` is
  the one place outside `packages/sync` that reads device storage.
- The boot script marks the app start with `performance.mark('appStart')`, as
  its first line.
- Use one variable font file for each family. Preload it with
  `crossorigin="anonymous"` and declare it with `font-display: swap`.
- Each budget in [client performance](../contributing/architecture/client-performance.md)
  has a check. A change that breaks a budget fails CI.

## Example

The `<head>` paints the shell and starts every critical fetch at once:

```html
<style>
  :root {
    --bg: #fcfcfd;
    --sidebar-width: 244px;
  }
  html {
    background: var(--bg);
  }
</style>
<script>
  performance.mark('appStart');
  const syncChunks = ['/assets/transport-C9dwMqnR.js']; // the build writes the list
  if (navigator.serviceWorker?.controller) {
    for (const href of syncChunks) {
      const link = document.createElement('link');
      link.rel = 'modulepreload';
      link.href = href;
      document.head.append(link);
    }
  }
  const shell = JSON.parse(localStorage.getItem('shell') ?? '{}');
  if (shell.dark) document.documentElement.classList.add('dark');
  if (shell.sidebarWidth)
    document.documentElement.style.setProperty('--sidebar-width', `${shell.sidebarWidth}px`);
</script>
<link rel="preload" href="/fonts/sans.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
<script type="module" crossorigin src="/assets/entry.js"></script>
<link rel="modulepreload" crossorigin href="/assets/react-dom.js" />
<link rel="modulepreload" crossorigin href="/assets/router.js" />
```

## Related

- [Local first](./local-first.md)
- [Fix the root bottleneck](./fix-the-root-bottleneck.md)
