import { expect, mock, test } from 'claude-code/testing'

import {
  advanceSteps,
  applyPlan,
  barRuns,
  elapsed,
  progressOf,
  reduceSteps,
  stepsFromList,
  stepTool,
  toolLabel,
} from '../hooks/model'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

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
})

// ---------------------------------------------------------------- band --

test('the band shows to-do progress, on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'orchestra' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  mock.clock(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: TODOS })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ type: 'Text', text: /1\/3/ }))?.text).toBe('1/3')
    expect(
      (await ui.find({ type: 'Text', text: /Writing/ }))?.text,
    ).toBe('Writing the fix')
    await ui.unmount()
  }
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

  expect((await ui.find({ type: 'Text', text: /\/3/ }))?.text).toBe('1/3')
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

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /Explore/ }))?.text).toBe('Explore')
    expect(
      (await ui.find({ type: 'Text', text: /Find auth/ }))?.text,
    ).toBe('Find auth middleware')
    expect((await ui.find({ type: 'Text', text: /auth\.ts/ }))?.text).toBe(
      '↳ Read auth.ts',
    )
    expect(
      (await ui.find({ type: 'Text', text: /tool call/ }))?.text,
    ).toBe('2 tool calls')
    expect(await ui.find({ type: 'Text', text: /1 running/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /1 finished/ })).toBeDefined()

  await ui.press({ key: 'clear' })
  expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
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
