// Pure drawing helpers: the pixel mascot as SVG (remote surfaces) and as
// half-block cells (terminal), plus the band's one-segment-per-step bar.

import type { AgentDeckAgentStatus, AgentDeckRole, AgentDeckStep } from '../types'
import { MODEL_COLOR, type ModelKey } from './model'

export const COLS = 22
export const ROWS = 18

// The terminal's cells carry one fixed color each and know no light or dark, so
// those use mid tones that read on either background. The SVG (desktop) swaps
// the neutral ones with the surface's own scheme through `prefers-color-scheme`.
const INK = '#141413'
const CREAM = '#faf9f5'
const HAT = '#e8c36a'
const SLEEP = '#5c5a55'
const ZZ = '#9b998f'
/** Neutral for the terminal's cells: legible on a white and on a black screen. */
const MID = '#8a887f'

export const ORANGE = '#d97757'
export const TRACK = '#3a3935'
const ACC_TEXT = { light: '#b5502f', dark: '#d97757' } as const

type Rect = readonly [number, number, number, number]

const bodyClass = (status: AgentDeckAgentStatus, model: ModelKey): string =>
  status === 'queued' ? 'sleep' : `m-${model}`
const fillAttr = (status: AgentDeckAgentStatus, model: ModelKey): string =>
  ` class="${bodyClass(status, model)}"`

const eyes = (status: AgentDeckAgentStatus): 'open' | 'happy' | 'x' =>
  status === 'done' ? 'happy' : status === 'failed' || status === 'stopped' ? 'x' : 'open'

// ------------------------------------------------------------------ svg --

