/* Saved reports: every PDF, results file and Ansur record the bench has saved on this laptop, sorted by customer or by
   day, to download together (one zip) or attach together to a Simpro job. Plus the outbox of files waiting to go. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button } from '../../../shared/ui/index.jsx'
import { logActivity } from '../../../shared/activity.js'
import JobPicker from './JobPicker.jsx'
import { JOB_STAGES, getJob, listStatusCodes, updateJob } from './simpro-api.js'
import { PERIODS, UPLOAD_EXTS, categorise, customersIn, describeFile, filterGroups, groupReports, modelOf, modelTotals, nzDay, pickFiles, sharedGroups, withOnJob } from './reports.js'
import { makeZip } from './zip.js'
import { bookletPdf, mergePdfs, printPdf } from './print.js'

/** Downloaded PDFs go in a folder of their own (inside the folder chosen, or in the zip); the Ansur records stay beside it. */
export const PDF_FOLDER = 'PDF reports'
const isPdf = (f) => f.ext === 'pdf' || /\.pdf$/i.test(f.name)
/* The folder chosen for saving is remembered (a small store of its own), so the next Save goes straight to it: the browser's folder window
   can take a long time to open (a synced OneDrive folder in particular), and it is only needed the first time or to change folder. */
const FOLDER_DB = 'chs-bench-folder'
function folderIdb(mode, fn) {
  return new Promise((resolve, reject) => {
    const o = indexedDB.open(FOLDER_DB, 1)
    o.onupgradeneeded = () => o.result.createObjectStore('kv')
    o.onerror = () => reject(o.error)
    o.onsuccess = () => { const db = o.result; const tx = db.transaction('kv', mode); const r = fn(tx.objectStore('kv')); tx.oncomplete = () => { db.close(); resolve(r.result) }; tx.onerror = () => { db.close(); reject(tx.error) } }
  })
}
const getFolder = () => folderIdb('readonly', (st) => st.get('saveDir')).catch(() => null)
const putFolder = (h) => folderIdb('readwrite', (st) => st.put(h, 'saveDir')).catch(() => {})
/** The remembered folder if the browser still lets us write to it (a quick prompt at most), else the folder window, once. */
async function chooseFolder(change) {
  let h = change ? null : await getFolder()
  if (h) {
    let p = 'denied'
    try { p = await h.queryPermission({ mode: 'readwrite' }); if (p !== 'granted') p = await h.requestPermission({ mode: 'readwrite' }) } catch { p = 'denied' }
    if (p !== 'granted') h = null
  }
  if (!h) { h = await window.showDirectoryPicker({ id: 'chs-test-bench-save', mode: 'readwrite', startIn: 'documents' }); putFolder(h) }
  return h
}
/* Tests other engineers shared that this person has cleared from their list: hidden here only, on this laptop (the shared test stays for everyone,
   under Previous tests and in Orders). Removing a test from here also hides its shared copy, or it would simply come back. */
