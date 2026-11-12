import type { Page } from '@playwright/test';

/**
 * Calls an agent tool the way an agent does: `POST /mcp` with a JSON-RPC
 * `tools/call`. The request uses the request context of the page, so it has
 * the cookies of the browser context, and the call runs as the organization
 * of that context. The dev server proxies `/mcp` to the API. See
 * docs/contributing/architecture/mcp.md.
 */

/** A JSON-RPC answer of `/mcp`: a result with the tool's answer, or an error. */
type Reply = {
  readonly result?: {
    readonly structuredContent?: Record<string, unknown>;
    readonly isError?: boolean;
  };
  readonly error?: { readonly code: number; readonly message: string };
};

/**
 * Runs the tool `name` with `input` and returns its structured result. Throws
 * an Error with the code and the reason when the tool refuses the call, or
 * when the JSON-RPC answer is an error.
 */
export async function callTool(
  page: Page,
  name: string,
  input: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const response = await page.request.post('/mcp', {
    headers: { 'content-type': 'application/json' },
    data: {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: { name, arguments: input },
    },
  });
  const text = await response.text();
  let reply: Reply;
  try {
    reply = JSON.parse(text) as Reply;
  } catch {
    throw new Error(
      `The MCP endpoint answered ${response.status()} with no JSON for ${name}: ${text}`,
    );
  }
  if (reply.error) {
    throw new Error(`${name} failed with JSON-RPC ${reply.error.code}: ${reply.error.message}`);
  }
  const structured = reply.result?.structuredContent ?? {};
  if (reply.result?.isError) {
    throw new Error(
      `${name} was refused with ${String(structured.code)}: ${String(structured.reason)}`,
    );
  }
  return structured;
}
