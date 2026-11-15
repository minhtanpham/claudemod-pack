import type { RouterEntry, RouterOverhead } from '../types'

export type Tier = RouterEntry['chosen']

export const TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus', 'fable']

/**
 * USD per million tokens, from platform.claude.com/docs/en/about-claude/pricing
 * (checked 2026-11-16): Haiku 5.5 up to 100k-token prompts, Sonnet 5.5, Opus 5.5,
 * Fable 5.2. Prices change: update here.
 */
export const PRICE: Record<Tier, { in: number; out: number }> = {
  haiku: { in: 0.1, out: 0.5 },
  sonnet: { in: 2, out: 10 },
  opus: { in: 4, out: 20 },
  fable: { in: 8, out: 40 },
}

/** What one subagent is assumed to use before its real usage is known. */
export const ASSUMED = { inTok: 20_000, outTok: 3_000 }

export const rank = (t: Tier): number => TIERS.indexOf(t)

/** The tier a model id or alias belongs to; an unknown one counts as opus. */
export function tierOf(model: string | undefined): Tier {
  const m = (model ?? '').toLowerCase()
  for (const t of TIERS) if (m.includes(t)) return t

  return 'opus'
}

/** The highest tier the router may pick: `parent` is the spawning session's own. */
export type Ceiling = 'opus' | 'sonnet' | 'parent'

export function capTier(want: Tier, parent: Tier, ceiling: Ceiling): Tier {
  const top: Tier = ceiling === 'parent' ? parent : ceiling

  return rank(want) > rank(top) ? top : want
}

/** The warning shown before an agent runs on Fable. */
export function fableWarning(a: { type: string; description: string }): string {
  const x = (PRICE.fable.out / PRICE.opus.out).toFixed(0)
  const h = Math.round(PRICE.fable.out / PRICE.haiku.out)

  return `Agent "${a.description || a.type}" is about to run on Fable: ${x}x Opus and ${h}x Haiku per output token ($${PRICE.fable.in} in / $${PRICE.fable.out} out per MTok). Run it on Fable?`
}

const RUBRIC = `You choose which Claude model should run ONE subagent, judging only that agent's task. Different agents of the same session may get different models. Reply with ONE line of JSON and nothing else: {"model":"haiku"|"sonnet"|"opus","why":"<8 words>"}.
haiku: read-only search or exploration, listing, grepping, summarizing, reformatting, running commands and reporting output, mechanical or boilerplate edits.
sonnet: ordinary implementation, a bug fix in code that is already located, writing tests, a moderate refactor, reviewing a small diff.
opus: architecture or design, ambiguous or cross-cutting debugging, large refactors, security review, long multi-step planning.
When unsure between two, pick the cheaper one only if a wrong answer is easy to spot and redo.`

const RUBRIC_FABLE = `${RUBRIC.replace('"opus",', '"opus"|"fable",')}
fable: only the hardest, longest-horizon reasoning where opus would likely fail; rare.`

/** The prompt Haiku classifies: the task, trimmed to its start and end. */
export function classifyPrompt(
  a: { type: string; description: string; prompt: string },
  isFableAllowed = false,
): string {
  const p =
    a.prompt.length > 3000
      ? `${a.prompt.slice(0, 2000)}\n...\n${a.prompt.slice(-900)}`
      : a.prompt

  return `${isFableAllowed ? RUBRIC_FABLE : RUBRIC}\n\nAgent type: ${a.type}\nTask title: ${a.description}\nTask:\n${p}`
}

/** Reads Haiku's reply; undefined when it is not the asked-for JSON. */
export function parseVerdict(text: string): { tier: Tier; why: string } | undefined {
  const m = /\{[^{}]*\}/.exec(text)
  if (!m) return undefined
  try {
    const v = JSON.parse(m[0]) as { model?: unknown; why?: unknown }
    const t = typeof v.model === 'string' ? v.model.toLowerCase() : ''
    if (t !== 'haiku' && t !== 'sonnet' && t !== 'opus' && t !== 'fable') return undefined

    return { tier: t, why: typeof v.why === 'string' ? v.why.slice(0, 80) : '' }
  } catch {
    return undefined
  }
}

const HEAVY =
  /\b(architect|design|security|vulnerab|threat|migrat|refactor (the|all|every)|root cause|race condition|deadlock|plan)\b/i
const LIGHT =
  /\b(find|search|grep|list|locate|read|summari[sz]e|explore|where is|which files|count|run (the )?tests?|report)\b/i

