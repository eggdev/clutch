/**
 * The types of the steps of a journey in data form. The builders that make
 * them are in `@repo/journeys/testing/steps`, and the web runner and the native
 * compiler read the same steps. This file imports nothing, so a tool can read
 * a journey without a browser. See docs/contributing/end-to-end-testing.md#data-journeys.
 */

/** What a step acts on or checks: a button, a heading, a field, or a text. */
export type Target =
  | { readonly kind: 'button'; readonly name: string }
  | { readonly kind: 'heading'; readonly name: string; readonly level?: number }
  | { readonly kind: 'field'; readonly label: string; readonly value?: string }
  | { readonly kind: 'text'; readonly text: string };

/** The device that runs a step. A web journey can use two browser contexts; a native journey has one. */
export type Device = 'first' | 'second';

/** What the page shows when an outcome holds: its path, a visible text, or both. */
export type OutcomeExpected =
  | { readonly url: string; readonly text?: string }
  | { readonly url?: string; readonly text: string };

/**
 * The fields that each step may carry. `only: 'web'` leaves a step out of the
 * native flow, and `why` is the reason it has no native form. The native
 * compiler refuses a web-only step with no reason.
 */
type Common = {
  readonly on?: Device;
  readonly only?: 'web';
  readonly why?: string;
};

/** One step of a journey, as data. The `do` field names the action. */
export type Step = Common &
  (
    | { readonly do: 'open'; readonly path: string }
    | { readonly do: 'tap'; readonly target: Target }
    | { readonly do: 'fill'; readonly target: Target; readonly text: string }
    | { readonly do: 'submit'; readonly target: Target }
    | { readonly do: 'see'; readonly target: Target; readonly within?: number }
    | { readonly do: 'gone'; readonly target: Target }
    | { readonly do: 'offline'; readonly offline: boolean }
    | { readonly do: 'advance'; readonly ms: number }
    | {
        readonly do: 'tool';
        readonly name: string;
        readonly input: Readonly<Record<string, unknown>>;
      }
    | { readonly do: 'settled' }
    | {
        readonly do: 'server-holds';
        /** The list tool of a load function, such as `notes_of_space_list`. */
        readonly tool: string;
        /** The ID that names the group, such as the ID of a space. */
        readonly id: string;
        readonly field: string;
        readonly values: ReadonlyArray<string>;
      }
    | {
        readonly do: 'holds';
        readonly model: string;
        readonly field: string;
        readonly values: ReadonlyArray<string>;
      }
    | { readonly do: 'shot'; readonly name: string; readonly style?: string }
    | { readonly do: 'accessible'; readonly name: string }
    | { readonly do: 'outcome'; readonly name: string; readonly expected: OutcomeExpected }
  );

/** A journey as data: its title and its steps. */
export type JourneyData = { readonly title: string; readonly steps: ReadonlyArray<Step> };
