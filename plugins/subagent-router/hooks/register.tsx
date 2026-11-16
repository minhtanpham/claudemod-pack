import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { LiveRow, RouterEntry, RouterGroup, RouterMode, RouterPick, RouterSummary, Tier } from '../types'
import {
  CANCEL,
  DEMO_AGENTS,
  DEMO_ASK_STEP,
  DEMO_END_STEP,
  FABLE_HEADER,
  FABLE_OPTIONS,
  TIER_NAME,
  USE_FABLE,
  TIERS,
  USAGE,
  USE_OPUS,
  bumpTier,
  capTier,
  classifyPrompt,
  demoView,
  effective,
  estimateTokens,
  fableQuestion,
  floorTier,
  isLoss,
  money,
  parseVerdict,
  report,
  roleOf,
  routerCost,
  savingText,
  rowBase,
  rowCost,
  rowPct,
  split,
  statusLine,
  tierOf,
  totals,
} from './router'
import type { Ceiling, UsageMode, Verdict } from './router'
import {
  PILL_BOX,
  SPIN,
  hairSvg,
  TIER_KEY,
  pillWidth,
  savedPillSvg,
} from './look'

// Change a tag when the value's fields change: it declines what an earlier
// version stored, which outlives a hot reload.
const ledger = atom({ plugin: 'subagent-router', key: 'ledger' } as const, [], { shape: 'ledger-2' })
const live = atom({ plugin: 'subagent-router', key: 'live' } as const, [], { shape: 'live-1' })
const isOff = atom({ plugin: 'subagent-router', key: 'isOff' } as const, false, { shape: 'off-1' })
// 'auto' follows the design: collapsed, opened only for a pending Fable.
const isOpen = atom({ plugin: 'subagent-router', key: 'isOpen' } as const, 'auto' as const, { shape: 'open-3' })
const usage = atom({ plugin: 'subagent-router', key: 'usage' } as const, 'cap' as const, { shape: 'usage-1' })
const mode = atom({ plugin: 'subagent-router', key: 'mode' } as const, 'spawn', { shape: 'mode-1' })
const pick = atom({ plugin: 'subagent-router', key: 'pick' } as const, '', { shape: 'pick-1' })
const demo = atom({ plugin: 'subagent-router', key: 'demo' } as const, -1, { shape: 'demo-1' })
const now = atom({ plugin: 'subagent-router', key: 'now' } as const, 0, { shape: 'now-1' })
// The one value other mods read (Orchestra Desk draws it in its dock and pane).
// Any plugin reads any value; only this one writes it, from events, never from a render.
const summary = atom({ plugin: 'subagent-router', key: 'summary' } as const, null as RouterSummary | null)

// The terminal band's last width, so the Fable dialog's rules match it.
let bandColumns = 80
// Whether the Orchestra Desk row shares the dock: set by the list hook below
// (it sees every plugin's row), read by the next paint of this mod's row.
const ORDER = ['save', 'strong', 'cap']
let isDocked = false
// Whether a Fable question is waiting, so the card's border can turn clay.
let isWaitingFable = false

const MAX_LEDGER = 500
const ROWS = 5
const STEP_MS = 500

const MODES: readonly { id: RouterMode; label: string }[] = [
  { id: 'spawn', label: 'Every spawn' },
  { id: 'prompt', label: 'Each prompt' },
  { id: 'session', label: 'Session' },
]

const clip = (text: string, n: number): string =>
  n <= 0 ? '' : text.length <= n ? text : `${text.slice(0, Math.max(1, n - 1))}…`

/** The engine interface a hook receives. */
type Api = Parameters<Hook<'command.run'>>[0]

type Opts = { ceiling?: string; respectExplicit?: boolean; showNotice?: boolean; allowFable?: boolean }

/** One row of the band: a settled agent or one still with the router. */
type Row = { kind: 'entry'; x: RouterEntry } | { kind: 'live'; x: LiveRow }

