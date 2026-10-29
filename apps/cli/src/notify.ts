/**
 * Tells the user that an unattended stage ended: a terminal bell, and a
 * desktop notification where the system has a command for one.
 */
export async function notify(message: string) {
  process.stdout.write('\u0007');
  const command =
    process.platform === 'darwin'
      ? ['osascript', '-e', `display notification ${JSON.stringify(message)} with title "Clutch"`]
      : Bun.which('notify-send') && ['notify-send', 'Clutch', message];
  if (command) {
    await Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' }).exited;
  }
}
