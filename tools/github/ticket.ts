import { clutch, must } from '@tools/github/github';
import type { Run } from '@tools/github/stack';

/**
 * A ticket id, such as `CL-1000`. Ticket numbers start at 1000, and an issue
 * number has 3 digits, so the two never look alike.
 */
export const ticketPattern = /^[a-z][a-z\d]*-\d{4,}$/iu;

/** The ticket id that a branch names: `clutch/cl-1000-fix-the-total` is CL-1000. */
export function ticketOf(branch: string) {
  const match = /^clutch\/([a-z][a-z\d]*-\d{4,})(?:-|$)/iu.exec(branch);
  return match ? match[1].toUpperCase() : undefined;
}

type Ticket = { id: string; acceptance: Array<string> };

/**
 * The ticket of a branch, from the store of the project. Undefined when the
 * branch names no ticket, or the store has no such ticket.
 */
async function branchTicket(run: Run, branch: string): Promise<Ticket | undefined> {
  const id = ticketOf(branch);
  if (!id) {
    return undefined;
  }
  const shown = await run(clutch('tickets', 'show', id));
  if (!shown.ok) {
    console.log(`Note: ${id} is not in the ticket store, so no pull request is linked to it.`);
    return undefined;
  }
  return (JSON.parse(shown.out) as { ticket: Ticket }).ticket;
}

/**
 * The body with an "Acceptance criteria" section that lists the checks of the
 * ticket. A body that has that section already keeps it.
 */
export function withAcceptance(body: string, ticket: Ticket) {
  if (ticket.acceptance.length === 0 || /^## Acceptance criteria\s*$/mu.test(body)) {
    return body;
  }
  const checks = ticket.acceptance.map((check) => `- ${check}`).join('\n');
  return `${body.trimEnd()}\n\n## Acceptance criteria\n\nFrom ticket ${ticket.id}:\n\n${checks}\n`;
}

/**
 * The ticket of a branch, after it writes the acceptance criteria of the
 * ticket into the body file. A ticket branch has no issue file, so the body
 * carries them. Undefined for a branch with no ticket in the store.
 */
export async function stampTicket(run: Run, branch: string, file: string) {
  const ticket = await branchTicket(run, branch);
  const body = Bun.file(file);
  if (ticket && (await body.exists())) {
    await Bun.write(body, withAcceptance(await body.text(), ticket));
  }
  return ticket;
}

/** Links the pull request to the ticket, when there is one. A second link of the same URL changes nothing. */
export async function linkPullRequest(run: Run, ticket: Ticket | undefined, url: string) {
  if (ticket) {
    await must(run, clutch('tickets', 'link', ticket.id, '--kind', 'pull_request', url));
  }
}
