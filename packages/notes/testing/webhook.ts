import { signatureWith } from '@repo/notes/service/webhook-signature';

/** The shared secret of the import webhook in tests. */
export const webhookTestSecret = 'test-webhook-secret';

/** The signature check with the test secret. */
export const WebhookSignatureTest = signatureWith(webhookTestSecret);
