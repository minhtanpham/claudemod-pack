import { atom, read, update } from 'claude-code';
import { ASSUMED, capTier, classifyPrompt, effective, fableWarning, fallbackVerdict, parseVerdict, report, tierOf, totals, usd, } from './router';
// Change a tag when the value's fields change: it declines what an earlier
// version stored, which outlives a hot reload.
const ledger = atom({ plugin: 'model-router', key: 'ledger' }, [], {
    shape: 'ledger-1',
});
const overhead = atom({ plugin: 'model-router', key: 'overhead' }, { calls: 0, inTok: 0, outTok: 0, failed: 0 }, { shape: 'overhead-1' });
const isOff = atom({ plugin: 'model-router', key: 'isOff' }, false, {
    shape: 'off-1',
});
const MAX_LEDGER = 500;
const PROCEED = 'Proceed on Fable';
const DOWNGRADE = 'Use Opus instead';
const CANCEL = 'Cancel agent';
export const register = (on, options) => {
    const o = options;
    const ceiling = (o.ceiling ?? 'opus');
    const respectExplicit = o.respectExplicit === true;
    const showNotice = o.showNotice !== false;
    const allowFable = o.allowFable === true;
    on('session.start', async ($, e, next) => {
        await $.command.register({
            name: 'router',
            description: 'Model router: "status" shows the estimated savings, "off" / "on" pauses it, "reset" clears the tally',
        });
        return next(e);
    });
    on('agent.spawn', async ($, e, next) => {
        // A fork inherits the parent's model; a resume continues its own run.
        if (e.fork || e.resume || (await read($, isOff)))
            return next(e);
        const explicit = e.model ? tierOf(e.model) : undefined;
        if (respectExplicit && e.model && explicit !== 'fable')
            return next(e);
        const parent = tierOf(e.parentModel);
        const task = { type: e.subagentType, description: e.description, prompt: e.prompt };
        let chosen;
        let why;
        let isHaiku = false;
        if (explicit === 'fable') {
            // A call that names Fable is deliberate: it is asked about, not overridden.
            chosen = 'fable';
            why = 'named by the Agent call';
        }
        else {
            let verdict = fallbackVerdict(task);
            let spent;
            try {
                const r = await $.model.complete({
                    model: 'haiku',
                    prompt: classifyPrompt(task, allowFable),
                    maxTokens: 80,
                    effort: 'low',
                    timeoutMs: 8000,
                });
                if (r.isAnswered) {
                    spent = { inTok: r.usage.input_tokens, outTok: r.usage.output_tokens };
                    const v = parseVerdict(r.text);
                    if (v) {
                        verdict = v;
                        isHaiku = true;
                    }
                }
            }
            catch {
                // Haiku unreachable: the keyword fallback stands.
            }
            await update($, overhead, (x) => ({
                calls: x.calls + 1,
                inTok: x.inTok + (spent?.inTok ?? 0),
                outTok: x.outTok + (spent?.outTok ?? 0),
                failed: x.failed + (isHaiku ? 0 : 1),
            }));
            chosen = capTier(verdict.tier, parent, ceiling);
            if (chosen === 'fable' && !allowFable)
                chosen = 'opus';
            why = verdict.why;
        }
        if (chosen === 'fable') {
            let answer = DOWNGRADE;
            try {
                answer = await $.ui.ask(fableWarning(task), {
                    options: [PROCEED, DOWNGRADE, CANCEL],
                    header: 'Fable',
                });
            }
            catch {
                // Nobody to ask (a -p run, a dismissed dialog): the cheaper model.
            }
            if (answer === CANCEL) {
                return { deny: 'model-router: agent cancelled, it would have run on Fable.' };
            }
            if (answer !== PROCEED) {
                chosen = 'opus';
                why = 'Fable declined';
            }
            else {
                why = `${why}; Fable confirmed`;
            }
        }
        const entryId = `spawn:${e.tool_use_id}`;
        await update($, ledger, (l) => [
            ...l,
            {
                id: entryId,
                type: e.subagentType,
                chosen,
                baseline: parent,
                why,
                isHaiku,
                inTok: ASSUMED.inTok,
                outTok: ASSUMED.outTok,
                isMeasured: false,
            },
        ].slice(-MAX_LEDGER));
        if (showNotice) {
            try {
                $.ui.notice(e.tool_use_id, `model-router: ${chosen}${why ? ` (${why})` : ''}`);
            }
            catch {
                // A note is a courtesy.
            }
        }
        const started = await next({ ...e, model: chosen });
        // Join the entry to the id the subagent's own turn.complete will carry.
        if (!started.deny && started.agentId) {
            const id = started.agentId;
            await update($, ledger, (l) => l.map(x => (x.id === entryId ? { ...x, id } : x)));
        }
        const t = totals(await read($, ledger), await read($, overhead));
        $.ui.status(`router: ~${usd(t.saved)} saved`);
        return started;
    }).catch(($, e, next) => next(e));
    // A finished subagent replaces the assumed tokens with its real usage.
    on('turn.complete', async ($, e, next) => {
        try {
            const used = e.agentId ? effective(e.usage) : undefined;
            if (e.agentId && used) {
                const id = e.agentId;
                await update($, ledger, (l) => l.map(x => (x.id === id ? { ...x, ...used, isMeasured: true } : x)));
                const t = totals(await read($, ledger), await read($, overhead));
                $.ui.status(`router: ~${usd(t.saved)} saved`);
            }
        }
        catch {
            // Bookkeeping never blocks a turn.
        }
        return next(e);
    });
    on('command.run', { command: 'router' }, async ($, e) => {
        const word = e.args.trim().toLowerCase();
        if (word === 'off' || word === 'on') {
            await update($, isOff, () => word === 'off');
            return { text: `model-router ${word}.` };
        }
        if (word === 'reset') {
            await update($, ledger, () => []);
            await update($, overhead, () => ({ calls: 0, inTok: 0, outTok: 0, failed: 0 }));
            $.ui.status(undefined);
            return { text: 'model-router tally cleared.' };
        }
        const o2 = await read($, overhead);
        const t = totals(await read($, ledger), o2);
        return { text: report(t, o2, await read($, isOff)) };
    });
};
