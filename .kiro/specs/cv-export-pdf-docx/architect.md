# CV Export (PDF/DOCX) - Architecture & Decisions

## Executive Summary

StaffTrack enables staff to export their curated CV/resume profiles as professional PDF or DOCX documents. This document captures architectural decisions for document generation, template management, and export pipelines.

---

## Part 1: Architecture Decision Records (ADRs)

### ADR-001: Document Generation Library (Puppeteer vs. LibreOffice vs. pdfkit vs. docx)

**Status:** Accepted  
**Decision:** Two-library approach: Puppeteer (PDF) + docx (DOCX)

**Rationale:**
| Library | PDF Quality | DOCX Support | Learning Curve | License | Chosen |
|---------|-------------|-------------|-----------------|---------|--------|
| **Puppeteer** | Excellent (Chrome headless) | No (external conversion) | Medium | Open | PDF ✓ |
| **LibreOffice CLI** | Good | Yes | Easy | AGPL | Not (AGPL risk) |
| **pdfkit** | Good (native PDF) | No | Hard | MIT | Alternative |
| **docx library** | No PDF | Excellent | Easy | MIT | DOCX ✓ |

**Decision:**
- **PDF Export:** Puppeteer (HTML → Chrome → PDF)
  - Better for styled layouts (CSS + responsive design)
  - No AGPL licensing risk
  - Well-maintained (Google backing)
  
- **DOCX Export:** `npm docx` library (native DOC generation)
  - Pure Node.js (no external process)
  - Direct structured output (easier than HTML conversion)
  - Better for corporate editing (users can modify)

**Trade-off:** Two libraries (maintenance), but optimized path for each format (better UX).

---

### ADR-002: Template System (Hard-Coded vs. User-Editable vs. Marketplace)

**Status:** Accepted  
**Decision:** Staff admin defines templates; staff users pick template + customize content

**Model:**
```
Admin (Template Creator)
  → Create CV template (HTML + CSS)
  → Define placeholders: {{name}}, {{email}}, {{skills}}, etc.
  → Version template (v1, v2, v3)
  → Make "active" or "inactive"

Staff (CV Creator)
  → Pick template from "Active" list
  → System auto-fills: name, email, location (from staff record)
  → Staff manually edits: project descriptions, skill highlights
  → Export as PDF/DOCX
```

**Not Chosen:**
- ❌ Hard-coded templates (no flexibility)
- ❌ User-defined templates (too complex, QA nightmare)
- ❌ Marketplace (over-engineering for MVP)

**Implementation:**
```sql
CREATE TABLE cv_templates (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255),
  html_content LONGTEXT,
  css_content LONGTEXT,
  is_active TINYINT DEFAULT 1,
  version INT DEFAULT 1,
  created_at DATETIME,
  updated_at DATETIME
);
```

---

### ADR-003: Data Security (Embed vs. Link to External Content)

**Status:** Accepted  
**Decision:** Embed all content in PDF/DOCX (no external links)

**Rationale:**
```
Option 1: PDF with URLs/embedded images
  - Smaller file size
  - Risk: Broken links if image URLs change
  - Risk: Images require internet access to view

Option 2: Self-contained PDF (all content embedded)
  - Larger file size (~2-5 MB for typical CV)
  - Portable (works offline)
  - No external dependencies

Decision: Embedded content (better user experience)
  - Staff shares PDF with recruiters (offline context)
  - No broken image links over time
  - Acceptable size (< 5 MB typical)
```

---

### ADR-004: Export Performance (Real-Time vs. Background Job)

**Status:** Accepted  
**Decision:** Real-time export (user clicks "Download", gets PDF in 2-3 sec)

