// Pure helpers: no `$`, no elements. Everything the hooks module decides
// about steps, agents and wording lives here so it can be tested directly.

import type {
  AgentDeckAgent,
  AgentDeckAgentStatus,
  AgentDeckMain,
  AgentDeckRole,
  AgentDeckStep,
  AgentDeckStepStatus,
} from '../types'

type Loose = Record<string, unknown>

const isRecord = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

const STATUSES: readonly AgentDeckStepStatus[] = [
  'pending',
  'in_progress',
  'completed',
]

const stepStatus = (value: unknown): AgentDeckStepStatus =>
  STATUSES.find(one => one === value) ?? 'pending'

// ---------------------------------------------------------------- steps --

/** Reads a whole list as a to-do or plan tool sends it. */
export const stepsFromList = (raw: unknown): AgentDeckStep[] => {
  if (!Array.isArray(raw)) return []
  const steps: AgentDeckStep[] = []
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
  steps: readonly AgentDeckStep[],
  id: string,
  label: string,
  active?: string,
): AgentDeckStep[] => [
  ...steps.filter(step => step.id !== id),
  { id, text: label, status: 'pending', ...(active ? { active } : {}) },
]

/** A TaskUpdate: new status or wording; `deleted` drops the step. */
export const patchStep = (
  steps: readonly AgentDeckStep[],
  id: string,
  patch: Loose,
): AgentDeckStep[] => {
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
  steps: readonly AgentDeckStep[],
): AgentDeckStep[] => {
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
  steps: readonly AgentDeckStep[],
  input: Loose,
): AgentDeckStep[] => {
  const whole = input.items ?? input.steps ?? input.todos
  if (Array.isArray(whole)) return stepsFromList(whole)

  let next: AgentDeckStep[] = [...steps]
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
  steps: readonly AgentDeckStep[],
  kind: StepKind,
  input: Loose,
  result: unknown,
): AgentDeckStep[] => {
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
  current?: AgentDeckStep
  isFinished: boolean
}

