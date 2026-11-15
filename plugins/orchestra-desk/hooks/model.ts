// Pure helpers: no `$`, no elements. Everything the hooks module decides
// about steps, agents and wording lives here so it can be tested directly.

import type {
  OrchestraAgent,
  OrchestraAgentStatus,
  OrchestraStep,
  OrchestraStepStatus,
} from '../types'

type Loose = Record<string, unknown>

const isRecord = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

const STATUSES: readonly OrchestraStepStatus[] = [
  'pending',
  'in_progress',
  'completed',
]

const stepStatus = (value: unknown): OrchestraStepStatus =>
  STATUSES.find(one => one === value) ?? 'pending'

// ---------------------------------------------------------------- steps --

/** Reads a whole list as a to-do or plan tool sends it. */
export const stepsFromList = (raw: unknown): OrchestraStep[] => {
  if (!Array.isArray(raw)) return []
  const steps: OrchestraStep[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const label = text(item.content) ?? text(item.text) ?? text(item.subject)
    if (!label) continue
    const active = text(item.activeForm)
    steps.push({
      id: text(item.id) ?? `s${steps.length + 1}`,
      text: label,
      status: stepStatus(item.status),
      ...(active ? { active } : {}),
    })
  }

  return steps
}

export const addStep = (
  steps: readonly OrchestraStep[],
  id: string,
  label: string,
  active?: string,
): OrchestraStep[] => [
  ...steps.filter(step => step.id !== id),
  { id, text: label, status: 'pending', ...(active ? { active } : {}) },
]

/** A TaskUpdate: new status or wording; `deleted` drops the step. */
export const patchStep = (
  steps: readonly OrchestraStep[],
  id: string,
  patch: Loose,
): OrchestraStep[] => {
  if (patch.status === 'deleted') return steps.filter(step => step.id !== id)

  return steps.map(step => {
    if (step.id !== id) return step
    const active = text(patch.activeForm) ?? step.active

    return {
      id,
      text: text(patch.subject) ?? step.text,
      status: STATUSES.find(one => one === patch.status) ?? step.status,
      ...(active ? { active } : {}),
    }
  })
}

/** Completes the step in progress and starts the next pending one. */
export const advanceSteps = (
  steps: readonly OrchestraStep[],
): OrchestraStep[] => {
  let isStarted = false

  return steps
    .map(step =>
      step.status === 'in_progress'
        ? { ...step, status: 'completed' as const }
        : step,
    )
    .map(step => {
      if (isStarted || step.status !== 'pending') return step
      isStarted = true

      return { ...step, status: 'in_progress' as const }
    })
}

/**
 * A plan tool's call (`items` or `steps` replaces the list; `advance`,
 * `done: [n]` and `start: n` move it, steps numbered from 1).
 */
export const applyPlan = (
  steps: readonly OrchestraStep[],
  input: Loose,
): OrchestraStep[] => {
  const whole = input.items ?? input.steps ?? input.todos
  if (Array.isArray(whole)) return stepsFromList(whole)

  let next: OrchestraStep[] = [...steps]
  if (input.advance === true) next = advanceSteps(next)
  if (Array.isArray(input.done)) {
    const done = new Set(input.done)
    next = next.map((step, at) =>
      done.has(at + 1) ? { ...step, status: 'completed' as const } : step,
    )
  }
  if (typeof input.start === 'number') {
    const start = input.start
    next = next.map((step, at) =>
      at + 1 === start ? { ...step, status: 'in_progress' as const } : step,
    )
  }

  return next
}

export type StepKind = 'todos' | 'task-create' | 'task-update' | 'plan'

/** Which to-do tool a call is, or undefined for any other tool. */
export const stepTool = (tool: string): StepKind | undefined => {
  if (tool === 'TodoWrite') return 'todos'
  if (tool === 'TaskCreate') return 'task-create'
  if (tool === 'TaskUpdate') return 'task-update'
  if (/^mcp__.+__(update_plan|plan)$/.test(tool)) return 'plan'

  return undefined
}

/** The steps after one to-do tool call, given its input and its result. */
export const reduceSteps = (
  steps: readonly OrchestraStep[],
  kind: StepKind,
  input: Loose,
  result: unknown,
): OrchestraStep[] => {
  if (kind === 'todos') return stepsFromList(input.todos)
  if (kind === 'plan') return applyPlan(steps, input)
  if (kind === 'task-update') {
    const id = text(input.taskId)

    return id ? patchStep(steps, id, input) : [...steps]
  }
  const task = isRecord(result) && isRecord(result.task) ? result.task : {}
  const raw = task.id
  const id =
    typeof raw === 'number' ? String(raw) : (text(raw) ?? `t${steps.length + 1}`)
  const label = text(input.subject) ?? text(task.subject)

  return label ? addStep(steps, id, label, text(input.activeForm)) : [...steps]
}

