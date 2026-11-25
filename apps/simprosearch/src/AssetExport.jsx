/* "Export customer assets": every customer asset in Simpro (or one asset type), one row each with every custom field, saved on this
   computer as an Excel workbook or a CSV. For building the master asset list and checking customers' own equipment lists against it.
   Read only (assets.js): nothing is written to Simpro. Stop saves what has been read so far. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button } from '../../../shared/ui/index.jsx'
import { logActivity } from '../../../shared/activity.js'
import { PROXY_URL } from '../../../shared/proxy.js'
import { auth } from '../../schedule/src/firebase.js'
import { SendError, ok } from '../../testbench/src/simpro-api.js'
import { makeBatchGet } from './bulk.js'
import { assetTable, bySite, exportAssets, toCsv } from './assets.js'

const n = (v) => Number(v).toLocaleString('en-NZ')
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function save(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/** The workbook: the assets (every cell as text, so serials like 00123 keep their zeros), and a count by site. */
async function workbook(table, sites, { customers, note }) {
  const { default: ExcelJS } = await import('exceljs') // loaded only when someone exports
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CHS Internal Hub'
  wb.created = new Date()
  const head = (ws) => {
    const r = ws.getRow(1)
    r.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF554596' } }
  }
  const ws = wb.addWorksheet('Assets', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] })
  ws.addRow(table.headers)
  for (const row of table.rows) ws.addRow(row).eachCell({ includeEmpty: false }, (c) => { c.numFmt = '@' })
  head(ws)
  ws.columns.forEach((col, i) => {
    let w = table.headers[i].length
    col.eachCell({ includeEmpty: false }, (c) => { w = Math.max(w, Math.min(String(c.value ?? '').length, 40)) })
    col.width = w + 2
  })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.headers.length } }

  const s = wb.addWorksheet('By site', { views: [{ state: 'frozen', ySplit: 1 }] })
  s.addRow(['Site ID', 'Site', ...(customers ? ['Customer'] : []), 'Assets'])
  for (const x of sites) s.addRow([x.siteId, x.site, ...(customers ? [x.customer] : []), x.count])
  head(s)
  s.columns.forEach((c, i) => { c.width = i === 0 ? 10 : i === s.columnCount - 1 ? 10 : 36 })
  if (note) { s.addRow([]); s.addRow([note]) }
  return wb.xlsx.writeBuffer()
}

