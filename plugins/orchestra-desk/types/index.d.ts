export type OrchestraStepStatus = 'pending' | 'in_progress' | 'completed'

/** One step of the to-do list the band tracks. */
export type OrchestraStep = {
  id: string
  text: string
  status: OrchestraStepStatus
  /** The "doing it now" wording, when the tool gave one. */
  active?: string
  /** How far a step in progress is, 0 to 1, when something knows (the demo). */
  fill?: number
}

/** `queued` is an agent that has a card but has not started. */
export type OrchestraAgentStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'stopped'

/** Which pixel sprite an agent wears. */
export type OrchestraRole =
  | 'main'
  | 'explore'
  | 'coder'
  | 'reviewer'
  | 'tester'

/** One subagent's card in the pane. */
export type OrchestraAgent = {
  id: string
  type: string
  role: OrchestraRole
  description: string
  status: OrchestraAgentStatus
  startedAt: number
  endedAt?: number
  /** How many tool calls the subagent has made. */
  tools: number
  /** Tokens its finished turns used (input, output and cache writes). */
  tokens: number
  /** Short label of its latest tool call. */
  lastTool?: string
  /** First line of its answer, once it has ended. */
  summary?: string
  /** How far along it is, 0 to 1, when something knows (the demo). */
  progress?: number
}

/** The main agent's own counts: it has no card of its own in `agents`. */
export type OrchestraMain = {
  tools: number
  tokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'orchestra-desk': {
      steps: Shaped<OrchestraStep[]>
      agents: Shaped<OrchestraAgent[]>
      main: Shaped<OrchestraMain>
      now: Shaped<number>
      /** When the playing demo started; -1 while none plays. */
      demo: Shaped<number>
      /** Whether the playing demo ends with the reviewer failing. */
      demoFail: Shaped<boolean>
      /** When the work on this plan began; -1 while none has. */
      started: Shaped<number>
      /** Whether the main agent is in a turn now. */
      busy: Shaped<boolean>
    }
  }
}
