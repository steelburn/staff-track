'use strict';

const authUser = requireAuth();
requireAdmin(authUser);


function showToast(msg, isError = false) {
    const t = document.createElement('div');
    t.className = 'toast';
    if (isError) { t.style.borderColor = 'var(--accent-rose)'; t.style.color = 'var(--accent-rose)'; }
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 400); }, 2800);
}

// ── State ────────────────────────────────────────────────────────────────────
let templates = [];
let selectedTemplate = null;
let focusedEditor = null;
let previewDebounce = null;

// ── Sample data for client-side live preview ──────────────────────────────────
const SAMPLE_DATA = {
    name: 'Jane Doe', email: 'jane.doe@example.com',
    title: 'Senior Software Engineer', department: 'Technology',
    managerName: 'John Smith', phone: '+60 12 345 6789',
    linkedin: 'https://linkedin.com/in/janedoe', location: 'Kuala Lumpur, Malaysia',
    summary: 'Experienced software engineer with 8 years building scalable web applications and leading cross-functional teams.',
    generatedAt: new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }),
    skills: [{ skill: 'JavaScript', rating: 5 }, { skill: 'Node.js', rating: 4 }, { skill: 'Python', rating: 4 }, { skill: 'Docker', rating: 3 }],
    projects: [
        { soc: 'ZCS23-001', project_name: 'ERP Migration', customer: 'Acme Corp', role: 'Tech Lead', start_date: '2023-01-01', end_date: '2024-06-30', technologies: 'SAP, Oracle, Java', description: 'Migrated legacy ERP to modern cloud infrastructure.' },
        { soc: 'ZCS23-042', project_name: 'Mobile App Revamp', customer: 'Beta Ltd', role: 'Backend Dev', start_date: '2023-05-15', end_date: '2024-12-31', technologies: 'Node.js, GraphQL, PostgreSQL', description: 'Rewrote the core API to support offline-first capabilities.' },
    ],
    education: [{ institution: 'Universiti Malaya', degree: 'BSc Computer Science', field: 'Software Engineering', start_year: 2012, end_year: 2016, description: "Dean's List." }],
    certifications: [{ name: 'AWS Certified Developer', issuer: 'Amazon Web Services', date_obtained: '2022-05-01', expiry_date: '2025-05-01', credential_id: 'AWS-DEV-12345', description: '' }],
    workHistory: [
        { employer: 'TechCorp Sdn Bhd', job_title: 'Senior Software Engineer', start_date: '2020-01-01', end_date: 'Present', description: 'Led a team of 5 engineers building cloud-native microservices.' },
        { employer: 'StartupXYZ', job_title: 'Software Engineer', start_date: '2016-07-01', end_date: '2019-12-31', description: 'Full-stack development using React and Node.js.' },
    ],
    pastProjects: [{ project_name: 'Data Pipeline Optimisation', role: 'Data Engineer', start_date: '2021-03-01', end_date: '2021-09-30', description: 'Reduced ETL processing time by 60%.', technologies: 'Python, Apache Spark, AWS S3' }],
};

