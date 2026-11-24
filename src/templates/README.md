Built-in templates: one folder per template id with `template.json` and `index.js` (and/or `body.md`).
See `docs/TEMPLATES.md`. A workspace folder `templates/<id>/` with the same id overrides a built-in; without `index.js` it inherits this module.
`proposal` and `pricing-report` share `src/render/proposalTemplate.js`; their default sections live in `params.sections`.
