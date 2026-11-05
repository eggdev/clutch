import { agentKind } from '@/factory/agent';
import { automationKind } from '@/factory/automation';
import { benchmarkKind } from '@/factory/benchmark';
import type { Kind } from '@/factory/common';
import { modelsKind } from '@/factory/models';
import { runnerKind } from '@/factory/runner';
import { scorerKind } from '@/factory/scorer';

/** Each kind of file that the check reads, in the order the docs list them. */
export const kinds: Array<Kind> = [
  agentKind,
  automationKind,
  runnerKind,
  scorerKind,
  benchmarkKind,
  modelsKind,
];
