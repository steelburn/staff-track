'use strict';

const userStr = sessionStorage.getItem('st_user');
if (!userStr) {
    location.href = '/login.html';
    throw new Error('Not logged in');
}
const authUser = JSON.parse(userStr);

let projectsScale = 1;
let resourcesScale = 1;

async function init() {
    // Requires admin/HR/coordinator
    if (authUser.role !== 'admin' && authUser.role !== 'hr' && authUser.role !== 'coordinator') {
        document.body.innerHTML = '<h1>403 Forbidden</h1>';
        return;
    }

    if (window.renderNav) window.renderNav('gantt');

    try {
        const [projectsRes, staffRes] = await Promise.all([
            window.StaffTrackAuth.apiFetch('/api/reports/projects'),
            window.StaffTrackAuth.apiFetch('/api/reports/staff')
        ]);

        if (!projectsRes.ok || !staffRes.ok) throw new Error('Failed to fetch data');

        const projects = await projectsRes.json();
        const staff = await staffRes.json();

        // Initial render
        renderGanttSection('projects', projects, projectsScale, renderActiveProjectsGantt);
        renderGanttSection('resources', staff, resourcesScale, renderResourcesGantt);

    } catch (e) {
        console.error('Error rendering Gantts', e);
        document.getElementById('gantt-projects-container').innerHTML = '<div style="color:red">Failed to load data</div>';
        document.getElementById('gantt-resources-container').innerHTML = '<div style="color:red">Failed to load data</div>';
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
        wrapper.style.overflowX = 'auto';
        wrapper.style.width = '100%';
        container.appendChild(wrapper);

        // Attach event listeners
        document.getElementById(`zoom-in-${type}`).addEventListener('click', () => {
            if (type === 'projects') {
                projectsScale = Math.min(projectsScale * 1.5, 5);
                renderFn(wrapper, data, projectsScale);
            } else {
                resourcesScale = Math.min(resourcesScale * 1.5, 5);
                renderFn(wrapper, data, resourcesScale);
            }
        });

        document.getElementById(`zoom-out-${type}`).addEventListener('click', () => {
            if (type === 'projects') {
                projectsScale = Math.max(projectsScale / 1.5, 0.2);
                renderFn(wrapper, data, projectsScale);
            } else {
                resourcesScale = Math.max(resourcesScale / 1.5, 0.2);
                renderFn(wrapper, data, resourcesScale);
            }
        });
    }

    renderFn(wrapper, data, currentScale);
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
                id: p.name,
                name: p.name,
                start: minStartDate,
                end: maxEndDate,
                subtext: `${p.assignments.length} team members`
            };
        })
        .filter(p => p.end !== null)
        .sort((a, b) => a.end - b.end);

    if (data.length === 0) {
        wrapper.innerHTML = '<div style="color:var(--text-secondary); text-align:center; padding:2rem;">No active project timelines available.</div>';
        return;
    }

    renderSvgGantt(wrapper, data, scale);
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

    if (data.length === 0) {
        wrapper.innerHTML = '<div style="color:var(--text-secondary); text-align:center; padding:2rem;">No staff assignments with valid end dates available.</div>';
        return;
    }

    renderSvgGantt(wrapper, data, scale);
}

