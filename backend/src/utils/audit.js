import { getDb } from '../db.js';

// ── Audit trail + staff-updated flag helpers ─────────────────────────────────
// "Staff Updated" semantics: a staff is flagged once they update ANY personal
// entry (staff details, skills, active projects, education, certifications,
// work history, past projects, photo) — regardless of which field. Every such
// write also lands a row in profile_audit_log so the staff can see their trail.

// Insert one audit-log row. Never throws — audit failures must not break saves.
export async function logAudit(db, { staffEmail, actorEmail, section, action, summary, details }) {
    try {
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await db.query(
            `INSERT INTO profile_audit_log (staff_email, actor_email, section, action, summary, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [(staffEmail || '').toLowerCase(), (actorEmail || '').toLowerCase(), section, action, summary || null,
             details ? JSON.stringify(details) : null, now]
        );
    } catch (err) {
        console.error('Audit log write failed:', err.message);
    }
}

// Flip the staff-updated flag on the staff's submissions row (if they have one).
export async function markStaffUpdated(db, staffEmail) {
    try {
        await db.query(
            'UPDATE submissions SET updated_by_staff = 1 WHERE LOWER(staff_email) = ?',
            [(staffEmail || '').toLowerCase()]
        );
    } catch (err) {
        console.error('markStaffUpdated failed:', err.message);
    }
}

// Compare two lists of rows by a key and report added / removed / updated.
// Returns { added, removed, updated, changed } — label arrays are display strings.
export function diffByKey(oldList, newList, keyFn, labelFn) {
    const oldMap = new Map(oldList.map(x => [(keyFn(x) || '').toLowerCase(), x]));
    const newMap = new Map(newList.map(x => [(keyFn(x) || '').toLowerCase(), x]));
    const added = [];
    const removed = [];
    const updated = [];
    for (const [k, item] of newMap) {
        if (!oldMap.has(k)) added.push(labelFn(item));
    }
    for (const [k, item] of oldMap) {
        if (!newMap.has(k)) removed.push(labelFn(item));
    }
    for (const [k, item] of newMap) {
        if (oldMap.has(k) && JSON.stringify(oldMap.get(k)) !== JSON.stringify(item)) updated.push(labelFn(item));
    }
    return { added, removed, updated, changed: added.length + removed.length + updated.length > 0 };
}