export const progressOf = (steps: readonly AgentDeckStep[]): Progress => {
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

export type BarRun = { status: AgentDeckStepStatus; cells: number }

/**
 * The segmented bar as runs of same-status cells: one cell per step while
 * they fit in `width`, else each cell stands for the step under it.
 */
export const barRuns = (
  steps: readonly AgentDeckStep[],
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

export type ModelKey = 'haiku' | 'sonnet' | 'opus' | 'fable'

/** Color means the model: one hue per family, a light and a dark value. */
export const MODEL_COLOR: Record<ModelKey, { light: string; dark: string }> = {
  haiku: { light: '#2f6fa3', dark: '#6a9bcc' },
  sonnet: { light: '#6d5fb5', dark: '#a79bd6' },
  opus: { light: '#b23f68', dark: '#d4789a' },
  fable: { light: '#c8643f', dark: '#d97757' },
}

const FAMILIES: readonly ModelKey[] = ['haiku', 'sonnet', 'opus', 'fable']

/** The family a model id, alias or label names; Sonnet when it names none. */
export const modelKey = (model?: string): ModelKey => {
  const name = (model ?? '').toLowerCase()

  return FAMILIES.find(one => name.includes(one)) ?? 'sonnet'
}

/** `claude-opus-4-5` or `opus` as `Opus 4.5` / `Opus`; a label stays as it is. */
export const modelLabel = (model?: string): string => {
  const name = (model ?? '').trim()
  const family = FAMILIES.find(one => name.toLowerCase().includes(one))
  if (!family) return name === '' ? 'Sonnet' : clip(name, 24)
  const head = family[0]!.toUpperCase() + family.slice(1)
  const rest = name.toLowerCase().slice(name.toLowerCase().indexOf(family) + family.length)
  const version = /^[\s-]*(\d+)(?:[-.](\d)(?!\d))?/.exec(rest)
  if (!version) return head

  return `${head} ${version[1]}${version[2] ? `.${version[2]}` : ''}`
}

/** Which sprite a subagent type wears: antenna, glasses, hard hat or plain. */
export const roleOf = (type: string): AgentDeckRole => {
  const name = type.toLowerCase()
  if (name.includes('explore')) return 'explore'
  if (name.includes('review')) return 'reviewer'
  if (name.includes('test')) return 'tester'

  return 'coder'
}

export const addAgent = (
  agents: readonly AgentDeckAgent[],
  agent: AgentDeckAgent,
): AgentDeckAgent[] =>
  [...agents.filter(one => one.id !== agent.id), agent].slice(-MAX_AGENTS)

/** One more tool call by an agent; an unknown agent gets a card. */
export const touchAgent = (
  agents: readonly AgentDeckAgent[],
  id: string,
  label: string,
  at: number,
): AgentDeckAgent[] => {
  if (!agents.some(one => one.id === id)) {
    return addAgent(agents, {
      id,
      type: 'agent',
      role: 'coder',
      description: '',
      status: 'running',
      startedAt: at,
      tools: 1,
      tokens: 0,
      lastTool: label,
    })
  }

  return agents.map(one =>
    one.id === id ? { ...one, tools: one.tools + 1, lastTool: label } : one,
  )
}

/** Tokens a response used: input, output and what it wrote to the cache. */
export const usageTokens = (usage: unknown): number => {
  if (!isRecord(usage)) return 0
  const count = (key: string): number => {
    const value = usage[key]

    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }

  return (
    count('input_tokens') +
    count('output_tokens') +
    count('cache_creation_input_tokens')
  )
}

export const addTokens = (
  agents: readonly AgentDeckAgent[],
  id: string,
  tokens: number,
): AgentDeckAgent[] =>
  agents.map(one =>
    one.id === id ? { ...one, tokens: one.tokens + tokens } : one,
  )

export const settleAgent = (
  agents: readonly AgentDeckAgent[],
  id: string,
  status: AgentDeckAgentStatus,
  at: number,
  summary?: string,
): AgentDeckAgent[] =>
  agents.map(one => {
    if (one.id !== id) return one
    if (status === 'running') {
      const { endedAt: _endedAt, summary: _summary, ...rest } = one

      return { ...rest, status }
    }
    if (one.status !== 'running') return one

    return { ...one, status, endedAt: at, ...(summary ? { summary } : {}) }
  })

/** What `$.agent.list()` calls an ended agent, as a card's status. */
export const endedStatus = (
  status: string,
): AgentDeckAgentStatus | undefined => {
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'failed'
  if (status === 'killed') return 'stopped'

  return undefined
}

/** Drops the cards that ended; the ones still to come stay. */
export const clearEnded = (
  agents: readonly AgentDeckAgent[],
): AgentDeckAgent[] =>
  agents.filter(one => one.status === 'running' || one.status === 'queued')

/** In the order they began, so a card keeps its place as it changes. */
export const sortAgents = (
  agents: readonly AgentDeckAgent[],
): AgentDeckAgent[] => [...agents].sort((a, b) => a.startedAt - b.startedAt)

export const countRunning = (agents: readonly AgentDeckAgent[]): number =>
  agents.filter(one => one.status === 'running').length

export const countEnded = (agents: readonly AgentDeckAgent[]): number =>
  agents.filter(one => one.status !== 'running' && one.status !== 'queued')
    .length

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

/** `0:14`, `3:05`, `1:02:09`: the band's running clock. */
export const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}:${two(seconds % 60)}`

  return `${Math.floor(minutes / 60)}:${two(minutes % 60)}:${two(seconds % 60)}`
}

/** Always thousands: `0.9k`, `24.1k`, `1200.0k`. */
export const kfmt = (count: number): string =>
  `${(Math.round(Math.max(0, count) / 100) / 10).toFixed(1)}k`

/** What the tokens would cost at a blended five dollars a million. */
export const estimateCost = (tokens: number): number => tokens * 0.000005

/** Two decimals from a cent up, three below: `$0.44`, `$0.003`. */
export const money = (usd: number): string =>
  usd > 0 && usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`

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

// ---------------------------------------------------------------- views --

/** One card as the pane draws it: the main agent's or a subagent's. */
export type CardView = {
  id: string
  name: string
  role: AgentDeckRole
  /** The model label the chip shows, such as `Haiku 5.5`. */
  model: string
  modelKey: ModelKey
  status: AgentDeckAgentStatus
  task: string
  line: string
  calls: number
  tokens: number
  /** Undefined for a card that has not started. */
  elapsedMs?: number
  /** 0 to 1, drawn only while the card runs. */
  progress: number
  /** Whether it is a real subagent a transcript can open. */
  isOpenable: boolean
}

/** Agents working or finished, the main card counted: the pane's tally. */
export const tally = (cards: readonly CardView[]): { working: number; done: number } => ({
  working: cards.filter(one => one.status === 'running').length,
  done: cards.filter(one => one.status === 'done').length,
})

const STATUS_WORD: Record<AgentDeckAgentStatus, string> = {
  queued: 'Queued',
  running: 'Working',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
}

export const statusWord = (status: AgentDeckAgentStatus): string =>
  STATUS_WORD[status]

/** How full the plan is: finished steps plus the part of the one under way. */
export const planFraction = (steps: readonly AgentDeckStep[]): number => {
  if (steps.length === 0) return 0
  const sum = steps.reduce(
    (total, step) =>
      total +
      (step.status === 'completed'
        ? 1
        : step.status === 'in_progress'
          ? (step.fill ?? 0.5)
          : 0),
    0,
  )

  return Math.min(1, sum / steps.length)
}

const isPlanOver = (
  steps: readonly AgentDeckStep[],
  agents: readonly AgentDeckAgent[],
): boolean =>
  (steps.length > 0 ? progressOf(steps).isFinished : true) &&
  countRunning(agents) === 0

export const mainCard = (
  steps: readonly AgentDeckStep[],
  agents: readonly AgentDeckAgent[],
  main: AgentDeckMain,
  at: number,
  started: number,
  isBusy: boolean,
  model = '',
): CardView => {
  const progress = progressOf(steps)
  const running = countRunning(agents)
  const isOver = isPlanOver(steps, agents)
  const isIdle = !isBusy && running === 0

  return {
    id: 'main',
    name: 'Main agent',
    role: 'main',
    model: modelLabel(model),
    modelKey: modelKey(model),
    status: isIdle ? (isOver ? 'done' : 'stopped') : isOver ? 'done' : 'running',
    task: isOver
      ? steps.length > 0
        ? 'All steps done'
        : 'Idle'
      : (steps.find(one => one.status === 'in_progress')?.text ??
        progress.current?.text ??
        'Working'),
    line: isOver
      ? 'Plan complete'
      : isIdle
        ? 'Waiting for you'
        : running > 0
          ? `Coordinating ${plural(running, 'subagent')}`
          : 'Waiting for the next step',
    calls: main.tools,
    tokens: main.tokens,
    ...(started >= 0 ? { elapsedMs: Math.max(0, at - started) } : {}),
    progress: planFraction(steps),
    isOpenable: false,
  }
}

const subCard = (agent: AgentDeckAgent, at: number): CardView => {
  const isLive = agent.status === 'running'
  const fallback = isLive ? 'Starting…' : ''

  return {
    id: agent.id,
    name: agent.type,
    role: agent.role,
    model: modelLabel(agent.model),
    modelKey: modelKey(agent.model),
    status: agent.status,
    task: agent.description,
    line:
      agent.status === 'queued'
        ? 'Waiting for its turn'
        : isLive
          ? (agent.lastTool ?? fallback)
          : (agent.summary ?? agent.lastTool ?? ''),
    calls: agent.tools,
    tokens: agent.tokens,
    ...(agent.status === 'queued'
      ? {}
      : {
          elapsedMs: Math.max(
            0,
            (agent.endedAt ?? Math.max(at, agent.startedAt)) - agent.startedAt,
          ),
        }),
    progress:
      agent.progress ??
      (isLive ? Math.min(0.9, agent.tools / 10) : agent.status === 'queued' ? 0 : 1),
    isOpenable: !isDemoId(agent.id),
  }
}

/** The main agent first, then every subagent in the order they began. */
export const buildCards = (
  steps: readonly AgentDeckStep[],
  agents: readonly AgentDeckAgent[],
  main: AgentDeckMain,
  at: number,
  started: number,
  isBusy: boolean,
  model = '',
): CardView[] => [
  mainCard(steps, agents, main, at, started, isBusy, model),
  ...sortAgents(agents).map(agent => subCard(agent, at)),
]

export type BandView = {
  done: number
  total: number
  /** The step in progress, `+N` when more run at once. */
  label: string
  isFinished: boolean
  /** Cards that are working now, the main agent's included. */
  working: number
  tokens: number
  cost: number
  elapsedMs: number
}

export const bandOf = (
  steps: readonly AgentDeckStep[],
  agents: readonly AgentDeckAgent[],
  main: AgentDeckMain,
  at: number,
  started: number,
  isBusy: boolean,
): BandView => {
  const progress = progressOf(steps)
  const live = steps.filter(step => step.status === 'in_progress')
  const first = live[0] ?? progress.current
  const head = first ? (first.active ?? first.text) : 'Starting'
  const running = countRunning(agents)
  const isOver = isPlanOver(steps, agents)
  const tokens = main.tokens + agents.reduce((sum, one) => sum + one.tokens, 0)

  return {
    done: progress.done,
    total: progress.total,
    label: progress.isFinished
      ? 'All steps done'
      : steps.length === 0
        ? running > 0
          ? `${plural(running, 'subagent')} running`
          : 'Starting'
        : head + (live.length > 1 ? ` +${live.length - 1}` : ''),
    isFinished: progress.isFinished && running === 0,
    working: running + (isOver || !isBusy ? 0 : 1),
    tokens,
    cost: estimateCost(tokens),
    elapsedMs: started >= 0 ? Math.max(0, at - started) : 0,
  }
}

// ----------------------------------------------------------------- demo --

// A sample run the mod plays by itself: no model call, no real subagent.
// Every frame is a pure function of the seconds since the demo started.

export const DEMO_SECONDS = 21

type DemoRole = {
  id: string
  type: string
  role: AgentDeckRole
  model: string
  label: string
  description: string
  /** The seconds it starts and ends at. */
  from: number
  to: number
  calls: number
  tokens: number
  line: string
  summary: string
}

const DEMO_ROLES: readonly DemoRole[] = [
  {
    id: 'demo-1',
    type: 'Explore',
    role: 'explore',
    model: 'Haiku 5.5',
    label: 'Map the session code',
    description: 'Find where sessions are created',
    from: 0,
    to: 6,
    calls: 4,
    tokens: 18_000,
    line: 'Searching src/auth for session creation…',
    summary: 'Sessions start in src/auth/session.ts',
  },
  {
    id: 'demo-2',
    type: 'general-purpose',
    role: 'coder',
    model: 'Sonnet 5.5',
    label: 'Write the migration',
    description: 'Write the migration for the sessions table',
    from: 2,
    to: 12,
    calls: 7,
    tokens: 46_000,
    line: 'Writing migrations/0042_sessions.sql…',
    summary: 'Migration written and applied to the test database',
  },
  {
    id: 'demo-3',
    type: 'code-reviewer',
    role: 'reviewer',
    model: 'Opus 5.5',
    label: 'Review the change',
    description: 'Review the diff for regressions',
    from: 10,
    to: 15,
    calls: 4,
    tokens: 22_000,
    line: 'Reading the diff, 3 files changed…',
    summary: 'No regressions found in 3 changed files',
  },
  {
    id: 'demo-4',
    type: 'test-runner',
    role: 'tester',
    model: 'Haiku 5.5',
    label: 'Run the tests',
    description: 'Run the tests',
    from: 11,
    to: 18,
    calls: 5,
    tokens: 15_000,
    line: 'Running 42 tests in parallel…',
    summary: '42 passed, 0 failed',
  },
]

const DEMO_LAST = { label: 'Summarize the result', from: 18, to: 21 }
const DEMO_MAIN = { calls: 24, tokens: 24_000 }
const DEMO_FAILED = 'Stopped: the diff was not ready to review'

/** The model the demo's main agent runs on. */
export const DEMO_MAIN_MODEL = 'Fable 5.2'

export const isDemoId = (id: string): boolean => id.startsWith('demo-')

const unit = (value: number): number => Math.max(0, Math.min(1, value))

/** How many seconds into the demo it is at `at`, started at `t0`. */
export const demoTime = (t0: number, at: number): number =>
  Math.max(0, Math.min(DEMO_SECONDS, (at - t0) / 1000))

const windowOf = (
  t: number,
  from: number,
  to: number,
): { status: AgentDeckStepStatus; fill: number } => {
  const fill = unit((t - from) / (to - from))

  return t >= to
    ? { status: 'completed', fill: 1 }
    : t >= from
      ? { status: 'in_progress', fill }
      : { status: 'pending', fill: 0 }
}

export const demoSteps = (t: number): AgentDeckStep[] =>
  [
    ...DEMO_ROLES.map(one => ({ ...one, text: one.label })),
    { id: 'demo-5', text: DEMO_LAST.label, ...DEMO_LAST },
  ].map(one => {
    const { status, fill } = windowOf(t, one.from, one.to)

    return {
      id: `demo-s${one.id}`,
      text: one.text,
      status,
      ...(status === 'in_progress' ? { fill } : {}),
    }
  })

export const demoAgents = (
  t: number,
  t0: number,
  isFail = false,
): AgentDeckAgent[] =>
  DEMO_ROLES.map(one => {
    const { status, fill } = windowOf(t, one.from, one.to)
    const isFailed = isFail && one.role === 'reviewer'
    const card = {
      id: one.id,
      type: one.type,
      role: one.role,
      model: one.model,
      description: one.description,
      startedAt: t0 + one.from * 1000,
      tools: Math.floor(fill * one.calls),
      tokens: Math.round(fill * one.tokens),
      progress: fill,
    }
    if (status === 'pending') {
      return { ...card, status: 'queued' as const }
    }
    if (status === 'in_progress') {
      return { ...card, status: 'running' as const, lastTool: one.line }
    }

    return {
      ...card,
      status: isFailed ? ('failed' as const) : ('done' as const),
      endedAt: t0 + one.to * 1000,
      summary: isFailed ? DEMO_FAILED : one.summary,
    }
  })

export const demoMain = (t: number): AgentDeckMain => {
  const f = unit(t / DEMO_SECONDS)

  return {
    tools: Math.floor(f * DEMO_MAIN.calls),
    tokens: Math.round(f * DEMO_MAIN.tokens),
  }
}
