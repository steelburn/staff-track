'use strict';

const authUser = requireAuth();
requirePermission(authUser, ['admin', 'hr', 'coordinator']);

let projectsScale = 1;
let resourcesScale = 1;

let allProjects = [];
let allStaff = [];

async function init() {
    // Initialize sidebar navigation
    if (typeof renderSidebarNav === 'function') {
        renderSidebarNav('gantt');
    } else if (typeof renderNav === 'function') {
        renderNav('gantt');
    }
    // Initialize theme toggle
    if (typeof ThemeManager !== 'undefined') {
        ThemeManager.updateToggleButtons();
    }
    // Initialize toast
    if (typeof Toast !== 'undefined') {
        Toast.init();
    }

    try {
        const [projectsRes, staffRes] = await Promise.all([
            window.StaffTrackAuth.apiFetch('/api/reports/projects'),
            window.StaffTrackAuth.apiFetch('/api/reports/staff')
        ]);

        if (!projectsRes.ok || !staffRes.ok) throw new Error('Failed to fetch data');

        const rawProjects = await projectsRes.json();
        const rawStaff = await staffRes.json();

        allProjects = rawProjects.map(p => ({
          ...p,
          id: p.id || p.soc || p.assignment_id || p.project_name,
          name: p.project_name,
          projectName: p.project_name,
          staffName: p.staff_name,
          assignments: (p.submissions || []).map(s => ({
            startDate: s.start_date,
            endDate: s.staff_end_date,
            name: s.staff_name,
            role: s.role,
            email: s.staff_email
          }))
        }));

        allStaff = rawStaff;

        setupSelection('project', allProjects, (item) => item.projectName || item.name);
        setupSelection('staff', allStaff, (item) => item.staffName);

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
            });
        });

        const setupBulkSelect = (type, select) => {
            const list = document.getElementById(`${type}-list`);
            const inputs = list.querySelectorAll('input[type="checkbox"]');
            inputs.forEach(input => {
                input.checked = select;
                input.closest('.selection-item').classList.toggle('selected', select);
            });
        };

        document.getElementById('project-select-all').addEventListener('click', () => setupBulkSelect('project', true));
        document.getElementById('project-clear-all').addEventListener('click', () => setupBulkSelect('project', false));
        document.getElementById('staff-select-all').addEventListener('click', () => setupBulkSelect('staff', true));
        document.getElementById('staff-clear-all').addEventListener('click', () => setupBulkSelect('staff', false));

        document.getElementById('render-projects-btn').addEventListener('click', () => {
            const selectedIds = getSelectedIds('project');
            if (selectedIds.length === 0) return alert('Please select at least one project');

            const filteredData = allProjects.filter(p => selectedIds.includes(String(p.id || p.projectName || p.name)));
            document.getElementById('projects-selection-card').style.display = 'none';
            document.getElementById('projects-chart-card').style.display = 'block';
            renderGanttSection('projects', filteredData, projectsScale, renderActiveProjectsGantt);
        });

        document.getElementById('render-resources-btn').addEventListener('click', () => {
            const selectedIds = getSelectedIds('staff');
            if (selectedIds.length === 0) return alert('Please select at least one staff member');

            const filteredData = allStaff.filter(s => selectedIds.includes(String(s.id)));
            document.getElementById('resources-selection-card').style.display = 'none';
            document.getElementById('resources-chart-card').style.display = 'block';
            renderGanttSection('resources', filteredData, resourcesScale, renderResourcesGantt);
        });

    } catch (e) {
        console.error('Error loading Gantt data', e);
        document.getElementById('gantt-projects-container').innerHTML = '<div style="color:red">Failed to load data</div>';
    }
}

