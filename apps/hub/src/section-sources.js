// Every section of the one app and the file its screen starts from, relative to the repo root.
//
// Plain data on purpose: the build reads it in three places that cannot import the app's code
// (vite.config.js turns each file into its own build entry, scripts/build.mjs writes the section list
// into build-info.json, and the tests check it against router.js and App.jsx). App.jsx loads a
// section by id through sections.js; it never writes the file name itself, which is what keeps the
// shell's own file from changing whenever one section does (README "Updates: only what changed").
//
// A new section needs a line here, one in router.js SECTIONS and one `lazy(() => loadSection(id))`
// in App.jsx; tests/build-info.test.mjs fails if any of them is missing.
export const SECTION_SOURCES = {
  asks: 'apps/asks/src/section.jsx',
  projects: 'apps/projects/src/section.jsx',
  settings: 'apps/settings/src/section.jsx',
  'service-orders': 'apps/service-orders/src/section.jsx',
  maintenance: 'apps/maintenance/src/section.jsx',
  oncall: 'apps/oncall/src/section.jsx',
  service: 'apps/service-home/src/section.jsx',
  checklists: 'apps/checklists/src/section.jsx',
  knowledge: 'apps/knowledge/src/section.jsx',
  simprosync: 'apps/simprosync/src/section.jsx',
  simprosearch: 'apps/simprosearch/src/section.jsx',
  simprojobs: 'apps/simprojobs/src/section.jsx',
  ansurtopdf: 'apps/ansurtopdf/src/section.jsx',
  testbench: 'apps/testbench/src/section.jsx',
  'new-equipment': 'apps/testbench/src/newequip/section.jsx',
  'pdf-editor': 'apps/pdf-editor/src/section.jsx',
  logreader: 'apps/logreader/src/section.jsx',
  qr: 'apps/qr/src/section.jsx',
  equipment: 'apps/equipment/src/section.jsx',
  schedule: 'apps/schedule/src/section.jsx',
}
