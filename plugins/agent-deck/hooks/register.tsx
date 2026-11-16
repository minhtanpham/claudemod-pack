import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { AgentDeckRole, AgentDeckAgentStatus, RouterSummary } from '../types'

import {
  addAgent,
  addTokens,
  bandOf,
  buildCards,
  clip,
  clock,
  countRunning,
  DEMO_SECONDS,
  demoAgents,
  demoMain,
  demoSteps,
  demoTime,
  endedStatus,
  firstLine,
  isDemoId,
  kfmt,
  money,
  progressOf,
  reduceSteps,
  MODEL_COLOR,
  DEMO_MAIN_MODEL,
  elapsed,
  modelKey,
  modelLabel,
  tally as tallyOf,
  roleOf,
  settleAgent,
  statusWord,
  stepTool,
  toolLabel,
  touchAgent,
  usageTokens,
} from './model'
import { terminalBand, terminalPane } from './terminal'
import {
  bandGlyph,
  barSegments,
  barSvg,
  planIconSvg,
  mascotSvg,
} from './mascot'

const PANE = 'agent-deck'

// Model Router's published summary (read only, empty while that mod is absent
// or has routed nothing) and the colors it draws each model in, so both mods
// show a model the same way.
const router = atom({ plugin: 'subagent-router', key: 'summary' } as const, null as RouterSummary | null)
const routerOpen = atom({ plugin: 'agent-deck', key: 'routerOpen' } as const, false, { shape: 'routerOpen-1' })
const TIER_THEME = { haiku: 'ide', sonnet: 'merged', opus: 'planMode', fable: 'claude' } as const
const TIER_LABEL = { haiku: 'Haiku 5.5', sonnet: 'Sonnet 5.5', opus: 'Opus 5.5', fable: 'Fable 5.2' } as const
const MODE_LABEL = { save: 'Save', strong: 'Strong', cap: 'Cap' } as const
const TITLE = 'Agent Deck'
// The dock's width request: a narrow side column. A width the person dragged wins.
const DOCK_COLUMNS = 40

// Change a tag when the value's fields change: it declines what an earlier
// version stored, which outlives a hot reload.
const steps = atom({ plugin: 'agent-deck', key: 'steps' } as const, [], {
  shape: 'steps-2',
})
const agents = atom({ plugin: 'agent-deck', key: 'agents' } as const, [], {
  shape: 'agents-2',
})
const main = atom(
  { plugin: 'agent-deck', key: 'main' } as const,
  { tools: 0, tokens: 0 },
  { shape: 'main-1' },
)
const now = atom({ plugin: 'agent-deck', key: 'now' } as const, 0, {
  shape: 'now-1',
})
// When the demo that is playing started; -1 while none plays.
const demo = atom({ plugin: 'agent-deck', key: 'demo' } as const, -1, {
  shape: 'demo-1',
})
const demoFail = atom({ plugin: 'agent-deck', key: 'demoFail' } as const, false, {
  shape: 'demo-fail-1',
})
// Whether the main agent is in a turn now; false between turns.
const busy = atom({ plugin: 'agent-deck', key: 'busy' } as const, false, {
  shape: 'busy-1',
})
// When work began, for the band's clock; -1 while none has.
const started = atom({ plugin: 'agent-deck', key: 'started' } as const, -1, {
  shape: 'started-1',
})

type Dollar = Parameters<Hook<'session.start'>>[0]

/** Draws the demo's frame for time `at`, beside any real card. */
const paintDemo = async ($: Dollar, t0: number, at: number) => {
  const t = demoTime(t0, at)
  const isFail = await read($, demoFail)
  await update($, now, () => at)
  await update($, steps, () => demoSteps(t))
  await update($, main, () => demoMain(t))
  await update($, busy, () => t < DEMO_SECONDS)
  await update($, agents, list => [
    ...list.filter(one => !isDemoId(one.id)),
    ...demoAgents(t, t0, isFail),
  ])
  if (t >= DEMO_SECONDS) await update($, demo, () => -1)
}

