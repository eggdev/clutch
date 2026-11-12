import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * How the device host starts Maestro. Maestro runs on Java. Homebrew keeps
 * its JDK out of the path, so a Mac that has only that one finds no Java, and
 * Maestro stops before it reads a flow. The command then names the Homebrew
 * JDK as `JAVA_HOME`.
 */

/** Where Homebrew keeps its JDK, on Apple silicon and on Intel. */
const brewJava = ['/opt/homebrew/opt/openjdk', '/usr/local/opt/openjdk'];

/** What the lookup reads from the machine. A test gives its own. */
export type JavaLookup = {
  readonly env: NodeJS.ProcessEnv;
  /** Whether `java` runs on this machine with no help. */
  readonly javaRuns: () => Promise<boolean>;
  readonly exists: (file: string) => boolean;
};

async function javaRuns(): Promise<boolean> {
  if (Bun.which('java') === null) {
    return false;
  }
  // On a Mac with no JDK, `java` is a stub that exits with an error.
  const proc = Bun.spawn(['java', '-version'], { stdout: 'ignore', stderr: 'ignore' });
  return (await proc.exited) === 0;
}

const machine: JavaLookup = { env: process.env, javaRuns, exists: existsSync };

/**
 * The command that runs Maestro with `args`, or the sentence that says why
 * Maestro cannot run on this machine.
 */
export async function maestroCommand(
  args: ReadonlyArray<string>,
  lookup: JavaLookup = machine,
): Promise<Array<string> | string> {
  if (lookup.env.JAVA_HOME || (await lookup.javaRuns())) {
    return ['maestro', ...args];
  }
  const home = brewJava.find((folder) => lookup.exists(path.join(folder, 'bin/java')));
  if (!home) {
    return 'Maestro runs on Java, and this machine has none. Install one with `brew install openjdk`, or set `JAVA_HOME`.';
  }
  return ['env', `JAVA_HOME=${home}`, 'maestro', ...args];
}
