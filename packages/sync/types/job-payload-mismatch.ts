import { Schema } from 'effect';

/**
 * A queued job whose stored payload no longer matches its declaration. The
 * job runner retries the job or parks it, as it does for any failure. `job`
 * names the job, and `reason` is the sentence for the operator.
 */
export class JobPayloadMismatch extends Schema.TaggedError<JobPayloadMismatch>()(
  'JobPayloadMismatch',
  { job: Schema.String, reason: Schema.String },
) {}
