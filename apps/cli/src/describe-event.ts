type Event = {
  type?: string;
  message?: { content?: Array<{ type?: string; name?: string; input?: Record<string, unknown> }> };
  item?: { type?: string; command?: string; text?: string };
};

/**
 * A short line about what an unattended agent does now, from one line of its
 * JSON event stream (Claude stream-json or Codex --json). Returns undefined
 * for events that say nothing new.
 */
export function describeEvent(line: string) {
  let event: Event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  const tool = event.message?.content?.find((part) => part.type === 'tool_use');
  if (tool?.name) {
    const target = tool.input?.file_path ?? tool.input?.command ?? tool.input?.pattern ?? '';
    return `${tool.name} ${String(target)}`.trim().slice(0, 80);
  }
  return event.item?.type === 'command_execution' ? event.item.command?.slice(0, 80) : undefined;
}