/** The ledger, the rows still with the router, and the demo laid over them while it plays. */
async function snapshot($: Api): Promise<{
  entries: RouterEntry[]
  pending: LiveRow[]
  overhead: number
  began: number
  at: number
}> {
  let entries = await read($, ledger)
  let pending = await read($, live)
  let overhead = routerCost(entries, pending)
  const began = await read($, demo)
  const at = await read($, now)
  if (began >= 0) {
    const p = await read($, pick)
    const k = Math.max(0, Math.floor((at - began) / STEP_MS))
    const v = demoView(p === '' ? Math.min(k, DEMO_ASK_STEP) : k, p)
    entries = v.entries
    pending = v.live
    overhead = v.overhead
  }

  return { entries, pending, overhead, began, at }
}

/** Per model: how many agents, what they cost, what they saved, how many wait for an OK. */
function groupsOf(entries: RouterEntry[], pending: LiveRow[]): RouterGroup[] {
  const out: RouterGroup[] = []
  for (const tier of TIERS) {
    const es = entries.filter(x => !x.isCancelled && x.chosen === tier)
    const waits = pending.filter(x => x.status === 'pending' && x.tier === tier).length
    if (es.length === 0 && waits === 0) continue
    const cost = es.reduce((a, x) => a + rowCost(x), 0)
    const base = es.reduce((a, x) => a + rowBase(x), 0)
    out.push({ tier, n: es.length + waits, cost, pct: base > 0 ? Math.round((1 - cost / base) * 100) : 0, waits })
  }

  return out
}

/** Writes the summary other mods read. Call after any change to what it holds. */
async function publish($: Api): Promise<void> {
  try {
    const { entries, pending, overhead } = await snapshot($)
    const t = totals(entries, overhead)
    const waiting = pending.filter(x => x.status === 'pending')
    const next: RouterSummary | null =
      entries.length === 0 && pending.length === 0
        ? null
        : {
            routed: t.agents + t.cancelled,
            saved: t.saved,
            pct: t.pct,
            isLoss: isLoss(t),
            label: savingText(t),
            waiting: waiting.length,
            waitingName: waiting[0]?.type ?? '',
            mode: (await read($, usage)) as UsageMode,
            groups: groupsOf(entries, pending),
          }
    await update($, summary, () => next)
  } catch {
    // A missed publish only leaves the other mod's row a moment behind.
  }
}

/** The status line: the running total, or the wait for an OK on Fable. */
async function showStatus($: Api): Promise<void> {
  await publish($)
  const l = await read($, ledger)
  const pending = await read($, live)
  if (l.length === 0 && pending.length === 0) {
    $.ui.status(undefined)
    return
  }
  const t = totals(l, routerCost(l, pending))
  $.ui.status(statusLine(t, pending.some(x => x.status === 'pending')))
}

/** The demo's Fable question: the real dialog, no agent behind it. */
async function askDemo($: Api): Promise<void> {
  const a = DEMO_AGENTS[DEMO_AGENTS.length - 1]!
  $.ui.status(statusLine(totals([], 0), true))
  let answer: string = USE_FABLE
  try {
    answer = await $.ui.ask(fableQuestion(a.type, a.why, a.tok), {
      options: FABLE_OPTIONS,
      header: FABLE_HEADER,
    })
  } catch {
    // Nobody to ask: the demo plays on as if Fable was confirmed.
  }
  const p: RouterPick = answer === USE_OPUS ? 'opus' : answer === CANCEL ? 'cancel' : 'fable'
  const v = demoView(DEMO_END_STEP, p)
  $.ui.status(statusLine(totals(v.entries, v.overhead), false))
  const at = await $.clock.now()
  await update($, pick, () => p)
  // Resume from the question's step, so the end is timed from the answer.
  await update($, demo, () => at - DEMO_ASK_STEP * STEP_MS)
  await publish($)
}