/** Starts the sample run: no model call, no real subagent. */
const startDemo = async ($: Dollar, isFail: boolean) => {
  const at = await $.clock.now()
  await update($, demoFail, () => isFail)
  await update($, demo, () => at)
  await update($, started, () => at)
  await paintDemo($, at, at)

  return $.ui.open({ id: PANE, title: TITLE, columns: DOCK_COLUMNS })
}

const clearAll = async ($: Dollar) => {
  await update($, demo, () => -1)
  await update($, steps, () => [])
  await update($, agents, () => [])
  await update($, main, () => ({ tools: 0, tokens: 0 }))
  await update($, started, () => -1)
  await update($, busy, () => false)
}

/** Marks the moment work began, once. */
const begin = async ($: Dollar, at: number) => {
  if ((await read($, started)) < 0) await update($, started, () => at)
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// Theme keys, not hex: the terminal and the desktop app resolve them against
// the person's own light or dark theme, so the colors stay legible in both.
const STATUS_COLOR: Record<AgentDeckAgentStatus, 'claude' | 'inactive' | 'success' | 'error'> = {
  running: 'claude',
  queued: 'inactive',
  done: 'success',
  failed: 'error',
  stopped: 'inactive',
}

const STATUS_BG: Partial<Record<AgentDeckAgentStatus, 'diffAddedDimmed' | 'diffRemovedDimmed'>> = {
  done: 'diffAddedDimmed',
  failed: 'diffRemovedDimmed',
}

const BAR_CHARS = { done: '━━━', run: '╍╍╍', wait: '───' } as const

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'deck',
      description:
        'Open the Agent Deck pane. "demo" plays a sample run ("demo fail" with a failing agent), "clear" empties it',
    })

    // One clock for every elapsed time, moving only while something runs. It
    // also settles a card whose agent ended with no turn to say so.
    $.clock.every(500, () => {
      void (async () => {
        try {
          const t0 = await read($, demo)
          const cards = await read($, agents)
          const isLive = t0 >= 0 || countRunning(cards) > 0 || (await read($, busy))
          if (!isLive) return
          const at = await $.clock.now()
          if (t0 >= 0) await paintDemo($, t0, at)
          else await update($, now, () => at)
          const listed = await $.agent.list()
          for (const info of listed) {
            const ended = endedStatus(info.status)
            if (!ended) continue
            const card = cards.find(one => one.id === info.id)
            if (card?.status !== 'running') continue
            await update($, agents, l => settleAgent(l, info.id, ended, at))
          }
        } catch {
          // A missed tick only leaves a clock a moment behind.
        }
      })()
    })

    // For looking at the mod with nothing typed: the option plays the demo
    // as the session starts, and again after each hot reload.
    if (options.demoOnStart === true) {
      void startDemo($, false).catch(() => undefined)
    }

    return next(e)
  })

  // Answered here, so it runs no model call: `/deck`, `/deck demo`,
  // `/deck demo fail` and `/deck clear`.
  on('command.run', { command: 'deck' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/)
    const word = words[0] ?? ''
    if (word === 'clear') {
      await clearAll($)

      return { text: 'Agent Deck cleared: no plan, no cards.' }
    }

    const isDemo = word === 'demo'
    const { isPlaced } = isDemo
      ? await startDemo($, words[1] === 'fail')
      : await $.ui.open({ id: PANE, title: TITLE, columns: DOCK_COLUMNS })
    const where = isPlaced
      ? 'The pane is open.'
      : 'This surface is not showing panes now; the band still draws.'

    return {
      text: isDemo
        ? `Agent Deck demo started: a sample plan and four sample agents, about ${DEMO_SECONDS} seconds, no model call. ${where}`
        : `Agent Deck: ${where}`,
    }
  })

  // ---------------------------------------------------------- tracking --

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>

    try {
      const at = await $.clock.now()
      await begin($, at)
      if (!e.agentId) await update($, busy, () => true)
    } catch {
      // Tracking never stands in a tool call's way.
    }

    // A subagent's call moves its card; its to-do list is its own business.
    if (e.agentId) {
      const id = e.agentId
      try {
        const at = await $.clock.now()
        const label = toolLabel(e.tool, input)
        await update($, agents, list => touchAgent(list, id, label, at))
      } catch {
        // As above.
      }

      return next(e)
    }

    const kind = stepTool(e.tool)
    const ran = await next(e)
    try {
      await update($, main, m => ({ ...m, tools: m.tools + 1 }))
      if (kind) {
        const result = (ran as { result?: unknown }).result
        await update($, steps, list => reduceSteps(list, kind, input, result))
      }
    } catch {
      // As above.
    }

    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    try {
      const id = spawned.deny === undefined ? spawned.agentId : undefined
      if (id) {
        const at = await $.clock.now()
        const before = await read($, agents)
        const known = before.find(one => one.id === id)
        const type = e.subagentType || 'agent'
        await begin($, at)
        await update($, now, () => at)
        await update($, agents, list =>
          addAgent(list, {
            id,
            type,
            role: roleOf(type),
            ...(spawned.model ? { model: spawned.model } : {}),
            description: clip(e.description ?? '', 120),
            status: 'running',
            startedAt: known?.startedAt ?? at,
            tools: known?.tools ?? 0,
            tokens: known?.tokens ?? 0,
            ...(known?.lastTool ? { lastTool: known.lastTool } : {}),
          }),
        )
        // The first agent of a burst brings the pane up; the rest join it.
        if (countRunning(before) === 0) {
          void $.ui.open({ id: PANE, title: TITLE, columns: DOCK_COLUMNS }).catch(() => undefined)
        }
      }
    } catch {
      // As above.
    }

    return spawned
  })

  on('turn.start', async ($, e, next) => {
    try {
      const at = await $.clock.now()
      await begin($, at)
      if (e.agentId) {
        const id = e.agentId
        await update($, agents, list => settleAgent(list, id, 'running', at))
      } else {
        await update($, busy, () => true)
      }
      if (e.agentId) {
        // nothing more for a subagent
      } else if (progressOf(await read($, steps)).isFinished) {
        // A finished plan stays for the turn that finished it, then goes.
        await update($, steps, () => [])
      }
    } catch {
      // As above.
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      const tokens = usageTokens((e as { usage?: unknown }).usage)
      if (e.agentId) {
        const id = e.agentId
        const at = await $.clock.now()
        const status =
          e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
        const summary = firstLine(e.answer ?? '', 160)
        await update($, now, () => at)
        await update($, agents, list =>
          settleAgent(addTokens(list, id, tokens), id, status, at, summary),
        )
      } else {
        await update($, busy, () => false)
        if (tokens > 0) {
          await update($, main, m => ({ ...m, tokens: m.tokens + tokens }))
        }
      }
    } catch {
      // As above.
    }

    return next(e)
  })

  // A new prompt starts a new task: what the last one left (an unfinished
  // plan, its totals and clock) would only mislead, so it goes. Running
  // subagents and a playing demo stay.
  on('prompt.submit', async ($, e, next) => {
    try {
      const isCommand = e.text.trim().startsWith('/')
      const cards = await read($, agents)
      if (!isCommand && (await read($, demo)) < 0 && countRunning(cards) === 0) {
        await update($, steps, () => [])
        await update($, agents, () => [])
        await update($, main, () => ({ tools: 0, tokens: 0 }))
        await update($, started, () => -1)
      }
    } catch {
      // As above.
    }

    return next(e)
  })

  // -------------------------------------------------------------- band --

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const list = await read($, steps)
    const cards = await read($, agents)
    const m = await read($, main)
    const at = await read($, now)
    const since = await read($, started)
    const isBusy = await read($, busy)
    const rt = await read($, router)
    if (list.length === 0 && cards.length === 0) return next(e)

    const T = $.ui.resolve(e)
    const { Box, Text, Button } = T
    const band = bandOf(list, cards, m, at, since, isBusy)
    // The terminal's table answers `in` for Svg too, so the surface decides.
    if (e.surface === 'terminal') {
      return terminalBand(T, band, list, Math.max(10, e.props.bodyColumns))
    }
    const mainModel = await mainModelOf($, cards)
    const frame = Math.floor(at / 500)
    const status: AgentDeckAgentStatus = band.isFinished ? 'done' : 'running'
    const segments = barSegments(list)
    const columns = Math.max(20, e.props.bodyColumns)
    const isNarrow = columns < 70
    // Tight: the row keeps its stats on one line by dropping tokens and the mode.
    const isTight = columns < 100
    const room = isTight ? 0 : Math.max(8, Math.min(24, columns - 60))
    const barWidth = Math.min(1600, Math.max(80, Math.round(columns * 9.2 - 640)))

    const mascot =
      'Svg' in T ? (
        <T.Svg
          source={mascotSvg('main', status, modelKey(mainModel), 30)}
          alt="Agent Deck mascot"
          width={30}
          height={25}
          isInteractive
        />
      ) : (
        <Text color="claude" bold>
          {bandGlyph(status, frame)}
        </Text>
      )

    const bar =
      'Svg' in T ? (
        <T.Svg
          source={barSvg(list, barWidth)}
          alt={`${band.done} of ${band.total} steps done`}
          width={barWidth}
          height={8}
          isInteractive
        />
      ) : (
        <Box flexDirection="row" gap={1}>
          {segments.map(s => (
            <Text
              color={s === 'wait' ? 'inactive' : 'claude'}
              dimColor={s === 'wait'}
              bold={s === 'run'}
            >
              {BAR_CHARS[s]}
            </Text>
          ))}
        </Box>
      )

    // design/combined-dock row 1: one line, mascot, n/total, current step,
    // the progress bar filling the middle, N working, tokens, cost and time.
    return (
      <Box flexDirection="row" gap={2} alignItems="center">
        {mascot}
        {list.length > 0 && (
          <Box flexDirection="row" alignItems="flex-end">
            <Text color="claude" size="title" weight="bold" tabular>
              {band.done}
            </Text>
            <Text dimColor weight="bold" tabular>
              /{band.total}
            </Text>
          </Box>
        )}
        {!isTight && (
          <Text bold wrap="truncate">
            {clip(band.label, room)}
          </Text>
        )}
        <Box flexGrow={1}>{list.length > 0 && bar}</Box>
        {band.working > 0 ? (
          <Button
            key="agents"
            plain
            label={`${band.working} working`}
            onPress={async () => {
              await $.ui.open({
                id: PANE,
                title: TITLE,
                columns: DOCK_COLUMNS,
              })
            }}
          />
        ) : (
          <Text color="claude" bold>
            Finished
          </Text>
        )}
        <Text dimColor mono tabular size="footnote" wrap="truncate">
          {isTight ? '' : `${kfmt(band.tokens)} tok · `}
          {money(band.cost)} · {clock(band.elapsedMs)}
        </Text>
        {rt && (
          <Box flexDirection="row" gap={2} alignItems="center">
            <Text dimColor>│</Text>
            <Text color={rt.waiting > 0 ? 'claude' : 'ide'}>●</Text>
            <Text color={rt.waiting > 0 || rt.isLoss ? 'claude' : 'success'} bold tabular wrap="truncate">
              {rt.waiting > 0
                ? rt.waiting === 1
                  ? 'Fable needs OK'
                  : `${rt.waiting} need OK`
                : isNarrow
                  ? `$${rt.saved.toFixed(2)}`
                  : `${rt.label}${rt.pct > 0 && !rt.isLoss ? ` · ${rt.pct}%` : ''}`}
            </Text>
            {!isTight && (
              <Text dimColor size="footnote">
                {MODE_LABEL[rt.mode]}
              </Text>
            )}
          </Box>
        )}
      </Box>
    )
  })

  // -------------------------------------------------------------- pane --

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const T = $.ui.resolve(e)
    const { Box, Text, Button } = T
    const list = await read($, steps)
    const subs = await read($, agents)
    const m = await read($, main)
    const at = await read($, now)
    const since = await read($, started)
    const isBusy = await read($, busy)
    const rt = await read($, router)
    const isRouterOpen = await read($, routerOpen)
    const progress = progressOf(list)
    const columns = Math.max(16, e.props.bodyColumns)
    const inner = columns - 4
    const frame = Math.floor(at / 500)
    const isEmpty = list.length === 0 && subs.length === 0 && since < 0
    const mainModel = await mainModelOf($, subs)
    const cards = isEmpty ? [] : buildCards(list, subs, m, at, since, isBusy, mainModel)
    const counts = tallyOf(cards)
    const tally = isEmpty ? '' : `${counts.working} working · ${counts.done} done`

    // A widget is a glance: the two counts and nothing to press.
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          <Text color={counts.working > 0 ? 'claude' : 'inactive'} bold={counts.working > 0}>
            {counts.working > 0 ? '●' : '○'} {tally || 'No subagents'}
          </Text>
          {list.length > 0 && (
            <Text dimColor>
              Plan {progress.done}/{progress.total}
            </Text>
          )}
        </Box>
      )
    }

    // The terminal's table answers `in` for Svg too, so the surface decides.
    if (e.surface === 'terminal') {
      return terminalPane(
        T,
        list,
        cards,
        tally,
        columns,
        frame,
        isEmpty ? (
          <Box flexDirection="column">
            <Text dimColor>No subagents yet. Each one Claude starts gets a card here.</Text>
            <Button
              key="demo"
              plain
              label="Play a demo"
              onPress={async () => {
                await startDemo($, false)
              }}
            />
          </Box>
        ) : undefined,
      )
    }

    // design/combined-dock: ONE merged step list. Done = a tick row with its
    // time, running = a bold title with its agents under it (mascot, name,
    // model, one status line, clay rail), queued = a dim row.
    const isRich = 'Svg' in T
    const subCards = cards.filter(one => one.role !== 'main')
    const running = subCards.filter(one => one.status === 'running')
    const ended = subCards.filter(one => one.status !== 'running')
    const textRoom = Math.max(8, columns - 12)

    const agentRow = (card: (typeof subCards)[number]) => {
      const isLive = card.status === 'running'
      const color = STATUS_COLOR[card.status]
      const model = MODEL_COLOR[card.modelKey].dark

      return (
        <Box key={`agent-${card.id}`} flexDirection="row" gap={1} alignItems="center">
          <Text color={isLive ? 'claude' : 'inactive'} dimColor={!isLive}>
            │
          </Text>
          {isRich ? (
            <T.Svg
              source={mascotSvg(card.role, card.status, card.modelKey, 30)}
              alt={`${card.role} mascot, ${card.status}`}
              width={30}
              height={25}
              isInteractive
            />
          ) : (
            <Text color={model}>●</Text>
          )}
          <Box flexDirection="column" flexGrow={1}>
            <Box flexDirection="row" gap={1} alignItems="flex-start">
              <Text bold wrap="truncate" dimColor={!isLive}>
                {clip(card.name, Math.max(10, textRoom - 14))}
              </Text>
              <Text color={model} weight="semibold" size="footnote">
                {card.model}
              </Text>
              {!isLive && (
                <Text color={color} size="footnote" weight="semibold">
                  {statusWord(card.status)}
                </Text>
              )}
              <Box flexGrow={1} />
              <Text dimColor mono tabular size="footnote">
                {card.elapsedMs === undefined ? '–' : elapsed(card.elapsedMs)}
              </Text>
            </Box>
            {card.line !== '' && (
              <Text dimColor mono size="footnote" wrap="truncate">
                {clip(card.line, textRoom)}
              </Text>
            )}
            {card.isOpenable && (
              <Button
                key={`view-${card.id}`}
                plain
                dimColor
                label="Transcript"
                onPress={async () => {
                  await $.ui.view({ agentId: card.id })
                }}
              />
            )}
          </Box>
        </Box>
      )
    }

    const icon = (status: (typeof list)[number]['status']) =>
      isRich ? (
        <T.Svg source={planIconSvg(status)} alt={status} width={16} height={16} isInteractive />
      ) : (
        <Text color={status === 'pending' ? 'inactive' : 'claude'}>
          {status === 'completed' ? '✓' : status === 'in_progress' ? SPIN[frame % SPIN.length] : '○'}
        </Text>
      )

    // The agents sit under the first step in progress; with no plan, alone.
    const host = list.findIndex(step => step.status === 'in_progress')

    return (
      <Box flexDirection="column" gap={2}>
        <Box flexDirection="row" gap={2} alignItems="center">
          <Text color={counts.working > 0 ? 'claude' : 'inactive'}>●</Text>
          <Text bold weight="bold" size="title">
            Orchestra
          </Text>
          <Box flexGrow={1} />
          {tally !== '' && (
            <Text dimColor size="footnote">
              {tally}
            </Text>
          )}
        </Box>

        {isEmpty && (
          <Text dimColor>No subagents yet. Each one Claude starts shows up here.</Text>
        )}
        {isEmpty && (
          <Button
            key="demo"
            plain
            label="Play a demo"
            onPress={async () => {
              await startDemo($, false)
            }}
          />
        )}

        <Box flexDirection="column" gap={1}>
          {list.map((step, i) => (
            <Box key={`step-${i}`} flexDirection="column">
              <Box flexDirection="row" gap={2} alignItems="center">
                {icon(step.status)}
                <Text
                  bold={step.status === 'in_progress'}
                  weight={step.status === 'in_progress' ? 'bold' : 'medium'}
                  dimColor={step.status === 'pending'}
                  wrap="truncate"
                >
                  {clip(step.text, columns - 8)}
                </Text>
              </Box>
              {i === host && running.map(agentRow)}
            </Box>
          ))}
          {host < 0 && running.map(agentRow)}
          {ended.map(agentRow)}
        </Box>

        {rt && (
          <Box flexDirection="column" gap={2}>
            <Text dimColor wrap="truncate">
              {'─'.repeat(Math.max(4, columns - 4))}
            </Text>
            <Box flexDirection="row" gap={2} alignItems="center">
              <Text color={rt.waiting > 0 ? 'claude' : 'ide'}>●</Text>
              <Text dimColor bold size="footnote">
                ROUTER
              </Text>
              <Text color={rt.waiting > 0 || rt.isLoss ? 'claude' : 'success'} bold tabular>
                {rt.waiting > 0
                ? rt.waiting === 1
                  ? 'Fable needs OK'
                  : `${rt.waiting} need OK`
                : `${rt.label}${rt.pct > 0 && !rt.isLoss ? ` · ${rt.pct}%` : ''}`}
              </Text>
              <Box flexGrow={1} />
              <Text dimColor size="footnote">
                Mode: {MODE_LABEL[rt.mode]}
              </Text>
              <Button
                key="router"
                plain
                label={isRouterOpen ? '▴' : '▾'}
                onPress={async () => {
                  await update($, routerOpen, v => !v)
                }}
              />
            </Box>
            {isRouterOpen &&
              rt.groups.map(g => (
                <Box key={`rt-${g.tier}`} paddingLeft={1} flexDirection="row" gap={2} alignItems="center">
                  <Text color={g.waits > 0 ? 'claude' : TIER_THEME[g.tier]}>●</Text>
                  <Text bold weight="semibold">
                    {TIER_LABEL[g.tier]} ×{g.n}
                  </Text>
                  <Box flexGrow={1} />
                  {g.waits > 0 ? (
                    <Text color="claude" bold size="footnote">
                      needs OK
                    </Text>
                  ) : (
                    <Box flexDirection="row" gap={2}>
                      <Text tabular size="footnote">
                        {money(g.cost)}
                      </Text>
                      <Text color={g.pct > 0 ? 'success' : 'claude'} tabular size="footnote">
                        {g.pct > 0 ? `−${g.pct}%` : g.pct < 0 ? `+${-g.pct}%` : 'no change'}
                      </Text>
                    </Box>
                  )}
                </Box>
              ))}
          </Box>
        )}
      </Box>
    )
  })
}

/** The model the main agent runs on: the demo's while it shows, else the session's. */
const mainModelOf = async ($: Dollar, cards: readonly { id: string }[]): Promise<string> => {
  if (cards.some(one => isDemoId(one.id))) return DEMO_MAIN_MODEL
  try {
    return await $.session.model()
  } catch {
    return ''
  }
}
