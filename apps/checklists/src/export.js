/* Project checklists — downloading a list. Browser only (a Blob and a link); the rows themselves come from model.js. */
import { EXPORT_HEADERS, exportRows, fileSafe, summarise, toCsv } from './model.js'

function save(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

const stampForName = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const exportName = (listName, ext) => `${fileSafe(listName)}-${stampForName()}.${ext}`

export function downloadCsv(listName, items) {
  save(new Blob([toCsv(EXPORT_HEADERS, exportRows(items))], { type: 'text/csv;charset=utf-8' }), exportName(listName, 'csv'))
}

/** An Excel workbook: the devices on one sheet (frozen header, filters), the count by department on another. */
export async function downloadXlsx(listName, items) {
  const { default: ExcelJS } = await import('exceljs') // loaded only when someone exports
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CHS Internal Hub'
  wb.created = new Date()

  const ws = wb.addWorksheet('Devices', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.addRow(EXPORT_HEADERS)
  exportRows(items).forEach((r) => ws.addRow(r))
  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF554596' } }
  head.alignment = { vertical: 'middle', wrapText: true }
  ws.columns.forEach((col, i) => {
    let w = EXPORT_HEADERS[i].length
    col.eachCell({ includeEmpty: false }, (c) => { w = Math.max(w, Math.min(String(c.value ?? '').length, 40)) })
    col.width = w + 2
  })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_HEADERS.length } }

  const s = summarise(items)
  const dep = wb.addWorksheet('By department', { views: [{ state: 'frozen', ySplit: 1 }] })
  dep.addRow(['Department', 'Devices', 'Done', 'Couldn’t find', 'To do'])
  s.departments.forEach((d) => dep.addRow([d.name || 'No department', d.total, d.done, d.notfound, d.total - d.done - d.notfound]))
  dep.addRow(['Total', s.total, s.done, s.notfound, s.todo])
  dep.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  dep.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF554596' } }
  dep.getRow(dep.rowCount).font = { bold: true }
  dep.columns.forEach((c, i) => { c.width = i ? 14 : 26 })

  const buf = await wb.xlsx.writeBuffer()
  save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName(listName, 'xlsx'))
}