function renderSvgGantt(container, data, scale = 1) {
    const rowHeight = 40;
    const labelWidth = 250;
    const padding = 20;
    const topMargin = 50;

    let minDate = new Date();
    let maxDate = new Date();
    data.forEach(d => {
        if (d.start < minDate) minDate = new Date(d.start);
        if (d.end > maxDate) maxDate = new Date(d.end);
    });

    // Add buffer
    minDate.setMonth(minDate.getMonth() - 1);
    maxDate.setMonth(maxDate.getMonth() + 2);

    const totalDuration = maxDate - minDate;
    const minWidth = 800;
    // Apply scale to chart width
    const baseChartWidth = Math.max(minWidth - labelWidth, (totalDuration / (1000 * 60 * 60 * 24)) * 3);
    const chartWidth = baseChartWidth * scale;
    const width = chartWidth + labelWidth + padding * 2;
    const height = (data.length * rowHeight) + topMargin + padding;

    const scaleX = (date) => labelWidth + padding + ((date - minDate) / totalDuration) * chartWidth;

    let svg = `<svg viewBox="0 0 ${width} ${height}" class="gantt-svg" width="${width}" height="${height}">
        <g class="gantt-grid">`;

    let curr = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    let monthIdx = 0;
    while (curr <= maxDate) {
        const x = scaleX(curr);
        let name = curr.toLocaleString('default', { month: 'short', year: 'numeric' });
        
        // Prevent layout collision when zoomed out
        let skipText = false;
        if (scale < 0.6 && monthIdx % 2 !== 0) skipText = true;
        if (scale < 0.3 && monthIdx % 3 !== 0) skipText = true;

        svg += `<line x1="${x}" y1="${topMargin - 20}" x2="${x}" y2="${height - padding}"></line>`;
        if (!skipText) {
            svg += `<text x="${x + 5}" y="${topMargin - 5}">${name}</text>`;
        }
        
        curr.setMonth(curr.getMonth() + 1);
        monthIdx++;
    }

    svg += `</g><g class="gantt-bars">`;

    const tooltip = document.getElementById('tooltip');

    data.forEach((d, i) => {
        const y = topMargin + (i * rowHeight);
        const xStart = scaleX(d.start);
        const xEnd = scaleX(d.end);
        const barWidth = Math.max(xEnd - xStart, 10);
        
        // Formatting for sub-items
        let labelClass = "gantt-label";
        let labelOffset = padding;
        if (d.isSub) {
            labelClass = "gantt-sublabel";
            labelOffset = padding + 15;
        }

        svg += `<text x="${labelOffset}" y="${y + 20}" class="${labelClass}">${d.name.substring(0, 30)}${d.name.length > 30 ? '...' : ''}</text>`;
        
        if (!d.isSub) {
            // Draw background track only for main items
            svg += `<rect x="${labelWidth + padding}" y="${y + 5}" width="${chartWidth}" height="24" class="gantt-bar-bg"></rect>`;
        }

        const barId = `bar-${Math.random().toString(36).substr(2, 9)}`;
        const tipText = `${d.isSub ? d.staffName + ' - ' + d.subtext : d.name}\nEnd: ${d.end.toLocaleDateString()}\n${d.subtext || ''}`;

        // Differentiate colors for sub-projects
        const barClass = d.isSub ? "gantt-bar gantt-sub-bar" : "gantt-bar";
        const fillStyle = d.isSub ? `fill: var(--accent-purple, #8b5cf6); opacity: 0.6; height: 16px; transform: translateY(4px);` : `fill: var(--accent-blue); opacity: 0.8;`;

        svg += `<rect id="${barId}" x="${xStart}" y="${y + 5}" width="${barWidth}" height="24" class="${barClass}" style="${fillStyle}" data-tip="${encodeURIComponent(tipText)}"></rect>`;
    });

    svg += '</g></svg>';
    container.innerHTML = svg;

    // Attach tooltip listeners
    container.querySelectorAll('.gantt-bar').forEach(bar => {
        bar.addEventListener('mouseenter', (e) => {
            const tip = decodeURIComponent(bar.getAttribute('data-tip')).replace(/\n/g, '<br>');
            tooltip.innerHTML = tip;
            tooltip.style.opacity = 1;
            tooltip.style.left = (e.pageX + 10) + 'px';
            tooltip.style.top = (e.pageY + 10) + 'px';
        });
        bar.addEventListener('mousemove', (e) => {
            tooltip.style.left = (e.pageX + 10) + 'px';
            tooltip.style.top = (e.pageY + 10) + 'px';
        });
        bar.addEventListener('mouseleave', () => {
            tooltip.style.opacity = 0;
        });
    });
}

document.addEventListener('DOMContentLoaded', init);
