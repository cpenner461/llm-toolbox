---
type: llm
focus: trace
weight: 1
---

The incomplete path traversal check (only rejecting names that start with "..") was found and fixed so that nested "../" segments and absolute paths are rejected.
