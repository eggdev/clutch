import { notesWebhookSecret } from '@repo/notes/config/webhook';
import { Context, Effect, Layer, Option, Redacted } from 'effect';

/**
 * Checks the signature of a webhook body: the hex HMAC-SHA256 of the raw
 * body, with the shared secret. The route checks it before it reads the body.
 */
export class WebhookSignature extends Context.Service<
  WebhookSignature,
  { readonly verify: (body: string, signature: string | undefined) => Effect.Effect<boolean> }
>()('notes/WebhookSignature') {}

/** The hex HMAC-SHA256 of `body` with `secret`. A sender in a test uses it too. */
export function sign(secret: string, body: string) {
  const encoder = new TextEncoder();
  return Effect.gen(function* () {
    const key = yield* Effect.promise(() =>
      crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      ),
    );
    const mac = yield* Effect.promise(() => crypto.subtle.sign('HMAC', key, encoder.encode(body)));
    return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  });
}

/** The signature check with one secret. A test builds it with a known secret. */
export function signatureWith(secret: string | undefined) {
  return Layer.succeed(WebhookSignature)({
    verify: (body, signature) =>
      secret === undefined || signature === undefined
        ? Effect.succeed(false)
        : sign(secret, body).pipe(Effect.map((expected) => expected === signature)),
  });
}

/** The signature check with the secret from `NOTES_WEBHOOK_SECRET`. */
export const WebhookSignatureLive = Layer.unwrap(
  notesWebhookSecret.pipe(
    Effect.map((secret) =>
      signatureWith(Option.isSome(secret) ? Redacted.value(secret.value) : undefined),
    ),
  ),
);