// ── Full GFM Markdown → HTML renderer ────────────────────────────────────────
// Supports: headings, bold/italic/strike, hr, blockquotes, ordered/unordered
// lists, inline code, fenced code blocks, GFM tables, links, images.
function markdownToHtml(md) {
    if (!md) return '';
    let out = md;

    // 1. Fenced code blocks  ```lang\n...\n```
    out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `\n\n<pre><code class="language-${lang}">${escaped.trimEnd()}</code></pre>\n\n`;
    });

    // 2. GFM Tables  | col | col |  (multi-line)
    out = out.replace(/((?:\|.+\|\n)+)/g, tableBlock => {
        const rows = tableBlock.trim().split('\n');
        if (rows.length < 2) return tableBlock;
        // Second row must be separator: | --- | --- |
        const sepRow = rows[1];
        if (!/^\|[-| :]+\|$/.test(sepRow.trim())) return tableBlock;

        const parseRow = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

        // Alignment from separator row
        const aligns = parseRow(sepRow).map(c => {
            if (/^:-+:$/.test(c)) return 'center';
            if (/^-+:$/.test(c)) return 'right';
            return 'left';
        });

        const headerCells = parseRow(rows[0]).map((c, i) =>
            `<th style="text-align:${aligns[i]}">${inlineMarkdown(c)}</th>`).join('');
        const bodyRows = rows.slice(2).map(r =>
            `<tr>${parseRow(r).map((c, i) => `<td style="text-align:${aligns[i]}">${inlineMarkdown(c)}</td>`).join('')}</tr>`
        ).join('\n');

        return `\n<table>\n<thead><tr>${headerCells}</tr></thead>\n<tbody>${bodyRows}</tbody>\n</table>\n`;
    });

    // 3. Blockquotes
    out = out.replace(/^> ?(.+)$/gm, '<blockquote>$1</blockquote>');
    out = out.replace(/(<\/blockquote>\n<blockquote>)/g, '\n');

    // 4. Headings
    out = out.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    out = out.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    out = out.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    out = out.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    out = out.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    out = out.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // 5. Horizontal rules
    out = out.replace(/^(\*{3}|-{3}|_{3})\s*$/gm, '<hr>');

    // 6. Ordered lists
    out = out.replace(/^(\d+)\.\s+(.+)$/gm, '<li data-ol="1">$2</li>');
    out = out.replace(/(<li data-ol="1">.*<\/li>\n?)+/g, block =>
        `<ol>${block.replace(/ data-ol="1"/g, '')}</ol>`);

    // 7. Unordered lists
    out = out.replace(/^[ \t]*[-*+]\s+(.+)$/gm, '<li>$1</li>');
    out = out.replace(/(<li>(?:(?!<li data-ol).)*<\/li>\n?)+/g, block => `<ul>${block}</ul>`);

    // 8. Inline formatting
    out = out.replace(/~~(.+?)~~/g, '<s>$1</s>');
    out = out.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');
    out = out.replace(/__(.+?)__/g, '<strong>$1</strong>');
    out = out.replace(/_(.+?)_/g, '<em>$1</em>');

    // 9. Inline code
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 10. Images and links
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;">');
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // 11. Paragraphs — blank-line-separated blocks not wrapped in block elements
    const blockTags = /^<(h[1-6]|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|pre|hr|div|section)/;
    const lines = out.split('\n');
    let result = '';
    let para = [];
    const flushPara = () => {
        if (para.length && para.some(l => l.trim())) {
            result += `<p>${para.join(' ').trim()}</p>\n`;
        }
        para = [];
    };
    for (const line of lines) {
        if (!line.trim()) { flushPara(); continue; }
        if (blockTags.test(line.trim())) { flushPara(); result += line + '\n'; }
        else { para.push(line); }
    }
    flushPara();
    return result;
}

// Inline-only markdown (used inside table cells)
function inlineMarkdown(text) {
    return text
        .replace(/~~(.+?)~~/g, '<s>$1</s>')
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

// ── Template renderer (Mustache-style + per-section CSS) ──────────────────────
// Syntax extensions:
//   {{section:name}}...{{/section:name}}  → <section id="name" class="cv-section">...</section>
//   {{#list}}...{{/list}}                  → loop
//   {{varname}}                            → scalar
function renderTemplateClient(markdownTpl, cssStyles, data) {
    let tpl = markdownTpl || '';

    // 1. Section blocks  {{section:skills}}...{{/section:skills}}
    tpl = tpl.replace(/\{\{section:(\w+)\}\}([\s\S]*?)\{\{\/section:\1\}\}/g, (_, name, content) => {
        return `\n\n<section id="${name}" class="cv-section">\n\n${content.trim()}\n\n</section>\n\n`;
    });

    // 2. Loop blocks  {{#key}}...{{/key}}
    tpl = tpl.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, block) => {
        const val = data[key];
        if (!val) return '';
        if (Array.isArray(val)) {
            return val.length === 0 ? '' : val.map(item =>
                block.replace(/\{\{(\w+)\}\}/g, (__, f) => item[f] != null ? String(item[f]) : '')
            ).join('');
        }
        return val ? block.replace(/\{\{(\w+)\}\}/g, (__, f) => data[f] != null ? String(data[f]) : '') : '';
    });

    // 3. Scalar variables  {{name}}
    tpl = tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] != null ? String(data[key]) : '');

    // 4. Collapse blank lines between table rows (loop expansion adds extra newlines)
    tpl = tpl.replace(/(\|[^\n]*\|)\n\n+(\|[^\n]*\|)/g, '$1\n$2');
    // Run twice to handle multiple consecutive blank lines
    tpl = tpl.replace(/(\|[^\n]*\|)\n\n+(\|[^\n]*\|)/g, '$1\n$2');

    const body = markdownToHtml(tpl);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preview — ${data.name}</title>
