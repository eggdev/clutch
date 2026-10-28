import path from 'node:path';

/**
 * Commands are paired files. Each `commands/<name>.ts` has `<name>.server.ts`,
 * and each server half has its client half. The client half says `waits`, and
 * a file in the package's `runtime/` registers the server half. `define` files
 * are the helpers that commands call, not commands. See
 * docs/contributing/architecture/local-first-sync.md#add-a-command.
 */
const helper = /^define(?:\.server)?\.ts$/u;
const test = /\.test\.tsx?$/u;
const waits = /\bwaits:\s*'(?:local|server)'/u;

async function listFiles(root: string, pattern: string): Promise<Array<string>> {
  const files: Array<string> = [];
  for await (const file of new Bun.Glob(pattern).scan({ cwd: root })) {
    if (!file.split('/').includes('node_modules')) {
      files.push(file);
    }
  }
  return files.toSorted();
}

export async function checkCommands(root: string): Promise<Array<string>> {
  const problems: Array<string> = [];
  const all = await listFiles(root, 'packages/*/commands/*.ts');
  const commands = all.filter((file) => !helper.test(path.basename(file)) && !test.test(file));
  const files = new Set(commands);
  const runtimes = new Map<string, string>();
  for (const file of await listFiles(root, 'packages/*/runtime/**/*.{ts,tsx}')) {
    const name = file.split('/')[1];
    runtimes.set(
      name,
      `${runtimes.get(name) ?? ''}\n${await Bun.file(path.join(root, file)).text()}`,
    );
  }
  for (const file of commands) {
    const name = file.split('/')[1];
    if (file.endsWith('.server.ts')) {
      const client = file.replace(/\.server\.ts$/u, '.ts');
      if (!files.has(client)) {
        problems.push(
          `${file}: has no client half. Add \`${path.basename(client)}\` with its input, local change and \`waits\`.`,
        );
      }
      const specifier = `@repo/${name}/commands/${path.basename(file, '.ts')}`;
      if (!runtimes.get(name)?.includes(`'${specifier}'`)) {
        problems.push(
          `${file}: no file in \`packages/${name}/runtime/\` registers it. Import it in \`runtime/handlers.server.ts\` and add it to the list of server changes.`,
        );
      }
      continue;
    }
    const server = file.replace(/\.ts$/u, '.server.ts');
    if (!files.has(server)) {
      problems.push(
        `${file}: has no server half. Add \`${path.basename(server)}\` with the server change.`,
      );
    }
    if (!waits.test(await Bun.file(path.join(root, file)).text())) {
      problems.push(
        `${file}: says no \`waits\`. Set \`waits: 'local'\` to show the change at once, or \`waits: 'server'\` to wait for the server.`,
      );
    }
  }
  return problems;
}

if (import.meta.main) {
  const problems = await checkCommands(process.cwd());
  if (problems.length) {
    console.error(
      [
        `Command check failed (${problems.length}).`,
        'A command is two files with one name. See docs/contributing/architecture/local-first-sync.md#add-a-command.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Each command has its client half, its server half and a registration.');
  }
}