const rect = ([x, y, w, h]: Rect, fill: string, extra = ''): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`

const modelCss = (scheme: 'light' | 'dark'): string =>
  (Object.keys(MODEL_COLOR) as ModelKey[])
    .map(key => `.m-${key}{fill:${MODEL_COLOR[key][scheme]}}`)
    .join('')

const STYLE = `<style>
.legB{opacity:0}
.running .legA{animation:a .5s steps(1) infinite}
.running .legB{animation:b .5s steps(1) infinite}
.running .bob{animation:bob .5s steps(1) infinite}
.running .eye{animation:blink 3.2s infinite;transform-box:fill-box;transform-origin:center}
.queued .zz{animation:zz 1.6s steps(1) infinite}
.failed .bob{animation:shake .4s steps(1) 3}
@keyframes a{0%{opacity:1}50%{opacity:0}}
@keyframes b{0%{opacity:0}50%{opacity:1}}
@keyframes bob{0%{transform:translateY(0)}50%{transform:translateY(-1px)}}
@keyframes blink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes zz{0%{opacity:1}50%{opacity:.25}}
@keyframes shake{0%{transform:translateX(0)}50%{transform:translateX(-1px)}}
${modelCss('light')}
.sleep{fill:#c9c7bc}
.zzc{fill:#6b6a63}
.tile{fill:#f0eee6;stroke:#e8e6dc}
@media (prefers-color-scheme:dark){
${modelCss('dark')}
.sleep{fill:#5c5a55}
.zzc{fill:#9b998f}
.tile{fill:#1a1918;stroke:#2e2d2b}
}
</style>`

/** The sprite's shapes, in a 22 × 18 box, with the class that animates them. */
const mascotBody = (
  role: AgentDeckRole,
  status: AgentDeckAgentStatus,
  model: ModelKey,
): string => {
  const look = eyes(status)
  const cls = status === 'stopped' ? 'failed' : status
  const fill = fillAttr(status, model)
  const parts: string[] = []
  if (role === 'explore') {
    parts.push(rect([10, 1, 2, 2], CREAM), rect([9, 0, 4, 1], CREAM))
  }
  if (role === 'tester') {
    parts.push(rect([5, 1, 12, 2], HAT), rect([8, 0, 6, 1], HAT))
  }
  parts.push(
    rect([3, 3, 16, 8], 'none', fill),
    rect([0, 6, 3, 3], 'none', fill),
    rect([19, 6, 3, 3], 'none', fill),
  )
  if (look === 'open') {
    parts.push(
      rect([6, 5, 2, 3], INK, ' class="eye"'),
      rect([14, 5, 2, 3], INK, ' class="eye"'),
    )
  } else if (look === 'happy') {
    parts.push(rect([6, 6, 2, 1], INK), rect([14, 6, 2, 1], INK))
  } else {
    parts.push(
      `<path d="M6 5l2 3M8 5l-2 3M14 5l2 3M16 5l-2 3" stroke="${INK}" stroke-width="0.9" fill="none"/>`,
    )
  }
  if (role === 'reviewer') {
    parts.push(
      `<rect x="5" y="4" width="4" height="5" fill="none" stroke="${CREAM}" stroke-width="0.7"/>`,
      `<rect x="13" y="4" width="4" height="5" fill="none" stroke="${CREAM}" stroke-width="0.7"/>`,
      rect([9, 6, 4, 0.7], CREAM),
    )
  }
  const legsA = [[4, 11, 2, 4], [8, 11, 2, 2], [12, 11, 2, 4], [16, 11, 2, 2]] as const
  const legsB = [[4, 11, 2, 2], [8, 11, 2, 4], [12, 11, 2, 2], [16, 11, 2, 4]] as const
  const zz =
    status === 'queued'
      ? `<g class="zz">${rect([18, 0, 3, 1], ZZ, ' class="zzc"')}${rect([19, 1, 1, 1], ZZ, ' class="zzc"')}${rect([18, 2, 3, 1], ZZ, ' class="zzc"')}</g>`
      : ''

  return (
    `<g class="${cls}">` +
    `<g class="bob">${parts.join('')}</g>` +
    `<g class="legA">${legsA.map(r => rect(r, 'none', fill)).join('')}</g>` +
    `<g class="legB">${legsB.map(r => rect(r, 'none', fill)).join('')}</g>` +
    zz +
    `</g>`
  )
}

/** The mascot as an SVG that animates itself; draw it with `isInteractive`. */
export const mascotSvg = (
  role: AgentDeckRole,
  status: AgentDeckAgentStatus,
  model: ModelKey,
  px: number,
): string => {
  const height = Math.round((px * ROWS) / COLS)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLS} ${ROWS}" width="${px}" height="${height}" shape-rendering="crispEdges" style="overflow:visible">` +
    STYLE +
    mascotBody(role, status, model) +
    `</svg>`
  )
}

/** A card's sprite: a 64px tile (inset fill, soft border, radius 10) holding the mascot at 44px. */
export const tileSvg = (
  role: AgentDeckRole,
  status: AgentDeckAgentStatus,
  model: ModelKey,
): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" shape-rendering="crispEdges">` +
  STYLE +
  `<rect class="tile" x="0.5" y="0.5" width="63" height="63" rx="10" stroke-width="1" shape-rendering="geometricPrecision"/>` +
  `<g transform="translate(10 14) scale(2)">${mascotBody(role, status, model)}</g>` +
  `</svg>`

/** The model chip: a dot and the name, 11px semibold, in the model's color. */
export const chipSvg = (model: ModelKey, label: string): string => {
  const width = Math.ceil(14 + label.length * 6.4)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 16" width="${width}" height="16">` +
    `<style>.c{fill:${MODEL_COLOR[model].light}}@media (prefers-color-scheme:dark){.c{fill:${MODEL_COLOR[model].dark}}}` +
    `text{font:600 11px -apple-system,system-ui,sans-serif}</style>` +
    `<circle class="c" cx="4" cy="8" r="3.5"/>` +
    `<text class="c" x="12" y="12">${label.replace(/[<&>]/g, '')}</text></svg>`
  )
}

/** A plan row's 16px icon: a clay circle with a check, a spinning ring, an empty ring. */
export const planIconSvg = (status: AgentDeckStep['status']): string => {
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">` +
    `<style>.a{fill:#d97757}.ra{stroke:#f0c9b8}.rt{stroke:${ACC_TEXT.light}}.rq{stroke:#c9c7bc}` +
    `@media (prefers-color-scheme:dark){.ra{stroke:#4a3a33}.rt{stroke:${ACC_TEXT.dark}}.rq{stroke:#4a4944}}</style>`
  if (status === 'completed') {
    return (
      head +
      `<circle class="a" cx="8" cy="8" r="8"/>` +
      `<path d="M4.6 8.4l2.4 2.4 4.4-5" fill="none" stroke="#141413" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    )
  }
  if (status === 'in_progress') {
    return (
      head +
      `<g><circle class="ra" cx="8" cy="8" r="7" fill="none" stroke-width="2"/>` +
      `<path class="rt" d="M8 1a7 7 0 0 1 7 7" fill="none" stroke-width="2"/>` +
      `<animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.8s" repeatCount="indefinite"/></g></svg>`
    )
  }

  return head + `<circle class="rq" cx="8" cy="8" r="7" fill="none" stroke-width="2"/></svg>`
}

export type Segment = 'done' | 'run' | 'wait'

/** One segment per step: finished, under way, still to come. */
export const barSegments = (steps: readonly AgentDeckStep[]): Segment[] =>
  steps.map(step =>
    step.status === 'completed' ? 'done' : step.status === 'in_progress' ? 'run' : 'wait',
  )

/** How full one step's segment is: done 1, running its fill (or half), queued 0. */
export const segmentFill = (step: AgentDeckStep): number =>
  step.status === 'completed' ? 1 : step.status === 'in_progress' ? step.fill ?? 0.5 : 0

/** The band's bar: one 8px segment per step, 4px gaps, running ones striped. */
export const barSvg = (steps: readonly AgentDeckStep[], width: number): string => {
  const gap = 4
  const h = 8
  const n = Math.max(1, steps.length)
  const w = Math.max(4, (width - gap * (n - 1)) / n)
  const cells = steps
    .map((step, i) => {
      const x = Math.round((i * (w + gap)) * 100) / 100
      const part = Math.max(0, Math.min(1, segmentFill(step)))
      const fill =
        part > 0
          ? `<rect x="${x}" y="0" width="${Math.max(h, Math.round(w * part * 100) / 100)}" height="${h}" rx="4" fill="${step.status === 'in_progress' ? 'url(#st)' : ''}"${step.status === 'in_progress' ? '' : ' class="acc"'}/>`
          : ''

      return `<rect class="track" x="${x}" y="0" width="${Math.round(w * 100) / 100}" height="${h}" rx="4"/>${fill}`
    })
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}">` +
    `<style>.track{fill:#dedbd0}.acc{fill:${ACC_TEXT.light}}.sa{fill:${ACC_TEXT.light}}` +
    `@media (prefers-color-scheme:dark){.track{fill:#3a3935}.acc{fill:${ACC_TEXT.dark}}.sa{fill:${ACC_TEXT.dark}}}</style>` +
    `<defs><pattern id="st" width="22" height="8" patternUnits="userSpaceOnUse" patternTransform="skewX(-45)">` +
    `<rect width="22" height="8" class="sa"/><rect x="11" width="11" height="8" fill="rgba(255,255,255,0.26)"/>` +
    `<animateTransform attributeName="patternTransform" type="translate" additive="sum" from="0 0" to="22 0" dur="0.9s" repeatCount="indefinite"/>` +
    `</pattern></defs>${cells}</svg>`
  )
}


/**
 * A card's progress bar: a 6px rounded track under 8px of air, filled to `to`
 * in the model's color. When `from` is lower it grows from there to `to`.
 */
export const progressSvg = (model: ModelKey, width: number, from: number, to: number): string => {
  const clamp = (n: number) => Math.max(0, Math.min(1, n))
  const min = 6
  const px = (n: number) => Math.round(Math.max(min, width * clamp(n)) * 100) / 100
  const end = px(to)
  const start = px(from)
  const grow =
    start < end
      ? `<animate attributeName="width" from="${start}" to="${end}" dur="0.8s" begin="0s" calcMode="spline" keyTimes="0;1" keySplines="0.22 0.61 0.36 1" fill="freeze"/>`
      : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 14" width="${width}" height="14">` +
    `<style>.t{fill:#dedbd0}.f{fill:${MODEL_COLOR[model].light}}` +
    `@media (prefers-color-scheme:dark){.t{fill:#3a3935}.f{fill:${MODEL_COLOR[model].dark}}}</style>` +
    `<rect class="t" x="0" y="8" width="${width}" height="6" rx="3"/>` +
    `<rect class="f" x="0" y="8" width="${end}" height="6" rx="3">${grow}</rect></svg>`
  )
}

