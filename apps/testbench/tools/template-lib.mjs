// Shared by tools/check-templates.mjs, tools/new-template.mjs and tests/template-tools.test.mjs: what a Test Bench template may contain, read
// from the bench page itself (bench/index.html) so this never drifts from it, and the checks on a template file.
//
// Two levels of finding:
//   errors   - the bench would drop, ignore or refuse something, or the template breaks a rule in tests/templates.test.mjs
//   warnings - unfinished (TODO left in), unusual, or something a person should look at (a limit that is not the AS/NZS 3551 one)
// Older templates (LEGACY) get the structure checks only, like tests/templates.test.mjs, because their limits come from the old Ansur
// templates and changing them is Jonathan's decision (docs/bench-notes.md §11).
import { readFileSync } from 'node:fs'

const BENCH = new URL('../bench/index.html', import.meta.url)
export const TEMPLATES_DIR = new URL('../templates/', import.meta.url)

/** Keep in step with LEGACY in tests/templates.test.mjs. */
export const LEGACY = ['Medical power supply', 'A7 Anaesthetic', 'A9 Anaesthetic', 'D30-D60', 'Patient Monitor and OR Modules', 'Patient monitor.json']
export const isLegacy = (file) => LEGACY.some((l) => String(file).includes(l))

export const TEMPLATE_FILE_SUFFIX = ' - Test Bench template.json'

/** What the bench page knows: step types (with their group), applied-part leads, leakage conditions, insulation targets, colours, blocked ProSim commands. */
export function benchVocabulary(source = readFileSync(BENCH, 'utf8')) {
  const html = source.replace(/\r\n/g, '\n')   // the file has CRLF line ends on some checkouts
  const block = (start, endRe) => { const i = html.indexOf(start); if (i < 0) throw new Error(`bench/index.html: can't find ${start}`); const rest = html.slice(i + start.length); const m = rest.match(endRe); return m ? rest.slice(0, m.index) : rest }
  const types = {}
  for (const m of block('const TYPES = {', /\n};\n/).matchAll(/^ {2}(\w+): \{ group: '(\w+)'/gm)) types[m[1]] = m[2]
  const keysOf = (start) => [...block(start, /\n\};?\n/).matchAll(/^ {2}(\w+): ?\{/gm)].map((m) => m[1])
  const list = (re) => { const m = html.match(re); if (!m) throw new Error(`bench/index.html: can't find ${re}`); return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) }
  const colours = html.match(/const HL_COLOURS = \{([^}]*)\}/)
  return {
    types,
    leads: list(/const LEADS = \[([^\]]*)\]/),
    conds: keysOf('const CONDS = {'),
    insTargets: keysOf('const INS_TARGETS = {'),
    colours: colours ? [...colours[1].matchAll(/(\w+):/g)].map((m) => m[1]) : [],
    psBlock: list(/const PS_BLOCK = \[([^\]]*)\]/),
  }
}

const TOP_KEYS = ['id', 'name', 'desc', 'category', 'highlight', 'manufacturer', 'color', 'updated', 'models', 'showNA', 'esaAuto', 'esaHalt', 'appliedParts', 'dut', 'steps']
const STEP_KEYS = ['id', 'type', 'title', 'instructions', 'images', 'hold', 'params', 'models']
const AP_CLASSES = ['B', 'BF', 'CF']
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const blank = (v) => v === '' || v == null
const hasLimit = (c) => !blank(c.lo) || !blank(c.hi)
const strs = (x) => (typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(strs) : x && typeof x === 'object' ? Object.values(x).flatMap(strs) : [])
/** The words in a template that could be about a person: NHI-shaped numbers (three letters, four digits) and email addresses. Warned about, never quoted. */
const NHI = /\b[A-HJ-NP-Z]{3}\d{4}\b/i, EMAIL = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/

/**
 * Check one template file's parsed JSON. `file` is its name (it decides whether the older-template rules apply).
 * Returns { errors: [string], warnings: [string] }. Messages name the step and say what to change; they never repeat suspected personal data.
 */
