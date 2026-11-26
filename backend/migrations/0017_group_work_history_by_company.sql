UPDATE cv_templates
SET markdown_template = REPLACE(
  markdown_template,
  '{{section:workHistory}}## Work History\n\n{{#workHistory}}\n**{{employer}}** — {{job_title}} ({{start_date}} – {{end_date}})\n\n{{description}}\n\n{{/workHistory}}\n\n---\n\n{{/section:workHistory}}',
  '{{section:workHistory}}## Work History\n\n{{#workHistoryGrouped}}\n**{{employer}}** ({{start_date}} – {{end_date}})\n\n{{#positions}}\n↳ **{{job_title}}** · {{start_date}} – {{end_date}}\n\n{{description}}\n\n{{/positions}}\n{{/workHistoryGrouped}}\n\n---\n\n{{/section:workHistory}}'
)
WHERE markdown_template LIKE '%{{#workHistory}}%';

UPDATE cv_templates
SET markdown_template = REPLACE(
  markdown_template,
  '{{section:workHistory}}## Experience\n{{#workHistory}}\n{{employer}} — {{job_title}} | {{start_date}} – {{end_date}}\n{{description}}\n{{/workHistory}}\n{{/section:workHistory}}',
  '{{section:workHistory}}## Experience\n{{#workHistoryGrouped}}\n**{{employer}}** | {{start_date}} – {{end_date}}\n{{#positions}}\n↳ {{job_title}} ({{start_date}} – {{end_date}}){{#description}} — {{description}}{{/description}}\n{{/positions}}\n{{/workHistoryGrouped}}\n{{/section:workHistory}}'
)
WHERE markdown_template LIKE '%{{#workHistory}}%';
