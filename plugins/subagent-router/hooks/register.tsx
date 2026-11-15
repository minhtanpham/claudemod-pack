import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { LiveRow, RouterEntry, RouterMode, RouterPick, Tier } from '../types'
import {
  CANCEL,
  DEMO_AGENTS,
  DEMO_ASK_STEP,
  DEMO_END_STEP,
  FABLE_HEADER,
  FABLE_OPTIONS,
  TIER_NAME,
  USE_FABLE,
  USE_OPUS,
  capTier,
  classifyPrompt,
  demoView,
  effective,
  estimateTokens,
  fableQuestion,
  floorTier,
  money,
  parseVerdict,
  report,
  roleOf,
  routerCost,
  rowCost,
  rowPct,
  split,
  statusLine,
  tierOf,
  totals,
} from './router'
import type { Ceiling, Verdict } from './router'
import {
  CHIP_HEIGHT,
  PILL_HEIGHT,
  READING_WIDTH,
  SPIN,
  TIER_KEY,
  barCells,
  barSvg,
  chipSvg,
  chipWidth,
  glyph,
  mascotHeight,
  mascotSvg,
  pillWidth,
  pipGlyph,
  pipsSvg,
  pipsWidth,
  readingSvg,
  savedPillSvg,
  shimmerSvg,
} from './look'
import type { MascotLook, Pip } from './look'

// Change a tag when the value's fields change: it declines what an earlier
// version stored, which outlives a hot reload.
const ledger = atom({ plugin: 'subagent-router', key: 'ledger' } as const, [], { shape: 'ledger-2' })
const live = atom({ plugin: 'subagent-router', key: 'live' } as const, [], { shape: 'live-1' })
const isOff = atom({ plugin: 'subagent-router', key: 'isOff' } as const, false, { shape: 'off-1' })
const isOpen = atom({ plugin: 'subagent-router', key: 'isOpen' } as const, true, { shape: 'open-1' })
const mode = atom({ plugin: 'subagent-router', key: 'mode' } as const, 'spawn', { shape: 'mode-1' })
const pick = atom({ plugin: 'subagent-router', key: 'pick' } as const, '', { shape: 'pick-1' })
const demo = atom({ plugin: 'subagent-router', key: 'demo' } as const, -1, { shape: 'demo-1' })
const now = atom({ plugin: 'subagent-router', key: 'now' } as const, 0, { shape: 'now-1' })

// The terminal band's last width, so the Fable dialog's rules match it.
let bandColumns = 80

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