function renderGanttSection(type, data, currentScale, renderFn) {
    const containerId = `gantt-${type}-container`;
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    const controls = document.createElement('div');
    controls.className = 'gantt-controls';
    controls.innerHTML = `
        <span class="gantt-scale-info">Zoom:</span>
        <button class="btn-secondary" id="zoom-out-${type}">−</button>
        <span class="zoom-level" id="zoom-level-${type}">${Math.round(currentScale * 100)}%</span>
        <button class="btn-secondary" id="zoom-in-${type}">+</button>
    `;
    container.appendChild(controls);

    const wrapper = document.createElement('div');
    wrapper.className = 'gantt-wrapper';
    wrapper.id = `gantt-wrapper-${type}`;
    container.appendChild(wrapper);

    const tooltip = document.getElementById('tooltip');

    document.getElementById(`zoom-in-${type}`).addEventListener('click', () => {
        if (type === 'projects') projectsScale = Math.min(projectsScale * 1.5, 3);
        else resourcesScale = Math.min(resourcesScale * 1.5, 3);
        const scale = type === 'projects' ? projectsScale : resourcesScale;
        document.getElementById(`zoom-level-${type}`).textContent = `${Math.round(scale * 100)}%`;
        renderFn(wrapper, data, scale);
    });

    document.getElementById(`zoom-out-${type}`).addEventListener('click', () => {
        if (type === 'projects') projectsScale = Math.max(projectsScale / 1.5, 0.33);
        else resourcesScale = Math.max(resourcesScale / 1.5, 0.33);
        const scale = type === 'projects' ? projectsScale : resourcesScale;
        document.getElementById(`zoom-level-${type}`).textContent = `${Math.round(scale * 100)}%`;
        renderFn(wrapper, data, scale);
    });

    wrapper.addEventListener('mousemove', (e) => {
        const bar = e.target.closest('.gantt-bar');
        if (bar && bar.dataset.tooltip) {
            tooltip.innerHTML = bar.dataset.tooltip.replace(/\n/g, '<br>');
            tooltip.classList.add('visible');
            tooltip.style.left = `${e.pageX + 12}px`;
            tooltip.style.top = `${e.pageY + 12}px`;
        } else {
            tooltip.classList.remove('visible');
        }
    });

    wrapper.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
    });

    renderFn(wrapper, data, currentScale);
}

function setupSelection(type, items, labelFn) {
    const list = document.getElementById(`${type}-list`);
    const search = document.getElementById(`${type}-search`);

    const renderList = (filter = '') => {
        list.innerHTML = '';
        const filtered = items.filter(item => {
            const label = labelFn(item) || '';
            return label.toLowerCase().includes(filter.toLowerCase());
        });

        filtered.forEach(item => {
            const label = labelFn(item) || 'item';
            const id = item.id || label.replace(/[^a-zA-Z0-9]/g, '_');
            const div = document.createElement('div');
            div.className = 'selection-item';
            div.innerHTML = `
                <input type="checkbox" value="${id}" id="chk-${type}-${id}">
                <label for="chk-${type}-${id}">${label}</label>
            `;
            div.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') {
                    const chk = div.querySelector('input');
                    chk.checked = !chk.checked;
                    div.classList.toggle('selected', chk.checked);
                } else if (e.target.tagName === 'INPUT') {
                    div.classList.toggle('selected', e.target.checked);
                }
            });
            list.appendChild(div);
        });
    };

    search.addEventListener('input', (e) => renderList(e.target.value));
    renderList();
}

function getSelectedIds(type) {
    const checked = document.querySelectorAll(`#${type}-list input:checked`);
    return Array.from(checked).map(c => c.value);
}

function parseDate(dStr) {
    if (!dStr) return null;
    const d = new Date(dStr);
    return isNaN(d.getTime()) ? null : d;
}