/** When Haiku cannot answer: the agent type, then the task's own words. */
export function fallbackVerdict(a: { type: string; description: string; prompt: string }): {
  tier: Tier
  why: string
} {
  if (/^(explore|claude-code-guide|code-search)$/i.test(a.type)) {
    return { tier: 'haiku', why: 'fallback: read-only agent type' }
  }
  const text = `${a.description} ${a.prompt.slice(0, 600)}`
  if (HEAVY.test(text)) return { tier: 'opus', why: 'fallback: design or risk words' }
  if (LIGHT.test(text) && a.prompt.length < 1500) {
    return { tier: 'haiku', why: 'fallback: lookup words' }
  }

  return { tier: 'sonnet', why: 'fallback: ordinary task' }
}

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

export const cost = (t: Tier, inTok: number, outTok: number): number =>
  (inTok * PRICE[t].in + outTok * PRICE[t].out) / 1_000_000

export type Totals = {
  agents: number
  measured: number
  spent: number
  baseline: number
  overhead: number
  saved: number
  pct: number
  byTier: Record<Tier, number>
}

/** The ledger's totals: what ran, what it would have cost unrouted, the router's own cost. */
export function totals(ledger: readonly RouterEntry[], o: RouterOverhead): Totals {
  const byTier: Record<Tier, number> = { haiku: 0, sonnet: 0, opus: 0, fable: 0 }
  let spent = 0
  let baseline = 0
  let measured = 0
  for (const e of ledger) {
    byTier[e.chosen]++
    spent += cost(e.chosen, e.inTok, e.outTok)
    baseline += cost(e.baseline, e.inTok, e.outTok)
    if (e.isMeasured) measured++
  }
  const overhead = cost('haiku', o.inTok, o.outTok)
  const saved = baseline - spent - overhead

  return {
    agents: ledger.length,
    measured,
    spent,
    baseline,
    overhead,
    saved,
    pct: baseline > 0 ? (saved / baseline) * 100 : 0,
    byTier,
  }
}

export const usd = (n: number): string =>
  Math.abs(n) >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(n === 0 ? 2 : 4)}`

/** The text `/router status` answers. */
export function report(t: Totals, o: RouterOverhead, isOff: boolean): string {
  const state = isOff ? 'off' : 'on'
  if (t.agents === 0) return `model-router is ${state}. No subagent routed yet.`
  const mix = (['haiku', 'sonnet', 'opus', 'fable'] as const)
    .filter(k => t.byTier[k] > 0)
    .map(k => `${t.byTier[k]} ${k}`)
    .join(', ')

  return [
    `model-router is ${state}: ${t.agents} subagents routed (${mix}).`,
    `Without the router (every agent on the parent's model): ~${usd(t.baseline)}. With it: ~${usd(t.spent)} + ${usd(t.overhead)} for ${o.calls} Haiku calls.`,
    `Estimated saving: ~${usd(t.saved)} (${t.pct.toFixed(0)}%). ${t.measured}/${t.agents} use real token counts; the rest assume ${ASSUMED.inTok / 1000}k in / ${ASSUMED.outTok / 1000}k out.`,
    o.failed > 0 ? `Haiku could not decide ${o.failed} time(s); the keyword fallback did.` : '',
    'An estimate: it assumes the same tokens on the parent model and ignores retries a cheaper model may need.',
  ]
    .filter(Boolean)
    .join('\n')
}

// ----------------------------------------------------------------- demo --

export const DEMO_SECONDS = 24

const DEMO_AGENTS: readonly { type: string; tier: Tier; tok: number; why: string }[] = [
  { type: 'Explore', tier: 'haiku', tok: 18_000, why: 'read-only search, the cheapest model is enough' },
  { type: 'general-purpose', tier: 'sonnet', tok: 46_000, why: 'writes SQL that must run, Sonnet is the floor' },
  { type: 'code-reviewer', tier: 'opus', tok: 22_000, why: 'holds 3 changed files in mind' },
  { type: 'test-runner', tier: 'haiku', tok: 15_000, why: 'mechanical, run and summarize' },
  { type: 'schema-architect', tier: 'fable', tok: 30_000, why: 'cross-service design, Fable declined' },
]

/** What the band shows `t` seconds into `/router demo`: no model is called. */
export function demoView(t: number): {
  entries: RouterEntry[]
  reviewing: string
  waiting: string
} {
  const entries: RouterEntry[] = []
  let reviewing = ''
  let waiting = ''
  DEMO_AGENTS.forEach((a, i) => {
    const start = i * 3
    const last = i === DEMO_AGENTS.length - 1
    if (t < start) return
    if (t < start + 2) {
      reviewing = a.type
      return
    }
    if (last && t < start + 7) {
      waiting = a.type
      return
    }
    entries.push({
      id: `demo:${i}`,
      type: a.type,
      chosen: last ? 'opus' : a.tier,
      baseline: 'fable',
      why: a.why,
      isHaiku: true,
      inTok: a.tok * 0.85,
      outTok: a.tok * 0.15,
      isMeasured: true,
    })
  })

  return { entries, reviewing, waiting }
}
