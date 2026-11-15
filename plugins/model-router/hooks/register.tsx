import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { RouterEntry, RouterOverhead } from '../types'
import {
  ASSUMED,
  capTier,
  classifyPrompt,
  effective,
  fableWarning,
  fallbackVerdict,
  parseVerdict,
  report,
  cost,
  tierOf,
  totals,
  usd,
} from './router'
import { glyph, mascotSvg, SPIN, TIER_KEY, TIER_NAME } from './look'
import type { Ceiling, Tier } from './router'

// Change a tag when the value's fields change: it declines what an earlier
// version stored, which outlives a hot reload.
const ledger = atom({ plugin: 'model-router', key: 'ledger' } as const, [], {
  shape: 'ledger-1',
})
const overhead = atom(
  { plugin: 'model-router', key: 'overhead' } as const,
  { calls: 0, inTok: 0, outTok: 0, failed: 0 },
  { shape: 'overhead-1' },
)
const isOff = atom({ plugin: 'model-router', key: 'isOff' } as const, false, {
  shape: 'off-1',
})

const isOpen = atom({ plugin: 'model-router', key: 'isOpen' } as const, true, {
  shape: 'open-1',
})
const reviewing = atom({ plugin: 'model-router', key: 'reviewing' } as const, '', {
  shape: 'reviewing-1',
})
const waiting = atom({ plugin: 'model-router', key: 'waiting' } as const, '', {
  shape: 'waiting-1',
})
const now = atom({ plugin: 'model-router', key: 'now' } as const, 0, { shape: 'now-1' })

const clipText = (text: string, n: number): string =>
  text.length <= n ? text : `${text.slice(0, Math.max(1, n - 1))}…`

const MAX_LEDGER = 500
const ROWS = 5
const PROCEED = 'Proceed on Fable'
const DOWNGRADE = 'Use Opus instead'
const CANCEL = 'Cancel agent'

type Opts = { ceiling?: string; respectExplicit?: boolean; showNotice?: boolean; allowFable?: boolean }

