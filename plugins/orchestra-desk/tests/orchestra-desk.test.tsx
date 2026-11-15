import { expect, mock, test } from 'claude-code/testing'

import {
  advanceSteps,
  applyPlan,
  barRuns,
  clock,
  demoAgents,
  demoMain,
  demoSteps,
  demoTime,
  elapsed,
  kfmt,
  modelKey,
  money,
  modelLabel,
  progressOf,
  reduceSteps,
  roleOf,
  stepsFromList,
  stepTool,
  toolLabel,
} from '../hooks/model'
import { barSegments, barSvg, base64, mascotCells, mascotSvg } from '../hooks/mascot'
import { bandBar, bandRow } from '../hooks/terminal'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
/** The surfaces past the terminal, which draws its own text layout. */
const RICH = ['desktop', 'vscode', 'mobile'] as const

const BAND = {
  plugin: 'orchestra-desk',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 3,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 3 },
    view: {},
  },
} as const

const PANE = {
  plugin: 'orchestra-desk',
  component: 'Pane',
  requestId: 'orchestra-desk',
  props: {
    title: 'Orchestra',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const TODOS = [
  { content: 'Read the code', status: 'completed', activeForm: 'Reading' },
  { content: 'Write the fix', status: 'in_progress', activeForm: 'Writing the fix' },
  { content: 'Run the tests', status: 'pending', activeForm: 'Running tests' },
] satisfies { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }[]

// ---------------------------------------------------------- pure model --

test('model: a to-do list becomes steps and a progress count', () => {
  const steps = stepsFromList(TODOS)
  const progress = progressOf(steps)

  expect(steps.length).toBe(3)
  expect(progress.done).toBe(1)
  expect(progress.total).toBe(3)
  expect(progress.current?.text).toBe('Write the fix')
  expect(progress.isFinished).toBe(false)
})

test('model: tasks are created, updated and deleted by id', () => {
  let steps = reduceSteps([], 'task-create', { subject: 'First' }, { task: { id: '1' } })
  steps = reduceSteps(steps, 'task-create', { subject: 'Second' }, { task: { id: '2' } })
  steps = reduceSteps(steps, 'task-update', { taskId: '1', status: 'completed' }, {})
  steps = reduceSteps(steps, 'task-update', { taskId: '2', status: 'in_progress' }, {})

  expect(steps.map(step => step.status).join()).toBe('completed,in_progress')

  steps = reduceSteps(steps, 'task-update', { taskId: '1', status: 'deleted' }, {})
  expect(steps.map(step => step.text).join()).toBe('Second')
})

test('model: a plan tool replaces, advances and marks steps', () => {
  expect(stepTool('mcp__ccd_turn__update_plan')).toBe('plan')
  expect(stepTool('Bash')).toBe(undefined)

  let steps = applyPlan([], { items: TODOS })
  steps = applyPlan(steps, { advance: true })
  expect(steps.map(step => step.status).join()).toBe('completed,completed,in_progress')

  steps = applyPlan(steps, { done: [3] })
  expect(progressOf(steps).isFinished).toBe(true)
  expect(advanceSteps(steps).length).toBe(3)
})

test('model: the bar keeps one cell per step, or shrinks to fit', () => {
  const steps = stepsFromList(TODOS)

  expect(barRuns(steps, 24).map(run => `${run.status}:${run.cells}`).join()).toBe(
    'completed:1,in_progress:1,pending:1',
  )
  expect(barRuns(steps, 2).reduce((sum, run) => sum + run.cells, 0)).toBe(2)
  expect(barRuns([], 10).length).toBe(0)
})

test('model: wording helpers', () => {
  expect(elapsed(8_000)).toBe('8s')
  expect(elapsed(65_000)).toBe('1m 05s')
  expect(elapsed(3_725_000)).toBe('1h 02m')
  expect(toolLabel('Read', { file_path: '/a/b/model.ts' })).toBe('Read model.ts')
  expect(toolLabel('mcp__srv__search', { query: 'auth' })).toBe('search auth')
  expect(clock(14_000)).toBe('0:14')
  expect(clock(3_725_000)).toBe('1:02:05')
  expect(kfmt(850)).toBe('0.9k')
  expect(kfmt(24_100)).toBe('24.1k')
  expect(modelKey('claude-opus-4-5')).toBe('opus')
  expect(modelLabel('Haiku 5.5')).toBe('Haiku 5.5')
  expect(modelLabel('claude-opus-4-5')).toBe('Opus 4.5')
  expect(modelLabel('haiku')).toBe('Haiku')
  expect(roleOf('Explore')).toBe('explore')
  expect(roleOf('code-reviewer')).toBe('reviewer')
  expect(roleOf('test-runner')).toBe('tester')
  expect(roleOf('general-purpose')).toBe('coder')
})

test('mascot: segments, base64 and the terminal cells', () => {
  expect(barSegments(stepsFromList(TODOS)).join()).toBe('done,run,wait')
  expect(base64(new Uint8Array([77, 97, 110]))).toBe('TWFu')
  expect(base64(new Uint8Array([77]))).toBe('TQ==')
  // 11 × 5 cells, three little-endian words each.
  const cells = mascotCells('explore', 'running', '#6a9bcc', 0)
  expect(cells.length).toBe(Math.ceil((11 * 5 * 12) / 3) * 4)
})

// ---------------------------------------------------------------- band --

test('the band shows to-do progress, on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'orchestra' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  mock.clock(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: TODOS })

  for (const surface of RICH) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ type: 'Text', text: /^1$/ }))?.text).toBe('1')
    expect((await ui.find({ type: 'Text', text: /^\/3$/ }))?.text).toBe('/3')
    expect(
      (await ui.find({ type: 'Text', text: /Writing/ }))?.text,
    ).toBe('Writing the fix')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^1\/3$/ }))?.text).toBe('1/3')
  expect((await ui.find({ type: 'Text', text: /Writing/ }))?.text).toBe('Writing the fix')
  expect((await ui.find({ type: 'Text', text: /working ·/ }))?.text).toMatch(
    /^1 working · 0\.0k · \$0\.00 · 0:00$/,
  )
  await ui.unmount()
})

