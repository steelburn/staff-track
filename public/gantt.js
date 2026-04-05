'use strict';

const authUser = requireAuth();
requirePermission(authUser, ['admin', 'hr', 'coordinator']);

let projectsScale = 1;
let resourcesScale = 1;

let allProjects = [];
let allStaff = [];

async function init() {
    if (window.renderNav) window.renderNav('gantt');

    try {
        const [projectsRes, staffRes] = await Promise.all([
            window.StaffTrackAuth.apiFetch('/api/reports/projects'),
            window.StaffTrackAuth.apiFetch('/api/reports/staff')
        ]);

        if (!projectsRes.ok || !staffRes.ok) throw new Error('Failed to fetch data');

        const rawProjects = await projectsRes.json();
        const rawStaff = await staffRes.json();
        
        // Transform projects data: convert snake_case field names to camelCase and 'submissions' to 'assignments'
        allProjects = rawProjects.map(p => ({
          ...p,
          id: p.soc || p.id,
          name: p.project_name,
          projectName: p.project_name,
          staffName: p.staff_name,
          // Rename submissions to assignments for gantt rendering
          assignments: (p.submissions || []).map(s => ({
            endDate: s.staff_end_date,
            name: s.staff_name,
            role: s.role,
            email: s.staff_email
          }))
        }));
        
        // Staff data is already in correct format
        allStaff = rawStaff;

        setupSelection('project', allProjects, (item) => item.projectName || item.name);
        setupSelection('staff', allStaff, (item) => item.staffName);

        // Tab Switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
            });
        });

        // Selection Buttons
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

    // Create wrapper if it doesn't exist
    let wrapper = container.querySelector('.gantt-wrapper');
    if (!wrapper) {
        container.innerHTML = '';
        
        // Add zoom controls
        const controls = document.createElement('div');
        controls.className = 'gantt-controls';
        controls.innerHTML = `
            <button class="btn-secondary" id="zoom-out-${type}">🔍 -</button>
            <button class="btn-secondary" id="zoom-in-${type}">🔍 +</button>
        `;
        container.appendChild(controls);

        wrapper = document.createElement('div');
        wrapper.className = 'gantt-wrapper';
        wrapper.style.width = '100%';
        container.appendChild(wrapper);

        // Attach event listeners
        document.getElementById(`zoom-in-${type}`).addEventListener('click', () => {
            if (type === 'projects') projectsScale = Math.min(projectsScale * 1.5, 10);
            else resourcesScale = Math.min(resourcesScale * 1.5, 10);
            renderFn(wrapper, data, type === 'projects' ? projectsScale : resourcesScale);
        });

        document.getElementById(`zoom-out-${type}`).addEventListener('click', () => {
            if (type === 'projects') projectsScale = Math.max(projectsScale / 1.5, 0.1);
            else resourcesScale = Math.max(resourcesScale / 1.5, 0.1);
            renderFn(wrapper, data, type === 'projects' ? projectsScale : resourcesScale);
        });

        const tooltip = document.getElementById('tooltip');
        
        wrapper.addEventListener('mousemove', (e) => {
            const canvas = wrapper.querySelector('canvas');
            if (!canvas || !canvas._hitRegions) {
                tooltip.style.opacity = 0;
                return;
            }

            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            let found = null;
            // Only check regions if we are to the right of the sticky labels
            // (labelWidth + padding = 250 + 20 = 270)
            if (x > 270) {
                for (const region of canvas._hitRegions) {
                    if (x >= region.x && x <= region.x + region.w &&
                        y >= region.y && y <= region.y + region.h) {
                        found = region;
                        break;
                    }
                }
            }

            if (found) {
                const tip = found.tip.replace(/\n/g, '<br>');
                tooltip.innerHTML = tip;
                tooltip.style.opacity = 1;
                tooltip.style.left = (e.pageX + 10) + 'px';
                tooltip.style.top = (e.pageY + 10) + 'px';
                canvas.style.cursor = 'pointer';
            } else {
                tooltip.style.opacity = 0;
                canvas.style.cursor = 'default';
            }
        });

        container.addEventListener('mouseleave', () => {
            tooltip.style.opacity = 0;
        });
    }

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
            const id = item.id || item.name;
            const div = document.createElement('div');
            div.className = 'selection-item';
            div.innerHTML = `
                <input type="checkbox" value="${id}" id="chk-${type}-${id}">
                <label for="chk-${type}-${id}">${labelFn(item)}</label>
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
            let minStartDate = new Date();
            p.assignments.forEach(a => {
                const ed = parseDate(a.endDate);
                if (ed) {
                    // For a better visual, try to guess start date if it were available.
                    // Here we just use current date as a baseline if they don't have start dates.
                    const sd = new Date(minStartDate);
                    sd.setMonth(sd.getMonth() - 1);
                    if (sd < minStartDate) minStartDate = sd;

                    if (!maxEndDate || ed > maxEndDate) maxEndDate = ed;
                }
            });
            return {
                id: p.id || p.name,
                name: p.name,
                start: minStartDate,
                end: maxEndDate,
                subtext: `${p.assignments ? p.assignments.length : 0} team members`
            };
        })
        .filter(p => p.end !== null)
        .sort((a, b) => a.end - b.end);

    if (data.length === 0) {
        wrapper.innerHTML = '<div style="color:var(--text-secondary); text-align:center; padding:2rem;">No active project timelines available.</div>';
        return;
    }

    renderCanvasGantt(wrapper, data, scale);
}

function renderResourcesGantt(wrapper, staffList, scale = 1) {
    const data = [];
    staffList.forEach(s => {
        if (!s.projects || s.projects.length === 0) return;

        let overallMinStart = null;
        let overallMaxEnd = null;
        let projectCount = 0;

        // Separate lines per project per staff
        s.projects.forEach((p) => {
            const ed = parseDate(p.endDate);
            if (ed) {
                // Estimate a start date for the chart to look better if none recorded
                const sd = new Date();
                sd.setMonth(sd.getMonth() - parseInt(Math.random() * 3 + 1)); 

                if (!overallMinStart || sd < overallMinStart) overallMinStart = sd;
                if (!overallMaxEnd || ed > overallMaxEnd) overallMaxEnd = ed;
                projectCount++;

                data.push({
                    id: `${s.id}-${p.projectName}`,
                    name: "↳ " + p.projectName, // Indent subsequent projects
                    start: sd,
                    end: ed,
                    subtext: p.projectName,
                    isSub: true,
                    staffName: s.staffName
                });
            }
        });

        // Add overall resource line
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

    // Sort by staff name, then sub-projects (parent first)
    data.sort((a, b) => {
        if (a.staffName === b.staffName) {
            if (!a.isSub && b.isSub) return -1;
            if (a.isSub && !b.isSub) return 1;
            return a.subtext.localeCompare(b.subtext); // subtext is project name for subs
        }
        return a.staffName.localeCompare(b.staffName);
    });

    const finalData = data;

    if (finalData.length === 0) {
        wrapper.innerHTML = '<div style="color:var(--text-secondary); text-align:center; padding:2rem;">No staff assignments with valid end dates available.</div>';
        return;
    }

    renderCanvasGantt(wrapper, finalData, scale);
}

function renderCanvasGantt(container, data, scale = 1) {
    const rowHeight = 40;
    const labelWidth = 250;
    const padding = 20;
    const topMargin = 50;

    if (data.length === 0) return;

    // Use actual data bounds for initialization
    let minDate = new Date(data[0].start);
    let maxDate = new Date(data[0].end);

    data.forEach(d => {
        if (d.start && d.start < minDate) minDate = new Date(d.start);
        if (d.end && d.end > maxDate) maxDate = new Date(d.end);
    });

    // Safety: Cap years to reasonable range
    const minYear = 2020;
    const maxYear = 2040;
    if (minDate.getFullYear() < minYear) minDate = new Date(minYear, 0, 1);
    if (maxDate.getFullYear() > maxYear) maxDate = new Date(maxYear, 11, 31);
    
    // Buffer
    minDate.setMonth(minDate.getMonth() - 1);
    maxDate.setMonth(maxDate.getMonth() + 2);

    let totalDuration = maxDate - minDate;
    if (totalDuration <= 0) totalDuration = 86400000;

    const minWidth = 800;
    const baseChartWidth = Math.max(minWidth - labelWidth, (totalDuration / (1000 * 60 * 60 * 24)) * 3);
    const virtualChartWidth = Math.min(baseChartWidth * scale, 50000); 
    const virtualTotalWidth = Number(virtualChartWidth + labelWidth + padding * 2);
    const virtualTotalHeight = (data.length * rowHeight) + topMargin + padding;

    // Track scroll position to keep zoom centered-ish
    const oldScrollLeft = container.scrollLeft;
    const oldVirtualWidth = container._virtualWidth || virtualTotalWidth;
    const scrollRatio = oldScrollLeft / oldVirtualWidth;

    // Setup Virtual Scroll Structure
    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.height = 'calc(min(75vh, ' + (virtualTotalHeight + 40) + 'px))'; 
    container.style.minHeight = '300px';
    container.style.overflow = 'auto';
    container._virtualWidth = virtualTotalWidth;

    const spacer = document.createElement('div');
    spacer.style.width = virtualTotalWidth + 'px';
    spacer.style.height = virtualTotalHeight + 'px';
    spacer.style.pointerEvents = 'none';
    container.appendChild(spacer);

    const canvas = document.createElement('canvas');
    canvas.style.position = 'sticky';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.zIndex = '1';
    container.appendChild(canvas);

    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d', { alpha: false });

    const updateCanvasSize = () => {
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.scale(dpr, dpr);
        draw();
    };

    const draw = () => {
        const scrollLeft = container.scrollLeft;
        const scrollTop = container.scrollTop;
        const vw = canvas.width / dpr;
        const vh = canvas.height / dpr;

        // Background
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, vw, vh);

        const scaleX = (date) => labelWidth + padding + ((date - minDate) / totalDuration) * virtualChartWidth - scrollLeft;

        // 1. Grid and Month Headers
        const headerH = 35;
        const stickyHeaderY = Math.max(0, topMargin - headerH - scrollTop);
        
        // Month Header Background (Sticky at top of canvas)
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, vw, Math.max(headerH, topMargin - scrollTop));

        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.font = '500 12px Inter, sans-serif';
        ctx.fillStyle = '#64748b';

        let curr = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        while (curr <= maxDate) {
            const x = scaleX(curr);
            if (x > -200 && x < vw + 200) { 
                ctx.beginPath();
                ctx.setLineDash([4, 4]);
                ctx.moveTo(x, topMargin - scrollTop);
                ctx.lineTo(x, vh);
                ctx.stroke();
                ctx.setLineDash([]);
                
                const name = curr.toLocaleString('default', { month: 'short', year: 'numeric' });
                ctx.fillText(name, x + 5, Math.max(25, topMargin - 10 - scrollTop));
            }
            curr.setMonth(curr.getMonth() + 1);
        }

        // 2. Bars and Labels
        const hitRegions = [];
        const startVisibleIdx = Math.max(0, Math.floor((scrollTop - topMargin) / rowHeight));
        const endVisibleIdx = Math.min(data.length - 1, Math.ceil((scrollTop + vh) / rowHeight));

        for (let i = startVisibleIdx; i <= endVisibleIdx; i++) {
            const d = data[i];
            const y = topMargin + (i * rowHeight) - scrollTop;
            if (y < -rowHeight || y > vh) continue;

            const xStart = scaleX(d.start);
            const xEnd = scaleX(d.end);
            const barWidth = Math.max(xEnd - xStart, 10);
            const barY = y + 8;
            const barH = 24;

            if (!d.isSub) {
                ctx.fillStyle = '#f8fafc';
                // Row background should cover the full width if needed, but visually just the chart area
                ctx.fillRect(labelWidth + padding - scrollLeft, y + 5, virtualChartWidth, 30);
            }

            // Labels - Sticky in their own column
            ctx.fillStyle = '#fff'; // Background for label area to keep it readable while scrolling
            ctx.fillRect(0, y, labelWidth + padding, rowHeight);

            ctx.font = d.isSub ? '400 11px Inter, sans-serif' : '500 13px Inter, sans-serif';
            ctx.fillStyle = d.isSub ? '#64748b' : '#1e293b';
            const labelText = d.name.length > 30 ? d.name.substring(0, 30) + '...' : d.name;
            const labelOffset = d.isSub ? padding + 15 : padding;
            ctx.fillText(labelText, labelOffset, y + 25);

            if (xEnd > (labelWidth + padding) && xStart < vw) {
                ctx.save();
                // Clip to the chart area to prevent overlap with sticky labels
                ctx.beginPath();
                ctx.rect(labelWidth + padding, 0, vw - (labelWidth + padding), vh);
                ctx.clip();

                ctx.fillStyle = d.isSub ? '#8b5cf6' : '#3b82f6';
                ctx.globalAlpha = d.isSub ? 0.6 : 0.8;
                
                if (ctx.roundRect) {
                    ctx.beginPath();
                    ctx.roundRect(xStart, barY, barWidth, barH, 4);
                    ctx.fill();
                } else {
                    ctx.fillRect(xStart, barY, barWidth, barH);
                }
                ctx.restore();

                hitRegions.push({
                    x: xStart, y: barY, w: barWidth, h: barH,
                    tip: `${d.isSub ? d.staffName + ' - ' + d.subtext : d.name}\nEnd: ${d.end.toLocaleDateString()}\n${d.subtext || ''}`
                });
            }
        }
        canvas._hitRegions = hitRegions;
    };

    container.addEventListener('scroll', draw);
    window.addEventListener('resize', updateCanvasSize);
    updateCanvasSize();

    // Restore scroll position proportional to new width
    if (oldScrollLeft > 0) {
        container.scrollLeft = scrollRatio * virtualTotalWidth;
    }
}

document.addEventListener('DOMContentLoaded', init);
