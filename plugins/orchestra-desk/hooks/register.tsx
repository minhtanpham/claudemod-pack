import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { OrchestraRole, OrchestraAgentStatus } from '../types'
import {
  addAgent,
  addTokens,
  bandOf,
  buildCards,
  clearEnded,
  clip,
  clock,
  countEnded,
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
  ROLE_COLOR,
  roleOf,
  settleAgent,
  statusWord,
  stepTool,
  toolLabel,
  touchAgent,
  usageTokens,
} from './model'
import {
  bandGlyph,
  barSegments,
  barSvg,
  CELL_COLUMNS,
  CELL_ROWS,
  mascotCells,
  mascotSvg,
  MUTED,
  ORANGE,
} from './mascot'

const PANE = 'orchestra-desk'
const TITLE = 'Orchestra'

// Change a tag when the value's fields change: it declines what an earlier
// version stored, which outlives a hot reload.
const steps = atom({ plugin: 'orchestra-desk', key: 'steps' } as const, [], {
  shape: 'steps-2',
})
const agents = atom({ plugin: 'orchestra-desk', key: 'agents' } as const, [], {
  shape: 'agents-2',
})
const main = atom(
  { plugin: 'orchestra-desk', key: 'main' } as const,
  { tools: 0, tokens: 0 },
  { shape: 'main-1' },
)
const now = atom({ plugin: 'orchestra-desk', key: 'now' } as const, 0, {
  shape: 'now-1',
})
// When the demo that is playing started; -1 while none plays.
const demo = atom({ plugin: 'orchestra-desk', key: 'demo' } as const, -1, {
  shape: 'demo-1',
})
const demoFail = atom({ plugin: 'orchestra-desk', key: 'demoFail' } as const, false, {
  shape: 'demo-fail-1',
})
// When work began, for the band's clock; -1 while none has.
const started = atom({ plugin: 'orchestra-desk', key: 'started' } as const, -1, {
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

  return $.ui.open({ id: PANE, title: TITLE })
}

const clearAll = async ($: Dollar) => {
  await update($, demo, () => -1)
  await update($, steps, () => [])
  await update($, agents, () => [])
  await update($, main, () => ({ tools: 0, tokens: 0 }))
  await update($, started, () => -1)
}

/** Marks the moment work began, once. */
const begin = async ($: Dollar, at: number) => {
  if ((await read($, started)) < 0) await update($, started, () => at)
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const STATUS_COLOR: Record<OrchestraAgentStatus, string> = {
  running: ORANGE,
  queued: MUTED,
  done: '#8fa874',
  failed: '#e0605a',
  stopped: MUTED,
}

const STATUS_BG: Record<OrchestraAgentStatus, string> = {
  running: '#3a2a22',
  queued: '#2e2d2a',
  done: '#26301f',
  failed: '#3b2321',
  stopped: '#2e2d2a',
}

const BAR_CHARS = { done: '━━━', run: '╍╍╍', wait: '───' } as const

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'orchestra',
      description:
        'Open the Orchestra pane. "demo" plays a sample run ("demo fail" with a failing agent), "clear" empties it',
    })

    // One clock for every elapsed time, moving only while something runs. It
    // also settles a card whose agent ended with no turn to say so.
    $.clock.every(500, () => {
      void (async () => {
        try {
          const t0 = await read($, demo)
          const cards = await read($, agents)
          const list = await read($, steps)
          const since = await read($, started)
          const isLive =
            t0 >= 0 ||
            countRunning(cards) > 0 ||
            (since >= 0 && !progressOf(list).isFinished)
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

  // Answered here, so it runs no model call: `/orchestra`, `/orchestra demo`,
  // `/orchestra demo fail` and `/orchestra clear`.
  on('command.run', { command: 'orchestra' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/)
    const word = words[0] ?? ''
    if (word === 'clear') {
      await clearAll($)

      return { text: 'Orchestra cleared: no plan, no cards.' }
    }

    const isDemo = word === 'demo'
    const { isPlaced } = isDemo
      ? await startDemo($, words[1] === 'fail')
      : await $.ui.open({ id: PANE, title: TITLE })
    const where = isPlaced
      ? 'The pane is open.'
      : 'This surface is not showing panes now; the band still draws.'

    return {
      text: isDemo
        ? `Orchestra demo started: a sample plan and four sample agents, about ${DEMO_SECONDS} seconds, no model call. ${where}`
        : `Orchestra: ${where}`,
    }
  })

  // ---------------------------------------------------------- tracking --

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>

    try {
      const at = await $.clock.now()
      await begin($, at)
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
          void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
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
      } else if (tokens > 0) {
        await update($, main, m => ({ ...m, tokens: m.tokens + tokens }))
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
    if (list.length === 0 && cards.length === 0) return next(e)

    const T = $.ui.resolve(e)
    const { Box, Text, Button } = T
    const band = bandOf(list, cards, m, at, since)
    const frame = Math.floor(at / 500)
    const status: OrchestraAgentStatus = band.isFinished ? 'done' : 'running'
    const count = `${band.done}/${band.total}`
    const segments = barSegments(list)
    const columns = Math.max(20, e.props.bodyColumns)
    const room = Math.max(8, columns - 60)

    const mascot =
      'Svg' in T ? (
        <T.Svg
          source={mascotSvg('main', status, ROLE_COLOR.main, 30)}
          alt="Orchestra mascot"
          width={30}
          height={24}
          isInteractive
        />
      ) : (
        <Text color={ORANGE} bold>
          {bandGlyph(status, frame)}
        </Text>
      )

    const bar =
      'Svg' in T ? (
        <T.Svg
          source={barSvg(segments, 120)}
          alt={`${band.done} of ${band.total} steps done`}
          width={120}
          height={8}
          isInteractive
        />
      ) : (
        <Box flexDirection="row" gap={1}>
          {segments.map(s => (
            <Text
              color={s === 'wait' ? 'inactive' : ORANGE}
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
          <Text color={ORANGE} bold tabular>
            {count}
          </Text>
        )}
        <Text dimColor={band.isFinished} wrap="truncate">
          {clip(band.label, room)}
        </Text>
        {list.length > 0 && bar}
        {band.working > 0 && (
          <Box backgroundColor={STATUS_BG.running} paddingX={1}>
            <Button
              key="agents"
              plain
              label={`● ${band.working} working`}
              onPress={async () => {
                await $.ui.open({ id: PANE, title: TITLE })
              }}
            />
          </Box>
        )}
        <Text dimColor tabular>
          {kfmt(band.tokens)} tokens
        </Text>
        <Text dimColor tabular>
          ≈{money(band.cost)}
        </Text>
        {since >= 0 && (
          <Text dimColor tabular>
            {clock(band.elapsedMs)}
          </Text>
        )}
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
    const progress = progressOf(list)
    const running = countRunning(subs)
    const ended = countEnded(subs)
    const columns = Math.max(16, e.props.bodyColumns)
    const inner = columns - 4
    const frame = Math.floor(at / 500)
    const isEmpty = list.length === 0 && subs.length === 0 && since < 0

    const tally = [
      running > 0 ? `${running} running` : '',
      ended > 0 ? `${ended} finished` : '',
    ]
      .filter(Boolean)
      .join(' · ')

    // A widget is a glance: the two counts and nothing to press.
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          <Text color={running > 0 ? ORANGE : 'inactive'} bold={running > 0}>
            {running > 0 ? '●' : '○'} {tally || 'No subagents'}
          </Text>
          {list.length > 0 && (
            <Text dimColor>
              Plan {progress.done}/{progress.total}
            </Text>
          )}
        </Box>
      )
    }

    const sprite = (role: OrchestraRole, status: OrchestraAgentStatus, id: string) =>
      'Svg' in T ? (
        <T.Svg
          source={mascotSvg(role, status, ROLE_COLOR[role], 44)}
          alt={`${role} mascot, ${status}`}
          width={44}
          height={36}
          isInteractive
        />
      ) : (
        <T.Raster
          key={`sprite-${id}`}
          columns={CELL_COLUMNS}
          rows={CELL_ROWS}
          cells={mascotCells(role, status, ROLE_COLOR[role], frame)}
        />
      )

    const cards = isEmpty ? [] : buildCards(list, subs, m, at, since)

    return (
      <Box flexDirection="column" gap={1}>
        {list.length > 0 && (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color={ORANGE} bold>
                Plan
              </Text>
              <Text dimColor tabular>
                {progress.done}/{progress.total}
              </Text>
            </Box>
            {list.map(step => (
              <Box flexDirection="row" gap={1}>
                <Text
                  color={step.status === 'pending' ? 'inactive' : ORANGE}
                  dimColor={step.status === 'completed'}
                >
                  {step.status === 'completed'
                    ? '✓'
                    : step.status === 'in_progress'
                      ? SPIN[frame % SPIN.length]
                      : '○'}
                </Text>
                <Text
                  bold={step.status === 'in_progress'}
                  dimColor={step.status !== 'in_progress'}
                  wrap="truncate"
                >
                  {clip(step.text, columns - 2)}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <Box flexDirection="row" gap={1}>
          <Text color={ORANGE} bold>
            Agents
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
          const color = STATUS_COLOR[card.status]

          return (
            <Box
              flexDirection="row"
              gap={1}
              borderStyle="round"
              borderColor={isLive ? ORANGE : 'inactive'}
              borderDimColor={!isLive}
              paddingX={1}
            >
              {sprite(card.role, card.status, card.id)}
              <Box flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text bold wrap="truncate">
                    {clip(card.name, Math.max(4, inner - 20))}
                  </Text>
                  <Box backgroundColor={STATUS_BG[card.status]} paddingX={1}>
                    <Text color={color} bold>
                      {statusWord(card.status)}
                    </Text>
                  </Box>
                </Box>
                {card.task !== '' && (
                  <Text dimColor={!isLive} wrap="truncate">
                    {clip(card.task, inner - 14)}
                  </Text>
                )}
                {card.line !== '' && (
                  <Text dimColor wrap="truncate">
                    {clip(`${isLive ? '↳' : '»'} ${card.line}`, inner - 14)}
                  </Text>
                )}
                <Box flexDirection="row" gap={2}>
                  <Text dimColor tabular>
                    {plural(card.calls, 'call')}
                  </Text>
                  <Text dimColor tabular>
                    {kfmt(card.tokens)} tokens
                  </Text>
                  {card.elapsedMs !== undefined && (
                    <Text dimColor tabular>
                      {clock(card.elapsedMs)}
                    </Text>
                  )}
                </Box>
                {card.status !== 'queued' && (
                  <Progress
                    label={`${card.name} progress`}
                    value={card.progress}
                    max={1}
                    color={color}
                  />
                )}
                {card.isOpenable && (
                  <Button
                    key={`view-${card.id}`}
                    plain
                    dimColor={!isLive}
                    label="Open transcript"
                    onPress={async () => {
                      await $.ui.view({ agentId: card.id })
                    }}
                  />
                )}
              </Box>
            </Box>
          )
        })}

        {ended > 0 && (
          <Button
            key="clear"
            plain
            dimColor
            label={`Clear ${ended} finished`}
            onPress={() => update($, agents, clearEnded)}
          />
        )}
      </Box>
    )
  })
}