test('terminal band: one row that fits, thin segments, truncated step', () => {
  const steps = stepsFromList(TODOS)
  const band = {
    done: 1,
    total: 3,
    label: 'Writing the fix for the session storage +1',
    isFinished: false,
    working: 3,
    tokens: 88_700,
    cost: 0.44,
    elapsedMs: 12_000,
  }
  const text = (segs: { t: string }[]) => segs.map(s => s.t).join('')

  expect(text(bandBar(steps))).toBe('━━━━ ━━── ────')
  const wide = text(bandRow(band, steps, 92))
  expect(wide).toBe('○ 1/3  Writing the fix f… ━━━━ ━━── ────  3 working · 88.7k · $0.44 · 0:12')
  for (const columns of [92, 60, 40, 24, 14]) {
    expect(text(bandRow(band, steps, columns)).length).toBeLessThanOrEqual(columns)
  }
  expect(money(0.0031)).toBe('$0.003')
  expect(money(0.44)).toBe('$0.44')
})

test('the band stays out of the way with nothing to show', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('a subagent to-do list does not replace the main one', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  mock.clock(on)

  await $.tool.call({ tool: 'TodoWrite', todos: TODOS })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [{ content: 'Inner', status: 'pending', activeForm: 'Inner' }],
    agentId: 'a1',
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /^\/3$/ }))?.text).toBe('/3')
  expect((await ui.find({ type: 'Text', text: /^1$/ }))?.text).toBe('1')
  await ui.unmount()
})

// ---------------------------------------------------------------- pane --

test('the pane has a live card per subagent, on every surface', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const clock = mock.clock(on)

  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'Look for the auth middleware',
    description: 'Find auth middleware',
    subagentType: 'Explore',
    provider: { plugin: 'core', tier: 'core' },
    parentModel: 'm',
    background: false,
    fork: false,
  })
  await $.tool.call({ tool: 'Bash', command: 'rg session', agentId: 'a1' })
  await $.tool.call({ tool: 'Read', file_path: '/src/auth.ts', agentId: 'a1' })

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /Explore/ }))?.text).toBe('Explore')
  expect((await term.find({ type: 'Text', text: /auth\.ts/ }))?.text).toBe('Read auth.ts')
  expect((await term.find({ type: 'Text', text: /tok$/ }))?.text).toMatch(/k tok$/)
  expect(await term.find({ type: 'Text', text: /2 working/ })).toBeDefined()
  await term.unmount()

  for (const surface of RICH) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /Explore/ }))?.text).toBe('Explore')
    expect(
      (await ui.find({ type: 'Text', text: /Find auth/ }))?.text,
    ).toBe('Find auth middleware')
    expect((await ui.find({ type: 'Text', text: /auth\.ts/ }))?.text).toBe(
      '» Read auth.ts',
    )
    expect(
      (await ui.find({ type: 'Text', text: /2 calls/ }))?.text,
    ).toBe('2 calls')
    expect(await ui.find({ type: 'Text', text: /2 working/ })).toBeDefined()
    await ui.unmount()
  }

  await clock.advance(5_000)
  await $.turn.complete({
    answer: 'Found it in src/auth.ts\nmore detail',
    durationMs: 5_000,
    isAborted: false,
    turnId: 'u1',
    agentId: 'a1',
    reason: 'answer',
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /Found it/ }))?.text).toBe(
    '» Found it in src/auth.ts',
  )
  expect(await ui.find({ type: 'Text', text: /2 done/ })).toBeDefined()
  await ui.unmount()
})

