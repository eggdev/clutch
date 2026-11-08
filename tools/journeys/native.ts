import { journeys } from '@tools/journeys/journeys';
import {
  deviceRuns,
  failedRuns,
  frictionFlake,
  reportFlakes,
  writeMeasures,
} from '@tools/journeys/measures';
import type { Attempt, FileFlake } from '@tools/journeys/measures';
import { DeviceHostError, deviceHost, lockFile, withDevice } from '@tools/native/device-host';
import type { DeviceHost, Platform } from '@tools/native/device-host';

/**
 * Runs each native journey with Maestro on the booted device of the device
 * host: `mise exec -- bun run journey --native <ios|android>`. CI runs it on an
 * iPhone 16 simulator and a Pixel 7 emulator, with `DEVICE_HOST=ci`. A failed
 * journey runs once more. A pass on the retry passes, and files a `flake`
 * friction entry. Each journey writes `<id>.<platform>.json` to the measures
 * folder. See docs/contributing/end-to-end-testing.md#native-journeys.
 */

export type NativeOptions = {
  host?: DeviceHost;
  lock?: string;
  fileFlake?: FileFlake;
  log?: (line: string) => void;
};

export async function nativeMain(
  root: string,
  platform: Platform | undefined,
  options: NativeOptions = {},
): Promise<number> {
  const log = options.log ?? console.log;
  if (platform !== 'ios' && platform !== 'android') {
    log('Name the platform: `mise exec -- bun run journey --native <ios|android>`.');
    return 1;
  }
  const flows = journeys(root).filter((journey) => journey.platform === 'native');
  // CI starts a native lane only when a native app exists, so an app with no native journey has no proof.
  if (flows.length === 0) {
    log(
      `::error title=No journey ran::No native journey exists, so the ${platform} run proves nothing. Add one at features/<feature>/journeys/<id>.maestro.yaml. See docs/contributing/end-to-end-testing.md#native-journeys.`,
    );
    return 1;
  }
  const host = options.host ?? deviceHost();
  try {
    return await withDevice(
      host,
      platform,
      async (device) => {
        let failed = 0;
        for (const journey of flows) {
          const attempts: Array<Attempt> = [];
          for (let retry = 0; retry < 2; retry += 1) {
            const start = Date.now();
            const result = await host.runFlow(device, journey.file);
            log(result.output);
            const status = result.exitCode === 0 ? 'passed' : 'failed';
            attempts.push({
              device: device.name,
              retry,
              status,
              durationMs: Date.now() - start,
            });
            if (status === 'passed') {
              break;
            }
          }
          const runs = deviceRuns(platform, attempts);
          const where = writeMeasures(root, journey, runs);
          await reportFlakes(journey, runs, where, options.fileFlake ?? frictionFlake(root), log);
          const lines = failedRuns(journey, runs, where);
          for (const line of lines) {
            log(line);
          }
          failed += lines.length > 0 ? 1 : 0;
        }
        return failed > 0 ? 1 : 0;
      },
      options.lock ?? lockFile(),
    );
  } catch (error) {
    if (!(error instanceof DeviceHostError)) {
      throw error;
    }
    log(error.message);
    return 1;
  }
}
