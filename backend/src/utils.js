/**
 * Basic CSV parser that handles quoted strings and headers.
 */
export function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = splitLine(lines[0]);
    return lines.slice(1).filter(l => l.trim()).map(line => {
        const vals = splitLine(line);
        const obj = {};
        headers.forEach((h, i) => {
            let key = h.trim();
            // handle BOM or weird chars occasionally found in headers
            key = key.replace(/^\uFEFF/, '').replace(/^"/, '').replace(/"$/, '');
            let val = (vals[i] || '').trim();
            // Strip quotes from values if they exist
            if (val.startsWith('"') && val.endsWith('"')) {
                val = val.substring(1, val.length - 1);
            }
            obj[key] = val;
        });
        return obj;
    });
}

function splitLine(line) {
    const res = [];
    let cur = '', inQ = false;
    for (const c of line) {
        if (c === '"') { inQ = !inQ; continue; }
        if (c === ',' && !inQ) { res.push(cur); cur = ''; continue; }
        cur += c;
    }
    res.push(cur);
    return res;
}
