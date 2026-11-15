import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { OrchestraAgent, OrchestraStepStatus } from '../types'
import {
  addAgent,
  barRuns,
  clearEnded,
  clip,
  countRunning,
  elapsed,
  endedStatus,
  firstLine,
  plural,
  progressOf,
  reduceSteps,
  settleAgent,
  sortAgents,
  stepTool,
  toolLabel,
  touchAgent,
} from './model'

const PANE = 'orchestra-desk'
const TITLE = 'Orchestra'

// Claude's look: its orange for what is live, gray for the rest.
const ORANGE = 'claude'
const GRAY = 'inactive'

// Change a tag when the value's fields change: it declines what an earlier
// version stored, which outlives a hot reload.
const steps = atom({ plugin: 'orchestra-desk', key: 'steps' } as const, [], {
  shape: 'steps-1',
})
const agents = atom({ plugin: 'orchestra-desk', key: 'agents' } as const, [], {
  shape: 'agents-1',
})
const now = atom({ plugin: 'orchestra-desk', key: 'now' } as const, 0)

const BAR: Record<OrchestraStepStatus, string> = {
  completed: '━',
  in_progress: '╍',
  pending: '─',
}

const GLYPH: Record<OrchestraAgent['status'], string> = {
  running: '●',
  done: '✓',
  failed: '✕',
  stopped: '■',
}

