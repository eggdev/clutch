# User docs

This folder holds the docs for the people who use the product, and for the
agents that act for them. People read a page on the web. Agents load the same
markdown file. This file is the contract for each page in the folder. It is
not a user page itself.

User docs follow the same rules as contributor docs. See
[documentation](../contributing/documentation.md). Write in the present tense,
keep status and plans out, and use Simplified Technical English.

## Each page is plain markdown

A user page is one `.md` file with YAML frontmatter and plain markdown. Use no
HTML, no components and no build-time includes. The only HTML is the optional
agent notes comment, below. Each surface that serves the page shows the same
text, so the web page, the raw markdown and an agent see one source.

Put one topic on each page. When a page grows past one topic, split it and
link the parts. Link to the page that owns a fact. Do not copy its paragraphs.

## Frontmatter

Each user page starts with this frontmatter:

```yaml
---
id: connect_calendar
title: Connect your calendar
summary: Load this when a user wants events from their calendar in the product.
type: integration
audience: agents
---
```

| Field      | Required | Value                                                                                     |
| ---------- | -------- | ----------------------------------------------------------------------------------------- |
| `id`       | Yes      | The file name without `.md`, with each `-` written as `_`. The id never changes.          |
| `title`    | Yes      | The page H1, word for word.                                                               |
| `summary`  | Yes      | One or two sentences that start with "Load this when". It tells an agent when to load it. |
| `type`     | Yes      | One of `intro`, `getting-started`, `concept`, `playbook`, `integration`, `reference`.     |
| `audience` | No       | `agents` only. Set it on a page that an agent follows step by step.                       |

The `check-user-docs` check reads each `.md` file in this folder, except this
file. It rejects a page when the frontmatter is missing, a required field is
missing or empty, a field is not in the table, `type` or `audience` has a value
that is not in the table, `id` does not match the file name, or two pages have
the same `id`.

Use `type: reference` for a page with no template: the [index](./index.md),
[troubleshooting](./troubleshooting.md) and the
[rules for agents](./agents.md).

## Agent notes

A page can hold notes that only an agent reads. Put them in one HTML comment
right after the H1. Start the comment with `Agent notes:`. Use the notes for
rules that would distract a person: what not to create, which page to load
next, and which paths are relative to the origin that served the page. A web
page does not show the comment.

```markdown
# Connect your calendar

<!--
Agent notes:

- Work one step at a time. Confirm each step before the next.
- Do not create a schedule unless the user asks for one.
-->
```

## Page types

Each type has a fixed set of H2 headings, in this order. Copy the template,
then replace each line in angle brackets. Delete an optional heading when the
page has nothing for it.

### Intro

What the product is, who it is for, and the first page to open.

```markdown
# <What the product is, in a few words>

<One paragraph: who it is for and the job it does for them.>

## What you can do

- <A task a user can do, in their words.>

## What it is not

- <A product that users confuse it with, and how it differs.>

## How it works

<A short description of the parts the user sees, and how they connect.>

## Start here

<A link to the first getting started page.>
```

### Getting started

One short path from a new account to a first result.

```markdown
# <Get a first result>

## Before you start

- <What the user needs: an account, a verified email, a device.>

## Steps

1. <One action. Say what the user sees after it.>

## Result

<What the user has at the end, and how they can see it.>

## Next

- <A link to the next page to open.>
```

### Concept

One idea in the product: what it is, where the user finds it, and what it is
not. Give the exact empty-state copy, so a user who sees it knows the page
works.

```markdown
# <Name of the idea>

<One paragraph: what it is, and where the user finds it.>

## What shows up

- <Each kind of item, and the condition that makes it show up.>

## What this is not

- **<A nearby idea that users confuse with this one.>** <Where that lives.>

## Empty state

The empty state is **<exact copy on the screen>**.

## Ask your agent

<What an agent can read or do for this idea.>
```

### Playbook

A procedure that an agent follows for a user, step by step. Set
`audience: agents`. The agent stops when the condition in "Before you start"
fails. Each step is one heading. The agent never polls, sleeps or retries on a
timer. When a step needs the user, the agent hands off and waits for the user
to come back. "Success" names the observable proof that the playbook worked.
"Try it" gives the prompt that a user pastes into their agent.

```markdown
---
id: <file_name>
title: <Title>
summary: Load this when <the user asks for this outcome>.
type: playbook
audience: agents
---

# <Title>

<!--
Agent notes:

- Work one step at a time. Confirm each step out loud before the next.
- Never poll, sleep or retry on a timer. Hand off and wait for the user.
-->

<One paragraph: what the user gets at the end.>

## Before you start

<What must be true. If it is not true, stop and tell the user what to do.>

## Step 1: <Action>

<One action. Quote exact text the user must find or type.>

## Step 2: Hand off to the user

<Tell the user what to do, and what to say when they are done. Then stop.>

## Step 3: <Action after the user comes back>

<Look the result up once. If it is not there, tell the user and wait again.>

## Success

<The observable proof: the record, message or screen the agent shows the user.>

## Troubleshooting

**<Symptom.>** <Cause, then fix.>

## Try it

Paste this into your agent:

> <The prompt, with the page URL in it.>
```

### Integration

A walkthrough that connects an outside service to the product.

```markdown
# Connect <service>

<One sentence: what the connection is for.>

## What you get

- "<A request the user can make after they connect.>"

## Before you start

- <Accounts, plans, approvals and limits at the service.>

## Set up

1. <One action at the service or in the product.>

## Verify

<One call or screen that proves the connection works, and the expected result.>

## Permissions

| Permission | Why the product needs it |
| ---------- | ------------------------ |
| <name>     | <reason>                 |

## Troubleshooting

**<Exact error text or symptom.>** <Cause, then fix.>

## Related

- <Links to pages that use this connection.>
```
