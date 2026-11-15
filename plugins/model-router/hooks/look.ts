// How the router looks. The terminal and the desktop app both resolve theme
// keys against the person's own light or dark theme, so every text color here
// is a key, never a hex. Only the mascot's SVG carries hex, and it swaps them
// with `prefers-color-scheme` (shared palette: light and dark values below).

import type { Tier } from './router'

export type TierKey = 'ide' | 'merged' | 'planMode' | 'claude'

/** One theme key per model, so a model keeps its hue in either mode. */
export const TIER_KEY: Record<Tier, TierKey> = {
  haiku: 'ide',
  sonnet: 'merged',
  opus: 'planMode',
  fable: 'claude',
}

export const TIER_NAME: Record<Tier, string> = {
  haiku: 'Haiku 5.5',
  sonnet: 'Sonnet 5.5',
  opus: 'Opus 5.5',
  fable: 'Fable 5.2',
}

/** Palette values per mode: [light, dark]. */
const BODY: Record<Tier, readonly [string, string]> = {
  haiku: ['#2f6fa3', '#6a9bcc'],
  sonnet: ['#6d5fb5', '#a79bd6'],
  opus: ['#b23f68', '#d4789a'],
  fable: ['#c8643f', '#d97757'],
}

export type MascotLook = 'running' | 'done' | 'failed' | 'queued'

const STYLE = (tier: Tier): string => `<style>
.b{fill:${BODY[tier][0]}}
.k{fill:#1a1918}
.legB{opacity:0}
.running .legA{animation:a .5s steps(1) infinite}
.running .legB{animation:b .5s steps(1) infinite}
.running .bob{animation:bob .5s steps(1) infinite}
.running .eye{animation:blink 3.2s infinite;transform-box:fill-box;transform-origin:center}
@keyframes a{0%{opacity:1}50%{opacity:0}}
@keyframes b{0%{opacity:0}50%{opacity:1}}
@keyframes bob{0%{transform:translateY(0)}50%{transform:translateY(-1px)}}
@keyframes blink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@media (prefers-color-scheme:dark){.b{fill:${BODY[tier][1]}}}
</style>`

const r = (x: number, y: number, w: number, h: number, c: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${c}"/>`

/** The pixel mascot, tinted by the model it wears; draw it with `isInteractive`. */
export const mascotSvg = (tier: Tier, look: MascotLook, px: number): string => {
  const eyes =
    look === 'done'
      ? r(6, 6, 2, 1, 'k') + r(14, 6, 2, 1, 'k')
      : look === 'failed'
        ? `<path d="M6 5l2 3M8 5l-2 3M14 5l2 3M16 5l-2 3" stroke="#1a1918" stroke-width="0.9" fill="none"/>`
        : `<rect class="k eye" x="6" y="5" width="2" height="3"/><rect class="k eye" x="14" y="5" width="2" height="3"/>`
  const legs = (long: readonly number[], short: readonly number[]): string =>
    long.map(x => r(x, 11, 2, 4, 'b')).join('') + short.map(x => r(x, 11, 2, 2, 'b')).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 18" width="${px}" height="${Math.round((px * 18) / 22)}" shape-rendering="crispEdges" class="${look}" style="overflow:visible">` +
    STYLE(tier) +
    `<g class="bob">${r(3, 3, 16, 8, 'b')}${r(0, 6, 3, 3, 'b')}${r(19, 6, 3, 3, 'b')}${eyes}</g>` +
    `<g class="legA">${legs([4, 12], [8, 16])}</g><g class="legB">${legs([8, 16], [4, 12])}</g>` +
    `</svg>`
  )
}

/** The terminal's one-glyph mascot. */
export const glyph = (look: MascotLook, frame: number): string =>
  look === 'running' ? (frame % 2 === 0 ? '▟▙' : '▜▛') : look === 'queued' ? '▂▂' : '▟▙'

/** A colored pip per routed agent: ● routed, ◌ waiting, ✕ cancelled. */
export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
