// PreToolUse on shell commands and the iOS Simulator tools: start dev servers only through `bun run dev`, open a device of the shared pool with T3 Code's `device_open`, build native apps only through `bun run native:build`, and hint at `bun run pr` over raw `gh` calls. See docs/contributing/setup/native.md.
import { guardDevServers } from '@tools/agent-hooks/guard-dev-servers';
import { runHook } from '@tools/agent-hooks/payload';

await runHook(guardDevServers);
