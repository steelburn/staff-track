# StaffTrack UI/UX Redesign — Design Specification

**Date:** 2026
**Status:** Draft — Pending Review
**Author:** StaffTrack Team

---

## 1. Overview

### 1.1 Problem Statement

The current StaffTrack UI suffers from:
- Inconsistent layout patterns across pages
- Horizontal navigation that overflows on mobile
- Emoji-only icons without a coherent icon system
- Cramped tables and forms lacking visual hierarchy
- No sidebar navigation option for complex page structures
- Inconsistent spacing, colors, and component styling

### 1.2 Goals

1. **Consistency** — Unified component library applied across all 11 pages
2. **Navigation** — Sidebar layout with collapsible menu for better page hierarchy
3. **Visual Hierarchy** — Clear typography scale, color system, and spacing tokens
4. **Mobile-First** — Responsive design that works on all devices without horizontal scroll
5. **Accessibility** — WCAG AA compliance with proper ARIA labels and focus indicators
6. **Dark Mode** — First-class dark theme support (not an afterthought)

### 1.3 Non-Goals

- No new features (UI/UX only)
- No backend changes
- No database schema changes
- No new third-party dependencies (except optional icon library)

---

## 2. Architecture

### 2.1 Layout System

**Current:** Header + Horizontal Nav + Content
**Proposed:** Sidebar + Header + Content

```
┌─────────────────────────────────────────────────────────────┐
│  ┌──────────┐  ┌──────────────────────────────────────────┐ │
│  │          │  │  Page Header                             │ │
│  │ Sidebar  │  │  - Title + Subtitle                      │ │
│  │          │  │  - Search + Filters + Actions             │ │
│  │ - Logo   │  ├──────────────────────────────────────────┤ │
│  │ - Nav    │  │                                          │ │
│  │ - User   │  │  Content Area                            │ │
│  │          │  │                                          │ │
│  └──────────┘  └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Sidebar Specifications:**
- Width: 260px (expanded), 72px (collapsed)
- Position: Fixed left, full height
- Collapse: 250ms cubic-bezier transition
- Mobile: Hidden by default, slide-in on hamburger click
- User card: Bottom of sidebar with avatar, name, role

### 2.2 Navigation Structure

```yaml
sidebar:
  sections:
    - label: "Main"
      items:
        - { icon: "📄", label: "My CV", href: "/cv-profile.html" }
        - { icon: "📋", label: "My Projects", href: "/index.html" }
        - { icon: "🗂", label: "Projects", href: "/projects.html", badge: 12 }
        - { icon: "📊", label: "Skills", href: "/skills.html" }
        - { icon: "🌳", label: "Org Chart", href: "/orgchart.html" }
        - { icon: "📈", label: "Gantt Charts", href: "/gantt.html", roles: ["admin", "hr", "coordinator"] }
    
    - label: "Management"
      items:
        - { icon: "👥", label: "All Staff", href: "/staff-view.html", roles: ["admin", "hr"] }
        - { icon: "⚙️", label: "Catalog", href: "/catalog.html", roles: ["admin"] }
        - { icon: "💻", label: "System", href: "/system.html", roles: ["admin"] }
        - { icon: "🛡️", label: "Admin", href: "/admin.html", roles: ["admin"] }
```

### 2.3 Page Header Pattern

Every page follows this template:

```html
<header class="page-header">
  <div class="page-header-top">
    <div>
      <h1 class="page-title">Page Title</h1>
      <p class="page-subtitle">Brief description of this page</p>
    </div>
    <div class="page-actions">
      <!-- Action buttons -->
    </div>
  </div>
  <div class="toolbar">
    <div class="search-box">...</div>
    <div class="filter-group">...</div>
    <div class="view-toggle">...</div>
  </div>
