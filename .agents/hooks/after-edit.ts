// PostToolUse: lint the edited files. See docs/contributing/harness-engineering.md#agent-hooks.
import { afterEdit } from '@tools/agent-hooks/after-edit';
import { runHook } from '@tools/agent-hooks/payload';

await runHook((payload, { root }) => afterEdit(payload, root));
