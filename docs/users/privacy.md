---
id: privacy
title: Privacy
summary: Load this when a user asks what the product stores, who can see it, how long it is kept, or how to export or delete it.
type: reference
---

# Privacy

What the product stores about you, who can see it, how long it is kept, and how
to get it or remove it.

## Who is responsible for your data

<!-- kickoff: The data controller: the person or company, the service it runs, and a contact address. -->

## What the product stores

The app keeps a copy of your organization's records on your device, so it
works offline and opens at once. Signing out deletes that copy.

<!-- kickoff: A table: Data, Why the product needs it, Where it lives. Build it from the data inventory in docs/contributing/architecture/data-storage.md. -->

## Who can see your data

<!-- kickoff: Who sees what, from the "who sees what" invariants in docs/contributing/project-intent.md: the other members of your organization, each role, and anyone you share with. -->

## What an admin can never see

<!-- kickoff: The explicit list of data that no admin of your organization and no operator can see, such as passwords and private drafts. -->

## How long the product keeps data

When you delete something, you can restore it for 30 days. After that, it is
removed for good. Some data has its own retention period:

<!-- kickoff: A table: Data, How long it is kept, Why. Match the restore window in docs/contributing/architecture/soft-delete.md and the retention rules in the data inventory. -->

## Service providers

<!-- kickoff: Each vendor that processes your data, what it processes and where. Build the list from the vendors in docs/contributing/architecture/primitives.yaml. -->

## Your choices and rights

- **Export.** You can export your data at any time, in a format that you can
  read without the product.
- **Delete.** You can delete your account. Your data is removed after the
  restore window. When you ask for it, or the law needs it, it is removed at
  once.

<!-- kickoff: Where in the product a user exports and deletes, and the rights that the product's market adds. -->

## Operator access

We access your data only when an admin of your organization grants it for a set
time, or when the law requires it. When the law allows, we tell you.
