# model-router

Before each subagent starts, **Haiku 5.5** reads its type, title and prompt and picks the model for *that agent*: haiku, sonnet or opus. Two agents of one session can get different models. The mod does this in an `agent.spawn` hook, which Claude Code's subagent docs describe as replacing the per-invocation `model` parameter.

- **Fable warning.** An agent that would run on Fable (named by the Agent call, or picked when `allowFable` is on) stops first and asks: *Proceed on Fable / Use Opus instead / Cancel agent*. With nobody to ask, it uses Opus.
- **Fallback.** If Haiku times out or answers badly, a keyword rule on the agent type and task decides. The mod never blocks a spawn.
- **`/router`**: `status` (default) shows the estimated saving, `off` / `on` pauses it, `reset` clears the tally. The status line carries the running total.
- **Options:** `ceiling` (`opus` default, `sonnet`, or `parent` = never above the spawning session's model), `respectExplicit`, `allowFable`, `showNotice`.

Not covered: the main session's own model, forks (they inherit the parent's), and a session that sets `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, which outranks the hook.

## Estimated saving

Prices (per MTok, in / out): Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20, Fable 5.2 $8 / $40 (platform.claude.com pricing, 2026-11-16). One agent at 20k in / 3k out costs about $0.003 on Haiku, $0.07 on Sonnet, $0.14 on Opus. Routing costs about $0.00015 a spawn.

Ten agents in an Opus session, routed 5 haiku / 4 sonnet / 1 opus: about $1.40 without the router, $0.44 with it, so a saving of about $0.96 (69%). The tally starts from the 20k/3k assumption and uses each agent's real token counts as it finishes. It is an estimate: it assumes the same tokens on the parent model and ignores retries a cheaper model may need. Update `PRICE` in `hooks/router.ts` when prices change.
