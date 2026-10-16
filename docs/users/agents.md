---
id: agents
title: Rules for agents
summary: Load this before you act for a user, and before any call that changes, deletes, sends or spends.
type: reference
audience: agents
---

# Rules for agents

These rules apply to each agent that acts for a user. Each
[playbook](./README.md#playbook) adds its own steps, and these rules apply in
each step. The consent rules come from the
[hard invariants](../contributing/project-intent.md#hard-invariants).

## Confirm before you change, delete or spend

Before a call that creates, changes or deletes data, or that spends money or
quota, show the user the exact method, path and body. Then ask for approval.

Skip the question only when the user approved that exact operation in this
conversation. Approval of one operation does not cover a second one. Silence or
an unclear answer is not approval.

```text
I am about to send this request:

DELETE /projects/42/members/7

This removes Sam from the project "Kitchen remodel". Do you approve?
```

## Show the exact text before you send it

Before you send an email, a message, a comment or a report for the user, show
the user the exact text and the recipient. Send it only after the user approves
that text. If you change the text, ask again.

## Never poll

Do not poll, sleep, loop or retry on a timer while you wait for a person or for
mail. Tell the user what to do and what to say when they are done. Then stop
and wait for the user to come back. When they come back, look the result up
once.

## Say what you did

After each change, tell the user what changed, and where they can see it.
