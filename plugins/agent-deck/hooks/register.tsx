import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { AgentDeckRole, AgentDeckAgentStatus } from '../types'

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
  plural,
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
  badgeSvg,
  barSvg,
  chipSvg,
  tileSvg,
  CELL_COLUMNS,
  planIconSvg,
  CELL_ROWS,
  mascotCells,
  mascotSvg,
} from './mascot'

const PANE = 'agent-deck'
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
          const isLive =
            t0 >= 0 || countRunning(cards) > 0 || (await read($, busy))
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
          e.reason === 'answer'
            ? 'done'
            : e.reason === 'aborted'
              ? 'stopped'
              : 'failed'
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
    const room = Math.max(8, columns - 60)
    const barWidth = Math.min(360, Math.max(120, columns * 3 - 140))

    const mascot =
      'Svg' in T ? (
        <T.Svg
          source={mascotSvg('main', status, modelKey(mainModel), 30)}
          alt="Agent Deck mascot"
          width={30}
          height={24}
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

    return (
      <Box flexDirection="row" gap={2} alignItems="center" paddingY={0}>
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
        <Text bold wrap="truncate">
          {clip(band.label, room)}
        </Text>
        {list.length > 0 && bar}
        {band.working > 0 ? (
          <Box paddingX={1}>
            <Button
              key="agents"
              plain
              label={`${band.working} working`}
              onPress={async () => {
                await $.ui.open({ id: PANE, title: TITLE, columns: DOCK_COLUMNS })
              }}
            />
          </Box>
        ) : (
          <Box paddingX={1}>
            <Text color="claude" bold>
              Finished
            </Text>
          </Box>
        )}
        <Box flexDirection="column" alignItems="flex-end">
          <Text dimColor mono tabular size="footnote">
            {kfmt(band.tokens)} tok
          </Text>
          <Text dimColor mono tabular size="footnote">
            {money(band.cost)} · {clock(band.elapsedMs)}
          </Text>
        </Box>
      </Box>
    )
  })

  // -------------------------------------------------------------- pane --

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const T = $.ui.resolve(e)
    const { Box, Text, Button, Progress } = T
    const list = await read($, steps)
    const subs = await read($, agents)
    const m = await read($, main)
    const at = await read($, now)
    const since = await read($, started)
    const isBusy = await read($, busy)
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

    const sprite = (
      role: AgentDeckRole,
      status: AgentDeckAgentStatus,
      model: ReturnType<typeof modelKey>,
      id: string,
    ) =>
      'Svg' in T ? (
        <T.Svg
          source={tileSvg(role, status, model)}
          alt={`${role} mascot, ${status}`}
          width={64}
          height={64}
          isInteractive
        />
      ) : (
        <T.Raster
          key={`sprite-${id}`}
          columns={CELL_COLUMNS}
          rows={CELL_ROWS}
          cells={mascotCells(role, status, MODEL_COLOR[model].dark, frame)}
        />
      )

    return (
      <Box flexDirection="column" gap={1}>
        {list.length > 0 && (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color="claude" bold>
                PLAN
              </Text>
              <Text bold tabular>
                {progress.done}/{progress.total}
              </Text>
            </Box>
            {list.map(step => (
              <Box flexDirection="row" gap={1} alignItems="center">
                {'Svg' in T ? (
                  <T.Svg
                    source={planIconSvg(step.status)}
                    alt={step.status}
                    width={16}
                    height={16}
                    isInteractive
                  />
                ) : (
                  <Text
                    color={step.status === 'pending' ? 'inactive' : 'claude'}
                    dimColor={step.status === 'completed'}
                  >
                    {step.status === 'completed'
                      ? '✓'
                      : step.status === 'in_progress'
                        ? SPIN[frame % SPIN.length]
                        : '○'}
                  </Text>
                )}
                <Text
                  bold={step.status === 'in_progress'}
                  weight={step.status === 'in_progress' ? 'bold' : 'medium'}
                  dimColor={step.status === 'pending'}
                  wrap="truncate"
                >
                  {clip(step.text, columns - 4)}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <Box flexDirection="row" gap={1}>
          <Text color="claude" bold>
            AGENTS
          </Text>
          {tally !== '' && <Text dimColor>{tally}</Text>}
        </Box>

        {isEmpty && (
          <Text dimColor>
            No subagents yet. Each one Claude starts gets a live card here.
          </Text>
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

        {cards.map(card => {
          const isLive = card.status === 'running'
          const isQueued = card.status === 'queued'
          const color = STATUS_COLOR[card.status]

          const isRich = 'Svg' in T
          const textWidth = Math.max(8, columns - (isRich ? 15 : 16))
          const badgeWidth = statusWord(card.status).length + 2
          const timeWidth = card.elapsedMs === undefined ? 1 : elapsed(card.elapsedMs).length
          const nameWidth = Math.max(4, textWidth - badgeWidth - timeWidth - 2)

          return (
            <Box
              flexDirection="row"
              gap={1}
              borderStyle="round"
              borderColor={isLive ? 'claude' : 'inactive'}
              borderDimColor={!isLive}
              paddingX={1}
              width="100%"
            >
              {sprite(card.role, card.status, card.modelKey, card.id)}
              <Box flexDirection="column" flexGrow={1}>
                <Box flexDirection="row" gap={1} alignItems="center" width="100%">
                  <Text bold wrap="truncate">
                    {clip(card.name, nameWidth)}
                  </Text>
                  {isRich ? (
                    <T.Svg
                      key={`badge-${card.status}`}
                      source={badgeSvg(card.status, statusWord(card.status))}
                      alt={statusWord(card.status)}
                      width={Math.ceil(16 + statusWord(card.status).length * 6.6)}
                      height={18}
                      isInteractive
                    />
                  ) : (
                    <Box backgroundColor={STATUS_BG[card.status]} paddingX={1}>
                      <Text color={color} bold>
                        {statusWord(card.status)}
                      </Text>
                    </Box>
                  )}
                  <Box flexGrow={1} />
                  <Text dimColor mono tabular>
                    {card.elapsedMs === undefined ? '–' : elapsed(card.elapsedMs)}
                  </Text>
                </Box>
                {card.task !== '' && (
                  <Text dimColor={isQueued} wrap="truncate">
                    {clip(card.task, textWidth)}
                  </Text>
                )}
                {card.line !== '' && (
                  <Text dimColor={!isLive} mono wrap="truncate">
                    {clip(`» ${card.line}`, textWidth)}
                  </Text>
                )}
                <Box flexDirection="row" gap={1} alignItems="center">
                  <Text dimColor tabular size="caption">
                    {plural(card.calls, 'call')}
                  </Text>
                  <Text dimColor tabular size="caption">
                    {kfmt(card.tokens)} tok
                  </Text>
                  {'Svg' in T ? (
                    <T.Svg
                      source={chipSvg(card.modelKey, card.model)}
                      alt={`Model ${card.model}`}
                      width={Math.ceil(14 + card.model.length * 6.4)}
                      height={16}
                      isInteractive
                    />
                  ) : (
                    <Text color={MODEL_COLOR[card.modelKey].dark} weight="semibold">
                      ● {card.model}
                    </Text>
                  )}
                  {card.isOpenable ? (
                    <Button
                      key={`view-${card.id}`}
                      plain
                      dimColor={!isLive}
                      label="Transcript"
                      onPress={async () => {
                        await $.ui.view({ agentId: card.id })
                      }}
                    />
                  ) : (
                    <Text dimColor underline size="caption">
                      Transcript
                    </Text>
                  )}
                </Box>
                {isLive && (
                  <Progress
                    label={`${card.name} progress`}
                    value={card.progress}
                    max={1}
                    color={MODEL_COLOR[card.modelKey].dark}
                  />
                )}
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}

/** The model the main agent runs on: the demo's while it shows, else the session's. */
const mainModelOf = async (
  $: Dollar,
  cards: readonly { id: string }[],
): Promise<string> => {
  if (cards.some(one => isDemoId(one.id))) return DEMO_MAIN_MODEL
  try {
    return await $.session.model()
  } catch {
    return ''
  }
}