/** The status line: the running total, or the wait for an OK on Fable. */
async function showStatus($: Api): Promise<void> {
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
        if (began >= 0 || (await read($, live)).length > 0) await update($, now, () => at)
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
    const setRow = (patch: Partial<LiveRow>) =>
      update($, live, (l: LiveRow[]) => l.map(x => (x.id === id ? { ...x, ...patch } : x)))
    const dropRow = () => update($, live, (l: LiveRow[]) => l.filter(x => x.id !== id))
    const record = (x: Omit<RouterEntry, 'id' | 'type' | 'baseline' | 'isMeasured'>) =>
      update($, ledger, (l: RouterEntry[]) =>
        [...l, { id, type, baseline: parent, isMeasured: false, ...x }].slice(-MAX_LEDGER),
      )

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

      let chosen = floorTier(capTier(verdict.tier, parent, ceiling), verdict.edits)
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
    if (entries.length === 0 && pending.length === 0) return next(e)

    const T = $.ui.resolve(e)
    const { Box, Text, Button } = T
    // The terminal's table answers `in` for Svg too, so the surface decides.
    const isRich = e.surface !== 'terminal' && 'Svg' in T
    const t = totals(entries, overhead)
    const open = await read($, isOpen)
    const off = await read($, isOff)
    const current = await read($, mode)
    const frame = Math.floor(at / STEP_MS)
    const columns = Math.max(30, e.props.bodyColumns)

    const rows: Row[] = [
      ...entries.map(x => ({ kind: 'entry' as const, x })),
      ...pending.map(x => ({ kind: 'live' as const, x })),
    ].slice(-ROWS)

    const waiting = pending.find(x => x.status === 'pending')
    const reviewing = pending.find(x => x.status === 'reviewing')
    const isFinished = pending.length === 0
    let status = 'Starting the router'
    if (waiting) status = 'Waiting for your OK on Fable'
    else if (reviewing) status = `Reviewing ${reviewing.type}…`
    else if (isFinished) {
      const n = t.agents + t.cancelled
      status = `${n} agent${n === 1 ? '' : 's'} routed by Haiku 5.5`
    }
    if (off && began < 0) status = 'Paused (/router on)'

    const pips: Pip[] = rows.map(r =>
      r.kind === 'entry'
        ? r.x.isCancelled
          ? { fill: 'none', border: 'dim' }
          : { fill: r.x.chosen, border: r.x.chosen }
        : r.x.status === 'pending'
          ? { fill: 'clay', border: 'clay' }
          : { fill: 'none', border: 'ring' },
    )
    const savedText = `~${money(Math.max(0, t.saved))} saved${waiting ? ' so far' : ''}`
    const headLook: MascotLook = isFinished ? 'done' : 'running'

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
      const right = `~${money(t.saved)} saved${waiting ? ' so far' : ''}`

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
              await update($, isOpen, v => !v)
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
          <Box key={`row-${x.id}`} flexDirection="row" paddingLeft={1} width={columns}>
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
        <Box flexDirection="row" paddingLeft={1}>
          <Text dimColor wrap="truncate">
            {`${baseName}-only ${money(t.baseline)} → router ${money(t.total)}   `}
          </Text>
          <Text color="success" bold>
            saved ~{money(t.saved)} ({t.pct}%)
          </Text>
        </Box>
      )
      const modeAt = MODES.findIndex(m => m.id === current)
      const foot = (
        <Box flexDirection="row" paddingLeft={1}>
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

    // Room left for the status text once the fixed parts are drawn.
    const statusRoom = Math.max(8, columns - 12 - 14 - (rows.length * 2 + 1) - savedText.length - 8)

    const header = (
      <Box flexDirection="row" gap={1} alignItems="center" paddingLeft={1}>
        {isRich ? (
          <T.Svg
            source={mascotSvg('main', headLook, 'haiku', 30)}
            alt={`Router mascot, ${headLook === 'done' ? 'done' : 'working'}`}
            width={30}
            height={mascotHeight(30)}
            isInteractive
          />
        ) : (
          <Text color={TIER_KEY.haiku} bold>
            {glyph(headLook, frame)}
          </Text>
        )}
        <Text bold weight="bold">
          Subagent Router
        </Text>
        <Box flexGrow={1}>
          <Text
            color={waiting ? 'claude' : undefined}
            dimColor={!waiting}
            size="footnote"
            wrap="truncate"
          >
            {!isRich && reviewing && !waiting ? `${SPIN[frame % SPIN.length]} ` : ''}
            {clip(status, statusRoom)}
          </Text>
        </Box>
        {isRich ? (
          <T.Svg
            source={pipsSvg(pips)}
            alt={`${t.agents} of ${rows.length} agents routed`}
            width={pipsWidth(pips.length)}
            height={9}
          />
        ) : (
          <Box flexDirection="row">
            {pips.map(p => (
              <Text
                color={p.fill === 'none' ? 'inactive' : p.fill === 'clay' ? 'claude' : TIER_KEY[p.fill]}
                dimColor={p.fill === 'none'}
              >
                {pipGlyph(p)}
              </Text>
            ))}
          </Box>
        )}
        {isRich ? (
          <T.Svg source={savedPillSvg(savedText)} alt={savedText} width={pillWidth(savedText)} height={PILL_HEIGHT} />
        ) : (
          <Text color="success" bold tabular>
            {savedText}
          </Text>
        )}
        <Button
          key="toggle"
          plain
          label={open ? 'Hide ▴' : 'Show ▾'}
          onPress={async () => {
            await update($, isOpen, v => !v)
          }}
        />
      </Box>
    )

    if (!open) return header

    // --------------------------------------------------------- rows --

    // Columns: mascot | name | reason | chip | price. The reason gives way
    // first, so the chip and the price stay in view on a narrow band.
    const W = isRich
      ? { mascot: 4, name: 18, chip: 18, price: 14 }
      : { mascot: 3, name: 18, chip: 12, price: 14 }
    const fixed = W.mascot + W.name + W.chip + W.price + 4 + 2
    const reasonRoom = columns - fixed
    const showReason = reasonRoom >= 16

    const rowView = (r: Row) => {
      const isEntry = r.kind === 'entry'
      const s = isEntry ? undefined : r.x.status
      const x = r.x
      const cancelled = isEntry && r.x.isCancelled
      const look: MascotLook = cancelled
        ? 'failed'
        : s === 'queued'
          ? 'queued'
          : s === 'reviewing' || s === 'pending'
            ? 'running'
            : 'done'
      const tier: Tier | undefined = isEntry
        ? r.x.chosen
        : s === 'pending'
          ? r.x.tier
          : undefined
      const color: Tier | 'dim' = isEntry && !cancelled ? r.x.chosen : s === 'pending' ? 'fable' : 'dim'
      const isQueued = s === 'queued'

      const sprite = isRich ? (
        <T.Svg
          source={mascotSvg(x.role, look, color, 24)}
          alt={`${x.type} mascot, ${look}`}
          width={24}
          height={mascotHeight(24)}
          isInteractive
        />
      ) : (
        <Text
          color={color === 'dim' ? 'inactive' : TIER_KEY[color]}
          dimColor={color === 'dim'}
          bold
        >
          {glyph(look, frame)}
        </Text>
      )

      let reason = <Text> </Text>
      if (s === 'reviewing') {
        reason = isRich ? (
          <T.Svg source={readingSvg()} alt="Haiku is reading the scope" width={READING_WIDTH} height={16} isInteractive />
        ) : (
          <Text color={TIER_KEY.haiku} mono wrap="truncate">
            {clip(`Haiku is reading the scope${'...'.slice(0, (frame % 3) + 1)}`, reasonRoom)}
          </Text>
        )
      } else if (isQueued) {
        reason = (
          <Text dimColor mono size="footnote" wrap="truncate">
            {clip('Waiting for the router', reasonRoom)}
          </Text>
        )
      } else if (!cancelled) {
        reason = (
          <Text dimColor mono size="footnote" wrap="truncate">
            {clip(`${x.scope} · ${x.why}`, reasonRoom)}
          </Text>
        )
      }

      let chip = <Text> </Text>
      if (s === 'reviewing') {
        chip = isRich ? (
          <T.Svg source={shimmerSvg()} alt="Haiku is choosing" width={100} height={CHIP_HEIGHT} isInteractive />
        ) : (
          <Text color={TIER_KEY.haiku}>{SPIN[frame % SPIN.length]}</Text>
        )
      } else if (tier && !cancelled) {
        chip = isRich ? (
          <T.Svg
            source={chipSvg(tier, TIER_NAME[tier])}
            alt={TIER_NAME[tier]}
            width={chipWidth(TIER_NAME[tier])}
            height={CHIP_HEIGHT}
          />
        ) : (
          <Text color={TIER_KEY[tier]} bold>
            ● {TIER_NAME[tier]}
          </Text>
        )
      }

      let price = (
        <Text dimColor tabular>
          –
        </Text>
      )
      if (isEntry && !r.x.isCancelled) {
        const pct = rowPct(r.x)
        const same = r.x.chosen === r.x.baseline || pct <= 0
        price = (
          <Box flexDirection="row" gap={1}>
            <Text bold weight="bold" tabular size="footnote">
              {money(rowCost(r.x))}
            </Text>
            <Text color={same ? 'claude' : 'success'} weight="semibold" tabular size="footnote">
              {same ? 'no saving' : `−${pct}%`}
            </Text>
          </Box>
        )
      } else if (s === 'pending') {
        price = (
          <Text color="claude" bold weight="bold" size="footnote">
            Needs OK
          </Text>
        )
      }

      return (
        <Box
          key={`row-${x.id}`}
          flexDirection="row"
          gap={1}
          alignItems="center"
          paddingX={1}
          {...(s === 'pending' && isRich ? { borderStyle: 'round', borderColor: 'claude' } : {})}
        >
          <Box width={W.mascot}>{sprite}</Box>
          <Box width={W.name}>
            <Text bold weight="bold" dimColor={isQueued} strikethrough={cancelled} wrap="truncate">
              {clip(x.type, W.name)}
            </Text>
          </Box>
          {showReason ? <Box flexGrow={1}>{reason}</Box> : <Box flexGrow={1} />}
          <Box width={W.chip}>{chip}</Box>
          <Box width={W.price} justifyContent="flex-end">
            {price}
          </Box>
        </Box>
      )
    }

    // ---------------------------------------------------- saving strip --

    const baseTier = entries[entries.length - 1]?.baseline ?? 'fable'
    const basePart = t.baseline > 0 ? [{ color: 'dim' as const, frac: 1 }] : []
    const routedParts = t.segments.map(s => ({
      color: s.tier,
      frac: t.baseline > 0 ? s.usd / t.baseline : 0,
    }))
    // The strip's bar: what is left of the band once the amount, labels and values are placed.
    const barPx = Math.max(80, Math.min(4096, Math.round(columns * 7.5) - 150 - 104 - 56 - 60))
    const barCols = Math.max(8, Math.min(40, columns - 19 - 16 - 8 - 6))

    const bar = (label: string, strong: boolean, parts: typeof routedParts | typeof basePart, value: number) => (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Box width={16}>
          <Text size="caption" bold={strong} weight={strong ? 'bold' : 'regular'} dimColor={!strong}>
            {label}
          </Text>
        </Box>
        {isRich ? (
          <T.Svg source={barSvg(barPx, parts)} alt={`${label}: ${money(value)}`} width={barPx} height={8} />
        ) : (
          <Box flexDirection="row">
            {barCells(barCols, parts).map(c => (
              <Text
                color={c.color === 'track' || c.color === 'dim' ? 'inactive' : TIER_KEY[c.color]}
                dimColor={c.color === 'track'}
              >
                {c.text}
              </Text>
            ))}
          </Box>
        )}
        <Box width={7} justifyContent="flex-end">
          <Text tabular size="footnote" bold={strong} weight={strong ? 'bold' : 'semibold'}>
            {money(value)}
          </Text>
        </Box>
      </Box>
    )

    const strip = (
      <Box flexDirection="row" gap={2} alignItems="center" paddingX={1} paddingTop={1}>
        <Box flexDirection="column" width={19}>
          <Text color="success" bold weight="bold" size="caption">
            ESTIMATED SAVING
          </Text>
          <Box flexDirection="row" gap={1} alignItems="flex-end">
            <Text color="success" bold weight="bold" size="title" tabular>
              {money(Math.max(0, t.saved))}
            </Text>
            <Text color="success" weight="semibold" size="footnote" tabular>
              {t.pct}%
            </Text>
          </Box>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {bar(`All on ${TIER_NAME[baseTier]}`, false, basePart, t.baseline)}
          {bar('With the router', true, routedParts, t.total)}
        </Box>
      </Box>
    )

    // ---------------------------------------------------------- footer --

    const footer = (
      <Box flexDirection="row" justifyContent="flex-end" paddingX={1}>
        <Box flexDirection="row" gap={2}>
          {MODES.map(m => (
            <Button
              key={`mode-${m.id}`}
              plain
              dimColor={m.id !== current ? true : undefined}
              label={m.id === current && !isRich ? `[${m.label}]` : m.label}
              onPress={async () => {
                await update($, mode, () => m.id)
              }}
            />
          ))}
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column">
        {header}
        <Box flexDirection="column" gap={isRich ? 1 : 0}>{rows.map(rowView)}</Box>
        {strip}
        {footer}
      </Box>
    )
  })

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
      const m = MODES.find(x => x.id === arg)
      if (!m) return { text: 'Usage: /router mode spawn|prompt|session' }
      await update($, mode, () => m.id)

      return { text: `subagent-router reviews: ${m.label}.` }
    }
    if (word === 'demo') {
      const at = await $.clock.now()
      await update($, pick, () => '' as RouterPick)
      await update($, now, () => at)
      await update($, demo, () => at)

      return {
        text: 'subagent-router demo: five sample agents, no model call. It stops at the Fable question for your answer.',
      }
    }
    if (word === 'reset') {
      await update($, demo, () => -1)
      await update($, pick, () => '' as RouterPick)
      await update($, ledger, () => [])
      await update($, live, () => [])
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
