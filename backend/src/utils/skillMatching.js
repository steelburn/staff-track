// Skill name matching helpers for the Skill Consolidation (Data Governance)
// tool on the System page. Pure functions — no DB access.

// Collapse a skill name to a comparison key: lowercase, keep only a-z0-9#+.
// "Node.js" -> "nodejs", "GitHub / Gitlab" -> "githubgitlab", "UI UX" -> "uiux".
// # and + are preserved so "C#" / "C++" never collapse to "C".
export function skillCharNorm(s) {
    return (s || '').trim().toLowerCase().replace(/[^a-z0-9#+]/g, '');
}

// Word tokens of a RAW display name (spaces are meaningful here, unlike
// charNorm): "Database Design (Non-Spatial)" -> {database, design, non, spatial}.
export function skillTokens(s) {
    return new Set((s || '').trim().toLowerCase().split(/[^a-z0-9#+]+/).filter(Boolean));
}

// Classic Levenshtein distance.
export function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const m = a.length, n = b.length;
    let prev = new Array(n + 1);
    let cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, cur] = [cur, prev];
    }
    return prev[n];
}

const NEGATION_WORDS = new Set(['non', 'no', 'not', 'without', 'excluding', 'except', 'vs']);

// Score one pair of skill groups. Returns { score, kind } where kind is
// 'exact' (same words, only punctuation/case/whitespace differ — safe) or
// 'near' (fuzzy — needs human review). Returns null when the pair must NOT
// be proposed (version differences, negation opposites, trivial names).
// keyA/keyB are charNorm'd keys; labelA/labelB are the raw display names.
export function pairScore(keyA, keyB, labelA, labelB) {
    if (!keyA || !keyB || keyA === keyB) return null;
    // Trivial names (C, C#, SQL is fine but 1-2 char keys are noise).
    if (keyA.length <= 2 || keyB.length <= 2) return null;

    // Version/edition pairs: "SharePoint Designer 2010" vs 2013, "ESXi 7.0"
    // vs 8.0, "HTML / CSS" vs "HTML5, CSS", "Apache 2.0" vs "Apache2" —
    // names that differ ONLY by embedded digits are not merge candidates.
    if (keyA.replace(/[0-9]+/g, '') === keyB.replace(/[0-9]+/g, '')) return null;

    const tokensA = skillTokens(labelA);
    const tokensB = skillTokens(labelB);

    // Tokens differing ONLY by numbers: "VMWare vSphere & ESXi 7.0" vs 8.0.
    const diffA = [...tokensA].filter(t => !tokensB.has(t));
    const diffB = [...tokensB].filter(t => !tokensA.has(t));
    const diffAll = [...diffA, ...diffB];
    if (diffAll.length > 0 && diffAll.every(t => /^[0-9]+(\.[0-9]+)*$/.test(t))) return null;

    // Negation opposites: "Database Design (Spatial)" vs "(Non-Spatial)",
    // "Agile" vs "Non-Agile" must never be proposed as merges.
    if (diffAll.some(t => NEGATION_WORDS.has(t) || t.startsWith('non'))) return null;

    const maxLen = Math.max(keyA.length, keyB.length);
    const levRatio = 1 - levenshtein(keyA, keyB) / maxLen;
    // Overlap relative to the LARGER token set. min-denominator overlap lets a
    // single-word skill (".NET", "Database", "Communication") act as a hub and
    // chain unrelated skills into one giant component — max-denominator keeps
    // subset pairs (".NET" ⊂ "Backend Programming (.NET)") far below threshold.
    const maxTokens = Math.max(tokensA.size, tokensB.size);
    const overlap = maxTokens === 0 ? 0
        : [...tokensA].filter(t => tokensB.has(t)).length / maxTokens;

    const score = Math.max(levRatio, overlap);
    if (score < 0.86) return null;

    // The pair must differ in at most ~2 tokens ("API, Database" vs
    // "API Analysis" share one word but differ in 2 — rejected by the
    // threshold anyway; this rule guards near-threshold bridges).
    if (diffAll.length > 2) return null;

    const kind = overlap >= 0.95 ? 'exact' : 'near';
    return { score: Math.round(score * 100) / 100, kind };
}

// Given skill groups keyed by charNorm (each record: { key, label, count,
// instances }), find connected duplicate components via pairwise scoring.
// Each proposal: { canonical, target, groupCount, groupInstances, members:
// [{ name, count, instances, score, isTarget }] }.
// `target` is the recommended merge destination: for subset relations the
// more generic (fewer-token) name wins; otherwise the most-used name.
export function buildProposals(groups) {
    const keys = Object.keys(groups);
    if (keys.length < 2) return [];

    const union = new Map();
    const find = (x) => {
        if (!union.has(x)) union.set(x, x);
        let root = x;
        while (union.get(root) !== root) root = union.get(root);
        let cur = x;
        while (union.get(cur) !== root) { const next = union.get(cur); union.set(cur, root); cur = next; }
        return root;
    };
    const merge = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) union.set(ra, rb); };

    const edges = []; // {a, b, score, kind}
    for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
            const r = pairScore(keys[i], keys[j], groups[keys[i]].label, groups[keys[j]].label);
            if (r) {
                edges.push({ a: keys[i], b: keys[j], score: r.score, kind: r.kind });
                merge(keys[i], keys[j]);
            }
        }
    }

    const byRoot = new Map();
    for (const k of keys) {
        const root = find(k);
        if (!byRoot.has(root)) byRoot.set(root, []);
        byRoot.get(root).push(k);
    }

    const proposals = [];
    for (const [root, members] of byRoot) {
        if (members.length < 2) continue;
        const compEdges = edges.filter(e => members.includes(e.a) && members.includes(e.b));
        if (compEdges.length === 0) continue;

        // Generic = fewest tokens; tie-break by shorter charNorm.
        const tokensOf = k => skillTokens(groups[k].label).size;
        const generic = members.slice().sort((x, y) =>
            tokensOf(x) - tokensOf(y) || x.length - y.length)[0];
        const mostUsedKey = members.slice().sort((x, y) =>
            groups[y].instances - groups[x].instances)[0];

        // Subset relation: one name's words fully contained in the other's
        // (e.g. "Laravel Framework" ⊃ "Laravel", "UI/UX Design (Figma…)" ⊃
        // "Design (Figma…)"). For those, the generic name is the target.
        const hasSubset = compEdges.some(e =>
            [...skillTokens(groups[e.a].label)].every(t => skillTokens(groups[e.b].label).has(t)) ||
            [...skillTokens(groups[e.b].label)].every(t => skillTokens(groups[e.a].label).has(t)));

        const targetKey = hasSubset ? generic : mostUsedKey;
        const targetGroup = groups[targetKey];

        const membersOut = members.map(k => {
            const g = groups[k];
            const scores = compEdges
                .filter(e => e.a === k || e.b === k)
                .map(e => e.score);
            const bestScore = Math.round(Math.max(0, ...scores) * 100) / 100;
            return {
                name: g.label,
                key: k,
                count: g.count,
                instances: g.instances,
                score: k === targetKey ? 1 : bestScore,
                isTarget: k === targetKey
            };
        }).sort((a, b) => (a.isTarget ? -1 : 1) - (b.isTarget ? -1 : 1) || b.instances - a.instances);

        proposals.push({
            canonical: targetGroup.label,
            target: targetGroup.label,
            groupCount: members.reduce((acc, k) => acc + groups[k].count, 0),
            groupInstances: members.reduce((acc, k) => acc + groups[k].instances, 0),
            members: membersOut
        });
    }

    // Most impactful first, then alphabetical.
    proposals.sort((a, b) => b.groupInstances - a.groupInstances || a.canonical.localeCompare(b.canonical));
    return proposals;
}
