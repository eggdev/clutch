type SessionState = 'queued' | 'active' | 'cleaning' | 'quarantined' | 'finished' | 'cancelled';
export type Outcome = 'passed' | 'failed' | 'cancelled' | 'expired' | 'interrupted';

export type Enqueue = {
  owner: string;
  requestId: string;
  project: string;
  workspace: string;
  revision: string;
};

export type Session = Enqueue & {
  id: string;
  sequence: number;
  state: SessionState;
  generation: number | null;
  deadline: number | null;
  maxDeadline: number | null;
  created: number;
  finished: number | null;
  outcome: Outcome | null;
  cleanupDetail: string | null;
};

export type Lease = {
  sessionId: string;
  generation: number;
  token: string;
};

export type CleanupTicket = {
  sessionId: string;
  generation: number;
  token: string;
};

export type QueueErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'forbidden'
  | 'request_conflict'
  | 'stale_lease'
  | 'stale_cleanup'
  | 'invalid_state'
  | 'unsupported_schema';

export class QueueError extends Error {
  readonly code: QueueErrorCode;

  constructor(code: QueueErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'QueueError';
  }
}
