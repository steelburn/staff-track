# CV Export (PDF & DOCX) — Requirements

## Feature Overview
Enable users with appropriate permissions to export staff CVs in both PDF and DOCX formats, allowing for quick CV delivery in tender proposals, job applications, and client documentation.

---

## User Stories

### 1. Export CV as PDF
**As a** Solution Architect or Sales user  
**I want** to export a staff member's CV as a PDF file  
**So that** I can quickly include it in tender proposals and client documentation.

**Acceptance Criteria (EARS):**
- Given I view a staff member's profile, When I click \"Export CV as PDF\", Then a PDF file downloads with filename format: `FirstName_LastName_CV.pdf`
- Given I download a CV PDF, When I open it, Then it displays: Name, Contact Info, Summary, Skills (with years), Education, Certifications, Work History, Project Experience, with professional formatting
- Given I export a PDF from staff-view page, When the download completes, Then the file is formatted correctly with proper margins, fonts, and page breaks
- Given multiple CVs are exported, When I open the PDF, Then the CV contains current data as of export time (no stale content)

### 2. Export CV as DOCX
**As a** HR or Sales user  
**I want** to export a staff member's CV as a Word document  
**So that** I can edit it for specific proposals or archive it in editable format.

**Acceptance Criteria (EARS):**
- Given I click \"Export CV as DOCX\", When the download completes, Then a Word file opens with filename: `FirstName_LastName_CV.docx`
- Given I open the exported DOCX file in Microsoft Word, When I view it, Then all content is fully editable: text, tables, formatting preserved
- Given the CV header contains a name, When I import the DOCX into Word, Then styles are applied (Heading 1, Body Text, etc) for easy re-formatting
- Given I export the same CV as DOCX multiple times, When I open the files, Then content is identical and current (reflects latest submission data)

### 3. CV Export from Multiple Locations
**As a** user with CV export permissions  
**I want** to export CVs from different pages (staff-view, skill-search results, CV-profile)  
**So that** I can access export functionality from wherever I'm browsing staff data.

**Acceptance Criteria (EARS):**
- Given I'm viewing staff-view.html staff profile, When I click \"Export CV\", Then export options (PDF / DOCX) appear
- Given I'm in skill-search.html results, When I click \"Export CV\" on a search result, Then the export is initiated for that staff member
- Given I'm viewing cv-profile.html (my own CV), When I click \"Download CV\", Then I can choose PDF or DOCX format
- Given I access export from different pages, When the file downloads, Then filename and content are consistent

### 4. Export Permissions Control
**As an** Admin  
**I want** to control which roles can export CVs  
**So that** sensitive staff information isn't shared inappropriately.

**Acceptance Criteria (EARS):**
- Given a user has admin role, When they access CV export, Then they can export any staff CV
- Given a user has HR role, When they access CV export, Then they can export any staff CV
- Given a user has SA/Pre-Sales role, When they access CV export, Then they can export any staff CV
- Given a user has Sales role, When they access CV export, Then they can export any staff CV
- Given a user has staff role, When they try to export another staff CV, Then they get 403 Forbidden error
- Given a user has coordinator role, When they try to access CV export endpoint, Then they get 403 Forbidden

### 5. CV Content Customization
**As a** user exporting CV  
**I want** the exported CV to include only relevant sections  
**So that** I can tailor CVs for different proposal types (IT vs. Business vs. Leadership).

**Acceptance Criteria (EARS):**
- Given I export a CV, When the PDF/DOCX is generated, Then it includes: Full Name, Contact Info, Summary, Technical Skills, Certifications, Education, Work History (last 5 years), Project Experience (last 3 projects)
- Given a staff member has no certifications, When the CV is exported, Then the Certifications section is empty or omitted gracefully
- Given export options are presented, When I can choose to include/exclude sections, Then PDF reflects selected sections (future enhancement)

---

## Detailed Requirements

### File Naming Convention
- Format: `{FirstName}_{LastName}_CV.{pdf|docx}`
- Example: `Alice_Johnson_CV.pdf`, `Bob_Martinez_CV.docx`
- Sanitize special characters in names (spaces to underscores, remove special chars)

### PDF Content Structure
1. **Header Section**: Name, Title, Email, Phone, Department, Manager
2. **Summary**: Professional summary (if provided in CV profile)
3. **Core Competencies**: Skills with years of experience
4. **Certifications**: List of certifications (if any)
5. **Work Experience**: Chronological list of positions
6. **Project Experience**: Recent projects with role and dates
7. **Education**: Degrees, institutions, graduation dates
8. **Key Metrics**: (Optional) Number of projects led, teams managed, etc.

### DOCX Content Structure
- Same sections as PDF
- Editable in Microsoft Word / Google Docs
- Table-based layout for consistent formatting
- Styles applied: Heading 1 (Section titles), Body Text, Table styles
- Margins: 1 inch all sides
- Font: Calibri 11pt (body), 14pt (headings)

### Export API Contract
- Endpoint: `GET /api/cv/:staffId/export?format=pdf|docx`
- Requires authentication and permissions
- Returns binary file with correct Content-Type and Content-Disposition headers
- Timeout: 10 seconds max for file generation

### Browsers & Compatibility
- Chrome, Firefox, Safari, Edge (latest 2 versions)
- Mobile: PDF view in mobile browser, limited DOCX editing
- No client-side file generation required (server-side rendering preferred)

---

## Non-Functional Requirements

- **Export Speed**: <2 seconds to generate PDF/DOCX for typical CV (5K characters)
- **File Size**: PDF <3MB, DOCX <1MB (for typical CV)
- **Caching**: Don't cache generated files; always fresh from latest submission data
- **Encoding**: UTF-8 for all text, support for special characters (accents, non-Latin scripts)
- **Security**: No sensitive data (SSN, salary, internal notes) in exports
- **Accessibility**: PDFs should be accessible (text-selectable, screen-reader compatible)

---

## Assumptions & Constraints

- CV data source is submissions table (staff name, skills, projects, education)
- No signature or photo support in initial release
- No dynamic branding/header images (plain text-based layout)
- Server-side PDF/DOCX generation using Node.js libraries (e.g., pdfkit, docx)
- No "Save as" file dialog customization; browser default download behavior
- CVs are read-only exports (no collaborative editing in export; editing only in app)
