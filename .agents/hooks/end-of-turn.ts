// Stop: run the fast checks. See docs/contributing/harness-engineering.md#agent-hooks.
import { endOfTurn } from '@tools/agent-hooks/end-of-turn';
import { runHook } from '@tools/agent-hooks/payload';

await runHook((payload, { root }) => endOfTurn(payload, root));
