import { expect, test } from 'claude-code/testing';
import { capTier, classifyPrompt, cost, effective, fableWarning, fallbackVerdict, parseVerdict, tierOf, totals, } from '../hooks/router';
const SPAWN = {
    tool_use_id: 't1',
    prompt: 'Find every file that imports the config loader and list them.',
    description: 'find importers',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
};
function setup(on, verdict, asked = []) {
    on('command.register', () => ({ value: { command: 'router' } }));
    on('session.start', (_, e) => ({ cwd: e.cwd }));
    on('model.complete', () => ({
        value: { isAnswered: true, text: verdict, usage: { input_tokens: 1000, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }));
    on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
        const q = e.questions[0].question;
        asked.push(q);
        return { result: { questions: e.questions, answers: { [q]: 'Use Opus instead' } } };
    });
    // The engine beneath: starts the agent on the model it was handed.
    on('agent.spawn', (_, e) => ({ model: e.model ?? 'opus', agentId: 'a1' }));
}
test('tiers and the ceiling', () => {
    expect(tierOf('claude-opus-5-5')).toBe('opus');
    expect(tierOf('claude-fable-5-2')).toBe('fable');
    expect(capTier('opus', 'sonnet', 'parent')).toBe('sonnet');
    expect(capTier('opus', 'sonnet', 'opus')).toBe('opus');
    expect(capTier('fable', 'opus', 'opus')).toBe('opus');
});
test('Haiku verdicts are read strictly', () => {
    expect(parseVerdict('{"model":"Sonnet","why":"tests"}')).toEqual({ tier: 'sonnet', why: 'tests' });
    expect(parseVerdict('sure! {"model":"gpt"}')).toBeUndefined();
    expect(parseVerdict('no json')).toBeUndefined();
});
test('the fallback uses the agent type and words', () => {
    const t = { type: 'Explore', description: '', prompt: 'x' };
    expect(fallbackVerdict(t).tier).toBe('haiku');
    expect(fallbackVerdict({ ...t, type: 'general-purpose', prompt: 'review the security of auth' }).tier).toBe('opus');
    expect(fallbackVerdict({ ...t, type: 'general-purpose', prompt: 'add a button' }).tier).toBe('sonnet');
});
test('the saving is the unrouted cost minus the routed cost and the router', () => {
    const e = (chosen) => ({
        id: 'a', type: 't', chosen, baseline: 'opus', why: '', isHaiku: true,
        inTok: 20000, outTok: 3000, isMeasured: true,
    });
    const t = totals([e('haiku'), e('opus')], { calls: 2, inTok: 2000, outTok: 40, failed: 0 });
    expect(Math.abs(t.baseline - cost('opus', 20000, 3000) * 2)).toBeLessThan(1e-9);
    expect(Math.abs(t.saved - (cost('opus', 20000, 3000) - cost('haiku', 20000, 3000) - cost('haiku', 2000, 40)))).toBeLessThan(1e-9);
    expect(t.saved).toBeGreaterThan(0.1);
    expect(effective({ input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000 })).toEqual({ inTok: 200, outTok: 10 });
    expect(classifyPrompt({ type: 'a', description: 'b', prompt: 'x'.repeat(5000) }).length).toBeLessThan(4000);
    expect(fableWarning({ type: 'a', description: 'big' })).toMatch(/Fable.*2x Opus/);
});
test('each agent gets the model Haiku picks for it', async ($, on) => {
    setup(on, '{"model":"sonnet","why":"ordinary fix"}');
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true });
    const a = await $.agent.spawn(SPAWN);
    expect(a.model).toBe('sonnet');
});
test('another task gets another model', async ($, on) => {
    setup(on, '{"model":"opus","why":"design"}');
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true });
    expect((await $.agent.spawn(SPAWN)).model).toBe('opus');
});
test('an agent named for Fable is warned about, and declined falls to Opus', async ($, on) => {
    const asked = [];
    setup(on, '{"model":"haiku","why":"x"}', asked);
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true });
    const a = await $.agent.spawn({ ...SPAWN, model: 'fable' });
    expect(asked.length).toBe(1);
    expect(asked[0]).toMatch(/Fable/);
    expect(a.model).toBe('opus');
});
test('an agent Haiku routes to a cheap model is not warned about', async ($, on) => {
    const asked = [];
    setup(on, '{"model":"haiku","why":"lookup"}', asked);
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true });
    expect((await $.agent.spawn(SPAWN)).model).toBe('haiku');
    expect(asked.length).toBe(0);
});
