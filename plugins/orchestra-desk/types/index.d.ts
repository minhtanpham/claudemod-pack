export type OrchestraStepStatus = 'pending' | 'in_progress' | 'completed'

/** One step of the to-do list the band tracks. */
export type OrchestraStep = {
  id: string
  text: string
  status: OrchestraStepStatus
  /** The "doing it now" wording, when the tool gave one. */
  active?: string
}

export type OrchestraAgentStatus = 'running' | 'done' | 'failed' | 'stopped'

/** One subagent's card in the pane. */
export type OrchestraAgent = {
  id: string
  type: string
  description: string
  status: OrchestraAgentStatus
  startedAt: number
  endedAt?: number
  /** How many tool calls the subagent has made. */
  tools: number
  /** Short label of its latest tool call. */
  lastTool?: string
  /** First line of its answer, once it has ended. */
  summary?: string
}

declare module 'claude-code' {
  interface PluginState {
    'orchestra-desk': {
      steps: Shaped<OrchestraStep[]>
      agents: Shaped<OrchestraAgent[]>
      now: number
    }
  }
}
