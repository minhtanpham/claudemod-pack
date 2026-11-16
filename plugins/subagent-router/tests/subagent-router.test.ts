import { expect, mock, test } from 'claude-code/testing'

import { chipSvg, mascotSvg, pipsSvg, TIER_KEY } from '../hooks/look'
import {
  OVERHEAD,
  capTier,
  classifyPrompt,
  cost,
  demoView,
  effective,
  fableQuestion,
  floorTier,
  money,
  parseVerdict,
  split,
  tierOf,
  totals,
} from '../hooks/router'
import * as router from '../hooks/router'
import type { RouterEntry } from '../types'

const SPAWN = {
  tool_use_id: 't1',
  prompt: 'Find every file that imports the config loader and list them.',
  description: 'find importers',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-fable-5-2',
  background: false,
  fork: false,
} as const

const COMMAND = {
  command: 'router',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const band = (surface: (typeof SURFACES)[number], bodyColumns = 140) =>
  ({
    plugin: 'subagent-router',
    component: 'AbovePrompt',
    surface,
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: true,
      maxRows: 20,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 20 },
      view: {},
    },
  }) as any

/** The world beneath: Haiku answers `verdict` (or fails), the dialog answers `answer`. */
function setup(on: any, verdict: string | undefined, answer = 'Use Opus 5.5 instead', asked: string[] = []) {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'router' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('ui.notice', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('model.complete', () =>
    verdict === undefined
      ? { value: { isAnswered: false, reason: 'timeout' } }
      : {
          value: {
            isAnswered: true,
            text: verdict,
            usage: { input_tokens: 1600, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          },
        },
  )
  on('tool.call', { tool: 'AskUserQuestion' }, (_: any, e: any) => {
    const q = e.questions[0].question as string
    asked.push(q)
    if (answer === '') throw new Error('dismissed')

    return { result: { questions: e.questions, answers: { [q]: answer } } }
  })
  // The engine beneath: starts the agent on the model it was handed, else the session's.
  on('agent.spawn', (_: any, e: any) => ({ model: e.model ?? 'session', agentId: 'a1' }))

  return clock
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

// ------------------------------------------------------------------ pure --

test('money shows three decimals under a cent, else two', () => {
  expect(money(0.00324)).toBe('$0.003')
  expect(money(0.0018)).toBe('$0.002')
  expect(money(0.1656)).toBe('$0.17')
  expect(money(1.8864)).toBe('$1.89')
  expect(money(0.00036)).toBe('<$0.001')
  expect(money(0)).toBe('$0.000')
})

test('estimates split 80/20; a Haiku review is 2k tokens, $0.00036', () => {
  expect(split(1000)).toEqual({ inTok: 800, outTok: 200 })
  expect(Math.abs(OVERHEAD - 0.00036)).toBeLessThan(1e-12)
  const per1k = (t: 'haiku' | 'sonnet' | 'opus' | 'fable') => cost(t, 800, 200)
  expect(Math.abs(per1k('fable') - 0.0144)).toBeLessThan(1e-12)
  expect(Math.abs(per1k('haiku') - 0.00018)).toBeLessThan(1e-12)
})

test('the ceiling holds every model but Fable, and code edits never go below Sonnet', () => {
  expect(tierOf('claude-opus-5-5')).toBe('opus')
  expect(tierOf('claude-fable-5-2')).toBe('fable')
  expect(capTier('opus', 'sonnet', 'parent')).toBe('sonnet')
  expect(capTier('opus', 'fable', 'sonnet')).toBe('sonnet')
  expect(capTier('fable', 'opus', 'opus')).toBe('fable')
  expect(floorTier('haiku', true)).toBe('sonnet')
  expect(floorTier('haiku', false)).toBe('haiku')
  expect(floorTier('opus', true)).toBe('opus')
})

test('Haiku answers {model, scope, why, edits}, read strictly', () => {
  expect(parseVerdict('{"model":"Sonnet","scope":"Code edits","why":"writes SQL","edits":true}')).toEqual({
    tier: 'sonnet',
    scope: 'Code edits',
    why: 'writes SQL',
    edits: true,
  })
  expect(parseVerdict('sure! {"model":"gpt"}')).toBeUndefined()
  expect(parseVerdict('no json')).toBeUndefined()
  expect(classifyPrompt({ type: 'a', description: 'b', prompt: 'x'.repeat(5000) }).length).toBeLessThan(5000)
  expect(classifyPrompt({ type: 'a', description: 'b', prompt: 'x' }, false)).not.toMatch(/fable/)
  expect(effective({ input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000 })).toEqual({ inTok: 200, outTok: 10 })
})

test('the router keeps no keyword fallback', () => {
  expect('fallbackVerdict' in router).toBe(false)
})

test('the Fable question names the agent, the reason and both prices', () => {
  expect(fableQuestion('schema-architect', 'redesigns storage across 3 services and touches auth', 30_000)).toBe(
    'schema-architect redesigns storage across 3 services and touches auth.\n' +
      'Haiku picked Fable 5.2 $0.43. Opus 5.5 would cost $0.22.',
  )
})

const entry = (chosen: RouterEntry['chosen'], isCancelled = false): RouterEntry => ({
  id: chosen,
  type: chosen,
  role: 'main',
  scope: '',
  why: '',
  chosen,
  baseline: 'fable',
  isHaiku: true,
  isCancelled,
  ...split(10_000),
  isMeasured: false,
})

test('totals ignore cancelled agents', () => {
  const t = totals([entry('haiku'), entry('fable', true)], 0)
  expect(t.agents).toBe(1)
  expect(t.cancelled).toBe(1)
  expect(Math.abs(t.baseline - 0.144)).toBeLessThan(1e-9)
  expect(Math.abs(t.spent - 0.0018)).toBeLessThan(1e-9)
})

test('the demo matches the design at each state', () => {
  const view = (k: number, pick: '' | 'fable' | 'opus' | 'cancel') => {
    const v = demoView(k, pick)
    const t = totals(v.entries, v.overhead)

    return { v, base: money(t.baseline), total: money(t.total), saved: money(t.saved), pct: t.pct, ovh: money(t.overhead) }
  }
  // Nothing reviewed yet: all five queued.
  expect(view(0, '').v.live.map(x => x.status)).toEqual(['queued', 'queued', 'queued', 'queued', 'queued'])

  // Reviewing code-reviewer (04).
  const r = view(9, '')
  expect(r.v.live.map(x => x.status)).toEqual(['reviewing', 'queued', 'queued'])
  expect([r.base, r.total, r.saved, r.pct, r.ovh]).toEqual(['$0.92', '$0.17', '$0.75', 82, '$0.001'])

  // Waiting for the OK on Fable (01, 05).
  const c = view(16, '')
  expect(c.v.live.map(x => x.status)).toEqual(['pending'])
  expect([c.base, c.total, c.saved, c.pct, c.ovh]).toEqual(['$1.45', '$0.33', '$1.12', 77, '$0.002'])

  // Fable confirmed (02): no saving on that row.
  const f = view(18, 'fable')
  expect(f.v.live).toHaveLength(0)
  expect(f.v.entries.map(x => x.chosen)).toEqual(['haiku', 'sonnet', 'opus', 'haiku', 'fable'])
  expect([f.base, f.total, f.saved, f.pct]).toEqual(['$1.89', '$0.76', '$1.12', 60])

  // Opus instead (06).
  const o = view(18, 'opus')
  expect([o.base, o.total, o.saved, o.pct]).toEqual(['$1.89', '$0.55', '$1.34', 71])

  // Cancelled: struck out, costs nothing.
  const x = view(18, 'cancel')
  expect(x.v.entries[4]?.isCancelled).toBe(true)
  expect([x.base, x.total]).toEqual(['$1.45', '$0.33'])
})

test('mascot, pips and chip follow light and dark', () => {
  for (const tier of ['haiku', 'sonnet', 'opus', 'fable'] as const) {
    expect(mascotSvg('explore', 'running', tier, 30)).toContain('prefers-color-scheme:dark')
    expect(chipSvg(tier, 'X')).toContain('prefers-color-scheme:dark')
  }
  expect(mascotSvg('tester', 'queued', 'dim', 24)).toContain('#e8c36a')
  expect(mascotSvg('main', 'failed', 'dim', 24)).toContain('M6 5l2 3')
  expect(mascotSvg('main', 'done', 'haiku', 24)).toContain('prefers-reduced-motion')
  expect(pipsSvg([{ fill: 'haiku', border: 'haiku' }, { fill: 'none', border: 'ring' }])).toContain('width="23"')
  expect(new Set(Object.values(TIER_KEY)).size).toBe(4)
})

// ----------------------------------------------------------------- hooks --

test('each agent gets the model Haiku picks for it', async ($, on) => {
  setup(on, '{"model":"haiku","scope":"Read-only search","why":"no edits","edits":false}')
  await start($)
  expect((await $.agent.spawn(SPAWN as any)).model).toBe('haiku')
})

test('Sonnet is the floor for an agent that edits code', async ($, on) => {
  setup(on, '{"model":"haiku","scope":"Code edits","why":"small change","edits":true}')
  await start($)
  expect((await $.agent.spawn({ ...SPAWN, subagentType: 'general-purpose' } as any)).model).toBe('sonnet')
})

test('when the router fails the agent keeps the session model', async ($, on) => {
  setup(on, undefined)
  await start($)
  expect((await $.agent.spawn(SPAWN as any)).model).toBe('session')
})

test('Fable always asks first: Use Fable 5.2, Use Opus 5.5 instead, Cancel this agent', async ($, on) => {
  const asked: string[] = []
  setup(on, '{"model":"fable","scope":"Architecture, auth","why":"touches auth","edits":false}', 'Use Opus 5.5 instead', asked)
  await start($)
  expect((await $.agent.spawn(SPAWN as any)).model).toBe('opus')
  expect(asked[0]).toMatch(/^find importers touches auth\.\nHaiku picked Fable 5\.2 \$0\.\d\d\. Opus 5\.5 would cost \$0\.\d\d\.$/)
})

test('Esc on the Fable question cancels the agent; with nobody to ask it runs on Opus', async ($, on) => {
  // An empty answer stands for a dismissed dialog.
  setup(on, '{"model":"fable","scope":"Architecture","why":"hard","edits":false}', '')
  await start($)
  expect((await $.agent.spawn(SPAWN as any)).deny).toMatch(/cancelled/)
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  expect((await $.agent.spawn({ ...SPAWN, tool_use_id: 't2' } as any)).model).toBe('opus')
})

test('the status line carries the saving, or the wait for an OK', () => {
  const t = totals([], 0)
  expect(router.statusLine({ ...t, saved: 1.12, pct: 60 }, false)).toBe('~$1.12 saved (60%)')
  expect(router.statusLine({ ...t, saved: -2.45, pct: -30 }, false)).toBe('costs ~$2.45 more (+30%)')
  expect(router.statusLine(t, true)).toBe('waiting for your OK')
})

test('Use Fable runs it on Fable, past the Opus ceiling', async ($, on) => {
  setup(on, '{"model":"fable","scope":"Architecture","why":"hard","edits":false}', 'Use Fable 5.2')
  await start($)
  expect((await $.agent.spawn(SPAWN as any)).model).toBe('fable')
})

test('Cancel this agent denies the spawn and strikes the row', async ($, on) => {
  setup(on, '{"model":"fable","scope":"Architecture","why":"hard","edits":false}', 'Cancel this agent')
  await start($)
  const r = await $.agent.spawn(SPAWN as any)
  expect(r.deny).toMatch(/cancelled/)
  const ui = await $.ui.mount(band('desktop'))
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: 'find importers' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Fable 5\.2 ×1/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^1 routed$/ })).toBeDefined()
  await ui.unmount()
})