// --------------------------------------------------------------- pixels --

const hex = (value: string): number => parseInt(value.slice(1), 16)

type Grid = (number | undefined)[][]

const blank = (): Grid => Array.from({ length: ROWS }, () => Array.from<number | undefined>({ length: COLS }))

const paint = (grid: Grid, [x, y, w, h]: Rect, rgb: number): void => {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      if (j >= 0 && j < ROWS && i >= 0 && i < COLS) grid[j]![i] = rgb
    }
  }
}

/** One frame of the mascot as a grid of colors; `frame` flips its legs. */
export const mascotPixels = (
  role: AgentDeckRole,
  status: AgentDeckAgentStatus,
  color: string,
  frame: number,
): Grid => {
  const g = blank()
  const fill = hex(status === 'queued' ? MID : color)
  const ink = hex(INK)
  const cream = hex(MID)
  const isRun = status === 'running'
  const up = isRun && frame % 2 === 1 ? -1 : 0
  const at = ([x, y, w, h]: Rect): Rect => [x, y + up, w, h]

  if (role === 'explore') {
    paint(g, at([10, 1, 2, 2]), cream)
    paint(g, at([9, 0, 4, 1]), cream)
  }
  if (role === 'tester') {
    paint(g, at([5, 1, 12, 2]), hex(HAT))
    paint(g, at([8, 0, 6, 1]), hex(HAT))
  }
  paint(g, at([3, 3, 16, 8]), fill)
  paint(g, at([0, 6, 3, 3]), fill)
  paint(g, at([19, 6, 3, 3]), fill)

  const look = eyes(status)
  const isBlink = isRun && frame % 7 === 6
  for (const x of [6, 14]) {
    if (look === 'open') paint(g, at(isBlink ? [x, 6, 2, 1] : [x, 5, 2, 3]), ink)
    else if (look === 'happy') paint(g, at([x, 6, 2, 1]), ink)
    else {
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 2], [1, 2], [0, 1]] as const) {
        paint(g, at([x + dx, 5 + dy, 1, 1]), ink)
      }
    }
  }
  if (role === 'reviewer') {
    for (const x of [5, 13]) {
      paint(g, at([x, 4, 4, 1]), cream)
      paint(g, at([x, 8, 4, 1]), cream)
      paint(g, at([x, 5, 1, 3]), cream)
      paint(g, at([x + 3, 5, 1, 3]), cream)
    }
    paint(g, at([9, 6, 4, 1]), cream)
  }

  const isB = isRun && frame % 2 === 1
  const long: readonly number[] = isB ? [8, 16] : [4, 12]
  const short: readonly number[] = isB ? [4, 12] : [8, 16]
  for (const x of long) paint(g, [x, 11, 2, 4], fill)
  for (const x of short) paint(g, [x, 11, 2, 2], fill)
  if (status === 'queued' && frame % 2 === 0) {
    paint(g, [18, 0, 3, 1], hex(MID))
    paint(g, [19, 1, 1, 1], hex(MID))
    paint(g, [18, 2, 3, 1], hex(MID))
  }

  return g
}