**Rationale:**
```
Option 1: Real-time (request/response)
  - User experience: Instant (click → download)
  - Implementation: Simple (no queue, no webhooks)
  - Risk: Slow response if CV is large + Puppeteer slow

Option 2: Background job (user clicks, returns job_id, polls for completion)
  - User experience: Delayed (wait for email)
  - Implementation: More complex (job queue, webhook)
  - Benefit: Can handle very large exports

Decision: Real-time with timeout
  - Puppeteer typically completes in < 3 seconds
  - If timeout, return CSV fallback (or suggest DOCX instead)
  - Most CVs < 10 pages (fast generation)
```

**Falls back to:** If PDF generation times out, offer DOCX instead (faster).

---

### ADR-005: Image Handling (Base64 Embed vs. External URL)

**Status:** Accepted  
**Decision:** Base64-encoded images embedded in HTML before Puppeteer render

**Rationale:**
```
Flow:
  1. Staff uploaded profile photo (JPEG)
  2. Store in S3 or local /public/files/
  3. During export:
     a. Read image file
     b. Convert to Base64
     c. Embed in HTML: <img src="data:image/jpeg;base64,..." />
     d. Puppeteer renders with embedded image
     e. PDF includes image (no external dependencies)
```

**Rejected alternatives:**
- ❌ External URLs: Risk of broken links
- ❌ Always embed: Doubles file size if images large

---

### ADR-006: Performance Optimization (Caching vs. Fresh Generation)

**Status:** Accepted  
**Decision:** No caching (generate fresh each time user clicks export)

**Rationale:**
```
Caching consideration:
  - Same staff, same template → same PDF?
  - Risk: Staff updates profile, exports old cached PDF
  - Complexity: Cache invalidation logic

Decision: Fresh generation each time
  - Small performance cost (< 3 sec)
  - Correctness guaranteed
  - Simpler logic

If performance becomes issue (< 1%):
  - Add client-side cache (30-minute TTL)
  - Invalidate on profile save
```

---

### ADR-007: Format Preservation (HTML/CSS Fidelity)

**Status:** Accepted  
**Decision:** PDF prioritizes visual design; DOCX prioritizes editability

**Implementation:**
```
PDF Export:
  - Use full HTML/CSS
  - Render exactly as web template
  - Professional, non-editable output

DOCX Export:
  - Convert to Word-safe styles (limited CSS)
  - Preserve fonts, colors, layout
  - Editable in Microsoft Word
  - Slight visual differences OK
```

**Trade-off:** DOCX won't look identicalto web (Word limitations), but staff can edit.

---

### ADR-008: Internationalization (Language Support)

**Status:** Accepted  
**Decision:** English-only for MVP; structure for i18n later

**Implementation:**
```
Template placeholders:
  - {{staff.name}}         (staff record)
  - {{projectList}}        (dynamic from submissions)
  - {{i18n.exportedOn}}    (translatable string)

Non-translatable now: Template HTML is English only
Plan for future: Load template text from i18n library if multiple languages needed
```

---

## Part 2: System Integration Points

### 2.1 Data Flow Architecture

```
Staff Portal
  → Click "Export as PDF" / "Export as DOCX"
  → Browser POST /api/cv-export with:
      { template_id, format: 'pdf' | 'docx' }
         │
         ▼
Backend /api/cv-export handler
  ├─ Validate: Is user exporting their own CV? (permission check)
  ├─ Fetch: Staff profile from MySQL
  ├─ Fetch: Submissions (projects, skills)
  ├─ Fetch: Template HTML/CSS
  ├─ Render: HTML with data substitution {{name}} → "Alice"
  ├─ If PDF: Puppeteer (HTML → PDF)
  ├─ If DOCX: docx library (structured doc builder)
  │
  └─ Return: File stream (Content-Disposition: attachment)
         │
         ▼
Browser
  → Download prompt
  → User saves to disk
```

### 2.2 Backend Integration Points

**New API Endpoint (in `src/routes/cv-export.js`):**
```javascript
POST /api/cv-export
  Request: { template_id: "uuid", format: "pdf" | "docx" }
  Response: File stream (application/pdf or application/vnd.openxmlformats)
  
GET /api/cv-export/templates
  Response: List of active templates
  
GET /api/cv-export/preview/{template_id}
  Response: HTML preview (rendered in browser)
```