test('an agent routed to a cheap model is not asked about', async ($, on) => {
  const asked: string[] = []
  setup(on, '{"model":"haiku","scope":"Read-only search","why":"lookup","edits":false}', 'Use Opus', asked)
  await start($)
  await $.agent.spawn(SPAWN as any)
  expect(asked).toHaveLength(0)
})

test('the band shows the router row, then the list and review switch, on every rich surface', async ($, on) => {
  setup(on, '{"model":"haiku","scope":"Read-only search","why":"no edits","edits":false}')
  await start($)
  await $.agent.spawn(SPAWN as any)

  for (const surface of SURFACES.filter(s => s !== 'terminal')) {
    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ type: 'Text', text: 'Router' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1 routed$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Haiku 5\.5 ×1/ })).toBeUndefined()
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /Haiku 5\.5 ×1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /−99%/ })).toBeDefined()
    for (const id of ['cap', 'save', 'strong']) expect(await ui.find({ type: 'Button', key: `usage-${id}` })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'mode-prompt' })).toBeUndefined()
    await ui.press({ key: 'toggle' })
    await ui.unmount()
  }
})

test('the terminal band is the design/cli panel: rule, header, rows, summary, footer', async ($, on) => {
  setup(on, '{"model":"haiku","scope":"Read-only search","why":"no edits","edits":false}')
  await start($)
  await $.agent.spawn(SPAWN as any)
  const ui = await $.ui.mount(band('terminal', 92))
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ type: 'Text', text: /^─+$/ }))?.text).toHaveLength(92)
  expect(await ui.find({ type: 'Text', text: 'Subagent Router' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}1 routed$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /saved {2}$/ }))?.text).toMatch(/^~\$0\.\d\d saved {2}$/)
  expect(await ui.find({ type: 'Text', text: 'Explore' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Haiku 5.5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'read-only search' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '−99%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Fable-only \$0\.\d\d → router \$0\.\d+ {3}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^saved ~\$0\.\d\d \(\d+%\)$/ })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'mode' }))?.text).toBe('Every spawn')
  expect(await ui.find({ type: 'Text', text: ' · Fable asks first · Sonnet floor for code edits' })).toBeDefined()
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▸')
  expect(await ui.find({ type: 'Text', text: 'Explore' })).toBeUndefined()
  await ui.unmount()
})

test('the band starts collapsed and the chevron opens the list', async ($, on) => {
  setup(on, '{"model":"haiku","scope":"Read-only search","why":"no edits","edits":false}')
  await start($)
  await $.agent.spawn(SPAWN as any)
  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▾')
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▴')
  expect(await ui.find({ type: 'Button', key: 'mode-prompt' })).toBeUndefined()
  await ui.unmount()
})

test('a narrow band drops the reason and keeps the chip and price', async ($, on) => {
  setup(on, '{"model":"haiku","scope":"Read-only search","why":"no edits","edits":false}')
  await start($)
  await $.agent.spawn(SPAWN as any)
  let ui = await $.ui.mount(band('terminal', 66))
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: 'read-only search' })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(band('terminal', 50))
  expect(await ui.find({ type: 'Text', text: /read-only search/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Haiku 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\$0\.00\d$/ })).toBeDefined()
  await ui.unmount()
})

