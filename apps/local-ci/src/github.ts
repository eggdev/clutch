/** The token of the service: the `gh` login of its user. No job mounts that login. */
export function readToken() {
  const run = Bun.spawnSync(['gh', 'auth', 'token']);
  if (run.exitCode !== 0) {
    throw new Error('gh auth token failed. Run gh auth login as the user of the service.');
  }
  return run.stdout.toString().trim();
}

/** One GitHub REST call, tried 3 times. An error names the status and the path, never the token. */
export async function api(token: string, method: string, route: string, body?: unknown) {
  let problem = '';
  for (const wait of [0, 2000, 8000]) {
    await Bun.sleep(wait);
    try {
      const response = await fetch(`https://api.github.com${route}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        return await response.json();
      }
      problem = `GitHub answered ${response.status} to ${method} ${route}`;
      if (response.status < 500) {
        break;
      }
    } catch (error) {
      problem = `${method} ${route} did not reach GitHub: ${String(error)}`;
    }
  }
  throw new Error(problem);
}
