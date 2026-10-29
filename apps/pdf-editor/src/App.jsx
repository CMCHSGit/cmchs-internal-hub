/* PDF Editor: open a PDF, rearrange and edit its pages, save a new one.

   Everything happens on this device: the file is never uploaded. Editing only
   changes a record of what the person did (model.js); the PDF itself is
   rewritten once, on Save (save.js), which is what keeps it quick.

   Stage 1: view, zoom, page strip, rotate / delete / reorder / duplicate pages,
   add blank pages, add pages from another PDF, extract pages.
   Stage 2: put text, images, shapes, highlights, freehand and whiteout on a page,
   move and resize them, undo and redo. (Editing the page's own text is a later stage.) */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, Bold, BoxSelect, Circle, ClipboardCopy, ClipboardPaste, Copy, Download, Eraser, FileOutput, FilePlus2, FolderOpen, Highlighter, Image as ImageIcon,
  Italic, Files, Maximize, Minus, MousePointer2, PanelLeft, Pencil, Plus, Redo2, RotateCcw, RotateCw, Square, Trash2, Type, Undo2, X, ZoomIn, ZoomOut,
} from 'lucide-react'
import { Alert, Button, IconButton, Loading, Toast, useConfirm, useToast } from '../../../shared/ui/index.jsx'
import { PasswordError, closeSource, openSource, releaseSource, retainSource } from './engine.js'
import {
  FAMILIES, addObject, blankGeom, blankPage, cloneObjects, commit, deletePages, deltaToPage, displaySize, duplicatePages, geometry, insertPages,
  live, mapObjects, moveObject, movePages, newHistory, newImage, newText, norm, nudgePages, redo, removeObject, rotatePages, settle,
  sourcePage, uid, undo, updateObject,
} from './model.js'
import { buildPdf } from './save.js'
import { PageView } from './Page.jsx'
import { Thumbs } from './Thumbs.jsx'
import regular from '@fontsource/source-sans-3/files/source-sans-3-latin-ext-400-normal.woff?url'
import bold from '@fontsource/source-sans-3/files/source-sans-3-latin-ext-600-normal.woff?url'
import italic from '@fontsource/source-sans-3/files/source-sans-3-latin-ext-400-italic.woff?url'
import boldItalic from '@fontsource/source-sans-3/files/source-sans-3-latin-ext-600-italic.woff?url'

/** For letters the PDF standard fonts lack (the macron vowels in Māori words), fetched only if a saved text needs them. */
const loadFallbackFont = async (b, i) => {
  const res = await fetch(b && i ? boldItalic : b ? bold : i ? italic : regular)
  if (!res.ok) throw new Error('font not available')
  return new Uint8Array(await res.arrayBuffer())
}

const DEFAULTS = {
  size: 14, color: '#000000', family: 'Helvetica', bold: false, italic: false,
  fill: null, fillPick: '#ffe08a', stroke: '#d62828', strokePick: '#d62828', sw: 2, highlight: '#ffeb3b',
}
const TOOLS = [
  ['select', 'Edit text and move objects', MousePointer2], ['text', 'Add text', Type], ['rect', 'Rectangle', Square], ['ellipse', 'Ellipse', Circle],
  ['line', 'Line', Minus], ['pen', 'Draw', Pencil], ['highlight', 'Highlight', Highlighter], ['whiteout', 'Cover with white', Eraser],
  ['grab', 'Move or resize an area: drag a box around anything on the page', BoxSelect],
]
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** A picture ready to place: PNG or JPEG bytes (other types, and very large ones, are redrawn as PNG). */
async function prepareImage(file) {
  const url = URL.createObjectURL(file)
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That picture didn’t open.')); i.src = url })
  const w = img.naturalWidth, h = img.naturalHeight
  const keep = (file.type === 'image/png' || file.type === 'image/jpeg') && Math.max(w, h) <= 2400
  if (keep) return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type === 'image/png' ? 'png' : 'jpg', w, h, url }
  URL.revokeObjectURL(url)
  const k = Math.min(1, 2400 / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.round(w * k); c.height = Math.round(h * k)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  const blob = await new Promise(res => c.toBlob(res, 'image/png'))
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png', w: c.width, h: c.height, url: URL.createObjectURL(blob) }
}

function ColorField({ label, value, onChange, onDone }) {
  return (
    <label className="pe-field"><span>{label}</span>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} onBlur={onDone} />
    </label>
  )
}

