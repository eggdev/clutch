import { Config } from 'effect';

/**
 * The shared secret of the note import webhook. The sender signs each body
 * with it. When `NOTES_WEBHOOK_SECRET` is not set, every signature fails, so
 * the route accepts nothing.
 */
export const notesWebhookSecret = Config.option(Config.Redacted('NOTES_WEBHOOK_SECRET'));