export function checkTemplate(json, file = '', vocab = benchVocabulary(), { legacy = isLegacy(file) } = {}) {
  const errors = [], warnings = []
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m)
  if (!json || typeof json !== 'object') { err('not a template file'); return { errors, warnings } }
  if (json.format !== 'chs-test-bench-template') err(`format must be "chs-test-bench-template" (it is ${JSON.stringify(json.format)})`)
  if (json.version !== 1) warn(`version is ${JSON.stringify(json.version)}; the bench writes 1`)
  const t = json.template
  if (!t || typeof t !== 'object') { err('no "template" object'); return { errors, warnings } }

  for (const k of Object.keys(t)) if (!TOP_KEYS.includes(k)) warn(`unknown template field "${k}" (the bench ignores it)`)
  if (!t.name || typeof t.name !== 'string' || !t.name.trim()) err('the template has no name')
  if (!t.desc || typeof t.desc !== 'string' || !t.desc.trim()) err('the template has no description (desc): say where its limits come from')
  if (!Array.isArray(t.dut) || t.dut[0] !== 'Serial number') err('dut must be a list starting with "Serial number"')
  else if (!t.dut.some((k) => /^testing engineer/i.test(String(k).trim()))) err('dut has no "Testing engineer"')
  if (t.color != null && t.color !== 'none' && !vocab.colours.includes(t.color)) err(`color "${t.color}" is not one the bench has (${vocab.colours.join(', ')})`)
  if (t.highlight != null && typeof t.highlight !== 'boolean') err('highlight must be true or false')
  for (const k of ['showNA', 'esaAuto', 'esaHalt']) if (t[k] != null && typeof t[k] !== 'boolean') err(`${k} must be true or false`)

  // Models
  const models = t.models == null ? [] : t.models
  if (!Array.isArray(models) || models.some((m) => typeof m !== 'string' || !m.trim())) err('models must be a list of model names')

  // Applied parts
  const aps = t.appliedParts
  if (aps != null && !Array.isArray(aps)) err('appliedParts must be a list')
  for (const g of Array.isArray(aps) ? aps : []) {
    const n = g && g.name ? `applied part "${g.name}"` : 'an applied part'
    if (!g || !g.name) err('an applied part group has no name')
    if (!g || !AP_CLASSES.includes(g.apclass)) err(`${n}: apclass must be B, BF or CF (the bench would make it CF)`)
    const leads = g && Array.isArray(g.leads) ? g.leads : []
    if (!leads.length) err(`${n} has no lead: the first group goes on RA, the second on LA`)
    for (const l of leads) if (!vocab.leads.includes(l)) err(`${n}: lead "${l}" is not one of ${vocab.leads.join(', ')} (the bench drops it)`)
  }

  // Steps
  const steps = t.steps
  if (!Array.isArray(steps) || !steps.length) { err('the template has no steps'); return { errors, warnings } }
  const ids = new Set(), seenIns = new Set(), esaPos = []
  steps.forEach((s, i) => {
    const at = s && s.id ? `step "${s.id}"` : `step ${i + 1}`
    if (!s || typeof s !== 'object') { err(`${at} is not a step`); return }
    for (const k of Object.keys(s)) if (!STEP_KEYS.includes(k)) warn(`${at}: unknown field "${k}" (the bench ignores it)`)
    if (!vocab.types[s.type]) { err(`${at}: type "${s.type}" is not one the bench has, so the bench drops the step`); return }
    if (!legacy) {
      if (!s.id) err(`step ${i + 1} (${s.title || s.type}) has no id: ids must be fixed so autosave and Reload template can match steps`)
      else if (ids.has(s.id)) err(`${at}: the id is used twice`)
      ids.add(s.id)
    }
    if (!s.title || !String(s.title).trim()) err(`${at}: no title`)
    const p = s.params
    if (!p || typeof p !== 'object') { err(`${at}: no params`); return }
    if (s.models != null) {
      if (!Array.isArray(s.models)) err(`${at}: models must be a list`)
      else {
        if (models.length < 2) err(`${at}: names models but the template lists fewer than two`)
        for (const m of s.models) if (!models.includes(m)) err(`${at}: model "${m}" is not in the template's models`)
      }
    }
    const group = vocab.types[s.type]
    if (group === 'esa') esaPos.push(i)
    if (s.type === 'check') {
      const items = p.items || [], readings = p.readings || []
      if (!Array.isArray(items) || items.some((x) => typeof x !== 'string' || !x.trim())) err(`${at}: checklist items must be non-empty text`)
      if (!(Array.isArray(items) && items.length) && !(Array.isArray(readings) && readings.length)) err(`${at}: a checklist with nothing to check`)
      for (const r of Array.isArray(readings) ? readings : []) { if (!r.label) err(`${at}: a reading has no label`); else if (!hasLimit(r)) err(`${at}: reading "${r.label}" has no limit`) }
    } else if (s.type === 'numeric') {
      if (!p.label) err(`${at}: no label for the measured value`)
    } else if (group === 'ps') {
      const m = p.monitor
      if (m && m.enabled && !m.label) err(`${at}: the monitor check has no label`)
      for (const x of p.extra || []) if (!x.label) err(`${at}: a "more checks" entry has no label`)
      if (s.type === 'ps_custom') {
        for (const line of String(p.text || '').split(/\r?\n/).map((l) => l.trim().toUpperCase().replace(/\s+/g, '')).filter(Boolean)) {
          const bad = vocab.psBlock.find((b) => line.replace(/^@/, '').startsWith(b))
          if (bad) err(`${at}: the ProSim command ${bad} is blocked by the bench`)
        }
        if (!String(p.text || '').trim()) warn(`${at}: custom commands step with no commands`)
      }
    } else if (s.type === 'esa_ins') {
      if (!vocab.insTargets.includes(p.target)) err(`${at}: insulation target "${p.target}" is not one of ${vocab.insTargets.join(', ')}`)
      else if (seenIns.has(p.target)) err(`${at}: insulation test ${p.target} is in the template twice`)
      seenIns.add(p.target)
      if (!['HIGH', 'LOW'].includes(p.volts)) err(`${at}: volts must be HIGH (500 V) or LOW (250 V)`)
    } else if (s.type === 'esa_earthl' || s.type === 'esa_encl') {
      const allowed = s.type === 'esa_earthl' ? ['NC', 'ON', 'RNC', 'RON'] : vocab.conds
      if (!Array.isArray(p.conds) || !p.conds.length) err(`${at}: no conditions`)
      for (const c of Array.isArray(p.conds) ? p.conds : []) {
        if (!allowed.includes(c.c)) err(`${at}: condition "${c.c}" is not allowed here (${allowed.join(', ')})`)
        if (!isNum(c.hi)) err(`${at}: condition ${c.c} needs a numeric limit in µA`)
      }
    } else if (s.type === 'esa_pe') {
      if (!isNum(p.hi)) err(`${at}: the maximum resistance must be a number`)
    } else if (s.type === 'esa_pat' || s.type === 'esa_map') {
      if (!['together', 'each'].includes(p.mode)) err(`${at}: mode must be "together" or "each"`)
      if (s.type === 'esa_pat') { if (!Array.isArray(p.conds) || !p.conds.every((c) => vocab.conds.includes(c.c))) err(`${at}: conditions must be from ${vocab.conds.join(', ')}`) }
      else if (!Array.isArray(p.pols) || !p.pols.length || !p.pols.every((x) => ['NORM', 'REV'].includes(x))) err(`${at}: pols must be NORM and/or REV`)
      if (!(Array.isArray(aps) && aps.length)) err(`${at}: leakage on applied parts needs applied parts in the template`)
    }
  })
  if (esaPos.length > 1 && esaPos[esaPos.length - 1] - esaPos[0] !== esaPos.length - 1 && !legacy) err('the ESA612 steps must be one block (the auto sequence runs neighbouring ESA steps together): move the other steps before or after it')

  // Limits: AS/NZS 3551:2012+A2 as the other current CHS templates use them (tests/templates.test.mjs). Reported, never changed.
  if (!legacy) {
    for (const [i, s] of steps.entries()) {
      const at = s && s.id ? `step "${s.id}"` : `step ${i + 1}`, p = (s && s.params) || {}
      if (s.type === 'esa_pe' && isNum(p.hi) && p.hi > 0.2) err(`${at}: protective earth limit ${p.hi} ohm is over 0.2 ohm (AS/NZS 3551 B8.6)`)
      if (s.type === 'esa_ins' && ['MINS', 'MAINS_NE', 'MAINS_AP'].includes(p.target) && p.lo !== 1) err(`${at}: ${p.target} insulation should be at least 1 MΩ (B9.3); it is ${blank(p.lo) ? 'recorded only' : p.lo}`)
      if (s.type === 'esa_earthl') for (const c of p.conds || []) { const want = { NC: 5000, ON: 10000 }[c.c]; if (want && c.hi !== want) err(`${at}: earth leakage ${c.c} should be ${want} µA (B11.6); it is ${c.hi}`) }
      if (s.type === 'esa_encl') for (const c of p.conds || []) { const want = { NC: 100, ON: 500, OE: 500 }[c.c]; if (want && c.hi !== want) warn(`${at}: enclosure ${c.c} limit is ${c.hi} µA; AS/NZS 3551 B10.5 has ${want}. Leave it only if a manual says otherwise, and say so in desc`) }
    }
  }

  // Unfinished or suspicious text
  const text = strs({ name: t.name, desc: t.desc, dut: t.dut, models: t.models, appliedParts: t.appliedParts, steps: steps.map((s) => s && { title: s.title, instructions: s.instructions, params: s.params }) })
  const todo = text.filter((x) => /\bTODO\b/.test(x)).length
  if (todo) warn(`TODO is still in the text in ${todo} place${todo === 1 ? '' : 's'}: finish ${todo === 1 ? 'it' : 'them'} before the template goes to SharePoint`)
  if (text.some((x) => NHI.test(x))) warn('some text looks like an NHI number. Templates must never hold patient information (QP33): check the wording')
  if (text.some((x) => EMAIL.test(x))) warn('some text looks like an email address: check it is not a person’s')
  const dupTitles = steps.map((s) => s && s.title).filter((x, i, a) => x && a.indexOf(x) !== i)
  if (dupTitles.length) warn(`two steps have the same title: ${[...new Set(dupTitles)].map((x) => `"${x}"`).join(', ')} (Reload template matches by id, then title)`)
  return { errors, warnings }
}

/** Read and check a template file by URL or path. A file that is not valid JSON is one error. */
export function checkTemplateFile(path, vocab) {
  const file = String(path).split(/[\\/]/).pop()
  let json
  try { json = JSON.parse(readFileSync(path, 'utf8')) } catch (e) { return { file, errors: [`not valid JSON: ${e.message}`], warnings: [] } }
  return { file, ...checkTemplate(json, file, vocab) }
}
