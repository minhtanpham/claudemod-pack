// The terminal's drawing of the band and the pane, laid out to design/cli:
// one band row that never wraps, and a pane of plain text rows (no SVG, no
// font sizes; hierarchy from bold, color and spacing alone).

import type { BoxProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import type { AgentDeckAgentStatus, AgentDeckStep } from '../types'
import {
  clip,
  clock,
  elapsed,
  kfmt,
  money,
  progressOf,
  type BandView,
  type CardView,
  type ModelKey,
} from './model'
import { segmentFill } from './mascot'

export type Elements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
}

/**
 * The terminal does not say whether it is light or dark, so the model hues are
 * the midpoint of the design's light and dark values: legible on either.
 */
export const MODEL_TERM: Record<ModelKey, string> = {
  haiku: '#4c85b8',
  sonnet: '#8a7dc6',
  opus: '#c35c81',
  fable: '#d06d4b',
}

export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** A run of one style within a row. */
export type Seg = {
  t: string
  color?: string
  bold?: boolean
  dim?: boolean
}

const width = (segs: readonly Seg[]): number =>
  segs.reduce((n, s) => n + s.t.length, 0)

// ----------------------------------------------------------------- band --

/** One step's thin segment: `━` filled, `╸` a half, `─` to come. */
export const segmentGlyphs = (fill: number, cells: number): Seg[] => {
  const n = Math.max(0, Math.min(1, fill)) * cells
  const full = Math.floor(n)
  const head = n - full >= 0.5 && full < cells
  const rest = cells - full - (head ? 1 : 0)
  const out: Seg[] = []
  if (full > 0) out.push({ t: '━'.repeat(full), color: 'claude' })
  if (head) out.push({ t: '╸', color: 'claude' })
  if (rest > 0) out.push({ t: '─'.repeat(rest), color: 'inactive', dim: true })

  return out
}

/** The bar: one segment per step, a space between; narrower as steps grow. */
export const bandBar = (steps: readonly AgentDeckStep[], budget = 24): Seg[] => {
  if (steps.length === 0) return []
  const cells = Math.max(1, Math.min(4, Math.floor((budget - (steps.length - 1)) / steps.length)))
  const out: Seg[] = []
  steps.forEach((step, i) => {
    if (i > 0) out.push({ t: ' ' })
    out.push(...segmentGlyphs(segmentFill(step), cells))
  })

  return out
}

/** The step label's most: the design truncates it near 18 cells. */
const LABEL_MAX = 18

/**
 * The band as one row of segments that fits `columns`: icon, n/m, the current
 * step (truncated), the bar, then state, tokens, cost and time. Parts go from
 * the right of the bar first, so it never wraps.
 */
export const bandRow = (
  band: BandView,
  steps: readonly AgentDeckStep[],
  columns: number,
): Seg[] => {
  const hasPlan = steps.length > 0
  const icon: Seg = band.isFinished
    ? { t: '✓', color: 'success', bold: true }
    : { t: '○', color: 'claude' }
  const head: Seg[] = [icon]
  if (hasPlan) head.push({ t: ' ' }, { t: `${band.done}/${band.total}`, color: 'claude', bold: true })
  head.push({ t: '  ' })
  const state = band.isFinished
    ? 'finished'
    : band.working > 0
      ? `${band.working} working`
      : 'idle'
  const full = `${state} · ${kfmt(band.tokens)} · ${money(band.cost)} · ${clock(band.elapsedMs)}`
  const bar = hasPlan ? bandBar(steps) : []
  const tries: { bar: Seg[]; tail: string }[] = [
    { bar, tail: full },
    { bar, tail: state },
    { bar: [], tail: state },
    { bar: [], tail: '' },
  ]
  for (const one of tries) {
    const fixed =
      width(head) + (one.bar.length ? 1 + width(one.bar) : 0) + (one.tail ? 2 + one.tail.length : 0)
    const room = Math.min(LABEL_MAX, columns - fixed)
    if (room < 6 && one.tail !== '') continue
    const label = clip(band.label, Math.max(1, room))
    const row: Seg[] = [...head, { t: label, bold: true }]
    if (one.bar.length) row.push({ t: ' ' }, ...one.bar)
    if (one.tail) row.push({ t: '  ' }, { t: one.tail, dim: true })

    return row
  }

  return head
}

