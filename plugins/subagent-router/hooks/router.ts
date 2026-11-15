// Pure helpers: no `$`, no elements. Prices, the Haiku prompt and its reading,
// the totals, the wording and the demo all live here so they test directly.

import type { LiveRow, Role, RouterEntry, RouterPick, Tier } from '../types'

export type { Tier }

export const TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus', 'fable']

export const TIER_NAME: Record<Tier, string> = {
  haiku: 'Haiku 5.5',
  sonnet: 'Sonnet 5.5',
  opus: 'Opus 5.5',
  fable: 'Fable 5.2',
}

/**
 * USD per million tokens, list prices from platform.claude.com/docs/en/about-claude/pricing
 * (checked 2026-11-16). Prices change: update here, nowhere else.
 */
export const PRICE: Record<Tier, { in: number; out: number }> = {
  haiku: { in: 0.1, out: 0.5 },
  sonnet: { in: 2, out: 10 },
  opus: { in: 4, out: 20 },
  fable: { in: 8, out: 40 },
}

/** An estimate splits an agent's tokens 80% input, 20% output. */
export const SPLIT = { in: 0.8, out: 0.2 } as const

/** Tokens one Haiku review takes (prompt and reply). */
export const ROUTER_TOKENS = 2000

export const rank = (t: Tier): number => TIERS.indexOf(t)

/** The tier a model id or alias belongs to; an unknown one counts as opus. */
export function tierOf(model: string | undefined): Tier {
  const m = (model ?? '').toLowerCase()
  for (const t of TIERS) if (m.includes(t)) return t

  return 'opus'
}

export const cost = (t: Tier, inTok: number, outTok: number): number =>
  (inTok * PRICE[t].in + outTok * PRICE[t].out) / 1_000_000

/** `tok` tokens split 80/20. */
export const split = (tok: number): { inTok: number; outTok: number } => ({
  inTok: tok * SPLIT.in,
  outTok: tok * SPLIT.out,
})

/** What one Haiku review costs: 2k tokens, $0.00036 at list price. */
export const OVERHEAD = cost('haiku', ROUTER_TOKENS * SPLIT.in, ROUTER_TOKENS * SPLIT.out)

/** The highest tier the router may pick: `parent` is the spawning session's own. */
export type Ceiling = 'opus' | 'sonnet' | 'parent'

/**
 * Holds `want` under the ceiling. Fable may pass the `opus` ceiling: it always
 * asks the person first.
 */
export function capTier(want: Tier, parent: Tier, ceiling: Ceiling): Tier {
  if (want === 'fable' && ceiling === 'opus') return 'fable'
  const top: Tier = ceiling === 'parent' ? parent : ceiling

  return rank(want) > rank(top) ? top : want
}

/** Agents that edit code never run below Sonnet. */
export const floorTier = (t: Tier, edits: boolean): Tier =>
  edits && rank(t) < rank('sonnet') ? 'sonnet' : t

/** The mascot an agent type wears. */
export function roleOf(type: string, edits = false): Role {
  const t = type.toLowerCase()
  if (/test/.test(t)) return 'tester'
  if (/review|audit/.test(t)) return 'reviewer'
  if (/explore|search|guide|find/.test(t)) return 'explore'
  if (edits || t === 'general-purpose') return 'coder'

  return 'main'
}

const ROLE_TOKENS: Record<Role, number> = {
  explore: 18_000,
  coder: 46_000,
  reviewer: 22_000,
  tester: 15_000,
  main: 30_000,
}

/** Tokens an agent is assumed to use until its real usage is known. */
export const estimateTokens = (role: Role, prompt: string): number =>
  ROLE_TOKENS[role] + Math.round(prompt.length / 4)

// --------------------------------------------------------------- haiku --

const RUBRIC = `You choose which Claude model should run ONE subagent, judging only that agent's task. Reply with ONE line of JSON and nothing else:
{"model":"haiku"|"sonnet"|"opus"|"fable","scope":"<2-3 words>","why":"<8 words>","edits":true|false}
scope: what the agent does, e.g. "Read-only search", "Code edits", "Multi-file review", "Run and report".
why: a verb phrase that follows the agent's name, e.g. "redesigns storage across 3 services and touches auth".
edits: true when the agent writes or changes code or files.
haiku: read-only search or exploration, listing, summarizing, running commands and reporting output.
sonnet: ordinary implementation, a located bug fix, writing tests, a small refactor or review.
opus: multi-file review, ambiguous debugging, large refactors, long multi-step planning.
fable: only cross-service architecture or security-critical design where opus would likely fail; rare.
When unsure between two, pick the cheaper one only if a wrong answer is easy to spot and redo.`