export const register: Register = (on, options) => {
  const o = options as Opts
  const ceiling = (o.ceiling ?? 'opus') as Ceiling
  const respectExplicit = o.respectExplicit === true
  const showNotice = o.showNotice !== false
  const allowFable = o.allowFable !== false

  // Haiku reviews one agent at a time; the others wait as "queued".
  let chain: Promise<void> = Promise.resolve()
  // Decisions kept for "Each prompt" (cleared per prompt) and "Session" mode.
  const perPrompt = new Map<string, Verdict>()
  const perSession = new Map<string, Verdict>()
  let isAsking = false
  // A person at the prompt: Esc on the Fable question then cancels the agent.
  let isInteractive = false

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    await $.command.register({
      name: 'router',
      description:
        'Subagent router: "demo" plays a sample with no model call, "status" shows the estimated savings, "mode spawn|prompt|session", "off" / "on", "reset"',
    })

    $.clock.every(STEP_MS, async () => {
      try {
        const at = await $.clock.now()
        const began = await read($, demo)
        if (began >= 0) {
          const k = Math.floor((at - began) / STEP_MS)
          const p = await read($, pick)
          if (p === '' && k >= DEMO_ASK_STEP && !isAsking) {
            isAsking = true
            void askDemo($).finally(() => {
              isAsking = false
            })
          }
          if (p !== '' && k >= DEMO_END_STEP) {
            await update($, demo, () => -1)
            await update($, pick, () => '' as RouterPick)
            await showStatus($)
          }
        }
        if (began >= 0 || (await read($, live)).length > 0) {
          await update($, now, () => at)
          await publish($)
        }
      } catch {
        // A missed tick only holds the frames for a moment.
      }
    })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    perPrompt.clear()

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    // A fork inherits the parent's model; a resume continues its own run.
    if (e.fork || e.resume || (await read($, isOff))) return next(e)
    const explicit = e.model ? tierOf(e.model) : undefined
    if (respectExplicit && e.model && explicit !== 'fable') return next(e)

    const id = `spawn:${e.tool_use_id}`
    const type = e.subagentType
    const label = e.description || type
    const parent = tierOf(e.parentModel)
    const task = { type, description: e.description, prompt: e.prompt }
    const row: LiveRow = {
      id,
      type,
      role: roleOf(type),
      status: 'queued',
      scope: '',
      why: '',
      tier: parent,
    }
    const setRow = async (patch: Partial<LiveRow>) => {
      await update($, live, (l: LiveRow[]) => l.map(x => (x.id === id ? { ...x, ...patch } : x)))
      await publish($)
    }
    const dropRow = async () => {
      await update($, live, (l: LiveRow[]) => l.filter(x => x.id !== id))
      await publish($)
    }
    const record = async (x: Omit<RouterEntry, 'id' | 'type' | 'baseline' | 'isMeasured'>) => {
      await update($, ledger, (l: RouterEntry[]) =>
        [...l, { id, type, baseline: parent, isMeasured: false, ...x }].slice(-MAX_LEDGER),
      )
      await publish($)
    }

    await update($, live, (l: LiveRow[]) => [...l.filter(x => x.id !== id), row])
    try {
      let verdict: Verdict | undefined
      let isHaiku = false
      if (explicit === 'fable') {
        // A call that names Fable is deliberate: it is asked about, not overridden.
        verdict = { tier: 'fable', scope: 'Named by the call', why: 'the Agent call asked for Fable', edits: false }
      } else {
        const m = await read($, mode)
        const cache = m === 'prompt' ? perPrompt : m === 'session' ? perSession : undefined
        verdict = cache?.get(type)
        if (!verdict) {
          // Wait for the router, then hold it while Haiku reads this agent.
          const before = chain
          let release = () => {}
          chain = new Promise<void>(done => {
            release = done
          })
          await before
          try {
            await setRow({ status: 'reviewing' })
            const at = await $.clock.now()
            await update($, now, () => at)
            const r = await $.model.complete({
              model: 'haiku',
              prompt: classifyPrompt(task, allowFable),
              maxTokens: 120,
              effort: 'low',
              timeoutMs: 8000,
            })
            verdict = r.isAnswered ? parseVerdict(r.text) : undefined
            isHaiku = verdict !== undefined
            if (verdict) cache?.set(type, verdict)
          } catch {
            verdict = undefined
          } finally {
            release()
          }
        }
      }

      const role = roleOf(type, verdict?.edits)
      const tok = estimateTokens(role, e.prompt)
      if (!verdict) {
        // The router failed or timed out: the agent keeps the session model.
        await dropRow()
        await record({
          role,
          scope: 'Router failed',
          why: 'kept the session model',
          chosen: parent,
          isHaiku: false,
          isCancelled: false,
          ...split(tok),
        })

        return next(e)
      }

      const u = (await read($, usage)) as UsageMode
      const want = u === 'strong' ? bumpTier(verdict.tier, verdict.edits, role) : verdict.tier
      let chosen = floorTier(capTier(want, parent, u === 'cap' ? 'parent' : ceiling), verdict.edits)
      if (chosen === 'fable' && !allowFable && explicit !== 'fable') chosen = 'opus'
      let why = verdict.why
      const scope = verdict.scope || (verdict.edits ? 'Code edits' : 'Agent task')

      if (chosen === 'fable') {
        await setRow({ status: 'pending', role, scope, why, tier: 'fable' })
        await showStatus($)
        let answer: string = USE_OPUS
        try {
          answer = await $.ui.ask(fableQuestion(label, why, tok), {
            options: FABLE_OPTIONS,
            header: FABLE_HEADER,
          })
        } catch {
          // Esc cancels the agent; with nobody to ask (a -p run) it runs on Opus.
          // Either way Fable never runs unasked.
          answer = isInteractive ? CANCEL : USE_OPUS
        }
        if (answer === CANCEL) {
          await dropRow()
          await record({ role, scope, why, chosen: 'fable', isHaiku, isCancelled: true, ...split(tok) })
          await showStatus($)

          return { deny: 'subagent-router: agent cancelled at the Fable question.' }
        }
        if (answer !== USE_FABLE) {
          chosen = 'opus'
          why = `${why}, Fable declined`
        }
      }

      await dropRow()
      await record({ role, scope, why, chosen, isHaiku, isCancelled: false, ...split(tok) })
      if (showNotice) {
        try {
          $.ui.notice(e.tool_use_id, `subagent-router: ${TIER_NAME[chosen]} · ${scope} · ${why}`)
        } catch {
          // A note is a courtesy.
        }
      }

      const started = await next({ ...e, model: chosen })

      // Join the entry to the id the subagent's own turn.complete will carry.
      if (!started.deny && started.agentId) {
        const agentId = started.agentId
        await update($, ledger, (l: RouterEntry[]) =>
          l.map(x => (x.id === id ? { ...x, id: agentId } : x)),
        )
      }
      await showStatus($)

      return started
    } finally {
      await dropRow()
    }
  }).catch(($, e, next) => next(e))

  // A finished subagent replaces the estimate with its real usage.
  on('turn.complete', async ($, e, next) => {
    try {
      const used = e.agentId ? effective(e.usage) : undefined
      if (e.agentId && used) {
        const agentId = e.agentId
        await update($, ledger, (l: RouterEntry[]) =>
          l.map(x => (x.id === agentId ? { ...x, ...used, isMeasured: true } : x)),
        )
        await showStatus($)
      }
    } catch {
      // Bookkeeping never blocks a turn.
    }

    return next(e)
  })

  // -------------------------------------------------------------- band --

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { entries, pending, overhead, began, at } = await snapshot($)
    if (entries.length === 0 && pending.length === 0) return next(e)

    const T = $.ui.resolve(e)
    const { Box, Text, Button } = T
    // The terminal's table answers `in` for Svg too, so the surface decides.
    const isRich = e.surface !== 'terminal' && 'Svg' in T
    const t = totals(entries, overhead)
    const view = await read($, isOpen)
    const useMode = (await read($, usage)) as UsageMode
    const off = await read($, isOff)
    const current = await read($, mode)
    const frame = Math.floor(at / STEP_MS)
    const columns = Math.max(30, e.props.bodyColumns)

    const rows: Row[] = [
      ...entries.map(x => ({ kind: 'entry' as const, x })),
      ...pending.map(x => ({ kind: 'live' as const, x })),
    ].slice(-ROWS)

    const waiting = pending.find(x => x.status === 'pending')
    isWaitingFable = !!waiting
    // Collapsed by default; a pending Fable opens it.
    const open = view === 'open' || (view === 'auto' && !!waiting)
    const reviewing = pending.find(x => x.status === 'reviewing')
    const isFinished = pending.length === 0
    let status = 'Starting the router'
    if (waiting) {
      const n = pending.filter(x => x.status === 'pending').length
      status = n > 1 ? `${n} agents want Fable 5.2` : 'Fable needs your OK'
    }
    else if (reviewing) status = `Reviewing ${reviewing.type}…`
    else if (isFinished) {
      const n = t.agents + t.cancelled
      status = `${n} agent${n === 1 ? '' : 's'} routed by Haiku 5.5`
    }
    if (off && began < 0) status = 'Paused (/router on)'

    const loss = isLoss(t)
    const savedText = `${savingText(t)}${waiting ? ' so far' : ''}`

    // ----------------------------------------------------- terminal --
    // design/cli 03-07: a rule, a one-line header, plain text rows, one summary
    // line and one footer line. The terminal's table claims Svg but cannot draw
    // it, so the surface decides.
    if (e.surface === 'terminal') {
      bandColumns = columns
      const ruleColor = waiting ? 'claude' : 'inactive'
      let word = 'starting'
      if (waiting) word = 'waiting for your OK'
      else if (reviewing) word = `reviewing ${reviewing.type}…`
      else if (isFinished) word = `${t.agents + t.cancelled} routed`
      if (off && began < 0) word = 'paused (/router on)'
      const right = savedText

      const head = (
        <Box flexDirection="row" justifyContent="space-between" width={columns}>
          <Box flexDirection="row" flexGrow={1}>
            <Text color={waiting ? 'claude' : TIER_KEY.haiku}>
              {waiting ? '○' : reviewing ? SPIN[frame % SPIN.length] : '●'}{' '}
            </Text>
            <Text bold>Subagent Router</Text>
            <Text color={waiting ? 'claude' : undefined} dimColor={!waiting} wrap="truncate">
              {'  '}
              {clip(word, Math.max(4, columns - 18 - right.length - 4))}
            </Text>
          </Box>
          <Text color="success" bold>
            {right}
            {'  '}
          </Text>
          <Button
            key="toggle"
            plain
            dimColor
            label={open ? '▾' : '▸'}
            onPress={async () => {
              await update($, isOpen, () => (open ? 'closed' : 'open'))
            }}
          />
        </Box>
      )
      const rule = <Text color={ruleColor}>{'─'.repeat(columns)}</Text>

      if (!open) {
        return (
          <Box flexDirection="column">
            {rule}
            {head}
          </Box>
        )
      }

      // Columns as drawn at 88: indent+mark 3, name 17, model 11, reason 29,
      // price 8, delta 6. The reason gives way first.
      // The reason takes all the room left, so price and delta sit at the right edge.
      const reasonCols = columns - 3 - 17 - 11 - 8 - 6 - 1
      const showReason = reasonCols >= 8
      const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

      const line = (r: Row) => {
        const x = r.x
        const s = r.kind === 'live' ? r.x.status : undefined
        const cancelled = r.kind === 'entry' && r.x.isCancelled
        const tier: Tier | undefined =
          r.kind === 'entry' ? (cancelled ? undefined : r.x.chosen) : s === 'pending' ? r.x.tier : undefined

        let mark = <Text color={tier ? TIER_KEY[tier] : 'inactive'}>●</Text>
        if (cancelled) mark = <Text dimColor>×</Text>
        else if (s === 'pending') mark = <Text color="claude" bold>!</Text>
        else if (s === 'reviewing') mark = <Text color={TIER_KEY.haiku}>{SPIN[frame % SPIN.length]}</Text>
        else if (s === 'queued') mark = <Text dimColor>○</Text>

        let reason = clip(lower(x.scope), reasonCols - 1)
        if (s === 'reviewing') reason = clip('Haiku is reading…', reasonCols - 1)
        else if (s === 'queued') reason = 'queued'

        let price = <Text> </Text>
        let delta = <Text> </Text>
        if (r.kind === 'entry' && !cancelled) {
          const pct = rowPct(r.x)
          price = <Text bold>{money(rowCost(r.x))}</Text>
          delta =
            r.x.chosen === r.x.baseline || pct <= 0 ? (
              <Text dimColor>–</Text>
            ) : (
              <Text color="success">−{pct}%</Text>
            )
        } else if (s === 'pending') {
          price = <Text color="claude">needs OK</Text>
        } else if (cancelled) {
          price = <Text dimColor>cancelled</Text>
        }

        return (
          <Box key={`row-${x.id}`} flexDirection="row" width={columns}>
            <Box width={2}>{mark}</Box>
            <Box width={17}>
              <Text bold dimColor={s === 'queued' || cancelled} strikethrough={cancelled} wrap="truncate">
                {clip(x.type, 16)}
              </Text>
            </Box>
            <Box width={11}>
              <Text color={tier ? TIER_KEY[tier] : 'inactive'} dimColor={!tier}>
                {tier ? TIER_NAME[tier] : s === 'reviewing' ? 'Haiku 5.5' : ''}
              </Text>
            </Box>
            <Box flexGrow={1}>
              {showReason ? (
                <Text color={s === 'reviewing' ? TIER_KEY.haiku : undefined} dimColor={s === 'queued'} wrap="truncate">
                  {reason}
                </Text>
              ) : null}
            </Box>
            <Box width={cancelled ? 14 : 8} justifyContent="flex-end">
              {price}
            </Box>
            {cancelled ? null : (
              <Box width={6} justifyContent="flex-end">
                {delta}
              </Box>
            )}
          </Box>
        )
      }

      const baseTier = entries[entries.length - 1]?.baseline ?? 'fable'
      const baseName = TIER_NAME[baseTier].split(' ')[0]
      const sum = (
        <Box flexDirection="row">
          <Text dimColor wrap="truncate">
            {`${baseName}-only ${money(t.baseline)} → router ${money(t.total)}   `}
          </Text>
          <Text color={loss ? 'claude' : 'success'} bold>
            {loss ? `costs ~${money(-t.saved)} more` : `saved ~${money(t.saved)} (${t.pct}%)`}
          </Text>
        </Box>
      )
      const modeAt = MODES.findIndex(m => m.id === current)
      const foot = (
        <Box flexDirection="row">
          <Button
            key="mode"
            plain
            dimColor
            label={MODES[modeAt]?.label ?? MODES[0]!.label}
            onPress={async () => {
              await update($, mode, () => MODES[(modeAt + 1) % MODES.length]!.id)
            }}
          />
          <Text dimColor wrap="truncate">
            {clip(' · Fable asks first · Sonnet floor for code edits', Math.max(0, columns - 14))}
          </Text>
        </Box>
      )

      return (
        <Box flexDirection="column">
          {rule}
          {head}
          {rows.map(line)}
          {sum}
          {foot}
        </Box>
      )
    }

    // ------------------------------------------------------- header --

    // design/combined-dock: ONE row, dot, name, status, saving, mode as plain
    // text, and a chevron that only opens or closes the inline block below it.
    const isNarrow = columns < 60
    const baseName = entries[entries.length - 1]?.baseline
    const useLabel = useMode === 'cap' ? 'Cap' : useMode === 'save' ? 'Save' : 'Strong'
    const sessionName = baseName ? TIER_NAME[baseName] : 'the session model'
    const DESC: Record<UsageMode, string> = {
      save: 'Cheapest model that fits each agent. Fable asks first.',
      strong: 'One tier up for every agent. Saves less.',
      cap: `Never above your session model (${sessionName}).`,
    }
    const pctText = !loss && t.pct > 0 ? ` · ${t.pct}%` : ''
    const savedFull = `${savedText}${pctText}`
    const savedShort = loss ? savedText : money(Math.max(0, t.saved))

    let head = `${t.agents + t.cancelled} routed`
    if (waiting) head = status
    else if (reviewing) head = `Reviewing ${reviewing.type}…`
    else if (off && began < 0) head = 'Paused'
    const dotColor = waiting ? 'claude' : TIER_KEY.haiku
    const statusRoom = Math.max(10, columns - 40 - savedFull.length)

    const header = (
      <Box flexDirection="row" gap={2} alignItems="center">
        <Text color={dotColor} bold>
          {reviewing && !isRich ? SPIN[frame % SPIN.length] : '●'}
        </Text>
        <Text bold weight="bold">
          Router
        </Text>
        <Text color={waiting ? 'claude' : undefined} dimColor={!waiting} bold={!!waiting} wrap="truncate">
          {clip(head, statusRoom)}
        </Text>
        <Box flexGrow={1} />
        {isDocked ? null : isRich && !isNarrow ? (
          <T.Svg
            source={savedPillSvg(savedFull, loss)}
            alt={savedFull}
            width={pillWidth(savedFull)}
            height={PILL_BOX}
          />
        ) : (
          <Text color={loss ? 'claude' : 'success'} bold tabular>
            {isNarrow ? savedShort : savedFull}
          </Text>
        )}
        {!isNarrow && (
          <Text dimColor size="footnote">
            Mode: {useLabel}
          </Text>
        )}
        <Button
          key="toggle"
          plain
          label={open ? '▴' : '▾'}
          onPress={async () => {
            await update($, isOpen, () => (open ? 'closed' : 'open'))
          }}
        />
      </Box>
    )

    // design/combined-dock: a 1px rule splits the band row from this one.
    const rule =
      isRich && isDocked ? (
        <T.Svg source={hairSvg(columns * 9)} alt="" width={columns * 9} height={1} />
      ) : null

    if (!open) {
      return (
        <Box flexDirection="column" gap={1}>
          {rule}
          <Box flexDirection="column" paddingX={2}>
            {header}
          </Box>
        </Box>
      )
    }

    // ----------------------------------------------- inline block --

    // Mode switch: Save | Strong | Cap, the chosen one drawn solid.
    const modeSwitch = (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={2} alignItems="center">
          {[...USAGE].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id)).map(m => (
            <Button
              key={`usage-${m.id}`}
              plain
              dimColor={m.id !== useMode}
              label={m.id === useMode ? `● ${m.id === 'cap' ? 'Cap' : m.name}` : m.id === 'cap' ? 'Cap' : m.name}
              onPress={async () => {
                await update($, usage, () => m.id)
                await publish($)
              }}
            />
          ))}
        </Box>
        <Text dimColor size="footnote" wrap="truncate">
          {clip(DESC[useMode], Math.max(20, columns - 6))}
        </Text>
      </Box>
    )

    // Grouped by model, never one row per agent.
    const groupRows = TIERS.map(tr => {
      const es = entries.filter(x => !x.isCancelled && x.chosen === tr)
      const waits = pending.filter(x => x.status === 'pending' && x.tier === tr).length
      if (es.length === 0 && waits === 0) return null
      const c = es.reduce((a, x) => a + rowCost(x), 0)
      const b = es.reduce((a, x) => a + rowBase(x), 0)
      const pct = b > 0 ? Math.round((1 - c / b) * 100) : 0

      return (
        <Box key={`g-${tr}`} flexDirection="row" gap={2} alignItems="center">
          <Text color={waits > 0 ? 'claude' : TIER_KEY[tr]}>●</Text>
          <Box width={20}>
            <Text bold weight="semibold">
              {TIER_NAME[tr]} ×{es.length + waits}
            </Text>
          </Box>
          <Box flexGrow={1} />
          {waits > 0 ? (
            <Text color="claude" bold weight="bold" size="footnote">
              needs OK
            </Text>
          ) : (
            <Box flexDirection="row" gap={2}>
              <Text tabular size="footnote">
                {money(c)}
              </Text>
              <Text color={pct > 0 ? 'success' : 'claude'} weight="semibold" tabular size="footnote">
                {pct > 0 ? `−${pct}%` : pct < 0 ? `+${-pct}%` : 'no change'}
              </Text>
            </Box>
          )}
        </Box>
      )
    })

    return (
      <Box flexDirection="column" gap={1}>
        {rule}
        <Box flexDirection="column" gap={1} paddingX={2}>
          {header}
          {modeSwitch}
          <Box flexDirection="column">{groupRows as any}</Box>
        </Box>
      </Box>
    )
  })

  // design/combined-dock: both mods' rows sit in ONE card, its border clay
  // while a Fable question waits. Without the router's row the band is left alone.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    const built = await next(e)
    const mine = e.props.rows.some(r => r.plugin === 'subagent-router')
    isDocked = mine && e.props.rows.some(r => r.plugin === 'agent-deck')
    // The host already draws the card; only the divider needs the flag.
    return built
  }).catch(($, e, next) => next(e))

  // The Fable question on the terminal (design/cli 03, 07): the engine's own
  // dialog under a clay rule titled "Fable needed". The host allows nothing
  // below the engine's node, so the design's closing rule is left out.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const q = e.props.questions[0] as { header?: unknown } | undefined
    if (e.surface !== 'terminal' || q?.header !== FABLE_HEADER) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const w = Math.max(20, bandColumns)
    const title = `── ${FABLE_HEADER} `

    return (
      <Box flexDirection="column">
        <Text color="claude">{title + '─'.repeat(Math.max(0, w - title.length))}</Text>
        {await next(e)}
      </Box>
    )
  })

  on('command.run', { command: 'router' }, async ($, e) => {
    const [word = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (word === 'off' || word === 'on') {
      await update($, isOff, () => word === 'off')

      return { text: `subagent-router ${word}.` }
    }
    if (word === 'mode') {
      const um = USAGE.find(x => x.id === arg)
      if (um) {
        await update($, usage, () => um.id)
        await publish($)

        return { text: `subagent-router usage: ${um.name}.` }
      }
      const m = MODES.find(x => x.id === arg)
      if (!m) return { text: 'Usage: /router mode save|strong|cap or spawn|prompt|session' }
      await update($, mode, () => m.id)

      return { text: `subagent-router reviews: ${m.label}.` }
    }
    if (word === 'demo') {
      const at = await $.clock.now()
      await update($, pick, () => '' as RouterPick)
      await update($, now, () => at)
      await update($, demo, () => at)
      await publish($)

      return {
        text: 'subagent-router demo: five sample agents, no model call. It stops at the Fable question for your answer.',
      }
    }
    if (word === 'reset') {
      await update($, demo, () => -1)
      await update($, pick, () => '' as RouterPick)
      await update($, ledger, () => [])
      await update($, live, () => [])
      await publish($)
      perPrompt.clear()
      perSession.clear()
      $.ui.status(undefined)

      return { text: 'subagent-router tally cleared.' }
    }
    const l = await read($, ledger)
    const t = totals(l, routerCost(l, await read($, live)))

    return { text: report(t, await read($, isOff), await read($, mode)) }
  })
}