function renderActiveProjectsGantt(wrapper, projectsList, scale = 1) {
    const data = projectsList
        .filter(p => p.assignments && p.assignments.length > 0)
        .map(p => {
            let maxEndDate = null;
            let minStartDate = null;
            p.assignments.forEach(a => {
                const ed = parseDate(a.endDate);
                const sd = parseDate(a.startDate);
                if (ed) {
                    if (!maxEndDate || ed > maxEndDate) maxEndDate = ed;
                }
                if (sd && (!minStartDate || sd < minStartDate)) {
                    minStartDate = sd;
                }
            });
            if (!minStartDate && maxEndDate) {
                minStartDate = new Date(maxEndDate);
                minStartDate.setMonth(minStartDate.getMonth() - 1);
            }
            return {
                id: p.id || p.projectName || p.name,
                name: p.projectName || p.name,
                start: minStartDate || new Date(),
                end: maxEndDate,
                subtext: `${p.assignments ? p.assignments.length : 0} team members`
            };
        })
        .filter(p => p.end !== null)
        .sort((a, b) => a.end - b.end);

    if (data.length === 0) {
        wrapper.innerHTML = '<div class="gantt-empty">No active project timelines available.</div>';
        return;
    }

    renderHTMLGantt(wrapper, data, scale);
}

function renderResourcesGantt(wrapper, staffList, scale = 1) {
    const data = [];
    staffList.forEach(s => {
        if (!s.projects || s.projects.length === 0) return;

        let overallMinStart = null;
        let overallMaxEnd = null;
        let projectCount = 0;

        s.projects.forEach((p) => {
            const ed = parseDate(p.endDate);
            const sp = parseDate(p.startDate);
            if (ed) {
                const sd = sp || new Date();
                if (!sp) sd.setMonth(sd.getMonth() - 2);

                if (!overallMinStart || sd < overallMinStart) overallMinStart = sd;
                if (!overallMaxEnd || ed > overallMaxEnd) overallMaxEnd = ed;
                projectCount++;

                data.push({
                    id: `${s.id}-${p.projectName}`,
                    name: "\u2192 " + p.projectName,
                    start: sd,
                    end: ed,
                    subtext: p.projectName,
                    isSub: true,
                    staffName: s.staffName
                });
            }
        });

        if (overallMaxEnd) {
            data.push({
                id: s.id,
                name: s.staffName,
                start: overallMinStart,
                end: overallMaxEnd,
                subtext: `${projectCount} active project${projectCount > 1 ? 's' : ''}`,
                isSub: false,
                staffName: s.staffName
            });
        }
    });

    data.sort((a, b) => {
        if (a.staffName === b.staffName) {
            if (!a.isSub && b.isSub) return -1;
            if (a.isSub && !b.isSub) return 1;
            return a.subtext.localeCompare(b.subtext);
        }
        return a.staffName.localeCompare(b.staffName);
    });

    if (data.length === 0) {
        wrapper.innerHTML = '<div class="gantt-empty">No staff assignments with valid end dates available.</div>';
        return;
    }

    renderHTMLGantt(wrapper, data, scale);
}

