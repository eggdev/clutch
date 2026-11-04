import { answerFormat } from '@/score/prompt';
import type { Message } from '@/score/prompt';
import type { Label } from '@/score/scorer';

export type Verdict = { label: Label; reason: string };

/** The part of `fetch` that the judge calls. Tests pass a stand-in. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

type Usage = { completion_tokens?: number };
type Reply = { choices?: Array<{ message?: { content?: string | null } }>; usage?: Usage };
type Chunk = { choices?: Array<{ delta?: { content?: string | null } }>; usage?: Usage | null };

/**
 * The content of a reply and its output tokens. A streamed reply is
 * server-sent events, and each `data:` line adds a piece of the content. A
 * server that does not stream sends one JSON reply.
 */
async function readReply(response: Response) {
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
    const reply = (await response.json()) as Reply;
    return {
      content: reply.choices?.[0]?.message?.content ?? '',
      tokens: reply.usage?.completion_tokens,
    };
  }
  let content = '';
  let tokens: number | undefined;
  const take = (line: string) => {
    const data = line.startsWith('data:') ? line.slice(5).trim() : '';
    if (data === '' || data === '[DONE]') {
      return;
    }
    const chunk = JSON.parse(data) as Chunk;
    content += chunk.choices?.[0]?.delta?.content ?? '';
    tokens = chunk.usage?.completion_tokens ?? tokens;
  };
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const part of response.body) {
    buffer += decoder.decode(part, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      take(line);
    }
  }
  take(buffer);
  return { content, tokens };
}

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
  /**
   * The longest wait for one call. A server that loads the model on the first
   * call is slow, and qwen3.8-27b writes about 8 tokens a second.
   */
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
  let outputTokens = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages,
        temperature: 0,
        response_format: { type: 'json_object' },
        // A stream sends data while the model reasons, so no idle timeout
        // closes the connection. Bun's fetch closes it after 5 quiet minutes.
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 1_800_000),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`POST ${url}: HTTP ${response.status}. ${text.slice(0, 500)}`);
    }
    const { content, tokens } = await readReply(response);
    outputTokens += tokens ?? 0;
    const parsed = parseVerdict(content, options.labels);
    if ('verdict' in parsed) {
      const seconds = Math.round((performance.now() - started) / 100) / 10;
      return { ...parsed.verdict, seconds, calls: attempt, outputTokens };
    }
    ({ problem } = parsed);
    messages.push(
      { role: 'assistant', content },
      { role: 'user', content: `That reply is not valid. ${problem} ${answerFormat}` },
    );
  }
  throw new Error(`${options.model} gave no valid verdict in ${attempts} calls. ${problem}`);
}