const STEP_GLYPH: Record<OrchestraStepStatus, string> = {
  completed: '✓',
  in_progress: '▸',
  pending: '○',
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'orchestra',
      description: 'Open the Orchestra pane: the plan and a card per subagent',
    })

    // One clock for every card's elapsed time, moving only while an agent
    // runs. It also settles a card whose agent ended with no turn to say so.
    $.clock.every(1000, () => {
      void (async () => {
        try {
          const cards = await read($, agents)
          if (countRunning(cards) === 0) return
          const at = await $.clock.now()
          await update($, now, () => at)
          const listed = await $.agent.list()
          for (const info of listed) {
            const ended = endedStatus(info.status)
            if (!ended) continue
            const card = cards.find(one => one.id === info.id)
            if (card?.status !== 'running') continue
            await update($, agents, list => settleAgent(list, info.id, ended, at))
          }
        } catch {
          // A missed tick only leaves a clock a second behind.
        }
      })()
    })

    return next(e)
  })

  on('command.run', { command: 'orchestra' }, async $ => {
    const { isPlaced } = await $.ui.open({ id: PANE, title: TITLE })

    return {
      text: isPlaced
        ? 'Orchestra pane opened.'
        : 'Orchestra pane is ready; this surface is not showing panes now.',
    }
  })

  // ---------------------------------------------------------- tracking --

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>

    // A subagent's call moves its card; its to-do list is its own business.
    if (e.agentId) {
      const id = e.agentId
      try {
        const at = await $.clock.now()
        const label = toolLabel(e.tool, input)
        await update($, agents, list => touchAgent(list, id, label, at))
      } catch {
        // Tracking never stands in a tool call's way.
      }

      return next(e)
    }

    const kind = stepTool(e.tool)
    const ran = await next(e)
    if (kind) {
      try {
        const result = (ran as { result?: unknown }).result
        await update($, steps, list => reduceSteps(list, kind, input, result))
      } catch {
        // As above.
      }
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
        await update($, now, () => at)
        await update($, agents, list =>
          addAgent(list, {
            id,
            type: e.subagentType || 'agent',
            description: clip(e.description ?? '', 120),
            status: 'running',
            startedAt: known?.startedAt ?? at,
            tools: known?.tools ?? 0,
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
      if (e.agentId) {
        const id = e.agentId
        const at = await $.clock.now()
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
          settleAgent(list, id, status, at, summary),
        )
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
    const running = countRunning(cards)
    if (list.length === 0 && running === 0) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const progress = progressOf(list)
    const chip = running > 0 ? `● ${plural(running, 'agent')}` : ''
    const count = `${progress.done}/${progress.total}`
    const columns = Math.max(20, e.props.bodyColumns)
    const runs = barRuns(list, Math.min(24, Math.floor(columns / 3)))
    const barWidth = runs.reduce((sum, run) => sum + run.cells, 0)
    const room = columns - barWidth - count.length - chip.length - 8
    const label = progress.isFinished
      ? 'All steps done'
      : (progress.current?.active ?? progress.current?.text ?? '')

    return (
      <Box flexDirection="row" gap={1}>
        <Text color={ORANGE} bold>
          ◆
        </Text>
        {list.length > 0 && (
          <Box flexDirection="row">
            {runs.map(run => (
              <Text
                color={run.status === 'pending' ? GRAY : ORANGE}
                bold={run.status === 'in_progress'}
                dimColor={run.status === 'pending'}
              >
                {BAR[run.status].repeat(run.cells)}
              </Text>
            ))}
          </Box>
        )}
        {list.length > 0 && (
          <Text color={progress.isFinished ? ORANGE : undefined} tabular>
            {count}
          </Text>
        )}
        {list.length > 0 && room > 3 && (
          <Text dimColor={progress.isFinished} wrap="truncate">
            {clip(label, room)}
          </Text>
        )}
        {running > 0 && (
          <Button
            key="agents"
            plain
            label={chip}
            onPress={async () => {
              await $.ui.open({ id: PANE, title: TITLE })
            }}
          />
        )}
      </Box>
    )
  })

  // -------------------------------------------------------------- pane --

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, steps)
    const cards = sortAgents(await read($, agents))
    const at = await read($, now)
    const progress = progressOf(list)
    const running = countRunning(cards)
    const ended = cards.length - running
    const columns = Math.max(16, e.props.bodyColumns)
    const inner = columns - 4

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
          <Text color={running > 0 ? ORANGE : GRAY} bold={running > 0}>
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
                  color={step.status === 'pending' ? GRAY : ORANGE}
                  dimColor={step.status === 'completed'}
                >
                  {STEP_GLYPH[step.status]}
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
            Subagents
          </Text>
          {tally !== '' && <Text dimColor>{tally}</Text>}
        </Box>

        {cards.length === 0 && (
          <Text dimColor>
            No subagents yet. Each one Claude starts gets a live card here.
          </Text>
        )}

        {cards.map(card => {
          const isLive = card.status === 'running'
          const spent = elapsed(
            (card.endedAt ?? Math.max(at, card.startedAt)) - card.startedAt,
          )
          const detail = isLive
            ? (card.lastTool ?? 'Starting…')
            : (card.summary ?? card.lastTool ?? '')

          return (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={isLive ? ORANGE : GRAY}
              borderDimColor={!isLive}
              paddingX={1}
            >
              <Box flexDirection="row" gap={1}>
                <Text
                  color={
                    isLive ? ORANGE : card.status === 'failed' ? 'error' : GRAY
                  }
                  bold={isLive}
                >
                  {GLYPH[card.status]}
                </Text>
                <Text bold={isLive} dimColor={!isLive} wrap="truncate">
                  {clip(card.type, Math.max(4, inner - spent.length - 3))}
                </Text>
                <Text color={isLive ? ORANGE : GRAY} dimColor={!isLive} tabular>
                  {spent}
                </Text>
              </Box>
              {card.description !== '' && (
                <Text dimColor={!isLive} wrap="truncate">
                  {clip(card.description, inner)}
                </Text>
              )}
              {detail !== '' && (
                <Text dimColor wrap="truncate">
                  {clip(`${isLive ? '↳' : '»'} ${detail}`, inner)}
                </Text>
              )}
              <Box flexDirection="row" gap={2}>
                <Text dimColor tabular>
                  {plural(card.tools, 'tool call')}
                </Text>
                <Button
                  key={`view-${card.id}`}
                  plain
                  dimColor={!isLive}
                  label="Open transcript"
                  onPress={async () => {
                    await $.ui.view({ agentId: card.id })
                  }}
                />
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
