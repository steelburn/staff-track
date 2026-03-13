'use strict';

// Use auth module functions
const token = window.StaffTrackAuth.getToken();
const userStr = sessionStorage.getItem('st_user');
if (!token || !userStr) {
    location.href = '/login.html';
    throw new Error('Not logged in');
}
const authUser = JSON.parse(userStr);


document.addEventListener('DOMContentLoaded', async () => {
    renderNav('orgchart');
    await initChart();
});

async function initChart() {
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/catalog/staff');
        if (!res.ok) throw new Error('Failed to load staff data');
        const staff = await res.json();

        const chartData = buildFlatData(staff);

        var chart = new OrgChart(document.getElementById("chart-container"), {
            template: "ana",
            enableSearch: true,
            mouseWheel: { zoom: true, ctrlZoom: true },
            layout: OrgChart.mixed,
            nodeBinding: {
                field_0: "name",
                field_1: "title"
            },
            nodes: chartData,
            // Event handler for node click - expand/focus on clicked node
            nodeClick: function (sender, args) {
                chart.focus(args.node.id, { expand: true, center: true });
            }
        });
        window._orgChart = chart;

        // Try to centre on the logged-in user after the chart has rendered
        setTimeout(() => {
            const userEmail = authUser.email;
            if (userEmail && window._orgChart) {
                const userExists = chartData.some(n => n.id === userEmail);
                if (userExists) {
                    try {
                        // OrgChart API v7+: focus(); earlier versions: centre()
                        if (typeof chart.focus === 'function') {
                            chart.focus(userEmail);
                        } else if (typeof chart.centre === 'function') {
                            chart.centre(userEmail);
                        }
                    } catch (e) {
                        console.warn('OrgChart focus/centre not available:', e.message);
                    }
                }
            }
        }, 800);

        // Connect zoom buttons
        document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
            if (window._orgChart) {
                const cur = window._orgChart.getScale ? window._orgChart.getScale() : 1;
                window._orgChart.setScale ? window._orgChart.setScale(Math.min((cur || 1) + 0.25, 3))
                    : window._orgChart.zoom(1.25);
            }
        });
        document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
            if (window._orgChart) {
                const cur = window._orgChart.getScale ? window._orgChart.getScale() : 1;
                window._orgChart.setScale ? window._orgChart.setScale(Math.max((cur || 1) - 0.25, 0.3))
                    : window._orgChart.zoom(0.8);
            }
        });

    } catch (e) {
        console.error(e);
        document.getElementById('chart-container').innerHTML = `<p class="grid-empty">Error loading organization chart.</p>`;
    }
}

function buildFlatData(staff) {
    // BALKAN prefers a flat array with { id: X, pid: ParentX, name: Y, title: Z }
    const nodes = [];

    // Create a name-to-email map for PID mapping if manager is specified by name
    const nameMap = new Map();
    staff.forEach(s => nameMap.set(s.name, s.email));

    staff.forEach(s => {
        const node = {
            id: s.email,
            name: s.name,
            title: s.title || ''
        };

        if (s.manager_name && nameMap.has(s.manager_name)) {
            node.pid = nameMap.get(s.manager_name);
        }

        nodes.push(node);
    });

    // Identify which nodes are parents (have children)
    const parentIds = new Set(nodes.filter(n => n.pid).map(n => n.pid));

    // Exclude orphans with no children:
    // A node is kept if:
    // 1. It has a parent (it's part of a branch)
    // 2. OR it is a root AND it has children (it's the start of a branch)
    const filteredNodes = nodes.filter(n => {
        const hasParent = !!n.pid;
        const hasChildren = parentIds.has(n.id);
        return hasParent || hasChildren;
    });

    // Handle multiple roots by creating a virtual top node if needed
    const roots = filteredNodes.filter(n => !n.pid);
    if (roots.length > 1) {
        const virtualRootId = 'virtual_root';
        filteredNodes.push({
            id: virtualRootId,
            name: 'StaffTrack Organization',
            title: 'Top Level'
        });
        roots.forEach(r => r.pid = virtualRootId);
    }

    return filteredNodes;
}
