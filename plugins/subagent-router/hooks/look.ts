// How the router looks. Text colors are theme keys, which follow the person's
// own light or dark theme. Everything drawn in a model's color (mascot, pips,
// chip, shimmer, bars, the saved pill) is a small SVG that carries both palette
// values and swaps them with `prefers-color-scheme`. Desktop and mobile draw
// SVG at the pixel size given; the terminal falls back to glyphs.

import type { Role, Tier } from '../types'

/** Palette values per mode: [light, dark], from design/subagent-router TOKENS. */
export const C = {
  haiku: ['#2f6fa3', '#6a9bcc'],
  sonnet: ['#6d5fb5', '#a79bd6'],
  opus: ['#b23f68', '#d4789a'],
  fable: ['#c8643f', '#d97757'],
  haikuBg: ['#e5eff8', '#1f2a35'],
  sonnetBg: ['#ece9f7', '#28253a'],
  opusBg: ['#f8e8ee', '#331f29'],
  fableBg: ['#fbefe9', '#2e2622'],
  queued: ['#c9c7bc', '#5c5a55'],
  zz: ['#6b6a63', '#9b998f'],
  dim: ['#6b6a63', '#8f8d84'],
  muted: ['#5f5e58', '#a8a69e'],
  track: ['#e5e2d8', '#3a3935'],
  ring: ['#c9c7bc', '#4a4944'],
  clay: ['#d97757', '#d97757'],
  accText: ['#b5502f', '#d97757'],
  success: ['#2f7a3e', '#8cc08a'],
  successBg: ['#e6f3e8', '#1f2a20'],
} as const satisfies Record<string, readonly [string, string]>

export type Token = keyof typeof C

const INK = '#141413'
const CREAM = '#faf9f5'
const CAP = '#e8c36a'
const SANS = `-apple-system,system-ui,'Inter',sans-serif`
const MONO = `'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace`

/** One theme key per model for the terminal's text, so a model keeps its hue in either mode. */
export const TIER_KEY: Record<Tier, 'ide' | 'merged' | 'planMode' | 'claude'> = {
  haiku: 'ide',
  sonnet: 'merged',
  opus: 'planMode',
  fable: 'claude',
}

/** `.f-<token>` fills, `.s-<token>` strokes, `.c-<token>` stop colors, per scheme. */
const palette = (used: readonly Token[]): string => {
  const rules = (i: 0 | 1): string =>
    used
      .map(t => `.f-${t}{fill:${C[t][i]}}.s-${t}{stroke:${C[t][i]}}.c-${t}{stop-color:${C[t][i]}}`)
      .join('')

  return `${rules(0)}@media (prefers-color-scheme:dark){${rules(1)}}`
}

const STILL = '@media (prefers-reduced-motion:reduce){*{animation:none!important}}'

const svg = (w: number, h: number, body: string, extra = '', pw = w, ph = h): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${pw}" height="${ph}"${extra}>${body}</svg>`

