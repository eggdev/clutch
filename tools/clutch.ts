import path from 'node:path';

/**
 * Runs the Clutch CLI. In Clutch, that is the source in `apps/cli/`. A project
 * has no `apps/cli/`, so it runs the release binary that mise installs from
 * `github:eggdev/clutch` in `mise.toml`.
 */
const source = path.join(import.meta.dir, '../apps/cli/src/main.ts');
const args = process.argv.slice(2);
const binary = (await Bun.file(source).exists()) ? undefined : Bun.which('clutch');

if (binary === null) {
  console.error(
    'The clutch binary is not installed. Run `mise install`, then run the command with `mise exec --`.',
  );
  process.exit(1);
}
const command = binary ? [binary, ...args] : [process.execPath, source, ...args];
const proc = Bun.spawn(command, {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exit(await proc.exited);