<style>
/* Default CV reset */
body { margin: 0; padding: 0; }
.cv-body { max-width: 900px; margin: 0 auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 6px 8px; }
pre { overflow-x: auto; }
img { max-width: 100%; }
/* User CSS */
${cssStyles || ''}
</style>
</head><body><div class="cv-body">${body}</div></body></html>`;
}

function renderPreview() {
    const frame = document.getElementById('tmpl-preview-frame');
    if (!frame) return;
    const md = document.getElementById('tmpl-markdown')?.value || '';
    const css = document.getElementById('tmpl-css')?.value || '';
    frame.srcdoc = renderTemplateClient(md, css, SAMPLE_DATA);
}

// ── Load Templates ────────────────────────────────────────────────────────────
async function loadTemplates(keepSelection = false) {
    try {
        const res = await window.StaffTrackAuth.apiFetch('/api/cv-profiles/templates');
        if (!res.ok) throw new Error('Failed');
        templates = await res.json();
        renderTemplateList();
        if (!keepSelection && templates.length > 0 && !selectedTemplate) {
            selectTemplate(templates[0]);
        }
    } catch (err) {
        console.error('Error loading templates:', err);
        const list = document.getElementById('template-list');
        if (list) list.innerHTML = '<div style="color:var(--accent-rose);font-size:0.85rem;">Failed to load templates</div>';
    }
}

function renderTemplateList() {
    const list = document.getElementById('template-list');
    if (!list) return;
    if (templates.length === 0) {
        list.innerHTML = '<div class="grid-empty">No templates yet.</div>';
        return;
    }
    list.innerHTML = templates.map(t => `
        <div class="template-list-item ${selectedTemplate?.id === t.id ? 'active' : ''}" data-id="${t.id}">
            <div>
                <div style="font-weight:600;font-size:0.875rem;">${t.name}</div>
                ${t.is_default ? '<div style="font-size:0.7rem;color:var(--accent-blue);font-weight:600;">DEFAULT</div>' : ''}
            </div>
            <div style="font-size:0.75rem;color:var(--text-muted);">${t.id}</div>
        </div>`).join('');
    list.querySelectorAll('.template-list-item').forEach(item => {
        item.addEventListener('click', () => {
            const tmpl = templates.find(t => t.id === item.dataset.id);
            if (tmpl) selectTemplate(tmpl);
        });
    });
}

function selectTemplate(tmpl) {
    selectedTemplate = tmpl;
    renderTemplateList();
    renderEditor(tmpl);
}

function renderEditor(tmpl) {
    const pane = document.getElementById('editor-pane');
    const templateEl = document.getElementById('editor-template');
    if (!pane || !templateEl) return;
    pane.innerHTML = '';
    const clone = templateEl.content.cloneNode(true);
    pane.appendChild(clone);

    document.getElementById('tmpl-name').value = tmpl.name || '';
    document.getElementById('tmpl-markdown').value = tmpl.markdown_template || '';
    document.getElementById('tmpl-css').value = tmpl.css_styles || '';
    document.getElementById('tmpl-is-default').checked = !!tmpl.is_default;

    const deleteBtn = document.getElementById('btn-delete-template');
    if (deleteBtn) {
        if (['classic', 'modern', 'minimal'].includes(tmpl.id)) {
            deleteBtn.disabled = true;
            deleteBtn.title = 'Built-in templates cannot be deleted';
            deleteBtn.style.opacity = '0.4';
        }
        deleteBtn.addEventListener('click', deleteTemplate);
    }

    document.getElementById('btn-save-template')?.addEventListener('click', saveTemplate);
    document.getElementById('btn-reset-template')?.addEventListener('click', () => { if (selectedTemplate) renderEditor(selectedTemplate); });

    const mdArea = document.getElementById('tmpl-markdown');
    const cssArea = document.getElementById('tmpl-css');
    mdArea?.addEventListener('focus', () => { focusedEditor = 'markdown'; });
    cssArea?.addEventListener('focus', () => { focusedEditor = 'css'; });

    // Debounced live preview — renders from textarea content
    [mdArea, cssArea].forEach(el => {
        el?.addEventListener('input', () => {
            clearTimeout(previewDebounce);
            previewDebounce = setTimeout(() => renderPreview(), 400);
        });
    });

    // Auto-render preview immediately
    setTimeout(() => {
        renderPreview();
        // Initialize toggle button states based on current visibility (defaults to visible)
        document.querySelectorAll('.btn-toggle-col').forEach(btn => {
            const col = btn.dataset.col;
            const colEl = document.getElementById(`col-${col}`);
            const isVisible = !colEl || colEl.style.display !== 'none';
            if (isVisible) {
                btn.style.background = 'var(--accent-blue)';
                btn.style.color = '#fff';
                btn.style.opacity = '1';
            } else {
                btn.style.background = 'transparent';
                btn.style.color = 'var(--text-primary)';
                btn.style.opacity = '0.5';
            }
        });
    }, 50);
}

async function saveTemplate() {
    if (!selectedTemplate) return false;
    const name = document.getElementById('tmpl-name')?.value?.trim();
    const markdown_template = document.getElementById('tmpl-markdown')?.value || '';
    const css_styles = document.getElementById('tmpl-css')?.value || '';
    const is_default = !!document.getElementById('tmpl-is-default')?.checked;
    if (!name) { showToast('Template name is required', true); return false; }

    try {
        const body = JSON.stringify({ name, markdown_template, css_styles, is_default });
        let res;
        if (selectedTemplate.id === '__new__') {
            res = await window.StaffTrackAuth.apiFetch('/api/cv-profiles/templates', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body
            });
        } else {
            res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/templates/${selectedTemplate.id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body
            });
        }
        if (!res.ok) { const e = await res.json().catch(() => ({})); showToast(e.error || 'Failed to save', true); return false; }
        const saved = await res.json();
        showToast('Template saved!');
        selectedTemplate = { ...selectedTemplate, id: saved.id || selectedTemplate.id, name, markdown_template, css_styles, is_default };
        await loadTemplates(true);
        return true;
    } catch (err) {
        showToast('Failed to save template', true);
        return false;
    }
}

async function deleteTemplate() {
    if (!selectedTemplate || selectedTemplate.id === '__new__') return;
    if (!confirm(`Delete template "${selectedTemplate.name}"?`)) return;
    try {
        const res = await window.StaffTrackAuth.apiFetch(`/api/cv-profiles/templates/${selectedTemplate.id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Template deleted'); selectedTemplate = null;
            document.getElementById('editor-pane').innerHTML =
                '<div style="padding:2rem;text-align:center;color:var(--text-muted)">Select a template to begin editing.</div>';
            await loadTemplates();
        } else {
            const e = await res.json().catch(() => ({})); showToast(e.error || 'Failed to delete', true);
        }
    } catch { showToast('Failed to delete template', true); }
}

