# CV Export (PDF & DOCX) — Implementation Tasks

---

## Task 1: Install Dependencies & Setup
- [ ] 1.1 Install PDF and DOCX generation libraries
  - [ ] Run: `npm install pdfkit docx` in backend/
  - [ ] Verify installations complete without errors
  - [ ] Check package.json includes both packages
- [ ] 1.2 Verify database schema tables exist
  - [ ] Check cv_profiles table (staff_id, summary)
  - [ ] Check skill_submissions table (staff_id, skill_name, years_experience, certification_status)
  - [ ] Check certifications, education, staff_projects tables
  - [ ] Create migration if any tables missing

**Acceptance Criteria:**
- _Requirements: 1, 2_
- Both npm packages installed and importable
- Database schema verified/updated

---

## Task 2: CV Export Service (PDF & DOCX Generators)
- [ ] 2.1 Create `backend/src/services/cvExportService.js`
  - [ ] Implement generatePDF(cvData) using pdfkit
  - [ ] Include header (name, title, contact info)
  - [ ] Add Professional Summary section
  - [ ] Add Core Competencies (skills with years & certified badge)
  - [ ] Add Certifications section
  - [ ] Add Project Experience (last 3 projects)
  - [ ] Add Education section
  - [ ] Set margins (1 inch), fonts (Helvetica 10-12pt)
  - [ ] Add timestamp footer
  
- [ ] 2.2 Implement generateDOCX(cvData) using docx
  - [ ] Create Word document structure
  - [ ] Include all sections matching PDF
  - [ ] Apply styles: Heading 1 (sections), Body Text (content)
  - [ ] Format as editable table layout
  - [ ] Set margins, font (Calibri 11pt body, 14pt headings)
  - [ ] Return docx Document object

- [ ] 2.3 Handle edge cases
  - [ ] Missing summary: omit summary section
  - [ ] No skills: handle gracefully
  - [ ] Missing certifications: show \"None\"
  - [ ] Special characters in names: sanitize for filename

**Acceptance Criteria:**
- _Requirements: 1, 2, 5_
- PDF generation completes in <2 seconds
- DOCX generation completes in <2 seconds
- Both formats include all populated sections
- Empty sections handled gracefully

---

## Task 3: CV Export API Endpoint
- [ ] 3.1 Create `backend/src/routes/cv-export.js`
  - [ ] Implement GET /api/cv/:staffId/export endpoint
  - [ ] Accept format query param (pdf | docx)
  - [ ] Apply requireRole middleware('admin', 'hr', 'sa_presales', 'sales')
  - [ ] Validate format parameter (400 if invalid)
  
- [ ] 3.2 Implement authorization logic
  - [ ] Admin/HR/SA/Sales can export any staff CV
  - [ ] Staff users can only export their own CV (403 if not owner)
  - [ ] Coordinator users get 403 Forbidden

- [ ] 3.3 Fetch CV data from database
  - [ ] Query staff table for basic info
  - [ ] Query cv_profiles for summary
  - [ ] Query skill_submissions for skills (ordered by created_at DESC)
  - [ ] Query certifications, education, staff_projects tables
  - [ ] Handle NULL/missing data gracefully

- [ ] 3.4 Generate and send response
  - [ ] Call CVExportService.generatePDF() or generateDOCX()
  - [ ] Set correct Content-Type header (application/pdf or application/vnd.openxmlformats-officedocument.wordprocessingml.document)
  - [ ] Set Content-Disposition header with filename
  - [ ] Stream PDF directly or buffer DOCX and send
  - [ ] Handle errors with 500 response

- [ ] 3.5 Error handling
  - [ ] 400: Invalid format
  - [ ] 403: User not authorized to export
  - [ ] 404: Staff member not found
  - [ ] 500: Generation failed (with error message logged)

**Acceptance Criteria:**
- _Requirements: 1, 2, 3, 4_
- Endpoint returns correct MIME type for each format
- Filename matches format: FirstName_LastName_CV.{pdf|docx}
- Authorization checks work correctly
- File downloads successfully

---

## Task 4: Frontend Export Triggers (staff-view.html)
- [ ] 4.1 Add export button/menu to staff profile view
  - [ ] Add \"Export CV\" button or dropdown in staff profile section
  - [ ] Button/dropdown triggers format selection (PDF or DOCX)
  - [ ] Position button near existing action buttons
  
- [ ] 4.2 Implement export trigger in `public/staff-view.js`
  - [ ] Create function: exportCV(staffId, format)
  - [ ] Create function: showExportOptions(staffId) — prompts user for format
  - [ ] Call window.location.href = `/api/cv/${staffId}/export?format=${format}`
  - [ ] Handle successful download (file appears in Downloads)
  - [ ] Provide user feedback (success/error toast or alert)

- [ ] 4.3 Style export UI
  - [ ] Match Dark Premium theme styling
  - [ ] Button padding and color consistent with existing buttons
  - [ ] Hover/active states styled
  - [ ] Mobile-responsive button size

**Acceptance Criteria:**
- _Requirements: 3_
- Export button visible on staff profile
- Clicking button initiates file download
- File downloads with correct name and format

---

## Task 5: Frontend Export Triggers (skills.html Search Results)
- [ ] 5.1 Add export button to skill search results table
  - [ ] Add \"Export CV\" button/action in results table for each staff member
  - [ ] Button calls exportCV(staffId, format) with format selection

