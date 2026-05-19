# Agent: [AGENT_NAME]

> One-line description of what this agent does.

## Identity

- **Role**: [What this agent is]
- **Pipeline**: [Which repo/pipeline it belongs to]
- **Runs on**: [Droplet / Refinery / Researcher]
- **LLM**: [Model and provider, e.g., "Claude Sonnet 4.5 via OpenRouter" or "qwen3:32b via local Ollama"]
- **Triggered by**: [Cron schedule / manual / upstream agent / Telegram]
- **Status**: [DEFINED — spec only | BUILT — code exists | WIRED — integrated into pipeline | LIVE — running in production]

## Mission

[2-3 sentences describing what this agent accomplishes and why it exists in the ecosystem.]

## Inputs

- [What data/files/signals this agent reads from]
- [Database tables, manifests, upstream agent outputs, etc.]

## Outputs

- [Structured JSON schema description]
- [Files produced, DB tables written to, etc.]

## Rules

- [Domain-specific constraints this agent must follow]
- [What it must never do]
- [Quality gates or validation requirements]

## Workflow

1. [Step 1]
2. [Step 2]
3. [Step 3]

## System Prompt Core

```
[The actual system prompt or personality block that gets injected when this agent runs.
This is the source of truth that code reads from.]
```

## Dependencies

- **Upstream**: [Which agents must run before this one]
- **Downstream**: [Which agents consume this agent's output]
- **Skills**: [Which 00-cvc-skills modules this agent imports]
- **DB Tables**: [Which tables it reads from / writes to]