test('the review-mode switch sets the mode', async ($, on) => {
  setup(on, '{"model":"haiku","scope":"Read-only search","why":"no edits","edits":false}')
  await start($)
  await $.agent.spawn(SPAWN as any)
  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'toggle' })
  await ui.press({ key: 'mode' })
  await ui.press({ key: 'mode' })
  expect((await ui.find({ type: 'Button', key: 'mode' }))?.text).toBe('Session')
  await ui.unmount()
  expect((await $.command.run({ ...COMMAND, args: 'status' } as any)).text).toMatch(/on \(session\)/)
})

test('/router demo plays to the Fable question, then to Fable confirmed', async ($, on) => {
  const asked: string[] = []
  const clock = setup(on, undefined, 'Use Fable 5.2', asked)
  await start($)
  await $.command.run({ ...COMMAND, args: 'demo' } as any)

  await clock.advance(4_500)
  let ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: /Reviewing code-reviewer…/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(5_000)
  expect(asked[0]).toBe(
    'schema-architect redesigns storage across 3 services and touches auth.\n' +
      'Haiku picked Fable 5.2 $0.43. Opus 5.5 would cost $0.22.',
  )
  ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: /^5 routed$/ })).toBeDefined()
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /Fable 5\.2 ×1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'no change' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeDefined()
  await ui.unmount()

  await clock.advance(40_000)
  ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: 'Router' })).toBeUndefined()
  await ui.unmount()
})

