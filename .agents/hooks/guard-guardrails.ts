// PreToolUse: a person approves each edit to a guardrail file. See docs/contributing/harness-engineering.md#agent-hooks.
import { guardGuardrails } from '@tools/agent-hooks/guard-guardrails';
import { runHook } from '@tools/agent-hooks/payload';

await runHook(guardGuardrails);