- [ ] 5.2 Update `public/skills.js` to call existing export function
  - [ ] Reference exportCV function from staff-view.js or reuse
  - [ ] Trigger format selection when export button clicked

**Acceptance Criteria:**
- _Requirements: 3_
- Export button appears in search results
- Clicking triggers format selection
- File downloads from skill search context

---

## Task 6: Frontend Export Triggers (cv-profile.html)
- [ ] 6.1 Add download CV button to CV profile page
  - [ ] Add \"Download CV\" button on cv-profile.html own profile view
  - [ ] Show format options (PDF or DOCX)
  - [ ] Only allow staff to download own CV

- [ ] 6.2 Update `public/cv-profile.js`
  - [ ] Detect current logged-in staff ID
  - [ ] Call exportCV(staffId, format) for own CV
  - [ ] Verify user can't download others' CVs

**Acceptance Criteria:**
- _Requirements: 3_
- Download button visible on own CV profile
- Format selection presented
- Download restricted to own CV (no cross-user access)

---

## Task 7: PDF & DOCX File Format Testing
- [ ] 7.1 Test PDF generation
  - [ ] Generate sample PDF with all sections populated
  - [ ] Open PDF in Adobe Reader — verify readable, text-selectable
  - [ ] Check formatting: margins, fonts, page breaks
  - [ ] Verify content accuracy (matches database data)
  - [ ] Test with special characters in names (accents, etc)

- [ ] 7.2 Test DOCX generation
  - [ ] Generate sample DOCX with all sections populated
  - [ ] Open in Microsoft Word — verify fully editable
  - [ ] Edit content in Word — verify formatting preserved
  - [ ] Open in Google Docs — verify compatibility
  - [ ] Check table layout and styles applied

- [ ] 7.3 Test file naming
  - [ ] Verify filename format: FirstName_LastName_CV.pdf/docx
  - [ ] Test with names containing spaces, hyphens, accents
  - [ ] Verify special characters sanitized (removed or replaced)

**Acceptance Criteria:**
- _Requirements: 1, 2_
- PDFs are readable and text-selectable
- DOCX files are fully editable
- Filenames are valid and consistent

---

## Task 8: Integration & Authorization Testing
- [ ] 8.1 Test endpoint authorization
  - [ ] Admin user: Can export any staff CV ✓
  - [ ] HR user: Can export any staff CV ✓
  - [ ] SA/Pre-Sales user: Can export any staff CV ✓
  - [ ] Sales user: Can export any staff CV ✓
  - [ ] Staff user: Can only export own CV ✓
  - [ ] Staff user: Cannot export other staff CV (403) ✓
  - [ ] Coordinator user: Cannot export any CV (403) ✓
  - [ ] Unauthenticated user: Redirected to login ✓

- [ ] 8.2 Test data accuracy
  - [ ] Exported CV includes latest submission data
  - [ ] Skills with years_experience display correctly
  - [ ] Certification status shown (certified badge)
  - [ ] Project history limited to last 3 projects
  - [ ] Education section includes all entries

- [ ] 8.3 Test error cases
  - [ ] Invalid format param (docx2, pdf-color): 400 Bad Request
  - [ ] Non-existent staffId: 404 Not Found
  - [ ] Unauthorized access: 403 Forbidden
  - [ ] Database query failure: 500 Internal Server Error

**Acceptance Criteria:**
- _Requirements: 1, 2, 3, 4_
- All authorization checks pass
- Data accuracy verified
- Error handling works correctly

---

## Task 9: Performance & Load Testing
- [ ] 9.1 Measure export generation time
  - [ ] PDF generation: Target <2 seconds
  - [ ] DOCX generation: Target <2 seconds
  - [ ] Test with typical CV (5K characters, 10-15 skills, 5 projects)

- [ ] 9.2 Test with large dataset
  - [ ] Generate CV for staff with 50+ skills
  - [ ] Generate CV for staff with 20+ projects
  - [ ] Verify generation completes without timeout
  - [ ] Check file size: PDF <3MB, DOCX <1MB

- [ ] 9.3 Test concurrent exports
  - [ ] Simulate 5 simultaneous export requests
  - [ ] Verify no file conflicts or corruption
  - [ ] Check server resource usage (CPU, memory)

**Acceptance Criteria:**
- _Requirements: Non-Functional_
- PDF generation <2 seconds
- DOCX generation <2 seconds
- File sizes reasonable (<3MB PDF, <1MB DOCX)

---

## Task 10: Documentation & Cleanup
- [ ] 10.1 Update API documentation
  - [ ] Document GET /api/cv/:staffId/export endpoint
  - [ ] Include query parameters, response codes, examples
  - [ ] Document role-based authorization

- [ ] 10.2 Add code comments & docstrings
  - [ ] Comment CVExportService methods
  - [ ] Document cv-export.js endpoint
  - [ ] Add helper function documentation

- [ ] 10.3 Update README (if applicable)
  - [ ] Document CV export feature
  - [ ] Include npm dependencies needed
  - [ ] Note supported browsers/applications

**Acceptance Criteria:**
- _Requirements: 1_
- API documentation complete
- Code well-commented
- README updated with export feature info

---

## Dependencies
- Task 1 (Dependencies) must complete first
- Task 2 (Service) must complete before Task 3 (API)
- Task 3 (API) must complete before Tasks 4-6 (Frontend)
- Task 8 (Testing) verifies all previous tasks

## Traceability
- _Requirements: 1 (Export PDF), 2 (Export DOCX), 3 (Multiple locations), 4 (Permissions), 5 (Content customization)_