function newTemplate() {
    selectedTemplate = {
        id: '__new__', name: '',
        markdown_template: `# {{name}}

**{{title}}** | {{department}}

---

{{phone}} | {{email}} | {{location}}

---

## Professional Summary

{{summary}}

---

{{section:skills}}
## Skills

{{#skills}}
- {{skill}} ★{{rating}}
{{/skills}}
{{/section:skills}}

---

{{section:experience}}
## Work History

{{#workHistory}}
**{{employer}}** — {{job_title}} ({{start_date}} – {{end_date}})

{{description}}

{{/workHistory}}
{{/section:experience}}

---

{{section:projects}}
## Projects

| Project | Customer | Role | End Date |
|---------|----------|------|----------|
{{#projects}}
| {{project_name}} | {{customer}} | {{role}} | {{end_date}} |
{{/projects}}
{{/section:projects}}

---

*Generated {{generatedAt}}*`,
        css_styles: `body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; color: #111; }
.cv-body { max-width: 860px; margin: 0 auto; padding: 32px; }
h1 { font-size: 2rem; margin: 0 0 4px; }
h2 { color: #1d4ed8; border-bottom: 2px solid #1d4ed8; padding-bottom: 4px; margin-top: 1.5rem; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.25rem 0; }
ul { padding-left: 1.2rem; }
table { border-collapse: collapse; width: 100%; }
th { background: #f3f4f6; text-align: left; }
th, td { padding: 6px 10px; border: 1px solid #e5e7eb; }
/* Per-section overrides */
#skills ul { columns: 2; }
#projects table { font-size: 0.85em; }`,
        is_default: 0
    };
    renderEditor(selectedTemplate);
    renderTemplateList();
}