</header>
```

---

## 3. Design Tokens

### 3.1 Colors

**Light Mode:**
```css
--bg-base: #f8fafc;
--bg-surface: #ffffff;
--bg-muted: #f1f5f9;
--bg-hover: #f1f5f9;
--border: #e2e8f0;
--border-hover: #cbd5e1;
--primary: #6366f1;
--primary-hover: #4f46e5;
--primary-light: rgba(99, 102, 241, 0.1);
--success: #10b981;
--success-light: rgba(16, 185, 129, 0.1);
--warning: #f59e0b;
--warning-light: rgba(245, 158, 11, 0.1);
--danger: #ef4444;
--danger-light: rgba(239, 68, 68, 0.1);
--text-primary: #0f172a;
--text-secondary: #64748b;
--text-muted: #94a3b8;
```

**Dark Mode:**
```css
--bg-base: #0f172a;
--bg-surface: #1e293b;
--bg-muted: #334155;
--bg-hover: #334155;
--border: #334155;
--border-hover: #475569;
--primary: #818cf8;
--primary-hover: #6366f1;
--primary-light: rgba(129, 140, 248, 0.15);
--success: #34d399;
--success-light: rgba(52, 211, 153, 0.15);
--warning: #fbbf24;
--warning-light: rgba(251, 191, 36, 0.15);
--danger: #f87171;
--danger-light: rgba(248, 113, 113, 0.15);
--text-primary: #f1f5f9;
--text-secondary: #94a3b8;
--text-muted: #475569;
```

### 3.2 Typography

| Level | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| H1 | 24px | 700 | 1.3 | Page title |
| H2 | 18px | 600 | 1.4 | Section title |
| H3 | 15px | 600 | 1.4 | Card title |
| Body | 14px | 400 | 1.5 | Default text |
| Caption | 12px | 500 | 1.4 | Labels, metadata |
| Small | 11px | 600 | 1.3 | Badges, pills |

### 3.3 Spacing

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Tight spacing (badge padding) |
| sm | 8px | Component internal (input padding) |
| md | 12px | Card padding, gaps |
| lg | 16px | Section gaps, card padding |
| xl | 24px | Page padding, major gaps |
| 2xl | 32px | Page header padding |

### 3.4 Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| sm | 6px | Buttons, inputs, badges |
| md | 8px | Cards, modals |
| lg | 12px | Large cards, stat cards |
| xl | 16px | Modals |

### 3.5 Shadows

| Level | Light Mode | Dark Mode | Usage |
|-------|------------|-----------|-------|
| sm | `0 1px 2px rgba(0,0,0,0.05)` | `0 1px 3px rgba(0,0,0,0.3)` | Subtle lift |
| md | `0 4px 6px rgba(0,0,0,0.07)` | `0 4px 12px rgba(0,0,0,0.4)` | Cards on hover |
| lg | `0 10px 25px rgba(0,0,0,0.1)` | `0 10px 30px rgba(0,0,0,0.5)` | Modals, dropdowns |

---

## 4. Component Specifications

### 4.1 Buttons

**Primary Button:**
- Background: var(--primary)
- Text: White
- Padding: 10px 18px
- Border-radius: 8px
- Font: 14px, weight 600
- Hover: Background var(--primary-hover), translateY(-1px), shadow-md
- Active: translateY(0)

**Secondary Button:**
- Background: var(--bg-surface)
- Text: var(--text-primary)
- Border: 1px solid var(--border)
- Padding: 10px 18px
- Border-radius: 8px
- Hover: Border var(--border-hover), background var(--bg-muted)

**Ghost Button:**
- Background: transparent
- Text: var(--text-secondary)
- Padding: 10px 18px
- Border-radius: 8px
- Hover: Background var(--bg-hover), color var(--text-primary)

**Danger Button:**
- Background: var(--danger-light)
- Text: var(--danger)
- Hover: Background var(--danger), color white

**Sizes:**
- Default: 10px 18px padding, 14px font
- Small: 6px 12px padding, 13px font
- Icon: 10px padding, square

### 4.2 Inputs

**Text Input:**
- Background: var(--bg-surface)
- Border: 1px solid var(--border)
- Padding: 10px 14px
- Border-radius: 8px
- Font: 14px, color var(--text-primary)
- Focus: Border var(--primary), box-shadow 0 0 0 3px rgba(99,102,241,0.1)
- Placeholder: var(--text-muted)
- Readonly: Background var(--bg-muted), color var(--text-muted)

### 4.3 Cards

**Data Card:**
- Background: var(--bg-surface)
- Border: 1px solid var(--border)
- Border-radius: 12px
- Overflow: hidden
- Hover: shadow-md, border-color var(--border-hover), translateY(-2px)

**Card Sections:**
- Header: 16px 20px padding, border-bottom
- Body: 16px 20px padding
- Footer: 12px 20px padding, bg-muted, border-top

### 4.4 Tables

**Table Container:**
- Background: var(--bg-surface)
- Border: 1px solid var(--border)
- Border-radius: 12px
- Overflow: hidden

**Table Header:**
- Background: var(--bg-muted)
- Font: 11px, weight 600, uppercase, letter-spacing 0.05em
- Color: var(--text-secondary)
- Padding: 12px 16px
- Border-bottom: 1px solid var(--border)

**Table Cell:**
- Padding: 14px 16px
- Font: 14px, color var(--text-primary)
- Border-bottom: 1px solid var(--border)

**Table Row Hover:**
- Background: var(--bg-hover)

### 4.5 Badges / Status

**Status Badge:**
- Display: inline-flex, align-items center, gap 6px
- Padding: 4px 10px
- Border-radius: 20px
- Font: 12px, weight 600
- Dot: 6px circle before text

**Status Colors:**
- Active: success-light background, success text
- Pending: warning-light background, warning text
- Inactive: bg-muted background, text-muted text

### 4.6 Tags / Pills

**Tag:**
- Display: inline-flex
- Padding: 4px 10px
- Background: var(--bg-muted)
- Border-radius: 6px
- Font: 12px, weight 500, color var(--text-secondary)

**Tag Variants:**
- Primary: primary-light background, primary text
- Success: success-light background, success text
- Warning: warning-light background, warning text

### 4.7 Modal

**Backdrop:**
- Position: fixed, inset 0
- Background: rgba(0,0,0,0.5)
- Backdrop-filter: blur(4px)
- Transition: opacity 200ms

**Modal:**
- Background: var(--bg-surface)
- Border: 1px solid var(--border)
- Border-radius: 16px
- Width: 90%, max-width 520px
- Max-height: 85vh
- Box-shadow: var(--shadow-lg)
- Transform: scale(0.95) → scale(1)

**Modal Header:**
- Padding: 20px 24px
- Border-bottom: 1px solid var(--border)
- Title: 18px, weight 600

**Modal Body:**
- Padding: 24px
- Overflow-y: auto

**Modal Footer:**
- Padding: 16px 24px
- Border-top: 1px solid var(--border)
- Display: flex, justify-content flex-end, gap 12px

### 4.8 Toast Notifications

**Toast Container:**
- Position: fixed, bottom 24px, right 24px
- Z-index: 2000
- Display: flex, flex-direction column, gap 8px

**Toast:**
- Display: flex, align-items center, gap 12px
- Padding: 14px 20px
- Background: var(--bg-surface)
- Border: 1px solid var(--border)
- Border-radius: 10px
- Box-shadow: var(--shadow-lg)
- Animation: toastSlideIn 300ms

**Toast Variants:**
- Success: border-left 3px solid var(--success)
- Error: border-left 3px solid var(--danger)

---

## 5. Responsive Breakpoints

| Breakpoint | Width | Sidebar | Grid | Navigation |
|------------|-------|---------|------|------------|
| Mobile | < 768px | Hidden (hamburger) | 1 column | Slide-in drawer |
| Tablet | 768-1024px | Collapsible | 2 columns | Collapsed sidebar |
| Desktop | > 1024px | Full width | 3-4 columns | Full sidebar |

---

## 6. Animations

| Element | Property | Duration | Easing |
|---------|----------|----------|--------|
| Sidebar collapse | width | 250ms | cubic-bezier(0.4, 0, 0.2, 1) |
| Card hover | transform, box-shadow | 200ms | ease |
| Button hover | transform, box-shadow | 150ms | ease |
| Modal open | transform, opacity | 200ms | ease |
| Dropdown open | transform, opacity | 150ms | ease |
| Toast slide-in | transform, opacity | 300ms | ease |
| Page content | opacity | 200ms | ease |

---

## 7. Accessibility Requirements

### 7.1 Keyboard Navigation
- All interactive elements focusable via Tab
- Visible focus indicators (2px outline, var(--primary))
- Escape closes modals and dropdowns
- Arrow keys navigate within components

### 7.2 ARIA Labels
- Icon-only buttons: aria-label="Button description"
- Navigation: role="navigation", aria-label="Main navigation"
- Modals: role="dialog", aria-modal="true", aria-labelledby
- Status badges: aria-label="Status: Active"

### 7.3 Color Contrast
- Text on background: ≥ 4.5:1 ratio
- Large text on background: ≥ 3:1 ratio
- Interactive elements: ≥ 3:1 ratio
- Never use color alone to convey information

### 7.4 Screen Reader Support
- Semantic HTML (nav, main, header, section)
- Alt text for images
- Form labels associated with inputs
- Live regions for dynamic content

---

## 8. Implementation Plan

### Phase 1: Foundation (Week 1-2)
- [ ] Create design token CSS file (tokens.css)
- [ ] Build sidebar component (sidebar.js, sidebar.css)
- [ ] Create layout wrapper (layout.css)
- [ ] Build button component library
- [ ] Build input component library
- [ ] Build card component library

### Phase 2: Core Pages (Week 3-4)
- [ ] Login page redesign
- [ ] Dashboard/My Projects (index.html)
- [ ] CV Profile (cv-profile.html)
- [ ] Integrate sidebar navigation

### Phase 3: Data Views (Week 5-6)
- [ ] Projects view (projects.html)
- [ ] Staff view (staff-view.html)
- [ ] Skills catalog (skills.html)

### Phase 4: Admin & Polish (Week 7-8)
- [ ] Admin pages (admin.html, catalog.html, system.html)
- [ ] Org Chart page (orgchart.html)
- [ ] Gantt Charts page (gantt.html)
- [ ] Accessibility audit
- [ ] Performance optimization
- [ ] Cross-browser testing

---

## 9. File Structure

```
/public
├── css/
│   ├── tokens.css          # Design tokens
│   ├── base.css            # Reset and base styles
│   ├── components.css      # Component library
│   ├── layout.css          # Layout (sidebar, main)
│   └── pages/              # Page-specific styles
│       ├── login.css
│       ├── dashboard.css
│       ├── cv-profile.css
│       ├── projects.css
│       ├── staff-view.css
│       ├── skills.css
│       └── admin.css
├── js/
│   ├── sidebar.js          # Sidebar component
│   ├── theme.js            # Theme manager (existing)
│   └── components/         # Reusable components
│       ├── modal.js
│       ├── toast.js
│       └── table.js
└── [existing HTML files]
```

---

## 10. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Visual Consistency | 100% pages use shared components | Code review |
| Mobile Usability | 0 horizontal scroll < 768px | Testing |
| Accessibility | WCAG AA compliance | Audit tool |
| Performance | Lighthouse > 90 | Lighthouse |
| Code Reuse | > 80% component usage | Code analysis |

---

## 11. Proof of Concept

The file `poc-redesign.html` demonstrates:
- Sidebar navigation with collapse
- Stats overview cards
- Project cards with avatars and tags
- Table with status badges
- Empty state design
- Modal dialog
- Toast notifications
- Button/input component library
- Dark mode toggle
- Responsive behavior

**To view:** Open `/public/poc-redesign.html` in a browser.

---

## 12. Open Questions

1. Should we use an icon library (e.g., Lucide, Heroicons) or keep emoji icons?
2. Should the sidebar be collapsible by default on desktop?
3. Should we add breadcrumbs for nested navigation?
4. Should we implement skeleton loading states?

---

*Document Version: 1.0*
*Last Updated: 2026*
