---
description: Compares 2 models on the implement agent.
agent: implement
configs:
  - name: opus
    model: claude-opus-5-5
  - name: qwen
    model: qwen3.8-27b
tasks:
  - name: add-total
    commit: 3d3c42e5aac5ba805825da76410c181273ba90b1
    issue: .clutch/issues/CL-201.md
    check: bun test src/cart.test.ts
---

The suite runs each task with each model.
