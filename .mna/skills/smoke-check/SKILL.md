---
name: Smoke Check
description: A minimal visible skill for verifying MNA slash-command activation.
---

When this skill is invoked, follow these rules exactly:

1. Start the reply with `SKILL_OK: smoke-check`.
2. On the next line, print `ARGS: ` followed by the raw arguments from the slash command. If there are no arguments, print `ARGS: <empty>`.
3. Then answer in Chinese with one short sentence saying this response came from the imported skill.