function renderHTMLGantt(wrapper, data, scale = 1) {
    if (data.length === 0) return;

    let minDate = new Date(data[0].start);
    let maxDate = new Date(data[0].end);

    data.forEach(d => {
        if (d.start && d.start < minDate) minDate = new Date(d.start);
        if (d.end && d.end > maxDate) maxDate = new Date(d.end);
    });

    const minYear = 2020;
    const maxYear = 2040;
    if (minDate.getFullYear() < minYear) minDate = new Date(minYear, 0, 1);
    if (maxDate.getFullYear() > maxYear) maxDate = new Date(maxYear, 11, 31);

    minDate.setMonth(minDate.getMonth() - 1);
    maxDate.setMonth(maxDate.getMonth() + 2);

    const totalDuration = maxDate - minDate;
    const DAY_PX_BASE = 3;
    const dayWidth = DAY_PX_BASE * scale;

    const months = [];
    let curr = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    while (curr <= maxDate) {
        months.push({
            date: new Date(curr),
            startX: ((curr - minDate) / totalDuration) * 100,
            daysInMonth: new Date(curr.getFullYear(), curr.getMonth() + 1, 0).getDate(),
            label: curr.toLocaleString('default', { month: 'short', year: 'numeric' })
        });
        curr.setMonth(curr.getMonth() + 1);
    }

    const rowHeight = 48;
    const headerHeight = 40;
    const chartWidthPx = (totalDuration / (1000 * 60 * 60 * 24)) * dayWidth;

    const savedLabelWidth = wrapper._labelWidth || 220;
    const LABEL_WIDTH = savedLabelWidth;

    wrapper.innerHTML = '';
    wrapper.style.position = 'relative';
    wrapper.style.width = '100%';
    wrapper.style.minHeight = '300px';

    const container = document.createElement('div');
    container.className = 'gantt-timeline-container';
    container.style.display = 'flex';
    container.style.position = 'relative';
    container.style.height = (headerHeight + data.length * rowHeight) + 'px';
    wrapper.appendChild(container);

    const labelSection = document.createElement('div');
    labelSection.className = 'gantt-labels-section';
    labelSection.style.position = 'sticky';
    labelSection.style.left = '0';
    labelSection.style.zIndex = '20';
    labelSection.style.width = LABEL_WIDTH + 'px';
    labelSection.style.minWidth = LABEL_WIDTH + 'px';
    labelSection.style.background = 'var(--bg-card)';
    labelSection.style.borderRight = '1px solid var(--border)';
    labelSection.style.overflow = 'hidden';
    labelSection.style.flexShrink = '0';
    container.appendChild(labelSection);

    const labelHeader = document.createElement('div');
    labelHeader.className = 'gantt-labels-header';
    labelHeader.style.height = headerHeight + 'px';
    labelHeader.style.display = 'flex';
    labelHeader.style.alignItems = 'center';
    labelHeader.style.padding = '0 0.75rem';
    labelHeader.style.borderBottom = '1px solid var(--border)';
    labelHeader.style.fontWeight = '600';
    labelHeader.style.fontSize = '0.75rem';
    labelHeader.style.color = 'var(--text-secondary)';
    labelHeader.textContent = 'Task / Resource';
    labelSection.appendChild(labelHeader);

    data.forEach((d, index) => {
        const labelCell = document.createElement('div');
        labelCell.className = 'gantt-label-cell' + (d.isSub ? ' sub-task' : '');
        labelCell.style.height = rowHeight + 'px';
        labelCell.style.display = 'flex';
        labelCell.style.alignItems = 'center';
        labelCell.style.padding = '0 0.75rem';
        labelCell.style.borderBottom = '1px solid var(--border)';
        labelCell.style.fontSize = '0.85rem';
        labelCell.style.fontWeight = d.isSub ? '400' : '500';
        labelCell.style.color = d.isSub ? 'var(--text-secondary)' : 'var(--text-primary)';
        labelCell.style.paddingLeft = d.isSub ? '1.5rem' : '0.75rem';
        labelCell.innerHTML = '<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + escapeHtml(d.name) + '</span>';
        labelSection.appendChild(labelCell);
    });

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'gantt-resize-handle';
    resizeHandle.style.width = '6px';
    resizeHandle.style.height = '100%';
    resizeHandle.style.background = 'var(--border)';
    resizeHandle.style.cursor = 'col-resize';
    resizeHandle.style.position = 'sticky';
    resizeHandle.style.left = LABEL_WIDTH + 'px';
    resizeHandle.style.zIndex = '25';
    resizeHandle.style.flexShrink = '0';
    container.appendChild(resizeHandle);

    const chartSection = document.createElement('div');
    chartSection.className = 'gantt-chart-section';
    chartSection.style.flex = '1';
    chartSection.style.position = 'relative';
    chartSection.style.overflowX = 'auto';
    chartSection.style.overflowY = 'hidden';
    chartSection.style.minWidth = '0';
    container.appendChild(chartSection);

    const chartInner = document.createElement('div');
    chartInner.style.position = 'relative';
    chartInner.style.width = chartWidthPx + 'px';
    chartInner.style.minWidth = chartWidthPx + 'px';
    chartSection.appendChild(chartInner);

    const monthHeader = document.createElement('div');
    monthHeader.className = 'gantt-months-header';
    monthHeader.style.position = 'sticky';
    monthHeader.style.top = '0';
    monthHeader.style.zIndex = '10';
    monthHeader.style.height = headerHeight + 'px';
    monthHeader.style.background = 'var(--bg-card)';
    monthHeader.style.borderBottom = '1px solid var(--border)';
    monthHeader.style.whiteSpace = 'nowrap';
    chartInner.appendChild(monthHeader);

    months.forEach((m, i) => {
        const nextMonth = months[i + 1];
        const endX = nextMonth ? nextMonth.startX : 100;
        const widthPct = endX - m.startX;

        const cell = document.createElement('div');
        cell.className = 'gantt-header-cell';
        cell.textContent = m.label;
        cell.style.position = 'absolute';
        cell.style.left = m.startX + '%';
        cell.style.width = widthPct + '%';
        cell.style.height = '100%';
        cell.style.borderLeft = i > 0 ? '1px solid var(--border)' : 'none';
        cell.style.boxSizing = 'border-box';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.fontSize = '0.7rem';
        cell.style.fontWeight = '500';
        cell.style.color = 'var(--text-secondary)';
        cell.style.overflow = 'hidden';
        cell.style.textOverflow = 'ellipsis';
        monthHeader.appendChild(cell);
    });

    const todayX = ((Date.now() - minDate) / totalDuration) * 100;
    if (todayX > 0 && todayX < 100) {
        const todayMarker = document.createElement('div');
        todayMarker.className = 'gantt-today-marker';
        todayMarker.style.left = (todayX / 100 * chartWidthPx) + 'px';
        todayMarker.style.height = (headerHeight + data.length * rowHeight) + 'px';
        todayMarker.style.top = '0';
        chartInner.appendChild(todayMarker);
    }

    data.forEach((d, index) => {
        const row = document.createElement('div');
        row.style.position = 'relative';
        row.style.width = chartWidthPx + 'px';
        row.style.height = rowHeight + 'px';
        row.style.borderBottom = '1px solid var(--border)';
        chartInner.appendChild(row);

        const startOffset = Math.max(0, (d.start - minDate) / totalDuration);
        const endOffset = (d.end - minDate) / totalDuration;
        const widthPct = Math.max(0.005, endOffset - startOffset);

        const bar = document.createElement('div');
        bar.className = 'gantt-bar' + (d.isSub ? ' sub-bar' : '');
        bar.style.position = 'absolute';
        bar.style.left = (startOffset * 100) + '%';
        bar.style.width = (widthPct * 100) + '%';
        bar.style.height = d.isSub ? '22px' : '28px';
        bar.style.top = d.isSub ? '13px' : '10px';
        bar.style.borderRadius = '4px';
        bar.style.zIndex = '5';

        const tooltipText = d.isSub
            ? d.staffName + ' - ' + d.subtext + '\nEnd: ' + d.end.toLocaleDateString()
            : d.name + '\nEnd: ' + d.end.toLocaleDateString() + '\n' + (d.subtext || '');
        bar.dataset.tooltip = tooltipText;

        const barText = document.createElement('span');
        barText.className = 'gantt-bar-text';
        barText.textContent = widthPct * 100 > 5 ? d.name.replace('\u2192 ', '') : '';
        bar.appendChild(barText);

        row.appendChild(bar);
    });

    let isResizing = false;
    let startX = 0;
    let startWidth = LABEL_WIDTH;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = LABEL_WIDTH;
        resizeHandle.style.background = 'var(--accent-blue)';
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const diff = e.clientX - startX;
        const newWidth = Math.max(120, Math.min(500, startWidth + diff));
        wrapper._labelWidth = newWidth;

        labelSection.style.width = newWidth + 'px';
        labelSection.style.minWidth = newWidth + 'px';
        resizeHandle.style.left = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizeHandle.style.background = 'var(--border)';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', init);
