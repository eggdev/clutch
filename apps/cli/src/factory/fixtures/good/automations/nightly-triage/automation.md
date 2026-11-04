---
description: Sorts the new issues each weekday night.
agent: triage
trigger:
  type: schedule
  time: '22:00'
  weekdays: [1, 2, 3, 4, 5]
enabled: true
---

Sort each issue that arrived today.