export default function AssetExport({ call, companyId }) {
  const batchGet = useMemo(() => makeBatchGet({
    proxyUrl: PROXY_URL,
    getToken: async () => {
      if (!auth?.currentUser) throw new SendError('Sign in to the hub to use Simpro.', false)
      return auth.currentUser.getIdToken()
    },
  }), [])
  const [types, setTypes] = useState([])
  const [typeId, setTypeId] = useState('')
  const [archived, setArchived] = useState(false)
  const [format, setFormat] = useState('xlsx')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [message, setMessage] = useState(null)
  const stop = useRef(false)

  // The company's asset types, for narrowing the export to one. Only asked for once the panel is opened.
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    if (!opened || !companyId) return
    let live = true
    setTypes([]); setTypeId('')
    call('GET', `/companies/${companyId}/setup/assetTypes/?pageSize=250`)
      .then((r) => { if (live && ok(r) && Array.isArray(r.data)) setTypes(r.data.filter((t) => t && t.ID != null).sort((a, b) => String(a.Name).localeCompare(String(b.Name), 'en-NZ'))) })
      .catch(() => {})
    return () => { live = false }
  }, [opened, call, companyId])

  async function run() {
    stop.current = false
    setBusy(true); setMessage(null); setProgress('Asking Simpro for the customer assets…')
    try {
      const out = await exportAssets({
        batchGet, companyId, typeId, includeArchived: archived,
        isCancelled: () => stop.current,
        onProgress: ({ assets }) => setProgress(`Read ${n(assets)} assets so far…`),
      })
      if (!out.assets.length) {
        return setMessage({ tone: out.error ? 'warning' : 'info', text: out.error || (out.cancelled ? 'Stopped before any asset was read, so nothing was saved.' : 'Simpro has no customer assets that match, so nothing was saved.') })
      }
      setProgress('Making the file…')
      const table = assetTable(out.assets, { customers: out.customers })
      const stamp = new Date().toISOString().slice(0, 10)
      const typeName = typeId ? (types.find((t) => String(t.ID) === String(typeId))?.Name || 'type ' + typeId) : ''
      const base = `simpro-customer-assets${typeName ? '-' + typeName.trim().replace(/[^\w-]+/g, '-').replace(/-+/g, '-').toLowerCase() : ''}-${stamp}`
      const partial = out.cancelled || out.error || out.capped
      const note = partial ? 'Not every asset is in this file: the export stopped before the end of the list.' : ''
      if (format === 'csv') save(base + '.csv', toCsv(table), 'text/csv;charset=utf-8')
      else save(base + '.xlsx', await workbook(table, bySite(out.assets), { customers: out.customers, note }), XLSX_TYPE)
      logActivity(null, `Exported ${n(out.assets.length)} Simpro customer assets (${typeName ? 'one asset type' : 'all types'}${archived ? ', archived included' : ''}) to a ${format === 'csv' ? 'CSV' : 'Excel'} file`, { app: 'simprosearch' })
      setMessage({
        tone: partial ? 'warning' : 'success',
        text: `Saved ${n(out.assets.length)} assets on ${n(new Set(out.assets.map((a) => a?.Site?.ID)).size)} sites, with ${n(table.headers.length)} columns.` +
          (out.customers ? '' : ' Simpro wouldn’t give each asset’s customer, so there is no Customer column; the site name is there.') +
          (out.cancelled ? ' You stopped it, so this is only the assets read before then.' : '') +
          (out.error ? ` ${out.error} The file has the assets read before then.` : '') +
          (out.capped ? ' The list was longer than the export reads, so the last assets are missing.' : ''),
      })
    } catch (e) {
      setMessage({ tone: 'warning', text: e?.message || String(e) })
    } finally {
      setBusy(false); setProgress('')
    }
  }

  return (
    <details className="ds-card ds-export" onToggle={(e) => { if (e.currentTarget.open) setOpened(true) }}>
      <summary>Export customer assets</summary>
      <p className="ds-muted">
        Saves every customer asset in Simpro, one row each: Simpro asset ID, site, customer, asset type, serial number and every custom
        field as its own column. For building a master asset list and checking a customer’s own equipment list against Simpro. It only
        reads Simpro. Stop saves what has been read so far.
      </p>
      <div className="ds-row">
        <label className="field">
          <span className="field-label">Asset type</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={busy}>
            <option value="">Every type</option>
            {types.map((t) => <option key={t.ID} value={t.ID}>{String(t.Name || '').trim() || `Type ${t.ID}`}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">File type</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={busy}>
            <option value="xlsx">Excel workbook (.xlsx)</option>
            <option value="csv">CSV</option>
          </select>
        </label>
      </div>
      <div className="ds-row">
        <label className="ds-check-line"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} disabled={busy} /><span>Include archived assets</span></label>
      </div>
      <div className="ds-row">
        <Button onClick={run} disabled={busy || !companyId}>{busy ? 'Exporting…' : 'Export customer assets'}</Button>
        {busy && <Button variant="ghost" onClick={() => { stop.current = true }}>Stop and save what’s read</Button>}
      </div>
      <p className="ds-muted">
        The Excel file has a second sheet counting the assets on each site. The files name customers and sites: keep them inside the
        company. This adds one line to the activity log, with a count and nothing from the assets.
      </p>
      {progress && <p className="ds-note" role="status">{progress}</p>}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </details>
  )
}
