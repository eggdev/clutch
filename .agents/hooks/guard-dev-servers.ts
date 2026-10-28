// PreToolUse on shell commands: start dev servers only through `bun run dev`. See docs/contributing/setup/local-development.md.
import { guardDevServers } from '@tools/agent-hooks/guard-dev-servers';
import { runHook } from '@tools/agent-hooks/payload';

await runHook(guardDevServers);
