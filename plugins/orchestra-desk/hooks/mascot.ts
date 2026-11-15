// Pure drawing helpers: the pixel mascot as SVG (remote surfaces) and as
// half-block cells (terminal), plus the band's five-segment bar.

import type { OrchestraAgentStatus, OrchestraRole, OrchestraStep } from '../types'

export const COLS = 22
export const ROWS = 18

const INK = '#1a1918'
const CREAM = '#faf9f5'
const HAT = '#e8c36a'
const SLEEP = '#5c5a55'
const ZZ = '#9b998f'

export const MUTED = '#9b998f'
export const ORANGE = '#d97757'
export const TRACK = '#3a3935'

type Rect = readonly [number, number, number, number]

const bodyFill = (status: OrchestraAgentStatus, color: string): string =>
  status === 'queued' ? SLEEP : color

const eyes = (status: OrchestraAgentStatus): 'open' | 'happy' | 'x' =>
  status === 'done' ? 'happy' : status === 'failed' || status === 'stopped' ? 'x' : 'open'

// ------------------------------------------------------------------ svg --

const rect = ([x, y, w, h]: Rect, fill: string, extra = ''): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`

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
</style>`

/** The mascot as an SVG that animates itself; draw it with `isInteractive`. */
export const mascotSvg = (
  role: OrchestraRole,
  status: OrchestraAgentStatus,
  color: string,
  px: number,
): string => {
  const fill = bodyFill(status, color)
  const look = eyes(status)
  const cls = status === 'stopped' ? 'failed' : status
  const parts: string[] = []
  if (role === 'explore') {
    parts.push(rect([10, 1, 2, 2], CREAM), rect([9, 0, 4, 1], CREAM))
  }
  if (role === 'tester') {
    parts.push(rect([5, 1, 12, 2], HAT), rect([8, 0, 6, 1], HAT))
  }
  parts.push(
    rect([3, 3, 16, 8], fill),
    rect([0, 6, 3, 3], fill),
    rect([19, 6, 3, 3], fill),
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
      ? `<g class="zz" fill="${ZZ}">${rect([18, 0, 3, 1], ZZ)}${rect([19, 1, 1, 1], ZZ)}${rect([18, 2, 3, 1], ZZ)}</g>`
      : ''
  const height = Math.round((px * ROWS) / COLS)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLS} ${ROWS}" width="${px}" height="${height}" shape-rendering="crispEdges" class="${cls}" style="overflow:visible">` +
    STYLE +
    `<g class="bob">${parts.join('')}</g>` +
    `<g class="legA">${legsA.map(r => rect(r, fill)).join('')}</g>` +
    `<g class="legB">${legsB.map(r => rect(r, fill)).join('')}</g>` +
    zz +
    `</svg>`
  )
}

export type Segment = 'done' | 'run' | 'wait'

/** The plan as five segments: finished, under way, still to come. */
export const barSegments = (steps: readonly OrchestraStep[], count = 5): Segment[] => {
  const total = steps.length
  if (total === 0) return Array.from({ length: count }, () => 'wait' as const)
  const done = steps.filter(s => s.status === 'completed').length / total
  const live = steps.filter(s => s.status === 'in_progress').length / total

  return Array.from({ length: count }, (_, i) => {
    if ((i + 1) / count <= done + 1e-9) return 'done' as const
    if (i / count < done + live - 1e-9) return 'run' as const

    return 'wait' as const
  })
}

/** The band's bar: striped, animated segments while a step runs. */
export const barSvg = (segments: readonly Segment[], width: number): string => {
  const gap = 3
  const h = 8
  const w = Math.floor((width - gap * (segments.length - 1)) / segments.length)
  const cells = segments
    .map((s, i) => {
      const x = i * (w + gap)
      const fill = s === 'done' ? ORANGE : s === 'run' ? 'url(#st)' : TRACK

      return `<rect x="${x}" y="0" width="${w}" height="${h}" rx="2" fill="${fill}"/>`
    })
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}">` +
    `<defs><pattern id="st" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="8" height="8" fill="${ORANGE}"/><rect width="4" height="8" fill="#f0a78d"/>` +
    `<animateTransform attributeName="patternTransform" type="translate" additive="sum" from="0 0" to="8 0" dur="0.6s" repeatCount="indefinite"/>` +
    `</pattern></defs>${cells}</svg>`
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
  role: OrchestraRole,
  status: OrchestraAgentStatus,
  color: string,
  frame: number,
): Grid => {
  const g = blank()
  const fill = hex(bodyFill(status, color))
  const ink = hex(INK)
  const cream = hex(CREAM)
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
    paint(g, [18, 0, 3, 1], hex(ZZ))
    paint(g, [19, 1, 1, 1], hex(ZZ))
    paint(g, [18, 2, 3, 1], hex(ZZ))
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
  role: OrchestraRole,
  status: OrchestraAgentStatus,
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
export const bandGlyph = (status: OrchestraAgentStatus, frame: number): string =>
  status === 'running' ? (frame % 2 === 0 ? '▟▙' : '▜▛') : status === 'queued' ? '▂▂' : '▟▙'