/** The prompt Haiku reads: the task, trimmed to its start and end. */
export function classifyPrompt(
  a: { type: string; description: string; prompt: string },
  isFableAllowed = true,
): string {
  const p =
    a.prompt.length > 3000 ? `${a.prompt.slice(0, 2000)}\n...\n${a.prompt.slice(-900)}` : a.prompt
  const rubric = isFableAllowed
    ? RUBRIC
    : RUBRIC.replace('|"fable"', '').replace(/\nfable:[^\n]*/, '')

  return `${rubric}\n\nAgent type: ${a.type}\nTask title: ${a.description}\nTask:\n${p}`
}

export type Verdict = { tier: Tier; scope: string; why: string; edits: boolean }

const words = (v: unknown, n: number): string =>
  typeof v === 'string' ? v.trim().slice(0, n) : ''

/** Reads Haiku's `{model, scope, why, edits}`; undefined when it is not that JSON. */
export function parseVerdict(text: string): Verdict | undefined {
  const m = /\{[^{}]*\}/.exec(text)
  if (!m) return undefined
  try {
    const v = JSON.parse(m[0]) as Record<string, unknown>
    const t = typeof v.model === 'string' ? v.model.toLowerCase() : ''
    if (!TIERS.includes(t as Tier)) return undefined

    return {
      tier: t as Tier,
      scope: words(v.scope, 40),
      why: words(v.why, 80),
      edits: v.edits === true,
    }
  } catch {
    return undefined
  }
}

/**
 * The question asked before an agent runs on Fable, as design/cli 03 words it:
 * the agent and Haiku's reason, then both prices.
 */
export function fableQuestion(name: string, why: string, tok: number): string {
  const { inTok, outTok } = split(tok)

  return (
    `${name} ${why || 'needs the hardest kind of reasoning'}.\n` +
    `Haiku picked Fable 5.2 ${money(cost('fable', inTok, outTok))}. ` +
    `Opus 5.5 would cost ${money(cost('opus', inTok, outTok))}.`
  )
}

export const USE_FABLE = 'Use Fable 5.2'
export const USE_OPUS = 'Use Opus 5.5 instead'
export const CANCEL = 'Cancel this agent'
export const FABLE_OPTIONS = [USE_FABLE, USE_OPUS, CANCEL] as const
/** The dialog's chip (12 characters at most). */
export const FABLE_HEADER = 'Fable needed'

/** The status line under the prompt (design/cli 03, 04). */
export function statusLine(t: Totals, isWaiting: boolean): string {
  return isWaiting
    ? 'subagent-router · waiting for your OK'
    : `subagent-router · ${money(Math.max(0, t.saved))} saved (${t.pct}%)`
}

// --------------------------------------------------------------- usage --

type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/** Input tokens priced as plain input: a cache write costs 1.25x, a read 0.1x. */
export function effective(u: Usage | undefined): { inTok: number; outTok: number } | undefined {
  if (!u) return undefined
  const inTok =
    (u.input_tokens ?? 0) +
    1.25 * (u.cache_creation_input_tokens ?? 0) +
    0.1 * (u.cache_read_input_tokens ?? 0)
  const outTok = u.output_tokens ?? 0

  return inTok + outTok > 0 ? { inTok, outTok } : undefined
}

// -------------------------------------------------------------- totals --

/** What the router's own Haiku calls cost: one per routed (or pending) agent. */
export const routerCost = (entries: readonly RouterEntry[], live: readonly LiveRow[]): number =>
  OVERHEAD *
  (entries.filter(x => x.isHaiku && !x.isCancelled).length +
    live.filter(x => x.status === 'pending').length)

export const rowCost = (x: RouterEntry): number => cost(x.chosen, x.inTok, x.outTok)
export const rowBase = (x: RouterEntry): number => cost(x.baseline, x.inTok, x.outTok)
export const rowPct = (x: RouterEntry): number => {
  const b = rowBase(x)

  return b > 0 ? Math.round((1 - rowCost(x) / b) * 100) : 0
}

export type Totals = {
  agents: number
  cancelled: number
  measured: number
  /** Routed cost, without the router. */
  spent: number
  /** Every agent on its session model. */
  baseline: number
  overhead: number
  /** Routed cost with the router's own. */
  total: number
  saved: number
  pct: number
  byTier: Record<Tier, number>
  /** Routed cost per model, in the order the agents ran. */
  segments: { tier: Tier; usd: number }[]
}

