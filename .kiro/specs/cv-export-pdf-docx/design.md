# CV Export (PDF & DOCX) — Technical Design

## Architecture Overview

The CV export feature generates professional PDF and DOCX documents server-side from staff submission data. It leverages Node.js libraries for document generation and serves files via HTTP download.

### System Layers

```
┌──────────────────────────────────────────┐
│      Frontend: Export Button/UI           │  Trigger export, handle download
├──────────────────────────────────────────┤
│     API Layer: CV Export Endpoint         │  Validate params, route to service
├──────────────────────────────────────────┤
│    Service Layer: CV Generation          │  Build content, format document
├──────────────────────────────────────────┤
│   Document Generators (PDF / DOCX)       │  pdfkit / docx libraries
├──────────────────────────────────────────┤
│      Database: Staff & Submission Data    │  Fetch CV content
└──────────────────────────────────────────┘
```

---

## Technology Stack

### Libraries
- **PDF Generation**: `pdfkit` (npm: pdfkit) - Pure Node.js PDF creation
- **DOCX Generation**: `docx` (npm: docx) - Create Word documents programmatically
- **Temporary File Handling**: Node.js fs module or in-memory stream (no temp files)

### Installation
```bash
npm install pdfkit docx
```

---

## Data Model

### Data Sources
```javascript
// User requesting export (logged-in user)
{
  email: "alice@company.com",
  role: "admin" | "hr" | "sa_presales" | "sales"
}

// Staff CV Data
{
  id: 1,
  email: "john@company.com",
  fullName: "John Smith",
  title: "Senior Software Engineer",
  department: "Engineering",
  manager: "Jane Doe",
  phone: "555-1234",
  
  // From cv_templates / cv_profiles
  summary: "Professional software engineer with 8 years experience...",
  
  // From skill_submissions (with sort by created_at DESC)
  skills: [
    { skill_name: "React", years_experience: 5, certification_status: "certified" },
    { skill_name: "Node.js", years_experience: 4, certification_status: "certified" },
    ...
  ],
  
  // From submissions
  certifications: [
    { name: "AWS Solutions Architect", date_obtained: "2023-01-15" },
    ...
  ],
  
  education: [
    { institution: "Stanford University", degree: "BS Computer Science", graduation_year: 2016 },
    ...
  ],
  
  projectHistory: [
    { project_name: "Mobile App Redesign", role: "Lead Developer", end_date: "2025-12-01" },
    ...
  ]
}
```

---

## API Design

### Endpoint: Export CV as PDF or DOCX

**GET /api/cv/:staffId/export?format=pdf**

**Parameters:**
- `staffId` (path, required): Numeric ID of staff member
- `format` (query, required): "pdf" or "docx"

**Authentication:**
- Requires valid session/token
- User role must be: admin | hr | sa_presales | sales
- Staff users can only export their own CV

**Response (200 OK):**
```
Content-Type: application/pdf (or application/vnd.openxmlformats-officedocument.wordprocessingml.document)
Content-Disposition: attachment; filename="John_Smith_CV.pdf"
Content-Length: 4096
[Binary file data]
```

**Error Responses:**
```json
// 400 Bad Request - Invalid format
{ "error": "Format must be 'pdf' or 'docx'" }

// 403 Forbidden - User not allowed to export this CV
{ "error": "You don't have permission to export this CV" }

// 404 Not Found - Staff member not found
{ "error": "Staff member not found" }

// 500 Internal Server Error - Generation failed
{ "error": "Failed to generate CV" }
```

---

## Backend Implementation

### File: `backend/src/services/cvExportService.js`