test('the inline switch sets Save, Strong or Cap, and /router mode agrees', async ($, on) => {
  setup(on, '{"model":"haiku","scope":"Read-only search","why":"no edits","edits":false}')
  await start($)
  await $.agent.spawn(SPAWN as any)
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: /^Mode: Cap$/ })).toBeDefined()
  await ui.press({ key: 'toggle' })
  await ui.press({ key: 'usage-strong' })
  expect(await ui.find({ type: 'Text', text: /^Mode: Strong$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /One tier up for every agent/ })).toBeDefined()
  await ui.unmount()
  await $.command.run({ ...COMMAND, args: 'mode save' } as any)
  const again = await $.ui.mount(band('desktop'))
  expect(await again.find({ type: 'Text', text: /^Mode: Save$/ })).toBeDefined()
  await again.unmount()
})

test('Show and Hide work while a Fable question waits: auto shows only the pending row, Show lists everyone', async ($, on) => {
  const clock = setup(on, undefined, 'Use Fable 5.2')
  await start($)
  await $.command.run({ ...COMMAND, args: 'demo' } as any)
  await clock.advance(9_000)
  const ui = await $.ui.mount(band('desktop'))
  const first = (await ui.find({ type: 'Button', key: 'toggle' }))?.text
  expect(['▾', '▴']).toContain(first)
  await ui.press({ key: 'toggle' })
  const second = (await ui.find({ type: 'Button', key: 'toggle' }))?.text
  expect(second).not.toBe(first)
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.text).toBe(first)
  await ui.unmount()
})