// ---------------------------------------------------------------- cells --

const DEFAULT = 0x01000000

/** Standard padded base64 of bytes; the module has no Buffer or btoa. */
export const base64 = (bytes: Uint8Array): string => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += A[(n >> 18) & 63]! + A[(n >> 12) & 63]!
    out += b === undefined ? '=' : A[(n >> 6) & 63]!
    out += c === undefined ? '=' : A[n & 63]!
  }

  return out
}

const triplets = (cells: readonly (readonly [number, number, number])[]): string => {
  const bytes = new Uint8Array(cells.length * 12)
  cells.forEach((cell, i) => {
    cell.forEach((word, k) => {
      const at = i * 12 + k * 4
      bytes[at] = word & 255
      bytes[at + 1] = (word >>> 8) & 255
      bytes[at + 2] = (word >>> 16) & 255
      bytes[at + 3] = (word >>> 24) & 255
    })
  })

  return base64(bytes)
}

export const CELL_COLUMNS = 11
export const CELL_ROWS = 5

const first = (...values: (number | undefined)[]): number | undefined =>
  values.find(value => value !== undefined)

/** The mascot for a terminal: 2×2 pixels per half cell, 11×5 cells. */
export const mascotCells = (
  role: AgentDeckRole,
  status: AgentDeckAgentStatus,
  color: string,
  frame: number,
): string => {
  const g = mascotPixels(role, status, color, frame)
  const small = (x: number, y: number): number | undefined =>
    first(g[y * 2]?.[x * 2], g[y * 2]?.[x * 2 + 1], g[y * 2 + 1]?.[x * 2], g[y * 2 + 1]?.[x * 2 + 1])
  const cells: [number, number, number][] = []
  for (let row = 0; row < CELL_ROWS; row++) {
    for (let col = 0; col < CELL_COLUMNS; col++) {
      const top = small(col, row * 2)
      const bottom = small(col, row * 2 + 1)
      if (top !== undefined && bottom !== undefined) cells.push([0x2580, top, bottom])
      else if (top !== undefined) cells.push([0x2580, top, DEFAULT])
      else if (bottom !== undefined) cells.push([0x2584, bottom, DEFAULT])
      else cells.push([0x20, DEFAULT, DEFAULT])
    }
  }

  return triplets(cells)
}

