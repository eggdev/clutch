#!/usr/bin/env bun
import { commands, usage } from '@/commands';

const args = process.argv.slice(2);
const [name = '', ...rest] = args;

if (Object.hasOwn(commands, name)) {
  if (rest.includes('--help')) {
    console.log(usage([name]));
    process.exit(0);
  }
  process.exit(await commands[name].run(rest, process.cwd()));
}
if (args.includes('--help')) {
  console.log(usage());
  process.exit(0);
}
if (name && !name.startsWith('-')) {
  console.error(`Unknown command: ${name}\n\n${usage()}`);
  process.exit(1);
}
process.exit(await commands.install.run(args, process.cwd()));
