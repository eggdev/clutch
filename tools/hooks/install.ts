/**
 * Points Git at the hooks in .githooks/. The root `prepare` script runs this on
 * each `bun install`. Outside a Git work tree, such as a source archive, there
 * are no hooks to install.
 */
const inWorkTree = Bun.spawnSync(['git', 'rev-parse', '--is-inside-work-tree']).exitCode === 0;
if (inWorkTree) {
  const set = Bun.spawnSync(['git', 'config', 'core.hooksPath', '.githooks']);
  if (set.exitCode !== 0) {
    console.error(`Could not set core.hooksPath: ${set.stderr.toString().trim()}`);
    process.exit(1);
  }
}
