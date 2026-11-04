import { answerFormat } from '@/score/prompt';
import type { Message } from '@/score/prompt';
import type { Label } from '@/score/scorer';

export type Verdict = { label: Label; reason: string };

/** The part of `fetch` that the judge calls. Tests pass a stand-in. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

type Reply = { choices?: Array<{ message?: { content?: string | null } }> };

/** The verdict in a model's reply, or the reason that the reply is not one. */
export function parseVerdict(
  content: string,
  labels: Array<Label>,
): { verdict: Verdict } | { problem: string } {
  const text = content.replaceAll(/<think>[\s\S]*?<\/think>/gu, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) {
    return { problem: 'The reply has no JSON object.' };
  }
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { problem: 'The JSON object in the reply does not parse.' };
  }
  const { label, reason } = (data ?? {}) as { label?: unknown; reason?: unknown };
  const match = labels.find((item) => item.value === label);
  if (!match) {
    const values = labels.map((item) => item.value).join(', ');
    return { problem: `The label ${JSON.stringify(label)} is not one of: ${values}.` };
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    return { problem: 'The reply has no reason.' };
  }
  return { verdict: { label: match, reason: reason.trim() } };
}

export type JudgeOptions = {
  baseUrl: string;
  model: string;
  messages: Array<Message>;
  labels: Array<Label>;
  /** The longest wait for one call. A server that loads the model on the first call is slow. */
  timeoutMs?: number;
  fetch?: Fetch;
};

/** The number of calls before a judge that gives no valid verdict fails. */
const attempts = 2;

/**
 * Sends the messages to the chat completions route of an OpenAI-compatible
 * server, and returns the label and the reason. When a reply is not a valid
 * verdict, the next call adds the reply and the problem, so the model can fix it.
 */
export async function askJudge(options: JudgeOptions) {
  const send: Fetch = options.fetch ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/u, '')}/chat/completions`;
  const messages = [...options.messages];
  const started = performance.now();
  let problem = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 600_000),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`POST ${url}: HTTP ${response.status}. ${text.slice(0, 500)}`);
    }
    const reply = (await response.json()) as Reply;
    const content = reply.choices?.[0]?.message?.content ?? '';
    const parsed = parseVerdict(content, options.labels);
    if ('verdict' in parsed) {
      const seconds = Math.round((performance.now() - started) / 100) / 10;
      return { ...parsed.verdict, seconds, calls: attempt };
    }
    ({ problem } = parsed);
    messages.push(
      { role: 'assistant', content },
      { role: 'user', content: `That reply is not valid. ${problem} ${answerFormat}` },
    );
  }
  throw new Error(`${options.model} gave no valid verdict in ${attempts} calls. ${problem}`);
}
