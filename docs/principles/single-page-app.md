# Single-page app

The web app is a single-page app. The browser renders every route, and a
navigation never asks the host for a page. Speed comes from the data that the
device already has, not from HTML that a server made.

## Rules

- **The browser renders each route.** A new route needs no setting to render
  in the browser. That is the default in every web profile. The Vite config
  of each One app sets `defaultRenderMode: 'spa'` as one string literal, so
  `check-structure` can read it.
- **The root document is the one static file.** It holds `<html>`, `<head>`,
  the inline shell CSS and the boot script. In `apps/app`, it is the root layout
  in `apps/app/app/_layout+ssg.tsx`, which One renders once at build time. A deep
  link paints the shell and the theme before any module loads, and the page
  fills in when its modules arrive.
- **A server render is an exception for one route.** A route renders on the
  server for one of two reasons. A person must see its content without the
  app, such as from a shared link, in a link preview or in a search engine.
  Or HTML from the server makes the screen ready sooner than the browser can,
  such as content that is the same for every person. The route names its
  mode, and its entry in `tools/server-rendered-routes.yaml` names the reason:
  `seen without the app` or `ready sooner`. `check-structure` fails a server
  render that the list does not name.
- **A server render never replaces local data.** A screen that reads the
  account's records renders in the browser from the object pool. HTML from the
  server for such a screen is old the moment it arrives, and it delays the
  first frame that the person can use.
- **The host serves files and a few routes.** It serves the files of the
  build, the static document and the routes that render on the server. Pick
  the host for cost and operations. The host never decides how the app feels.
- **Nothing hangs.** A page is never blank, and no wait goes on without end.
  See [stay at 60 FPS](./stay-at-60-fps.md#rules).

## Why

Pre-rendered HTML makes the first paint of a page fast once. Local data makes
every screen fast, on every visit, offline too. A pre-rendered screen still
waits for its data, so it shows a skeleton where the app could show the last
known records. The static document gives the cold visit its first paint, and
[fast first load](./fast-first-load.md) keeps the first screen small.

## Example

Most routes render in the browser. Two routes render on the server, each for
one of the two reasons:

| Route            | Renders in  | Reason                                                          |
| ---------------- | ----------- | --------------------------------------------------------------- |
| `/projects/:id`  | the browser | It reads the account's records from the object pool             |
| `/settings`      | the browser | It reads the account's records from the object pool             |
| `/shared/:token` | the server  | A person opens it from a text message, with no app              |
| `/pricing`       | build time  | It is the same for every person, so it is ready before a script |

The slow path renders a signed-in screen on the server, then again in the
browser when the records load:

```tsx
// a signed-in route with a server loader
export async function loader({ params }) {
  return fetchProject(params.id); // a request on every visit
}
```

The fast path reads the object pool in the browser. The screen shows the last
known record in the first frame, and the sync engine refreshes it:

```tsx
// the same route, rendered in the browser
export function ProjectRoute({ id }: { id: string }) {
  const project = useRecord(projectModel, id); // no request
  return <ProjectScreen project={project} />;
}
```

## Related

- [Local first](./local-first.md)
- [Stay at 60 FPS](./stay-at-60-fps.md)
- [Fast first load](./fast-first-load.md)