```javascript
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, AlignmentType, TextRun, BorderStyle } = require('docx');
const fs = require('fs');

class CVExportService {
  
  /**
   * Generate PDF CV stream
   * @param {Object} cvData - Staff CV data object
   * @returns {Stream} Readable stream for PDF
   */
  static generatePDF(cvData) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          margins: { top: 40, left: 40, right: 40, bottom: 40 }
        });

        // Header
        doc.fontSize(24).font('Helvetica-Bold').text(cvData.fullName, { lineGap: 10 });
        doc.fontSize(11).font('Helvetica').text(cvData.title || 'Professional', { lineGap: 5 });
        doc.fontSize(10).text(`Email: ${cvData.email} | Phone: ${cvData.phone || 'N/A'} | Department: ${cvData.department}`);
        doc.text(`Manager: ${cvData.manager || 'N/A'}`);
        
        doc.moveTo(40, doc.y + 10).lineTo(555, doc.y + 10).stroke();
        doc.moveDown();

        // Summary
        if (cvData.summary) {
          doc.fontSize(12).font('Helvetica-Bold').text('PROFESSIONAL SUMMARY', { lineGap: 5 });
          doc.fontSize(10).font('Helvetica').text(cvData.summary, { align: 'justify', lineGap: 3 });
          doc.moveDown();
        }

        // Core Competencies
        if (cvData.skills && cvData.skills.length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('CORE COMPETENCIES', { lineGap: 5 });
          const skillsText = cvData.skills
            .map(s => `${s.skill_name}${s.certification_status === 'certified' ? ' ✓' : ''} (${s.years_experience} yrs)`)
            .join(' • ');
          doc.fontSize(10).font('Helvetica').text(skillsText, { align: 'justify', lineGap: 3 });
          doc.moveDown();
        }

        // Certifications
        if (cvData.certifications && cvData.certifications.length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('CERTIFICATIONS', { lineGap: 5 });
          cvData.certifications.forEach(cert => {
            doc.fontSize(10).text(`• ${cert.name}${cert.date_obtained ? ` (${cert.date_obtained})` : ''}`);
          });
          doc.moveDown();
        }

        // Work Experience
        if (cvData.projectHistory && cvData.projectHistory.length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('PROJECT EXPERIENCE', { lineGap: 5 });
          cvData.projectHistory.slice(0, 3).forEach(proj => {
            doc.fontSize(10).font('Helvetica-Bold').text(proj.project_name);
            doc.fontSize(9).text(`${proj.role} • ${proj.end_date || 'Ongoing'}`);
            doc.moveDown(3);
          });
          doc.moveDown();
        }

        // Education
        if (cvData.education && cvData.education.length > 0) {
          doc.fontSize(12).font('Helvetica-Bold').text('EDUCATION', { lineGap: 5 });
          cvData.education.forEach(edu => {
            doc.fontSize(10).font('Helvetica-Bold').text(edu.degree);
            doc.fontSize(9).text(`${edu.institution}${edu.graduation_year ? ` • ${edu.graduation_year}` : ''}`);
          });
        }

        // Footer
        doc.fontSize(8).text(`Generated on ${new Date().toLocaleDateString()}`, { align: 'center', marginTop: 50 });

        doc.end();
        resolve(doc);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generate DOCX CV document
   * @param {Object} cvData - Staff CV data object
   * @returns {Promise} Resolves with docx Document
   */
  static async generateDOCX(cvData) {
    const rows = [];

    // Title row
    rows.push(
      new TableRow({
        cells: [
          new TableCell({
            children: [new Paragraph(new TextRun({ text: cvData.fullName, bold: true, size: 28 }))],
            width: { size: 100, type: WidthType.PERCENTAGE }
          })
        ]
      })
    );

    // Contact info row
    rows.push(
      new TableRow({
        cells: [
          new TableCell({
            children: [
              new Paragraph(
                new TextRun({
                  text: `${cvData.title || 'Professional'} | ${cvData.email} | ${cvData.phone || 'N/A'}`
                })
              ),
              new Paragraph(`Department: ${cvData.department} | Manager: ${cvData.manager || 'N/A'}`)
            ],
            width: { size: 100, type: WidthType.PERCENTAGE }
          })
        ]
      })
    );

    // Sections
    const sections = [];
    
    // Summary
    if (cvData.summary) {
      sections.push(new Paragraph({ text: 'PROFESSIONAL SUMMARY', heading: 'Heading1', bold: true }));
      sections.push(new Paragraph(cvData.summary));
    }

    // Skills
    if (cvData.skills && cvData.skills.length > 0) {
      sections.push(new Paragraph({ text: 'CORE COMPETENCIES', heading: 'Heading1', bold: true }));
      const skillLines = cvData.skills.map(s => 
        `${s.skill_name}${s.certification_status === 'certified' ? ' ✓' : ''} (${s.years_experience} yrs)`
      );
      sections.push(new Paragraph(skillLines.join(' • ')));
    }

    // Certifications
    if (cvData.certifications && cvData.certifications.length > 0) {
      sections.push(new Paragraph({ text: 'CERTIFICATIONS', heading: 'Heading1', bold: true }));
      cvData.certifications.forEach(cert => {
        sections.push(new Paragraph(`• ${cert.name}${cert.date_obtained ? ` (${cert.date_obtained})` : ''}`));
      });
    }

    // Projects
    if (cvData.projectHistory && cvData.projectHistory.length > 0) {
      sections.push(new Paragraph({ text: 'PROJECT EXPERIENCE', heading: 'Heading1', bold: true }));
      cvData.projectHistory.slice(0, 3).forEach(proj => {
        sections.push(new Paragraph({ text: proj.project_name, bold: true }));
        sections.push(new Paragraph(`${proj.role} • ${proj.end_date || 'Ongoing'}`));
      });
    }

    // Education
    if (cvData.education && cvData.education.length > 0) {
      sections.push(new Paragraph({ text: 'EDUCATION', heading: 'Heading1', bold: true }));
      cvData.education.forEach(edu => {
        sections.push(new Paragraph({ text: edu.degree, bold: true }));
        sections.push(new Paragraph(`${edu.institution}${edu.graduation_year ? ` • ${edu.graduation_year}` : ''}`));
      });
    }

    const doc = new Document({
      sections: [
        {
          children: [
            ...sections,
            new Paragraph({
              text: `Generated on ${new Date().toLocaleDateString()}`,
              alignment: AlignmentType.CENTER,
              spacing: { before: 400 }
            })
          ]
        }
      ]
    });

    return doc;
  }
}

module.exports = CVExportService;
```

### File: `backend/src/routes/cv-export.js`

