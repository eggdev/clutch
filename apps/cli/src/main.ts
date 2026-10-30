#!/usr/bin/env bun
import { clutchVersion } from '@/build';
import { commands, usage } from '@/commands';
import { inClone } from '@/format';

const args = process.argv.slice(2);
const [name = '', ...rest] = args;

async function run(command: string, commandArgs: Array<string>) {
  if (commands[command].clone && !(await inClone())) {
    console.error(
      `clutch ${command} runs from a Clutch clone. Run it with \`bun <clutch clone>/apps/cli/src/main.ts ${command}\`.`,
    );
    return 1;
  }
  return commands[command].run(commandArgs, process.cwd());
}

if (name === '--version') {
  console.log(await clutchVersion());
  process.exit(0);
}
if (Object.hasOwn(commands, name)) {
  if (rest.includes('--help')) {
    console.log(usage([name]));
    process.exit(0);
  }
  process.exit(await run(name, rest));
}
if (args.includes('--help')) {
  console.log(usage());
  process.exit(0);
}
if (name && !name.startsWith('-')) {
  console.error(`Unknown command: ${name}\n\n${usage()}`);
  process.exit(1);
}
process.exit(await run('install', args));