/** The totals over the agents that ran; a cancelled agent costs nothing and saves nothing. */
export function totals(entries: readonly RouterEntry[], overhead: number): Totals {
  const byTier: Record<Tier, number> = { haiku: 0, sonnet: 0, opus: 0, fable: 0 }
  const segments: Totals['segments'] = []
  let spent = 0
  let baseline = 0
  let measured = 0
  let cancelled = 0
  for (const x of entries) {
    if (x.isCancelled) {
      cancelled++
      continue
    }
    byTier[x.chosen]++
    const c = rowCost(x)
    spent += c
    baseline += rowBase(x)
    segments.push({ tier: x.chosen, usd: c })
    if (x.isMeasured) measured++
  }
  const total = spent + overhead
  // Never negative: a router that costs more than it saves shows $0.
  const saved = Math.max(0, baseline - total)

  return {
    agents: entries.length - cancelled,
    cancelled,
    measured,
    spent,
    baseline,
    overhead,
    total,
    saved,
    pct: baseline > 0 ? Math.round((Math.max(0, saved) / baseline) * 100) : 0,
    byTier,
    segments,
  }
}

/** Dollars: three decimals under a cent, else two. */
export const money = (n: number): string =>
  n > 0 && n < 0.0005 ? '<$0.001' : n < 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`
export const usd = money

/** The text `/router status` answers. */
export function report(t: Totals, isOff: boolean, mode: string): string {
  const state = isOff ? 'off' : `on (${mode})`
  if (t.agents + t.cancelled === 0) return `subagent-router is ${state}. No subagent routed yet.`
  const mix = TIERS.filter(k => t.byTier[k] > 0)
    .map(k => `${t.byTier[k]} ${k}`)
    .join(', ')

  return [
    `subagent-router is ${state}: ${t.agents} subagents routed (${mix || 'none'})${t.cancelled ? `, ${t.cancelled} cancelled` : ''}.`,
    `Without the router (every agent on the session model): ~${money(t.baseline)}. With it: ~${money(t.total)}, including ${money(t.overhead)} for the Haiku reviews.`,
    `Estimated saving: ~${money(Math.max(0, t.saved))} (${t.pct}%). ${t.measured}/${t.agents} use real token counts; the rest are estimates split 80% input, 20% output.`,
    'List prices; it ignores retries a cheaper model may need.',
  ].join('\n')
}

// ----------------------------------------------------------------- demo --

/** The demo steps every half second; it waits at this step for the Fable answer. */
export const DEMO_ASK_STEP = 16
/** The demo clears this many steps after the answer. */
export const DEMO_END_STEP = 76

export const DEMO_AGENTS: readonly {
  type: string
  role: Role
  scope: string
  why: string
  tok: number
  tier: Tier
}[] = [
  { type: 'Explore', role: 'explore', scope: 'Read-only search', why: 'no edits, the cheapest model is enough', tok: 18_000, tier: 'haiku' },
  { type: 'general-purpose', role: 'coder', scope: 'Code edits, Sonnet floor', why: 'writes SQL that must run, Sonnet is the floor', tok: 46_000, tier: 'sonnet' },
  { type: 'code-reviewer', role: 'reviewer', scope: 'Multi-file review', why: 'holds 3 changed files in mind', tok: 22_000, tier: 'opus' },
  { type: 'test-runner', role: 'tester', scope: 'Run and report', why: 'mechanical, run and summarize', tok: 15_000, tier: 'haiku' },
  { type: 'schema-architect', role: 'main', scope: 'Cross-service design, auth', why: 'redesigns storage across 3 services and touches auth', tok: 30_000, tier: 'fable' },
]

/** What the band shows at half-second step `k` of `/router demo`; no model is called. */
export function demoView(
  k: number,
  pick: RouterPick,
): { entries: RouterEntry[]; live: LiveRow[]; overhead: number } {
  const entries: RouterEntry[] = []
  const live: LiveRow[] = []
  DEMO_AGENTS.forEach((a, i) => {
    const start = 2 + i * 3
    const isLast = i === DEMO_AGENTS.length - 1
    const id = `demo:${i}`
    const row = { id, type: a.type, role: a.role, scope: a.scope, why: a.why }
    if (k < start) {
      live.push({ ...row, status: 'queued', tier: 'fable' })
      return
    }
    if (k < start + 2) {
      live.push({ ...row, status: 'reviewing', tier: 'fable' })
      return
    }
    if (isLast && pick === '') {
      live.push({ ...row, status: 'pending', tier: 'fable' })
      return
    }
    entries.push({
      ...row,
      chosen: isLast && pick === 'opus' ? 'opus' : a.tier,
      baseline: 'fable',
      isHaiku: true,
      isCancelled: isLast && pick === 'cancel',
      ...split(a.tok),
      isMeasured: false,
    })
  })

  return { entries, live, overhead: routerCost(entries, live) }
}
