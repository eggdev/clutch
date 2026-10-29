// PreToolUse on shell commands and the iOS Simulator tools: start dev servers only through `bun run dev`, reuse the booted device, and build native apps only through `bun run native:build`. See docs/contributing/setup/native.md.
import { guardDevServers } from '@tools/agent-hooks/guard-dev-servers';
import { runHook } from '@tools/agent-hooks/payload';

await runHook(guardDevServers);