export default function App() {
  const [hist, setHist] = useState(() => newHistory([]))
  const [sources, setSources] = useState([])
  const [saved, setSaved] = useState(hist.present)
  const [fileName, setFileName] = useState('')
  const [z, setZ] = useState(1.33)
  const [tool, setTool] = useState('select')
  const [d, setD] = useState(DEFAULTS)
  const [sel, setSel] = useState(null)            // { pageId, id }: the selected object
  const [selPages, setSelPages] = useState(() => new Set())
  const [currentId, setCurrentId] = useState(null) // the page in view
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [sideOpen, setSideOpen] = useState(false)
  const [toast, showToast] = useToast()
  const [confirmDialog, confirm] = useConfirm()
  // Several PDFs open at once: each is a tab. The one showing lives in the state above; the others are kept whole in `stash`.
  const [tabs, setTabs] = useState([])            // [{ id, name }]
  const [activeId, setActiveId] = useState(null)
  const [clipKind, setClipKind] = useState(null)  // what the editor's clipboard holds: 'pages' or 'objects'

  const scroller = useRef(null), fileRef = useRef(null), addRef = useRef(null), imgRef = useRef(null)
  const images = useRef(new Map()), imageUrls = useRef(new Map()), blankGeoms = useRef(new Map())
  const anchor = useRef(null), zoomFix = useRef(null)
  const stash = useRef(new Map()), pendingScroll = useRef(null), clip = useRef(null), focusArea = useRef('objects')
  const pages = hist.present
  const dirty = pages !== saved
  const anyDirty = dirty || [...stash.current.values()].some(s => s.hist.present !== s.saved)

  const geomOf = useCallback((p) => {
    if (p.src >= 0) return sources[p.src].geoms[p.n]
    const k = p.blank.w + 'x' + p.blank.h
    if (!blankGeoms.current.has(k)) blankGeoms.current.set(k, blankGeom(p.blank.w, p.blank.h))
    return blankGeoms.current.get(k)
  }, [sources])

  // What the keyboard handler and the stable api need to see without being rebuilt.
  const latest = useRef({})
  latest.current = { hist, pages, sel, selPages, tool, currentId, z, geomOf, sources, saved, fileName, activeId, tabs }

  const api = useMemo(() => ({
    scroller,
    setTool,
    select: (pageId, id) => setSel(pageId ? { pageId, id } : null),
    live: (pageId, objId, obj) => setHist(h => live(h, mapObjects(h.present, pageId, os => os.map(o => (o.id === objId ? obj : o))))),
    endLive: () => setHist(settle),
    add: (pageId, obj, { select, revert } = {}) => {
      setHist(h => commit(h, addObject(h.present, pageId, obj)))
      if (select) setSel({ pageId, id: obj.id })
      if (revert) setTool('select')
    },
    // A picture made in the editor (a lifted area): kept for saving and for showing, and its id for the image object.
    registerImage: (bytes, url) => {
      const id = uid('i')
      images.current.set(id, { bytes, type: 'png' })
      imageUrls.current.set(id, url)
      return id
    },
    // Several objects as one undo step (a cover and the text typed over it); the last is selected.
    // `select` is true for the last, or the id of the one to select.
    addMany: (pageId, objs, { select } = {}) => {
      setHist(h => commit(h, objs.reduce((ps, o) => addObject(ps, pageId, o), h.present)))
      if (select) setSel({ pageId, id: typeof select === 'string' ? select : objs[objs.length - 1].id })
    },
    // Several objects changed at once in a drag (a picked-up banner and the text on it move together).
    liveMany: (pageId, objs) => {
      const by = new Map(objs.map(o => [o.id, o]))
      setHist(h => live(h, mapObjects(h.present, pageId, os => os.map(o => by.get(o.id) || o))))
    },
    update: (pageId, objId, patch) => setHist(h => commit(h, updateObject(h.present, pageId, objId, patch))),
    remove: (pageId, objId) => { setHist(h => commit(h, removeObject(h.present, pageId, objId))); setSel(s => (s?.id === objId ? null : s)) },
  }), [])

  const change = (fn) => setHist(h => commit(h, fn(h.present)))
  const selObj = sel && pages.find(p => p.id === sel.pageId)?.objects.find(o => o.id === sel.id)

  /* ── Opening and adding files ── */

  const freeImages = () => { imageUrls.current.forEach(u => URL.revokeObjectURL(u)); imageUrls.current.clear(); images.current.clear() }
  const fitZoom = (geoms) => {
    const el = scroller.current
    const widest = Math.max(...geoms.map(g => displaySize(g, 0).w), 1)
    return clamp(((el?.clientWidth || 900) - 56) / widest, 0.3, 1.6)
  }

  /** Everything about the document on show, to put away while another one is. */
  const snapshotNow = () => {
    const l = latest.current, el = scroller.current
    return { hist: l.hist, sources: l.sources, saved: l.saved, fileName: l.fileName, z: l.z, sel: l.sel, selPages: l.selPages, currentId: l.currentId, scroll: { top: el?.scrollTop || 0, left: el?.scrollLeft || 0 } }
  }
  const show = (s) => {
    setHist(s.hist); setSources(s.sources); setSaved(s.saved); setFileName(s.fileName); setZ(s.z)
    setSel(s.sel); setSelPages(s.selPages); setCurrentId(s.currentId); setTool('select'); setSideOpen(false)
    pendingScroll.current = s.scroll
  }
  useLayoutEffect(() => {
    const s = pendingScroll.current
    pendingScroll.current = null
    if (s && scroller.current) { scroller.current.scrollTop = s.top; scroller.current.scrollLeft = s.left }
  }, [activeId])

  /** A new tab: the document is added and shown; the one that was showing is put away as it was. */
  const addDoc = (srcs, name, list) => {
    const l = latest.current
    if (l.activeId) stash.current.set(l.activeId, snapshotNow())
    srcs.forEach(retainSource)
    const id = uid('d')
    setTabs(t => [...t, { id, name }]); setActiveId(id)
    show({ hist: newHistory(list), sources: srcs, saved: list, fileName: name, z: fitZoom(srcs.length ? srcs[0].geoms : [blankGeom(595, 842)]), sel: null, selPages: new Set(), currentId: list[0].id, scroll: { top: 0, left: 0 } })
  }

  const switchTo = (id) => {
    const l = latest.current
    if (id === l.activeId) return
    const s = stash.current.get(id)
    if (!s) return
    stash.current.set(l.activeId, snapshotNow())
    stash.current.delete(id)
    show(s); setActiveId(id)
  }

  const closeTab = async (id) => {
    const l = latest.current
    const isActive = id === l.activeId
    const snap = isActive ? snapshotNow() : stash.current.get(id)
    const name = l.tabs.find(t => t.id === id)?.name
    if (snap.hist.present !== snap.saved && !(await confirm({ title: `Close ${name || 'this PDF'}?`, message: 'Your changes to it haven’t been saved. Closing it throws them away.', confirmLabel: 'Discard and close', danger: true }))) return
    snap.sources.forEach(releaseSource)
    stash.current.delete(id)
    const rest = l.tabs.filter(t => t.id !== id)
    setTabs(rest)
    if (!isActive) return
    if (rest.length) {
      const next = rest[Math.min(l.tabs.findIndex(t => t.id === id), rest.length - 1)]
      const s = stash.current.get(next.id)
      stash.current.delete(next.id)
      show(s); setActiveId(next.id)
    } else {
      const empty = newHistory([])
      setHist(empty); setSaved(empty.present); setSources([]); setFileName(''); setActiveId(null)
      setSel(null); setSelPages(new Set()); setCurrentId(null)
      freeImages()
    }
  }

  const run = async (label, fn) => {
    setBusy(label); setError('')
    try { return await fn() } catch (e) {
      console.error('[pdf-editor]', e)
      setError(e instanceof PasswordError || e.message ? e.message : 'Something went wrong.')
      return undefined
    } finally { setBusy('') }
  }

  const readPdf = async (file) => openSource(new Uint8Array(await file.arrayBuffer()))

  /** Opens a PDF in a tab of its own, beside any already open. */
  const openPdf = async (file) => {
    await run('Opening…', async () => {
      const src = await readPdf(file)
      addDoc([src], file.name.replace(/\.pdf$/i, ''), src.geoms.map((_, i) => sourcePage(0, i)))
    })
  }
  const openAll = (files) => files.reduce((p, f) => p.then(() => openPdf(f)), Promise.resolve())

  const blankDocument = () => addDoc([], 'Untitled', [blankPage()])

  const lastSelectedId = () => {
    const l = latest.current
    const ids = l.pages.filter(p => l.selPages.has(p.id)).map(p => p.id)
    return ids.length ? ids[ids.length - 1] : (l.selPages.size ? undefined : l.currentId ?? undefined)
  }

  const addPdf = async (file) => {
    await run('Adding pages…', async () => {
      const src = await readPdf(file)
      const idx = sources.length
      const added = src.geoms.map((_, i) => sourcePage(idx, i))
      retainSource(src)
      setSources(s => [...s, src])
      change(ps => insertPages(ps, added, lastSelectedId()))
      setSelPages(new Set(added.map(p => p.id)))
      showToast(`Added ${added.length} page${added.length === 1 ? '' : 's'} from ${file.name}`)
    })
  }

  const addImage = async (file) => {
    await run('Adding picture…', async () => {
      const img = await prepareImage(file)
      const id = uid('i')
      images.current.set(id, { bytes: img.bytes, type: img.type })
      imageUrls.current.set(id, img.url)
      const l = latest.current
      const page = l.pages.find(p => p.id === l.currentId) || l.pages[0]
      const g = geometry(l.geomOf(page))
      const w = Math.min(img.w * 0.75, g.width * 0.4)
      const h = w * img.h / img.w
      api.add(page.id, newImage((g.width - w) / 2, (g.height - h) / 2, w, h, id), { select: true, revert: true })
    })
  }

  const handleFiles = (files) => {
    const list = [...files]
    const pdfs = list.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
    const pics = list.filter(f => /^image\//.test(f.type))
    if (pdfs.length) openAll(pdfs)
    else if (pics.length && pages.length) pics.forEach(addImage)
    else if (list.length) setError('That isn’t a PDF or a picture.')
  }

  /* ── Pages ── */

  const targets = () => {
    const l = latest.current
    return l.selPages.size ? l.selPages : (l.currentId ? new Set([l.currentId]) : new Set())
  }
  const goTo = (id) => document.getElementById('pe-pg-' + id)?.scrollIntoView({ block: 'start' })

  const pick = (id, e) => {
    const ctrl = e.ctrlKey || e.metaKey
    if (e.shiftKey && anchor.current) {
      const ids = pages.map(p => p.id)
      const a = ids.indexOf(anchor.current), b = ids.indexOf(id)
      setSelPages(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)))
    } else if (ctrl) {
      setSelPages(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
      anchor.current = id
    } else {
      setSelPages(new Set([id])); anchor.current = id
      goTo(id); setSideOpen(false)
    }
  }

  const rotate = (delta) => { const t = targets(); if (t.size) change(ps => rotatePages(ps, t, delta)) }
  const duplicate = () => {
    const t = targets(); if (!t.size) return
    change(ps => duplicatePages(ps, t))
  }
  const remove = async () => {
    const t = targets(); if (!t.size) return
    if (t.size >= pages.length) { showToast('A document needs at least one page'); return }
    if (t.size > 1 && !(await confirm({ title: `Delete ${t.size} pages?`, message: 'You can undo this.', confirmLabel: 'Delete', danger: true }))) return
    change(ps => deletePages(ps, t))
    setSelPages(new Set()); setSel(null)
  }
  const nudge = (dir) => { const t = targets(); if (t.size) change(ps => nudgePages(ps, t, dir)) }
  const addBlank = () => {
    const l = latest.current
    const after = lastSelectedId()
    const ref = l.pages.find(p => p.id === after) || l.pages[l.pages.length - 1]
    const size = ref ? displaySize(l.geomOf(ref), ref.rotate) : { w: 595.28, h: 841.89 }
    const page = blankPage(size.w, size.h)
    change(ps => insertPages(ps, [page], after))
    setSelPages(new Set([page.id]))
    setTimeout(() => goTo(page.id), 50)
  }

  /* ── Copy and paste: pages and objects, between PDFs too ── */

  // The editor's own clipboard (what the system clipboard can't hold). The system clipboard gets a token so a
  // paste knows whether it is ours: anything else copied since (text, a picture) is pasted as itself.
  const sourcesOfClip = (c) => (c?.kind === 'pages' ? c.items.map(it => it.src).filter(Boolean) : [])
  const clipboard = (next) => {
    sourcesOfClip(clip.current).forEach(releaseSource)
    sourcesOfClip(next).forEach(retainSource) // a copied page keeps its file alive even if its document is closed
    clip.current = next
    setClipKind(next?.kind || null)
    return next
  }

  const copyPages = () => {
    const t = targets()
    const list = pages.filter(p => t.has(p.id))
    if (!list.length) return null
    showToast(`Copied ${list.length} page${list.length === 1 ? '' : 's'}`)
    return clipboard({ kind: 'pages', token: uid('clip'), items: list.map(p => ({ src: p.src >= 0 ? sources[p.src] : null, n: p.n, blank: p.blank && { ...p.blank }, rotate: p.rotate, objects: p.objects })) })
  }
  const pastePages = () => {
    const c = clip.current
    if (!c || c.kind !== 'pages') return
    const next = [...sources]
    const indexOf = (src) => {
      let i = next.indexOf(src)
      if (i < 0) { next.push(src); retainSource(src); i = next.length - 1 }
      return i
    }
    const added = c.items.map(it => ({ id: uid('p'), src: it.src ? indexOf(it.src) : -1, n: it.n, blank: it.blank && { ...it.blank }, rotate: it.rotate, objects: cloneObjects(it.objects) }))
    if (next.length !== sources.length) setSources(next)
    const after = lastSelectedId()
    change(ps => insertPages(ps, added, after))
    setSelPages(new Set(added.map(p => p.id)))
    setTimeout(() => goTo(added[0].id), 50)
    showToast(`Pasted ${added.length} page${added.length === 1 ? '' : 's'}`)
  }

  const copyObject = () => {
    const l = latest.current
    const page = l.pages.find(p => p.id === l.sel?.pageId)
    const o = page?.objects.find(x => x.id === l.sel.id)
    if (!o) return null
    const items = o.group ? page.objects.filter(x => x.group === o.group) : [o]
    showToast(items.length > 1 ? `Copied ${items.length} objects` : 'Copied')
    return clipboard({ kind: 'objects', token: uid('clip'), items, from: page.id, count: 0 })
  }
  const pasteObjects = () => {
    const c = clip.current
    const l = latest.current
    const pageId = l.sel?.pageId || l.currentId || l.pages[0]?.id
    if (!c || c.kind !== 'objects' || !pageId) return
    c.count += 1
    const cloned = cloneObjects(c.items, pageId === c.from ? 12 * c.count : 0) // on the page it came from, a little aside; on another, in place
    api.addMany(pageId, cloned, { select: cloned[0].id })
    setTool('select')
  }
  const pasteText = (text) => {
    const l = latest.current
    const pageId = l.sel?.pageId || l.currentId || l.pages[0]?.id
    if (pageId) api.add(pageId, { ...newText(60, 60, d), text: text.replace(/\r\n?/g, '\n').slice(0, 2000) }, { select: true })
  }
  const copyAny = () => {
    const l = latest.current
    const hasObj = l.sel && l.pages.find(p => p.id === l.sel.pageId)?.objects.some(o => o.id === l.sel.id)
    return hasObj && focusArea.current !== 'pages' ? copyObject() : copyPages()
  }
  const cutAny = () => {
    const made = copyAny()
    if (!made) return null
    if (made.kind === 'objects') {
      const ids = new Set(made.items.map(o => o.id))
      change(ps => mapObjects(ps, made.from, os => os.filter(o => !ids.has(o.id))))
      setSel(null)
    } else if (made.items.length < pages.length) {
      const t = targets()
      change(ps => deletePages(ps, t)); setSelPages(new Set())
    }
    return made
  }
  const pasteAny = (e) => {
    const c = clip.current
    const text = e.clipboardData?.getData('text/plain') || ''
    if (c && text === c.token) { e.preventDefault(); if (c.kind === 'pages') pastePages(); else pasteObjects(); return }
    const pic = [...(e.clipboardData?.files || [])].find(f => /^image\//.test(f.type))
    if (pic && latest.current.pages.length) { e.preventDefault(); addImage(pic); return }
    if (text.trim() && latest.current.pages.length) { e.preventDefault(); pasteText(text) }
  }
  const acts = useRef({}); acts.current = { copy: copyAny, cut: cutAny, paste: pasteAny }
  useEffect(() => {
    const typing = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    const onCopy = (e) => { if (typing(e.target) || window.getSelection()?.toString()) return; const m = acts.current.copy(); if (m) { e.clipboardData.setData('text/plain', m.token); e.preventDefault() } }
    const onCut = (e) => { if (typing(e.target) || window.getSelection()?.toString()) return; const m = acts.current.cut(); if (m) { e.clipboardData.setData('text/plain', m.token); e.preventDefault() } }
    const onPaste = (e) => { if (!typing(e.target)) acts.current.paste(e) }
    document.addEventListener('copy', onCopy); document.addEventListener('cut', onCut); document.addEventListener('paste', onPaste)
    return () => { document.removeEventListener('copy', onCopy); document.removeEventListener('cut', onCut); document.removeEventListener('paste', onPaste) }
  }, [])

  /* ── Saving ── */

  const build = async (list, name, label) => run(label, async () => {
    const bytes = await buildPdf({ pages: list, sources: latest.current.sources ?? sources, images: images.current, loadFallbackFont })
    download(new Blob([bytes], { type: 'application/pdf' }), name)
    return true
  })
  const base = fileName || 'document'
  const save = async () => {
    if (!pages.length) return
    const snapshot = pages
    if (await build(pages, `${base}${dirty || !sources.length ? ' (edited)' : ''}.pdf`, 'Saving…')) { setSaved(snapshot); showToast('Saved. Look in your downloads.') }
  }
  const extract = async () => {
    const t = targets(); if (!t.size) return
    const list = pages.filter(p => t.has(p.id))
    if (await build(list, `${base} (${list.length === 1 ? 'page ' + (pages.indexOf(list[0]) + 1) : list.length + ' pages'}).pdf`, 'Extracting…')) showToast(`Saved ${list.length} page${list.length === 1 ? '' : 's'} as a new PDF`)
  }
  const saveRef = useRef(save); saveRef.current = save

  /* ── Zoom ── */

  const zoomTo = (nz) => {
    nz = clamp(nz, 0.25, 4)
    const el = scroller.current
    if (el && nz !== z) {
      const k = nz / z
      zoomFix.current = { top: (el.scrollTop + el.clientHeight / 2) * k - el.clientHeight / 2, left: (el.scrollLeft + el.clientWidth / 2) * k - el.clientWidth / 2 }
    }
    setZ(nz)
  }
  useLayoutEffect(() => {
    const f = zoomFix.current
    if (f && scroller.current) { scroller.current.scrollTop = f.top; scroller.current.scrollLeft = f.left }
    zoomFix.current = null
  }, [z])
  const zoomRef = useRef(zoomTo); zoomRef.current = zoomTo
  useEffect(() => {
    const el = scroller.current
    if (!el) return undefined
    const wheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomRef.current(latest.current.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [pages.length > 0])

  // The page in view, for the page strip and for where new pictures and blank pages go.
  useEffect(() => {
    const el = scroller.current
    if (!el) return undefined
    let raf = 0
    const check = () => {
      raf = 0
      const line = el.getBoundingClientRect().top + el.clientHeight * 0.35
      let id = null
      for (const p of el.querySelectorAll('.pe-page')) {
        id = p.dataset.page
        if (p.getBoundingClientRect().bottom > line) break
      }
      if (id) setCurrentId(id)
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(check) }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [pages.length > 0])

  /* ── Changing what is selected, or what will be drawn next ── */

  const kind = selObj ? selObj.type : tool
  const val = (key) => {
    if (selObj) return selObj[key] ?? DEFAULTS[key]
    return d[kind === 'highlight' && key === 'fill' ? 'highlight' : key]
  }
  const setProp = (key, value, { liveEdit = false } = {}) => {
    const dk = kind === 'highlight' && key === 'fill' ? 'highlight' : key
    setD(x => ({ ...x, [dk]: value, ...(key === 'fill' && value ? { fillPick: value } : {}), ...(key === 'stroke' && value ? { strokePick: value } : {}) }))
    if (selObj) {
      if (liveEdit) api.live(sel.pageId, selObj.id, { ...selObj, [key]: value })
      else api.update(sel.pageId, selObj.id, { [key]: value })
    }
  }

  /* ── Keyboard ── */

  useEffect(() => {
    const onKey = (e) => {
      const l = latest.current
      const t = e.target
      const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 's') { e.preventDefault(); saveRef.current(); return }
      if (typing) return
      if (mod && k === 'z') { e.preventDefault(); setHist(e.shiftKey ? redo : undo); return }
      if (mod && k === 'y') { e.preventDefault(); setHist(redo); return }
      const obj = l.sel && l.pages.find(p => p.id === l.sel.pageId)?.objects.find(o => o.id === l.sel.id)
      if (e.key === 'Escape') { setSel(null); setTool('select'); return }
      if (!obj) return
      const page = l.pages.find(p => p.id === l.sel.pageId)
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); api.remove(page.id, obj.id); return }
      if (mod && k === 'd') {
        e.preventDefault()
        const copy = { ...moveObject(obj, 12, 12), id: uid('o'), group: undefined }
        api.add(page.id, copy, { select: true })
        return
      }
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
      if (arrows) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const [dx, dy] = deltaToPage(arrows[0] * step, arrows[1] * step, page.rotate)
        api.update(page.id, obj.id, moveObject(obj, dx, dy))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api])

  // Leaving with unsaved work asks first (a reload from a new deploy also waits: data-working below).
  useEffect(() => {
    if (!anyDirty) return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [anyDirty])

  useEffect(() => () => {
    // Leaving the editor: every file's worker memory and every picture's URL go.
    const all = new Set([...latest.current.sources, ...[...stash.current.values()].flatMap(s => s.sources), ...sourcesOfClip(clip.current)])
    all.forEach(closeSource)
    freeImages()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const open = pages.length > 0
  const nSel = selPages.size
  const dropFiles = (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); handleFiles(e.dataTransfer.files) } }
  const overFiles = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }

  const picker = (ref, accept, multiple, onFiles) => (
    <input ref={ref} type="file" accept={accept} multiple={multiple} hidden onChange={e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onFiles(f) }} />
  )

  return (
    <div className="pe" data-working={anyDirty ? '' : undefined} onDragOver={overFiles} onDrop={dropFiles}>
      {picker(fileRef, 'application/pdf,.pdf', true, openAll)}

      {tabs.length > 0 && (
        <div className="pe-tabs" role="tablist" aria-label="Open PDFs">
          {tabs.map(t => {
            const active = t.id === activeId
            const s = active ? null : stash.current.get(t.id)
            const unsaved = active ? dirty : !!s && s.hist.present !== s.saved
            return (
              <div key={t.id} role="tab" aria-selected={active} tabIndex={0} className={`pe-tab${active ? ' on' : ''}`} title={t.name}
                onClick={() => switchTo(t.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTo(t.id) } }}
                onAuxClick={e => { if (e.button === 1) { e.preventDefault(); closeTab(t.id) } }}>
                <span className="pe-tab-name">{t.name}</span>
                {unsaved && <i className="pe-tab-dot" title="Unsaved changes" />}
                <button type="button" className="pe-tab-x" aria-label={`Close ${t.name}`} onClick={e => { e.stopPropagation(); closeTab(t.id) }}><X size={14} /></button>
              </div>
            )
          })}
          <button type="button" className="pe-tab-add" aria-label="Open another PDF" title="Open another PDF" onClick={() => fileRef.current.click()}><Plus size={16} /></button>
        </div>
      )}
      {picker(addRef, 'application/pdf,.pdf', true, f => f.reduce((p, x) => p.then(() => addPdf(x)), Promise.resolve()))}
      {picker(imgRef, 'image/*', true, f => f.forEach(addImage))}

      <div className="pe-bar" role="toolbar" aria-label="PDF editor">
        {open && <IconButton label="Pages" className="pe-side-toggle" onClick={() => setSideOpen(o => !o)}><PanelLeft size={18} /></IconButton>}
        <div className="pe-group">
          <Button variant="secondary" size="sm" iconLeft={<FolderOpen size={16} />} onClick={() => fileRef.current.click()}>Open</Button>
          {open && <Button size="sm" iconLeft={<Download size={16} />} onClick={save} disabled={!!busy}>Save</Button>}
        </div>
        {open && <>
          <div className="pe-group">
            <IconButton label="Undo (Ctrl+Z)" onClick={() => setHist(undo)} disabled={!hist.past.length && !hist.base}><Undo2 size={18} /></IconButton>
            <IconButton label="Redo (Ctrl+Y)" onClick={() => setHist(redo)} disabled={!hist.future.length}><Redo2 size={18} /></IconButton>
          </div>
          <div className="pe-group" role="group" aria-label="Tools">
            {TOOLS.map(([id, label, Icon]) => (
              <IconButton key={id} label={label} className={`pe-tool${tool === id ? ' on' : ''}`} aria-pressed={tool === id}
                onClick={() => { setTool(id); if (id !== 'select') setSel(null) }}><Icon size={18} /></IconButton>
            ))}
            <IconButton label="Add a picture" className="pe-tool" onClick={() => imgRef.current.click()}><ImageIcon size={18} /></IconButton>
          </div>
          <div className="pe-group pe-zoom">
            <IconButton label="Zoom out" onClick={() => zoomTo(z / 1.25)}><ZoomOut size={18} /></IconButton>
            <span className="pe-pct" aria-live="polite">{Math.round(z * 75)}%</span>
            <IconButton label="Zoom in" onClick={() => zoomTo(z * 1.25)}><ZoomIn size={18} /></IconButton>
            <IconButton label="Fit to width" onClick={() => zoomTo(fitZoom(pages.map(p => geomOf(p))))}><Maximize size={18} /></IconButton>
          </div>
          <span className="pe-name" title={fileName}>{fileName}{dirty ? ' • unsaved' : ''} · {pages.length} page{pages.length === 1 ? '' : 's'}</span>
        </>}
      </div>

      {open && (
        <div className="pe-props">
          {kind === 'text' && <>
            <label className="pe-field"><span>Size</span>
              <input className="input pe-num" type="number" min="4" max="200" value={val('size')} onChange={e => setProp('size', clamp(+e.target.value || 12, 4, 200))} /></label>
            <label className="pe-field"><span>Font</span>
              <select className="input" value={val('family')} onChange={e => setProp('family', e.target.value)}>
                {Object.entries(FAMILIES).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
              </select></label>
            <IconButton label="Bold" className={`pe-tool${val('bold') ? ' on' : ''}`} aria-pressed={!!val('bold')} onClick={() => setProp('bold', !val('bold'))}><Bold size={16} /></IconButton>
            <IconButton label="Italic" className={`pe-tool${val('italic') ? ' on' : ''}`} aria-pressed={!!val('italic')} onClick={() => setProp('italic', !val('italic'))}><Italic size={16} /></IconButton>
            <ColorField label="Colour" value={val('color')} onChange={v => setProp('color', v, { liveEdit: true })} onDone={api.endLive} />
          </>}
          {(kind === 'rect' || kind === 'ellipse') && <>
            <label className="pe-check"><input type="checkbox" checked={!!val('fill')} onChange={e => setProp('fill', e.target.checked ? d.fillPick : null)} /> Fill</label>
            {val('fill') && <ColorField label="" value={val('fill')} onChange={v => setProp('fill', v, { liveEdit: true })} onDone={api.endLive} />}
            <label className="pe-check"><input type="checkbox" checked={!!val('stroke')} onChange={e => setProp('stroke', e.target.checked ? d.strokePick : null)} /> Border</label>
            {val('stroke') && <>
              <ColorField label="" value={val('stroke')} onChange={v => setProp('stroke', v, { liveEdit: true })} onDone={api.endLive} />
              <label className="pe-field"><span>Width</span>
                <input className="input pe-num" type="number" min="0.5" max="30" step="0.5" value={val('sw')} onChange={e => setProp('sw', clamp(+e.target.value || 1, 0.5, 30))} /></label>
            </>}
          </>}
          {kind === 'highlight' && <ColorField label="Colour" value={val('fill')} onChange={v => setProp('fill', v, { liveEdit: true })} onDone={api.endLive} />}
          {(kind === 'line' || kind === 'pen') && <>
            <ColorField label="Colour" value={val('stroke')} onChange={v => setProp('stroke', v, { liveEdit: true })} onDone={api.endLive} />
            <label className="pe-field"><span>Width</span>
              <input className="input pe-num" type="number" min="0.5" max="30" step="0.5" value={val('sw')} onChange={e => setProp('sw', clamp(+e.target.value || 1, 0.5, 30))} /></label>
          </>}
          {selObj && <IconButton label="Copy (Ctrl+C): paste it here or into another PDF" onClick={() => { focusArea.current = 'objects'; copyObject() }}><ClipboardCopy size={16} /></IconButton>}
          {clipKind === 'objects' && <IconButton label="Paste (Ctrl+V)" onClick={pasteObjects}><ClipboardPaste size={16} /></IconButton>}
          {selObj && <>
            <IconButton label="Duplicate (Ctrl+D)" onClick={() => api.add(sel.pageId, { ...moveObject(selObj, 12, 12), id: uid('o'), group: undefined }, { select: true })}><Copy size={16} /></IconButton>
            <IconButton label="Delete (Delete key)" onClick={() => api.remove(sel.pageId, selObj.id)}><Trash2 size={16} /></IconButton>
          </>}
          <div className="pe-pagetools" role="group" aria-label={nSel > 1 ? `${nSel} pages selected` : 'Page tools'}>
            <span className="pe-pagetools-label">{nSel > 1 ? `${nSel} pages` : 'Page'}</span>
            <IconButton label="Rotate left" size="sm" onClick={() => rotate(-90)}><RotateCcw size={16} /></IconButton>
            <IconButton label="Rotate right" size="sm" onClick={() => rotate(90)}><RotateCw size={16} /></IconButton>
            <IconButton label="Move earlier" size="sm" onClick={() => nudge(-1)}><ArrowUp size={16} /></IconButton>
            <IconButton label="Move later" size="sm" onClick={() => nudge(1)}><ArrowDown size={16} /></IconButton>
            <IconButton label="Duplicate page" size="sm" onClick={duplicate}><Copy size={16} /></IconButton>
            <IconButton label="Copy pages (to paste into this or another PDF)" size="sm" onClick={copyPages}><ClipboardCopy size={16} /></IconButton>
            <IconButton label="Paste pages" size="sm" disabled={clipKind !== 'pages'} onClick={pastePages}><ClipboardPaste size={16} /></IconButton>
            <IconButton label="Delete page" size="sm" onClick={remove}><Trash2 size={16} /></IconButton>
            <IconButton label="Add a blank page" size="sm" onClick={addBlank}><FilePlus2 size={16} /></IconButton>
            <IconButton label="Add pages from another PDF" size="sm" onClick={() => addRef.current.click()}><Files size={16} /></IconButton>
            <IconButton label="Save selected pages as a new PDF" size="sm" onClick={extract}><FileOutput size={16} /></IconButton>
          </div>
        </div>
      )}

      {error && <Alert tone="critical" title="Couldn’t do that" className="pe-alert" action={<Button variant="ghost" size="sm" onClick={() => setError('')}>Dismiss</Button>}>{error}</Alert>}

      <div className="pe-body">
        {open && (
          <aside className={`pe-side${sideOpen ? ' open' : ''}`} onPointerDownCapture={() => { focusArea.current = 'pages' }}>
            <Thumbs pages={pages} sources={sources} geomOf={geomOf} selected={selPages} currentId={currentId} onPick={pick}
              onMove={(ids, before) => change(ps => movePages(ps, ids, before))} />
          </aside>
        )}
        <div className="pe-scroll" ref={scroller} onPointerDownCapture={() => { focusArea.current = 'objects' }}>
          {open ? (
            <div className="pe-pages">
              {pages.map(p => (
                <PageView key={p.id} entry={p} geom={geomOf(p)} src={p.src >= 0 ? sources[p.src] : null} z={z} tool={tool}
                  selId={sel && sel.pageId === p.id ? sel.id : null} defaults={d} imageUrls={imageUrls.current} api={api} />
              ))}
            </div>
          ) : (
            <div className="pe-empty">
              <h1 className="pe-title">PDF Editor</h1>
              <p className="pe-lead">Open a PDF to edit its text, rearrange its pages and add text, pictures, shapes and highlights. Everything happens on this device: the file is never uploaded.</p>
              <div className="pe-empty-actions">
                <Button iconLeft={<FolderOpen size={16} />} onClick={() => fileRef.current.click()}>Open a PDF</Button>
                <Button variant="secondary" onClick={blankDocument}>Start with a blank page</Button>
              </div>
              <p className="pe-small">Or drop a PDF anywhere on this page.</p>
            </div>
          )}
          {busy && <div className="pe-busy" role="status"><Loading /><span>{busy}</span></div>}
        </div>
      </div>
      <Toast message={toast} />
      {confirmDialog}
    </div>
  )
}
