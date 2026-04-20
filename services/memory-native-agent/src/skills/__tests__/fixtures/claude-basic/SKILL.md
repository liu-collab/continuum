---
name: Deploy Helper
description: Prepare a deployment checklist.
when_to_use: Use when the user asks for deploy preparation.
argument-hint: environment service
disable-model-invocation: false
user-invocable: true
allowed-tools:
  - shell_exec
model: claude-sonnet-4
effort: high
paths:
  - deploy
shell: powershell
---

Collect deployment information for $0 in $1.

!Write-Output ok
