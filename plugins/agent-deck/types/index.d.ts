export type AgentDeckStepStatus = 'pending' | 'in_progress' | 'completed'

/** One step of the to-do list the band tracks. */
export type AgentDeckStep = {
  id: string
  text: string
  status: AgentDeckStepStatus
  /** The "doing it now" wording, when the tool gave one. */
  active?: string
  /** How far a step in progress is, 0 to 1, when something knows (the demo). */
  fill?: number
}

/** `queued` is an agent that has a card but has not started. */
export type AgentDeckAgentStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'stopped'

/** Which pixel sprite an agent wears. */
export type AgentDeckRole =
  | 'main'
  | 'explore'
  | 'coder'
  | 'reviewer'
  | 'tester'

/** One subagent's card in the pane. */
export type AgentDeckAgent = {
  id: string
  type: string
  role: AgentDeckRole
  description: string
  /** The model it was spawned on (an id or alias, or a demo label). */
  model?: string
  status: AgentDeckAgentStatus
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
export type AgentDeckMain = {
  tools: number
  tokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-deck': {
      steps: Shaped<AgentDeckStep[]>
      agents: Shaped<AgentDeckAgent[]>
      main: Shaped<AgentDeckMain>
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
