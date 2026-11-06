// Made-up records for `npm run dev` with no database, so the page can be worked on. Not real parts, sites or jobs.
import { buildRecord, recordId } from './model.js'

const at = () => ({ toMillis: () => Date.parse('2026-11-01T09:00:00+13:00') })
const make = (kind, input) => { const r = buildRecord(kind, input); return { id: recordId(kind, r) || 'a-' + r.title.toLowerCase().replace(/\W/g, '').slice(0, 30), ...r, updatedByName: 'Dev User', updatedAt: at() } }

export function sampleRecords(kind) {
  if (kind === 'article') return [
    make('article', { title: 'Example: screen flickers after the 02.40 software update', category: 'Faults', tags: 'n17, display, software', parts: 'EX-1001',
      body: 'Seen on units updated from 02.30.\n\n**Fix:** update to 02.41, then recalibrate the display.\n\n- Check the ribbon cable (part EX-1001) is seated.\n- Do not downgrade: https://example.com/notes', reviewedAt: '2026-10-30' }),
    make('article', { title: 'Example: which SpO2 module goes with which monitor', category: 'Compatibility', tags: 'spo2, masimo, nellcor', body: 'Masimo and Nellcor modules are not interchangeable between the N12 and N17.' }),
  ]
  if (kind === 'part') return [
    make('part', { partNo: 'EX-1001', name: 'Display ribbon cable', aliases: 'screen cable, LCD flex', fits: 'N17, N12', notes: 'Made-up example part.' }),
    make('part', { partNo: 'EX-2002', name: 'Power supply board', aliases: 'PSU, power board', fits: 'N17' }),
  ]
  if (kind === 'device') return [
    make('device', { site: 'Example Hospital', dept: 'CCU', model: 'N17', serial: 'EX-A1', version: '02.41', extra: { 'SpO2 type': 'Masimo', WiFi: 'Yes' } }),
    make('device', { site: 'Example Hospital', dept: 'CCU', model: 'N17', serial: 'EX-A2', version: '02.40', extra: { 'SpO2 type': 'Masimo', WiFi: 'No' } }),
    make('device', { site: 'Example Hospital', dept: 'ED', model: 'N17', serial: 'EX-A3', version: '02.41', extra: { 'SpO2 type': 'Nellcor', WiFi: 'Yes' } }),
    make('device', { site: 'Sample Clinic', dept: 'Theatre', model: 'N12', serial: 'EX-B1', version: '02.30', extra: { 'SpO2 type': 'Nellcor' } }),
  ]
  return [
    make('job', { jobNo: '10001', title: 'N17 display flicker', notes: 'Replaced the display ribbon cable. Updated software to 02.41.', parts: 'EX-1001', model: 'N17', site: 'Example Hospital', date: '2026-09-12' }),
  ]
}