**Middleware:**
- Permission check: Can only export own CV (unless admin)
- Rate limiting: Max 10 exports per hour per user (prevent DoS)
- Error handling: PDF generation timeout → fallback to DOCX

**Services:**
- `src/services/cvExporter.js` - Main export logic
  - `generatePDF(data, template)` - Puppeteer integration
  - `generateDOCX(data, template)` - docx library integration
  - `renderTemplate(html, data)` - Placeholder substitution

**Utilities:**
- `src/utils/templateRenderer.js` - Handlebars/EJS integration
- `src/utils/imageEmbedder.js` - Convert image URL → base64

### 2.3 Frontend Integration Points

**New Components (in `frontend/src/components/`):**
```
CVExporter/
├─ ExportModal.jsx          (template picker, format selector)
├─ TemplatePreview.jsx      (show template before export)
├─ ExportButton.jsx         (trigger export, show progress)
└─ TemplateList.jsx         (list active templates)

hooks/
├─ useCVExport.js           (fetch templates, trigger export)
└─ useCVPreview.js          (preview template with user data)
```

### 2.4 Model Integration

**CV Content Model (what gets exported):**
```javascript
cvData = {
  staff: {
    name,
    email,
    phone,
    location,
    title,
    summary
  },
  projects: [
    { name, role, startDate, endDate, description },
    ...
  ],
  skills: [
    { name, proficiency, category },
    ...
  ],
  education: [
    { school, degree, field, graduationDate },
    ...
  ]
}
```

---

## Part 3: Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| **Puppeteer timeout (slow PDF generation)** | Medium (15%) | Medium | Timeout at 10 sec; fallback to DOCX; add async option |
| **Memory leak in Puppeteer (browser hangs)** | Low (5%) | High | Production monitoring; restart Puppeteer pool daily |
| **User's personal data in PDF shared publicly** | Low (10%) | Critical | Make clear: "This is your private CV"; monitor downloads |
| **Large images slow export** | Low (5%) | Low | Compress images during base64 conversion |
| **Template HTML has security vuln (XSS)** | Very Low (1%) | Critical | Sanitize template HTML; code review all templates |
| **DOCX generation creates invalid ZIP** | Very Low (1%) | Medium | Test DOCX files with Word; include error handling |

---

## Part 4: Success Criteria & Acceptance

### 4.1 Functional Requirements
- ✅ Staff can export their CV as PDF
- ✅ Staff can export their CV as DOCX
- ✅ PDF looks professional (matches web template)
- ✅ DOCX is editable in Microsoft Word
- ✅ Staff can choose from multiple templates
- ✅ Template preview shows before export
- ✅ Staff name, email, projects populate automatically
- ✅ Images embedded in PDF (no broken links)

### 4.2 Non-Functional Requirements
- ✅ PDF/DOCX generation completes in < 5 seconds (p95)
- ✅ File size < 5 MB (typical CV)
- ✅ No data loss (everything in submission shows in export)
- ✅ Concurrent exports handled (10 simultaneous users)
- ✅ Memory usage stable (no Puppeteer leaks)

### 4.3 Security Requirements
- ✅ Users can only export their own CV (no privilege escalation)
- ✅ Rate limiting prevents export spam (max 10/hour)
- ✅ Template HTML sanitized (no XSS injection)
- ✅ Exported files contain only staff's own data

---

## Part 5: Architecture Validation Checklist

**Architect Review (Before implementation):**
- [ ] Library choices approved (Puppeteer + docx)
- [ ] Template security model reviewed
- [ ] Data flow security verified (no leaks)
- [ ] Performance targets achievable (< 5 sec)
- [ ] Puppeteer resource limits planned (memory, CPU)
- [ ] Image handling approach approved
- [ ] Monitoring/alerting for export failures defined

**Go/No-Go Approval:** _Pending Tech Lead sign-off_