const row = ({ Box, Text }: Elements, segs: readonly Seg[]): RenderElement => (
  <Box flexDirection="row" overflow="hidden">
    {segs.map(s => (
      <Text color={s.color} bold={s.bold} dimColor={s.dim} wrap="truncate-end">
        {s.t}
      </Text>
    ))}
  </Box>
)

export const terminalBand = (
  T: Elements,
  band: BandView,
  steps: readonly AgentDeckStep[],
  columns: number,
): RenderElement => row(T, bandRow(band, steps, columns))

// ----------------------------------------------------------------- pane --

const ICON: Record<AgentDeckAgentStatus, string> = {
  running: '○',
  done: '●',
  queued: '○',
  failed: '●',
  stopped: '○',
}

/** A card's second line: what it does while it runs, else its status. */
export const cardLine = (card: CardView): Seg => {
  if (card.status === 'running') return { t: card.line || 'Working' }
  if (card.status === 'done') return { t: 'Done', dim: true }
  if (card.status === 'failed') {
    return { t: card.line ? `Failed: ${card.line}` : 'Failed', color: 'error' }
  }

  return { t: card.status === 'queued' ? 'Queued' : 'Stopped', dim: true }
}

/** The widths of a card's columns at `columns`: 33 and 43 cells at most. */
export const cardWidths = (columns: number) => {
  const name = Math.max(6, Math.min(18, columns - 17))
  const model = Math.max(0, Math.min(11, columns - 2 - name - 5))
  // The line takes the full row less the two-cell indent and the token column.
  const line = Math.max(4, columns - 2 - 11)

  return { name, model, line }
}

export const terminalPane = (
  T: Elements,
  steps: readonly AgentDeckStep[],
  cards: readonly CardView[],
  tally: string,
  columns: number,
  frame: number,
  empty?: RenderElement,
): RenderElement => {
  const { Box, Text } = T
  const progress = progressOf(steps)
  const w = cardWidths(columns)

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Agent Deck</Text>

      {steps.length > 0 && (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text color="claude" bold>
              PLAN
            </Text>
            <Text> {`${progress.done}/${progress.total}`}</Text>
          </Box>
          {steps.map(step => {
            const isRun = step.status === 'in_progress'
            const isDone = step.status === 'completed'

            return (
              <Box flexDirection="row">
                <Text
                  color={isDone ? 'success' : isRun ? 'claude' : 'inactive'}
                  dimColor={step.status === 'pending'}
                >
                  {isDone ? '✓' : isRun ? SPIN[frame % SPIN.length] : '○'}
                </Text>
                <Text> </Text>
                <Text bold={isRun} dimColor={step.status === 'pending'} wrap="truncate-end">
                  {clip(step.text, columns - 2)}
                </Text>
              </Box>
            )
          })}
        </Box>
      )}

      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="claude" bold>
            AGENTS
          </Text>
          {tally !== '' && <Text> {tally}</Text>}
        </Box>
        {empty}
        {cards.map(card => {
          const color = MODEL_TERM[card.modelKey]
          const isQueued = card.status === 'queued' || card.status === 'stopped'
          const line = cardLine(card)
          const time = card.elapsedMs === undefined ? '–' : elapsed(card.elapsedMs)

          return (
            <Box flexDirection="column">
              <Box flexDirection="row" width={columns}>
                <Text
                  color={card.status === 'failed' ? 'error' : isQueued ? 'inactive' : color}
                  dimColor={isQueued}
                >
                  {ICON[card.status]}
                </Text>
                <Text> </Text>
                <Box width={w.name}>
                  <Text bold dimColor={isQueued} wrap="truncate-end">
                    {clip(card.name, w.name - 1)}
                  </Text>
                </Box>
                {w.model > 0 && (
                  <Box width={w.model}>
                    <Text color={color} wrap="truncate-end">
                      {clip(card.model, w.model)}
                    </Text>
                  </Box>
                )}
                <Box flexGrow={1} justifyContent="flex-end">
                  <Text>{time}</Text>
                </Box>
              </Box>
              <Box flexDirection="row" paddingLeft={2} width={columns}>
                <Box flexGrow={1}>
                  <Text color={line.color} dimColor={line.dim} wrap="truncate-end">
                    {clip(line.t, w.line - 1)}
                  </Text>
                </Box>
                <Box width={11} justifyContent="flex-end">
                  <Text dimColor>{`${kfmt(card.tokens)} tok`}</Text>
                </Box>
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