export type Progress = {
  done: number
  total: number
  /** The step in progress, else the first pending one. */
  current?: OrchestraStep
  isFinished: boolean
}

export const progressOf = (steps: readonly OrchestraStep[]): Progress => {
  const done = steps.filter(step => step.status === 'completed').length
  const current =
    steps.find(step => step.status === 'in_progress') ??
    steps.find(step => step.status === 'pending')

  return {
    done,
    total: steps.length,
    ...(current ? { current } : {}),
    isFinished: steps.length > 0 && done === steps.length,
  }
}

export type BarRun = { status: OrchestraStepStatus; cells: number }

/**
 * The segmented bar as runs of same-status cells: one cell per step while
 * they fit in `width`, else each cell stands for the step under it.
 */
export const barRuns = (
  steps: readonly OrchestraStep[],
  width: number,
): BarRun[] => {
  const cells = Math.max(0, Math.min(steps.length, Math.floor(width)))
  const runs: BarRun[] = []
  for (let at = 0; at < cells; at++) {
    const step = steps[Math.floor((at * steps.length) / cells)]
    if (!step) continue
    const last = runs[runs.length - 1]
    if (last && last.status === step.status) last.cells++
    else runs.push({ status: step.status, cells: 1 })
  }

  return runs
}

// --------------------------------------------------------------- agents --

const MAX_AGENTS = 30

export const addAgent = (
  agents: readonly OrchestraAgent[],
  agent: OrchestraAgent,
): OrchestraAgent[] =>
  [...agents.filter(one => one.id !== agent.id), agent].slice(-MAX_AGENTS)

/** One more tool call by an agent; an unknown agent gets a card. */
export const touchAgent = (
  agents: readonly OrchestraAgent[],
  id: string,
  label: string,
  at: number,
): OrchestraAgent[] => {
  if (!agents.some(one => one.id === id)) {
    return addAgent(agents, {
      id,
      type: 'agent',
      description: '',
      status: 'running',
      startedAt: at,
      tools: 1,
      lastTool: label,
    })
  }

  return agents.map(one =>
    one.id === id ? { ...one, tools: one.tools + 1, lastTool: label } : one,
  )
}

export const settleAgent = (
  agents: readonly OrchestraAgent[],
  id: string,
  status: OrchestraAgentStatus,
  at: number,
  summary?: string,
): OrchestraAgent[] =>
  agents.map(one => {
    if (one.id !== id) return one
    if (status === 'running') {
      return {
        id: one.id,
        type: one.type,
        description: one.description,
        status,
        startedAt: one.startedAt,
        tools: one.tools,
        ...(one.lastTool ? { lastTool: one.lastTool } : {}),
      }
    }
    if (one.status !== 'running') return one

    return { ...one, status, endedAt: at, ...(summary ? { summary } : {}) }
  })

/** What `$.agent.list()` calls an ended agent, as a card's status. */
export const endedStatus = (
  status: string,
): OrchestraAgentStatus | undefined => {
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'failed'
  if (status === 'killed') return 'stopped'

  return undefined
}

export const clearEnded = (
  agents: readonly OrchestraAgent[],
): OrchestraAgent[] => agents.filter(one => one.status === 'running')

/** Running agents first, then the latest to end. */
export const sortAgents = (
  agents: readonly OrchestraAgent[],
): OrchestraAgent[] =>
  [...agents].sort((a, b) => {
    const aRuns = a.status === 'running'
    const bRuns = b.status === 'running'
    if (aRuns !== bRuns) return aRuns ? -1 : 1

    return aRuns
      ? a.startedAt - b.startedAt
      : (b.endedAt ?? 0) - (a.endedAt ?? 0)
  })

export const countRunning = (agents: readonly OrchestraAgent[]): number =>
  agents.filter(one => one.status === 'running').length

// -------------------------------------------------------------- wording --

export const clip = (value: string, max: number): string => {
  if (max <= 0) return ''
  const flat = value.replace(/\s+/g, ' ').trim()

  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`
}

export const firstLine = (value: string, max: number): string => {
  const line = value
    .split('\n')
    .map(one => one.trim())
    .find(one => one !== '')

  return clip(line ?? '', max)
}

const two = (value: number): string => String(value).padStart(2, '0')

/** `8s`, `1m 05s`, `1h 02m`. */
export const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${two(seconds % 60)}s`

  return `${Math.floor(minutes / 60)}h ${two(minutes % 60)}m`
}

const baseName = (path: string): string => path.split('/').pop() || path

/** A tool call in a few words: `Read model.ts`, `Bash npm test`. */
export const toolLabel = (tool: string, input: Loose): string => {
  const name = tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool
  const path = text(input.file_path) ?? text(input.path)
  const detail =
    (path && baseName(path)) ??
    text(input.command) ??
    text(input.pattern) ??
    text(input.query) ??
    text(input.description) ??
    text(input.url)

  return clip(detail ? `${name} ${detail}` : name, 60)
}

export const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`
