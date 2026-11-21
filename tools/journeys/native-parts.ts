import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { deviceFlow, scriptHost } from '@tools/journeys/flow-parts';
import type { Flow } from '@tools/journeys/flow-parts';
import { DeviceHostError, runFlow } from '@tools/native/device-host';
import type { DeviceHost, Result } from '@tools/native/device-host';

// The native runner runs a flow in parts on a device of the pool. The device pool refuses a
// script step, and a screenshot that it takes stays on the pool machine, so the script steps
// and the screenshots run on this machine. See docs/contributing/end-to-end-testing.md#native-journeys.

/**
 * The `device` object of a script step: the native commands of `agent-device`
 * that read the value of a field. Each returns true, and throws with the
 * output of the command when it fails.
 */
function deviceCommands(host: DeviceHost) {
  const run = (args: ReadonlyArray<string>) => {
    const result = host.device(args);
    if (result.exitCode !== 0) {
      throw new Error(`agent-device ${args[0] ?? ''} failed: ${result.output.trim()}`);
    }
    return true;
  };
  return {
    wait: (selector: string, ms: number) => run(['wait', selector, String(ms)]),
    gone: (selector: string, ms: number) => run(['wait', 'absent', selector, String(ms)]),
    fill: (selector: string, text: string) => run(['fill', selector, text]),
    press: (selector: string) => run(['press', selector]),
  };
}

/** Runs a step on this machine, and gives its error as a failed result. */
function local(step: number, act: () => void): Result {
  try {
    act();
    return { exitCode: 0, output: `Step ${step} passed.` };
  } catch (error) {
    if (error instanceof DeviceHostError) {
      throw error;
    }
    return { exitCode: 1, output: error instanceof Error ? error.message : String(error) };
  }
}

/** Saves `final-screen.png`. A failure here only logs, so it never hides the result of the flow. */
function finalScreen(host: DeviceHost, folder: string, log: (line: string) => void) {
  try {
    const shot = host.device(['screenshot', path.join(folder, 'final-screen.png')]);
    if (shot.exitCode !== 0) {
      log(`The final screenshot failed: ${shot.output}`);
    }
  } catch (error) {
    log(`The final screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Runs the parts of one flow in order, and stops at the first that fails. Each
 * stretch of device steps goes to the device as a flow file in `parts/`. A
 * script step runs here, and a screenshot comes here. The output of each part
 * goes to `output.txt`, and `final-screen.png` shows the screen at the end.
 * Returns whether each part passed.
 */
export function runParts(
  host: DeviceHost,
  flow: Flow,
  folder: string,
  log: (line: string) => void,
) {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(path.join(folder, 'parts'), { recursive: true });
  const record = (output: string) => {
    appendFileSync(path.join(folder, 'output.txt'), `${output.trimEnd()}\n`);
    log(output);
  };
  const scripts = scriptHost({}, { device: deviceCommands(host) });
  const defined = local(0, () => scripts.define(flow.env));
  let passed = defined.exitCode === 0;
  if (!passed) {
    record(defined.output);
  }
  try {
    for (const part of passed ? flow.parts : []) {
      let result: Result;
      if (part.kind === 'device') {
        const file = path.join(
          folder,
          'parts',
          `${String(part.first).padStart(3, '0')}.maestro.yaml`,
        );
        result = local(part.first, () => {
          const commands = part.commands.map((item, index) =>
            scripts.resolved(item, part.first + index),
          );
          writeFileSync(file, deviceFlow(flow.config, commands));
        });
        result = result.exitCode === 0 ? runFlow(host, file) : result;
      } else if (part.kind === 'evalScript') {
        result = local(part.step, () => scripts.evalScript(part.script, part.step));
      } else {
        result = host.device(['screenshot', path.join(folder, `${part.name}.png`)]);
      }
      record(result.output);
      if (result.exitCode !== 0) {
        passed = false;
        break;
      }
    }
  } finally {
    finalScreen(host, folder, log);
  }
  return passed;
}
