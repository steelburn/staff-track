'use strict';

const authUser = requireAuth();

let chart = null;
let chartData = [];

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize sidebar navigation
    if (typeof renderSidebarNav === 'function') {
        renderSidebarNav('orgchart');
    } else if (typeof renderNav === 'function') {
        renderNav('orgchart');
    }
    // Initialize theme toggle
    if (typeof ThemeManager !== 'undefined') {
        ThemeManager.updateToggleButtons();
    }
    // Initialize toast
    if (typeof Toast !== 'undefined') {
        Toast.init();
    }
    await initChart();
});

async function initChart() {
    try {
        if (typeof d3 === 'undefined' || !d3.OrgChart) {
            throw new Error('OrgChart library (d3-org-chart) failed to load');
        }

        const res = await window.StaffTrackAuth.apiFetch('/api/catalog/staff');
        if (!res.ok) throw new Error('Failed to load staff data');
        const staff = await res.json();

        chartData = buildFlatData(staff);
        console.log(`OrgChart: Loading ${chartData.length} nodes (${chartData.filter(n => !n.parentId).length} roots)`);

        chart = new d3.OrgChart()
            .container('#chart-container')
            .data(chartData)
            .nodeWidth(() => 240)
            .nodeHeight(() => 84)
            .compactMarginPair(() => 60)
            .compactMarginBetween(() => 16)
            .initialExpandLevel(3)
            .nodeContent(nodeContent)
            .onNodeClick(onNodeClick)
            .render();

        // Remove the loading placeholder now that the SVG is in place
        document.querySelector('#chart-container .loading-state')?.remove();

        window._orgChart = chart;

        // Fit the whole org into view, then highlight the logged-in user
        setTimeout(() => {
            try {
                chart.fit({ animate: false });
                const userEmail = authUser.email;
                if (userEmail && chartData.some(n => n.id === userEmail)) {
                    chart.setHighlighted(userEmail).render();
                }
            } catch (e) {
                console.warn('OrgChart initial fit/highlight:', e.message);
            }
        }, 100);

        wireControls();
    } catch (e) {
        console.error(e);
        document.getElementById('chart-container').innerHTML = '<p class="grid-empty">Error loading organization chart.</p>';
    }
}

function nodeContent(d) {
    const data = d.data;
    const initial = (data.name || '?').trim().charAt(0).toUpperCase() || '?';
    return `
    <div class="oc-card">
      <div class="oc-avatar">${escapeHtml(initial)}</div>
      <div class="oc-meta">
        <div class="oc-name">${escapeHtml(data.name)}</div>
        <div class="oc-title">${escapeHtml(data.title || '')}</div>
        ${data.department ? `<div class="oc-dept">${escapeHtml(data.department)}</div>` : ''}
      </div>
    </div>`;
}

function onNodeClick(d) {
    if (!chart) return;
    const node = d.data;
    const hasChildren = (d.children && d.children.length > 0) || (d._children && d._children.length > 0);
    if (hasChildren) {
        // _expanded is undefined/true when expanded, false when collapsed
        const isExpanded = node._expanded !== false;
        chart.setExpanded(node.id, !isExpanded).render();
    }
    chart.setCentered(node.id).render();
}

function wireControls() {
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => chart?.zoomIn());
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => chart?.zoomOut());
    document.getElementById('btn-fit')?.addEventListener('click', () => chart?.fit());
    document.getElementById('btn-expand-all')?.addEventListener('click', () => chart?.expandAll());
    document.getElementById('btn-collapse-all')?.addEventListener('click', () => chart?.collapseAll());

    // Debounced search: highlight + center first match
    const searchInput = document.getElementById('chart-search');
    if (searchInput) {
        let timer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => performSearch(searchInput.value.trim()), 250);
        });
    }
}

function performSearch(query) {
    if (!chart) return;
    const status = document.getElementById('search-status');
    if (!query) {
        status.textContent = '';
        chart.clearHighlighting().render();
        return;
    }
    const q = query.toLowerCase();
    const matches = chartData.filter(n =>
        (n.name || '').toLowerCase().includes(q) ||
        (n.title || '').toLowerCase().includes(q) ||
        (n.department || '').toLowerCase().includes(q)
    );
    if (matches.length === 0) {
        status.textContent = 'No matches';
        chart.clearHighlighting().render();
        return;
    }
    status.textContent = matches.length === 1 ? '1 match' : `${matches.length} matches`;
    chart.setHighlighted(matches[0].id).setCentered(matches[0].id).render();
}

function buildFlatData(staff) {
    // d3-org-chart expects a flat array of { id, parentId, ...custom fields }
    const nodes = [];

    // Map manager names to emails so manager_name (not email) still resolves
    const nameMap = new Map();
    staff.forEach(s => nameMap.set(s.name, s.email));

    staff.forEach(s => {
        const node = {
            id: s.email,
            name: s.name,
            title: s.title || '',
            department: s.department || ''
        };

        if (s.manager_name && nameMap.has(s.manager_name)) {
            const managerEmail = nameMap.get(s.manager_name);
            // Prevent self-cycle: if manager is self, treat as root
            if (managerEmail !== s.email) {
                node.parentId = managerEmail;
            }
        }

        nodes.push(node);
    });

    // Identify which nodes are parents (have children)
    const parentIds = new Set(nodes.filter(n => n.parentId).map(n => n.parentId));

    // Exclude orphans with no children:
    // A node is kept if:
    // 1. It has a parent (it's part of a branch)
    // 2. OR it is a root AND it has children (it's the start of a branch)
    let filteredNodes = nodes.filter(n => {
        const hasParent = !!n.parentId;
        const hasChildren = parentIds.has(n.id);
        return hasParent || hasChildren;
    });

    // Break manager cycles (A → B → A) that d3.stratify would reject
    filteredNodes = breakCycles(filteredNodes);

    // Handle multiple roots by creating a virtual top node if needed
    const roots = filteredNodes.filter(n => !n.parentId);
    if (roots.length > 1) {
        const virtualRootId = 'virtual_root';
        filteredNodes.push({
            id: virtualRootId,
            name: 'StaffTrack Organization',
            title: 'Top Level',
            department: ''
        });
        roots.forEach(r => r.parentId = virtualRootId);
    }

    console.log(`OrgChart: Final node count = ${filteredNodes.length}`);
    return filteredNodes;
}

// Kahn's algorithm: any node not reachable from a root is in a manager
// cycle — strip its parentId so it renders as a root instead of crashing stratify.
function breakCycles(nodes) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    // In-degree: each node has at most one parent (1) or is a root (0)
    const pendingParentCount = new Map(nodes.map(n => [n.id, 0]));
    nodes.forEach(n => {
        if (n.parentId && byId.has(n.parentId)) {
            pendingParentCount.set(n.id, 1);
        }
    });

    const queue = nodes.filter(n => !n.parentId || !byId.has(n.parentId)).map(n => n.id);
    const visited = new Set(queue);

    while (queue.length) {
        const curId = queue.shift();
        nodes.forEach(n => {
            if (n.parentId === curId && !visited.has(n.id)) {
                const remaining = pendingParentCount.get(n.id) - 1;
                pendingParentCount.set(n.id, remaining);
                if (remaining <= 0) {
                    visited.add(n.id);
                    queue.push(n.id);
                }
            }
        });
    }

    nodes.forEach(n => {
        if (n.parentId && !visited.has(n.id)) {
            console.warn(`OrgChart: cycle detected — ${n.name} promoted to root`);
            n.parentId = undefined;
        }
    });
    return nodes;
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
