/**
 * The script that each document of a measured journey runs before the app.
 * See measure.ts, which installs it and reads what it sends.
 */

/** The binding that the page script calls, and the flush it defines. */
export const binding = '__clutchMeasure';

/**
 * Runs in each document of the context, before the app. It sends each click,
 * key press and layout shift with no recent input to the binding. A string,
 * since this package's types have no DOM.
 */
export const pageScript = `(() => {
  if (window !== window.top || window.__clutchFlush) return;
  const doc = Math.random().toString(36).slice(2);
  const send = (event) => window.${binding}(event);
  const describe = (node) => {
    const element = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!element) return 'an element that is gone';
    let name = element.tagName.toLowerCase();
    if (element.id) name += '#' + element.id;
    for (const attribute of ['data-testid', 'aria-label']) {
      const value = element.getAttribute(attribute);
      if (value) name += '[' + attribute + '="' + value + '"]';
    }
    const line = (element.innerText || element.textContent || '').trim().split('\\n')[0] || '';
    const text = line.replace(/\\s+/g, ' ').slice(0, 40);
    return text ? name + ' "' + text + '"' : name;
  };
  const shifts = (entries) =>
    entries
      .filter((entry) => !entry.hadRecentInput)
      .map((entry) =>
        send({
          kind: 'shift',
          doc,
          page: location.pathname,
          at: entry.startTime,
          value: entry.value,
          elements: (entry.sources || []).map((source) => describe(source.node)),
        }),
      );
  const observer = new PerformanceObserver((list) => shifts(list.getEntries()));
  observer.observe({ type: 'layout-shift', buffered: true });
  window.__clutchFlush = () => Promise.all(shifts(observer.takeRecords()));
  // An element that a press activates. A press on anything else counts only as a short, still tap.
  const control =
    'a[href], button, input, select, textarea, summary, label, [contenteditable=""], [contenteditable="true"], ' +
    ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option']
      .map((role) => '[role="' + role + '"]')
      .join(', ');
  // One activation in each task, so a label that clicks its field, or a click
  // that sends a form, counts once.
  let counted = false;
  const activate = () => {
    if (counted) return;
    counted = true;
    setTimeout(() => (counted = false), 0);
    send({ kind: 'click' });
  };
  let press = null;
  addEventListener('pointerdown', (event) => {
    if (event.isTrusted && event.isPrimary) press = { x: event.clientX, y: event.clientY, at: event.timeStamp };
  }, true);
  addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const down = press;
    press = null;
    // A key, such as Space or Enter on a button, fires a click with no pointer.
    const fromKey = event.detail === 0;
    const onControl = event.target instanceof Element && event.target.closest(control) !== null;
    const tap =
      down !== null &&
      Math.hypot(event.clientX - down.x, event.clientY - down.y) < 10 &&
      event.timeStamp - down.at < 500;
    if (fromKey || onControl || tap) activate();
  }, true);
  // A choice in a <select> fires no click. A test driver fires the change itself, so it is not trusted.
  addEventListener('change', (event) => {
    if (event.target instanceof HTMLSelectElement) activate();
  }, true);
  // Enter in a form with no submit button sends it with no click.
  addEventListener('submit', (event) => {
    if (event.isTrusted && event.submitter === null) activate();
  }, true);
  // A native control fires a click for Space or Enter. A WAI-ARIA widget, such
  // as a div with role=button, handles the key itself and fires no click.
  // An editor takes Space and Enter as text, so neither is an activation there.
  const native =
    'a[href], button, input, select, textarea, summary, label, [contenteditable=""], [contenteditable="true"]';
  addEventListener('keydown', (event) => {
    if (!event.isTrusted || event.repeat) return;
    send({ kind: 'key', key: event.key });
    const widget = event.target instanceof Element ? event.target.closest(control) : null;
    // Space does not follow a link, so only Enter activates role=link.
    const key = event.key === 'Enter' || (event.key === ' ' && !(widget && widget.matches('[role="link"]')));
    if (key && widget && !widget.matches(native)) activate();
  }, true);
})();`;
