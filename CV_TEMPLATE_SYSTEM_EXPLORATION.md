# CV Template System Exploration

## Overview
The StaffTrack CV template system is a white-label, template-based CV generation engine that allows staff to create professional CVs in multiple styles (Classic, Modern, Minimal). It combines markdown templates with custom CSS styling and supports complex data binding.

---

## 1. WHERE CV TEMPLATES ARE DEFINED

### Backend Definition Files

#### Database Schema
- **File:** [backend/migrations/0001_initial_schema.sql](backend/migrations/0001_initial_schema.sql#L215-L225)
- **Table:** `cv_templates`
- **Columns:**
  - `id` (VARCHAR(36), Primary Key)
  - `name` (VARCHAR(255), Template display name)
  - `markdown_template` (LONGTEXT, Template with Mustache-style syntax)
  - `css_styles` (LONGTEXT, Custom CSS for CV styling)
  - `company_logo_path` (VARCHAR(500), optional company logo)
  - `is_default` (TINYINT, flags the default template)

#### Template Seeding
- **File:** [backend/src/db.js](backend/src/db.js#L15-L53)
- **Function:** `seedTemplates(connection)`
- **Default Templates Seeded:**
  1. **"classic"** (is_default=1) - Traditional CV format
  2. **"modern"** (is_default=0) - Contemporary light teal design
  3. **"minimal"** (is_default=0) - Monospace minimalist style

#### API Routes
- **File:** [backend/src/routes/cv_profiles.js](backend/src/routes/cv_profiles.js)
- **Routes:**
  - `GET /templates` - List all CV templates (line 38-46)
  - `POST /templates` - Create new template (requires admin, line 48-60)
  - `PUT /templates/:id` - Update template (requires admin, line 62-80)
  - `DELETE /templates/:id` - Delete template (requires admin, line 82-98)

### Frontend Definition Files

#### Template Editor
- **HTML:** [public/cv-template-editor.html](public/cv-template-editor.html)
- **JS:** [public/cv-template-editor.js](public/cv-template-editor.js)
- **Features:**
  - Three-column editor: Markdown | CSS | Live Preview side-by-side
  - Real-time preview with Markdown → HTML render engine
  - Template list panel with active selection
  - Variable reference guide with clickable chips (`{{variable}}` syntax)
  - Save/Delete/Reset functionality
  - New template creation with sensible defaults

#### CV Profile Component
- **HTML:** [public/cv-profile.html](public/cv-profile.html)
- **JS:** [public/cv-profile.js](public/cv-profile.js)
- **Generate CV Tab:** (`id="generate-cv-tab"`)
  - Template selector dropdown
  - Generate button
  - PDF export/print options
  - CV snapshot history viewer

---

## 2. CV TEMPLATE SCHEMA/STRUCTURE

### Default Template Example (Classic)

```javascript
{
  id: 'classic',
  name: 'Classic',
  is_default: 1,
  markdown_template: `
    # {{name}}
    **{{title}}** | {{department}}
    ---
    {{phone}} | {{email}} | {{location}}
    ---
    ## Professional Summary
    {{summary}}
    ---
    ## Skills
    {{#skills}}
    - {{skill}} (★{{rating}})
    {{/skills}}
    ---
    ## Work History
    {{#workHistory}}
    **{{employer}}** — {{job_title}} ({{start_date}} – {{end_date}})
    {{description}}
    {{/workHistory}}
    ---
    ## Projects
    {{#projects}}
    **{{project_name}}** ({{customer}}) • {{role}} • {{end_date}}
    {{/projects}}
    ---
    *Generated {{generatedAt}}*
  `,
  css_styles: `
    body { font-family: "Segoe UI", Arial, sans-serif; ... }
    .cv-body { max-width: 860px; margin: 0 auto; padding: 32px; }
    h1 { font-size: 2rem; color: #111; }
    h2 { color: #1d4ed8; border-bottom: 2px solid #1d4ed8; }
    ...
  `
}
```

### Template Syntax Supported

| Syntax | Meaning | Example |
|--------|---------|---------|
| `{{variable}}` | Simple variable substitution | `{{name}}`, `{{email}}` |
| `{{#array}}...{{/array}}` | Loop over array | `{{#skills}}...{{/skills}}` |
| `{{section:name}}...{{/section:name}}` | Conditional section | `{{section:skills}}...{{/section:skills}}` |
| Markdown | Full GFM markdown support | `# Heading`, `**bold**`, tables, lists |

### Data Object Structure Passed to Template

```javascript
{
  name: string,                          // Staff member's name
  email: string,                         // Staff email
  phone: string,                         // Phone number
  linkedin: string,                      // LinkedIn URL
  location: string,                      // City, Country
  title: string,                         // Job title
  department: string,                    // Department name
  summary: string,                       // Professional summary (LONGTEXT)
  generatedAt: string,                   // Today's date
  
  // Array fields
  skills: [
    { skill: string, rating: number }    // 1-5 star rating
  ],
  workHistory: [
    { employer, job_title, start_date, end_date, description, is_current }
  ],
  projects: [
    { project_name, customer, role, start_date, end_date, description, technologies }
  ],
  education: [
    { institution, degree, field, start_year, end_year, description }
  ],
  certifications: [
    { name, issuer, date_obtained, expiry_date, credential_id }
  ],
  pastProjects: [
    { project_name, role, start_date, end_date, description, technologies }
  ]
}
```

---

## 3. HOW CV TEMPLATES ARE STORED & RETRIEVED

### Storage Architecture

#### Primary Storage
- **Database Table:** `cv_templates` (MySQL)
- **Retrieval Methods:**
  1. **All Templates:** `SELECT * FROM cv_templates ORDER BY is_default DESC, name ASC`
  2. **Default Template:** `SELECT * FROM cv_templates WHERE is_default = 1 LIMIT 1`
  3. **By ID:** `SELECT * FROM cv_templates WHERE id = ?`

#### Storage Locations
- **Markdown Template:** LONGTEXT column in database (no file system limit)
- **CSS Styles:** LONGTEXT column in database (no file system limit)
- **Company Logo:** Optional path reference in `company_logo_path` (VARCHAR(500))

### Retrieval Flow

```
Frontend
  ↓ GET /api/cv-profiles/templates
Backend
  ↓ Query cv_templates table
Database
  ↓ Return all templates JSON
Frontend
  ↓ Populate template selector & editor
```

### Template Rendering Process

#### Server-Side Rendering (for CV export)
**File:** [backend/src/routes/cv_profiles.js](backend/src/routes/cv_profiles.js#L400-L600) (`POST /:email/generate`)

1. Fetch CV profile from `cv_profiles` table
2. Fetch related data:
   - Education from `education` table
   - Certifications from `certifications` table
   - Work history from `work_history` table
   - Past projects from `cv_past_projects` table
3. Fetch submission data (skills & projects):
   - Skills from `submission_skills` table
   - Projects from `submission_projects` table
4. Assemble `templateData` object (see schema above)
5. Process template using `processTemplate(template.markdown_template, templateData)`
6. Convert markdown to HTML using `markdownToHtml()`
7. Wrap in complete HTML document with CSS from template
8. Return as response (can be printed, saved as PDF, or stored as snapshot)

#### Client-Side Live Preview (Template Editor)
**File:** [public/cv-template-editor.js](public/cv-template-editor.js#L200-L250)

1. Use `SAMPLE_DATA` object (mock realistic data)
2. Call `renderTemplateClient(markdown, css, SAMPLE_DATA)`
3. Process template variables using regex substitution
4. Convert markdown to HTML with full GFM support
5. Inject CSS into `<style>` tag
6. Render in iframe (`srcdoc` attribute)
7. Debounced on every keystroke (400ms debounce, line 350)

#### Markdown → HTML Rendering
**Rendering Engine:** [public/cv-template-editor.js](public/cv-template-editor.js#L66-L165)

- **Supported Markdown:**
  - Headings: `# H1` through `###### H6`
  - Bold/Italic/Strikethrough: `**bold**`, `*italic*`, `~~strike~~`
  - Inline code: `` `code` ``
  - Fenced code blocks: ` ```language\ncode\n``` `
  - Lists: `- item` (ul), `1. item` (ol)
  - Blockquotes: `> quote`
  - Horizontal rules: `---`, `***`, `___`
  - GFM Tables with alignment
  - Images: `![alt](url)`
  - Links: `[text](url)`

---

## 4. CV-PROFILE COMPONENT & TEMPLATE RENDERING

### Structure

#### Main Component File
- **File:** [public/cv-profile.html](public/cv-profile.html)
- **Main Container:** `<main class="main-container">`

#### Tab Navigation
Tabs in the component:
1. **My Submission** - Staff details, skills, active projects
2. **Education** - Academic qualifications
3. **Certifications** - Professional certifications
4. **Work History** - Employment history
5. **Past Projects** - Additional projects outside managed projects
6. **Generate CV** - Template selection & CV generation

### Generate CV Tab Implementation

**Location:** [public/cv-profile.html](public/cv-profile.html#L600+) (element `id="generate-cv-tab"`)

```html
<div class="tab-content" id="generate-cv-tab">
  <!-- Template Selector -->
  <select id="gen-template-select">
    <option>Loading...</option>
  </select>
  
  <!-- Generate Button -->
  <button id="btn-generate-cv">🖨️ Generate CV</button>
  
  <!-- CV Preview iframe -->
  <iframe id="cv-preview-frame"></iframe>
  
  <!-- Actions: Print, Save PDF, Save Snapshot -->
  <button id="btn-print-cv">Print</button>
  <button id="btn-export-pdf">Export as PDF</button>
  <button id="btn-save-snapshot">Save Snapshot</button>
  
  <!-- Snapshot History -->
  <div id="snapshot-history">
    <!-- Previous CV snapshots listed here -->
  </div>
</div>
```

### Generation Flow (Frontend → Backend)

```javascript
// Step 1: User selects template and clicks "Generate"
const templateId = document.getElementById('gen-template-select').value;

// Step 2: POST request to backend
POST /api/cv-profiles/:email/generate
{
  template_id: selectedTemplateId
}

// Step 3: Backend processes, returns HTML
Response: {
  html: "<!DOCTYPE html>...",
  template_name: "Classic"
}

// Step 4: Render in iframe
document.getElementById('cv-preview-frame').srcdoc = response.html;

// Step 5: Print or save as PDF
window.print();  // Triggers browser print dialog
```

### Photo Upload & Display

**Location:** [public/cv-profile.html](public/cv-profile.html#L110-L125) (Profile section)

```html
<div class="form-group">
  <label for="cv-photo">Profile Photo</label>
  <input type="file" id="cv-photo" accept="image/*">
  <button id="btn-upload-photo">📷 Upload Photo</button>
  <img id="photo-preview">
</div>
```

**Backend Handling:** [backend/src/routes/cv_profiles.js](backend/src/routes/cv_profiles.js#L880-L920)

- **Endpoint:** `POST /:email/photo` (multipart/form-data)
- **Upload Directory:** `/data/uploads/photos/`
- **Filename:** `{email}_{timestamp}.{ext}`
- **Allowed Types:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`
- **Max Size:** 5MB
- **Storage:** Path stored in `cv_profiles.photo_path` column

---

## 5. EXISTING PHOTO/FILE UPLOAD INFRASTRUCTURE

### Upload Directory Structure
```
/data/uploads/
  ├── photos/           # Profile photos (used in cv_profiles.photo_path)
  └── proofs/           # Education/certification proofs
```

### Photos (CV Profile Photos)

**Route:** [backend/src/routes/cv_profiles.js](backend/src/routes/cv_profiles.js#L880-L920)

```javascript
// POST /:email/photo - Upload profile photo
router.post('/:email/photo', verifyToken, upload.single('photo'), async (req, res) => {
  // Multer disk storage configured to save in /data/uploads/photos
  const photoPath = `/uploads/photos/${req.file.filename}`;
  // Update cv_profiles.photo_path
  await db.query(
    'UPDATE cv_profiles SET photo_path = ? WHERE LOWER(staff_email) = ?',
    [photoPath, email.toLowerCase()]
  );
  res.json({ photo_path: photoPath });
});

// GET /:email/photo - Retrieve photo path
router.get('/:email/photo', verifyToken, async (req, res) => {
  const [photos] = await db.query(
    'SELECT photo_path FROM cv_profiles WHERE LOWER(staff_email) = ? LIMIT 1',
    [email.toLowerCase()]
  );
  res.json({ photo_path: photos[0].photo_path });
});
```

#### Multer Configuration
**Location:** [backend/src/routes/cv_profiles.js](backend/src/routes/cv_profiles.js#L11-L35)

```javascript
const UPLOAD_DIR = '/data/uploads/photos';
const PROOF_DIR = '/data/uploads/proofs';

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${req.params.email}_${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Only image files are allowed'));
    }
});
```

### Proofs (Education & Certification Proofs)

**Database Columns:**
- `education.proof_path` (VARCHAR(500))
- `certifications.proof_path` (VARCHAR(500))

**Current Status:** Upload infrastructure exists but no dedicated proof upload endpoints currently exposed in cv_profiles.js routes.

### Static File Serving

**Location:** [backend/src/index.js](backend/src/index.js#L26-L27)

```javascript
// Serve uploaded files (photos, proofs) from the persistent data volume
app.use('/uploads', express.static('/data/uploads'));
```

All files in `/data/uploads/` are publicly accessible via `GET /uploads/{path}`.

---

## 6. CV SNAPSHOT SYSTEM

### Snapshots Table
**File:** [backend/migrations/0001_initial_schema.sql](backend/migrations/0001_initial_schema.sql#L244-L255)

```sql
CREATE TABLE cv_snapshots (
  id VARCHAR(36) PRIMARY KEY,
  staff_email VARCHAR(255) NOT NULL,
  generated_by VARCHAR(255),           -- Who generated it (admin email)
  template_id VARCHAR(36),              -- Template used
  template_name VARCHAR(255),           -- Template display name
  snapshot_html LONGTEXT NOT NULL,      -- Full HTML of CV
  snapshot_data JSON,                   -- Optional metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (staff_email),
  INDEX (created_at)
)
```

### Snapshot Operations
**Location:** [backend/src/routes/cv_profiles.js](backend/src/routes/cv_profiles.js#L730-L820)

- **POST** `/:email/snapshots` - Save generated CV as snapshot
- **GET** `/:email/snapshots` - List all snapshots for email
- **GET** `/:email/snapshots/:snapshot_id` - Retrieve specific snapshot HTML
- **DELETE** `/:email/snapshots/:snapshot_id` - Delete specific snapshot
- **DELETE** `/:email/snapshots` - Delete all snapshots for email

---

## 7. KEY CODE PATTERNS

### Template Rendering Logic (Server)
```javascript
// From cv_profiles.js line 400-600
function processTemplate(template, data) {
    let result = template;
    
    // 1. Process conditional sections
    result = result.replace(/\{\{section:(\w+)\}\}([\s\S]*?)\{\{\/section:\1\}\}/g, ...)
    
    // 2. Process arrays (loops)
    result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, ...)
    
    // 3. Process simple variables
    result = result.replace(/\{\{([^}]+)\}\}/g, ...)
    
    return result;
}
```

### Template Rendering Logic (Client)
```javascript
// From cv-template-editor.js line 100-160
function renderTemplateClient(markdownTpl, cssStyles, data) {
    let tpl = markdownTpl || '';
    
    // 1. Section blocks processing
    tpl = tpl.replace(/\{\{section:(\w+)\}\}([\s\S]*?)\{\{\/section:\1\}\}/g, ...)
    
    // 2. Loop blocks
    tpl = tpl.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, ...)
    
    // 3. Scalar variables
    tpl = tpl.replace(/\{\{(\w+)\}\}/g, ...)
    
    const body = markdownToHtml(tpl);
    return `<!DOCTYPE html><html>...<style>${cssStyles}</style>...${body}...</html>`;
}
```

### Built-in Template Protection
```javascript
// From cv_profiles.js line 76 and 93
if (['classic', 'modern', 'minimal'].includes(id)) {
    return res.status(403).json({ error: 'Built-in templates cannot be edited' });
}
```

---

## 8. DATABASE RELATIONSHIPS

```
cv_templates (one)
  └── cv_snapshots (many) - via template_id

cv_profiles (one)
  ├── education (many)
  ├── certifications (many)
  ├── work_history (many)
  └── cv_past_projects (many)

submissions (one)
  ├── submission_skills (many)
  └── submission_projects (many)
```

---

## 9. SECURITY CONSIDERATIONS

### Authentication & Authorization
- **All cv_profiles routes** require `verifyToken` middleware
- **Template creation/update/delete** require `requireRole('admin')`
- **Template IDs 'classic', 'modern', 'minimal'** are protected from editing/deletion

### File Upload Protection
- **Only images allowed:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`
- **Max file size:** 5MB per upload
- **Filename randomization:** `{email}_{timestamp}.{ext}` prevents overwriting

---

## 10. RELATED DATABASE TABLES SUMMARY

| Table | Purpose | Key Columns |
|-------|---------|------------|
| `cv_templates` | Template definitions | id, name, markdown_template, css_styles, is_default |
| `cv_profiles` | Staff CV profile data | staff_email, summary, phone, linkedin, location, photo_path |
| `education` | Education records | staff_email, institution, degree, field, start_year, end_year |
| `certifications` | Certifications | staff_email, name, issuer, date_obtained, expiry_date |
| `work_history` | Employment history | staff_email, employer, job_title, start_date, end_date |
| `cv_past_projects` | Additional projects | staff_email, project_name, role, start_date, end_date |
| `cv_snapshots` | Generated CV snapshots | staff_email, generated_by, template_id, snapshot_html |
| `submissions` | Staff skill/project submissions | staff_email, staff_name, title, department |
| `submission_skills` | Submitted skills | submission_id, skill, rating |
| `submission_projects` | Submitted projects | submission_id, project_name, customer, role |

---

## Summary: Complete Data Flow

```
CV Generation Request
  ↓
GET /api/cv-profiles/:email (fetch profile data)
  ├── cv_profiles → photo, summary, phone, linkedin, location
  ├── education → all education records
  ├── certifications → all certification records
  ├── work_history → all work history records
  └── submission_skills & submission_projects → skills & projects
  ↓
SELECT template FROM cv_templates WHERE id = ?
  ↓
processTemplate(markdown_template, {name, email, phone, ...})
  ↓
markdownToHtml(processed_template)
  ↓
Wrap in HTML + CSS: `<html><style>{{css_styles}}</style><body>{{html}}</body></html>`
  ↓
Return to frontend OR save as snapshot in cv_snapshots table
  ↓
Frontend: Display in iframe OR print/export as PDF
```

