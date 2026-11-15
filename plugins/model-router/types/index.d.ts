/** One subagent the router decided a model for. */
export type RouterEntry = {
  /** The subagent's id; `spawn:<tool_use_id>` until the engine gives one. */
  id: string
  /** The agent type (`Explore`, `general-purpose`, ...). */
  type: string
  /** The model alias the router picked. */
  chosen: 'haiku' | 'sonnet' | 'opus' | 'fable'
  /** The model it would have run on without the router (the parent's). */
  baseline: 'haiku' | 'sonnet' | 'opus' | 'fable'
  /** Haiku's one-line reason, or why the fallback decided. */
  why: string
  /** Whether Haiku decided (false: the keyword fallback did). */
  isHaiku: boolean
  /** Effective input tokens (cache-weighted) and output tokens. */
  inTok: number
  outTok: number
  /** True once the numbers are the subagent's real usage, not the assumed one. */
  isMeasured: boolean
}

/** What the router's own Haiku calls have cost. */
export type RouterOverhead = { calls: number; inTok: number; outTok: number; failed: number }

declare module 'claude-code' {
  interface PluginState {
    'model-router': {
      ledger: Shaped<RouterEntry[]>
      overhead: Shaped<RouterOverhead>
      /** Turned off with `/router off`. */
      isOff: Shaped<boolean>
      /** The routing band's detail rows are shown. */
      isOpen: Shaped<boolean>
      /** The agent Haiku is reading right now; empty when none. */
      reviewing: Shaped<string>
      /** The agent waiting for the person's OK on Fable; empty when none. */
      waiting: Shaped<string>
      /** Wall clock in ms, ticked while the router is deciding (for the spinner). */
      now: Shaped<number>
    }
  }
}