export const register: Register = (on, options) => {
  const o = options as Opts
  const ceiling = (o.ceiling ?? 'opus') as Ceiling
  const respectExplicit = o.respectExplicit === true
  const showNotice = o.showNotice !== false
  const allowFable = o.allowFable === true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'router',
      description:
        'Model router: "status" shows the estimated savings, "off" / "on" pauses it, "reset" clears the tally',
    })

    // The spinner only moves while the router is deciding.
    $.clock.every(500, async () => {
      try {
        if ((await read($, reviewing)) !== '' || (await read($, waiting)) !== '') {
          const at = await $.clock.now()
          await update($, now, () => at)
        }
      } catch {
        // A missed tick only freezes the spinner for a moment.
      }
    })

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    // A fork inherits the parent's model; a resume continues its own run.
    if (e.fork || e.resume || (await read($, isOff))) return next(e)
    const explicit = e.model ? tierOf(e.model) : undefined
    if (respectExplicit && e.model && explicit !== 'fable') return next(e)

    const label = e.description || e.subagentType
    const parent = tierOf(e.parentModel)
    const task = { type: e.subagentType, description: e.description, prompt: e.prompt }

    let chosen: Tier
    let why: string
    let isHaiku = false
    if (explicit === 'fable') {
      // A call that names Fable is deliberate: it is asked about, not overridden.
      chosen = 'fable'
      why = 'named by the Agent call'
    } else {
      await update($, reviewing, () => label)
      const at = await $.clock.now()
      await update($, now, () => at)
      let verdict = fallbackVerdict(task)
      let spent: { inTok: number; outTok: number } | undefined
      try {
        const r = await $.model.complete({
          model: 'haiku',
          prompt: classifyPrompt(task, allowFable),
          maxTokens: 80,
          effort: 'low',
          timeoutMs: 8000,
        })
        if (r.isAnswered) {
          spent = { inTok: r.usage.input_tokens, outTok: r.usage.output_tokens }
          const v = parseVerdict(r.text)
          if (v) {
            verdict = v
            isHaiku = true
          }
        }
      } catch {
        // Haiku unreachable: the keyword fallback stands.
      }
      await update($, reviewing, () => '')
      await update($, overhead, (x: RouterOverhead) => ({
        calls: x.calls + 1,
        inTok: x.inTok + (spent?.inTok ?? 0),
        outTok: x.outTok + (spent?.outTok ?? 0),
        failed: x.failed + (isHaiku ? 0 : 1),
      }))
      chosen = capTier(verdict.tier, parent, ceiling)
      if (chosen === 'fable' && !allowFable) chosen = 'opus'
      why = verdict.why
    }

    if (chosen === 'fable') {
      let answer = DOWNGRADE
      await update($, waiting, () => label)
      try {
        answer = await $.ui.ask(fableWarning(task), {
          options: [PROCEED, DOWNGRADE, CANCEL],
          header: 'Fable',
        })
      } catch {
        // Nobody to ask (a -p run, a dismissed dialog): the cheaper model.
      }
      await update($, waiting, () => '')
      if (answer === CANCEL) {
        return { deny: 'model-router: agent cancelled, it would have run on Fable.' }
      }
      if (answer !== PROCEED) {
        chosen = 'opus'
        why = 'Fable declined'
      } else {
        why = `${why}; Fable confirmed`
      }
    }

    const entryId = `spawn:${e.tool_use_id}`
    await update($, ledger, (l: RouterEntry[]) =>
      [
        ...l,
        {
          id: entryId,
          type: e.subagentType,
          chosen,
          baseline: parent,
          why,
          isHaiku,
          inTok: ASSUMED.inTok,
          outTok: ASSUMED.outTok,
          isMeasured: false,
        },
      ].slice(-MAX_LEDGER),
    )
    if (showNotice) {
      try {
        $.ui.notice(e.tool_use_id, `model-router: ${chosen}${why ? ` (${why})` : ''}`)
      } catch {
        // A note is a courtesy.
      }
    }

    const started = await next({ ...e, model: chosen })

    // Join the entry to the id the subagent's own turn.complete will carry.
    if (!started.deny && started.agentId) {
      const id = started.agentId
      await update($, ledger, (l: RouterEntry[]) =>
        l.map(x => (x.id === entryId ? { ...x, id } : x)),
      )
    }
    const t = totals(await read($, ledger), await read($, overhead))
    $.ui.status(`router: ~${usd(t.saved)} saved`)

    return started
  }).catch(($, e, next) => next(e))

  // A finished subagent replaces the assumed tokens with its real usage.
  on('turn.complete', async ($, e, next) => {
    try {
      const used = e.agentId ? effective((e as { usage?: object }).usage) : undefined
      if (e.agentId && used) {
        const id = e.agentId
        await update($, ledger, (l: RouterEntry[]) =>
          l.map(x => (x.id === id ? { ...x, ...used, isMeasured: true } : x)),
        )
        const t = totals(await read($, ledger), await read($, overhead))
        $.ui.status(`router: ~${usd(t.saved)} saved`)
      }
    } catch {
      // Bookkeeping never blocks a turn.
    }

    return next(e)
  })

  // -------------------------------------------------------------- band --

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const list = await read($, ledger)
    const review = await read($, reviewing)
    const wait = await read($, waiting)
    if (list.length === 0 && review === '' && wait === '') return next(e)

    const T = $.ui.resolve(e)
    const { Box, Text, Button } = T
    const o = await read($, overhead)
    const t = totals(list, o)
    const open = await read($, isOpen)
    const frame = Math.floor((await read($, now)) / 500)
    const off = await read($, isOff)
    const isBusy = review !== '' || wait !== ''
    const columns = Math.max(20, e.props.bodyColumns)
    const room = Math.max(10, columns - 70)

    let status = `${t.agents} agent${t.agents === 1 ? '' : 's'} routed by Haiku 5.5`
    let statusColor: 'claude' | 'inactive' | undefined
    if (wait !== '') {
      status = 'Waiting for your OK on Fable'
      statusColor = 'claude'
    } else if (review !== '') {
      status = `${SPIN[frame % SPIN.length]} Reviewing ${review}…`
    } else if (off) {
      status = 'Paused (/router on)'
      statusColor = 'inactive'
    }

    const mascot =
      'Svg' in T ? (
        <T.Svg
          source={mascotSvg('haiku', isBusy ? 'running' : 'done', 30)}
          alt="Model router mascot"
          width={30}
          height={24}
          isInteractive
        />
      ) : (
        <Text color={TIER_KEY.haiku} bold>
          {glyph(isBusy ? 'running' : 'done', frame)}
        </Text>
      )

    const recent = list.slice(-ROWS)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2} alignItems="center">
          {mascot}
          <Text bold>Model Router</Text>
          <Text color={statusColor} dimColor={statusColor === 'inactive'} wrap="truncate">
            {clipText(status, room)}
          </Text>
          <Box flexDirection="row">
            {recent.map(x => (
              <Text color={TIER_KEY[x.chosen]}>●</Text>
            ))}
          </Box>
          <Text color="success" bold tabular>
            {usd(Math.max(0, t.saved))} saved
          </Text>
          <Button
            key="toggle"
            plain
            label={open ? '▾' : '▸'}
            onPress={async () => {
              await update($, isOpen, v => !v)
            }}
          />
        </Box>
        {open &&
          recent.map(x => {
            const price = cost(x.chosen, x.inTok, x.outTok)
            const base = cost(x.baseline, x.inTok, x.outTok)
            const pct = base > 0 ? Math.round((1 - price / base) * 100) : 0

            return (
              <Box flexDirection="row" gap={2} paddingLeft={2}>
                <Text bold wrap="truncate">
                  {clipText(x.type, 18).padEnd(18)}
                </Text>
                <Text color={TIER_KEY[x.chosen]} bold>
                  {TIER_NAME[x.chosen].padEnd(10)}
                </Text>
                <Text dimColor wrap="truncate">
                  {clipText(x.why, room)}
                </Text>
                <Text tabular>{usd(price)}</Text>
                <Text color={pct > 0 ? 'success' : 'claude'} tabular>
                  {pct > 0 ? `−${pct}%` : 'no saving'}
                </Text>
              </Box>
            )
          })}
        {open && (
          <Box flexDirection="row" gap={2} paddingLeft={2}>
            <Text dimColor tabular>
              All on parent {usd(t.baseline)}
            </Text>
            <Text bold tabular>
              With the router {usd(t.spent + t.overhead)}
            </Text>
            <Text dimColor>incl. {usd(t.overhead)} router cost · Fable always asks first</Text>
          </Box>
        )}
      </Box>
    )
  })

  on('command.run', { command: 'router' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'off' || word === 'on') {
      await update($, isOff, () => word === 'off')

      return { text: `model-router ${word}.` }
    }
    if (word === 'reset') {
      await update($, ledger, () => [])
      await update($, overhead, () => ({ calls: 0, inTok: 0, outTok: 0, failed: 0 }))
      $.ui.status(undefined)

      return { text: 'model-router tally cleared.' }
    }
    const o2 = await read($, overhead)
    const t = totals(await read($, ledger), o2)

    return { text: report(t, o2, await read($, isOff)) }
  })
}