const HIDDEN_KEY = 'chsBench.hiddenShared'
const getHidden = () => { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')) } catch { return new Set() } }
const putHidden = (set) => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set].slice(-3000))) } catch { /* private mode: they come back next time */ } }
const KINDS = [['pdf', 'Reports (PDF)'], ['json', 'Results files'], ['mtr', 'Ansur records']]
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')
const timeOf = (g) => new Intl.DateTimeFormat('en-NZ', { hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Auckland' }).format(new Date(g.testedAt || g.savedAt))

/** Is this file already in the folder with exactly these bytes? */
async function sameFile(dir, f) {
  let h; try { h = await dir.getFileHandle(f.name) } catch { return false }
  const file = await h.getFile(); if (file.size !== f.buffer.byteLength) return false
  const a = new Uint8Array(await file.arrayBuffer()), b = new Uint8Array(f.buffer)
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
async function writeFile(dir, f) { const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable(); await w.write(new Blob([f.buffer], { type: f.mime })); await w.close() }
function saveBlob(name, blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function Reports({ reports, fresh, sim, onJobUpdated, onJob = null, onJobFiles, outbox, online, onAttach, onAddFiles, onMarkDownloaded, modelColours, sharedTests = [], onFetchShared, sheet = null, onSyncSheet, makeMtr, makePdf, onDelete, onRemoveOutbox, onSendWaiting, onRetryFailed, user, onlySerials = [], onShowAll, startUnsent = false, startJob = null }) {
  const [by, setBy] = useState('customer')
  const [text, setText] = useState('')
  const [customer, setCustomer] = useState('')
  const [period, setPeriod] = useState('all')
  const [unsentOnly, setUnsentOnly] = useState(startUnsent)
  const [notDownloaded, setNotDownloaded] = useState(false)
  const [exts, setExts] = useState(['pdf', 'mtr']) // not the results file by default: Simpro won't take it, and the Ansur record says the same
  const [chosen, setChosen] = useState(() => new Set())
  const [job, setJob] = useState(startJob)
  // Updating the job as well as attaching (as the Ansur report builder does): notes added to the end of its notes, its stage and its status.
  const [notes, setNotes] = useState('')
  const [stage, setStage] = useState('')
  const [statusId, setStatusId] = useState('')
  const [statusCodes, setStatusCodes] = useState([])
  const [jobInfo, setJobInfo] = useState(null) // the job as Simpro has it now: its stage and status
  const [syncing, setSyncing] = useState(false)
  const canSimpro = !!(online && user && !sim.access)
  useEffect(() => {
    setJobInfo(null)
    if (!job || !canSimpro) return undefined
    let live = true
    getJob(sim.call, sim.companyId, job.id).then((j) => { if (live) setJobInfo(j) }).catch(() => {})
    if (onJobFiles) onJobFiles(job.id).catch(() => {})   // what the job already has (from anywhere) shows as sent
    listStatusCodes(sim.call, sim.companyId).then((c) => { if (live) setStatusCodes(c) }).catch(() => {})
    return () => { live = false }
  }, [job?.id, sim.companyId, canSimpro]) // eslint-disable-line react-hooks/exhaustive-deps
  const hasUpdate = !!(notes.trim() || stage || statusId)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total, label } while files are being saved
  const [note, setNote] = useState({ text: '', tone: 'info' })
  const [over, setOver] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addNote, setAddNote] = useState({ text: '', tone: 'info' })
  const pick = useRef(null)
  const [folderName, setFolderName] = useState('')
  useEffect(() => { let live = true; getFolder().then((h) => { if (live && h) setFolderName(h.name) }); return () => { live = false } }, [])

  // This laptop's own files, and the tests other engineers have finished that it has no files for yet (made when downloaded or attached).
  const [hidden, setHidden] = useState(getHidden)
  const hiddenCount = useMemo(() => sharedGroups(reports, sharedTests.filter((t) => hidden.has(t.id))).length, [reports, sharedTests, hidden])
  const groups = useMemo(() => withOnJob([...groupReports(reports), ...sharedGroups(reports, sharedTests.filter((t) => !hidden.has(t.id)))], onJob).sort((a, b) => (b.testedAt || b.savedAt) - (a.testedAt || a.savedAt)), [onJob, reports, sharedTests, hidden])
  const customers = useMemo(() => customersIn(groups), [groups])
  const visible = useMemo(() => filterGroups(groups, { text, unsentOnly, notDownloaded, customer, period, serials: onlySerials }), [groups, text, unsentOnly, notDownloaded, customer, period, onlySerials])
  const sections = useMemo(() => categorise(visible, by), [visible, by])
  const totals = useMemo(() => modelTotals(visible), [visible])
  // The colour a model has on the Run a test page (its template's highlight colour, from the bench), or null.
  const tint = (model) => { const c = modelColours?.map?.[model]?.color, h = c && modelColours.hex?.[c]; return h ? { name: modelColours.map[model].template, hc: h.hc, bg: h.bg, d: h.d, b: h.b } : null }
  const files = useMemo(() => pickFiles(visible, [...chosen], exts), [visible, chosen, exts])
  // Ticked tests that have a results file but no Ansur record: the bench makes the record when they are downloaded or attached.
  const needMtr = useMemo(() => (exts.includes('mtr') ? visible.filter((g) => chosen.has(g.base) && g.files.some((f) => f.ext === 'json') && !g.files.some((f) => f.ext === 'mtr')) : []), [visible, chosen, exts])
  // Ticked tests that have no PDF: made from the results file or the Ansur record, so a download always has the PDF and the Ansur record.
  const needPdf = useMemo(() => (exts.includes('pdf') ? visible.filter((g) => chosen.has(g.base) && !g.files.some((f) => f.ext === 'pdf') && g.files.some((f) => f.ext === 'json' || f.ext === 'mtr')) : []), [visible, chosen, exts])
  // Older copies of the same test saved under another name: removed along with it.
  // Remove takes every file of the ticked tests, whatever "Include" says: that only chooses what is downloaded or attached (a test with only a results file has nothing in it by default, and could never be removed).
  const removable = useMemo(() => visible.filter((g) => chosen.has(g.base)).flatMap((g) => g.files), [visible, chosen])
  const stale = useMemo(() => visible.filter((g) => chosen.has(g.base)).flatMap((g) => g.stale || []), [visible, chosen])
  const sharedPicked = useMemo(() => visible.filter((g) => g.shared && chosen.has(g.base)), [visible, chosen])
  const count = files.length + needMtr.length + needPdf.length + sharedPicked.length * ((exts.includes('pdf') ? 1 : 0) + (exts.includes('mtr') ? 1 : 0))
  // What goes to a Simpro job is the PDF of each ticked test and nothing else (a PDF is made for a test that has only its results file or Ansur record).
  const attachPdfs = useMemo(() => pickFiles(visible, [...chosen], ['pdf']), [visible, chosen])
  const attachMake = useMemo(() => visible.filter((g) => chosen.has(g.base) && !g.files.some((f) => f.ext === 'pdf') && g.files.some((f) => f.ext === 'json' || f.ext === 'mtr')), [visible, chosen])
  const attachCount = attachPdfs.length + attachMake.length + sharedPicked.length
  const picked = visible.filter((g) => chosen.has(g.base)).length
  const total = reports.reduce((n, r) => n + (r.size || 0), 0)
  const waiting = outbox.filter((x) => x.status === 'waiting').length
  const failed = outbox.filter((x) => x.status === 'failed').length

  const toggle = (bases, on) => setChosen((s) => { const n = new Set(s); for (const b of bases) on ? n.add(b) : n.delete(b); return n })
  const allOf = (list) => list.length > 0 && list.every((g) => chosen.has(g.base))

  /** The ticked files plus an Ansur record and a PDF made for each ticked test that lacks one. `skipped` counts the ones that couldn't be made (older results files). */
  async function withMtr() {
    const made = []; let skipped = 0
    for (const g of sharedPicked) {   // another engineer's test: fetched, then its report and Ansur record are made here
      try { const json = await onFetchShared(g), pg = { base: describeFile(json.name).base, files: [json] }; if (exts.includes('pdf')) made.push(await makePdf(pg)); if (exts.includes('mtr')) made.push(await makeMtr(pg)) } catch { skipped++ }
    }
    for (const g of needMtr) { try { made.push(await makeMtr(g)) } catch { skipped++ } }
    for (const g of needPdf) { try { made.push(await makePdf(g)) } catch { skipped++ } }
    return { list: [...files, ...made], skipped }
  }
  const skippedNote = (n) => (n ? ` ${n} file${n === 1 ? '' : 's'} couldn’t be made (an older results file).` : '')
  const canPickFolder = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

  /** Saves the ticked tests' files (each with its PDF and Ansur record) into a folder chosen each time, one file apiece; where the browser can't choose a folder, as a zip. */
  async function download(asZip = false, change = false) {
    if (!count) return
    let dir = null
    if (canPickFolder && !asZip) {   // first, while the click still counts
      try { dir = await chooseFolder(change); setFolderName(dir.name) } catch (e) { if (e.name === 'AbortError') return }
    }
    setBusy(true); setProgress({ done: 0, total: count, label: 'Getting the files ready' })
    try {
      const { list, skipped } = await withMtr()
      if (!list.length) throw new Error('Nothing to download.' + skippedNote(skipped))
      setProgress({ done: 0, total: list.length, label: dir ? 'Saving' : 'Making the zip' })
      // Each file on its own: one the browser refuses to write into the folder ("Aborted due to security policy" is its security check on the file)
      // doesn't stop the rest, and whatever could not be written there is downloaded instead.
      const failed = []; let same = 0
      let pdfDir = null
      const where = async (f, fresh) => { if (!isPdf(f)) return dir; if (fresh) pdfDir = null; return (pdfDir ||= await dir.getDirectoryHandle(PDF_FOLDER, { create: true })) }   // the PDFs in a folder of their own; a fresh handle after a failure (OneDrive can recreate the folder under us)
      if (dir) {
        let n = 0
        for (const f of list) {
          // Up to three tries, each with the folder looked up again and a pause between: a file or folder OneDrive is syncing can be refused or briefly missing.
          let why = ''
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              if (attempt) await new Promise((r) => setTimeout(r, 1200 * attempt))
              const to = await where(f, attempt > 0)
              if (await sameFile(to, f)) { same++; why = ''; break }   // already there, unchanged: left alone (rewriting it only makes OneDrive upload it again)
              await writeFile(to, f); why = ''; break
            } catch (e) { why = `${e.name || 'Error'}: ${e.message || e}` }
          }
          if (why) failed.push({ f, why })
          setProgress({ done: ++n, total: list.length, label: 'Saving' })
        }
      }
      const toDownload = dir ? failed.map((x) => x.f) : list
      if (toDownload.length) setProgress({ done: list.length, total: list.length, label: 'Making the zip of the files that couldn’t be saved there' })
      if (toDownload.length === 1) saveBlob(toDownload[0].name, new Blob([toDownload[0].buffer], { type: toDownload[0].mime }))
      else if (toDownload.length > 1) saveBlob(`CHS Test Bench reports ${nzDay(Date.now())}.zip`, new Blob([makeZip(toDownload.map((f) => ({ name: isPdf(f) ? `${PDF_FOLDER}/${f.name}` : f.name, bytes: new Uint8Array(f.buffer) })))], { type: 'application/zip' }))
      logActivity(null, `Saved ${list.length} test file${list.length === 1 ? '' : 's'} from the Test Bench`, { app: 'testbench' })
      if (!dir || list.length > failed.length) await onMarkDownloaded?.(list.map((f) => f.name))   // all of them when downloaded; in a folder, those written (or already there)
      const saved = dir ? list.length - failed.length - same : 0
      setNote({ text: (dir ? `Saved ${saved} file${saved === 1 ? '' : 's'} to ${dir.name} (the PDFs in its “${PDF_FOLDER}” folder)${same ? `; ${same} already there, unchanged` : ''}.${failed.length ? ` ${failed.length} couldn’t be written there (${failed[0].why}) and ${failed.length === 1 ? 'was' : 'were'} downloaded instead.` : ''}` : list.length === 1 ? `Downloaded ${list[0].name}.` : `Downloaded ${list.length} files as one zip.`) + skippedNote(skipped), tone: failed.length ? 'warning' : 'success' })
    } catch (e) { setNote({ text: 'Not saved: ' + (e.message || e), tone: 'warning' }) } finally { setBusy(false); setProgress(null) }
  }

  /** The PDF of each ticked test, made on the spot for a test that has only its results file or Ansur record. */
  async function pickedPdfs() {
    const made = []; let skipped = 0
    for (const g of attachMake) { try { made.push(await makePdf(g)) } catch { skipped++ } }
    for (const g of sharedPicked) { try { const json = await onFetchShared(g); made.push(await makePdf({ base: describeFile(json.name).base, files: [json] })) } catch { skipped++ } }
    return { list: [...attachPdfs, ...made], skipped }
  }

  /** Prints the ticked tests' reports: joined into one PDF, one print dialog. As a booklet: two pages to a landscape sheet, in booklet order. */
  async function print(booklet = false) {
    if (!attachCount) return
    setBusy(true)
    try {
      const { list, skipped } = await pickedPdfs()
      if (!list.length) throw new Error('There is no report to print.' + skippedNote(skipped))
      let bytes = list.length === 1 ? list[0].buffer : await mergePdfs(list.map((f) => f.buffer))
      if (booklet) bytes = await bookletPdf(bytes)
      const how = await printPdf(new Blob([bytes], { type: 'application/pdf' }))
      logActivity(null, `Printed ${list.length} test report${list.length === 1 ? '' : 's'}${booklet ? ' as a booklet' : ''} from the Test Bench`, { app: 'testbench' })
      setNote({ text: (how === 'tab' ? `The report${list.length === 1 ? '' : 's'} opened in a new tab: print from there.` : `${list.length === 1 ? '1 report' : `${list.length} reports, one after another,`} sent to the print dialog.`) + (booklet ? ' Booklet: choose landscape and print on both sides, flipping on the short edge, then fold the pages in half.' : '') + skippedNote(skipped), tone: skipped ? 'warning' : 'success' })
    } catch (e) { setNote({ text: 'Not printed: ' + (e.message || e), tone: 'warning' }) } finally { setBusy(false) }
  }

  async function attach() {
    if (!job || !(attachCount || hasUpdate)) return
    setBusy(true)
    try {
      let n = null, skipped = 0
      if (attachCount) {
        const got = await pickedPdfs(); skipped = got.skipped
        const list = got.list
        if (!list.length && !hasUpdate) throw new Error('There is no PDF to attach.' + skippedNote(skipped))
        if (list.length) n = await onAttach(list, job)
      }
      let upd = null
      if (hasUpdate) {
        if (!canSimpro) upd = { done: [], failed: ['updating the job needs a connection and Simpro access, so nothing was changed on it'] }
        else {
          upd = await updateJob(sim.call, { companyId: sim.companyId, jobId: job.id, notes, stage, statusId })
          if (upd.done.length) logActivity(null, `Updated a Simpro job from the Test Bench (${upd.done.join(', ')})`, { app: 'testbench' })
          if (!upd.failed.length) { setNotes(''); setStage(''); setStatusId(''); getJob(sim.call, sim.companyId, job.id).then(setJobInfo).catch(() => {}) }
          if (upd.done.includes('stage') && onJobUpdated) onJobUpdated(job.id)   // marked Complete: its order closes
        }
      }
      const locked = upd && upd.failed.some((f) => / 422\b/.test(f) && !/already|exist|duplicate|unique/i.test(f)) ? ' If the job is open in Simpro, close it and try again.' : ''
      const text = [n && n.text, upd && upd.done.length ? `Updated job ${job.label.split(' ')[0]}: ${upd.done.join(', ')}.` : '', upd && upd.failed.length ? `Not updated: ${upd.failed.join('; ')}.${locked}` : ''].filter(Boolean).join(' ')
      setNote({ text: (text || 'Done.') + skippedNote(skipped), tone: (upd && upd.failed.length) || (n && n.tone === 'warning') || skipped ? 'warning' : (n ? n.tone : 'success') })
    } catch (e) { setNote({ text: 'Not done: ' + (e.message || e), tone: 'warning' }) } finally { setBusy(false) }
  }

  /** Hands the asset list loaded in the bench, read again first, to Simpro Asset Sync (which previews it; nothing changes until Apply there). */
  async function syncSheet() {
    setSyncing(true)
    try { await onSyncSheet() } catch (e) { setNote({ text: 'Not synced: ' + (e.message || e), tone: 'warning' }); setSyncing(false) }
  }

  /** One test's Ansur record, made on the spot if it has only a results file. */
  async function downloadMtr(g) {
    setBusy(true)
    try {
      const rec = g.files.find((f) => f.ext === 'mtr') || await makeMtr(g)
      saveBlob(rec.name, new Blob([rec.buffer], { type: rec.mime || 'application/xml' })); onMarkDownloaded?.([rec.name])
      logActivity(null, 'Downloaded an Ansur record from the Test Bench', { app: 'testbench' })
      setNote({ text: `Downloaded ${rec.name}.`, tone: 'success' })
    } catch (e) { setNote({ text: 'No Ansur record: ' + (e.message || e), tone: 'warning' }) } finally { setBusy(false) }
  }

  async function remove(list, label, shared = []) {
    if (!(list.length || shared.length) || !window.confirm(`Remove ${label} from this laptop? Reports already attached to Simpro stay there${shared.length ? '; tests other engineers shared are only hidden from this list (they stay under Previous tests and in Orders)' : ''}; this only clears them from this list.`)) return
    const started = new Set(list.map((f) => f.meta && f.meta.testedAt).filter(Boolean))
    if (list.length) await onDelete(list.map((f) => f.id))
    // Their shared copies are hidden too, or they would just be listed again as "made when needed".
    const ids = new Set([...shared.map((g) => g.sharedId), ...sharedTests.filter((t) => started.has(t.started)).map((t) => t.id)])
    if (ids.size) { const n = new Set([...hidden, ...ids]); setHidden(n); putHidden(n) }
    setChosen(new Set())
  }
  const sentFiles = () => groups.flatMap((g) => g.files).filter((f) => f.sent.length)

  /** Files someone adds themselves (chosen, dropped or from a folder): kept with the bench's own, ticked ready to download or attach. */
  async function addFiles(list) {
    const files = [...list]
    if (!files.length) return
    setAdding(true)
    try {
      const items = []; const skipped = []
      for (const f of files) {
        if (!UPLOAD_EXTS.includes(describeFile(f.name).ext)) { skipped.push(f.name); continue }
        try { items.push({ name: f.name, buffer: await f.arrayBuffer() }) } catch (e) { skipped.push(f.name) }
      }
      const r = items.length ? await onAddFiles(items) : { saved: [], failed: [] }
      toggle(r.saved.map((n) => describeFile(n).base), true)
      const bad = [...r.failed.map((x) => `${x.name} (${x.why})`), ...skipped.map((n) => `${n} (not an Ansur record, PDF or results file)`)]
      setAddNote({ text: (r.saved.length ? `Added ${r.saved.length} file${r.saved.length === 1 ? '' : 's'}, ticked below.` : 'Nothing added.') + (bad.length ? ` Not added: ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? ` and ${bad.length - 3} more` : ''}.` : ''), tone: bad.length ? 'warning' : 'success' })
    } catch (e) { setAddNote({ text: 'Not added: ' + (e.message || e), tone: 'warning' }) } finally { setAdding(false) }
  }
  /** The Ansur records, PDFs and results files in a folder chosen on this laptop (and one level of folders inside it). */
  async function addFolder() {
    let dir; try { dir = await window.showDirectoryPicker({ id: 'chs-test-bench-add', mode: 'read', startIn: 'documents' }) } catch (e) { if (e.name === 'AbortError') return; setAddNote({ text: 'Couldn’t open that folder: ' + (e.message || e), tone: 'warning' }); return }
    const found = []
    const walk = async (d, depth) => { for await (const [name, h] of d.entries()) { if (h.kind === 'file' && UPLOAD_EXTS.includes(describeFile(name).ext)) found.push(await h.getFile()); else if (h.kind === 'directory' && depth < 1) await walk(h, depth + 1) } }
    try { await walk(dir, 0) } catch (e) { setAddNote({ text: 'Couldn’t read that folder: ' + (e.message || e), tone: 'warning' }); return }
    if (!found.length) { setAddNote({ text: `No Ansur records, PDFs or results files in ${dir.name}.`, tone: 'warning' }); return }
    await addFiles(found)
  }

  const online_ok = online && user
  return (
    <div className="tb-reports">
      <div className="tb-rhead">
        <div>
          <h2>Saved reports</h2>
          <p className="tb-muted">Every report the bench saves is also kept here on this laptop, and the tests other engineers have finished are listed too: their reports are made here when you download or attach them. Tick the tests you want, then download them together or attach them to a Simpro job.
            {reports.length > 0 && <> {groups.length} test{groups.length === 1 ? '' : 's'} · {kb(total)} kept.</>}</p>
        </div>
      </div>

      <div className={`tb-drop${over ? ' is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }}>
        <strong>Add your own files</strong>
        <span className="tb-muted">Drop Ansur records (.mtr), PDFs or results files here, or choose them. They are kept here with the bench’s own, ticked, so you can attach them to a Simpro job or download them with the rest. A PDF is made for an Ansur record that has none.</span>
        <div className="tb-actionbar-row">
          <Button disabled={adding} onClick={() => pick.current?.click()}>Choose files</Button>
          {canPickFolder && <Button variant="secondary" disabled={adding} onClick={addFolder}>Open a folder…</Button>}
          <input ref={pick} type="file" multiple accept={UPLOAD_EXTS.map((x) => '.' + x).join(',')} hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        </div>
        {addNote.text && <p className={`tb-note tb-note-${addNote.tone}`} role="status">{addNote.text}</p>}
      </div>

      {onlySerials.length > 0 && (
        <p className="tb-note tb-note-success" role="status">Showing the tests for the {onlySerials.length} device{onlySerials.length === 1 ? '' : 's'} in the asset list you were syncing{unsentOnly ? ', the ones not yet sent to Simpro' : ''}. Tick them, pick the Simpro job beside Attach, and attach.{' '}
          <button type="button" className="tb-link" onClick={onShowAll}>Show all saved reports</button></p>
      )}

      <div className="tb-filters">
        <label>Sort by
          <select value={by} onChange={(e) => setBy(e.target.value)}>
            <option value="customer">Customer</option><option value="model">Device model</option><option value="day">Day</option><option value="none">No headings</option>
          </select>
        </label>
        <label>Customer
          <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">All customers</option>
            {customers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>When
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        </label>
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search serial, model, customer" aria-label="Search saved reports" />
        <label className="tb-check"><input type="checkbox" checked={unsentOnly} onChange={(e) => setUnsentOnly(e.target.checked)} /> Not yet sent</label>
        <label className="tb-check"><input type="checkbox" checked={notDownloaded} onChange={(e) => setNotDownloaded(e.target.checked)} /> Not yet downloaded</label>
      </div>

      {groups.length === 0 ? (
        <p className="tb-empty">Nothing saved yet. Save a report in the Test Bench, or add your own files above, and it appears here.</p>
      ) : (
        <>
          {totals.length > 0 && (
            <details className="tb-totals" open>
              <summary><strong>Tested totals per customer and model</strong> <span className="tb-muted">{visible.length} test{visible.length === 1 ? '' : 's'} shown</span></summary>
              <table>
                <thead><tr><th>Customer</th><th>Model</th><th className="num">Devices</th><th className="num">Tests</th><th className="num">Downloaded</th><th className="num">Sent to Simpro</th></tr></thead>
                <tbody>
                  {totals.map((c) => c.rows.map((r, i) => {
                    const t = tint(r.model)
                    return (
                      <tr key={c.customer + '|' + r.model} className={i === 0 ? 'is-first' : ''}>
                        <td>{i === 0 ? <strong>{c.customer}</strong> : ''}</td>
                        <td>{t ? <span className="tb-model" style={{ '--hc': t.hc, '--hc-bg': t.bg, '--hc-d': t.d }} title={`Colour of ${t.name}`}>{r.model}</span> : r.model}</td>
                        <td className="num">{r.devices}</td><td className="num">{r.tests}</td><td className="num">{r.downloaded}</td><td className="num">{r.sent}</td>
                      </tr>
                    )
                  }))}
                </tbody>
                <tfoot>{totals.length > 1 && <tr><td colSpan="2"><strong>All customers</strong></td><td className="num" /><td className="num"><strong>{visible.length}</strong></td><td className="num"><strong>{visible.filter((g) => g.downloadedAt).length}</strong></td><td className="num"><strong>{visible.filter((g) => g.sentTo.length).length}</strong></td></tr>}</tfoot>
              </table>
            </details>
          )}

          <div className="tb-selbar">
            <label className="tb-check"><input type="checkbox" checked={allOf(visible)} onChange={(e) => toggle(visible.map((g) => g.base), e.target.checked)} /> Tick all shown ({visible.length})</label>
            <span className="tb-muted">{picked} ticked · {count} file{count === 1 ? '' : 's'}</span>
            <span className="tb-kinds">Include:
              {KINDS.map(([k, n]) => (
                <label key={k} className="tb-check"><input type="checkbox" checked={exts.includes(k)} onChange={(e) => setExts((l) => (e.target.checked ? [...l, k] : l.filter((x) => x !== k)))} /> {n}</label>
              ))}
            </span>
          </div>

          {visible.length === 0 && <p className="tb-empty">Nothing matches those filters.</p>}
          {sections.map((sec) => (
            <section key={sec.key} className="tb-sec">
              {sec.title && (
                <h3 className="tb-sec-title">
                  <label className="tb-check"><input type="checkbox" checked={allOf(sec.groups)} onChange={(e) => toggle(sec.groups.map((g) => g.base), e.target.checked)} aria-label={`Tick all for ${sec.title}`} /> {by === 'model' && tint(sec.title) ? <span className="tb-model" style={{ '--hc': tint(sec.title).hc, '--hc-bg': tint(sec.title).bg, '--hc-d': tint(sec.title).d }} title={`Colour of ${tint(sec.title).name}`}>{sec.title}</span> : sec.title}</label>
                  <span className="tb-muted">{sec.groups.length} test{sec.groups.length === 1 ? '' : 's'}</span>
                </h3>
              )}
              {sec.groups.map((g) => (
                <div key={g.base} className={`tb-test${chosen.has(g.base) ? ' is-picked' : ''}${tint(modelOf(g)) ? ' has-model' : ''}`} style={tint(modelOf(g)) ? { '--hc': tint(modelOf(g)).hc, '--hc-bg': tint(modelOf(g)).bg } : undefined}>
                  <input type="checkbox" checked={chosen.has(g.base)} onChange={(e) => toggle([g.base], e.target.checked)} aria-label={`Tick ${g.base}`} />
                  <div className="tb-test-main">
                    <div className="tb-test-title"><strong>{g.serial}</strong>{g.model ? ` · ${g.model}` : ''}
                      {g.files.some((f) => fresh.has(f.name)) && <Badge tone="purple">New</Badge>}
                      {g.uploaded && <Badge tone="grey">Added by you</Badge>}
                      {g.shared && <Badge tone="purple">Tested by {g.sharedBy || 'another engineer'}</Badge>}
                      {g.sentTo.length ? <Badge tone="green">Sent to {g.sentTo.join(', ')}</Badge> : <Badge tone="grey">Not sent</Badge>}
                      {g.downloadedAt ? <span title={`Downloaded ${new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Auckland' }).format(new Date(g.downloadedAt))}`}><Badge tone="green">Downloaded</Badge></span> : <Badge tone="grey">Not downloaded</Badge>}
                    </div>
                    <div className="tb-muted">{[by !== 'customer' && g.customer !== 'No customer recorded' ? g.customer : '', by !== 'day' ? `${g.day} ${timeOf(g)}` : timeOf(g), g.template].filter(Boolean).join(' · ')}</div>
                    <div className="tb-chips">
                      {g.shared && <><span className="tb-chip is-made" title="Made here from the shared test when you download or attach it">Report · made when needed</span><span className="tb-chip is-made" title="Made here from the shared test when you download or attach it">Ansur record · made when needed</span></>}
                      {g.files.map((f) => (
                        <button key={f.id} type="button" className="tb-chip" title={`Download ${f.name}`} onClick={() => { saveBlob(f.name, new Blob([f.buffer], { type: f.mime })); onMarkDownloaded?.([f.name]) }}>{f.kind} · {kb(f.size)}</button>
                      ))}
                      {g.files.some((f) => f.ext === 'json') && !g.files.some((f) => f.ext === 'mtr') && (
                        <button type="button" className="tb-chip" disabled={busy} title="Make the Ansur record (.mtr) from this test's results file and download it" onClick={() => downloadMtr(g)}>Ansur record (.mtr) · make</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ))}

          <div className="tb-actionbar">
            <div className="tb-actionbar-row">
              <strong>{count ? `${count} file${count === 1 ? '' : 's'} from ${picked} test${picked === 1 ? '' : 's'}` : 'Tick tests above'}</strong>
              <Button variant="secondary" disabled={busy || !count} onClick={() => download()} title={folderName ? 'Saves straight to the folder used last time' : 'Choose the folder to save into'}>{canPickFolder ? (folderName ? `Save to “${folderName}”` : 'Save to a folder…') : count > 1 ? 'Download as zip' : 'Download'}</Button>
              {canPickFolder && folderName && <Button variant="ghost" disabled={busy || !count} onClick={() => download(false, true)} title="Choose a different folder to save into">Other folder…</Button>}
              {canPickFolder && <Button variant="ghost" disabled={busy || !count} onClick={() => download(true)} title="All the ticked files in one zip, with nothing written into a synced folder">Download as zip</Button>}
              <Button variant="ghost" disabled={busy || !attachCount} onClick={() => print()} title="Prints the report (PDF) of each ticked test, all in one print dialog">{attachCount > 1 ? `Print ${attachCount} reports` : 'Print'}</Button>
              <Button variant="ghost" disabled={busy || !attachCount} onClick={() => print(true)} title="Two pages to each side of a landscape sheet, in booklet order: print on both sides, flipping on the short edge, and fold">Print as booklet</Button>
              <Button variant="ghost" disabled={busy || !(removable.length || sharedPicked.length)} onClick={() => remove([...removable, ...stale], `${picked} test${picked === 1 ? '' : 's'}${removable.length + stale.length ? ` (${removable.length + stale.length} file${removable.length + stale.length === 1 ? '' : 's'})` : ''}`, sharedPicked)} title="Clears the ticked tests from this laptop, whatever files are included above. Tests other engineers shared are only hidden from this list.">Remove</Button>
            </div>
            <div className="tb-actionbar-row tb-attach">
              <span>Attach the PDFs to Simpro job:</span>
              <JobPicker call={sim.call} online={online} user={user} companies={sim.companies} companyId={sim.companyId} onCompany={sim.setCompanyId} job={job} onJob={setJob} disabled={!!sim.access} />
              <Button disabled={busy || !job || !(attachCount || hasUpdate)} onClick={attach} title="Only the PDF reports go to the job; the notes, stage and status below are added to it as well">{attachCount ? `${canSimpro ? 'Attach' : 'Queue'} ${attachCount} PDF${attachCount === 1 ? '' : 's'} ${canSimpro ? 'to' : 'for'} ${job ? job.label.split(' ')[0] : 'job'}${hasUpdate ? ' and update it' : ''}` : hasUpdate ? `Update ${job ? job.label.split(' ')[0] : 'job'}` : `${canSimpro ? 'Attach PDFs to' : 'Queue PDFs for'} ${job ? job.label.split(' ')[0] : 'job'}`}</Button>
            </div>
            {job && (
              <details className="tb-jobupd" open={hasUpdate || undefined}>
                <summary>Update the job: notes, stage and status <span className="tb-muted">(optional){jobInfo ? ' · now ' + [jobInfo.Stage, jobInfo.Status?.Name].filter(Boolean).join(' · ') : ''}</span></summary>
                <label className="tb-orderq">Notes to add to the job
                  <textarea rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Added to the end of the job’s existing notes: nothing is overwritten." />
                </label>
                <div className="tb-orderrow">
                  <label>Stage<select value={stage} onChange={(e) => setStage(e.target.value)}><option value="">Leave unchanged</option>{JOB_STAGES.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
                  <label>Status<select value={statusId} onChange={(e) => setStatusId(e.target.value)}><option value="">Leave unchanged</option>{statusCodes.map((x) => <option key={x.ID} value={x.ID}>{x.Name}</option>)}</select></label>
                </div>
                {!canSimpro && <p className="tb-muted">Needs a connection and Simpro access. Notes, stage and status are done together with the attach, once it can reach Simpro.</p>}
              </details>
            )}
            {onSyncSheet && (
              <div className="tb-actionbar-row tb-sheetrow">
                <span>Asset list:</span>
                {sheet && sheet.state === 'ready' ? <strong>{sheet.name} <span className="tb-muted">({sheet.devices} devices)</span></strong> : <span className="tb-muted">{sheet && sheet.name ? `${sheet.name} isn’t ready (${sheet.state === 'needs-permission' ? 'the bench needs your OK to read it: click Reconnect on its asset list bar' : sheet.state})` : 'none loaded in the bench (choose one under Device under test)'}</span>}
                <Button variant="secondary" disabled={busy || syncing || !canSimpro || !sheet || sheet.state !== 'ready'} onClick={syncSheet} title="Reads the asset list again, then opens Simpro Asset Sync with it">{syncing ? 'Opening Asset Sync…' : 'Read it again and sync to Simpro…'}</Button>
                <span className="tb-muted">Opens Simpro Asset Sync with the list as it is now. Nothing changes in Simpro until you press Apply there.</span>
              </div>
            )}
            {progress && (
              <div className="tb-progress" role="status" aria-live="polite">
                <progress max={progress.total || 1} value={progress.done} />
                <span><strong>{progress.done} of {progress.total}</strong> done{progress.total - progress.done > 0 ? `, ${progress.total - progress.done} left` : ''} · {progress.label}</span>
              </div>
            )}
            {note.text && <p className={`tb-note tb-note-${note.tone}`} role="status">{note.text}</p>}
            {sim.access && <Alert tone="warning" title="Simpro isn’t switched on for you">{sim.access} Ask an admin to turn on Simpro access for you in Settings → People and access. Files you queue wait in the outbox.</Alert>}
            {!user && <Alert tone="warning" title="Sign in to send">Sign in to the hub (while online) to send files to Simpro.</Alert>}
            {hiddenCount > 0 && <button type="button" className="tb-link" onClick={() => { setHidden(new Set()); putHidden(new Set()) }}>Show the {hiddenCount} shared test{hiddenCount === 1 ? '' : 's'} you removed again</button>}
            {sentFiles().length > 0 && <button type="button" className="tb-link" onClick={() => remove(sentFiles(), `the ${sentFiles().length} files already sent`)}>Clear out the files already sent to Simpro</button>}
          </div>
        </>
      )}

      {outbox.length > 0 && (
        <section className="tb-sec">
          <h3 className="tb-sec-title">Waiting to go to Simpro {waiting > 0 && <Badge tone="orange">{waiting} waiting</Badge>} {failed > 0 && <Badge tone="red">{failed} failed</Badge>}</h3>
          {outbox.map((x) => (
            <div key={x.id} className="tb-out">
              <span className="tb-file-name">{x.name}</span>
              <span className="tb-muted">{x.jobLabel}</span>
              <span className={x.status === 'failed' ? 'tb-bad' : 'tb-muted'}>{x.status === 'failed' ? `Not sent: ${x.error}` : x.error ? `Waiting: ${x.error}` : 'Waiting'}</span>
              <Button variant="ghost" size="sm" onClick={() => onRemoveOutbox(x.id)}>Remove</Button>
            </div>
          ))}
          <div className="tb-actions">
            <Button variant="secondary" size="sm" disabled={!waiting || !online_ok} onClick={onSendWaiting}>Send now</Button>
            {failed > 0 && <Button variant="secondary" size="sm" onClick={onRetryFailed}>Try the failed ones again</Button>}
            {!online && <span className="tb-muted">Offline: they go by themselves when this laptop is back online.</span>}
          </div>
        </section>
      )}
    </div>
  )
}
