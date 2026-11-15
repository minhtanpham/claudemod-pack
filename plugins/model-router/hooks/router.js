export const TIERS = ['haiku', 'sonnet', 'opus', 'fable'];
/**
 * USD per million tokens, from platform.claude.com/docs/en/about-claude/pricing
 * (checked 2026-11-16): Haiku 5.5 up to 100k-token prompts, Sonnet 5.5, Opus 5.5,
 * Fable 5.2. Prices change: update here.
 */
export const PRICE = {
    haiku: { in: 0.1, out: 0.5 },
    sonnet: { in: 2, out: 10 },
    opus: { in: 4, out: 20 },
    fable: { in: 8, out: 40 },
};
/** What one subagent is assumed to use before its real usage is known. */
export const ASSUMED = { inTok: 20000, outTok: 3000 };
export const rank = (t) => TIERS.indexOf(t);
/** The tier a model id or alias belongs to; an unknown one counts as opus. */
export function tierOf(model) {
    const m = (model ?? '').toLowerCase();
    for (const t of TIERS)
        if (m.includes(t))
            return t;
    return 'opus';
}
export function capTier(want, parent, ceiling) {
    const top = ceiling === 'parent' ? parent : ceiling;
    return rank(want) > rank(top) ? top : want;
}
/** The warning shown before an agent runs on Fable. */
export function fableWarning(a) {
    const x = (PRICE.fable.out / PRICE.opus.out).toFixed(0);
    const h = Math.round(PRICE.fable.out / PRICE.haiku.out);
    return `Agent "${a.description || a.type}" is about to run on Fable: ${x}x Opus and ${h}x Haiku per output token ($${PRICE.fable.in} in / $${PRICE.fable.out} out per MTok). Run it on Fable?`;
}
const RUBRIC = `You choose which Claude model should run ONE subagent, judging only that agent's task. Different agents of the same session may get different models. Reply with ONE line of JSON and nothing else: {"model":"haiku"|"sonnet"|"opus","why":"<8 words>"}.
haiku: read-only search or exploration, listing, grepping, summarizing, reformatting, running commands and reporting output, mechanical or boilerplate edits.
sonnet: ordinary implementation, a bug fix in code that is already located, writing tests, a moderate refactor, reviewing a small diff.
opus: architecture or design, ambiguous or cross-cutting debugging, large refactors, security review, long multi-step planning.
When unsure between two, pick the cheaper one only if a wrong answer is easy to spot and redo.`;
const RUBRIC_FABLE = `${RUBRIC.replace('"opus",', '"opus"|"fable",')}
fable: only the hardest, longest-horizon reasoning where opus would likely fail; rare.`;
/** The prompt Haiku classifies: the task, trimmed to its start and end. */
export function classifyPrompt(a, isFableAllowed = false) {
    const p = a.prompt.length > 3000
        ? `${a.prompt.slice(0, 2000)}\n...\n${a.prompt.slice(-900)}`
        : a.prompt;
    return `${isFableAllowed ? RUBRIC_FABLE : RUBRIC}\n\nAgent type: ${a.type}\nTask title: ${a.description}\nTask:\n${p}`;
}
/** Reads Haiku's reply; undefined when it is not the asked-for JSON. */
export function parseVerdict(text) {
    const m = /\{[^{}]*\}/.exec(text);
    if (!m)
        return undefined;
    try {
        const v = JSON.parse(m[0]);
        const t = typeof v.model === 'string' ? v.model.toLowerCase() : '';
        if (t !== 'haiku' && t !== 'sonnet' && t !== 'opus' && t !== 'fable')
            return undefined;
        return { tier: t, why: typeof v.why === 'string' ? v.why.slice(0, 80) : '' };
    }
    catch {
        return undefined;
    }
}
const HEAVY = /\b(architect|design|security|vulnerab|threat|migrat|refactor (the|all|every)|root cause|race condition|deadlock|plan)\b/i;
const LIGHT = /\b(find|search|grep|list|locate|read|summari[sz]e|explore|where is|which files|count|run (the )?tests?|report)\b/i;
/** When Haiku cannot answer: the agent type, then the task's own words. */
export function fallbackVerdict(a) {
    if (/^(explore|claude-code-guide|code-search)$/i.test(a.type)) {
        return { tier: 'haiku', why: 'fallback: read-only agent type' };
    }
    const text = `${a.description} ${a.prompt.slice(0, 600)}`;
    if (HEAVY.test(text))
        return { tier: 'opus', why: 'fallback: design or risk words' };
    if (LIGHT.test(text) && a.prompt.length < 1500) {
        return { tier: 'haiku', why: 'fallback: lookup words' };
    }
    return { tier: 'sonnet', why: 'fallback: ordinary task' };
}
/** Input tokens priced as plain input: a cache write costs 1.25x, a read 0.1x. */
export function effective(u) {
    if (!u)
        return undefined;
    const inTok = (u.input_tokens ?? 0) +
        1.25 * (u.cache_creation_input_tokens ?? 0) +
        0.1 * (u.cache_read_input_tokens ?? 0);
    const outTok = u.output_tokens ?? 0;
    return inTok + outTok > 0 ? { inTok, outTok } : undefined;
}
export const cost = (t, inTok, outTok) => (inTok * PRICE[t].in + outTok * PRICE[t].out) / 1000000;
/** The ledger's totals: what ran, what it would have cost unrouted, the router's own cost. */
export function totals(ledger, o) {
    const byTier = { haiku: 0, sonnet: 0, opus: 0, fable: 0 };
    let spent = 0;
    let baseline = 0;
    let measured = 0;
    for (const e of ledger) {
        byTier[e.chosen]++;
        spent += cost(e.chosen, e.inTok, e.outTok);
        baseline += cost(e.baseline, e.inTok, e.outTok);
        if (e.isMeasured)
            measured++;
    }
    const overhead = cost('haiku', o.inTok, o.outTok);
    const saved = baseline - spent - overhead;
    return {
        agents: ledger.length,
        measured,
        spent,
        baseline,
        overhead,
        saved,
        pct: baseline > 0 ? (saved / baseline) * 100 : 0,
        byTier,
    };
}
export const usd = (n) => Math.abs(n) >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(n === 0 ? 2 : 4)}`;
/** The text `/router status` answers. */
export function report(t, o, isOff) {
    const state = isOff ? 'off' : 'on';
    if (t.agents === 0)
        return `model-router is ${state}. No subagent routed yet.`;
    const mix = ['haiku', 'sonnet', 'opus', 'fable']
        .filter(k => t.byTier[k] > 0)
        .map(k => `${t.byTier[k]} ${k}`)
        .join(', ');
    return [
        `model-router is ${state}: ${t.agents} subagents routed (${mix}).`,
        `Without the router (every agent on the parent's model): ~${usd(t.baseline)}. With it: ~${usd(t.spent)} + ${usd(t.overhead)} for ${o.calls} Haiku calls.`,
        `Estimated saving: ~${usd(t.saved)} (${t.pct.toFixed(0)}%). ${t.measured}/${t.agents} use real token counts; the rest assume ${ASSUMED.inTok / 1000}k in / ${ASSUMED.outTok / 1000}k out.`,
        o.failed > 0 ? `Haiku could not decide ${o.failed} time(s); the keyword fallback did.` : '',
        'An estimate: it assumes the same tokens on the parent model and ignores retries a cheaper model may need.',
    ]
        .filter(Boolean)
        .join('\n');
}