/** The band's mascot on a terminal: one colored glyph. */
export const bandGlyph = (status: AgentDeckAgentStatus, frame: number): string =>
  status === 'running' ? (frame % 2 === 0 ? '▟▙' : '▜▛') : status === 'queued' ? '▂▂' : '▟▙'

const BADGE: Record<string, { light: [string, string]; dark: [string, string] }> = {
  done: { light: ['#e6f3e8', '#2f7a3e'], dark: ['#1f2a20', '#8cc08a'] },
  running: { light: ['#fbefe9', '#b5502f'], dark: ['#2e2622', '#d97757'] },
  failed: { light: ['#fbe9e7', '#b3261e'], dark: ['#2e2020', '#e08a80'] },
  queued: { light: ['#f0eee6', '#6b6a63'], dark: ['#1a1918', '#8f8d84'] },
  stopped: { light: ['#f0eee6', '#6b6a63'], dark: ['#1a1918', '#8f8d84'] },
}

/** The status pill ("Done", "Working"): success or accent tint with matching text. */
export const badgeSvg = (status: string, word: string): string => {
  const c = BADGE[status] ?? BADGE.queued!
  const width = Math.ceil(16 + word.length * 6.6)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 18" width="${width}" height="18">` +
    `<style>.p{fill:${c.light[0]}}.t{fill:${c.light[1]};font:600 11px -apple-system,system-ui,sans-serif}` +
    `@media (prefers-color-scheme:dark){.p{fill:${c.dark[0]}}.t{fill:${c.dark[1]}}}</style>` +
    `<rect class="p" width="${width}" height="18" rx="9"/>` +
    `<text class="t" x="${width / 2}" y="12.5" text-anchor="middle">${word.replace(/[<&>]/g, '')}</text></svg>`
  )
}
