import { fillHermesGaps } from '@/lib/hermes';

// One runs this file on iOS and Android before any route module loads. Route
// modules and the packages they import call `crypto.randomUUID()` while they
// load, and Hermes has no global `crypto` until this fills it. The web and the
// server have both, and run no setup file.
fillHermesGaps();

// TypeScript has no type for these globals of React Native.
declare const PerformanceLongTaskTiming: unknown;
declare const TaskAttributionTiming: unknown;

/**
 * The type of each global that React Native and Expo install when the app
 * starts.
 *
 * The native bundle is one script, so a top-level variable of any module in it
 * is also a global of that name, and nothing can replace such a global. The
 * bundler gave the name `File` to an export of Effect's Schema module, so
 * React Native could not install its own `File`, and the app opened on an
 * error screen. React Native and Expo also name their own classes after the
 * globals that they install, such as `Event` and `TextDecoderStream`. The
 * bundler never gives a module variable a name that some module reads as a
 * global, so the reads below keep these names free.
 *
 * Nothing calls this function when the app starts. Each global loads its
 * module at the first read, and the module of `TextDecoderStream` needs a web
 * stream, which Hermes does not have.
 *
 * `WebSocket`, `fetch` and `XMLHttpRequest` are left out, because the lint
 * lets only the sync engine name them.
 */
function globalsOfReactNative(): Readonly<Record<string, string>> {
  return {
    AbortController: typeof AbortController,
    AbortSignal: typeof AbortSignal,
    Blob: typeof Blob,
    DOMRect: typeof DOMRect,
    DOMRectList: typeof DOMRectList,
    DOMRectReadOnly: typeof DOMRectReadOnly,
    Event: typeof Event,
    EventCounts: typeof EventCounts,
    EventTarget: typeof EventTarget,
    File: typeof File,
    FileReader: typeof FileReader,
    FormData: typeof FormData,
    HTMLCollection: typeof HTMLCollection,
    Headers: typeof Headers,
    IntersectionObserver: typeof IntersectionObserver,
    MutationRecord: typeof MutationRecord,
    NodeList: typeof NodeList,
    Performance: typeof Performance,
    PerformanceEntry: typeof PerformanceEntry,
    PerformanceEventTiming: typeof PerformanceEventTiming,
    PerformanceLongTaskTiming: typeof PerformanceLongTaskTiming,
    PerformanceMark: typeof PerformanceMark,
    PerformanceMeasure: typeof PerformanceMeasure,
    PerformanceObserver: typeof PerformanceObserver,
    PerformanceObserverEntryList: typeof PerformanceObserverEntryList,
    PerformanceResourceTiming: typeof PerformanceResourceTiming,
    Request: typeof Request,
    Response: typeof Response,
    TaskAttributionTiming: typeof TaskAttributionTiming,
    TextDecoderStream: typeof TextDecoderStream,
    TextEncoderStream: typeof TextEncoderStream,
    URL: typeof URL,
    URLSearchParams: typeof URLSearchParams,
  };
}

// The property keeps the function in a release bundle, where an unused
// function is removed. A developer can call `reactNativeGlobalTypes()` from
// the debugger to see what exists. Its name differs from the name of the
// function: in the native bundle a top-level function is already a global of
// its own name, and such a global cannot be defined again.
Object.defineProperty(globalThis, 'reactNativeGlobalTypes', {
  value: globalsOfReactNative,
  configurable: true,
});
