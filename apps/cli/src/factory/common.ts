import type { ObjectSchema, StringSchema } from '@/factory/json-schema';

/** The parts that more than one kind uses. */

export const namePattern = '^[a-z0-9]+(?:-[a-z0-9]+)*$';

export const harnesses = ['claude', 'codex', 'qwen'];

/** A folder or file name in the tree: lowercase kebab case. */
export const name = (description: string): StringSchema => ({
  type: 'string',
  pattern: namePattern,
  description: `${description} A lowercase kebab-case name.`,
});

/** Text that is not blank. */
export const text = (description: string): StringSchema => ({
  type: 'string',
  pattern: '\\S',
  description,
});

/** How a kind's file is read: a Markdown file with frontmatter and a body, or a YAML file. */
export type Kind = {
  /** The kind, such as `agent`. It names the JSON Schema file. */
  id: string;
  /** The path from the tree root, such as `agents/<name>/agent.md`. */
  path: string;
  format: 'markdown' | 'yaml';
  /** What the body of a Markdown file holds. The body must not be empty. */
  body?: string;
  schema: ObjectSchema & { title: string };
};