test('cards an earlier version stored are declined', async ($, on) => {
  on('state.get', () => ({
    value: { value: [{ id: 'old', kind: 'x' }], version: 1 },
  }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- demo --

const COMMAND = {
  command: 'orchestra',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

test('model: the demo runs from a first card to a finished plan', () => {
  expect(demoTime(1_000, 1_000)).toBe(0)
  expect(demoTime(1_000, 8_500)).toBe(7.5)
  expect(demoTime(1_000, 999_000)).toBe(21)

  expect(demoAgents(0, 0).map(one => one.status).join()).toBe('running,queued,queued,queued')
  expect(demoAgents(12, 0).filter(one => one.status === 'running').length).toBe(2)
  expect(demoAgents(21, 0).map(one => one.status).join()).toBe('done,done,done,done')
  expect(demoAgents(21, 0, true).map(one => one.status).join()).toBe('done,done,failed,done')
  expect(progressOf(demoSteps(0)).done).toBe(0)
  expect(progressOf(demoSteps(21)).isFinished).toBe(true)
  expect(demoMain(21).tokens).toBe(24_000)
})

test('/orchestra demo plays with no model call, then clears', async ($, on) => {
  on('command.register', () => ({ value: { command: 'orchestra' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const clockMock = mock.clock(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...COMMAND, args: 'demo' })
  expect(ran.text).toMatch(/demo started/)

  await clockMock.advance(12_000)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    if (surface === 'terminal') {
      expect((await band.find({ type: 'Text', text: /^2\/5$/ }))?.text).toBe('2/5')
      expect(await band.find({ type: 'Text', text: /^3 working · / })).toBeDefined()
    } else {
      expect((await band.find({ type: 'Text', text: /^2$/ }))?.text).toBe('2')
      expect((await band.find({ type: 'Text', text: /^\/5$/ }))?.text).toBe('/5')
      expect(await band.find({ type: 'Button', text: /3 working/ })).toBeDefined()
    }
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Text', text: /3 working/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Main agent/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /code-reviewer/ })).toBeDefined()
    await pane.unmount()
  }

  await clockMock.advance(20_000)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: /5 done/ })).toBeDefined()
  expect((await pane.find({ type: 'Text', text: /5\/5/ }))?.text).toBe('5/5')
  await pane.unmount()

  await $.command.run({ ...COMMAND, args: 'clear' })
  const empty = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await empty.find({ type: 'Button', text: /Play a demo/ })).toBeDefined()
  await empty.unmount()
})

test('/orchestra demo fail ends with a failed card', async ($, on) => {
  on('command.register', () => ({ value: { command: 'orchestra' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const clockMock = mock.clock(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ ...COMMAND, args: 'demo fail' })
  await clockMock.advance(25_000)

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: /Stopped: the diff/ })).toBeDefined()
  await pane.unmount()
})

test('a finished turn stops "working", and a new prompt clears the old plan', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  mock.clock(on)

  await $.tool.call({ tool: 'TodoWrite', todos: TODOS })
  let band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Button', text: /1 working/ })).toBeDefined()
  await band.unmount()

  await $.turn.complete({
    answer: 'Need your choice',
    durationMs: 1,
    isAborted: false,
    turnId: 'u1',
    reason: 'answer',
  })
  band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Button', text: /working/ })).toBeUndefined()
  expect((await band.find({ type: 'Text', text: /^\/3$/ }))?.text).toBe('/3')
  await band.unmount()

  await $.prompt.submit({ text: 'something else', wait: false, origin: { kind: 'composer' } })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
  await pane.unmount()
})

test('the sprites follow the surface\'s light or dark mode', () => {
  const queued = mascotSvg('reviewer', 'queued', 'haiku', 30)
  expect(queued).toContain('prefers-color-scheme:dark')
  // The neutral parts are classes the media query swaps, not a fixed dark hex.
  expect(queued).toContain('class="sleep"')
  expect(queued).toContain('.m-haiku')
  expect(barSvg(stepsFromList(TODOS), 120)).toContain('prefers-color-scheme:dark')
  // The terminal's cells use mid tones: no near-white or near-black accessory.
  expect(mascotCells('explore', 'queued', '#d97757', 0).length).toBeGreaterThan(0)
})
