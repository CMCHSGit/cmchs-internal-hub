// npm test --prefix apps/testbench — the ProSim 8 settings the bench can send (bench/index.html): every option in Fluke's
// ProSim 8 Communications Interface (revision 3.17), the "Add a command" picker, and that no existing template changed what it sends.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
const from = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `found ${a}`); return html.slice(i, j) }
const esc = (s) => String(s ?? '')
const pad = (n, w) => String(Math.round(Math.abs(+n))).padStart(w, '0')
const consts = from('const PERF = ', '/* field kinds')
const psTypes = from('  ps_nsr: {', '  ps_gauge: {')
const ctx = { esc, pad, icon: () => '', $: () => null, $$: () => [] }
const lib = vm.runInNewContext(`${consts}\nconst PS_TYPES = {\n${psTypes}\n};\n({ PERF, PACED, ARR, PROBES, PS_CATALOGUE, PS_TYPES, psCatalogueLine, psBuilderHtml, optionsHtml, SPO2_CMD, IBP_PCT_WAVES })`, ctx)
const { ARR, PERF, PS_CATALOGUE, PS_TYPES, psCatalogueLine, psBuilderHtml, optionsHtml, SPO2_CMD } = lib
const blocked = JSON.parse(html.match(/const PS_BLOCK = (\[.*?\]);/)[1].replace(/'/g, '"'))
const cmds = (type, over = {}) => [...PS_TYPES[type].cmds({ ...PS_TYPES[type].defaults(), ...over })]   // a plain array from this realm

test('steps with nothing changed send exactly what they always sent', () => {
  assert.deepEqual(cmds('ps_nsr'), ['NSRA=060', 'ECGAMPL=1.00', 'ECGRUN=TRUE'])
  assert.deepEqual(cmds('ps_nsr', { who: 'P', rate: 120 }), ['NSRP=120', 'ECGRUN=TRUE'])
  assert.deepEqual(cmds('ps_resp'), ['RESPRATE=020', 'RESPRUN=TRUE'])
  assert.deepEqual(cmds('ps_spo2'), ['SPO2TYPE=MINDR', 'SAT=097'])
  assert.deepEqual(cmds('ps_nibp'), ['NIBPP=120,080', 'NIBPRUN=TRUE'])
  assert.deepEqual(cmds('ps_ibp'), ['IBPS=1,+200'])
  assert.deepEqual(cmds('ps_ibp', { ch: '2', p: -5 }), ['IBPS=2,-005'])
  assert.deepEqual(cmds('ps_paced', { ampl: '010' }), ['TVPAMPL=V,010', 'TVPWAVE=ASY', 'ECGRUN=TRUE'])
  assert.deepEqual(cmds('ps_temp'), ['TEMP=37.0'])
})

test('every simulator step in every shipped template still sends a setting the simulator accepts', () => {
  const dir = new URL('../templates/', import.meta.url)
  let seen = 0
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const t = JSON.parse(readFileSync(new URL(f, dir), 'utf8'))
    for (const s of (t.template || t).steps || []) {
      const T = PS_TYPES[s.type]; if (!T) continue
      seen++
      const params = { ...T.defaults(), ...(s.params || {}) }
      for (const fld of T.fields.filter((x) => x.kind === 'select')) {
        const v = params[fld.key]
        assert.ok(fld.options.some((o) => String(o[0]) === String(v)), `${f}: ${s.type} ${fld.key}=${v} is one of the options`)
      }
      assert.ok(T.cmds(params).length > 0 && T.cmds(params).every((c) => /^[A-Z0-9]+(=[-+.\w]+(,[-+.\w]+)*)?$/.test(c)), `${f}: ${s.type} sends well-formed commands`)
    }
  }
  assert.ok(seen > 20, 'the templates were found')
})

test('every rhythm in the manual is on the list, in groups', () => {
  const want = ['SPVWAVE=AFL', 'SPVWAVE=MB120', 'SPVWAVE=PAT', 'SPVWAVE=NOD', 'PREWAVE=PNC', 'PREWAVE=PVC1E', 'PREWAVE=PVC1R', 'PREWAVE=PVC2', 'PREWAVE=PVC2E', 'PREWAVE=PVC2R', 'VNTWAVE=PVC12M', 'VNTWAVE=PVC24M', 'VNTWAVE=FMF', 'VNTWAVE=PAIR', 'VNTWAVE=RUN11', 'CNDWAVE=2DB2',
    'ACLSWAVE=SBC', 'ACLSWAVE=PTU', 'ACLSWAVE=MTU', 'ACLSWAVE=NSI', 'ACLSWAVE=NSV', 'ACLSWAVE=WSI', 'ACLSWAVE=WSV', 'ACLSWAVE=TDP', 'AFIB2=COARSE', 'VFIB2=FINE', 'MONOVTACH=120', 'MONOVTACH=300', 'POLYVTACH=1', 'POLYVTACH=5', 'EHAFIBS', 'EHAFIBF', 'EHAFL43', 'EHAFL150']
  for (const w of want) assert.ok(ARR.some((o) => o[0] === w), w)
  assert.ok(ARR.every((o) => o.length === 3 && o[2]), 'each is in a group')
  for (const w of ['SQUARE=0.125', 'TRI=0.125', 'SINE=150', 'PULSE=80']) assert.ok(PERF.some((o) => o[0] === w), w)
  const html1 = optionsHtml(ARR, 'ACLSWAVE=TDP')
  assert.match(html1, /<optgroup label="ACLS">/)
  assert.match(html1, /<option value="ACLSWAVE=TDP" selected>/)
  assert.doesNotMatch(optionsHtml([['A', 'a'], ['B', 'b']], 'B'), /optgroup/)
})

test('the other settings are sent in the manual\'s formats, and only when chosen', () => {
  assert.deepEqual(cmds('ps_nsr', { axis: 'HOR', stdev: '-0.10', art: '50', artsz: '025', artld: 'V1' }), ['NSRA=060', 'ECGAMPL=1.00', 'NSRAX=HOR', 'STDEV=-0.10', 'EART=50', 'EARTSZ=025', 'EARTLD=V1', 'ECGRUN=TRUE'])
  assert.ok(!cmds('ps_nsr', { who: 'P', stdev: '+0.10' }).some((c) => c.startsWith('STDEV')), 'ST deviation is adult only')
  assert.deepEqual(cmds('ps_det', { mode: 'RDET', width: 40, rate: '120' }), ['RDET=040,120', 'ECGRUN=TRUE'])
  assert.deepEqual(cmds('ps_det', { mode: 'QRS', width: 8, rate: '30' }), ['QRS=008,30', 'ECGRUN=TRUE'])
  assert.deepEqual(cmds('ps_det', { mode: 'TALLT', pct: '150' }), ['TALLT=150', 'ECGRUN=TRUE'])
  assert.deepEqual(cmds('ps_paced', { wave: 'AVS', polV: 'N', polA: 'P', ampl: '100', amplA: '050', widV: '0.5', widA: '2.0' }),
    ['TVPPOL=V,N', 'TVPPOL=A,P', 'TVPAMPL=V,100', 'TVPAMPL=A,050', 'TVPWID=V,0.5', 'TVPWID=A,2.0', 'TVPWAVE=AVS', 'ECGRUN=TRUE'])
  assert.deepEqual(cmds('ps_resp', { rate: 30, wave: 'VENT', ratio: '2', ampl: 1.5, base: '1000', lead: 'LL', apnea: 'FALSE' }),
    ['RESPWAVE=VENT', 'RESPRATIO=2', 'RESPAMPL=1.50', 'RESPBASE=1000', 'RESPLEAD=LL', 'RESPRATE=030', 'RESPAPNEA=FALSE', 'RESPRUN=TRUE'])
  assert.deepEqual(cmds('ps_spo2', { sat: 88, probe: 'NONIN810XSX', perf: 2.5, trans: 60, ambS: '2.0', ambF: 'DC', ambM: 'ON', respS: '5', respM: 'ON' }),
    ['SPO2TYPE=NONIN810XSX', 'SAT=088', 'PERF=02.50', 'TRANS=060.00', 'AMBS=2.0', 'AMBF=DC', 'AMBM=ON', 'RESPS=5', 'RESPM=ON'])
  assert.deepEqual(cmds('ps_nibp', { sys: 90, dia: 60, vol: '0.45', shift: '-05' }), ['NIBPP=090,060', 'NIBPV=0.45', 'NIBPES=-05', 'NIBPRUN=TRUE'])
  assert.deepEqual(cmds('ps_ibp', { ch: '2', p: 10, sns: '40' }), ['IBPSNS=2,40', 'IBPS=2,+010'])
  assert.deepEqual(cmds('ps_ibpd', { ch: '1', wave: 'PA', sys: 25, dia: 10, art: '5', sns: '5' }), ['IBPW=1,PA', 'IBPP=1,025,010', 'IBPARTM=1,5', 'IBPSNS=1,5'])
  assert.ok(cmds('ps_ibpd', { wave: 'ART', art: '10' }).includes('IBPARTP=1,10'), 'percent artifact for arterial waves')
  assert.deepEqual(cmds('ps_co', { base: '36', inj: '24', wave: 'FAULTY' }), ['COBASE=36', 'COINJ=24', 'COWAVE=FAULTY', 'CORUN=TRUE'])
  assert.deepEqual(cmds('ps_co', { run: false }), ['COBASE=37', 'COINJ=00', 'COWAVE=5'])
})

test('the command picker covers the manual and never offers a blocked command', () => {
  const have = new Set(PS_CATALOGUE.map((e) => e.cmd))
  const manual = ['ECGRUN', 'NSRA', 'NSRP', 'NSRAX', 'STDEV', 'ECGAMPL', 'EART', 'EARTSZ', 'EARTLD', 'SPVWAVE', 'PREWAVE', 'VNTWAVE', 'CNDWAVE', 'TVPPOL', 'TVPAMPL', 'TVPWID', 'TVPWAVE', 'ACLSWAVE', 'AFIB', 'AFIB2', 'VFIB', 'VFIB1', 'VFIB2', 'MONOVTACH', 'POLYVTACH', 'PULSE', 'SQUARE', 'SINE', 'TRI', 'RDET', 'QRS', 'TALLT',
    'EHAFIBS', 'EHAFIBF', 'EHAFL43', 'EHAFL50', 'EHAFL60', 'EHAFL75', 'EHAFL100', 'EHAFL150', 'RESPRUN', 'RESPWAVE', 'RESPRATE', 'RESPRATIO', 'RESPAMPL', 'RESPBASE', 'RESPLEAD', 'RESPAPNEA', 'IBPS', 'IBPW', 'IBPP', 'IBPARTP', 'IBPARTM', 'IBPSNS', 'TEMP', 'COBASE', 'COINJ', 'COWAVE', 'CORUN',
    'NIBPRUN', 'NIBPP', 'NIBPV', 'NIBPES', 'SAT', 'PERF', 'TRANS', 'AMBM', 'AMBS', 'AMBF', 'RESPM', 'RESPS', 'SPO2TYPE', 'SPO2UTYPE']
  for (const c of manual) assert.ok(have.has(c), `${c} is in the picker`)
  for (const e of PS_CATALOGUE) {
    const line = psCatalogueLine(e, [])
    assert.ok(/^[A-Z0-9]+(=[-+.\w]+(,[-+.\w]+)*)?$/.test(line), `${e.cmd}: ${line}`)
    assert.ok(!blocked.some((b) => line.startsWith(b)), `${line} is not blocked`)
  }
  assert.equal(psCatalogueLine(PS_CATALOGUE.find((e) => e.cmd === 'IBPS'), ['2', -5]), 'IBPS=2,-005')
  assert.equal(psCatalogueLine(PS_CATALOGUE.find((e) => e.cmd === 'RDET'), [40, '120']), 'RDET=040,120')
  assert.equal(psCatalogueLine(PS_CATALOGUE.find((e) => e.cmd === 'NIBPES'), ['+07']), 'NIBPES=+07')
  assert.equal(psCatalogueLine(PS_CATALOGUE.find((e) => e.cmd === 'EHAFIBS'), []), 'EHAFIBS')
  const idx = PS_CATALOGUE.findIndex((e) => e.cmd === 'TVPAMPL')
  assert.match(psBuilderHtml('x', idx), /TVPAMPL=A,000/)
  assert.ok(SPO2_CMD.test('SAT=097') && SPO2_CMD.test('AMBF=DC') && !SPO2_CMD.test('RESPRATE=020') && !SPO2_CMD.test('NSRA=060'), 'only the SpO2 module\'s settings go again with @')
})

test('the running step can change what it sends, for that test only, and the template editor has the picker', () => {
  assert.match(html, /Change what is sent <span class="muted">\(this test only; the template is not changed\)/)
  assert.match(html, /psAdjustHtml\(s, r\)/)
  assert.ok(html.includes('r.sent = false; r.changed = true; r.adjOpen = true;'), 'the picker marks the step changed')
  assert.match(html, /bindPsBuilder\(box, \(line\) =>/, 'template editor')
  assert.match(html, /bindPsBuilder\(adj, \(line\) =>/, 'while testing')
  assert.match(html, /case 'psbuilder'/)
  assert.ok(html.includes('r.sent = false; r.changed = true; hold(); this.psRefresh'), 'changing a setting pauses the step timer')
})
