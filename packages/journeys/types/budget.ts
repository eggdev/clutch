/**
 * The click budget of a core journey, as one pure rule. The web measure
 * checks it while a run records each outcome, and the native runner checks it
 * on the outcomes that the compiled flow runs. Both read the budgets of
 * clutch.yaml the same way, so a budget means one thing on each platform.
 * See docs/contributing/journeys/core.md#budgets.
 */

/** The quality budgets of a run, from `budgets:` in clutch.yaml. */
export type Budgets = { layoutShift: number; clicks: Record<string, number> };

/** The template defaults, as docs/contributing/journeys/core.md names them. */
const defaultBudgets: Budgets = { layoutShift: 0.01, clicks: { 'sign-up': 3 } };

/**
 * The outcome where the click budget of each core journey ends. Sign-up counts
 * from the entry. Each other journey counts from `signed-up`.
 */
const budgetEnd: Readonly<Record<string, string>> = {
  'sign-up': 'signed-up',
  'sign-in': 'signed-in',
  onboarding: 'onboarded',
  'profile-management': 'profile-saved',
  'billing-and-checkout': 'plan-upgraded',
  'roles-and-access': 'member-invited',
  'account-security': 'password-changed',
  'contact-support': 'support-request-sent',
};

/** The budgets from the given values, over the template defaults. */
export function budgetsFrom(given: Partial<Budgets>): Budgets {
  return {
    layoutShift: given.layoutShift ?? defaultBudgets.layoutShift,
    clicks: { ...defaultBudgets.clicks, ...given.clicks },
  };
}

/** A click budget that applies to one outcome, and whether the run is over it. */
export type ClickBudget = {
  budget: number;
  used: number;
  from: string;
  to: string;
  over: boolean;
};

/**
 * The click budget of `core` at the outcome `name`, or null when the budget
 * does not end there. `steps` counts the activations at `name`, and
 * `startSteps` the activations at `signed-up`, or 0 for sign-up, which counts
 * from the entry.
 */
export function clickBudgetAt(
  core: string | null,
  budgets: Budgets,
  name: string,
  steps: number,
  startSteps: number,
): ClickBudget | null {
  const budget = core ? budgets.clicks[core] : undefined;
  if (!core || budget === undefined || budgetEnd[core] !== name) {
    return null;
  }
  const from = core === 'sign-up' ? 'the entry' : '`signed-up`';
  const used = steps - (core === 'sign-up' ? 0 : startSteps);
  return { budget, used, from, to: name, over: used > budget };
}

/** The message of a click budget that the run went over. */
export function clickBudgetMessage(core: string, check: ClickBudget): string {
  return `${core} took ${check.used} clicks or taps from ${check.from} to \`${check.to}\`, over its budget of ${check.budget} in \`budgets.clicks\` of clutch.yaml. Remove a step. A larger budget is the owner's decision. See docs/contributing/journeys/core.md#budgets.`;
}