const esc = (s: string): string => s.replace(/[<&>"]/g, '')

// --------------------------------------------------------------- mascot --

export type MascotLook = 'running' | 'done' | 'failed' | 'queued'

const MASCOT_CSS = `<style>
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
${palette(['haiku', 'sonnet', 'opus', 'fable', 'queued', 'dim', 'zz'])}
${STILL}
</style>`

const r = (x: number, y: number, w: number, h: number, attrs: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs}/>`

/**
 * The 22 × 18 pixel mascot. `color` is the model it runs on, or `dim` for an
 * agent not routed yet; a queued one is grey and sleeps, a failed one has X eyes
 * and shakes. Draw it with `isInteractive` so it animates.
 */
export const mascotSvg = (
  role: Role,
  look: MascotLook,
  color: Tier | 'dim',
  px: number,
): string => {
  const body = `class="f-${look === 'queued' ? 'queued' : color}"`
  const parts: string[] = []
  if (role === 'explore') parts.push(r(10, 1, 2, 2, `fill="${CREAM}"`), r(9, 0, 4, 1, `fill="${CREAM}"`))
  if (role === 'tester') parts.push(r(5, 1, 12, 2, `fill="${CAP}"`), r(8, 0, 6, 1, `fill="${CAP}"`))
  parts.push(r(3, 3, 16, 8, body), r(0, 6, 3, 3, body), r(19, 6, 3, 3, body))
  if (look === 'done') {
    parts.push(r(6, 6, 2, 1, `fill="${INK}"`), r(14, 6, 2, 1, `fill="${INK}"`))
  } else if (look === 'failed') {
    parts.push(
      `<path d="M6 5l2 3M8 5l-2 3M14 5l2 3M16 5l-2 3" stroke="${INK}" stroke-width="0.9" fill="none"/>`,
    )
  } else {
    parts.push(
      r(6, 5, 2, 3, `class="eye" fill="${INK}"`),
      r(14, 5, 2, 3, `class="eye" fill="${INK}"`),
    )
  }
  if (role === 'reviewer') {
    parts.push(
      r(5, 4, 4, 5, `fill="none" stroke="${CREAM}" stroke-width="0.7"`),
      r(13, 4, 4, 5, `fill="none" stroke="${CREAM}" stroke-width="0.7"`),
      r(9, 6, 4, 0.7, `fill="${CREAM}"`),
    )
  }
  const legs = (long: readonly number[], short: readonly number[]): string =>
    long.map(x => r(x, 11, 2, 4, body)).join('') + short.map(x => r(x, 11, 2, 2, body)).join('')
  const zz =
    look === 'queued'
      ? `<g class="zz">${r(18, 0, 3, 1, 'class="f-zz"')}${r(19, 1, 1, 1, 'class="f-zz"')}${r(18, 2, 3, 1, 'class="f-zz"')}</g>`
      : ''

  return svg(
    22,
    18,
    MASCOT_CSS +
      `<g class="${look}"><g class="bob">${parts.join('')}</g>` +
      `<g class="legA">${legs([4, 12], [8, 16])}</g><g class="legB">${legs([8, 16], [4, 12])}</g>${zz}</g>`,
    ` shape-rendering="crispEdges" style="overflow:visible"`,
    px,
    mascotHeight(px),
  )
}

export const mascotHeight = (px: number): number => Math.round((px * 18) / 22)

/** The terminal's mascot: two block glyphs, legs swapping while it works. */
export const glyph = (look: MascotLook, frame: number): string =>
  look === 'running'
    ? frame % 2 === 0
      ? '▟▙'
      : '▜▛'
    : look === 'queued'
      ? 'zz'
      : look === 'failed'
        ? '✕✕'
        : '▟▙'

// ----------------------------------------------------------------- pips --

/** One pip per agent: filled with its model once routed, clay while it waits for an OK. */
export type Pip = { fill: Tier | 'clay' | 'none'; border: Tier | 'clay' | 'ring' | 'dim' }

const PIP = 9
const PIP_GAP = 5

export const pipsWidth = (n: number): number => Math.max(PIP, n * PIP + (n - 1) * PIP_GAP)

/** Squares 9px with a 1px border, 5px apart. */
export const pipsSvg = (pips: readonly Pip[]): string => {
  const w = pipsWidth(pips.length)
  const cells = pips
    .map((p, i) => {
      const fill = p.fill === 'none' ? 'fill="none"' : `class="f-${p.fill} s-${p.border}"`
      const stroke = p.fill === 'none' ? `class="s-${p.border}"` : ''

      return `<rect x="${i * (PIP + PIP_GAP) + 0.5}" y="0.5" width="8" height="8" stroke-width="1" ${fill} ${stroke}/>`
    })
    .join('')

  return svg(
    w,
    PIP,
    `<style>${palette(['haiku', 'sonnet', 'opus', 'fable', 'clay', 'ring', 'dim'])}</style>${cells}`,
    ` shape-rendering="crispEdges"`,
  )
}

/** The terminal's pips: ■ routed, □ to come, ✕ cancelled. */
export const pipGlyph = (p: Pip): string =>
  p.border === 'dim' && p.fill === 'none' ? '✕' : p.fill === 'none' ? '□' : '■'

// ----------------------------------------------------------------- chip --

/** Rough advance of 12px bold sans per character. */
const BOLD12 = 7.1

export const CHIP_HEIGHT = 22

export const chipWidth = (label: string): number => Math.ceil(2 + 20 + 7 + 6 + label.length * BOLD12)

/** The model chip: a pill with a 1px border in the model's color, its tint behind, a 7px dot. */
export const chipSvg = (tier: Tier, label: string): string => {
  const w = chipWidth(label)
  const h = CHIP_HEIGHT

  return svg(
    w,
    h,
    `<style>${palette([tier, `${tier}Bg` as Token])}text{font:700 12px ${SANS}}</style>` +
      `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${(h - 1) / 2}" class="f-${tier}Bg s-${tier}" stroke-width="1"/>` +
      `<circle cx="${11 + 3.5}" cy="${h / 2}" r="3.5" class="f-${tier}"/>` +
      `<text x="${11 + 7 + 6}" y="15.2" class="f-${tier}">${esc(label)}</text>`,
  )
}

