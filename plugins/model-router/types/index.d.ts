/** A model the router can pick. */
export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable'

/** What the agent's mascot wears: explore an antenna, tester a cap, reviewer glasses. */
export type Role = 'explore' | 'coder' | 'reviewer' | 'tester' | 'main'

/** One subagent the router decided a model for. */
export type RouterEntry = {
  /** The subagent's id; `spawn:<tool_use_id>` until the engine gives one. */
  id: string
  /** The agent type (`Explore`, `general-purpose`, ...). */
  type: string
  role: Role
  /** Haiku's short scope ("Read-only search", "Code edits"). */
  scope: string
  /** Haiku's one-line reason. */
  why: string
  /** The model the agent runs on. */
  chosen: Tier
  /** The model it would have run on without the router (the session's). */
  baseline: Tier
  /** Whether Haiku decided (false: the router failed and the session model stood). */
  isHaiku: boolean
  /** The person cancelled it at the Fable question. */
  isCancelled: boolean
  /** Effective input tokens (cache-weighted) and output tokens. */
  inTok: number
  outTok: number
  /** True once the numbers are the subagent's real usage, not the estimate. */
  isMeasured: boolean
}

/** An agent the router has not settled yet. */
export type LiveRow = {
  id: string
  type: string
  role: Role
  /** queued: waiting for the router; reviewing: Haiku reads it; pending: Fable needs the person's OK. */
  status: 'queued' | 'reviewing' | 'pending'
  scope: string
  why: string
  /** The model Haiku picked (pending rows), else the session model. */
  tier: Tier
}

/** When Haiku reviews: each spawn, once per prompt and agent type, once per session and agent type. */
export type RouterMode = 'spawn' | 'prompt' | 'session'

/** The demo's answer to the Fable question; empty until answered. */
export type RouterPick = '' | 'fable' | 'opus' | 'cancel'

declare module 'claude-code' {
  interface PluginState {
    'model-router': {
      ledger: Shaped<RouterEntry[]>
      /** Agents not settled yet, in the order they arrived. */
      live: Shaped<LiveRow[]>
      /** Turned off with `/router off`. */
      isOff: Shaped<boolean>
      /** The routing band's body is shown. */
      isOpen: Shaped<boolean>
      mode: Shaped<RouterMode>
      pick: Shaped<RouterPick>
      /** When `/router demo` began (ms); -1 when none plays. */
      demo: Shaped<number>
      /** Wall clock in ms, ticked while the router works (for the terminal's frames). */
      now: Shaped<number>
    }
  }
}
