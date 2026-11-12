/**
 * The state of the start of the app: what it loaded, the failure of the last
 * start, and each report since. It knows nothing of the pool or the platform,
 * so a test drives it with a start function of its own. `lib/boot.ts` gives it
 * the real one.
 */
export type BootState<Loaded> = {
  /** What the start loaded, or `undefined` before it ends and after it fails. */
  readonly loaded: Loaded | undefined;
  /** Why the last start failed, as one sentence, or `undefined`. */
  readonly failure: string | undefined;
  /** Each sentence about data that does not fit this build, for this run of the app. */
  readonly reports: ReadonlyArray<string>;
};

export type BootStore<Loaded> = {
  /** The state now. The same object until the state changes. */
  readonly state: () => BootState<Loaded>;
  /** Listens for each change. The first listener starts the app. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Starts again, after a failure or after a session ends. */
  readonly restart: () => void;
};

/** The sentence for a start that failed. It names what the person can do. */
function failureOf(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `The app could not start: ${reason} Try again.`;
}

/**
 * A store for one start of the app. `start` loads what the app needs and gets
 * `report` for each sentence about data that does not fit. A start that
 * throws becomes a failure that the layout shows with a way to try again, so
 * a start never ends in an empty page.
 */
export function bootStore<Loaded>(
  start: (report: (line: string) => void) => Promise<Loaded>,
): BootStore<Loaded> {
  let state: BootState<Loaded> = { loaded: undefined, failure: undefined, reports: [] };
  let starting = false;
  const listeners = new Set<() => void>();

  function set(next: Partial<BootState<Loaded>>) {
    state = { ...state, ...next };
    for (const listener of listeners) {
      listener();
    }
  }

  function report(line: string) {
    set({ reports: [...state.reports, line] });
  }

  async function run() {
    try {
      set({ loaded: await start(report), failure: undefined });
    } catch (error) {
      starting = false;
      set({ loaded: undefined, failure: failureOf(error) });
    }
  }

  function begin() {
    if (!starting) {
      starting = true;
      void run();
    }
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      // The first screen that asks starts the app. A build render never subscribes.
      begin();
      return () => {
        listeners.delete(listener);
      };
    },
    restart() {
      starting = false;
      set({ loaded: undefined, failure: undefined });
      begin();
    },
  };
}