```javascript
const express = require('express');
const router = express.Router();
const db = require('../db');
const CVExportService = require('../services/cvExportService');
const { requireRole } = require('../middleware/authMiddleware');
const { Packer } = require('docx');

// GET /api/cv/:staffId/export
router.get('/:staffId/export',
  requireRole('admin', 'hr', 'sa_presales', 'sales'),
  async (req, res) => {
    try {
      const { staffId } = req.params;
      const { format = 'pdf' } = req.query;
      const userRole = req.session.user.role;

      // Validate format
      if (!['pdf', 'docx'].includes(format)) {
        return res.status(400).json({ error: "Format must be 'pdf' or 'docx'" });
      }

      // Authorization: Staff can only export own CV
      if (userRole === 'staff' && req.session.user.staffId !== parseInt(staffId)) {
        return res.status(403).json({ error: "You can't export another staff member's CV" });
      }

      // Fetch CV data
      const staff = db.prepare('SELECT id, email, fullName, title, department, manager, phone FROM staff WHERE id = ?').get(staffId);
      if (!staff) return res.status(404).json({ error: 'Staff member not found' });

      const cvProfile = db.prepare('SELECT summary FROM cv_profiles WHERE staff_id = ?').get(staffId);
      const skills = db.prepare(`
        SELECT skill_name, years_experience, certification_status 
        FROM skill_submissions 
        WHERE staff_id = ? 
        ORDER BY created_at DESC
      `).all(staffId);
      const certifications = db.prepare(`
        SELECT name, date_obtained 
        FROM certifications 
        WHERE staff_id = ? 
        ORDER BY date_obtained DESC
      `).all(staffId);
      const education = db.prepare(`
        SELECT institution, degree, graduation_year 
        FROM education 
        WHERE staff_id = ?
      `).all(staffId);
      const projectHistory = db.prepare(`
        SELECT project_name, role, end_date 
        FROM staff_projects 
        WHERE staff_id = ? 
        ORDER BY end_date DESC 
        LIMIT 3
      `).all(staffId);

      const cvData = {
        ...staff,
        summary: cvProfile?.summary || '',
        skills,
        certifications,
        education,
        projectHistory
      };

      // Sanitize filename
      const fileName = `${staff.fullName.replace(/[^a-zA-Z0-9]/g, '_')}_CV.${format}`;

      if (format === 'pdf') {
        const pdfStream = await CVExportService.generatePDF(cvData);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        pdfStream.pipe(res);
      } else if (format === 'docx') {
        const docxDoc = await CVExportService.generateDOCX(cvData);
        const buffer = await Packer.toBuffer(docxDoc);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
      }
    } catch (err) {
      console.error('CV export error:', err);
      res.status(500).json({ error: 'Failed to generate CV' });
    }
  }
);

module.exports = router;
```

### File: `backend/src/index.js` (Update)

```javascript
const cvExportRoutes = require('./routes/cv-export');
app.use('/api/cv', cvExportRoutes);
```

---

## Frontend Implementation

### File: `public/staff-view.js` (Update existing export functionality)

```javascript
// Add export button click handler
function exportCV(staffId, format) {
  const staffName = document.querySelector('[data-staff-id="' + staffId + '"]')?.textContent || 'Staff';
  window.location.href = `/api/cv/${staffId}/export?format=${format}`;
}

// Show export format selector
function showExportOptions(staffId) {
  const choice = confirm('Export CV as:\nOK = PDF\nCancel = DOCX');
  const format = choice ? 'pdf' : 'docx';
  exportCV(staffId, format);
}
```

### File: `public/skills.html` (Update existing export button)

```html
<button onclick="showExportOptions(${staff.id})" style="...">Export CV</button>
```

---

## Database Schema Assumptions

The implementation assumes these tables exist (based on project structure):
- `staff(id, email, fullName, title, department, manager, phone)`
- `cv_profiles(staff_id, summary)`
- `skill_submissions(id, staff_id, skill_name, years_experience, certification_status, created_at)`
- `certifications(id, staff_id, name, date_obtained)`
- `education(id, staff_id, institution, degree, graduation_year)`
- `staff_projects(id, staff_id, project_name, role, end_date)`

If tables differ, update SQL queries in cv-export.js accordingly.

---

## Performance & Optimization

- **In-Memory Generation**: PDFs/DOCX generated in memory (no temp files)
- **Caching**: No caching; always fetch latest submission data
- **Timeout**: 10-second request timeout for slow CV generation
- **Streaming**: PDF streams directly to response; DOCX buffered then sent
- **File Size**: Target <3MB PDF, <1MB DOCX

---

## Testing Strategy

### Unit Tests
- PDF generation with complete CV data
- DOCX generation with partial CV data (missing sections)
- Filename sanitization (special characters)
- Permission checks (who can export what)

### Integration Tests
- API endpoint returns correct file type
- File downloads successfully
- PDF is readable, DOCX is editable
- 403 Forbidden for unauthorized users
- 404 for non-existent staff

### E2E Tests
- User exports CV as PDF, opens in PDF reader
- User exports CV as DOCX, opens in Word, edits content
- Exported CV includes latest data (skills, projects, etc.)
