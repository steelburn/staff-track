# StaffTrack Skills Repository

Skills are on-demand workflows with bundled test scripts and documentation. They appear as `/` slash commands in VS Code Copilot Chat when mentored in prompts.

## Available Skills

### [API Data Validation](./api-data-validation/SKILL.md)
**Purpose:** Validate StaffTrack API endpoints and inspect data structures  
**Use when:** Testing endpoints, checking record counts, validating schemas, auditing data  
**Generates:** Automated test scripts with JWT token reuse  
**Output:** Record counts, data structures, JSON reports

**Example prompts:**
```
/api-data-validation check catalog endpoints
/api-data-validation test all endpoints and generate record count report
/api-data-validation validate submissions endpoint returns proper schema
```

## How to Create New Skills

1. Create a new folder in `.github/skills/<skill-name>/`
2. Add `SKILL.md` with YAML frontmatter and documentation
3. Bundle any supporting scripts, templates, or assets
4. Reference from the skill in your workflow prompts

## Skill Structure

```
.github/skills/
├── api-data-validation/
│   ├── SKILL.md              # Main skill definition
│   └── (supporting files)    # Scripts, templates, examples
└── README.md                 # This file
```

## Conventions

- **Skill name:** kebab-case in folder name, match `name:` in frontmatter
- **Description:** Start with action verb, include "Use when:" trigger phrases
- **Documentation:** Markdown with headings, examples, troubleshooting
- **Scripts:** Reference existing scripts or bundle new ones
- **Assets:** Keep self-contained within skill folder

## Running Skills

After a skill is created, you can reference it in chat:

```
# In VS Code Copilot Chat:
/api-data-validation test all endpoints
```

The skill will:
1. Load its documentation
2. Execute any bundled scripts
3. Generate artifacts (test results, reports, etc.)
4. Return formatted results

## For Team Members

If you need to:
- **Test API endpoints after changes** → Use `/api-data-validation`
- **Validate data schemas** → Use `/api-data-validation`
- **Check system health** → Use `/api-data-validation` with health check baseline
- **Generate API documentation** → Use `/api-data-validation`

## Contributing New Skills

When creating a new skill:

1. **Follow SKILL.md format** - See `api-data-validation/SKILL.md` as template
2. **Include trigger phrases** - Use "Use when:" pattern in description
3. **Test thoroughly** - Document expected outputs and edge cases
4. **Link to related skills** - Help users discover related workflows
5. **Add examples** - Show realistic usage and sample output

---

**Version:** 1.0  
**Last Updated:** 2026-04-05
