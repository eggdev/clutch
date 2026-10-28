# API errors

Every HTTP error from the product has one shape, so a client, an agent and a
test read every failure the same way. This page applies
[one door for each decision](../../principles/one-door-for-each-decision.md)
and [fail loudly](../../principles/fail-loudly.md).

| Question                        | Answer                                                       |
| ------------------------------- | ------------------------------------------------------------ |
| What does an error look like?   | `{ "error": { "code", "message", "details" } }`              |
| Which status goes with a code?  | The table below. One function maps each code to its status   |
| What does an unknown error get? | `500` with `internal_error`. The message hides the internals |
| Which errors reach the tracker? | Server errors (`5xx`) only. A caller error is the caller's   |

<!-- kickoff: The file that defines the error codes and the function that turns an error into a response. -->

## Rules

- **One shape.** `code` is stable `snake_case` that a client can branch on.
  `message` is for people and can change. `details` is optional and holds
  facts that a program reads, such as the limit and the current count.
- **One door.** Code fails with a tagged error that carries its code. One
  function turns it into a response with the status from the table. A handler
  never builds an error response by hand. Server code never throws. See
  [server](./server.md#edges-and-errors).
- **A rejected command is not an HTTP error.** On the sync socket, a server
  change fails with `CommandRejected`. The client gets a rejected outcome with
  the reason, and drops the local change.
- **A closed set of codes.** A new code is a row in the table, in the change
  that adds it. A code never changes meaning. A client that sees an unknown
  code treats it as the generic code for its status.
- **No internals in a response.** A `5xx` response never carries a stack, a
  query or a vendor message. The error tracker gets them.
- **No caching.** Each error response sets `Cache-Control: no-store`.
- **Caller errors stay out of the tracker.** A `4xx` is the expected result of a
  bad request. Reporting it would hide real server errors in noise.

## Codes

| Status | Code                                |
| ------ | ----------------------------------- |
| 400    | `invalid_request`                   |
| 401    | `unauthorized`                      |
| 403    | `forbidden`                         |
| 404    | `not_found`                         |
| 409    | `conflict`                          |
| 413    | `payload_too_large`                 |
| 415    | `unsupported_media_type`            |
| 429    | `rate_limited` (with `Retry-After`) |
| 500    | `internal_error`                    |

<!-- kickoff: The product's own codes, one row each, such as `limit_reached` for a plan limit. Delete this slot when the product adds none. -->

## What to read when changing it

- [Authorization](./authorization.md): where `401` and `403` come from
