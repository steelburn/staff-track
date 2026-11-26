import express from 'express';
import { getDb } from '../db.js';
import { verifyToken } from './auth.js';

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function normEmail(value) {
    return String(value ?? '').trim().toLowerCase();
}

function normName(value) {
    return String(value ?? '').trim().toLowerCase();
}

/**
 * Turn the flat staff rows into org-chart nodes.
 *
 * `staff.manager_name` stores a *name*, not an email, so we resolve it against
 * a name index (falling back to an email index for rows where the manager was
 * stored as an address). Self-references and manager cycles are broken so the
 * result can always be rendered as a tree.
 */
export function buildOrgChart(rows) {
    const nodes = rows.map(row => ({
        id: normEmail(row.email),
        name: row.name || '',
        title: row.title || '',
        department: row.department || '',
        managerName: row.manager_name || null,
        parentId: null,
    }));

    const byId = new Map(nodes.map(n => [n.id, n]));

    // name/email → node id. First entry wins when names collide.
    const lookup = new Map();
    for (const node of nodes) {
        if (node.name && !lookup.has(normName(node.name))) {
            lookup.set(normName(node.name), node.id);
        }
        if (!lookup.has(node.id)) {
            lookup.set(node.id, node.id);
        }
    }

    for (let i = 0; i < rows.length; i++) {
        const node = nodes[i];
        const managerKey = normName(rows[i].manager_name);
        if (!managerKey) continue;
        const parentId = lookup.get(managerKey);
        if (parentId && parentId !== node.id && byId.has(parentId)) {
            node.parentId = parentId;
        }
    }

    breakCycles(nodes, byId);
    return nodes;
}

/**
 * Cut one parent link per manager cycle. Traversal follows parent pointers, so
 * descendants hanging off a cycle stay attached to their manager instead of
 * being promoted to roots (which is what a simple reachability check does).
 */
function breakCycles(nodes, byId) {
    const state = new Map(); // undefined = unvisited, 1 = in current walk, 2 = done

    for (const start of nodes) {
        if (state.get(start.id) === 2) continue;

        const chain = [];
        let current = start;

        while (current && state.get(current.id) !== 2) {
            if (state.get(current.id) === 1) {
                // Back-edge: `current` is already in this walk. Cut the link
                // closest to it (the last node we appended before looping).
                const last = chain[chain.length - 1];
                if (last) last.parentId = null;
                break;
            }

            state.set(current.id, 1);
            chain.push(current);
            current = current.parentId ? byId.get(current.parentId) : null;
        }

        for (const node of chain) state.set(node.id, 2);
    }
}

function buildTree(nodes) {
    const treeById = new Map(nodes.map(n => [n.id, { ...n, children: [] }]));
    const roots = [];

    for (const node of treeById.values()) {
        if (node.parentId && treeById.has(node.parentId)) {
            treeById.get(node.parentId).children.push(node);
        } else {
            node.parentId = null;
            roots.push(node);
        }
    }

    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    const sortRecursive = (list) => {
        list.sort(byName);
        for (const item of list) sortRecursive(item.children);
    };
    sortRecursive(roots);

    return roots;
}

function collectIds(node, ids = []) {
    ids.push(node.id);
    for (const child of node.children) collectIds(child, ids);
    return ids;
}

// ── GET /org-chart ────────────────────────────────────────────────────────────
// Returns the organisation chart as a nested tree plus a flat, d3-org-chart
// compatible node list ({ id, parentId, ... }).
//
// Query:
//   root=<email>       Scope the response to one person's subtree
//   includeInactive=1  Include deactivated accounts (default: active only)
router.get('/', verifyToken, async (req, res) => {
    try {
        const db = await getDb();
        const includeInactive = ['1', 'true', 'yes'].includes(String(req.query.includeInactive || '').toLowerCase());

        const [rows] = includeInactive
            ? await db.query(`
                SELECT s.email, s.name, s.title, s.department, s.manager_name
                FROM staff s
                ORDER BY s.name ASC
            `)
            : await db.query(`
                SELECT s.email, s.name, s.title, s.department, s.manager_name
                FROM staff s
                INNER JOIN user_roles ur ON s.email = ur.email
                WHERE ur.is_active = 1
                ORDER BY s.name ASC
            `);

        let nodes = buildOrgChart(rows);
        let roots = buildTree(nodes);

        // Optional subtree scope: keep only the requested person and reports.
        const rootEmail = normEmail(req.query.root);
        if (rootEmail) {
            const rootNode = findInTree(roots, rootEmail);
            if (!rootNode) {
                return res.status(404).json({ error: `No staff member found for root '${req.query.root}'` });
            }
            const keep = new Set(collectIds(rootNode));
            rootNode.parentId = null;
            nodes = nodes.filter(n => keep.has(n.id));
            for (const node of nodes) {
                if (node.parentId && !keep.has(node.parentId)) node.parentId = null;
            }
            roots = [rootNode];
        }

        res.json({
            generatedAt: new Date().toISOString(),
            count: nodes.length,
            rootCount: roots.length,
            roots,
            nodes,
        });
    } catch (err) {
        console.error('GET /org-chart error:', err);
        res.status(500).json({ error: 'Failed to build organization chart' });
    }
});

function findInTree(roots, id) {
    for (const node of roots) {
        if (node.id === id) return node;
        const found = findInTree(node.children, id);
        if (found) return found;
    }
    return null;
}

export { router };