/** The chip's place while Haiku reads: a 100 × 22 pill with a moving shine. */
export const shimmerSvg = (): string =>
  svg(
    100,
    22,
    `<style>${palette(['track', 'ring'])}${STILL}</style>` +
      `<defs><linearGradient id="sh" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="200" y2="0" spreadMethod="repeat">` +
      `<stop offset="0" class="c-track"/><stop offset=".5" class="c-ring"/><stop offset="1" class="c-track"/>` +
      `<animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="-200 0" dur="1.1s" repeatCount="indefinite"/>` +
      `</linearGradient><clipPath id="pill"><rect width="100" height="22" rx="11"/></clipPath></defs>` +
      `<rect width="100" height="22" rx="11" fill="url(#sh)" clip-path="url(#pill)"/>`,
  )

const READING = 'Haiku is reading the scope'
export const READING_WIDTH = Math.ceil((READING.length + 3) * 6.62)

/** "Haiku is reading the scope..." in Haiku's color, mono 11px, the dots pulsing. */
export const readingSvg = (): string =>
  svg(
    READING_WIDTH,
    16,
    `<style>${palette(['haiku'])}text{font:400 11px ${MONO}}` +
      `.d{animation:dot 1.2s infinite}.d2{animation-delay:.2s}.d3{animation-delay:.4s}` +
      `@keyframes dot{0%,80%,100%{opacity:.2}40%{opacity:1}}${STILL}</style>` +
      `<text y="12" class="f-haiku">${READING}<tspan class="d">.</tspan><tspan class="d d2">.</tspan><tspan class="d d3">.</tspan></text>`,
  )

// ------------------------------------------------------------ saved pill --

export const PILL_HEIGHT = 20
export const pillWidth = (text: string): number => Math.ceil(20 + text.length * BOLD12)

/** "$1.12 saved": success text on its tint, a full pill. */
export const savedPillSvg = (text: string): string => {
  const w = pillWidth(text)

  return svg(
    w,
    PILL_HEIGHT,
    `<style>${palette(['success', 'successBg'])}text{font:700 12px ${SANS};font-variant-numeric:tabular-nums}</style>` +
      `<rect width="${w}" height="${PILL_HEIGHT}" rx="${PILL_HEIGHT / 2}" class="f-successBg"/>` +
      `<text x="${w / 2}" y="14" text-anchor="middle" class="f-success">${esc(text)}</text>`,
  )
}

// ------------------------------------------------------------------ bars --

export const BAR_HEIGHT = 8

/**
 * One 8px bar on the track: `parts` are fractions of the full width, each in
 * its model's color (stacked) or `dim` for the baseline.
 */
export const barSvg = (
  width: number,
  parts: readonly { color: Tier | 'dim'; frac: number }[],
): string => {
  const w = Math.max(8, Math.round(width))
  let x = 0
  const segs = parts
    .filter(p => p.frac > 0)
    .map(p => {
      const sw = Math.round(Math.min(1, p.frac) * w * 100) / 100
      const out = `<rect x="${Math.round(x * 100) / 100}" y="0" width="${sw}" height="${BAR_HEIGHT}" class="f-${p.color}"/>`
      x += sw

      return out
    })
    .join('')

  return svg(
    w,
    BAR_HEIGHT,
    `<style>${palette(['track', 'dim', 'haiku', 'sonnet', 'opus', 'fable'])}</style>` +
      `<defs><clipPath id="t"><rect width="${w}" height="${BAR_HEIGHT}" rx="4"/></clipPath></defs>` +
      `<g clip-path="url(#t)"><rect width="${w}" height="${BAR_HEIGHT}" class="f-track"/>${segs}</g>`,
  )
}

/** The terminal's bar: `width` cells, each segment its share. */
export const barCells = (
  width: number,
  parts: readonly { color: Tier | 'dim'; frac: number }[],
): { color: Tier | 'dim' | 'track'; text: string }[] => {
  const out: { color: Tier | 'dim' | 'track'; text: string }[] = []
  let used = 0
  for (const p of parts) {
    const n = Math.round(Math.min(1, p.frac) * width)
    if (n > 0) out.push({ color: p.color, text: '█'.repeat(n) })
    used += n
  }
  if (used < width) out.push({ color: 'track', text: '░'.repeat(width - used) })

  return out
}

export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
