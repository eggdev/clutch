/** A slug names one task checkout: lower case letters, digits and dashes. */
const slugPattern = /^[a-z0-9][a-z0-9-]*$/u;
const issuePattern = /^CL-\d{3}[a-z]?$/u;

/** Throws unless `slug` can name a folder and a branch. */
export function checkSlug(slug: string | undefined): string {
  if (!slug || !slugPattern.test(slug)) {
    throw new Error(
      'Give a slug of lower case letters, digits and dashes, such as cart-total: clutch worktree new <slug>.',
    );
  }
  return slug;
}

/** The branch for a task: `clutch/cl-NNN-<slug>` with an issue, as `.clutch/README.md` says, or `clutch/<slug>`. */
export function branchName(slug: string, issue?: string): string {
  if (issue === undefined) {
    return `clutch/${slug}`;
  }
  if (!issuePattern.test(issue)) {
    throw new Error(`--issue takes an id such as CL-201, not ${issue}.`);
  }
  return `clutch/${issue.toLowerCase()}-${slug}`;
}

/** The issue that a branch name links to, such as CL-201 for `clutch/cl-201-worktree`, or null. */
export function issueOf(branch: string | null): string | null {
  const match = branch ? /^clutch\/cl-(\d{3}[a-z]?)(?:-|$)/u.exec(branch) : null;
  return match ? `CL-${match[1]}` : null;
}