function wireVarChips() {
    document.querySelectorAll('.var-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const variable = chip.dataset.var;
            const area = focusedEditor === 'css'
                ? document.getElementById('tmpl-css')
                : document.getElementById('tmpl-markdown');
            if (!area) return;
            const s = area.selectionStart, e = area.selectionEnd;
            area.value = area.value.slice(0, s) + variable + area.value.slice(e);
            area.selectionStart = area.selectionEnd = s + variable.length;
            area.focus();
        });
    });
}

function wireToggles() {
    document.getElementById('btn-toggle-vars')?.addEventListener('click', () => {
        const ref = document.getElementById('var-reference');
        const btn = document.getElementById('btn-toggle-vars');
        if (!ref) return;
        const hidden = ref.style.display === 'none';
        ref.style.display = hidden ? '' : 'none';
        if (btn) btn.textContent = hidden ? 'Hide' : 'Show';
    });
    document.getElementById('btn-new-template')?.addEventListener('click', newTemplate);
}

function wireColumnToggles() {
    document.addEventListener('click', e => {
        const btn = e.target.closest('.btn-toggle-col');
        if (!btn) return;

        const col = btn.dataset.col;
        const colEl = document.getElementById(`col-${col}`);
        if (!colEl) return;

        const isHidden = colEl.style.display === 'none';
        colEl.style.display = isHidden ? '' : 'none';
        
        // Update button visual state
        if (isHidden) {
            btn.classList.remove('inactive');
            btn.style.opacity = '1';
            btn.style.background = 'var(--accent-blue)';
            btn.style.color = '#fff';
        } else {
            btn.classList.add('inactive');
            btn.style.opacity = '0.5';
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text-primary)';
        }

        updateEditorGrid();
    });
}

function updateEditorGrid() {
    const container = document.querySelector('.three-col-editor');
    if (!container) return;

    const colMd = document.getElementById('col-markdown');
    const colCss = document.getElementById('col-css');
    const colPreview = document.getElementById('col-preview');

    const mdVisible = colMd && colMd.style.display !== 'none';
    const cssVisible = colCss && colCss.style.display !== 'none';
    const previewVisible = colPreview && colPreview.style.display !== 'none';

    let columns = [];
    if (mdVisible) columns.push('1.2fr');
    if (cssVisible) columns.push('1fr');
    if (previewVisible) columns.push('1.5fr');

    if (columns.length === 0) {
        container.style.display = 'none';
    } else {
        container.style.display = 'grid';
        container.style.gridTemplateColumns = columns.join(' ');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    renderNav('cv-template-editor');
    wireToggles();
    wireColumnToggles();
    wireVarChips();
    loadTemplates();
});
