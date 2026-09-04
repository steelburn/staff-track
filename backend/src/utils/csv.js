// Minimal RFC-4180-style CSV writer for flat row objects.
// Nested arrays are joined with '|' (feeds return flat rows only).

export function escapeCsvValue(v) {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join('|') : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

export function toCsv(rows, columns) {
    const header = columns.join(',');
    const body = rows
        .map(row => columns.map(col => escapeCsvValue(row[col])).join(','))
        .join('\n');
    return header + '\n' + body;
}
