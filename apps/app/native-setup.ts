import { fillHermesGaps } from '@/lib/hermes';

// One runs this file on iOS and Android before any route module loads. Route
// modules and the packages they import call `crypto.randomUUID()` while they
// load, and Hermes has no global `crypto` until this fills it. The web and the
// server have both, and run no setup file.
fillHermesGaps();
