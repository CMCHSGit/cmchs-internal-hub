/* Exporting jobs from Simpro Deep Search to a file: each job's number, title, description and notes (as plain text, the rich
   text turned into lines), to be read through by a person or by Cowork, e.g. to pull part numbers and fixes into the knowledge base.
   Customer and site names are left out unless asked for. No React, no DOM, so the tests run it as it is. */
import { htmlToText } from './html.js'
import { customerName, statusName } from './search.js'

export const FORMATS = [
  { id: 'md', label: 'Markdown (best for Cowork)', ext: 'md', type: 'text/markdown' },
  { id: 'json', label: 'JSON', ext: 'json', type: 'application/json' },
  { id: 'csv', label: 'CSV (Excel)', ext: 'csv', type: 'text/csv' },
]
/** More than this many jobs and the export is several files in a zip, so each is a size that can be read in one go. */
export const PER_FILE = 100
export const ZIP_ABOVE = 150

const day = (v) => (v ? String(v).slice(0, 10) : '')

/** One job as it goes in the file. */
export function recordOf(job, { people = false } = {}) {
  const rec = {
    job: job.ID,
    title: String(job.Name || '').trim(),
    stage: job.Stage || '',
    status: statusName(job),
    issued: day(job.DateIssued),
    description: htmlToText(job.Description),
    notes: htmlToText(job.Notes),
  }
  if (people) { rec.customer = customerName(job); rec.site = job.Site?.Name || '' }
  return rec
}

const fence = (s) => String(s).replace(/^(#{1,6})\s/gm, '\\$1 ').replace(/^---+$/gm, '\\---') // keep a job's own "## x" lines from looking like our headings

export function toMarkdown(records, meta = {}) {
  const head = '# Simpro jobs export\n\n' + [
    `Jobs: ${records.length}${meta.part ? ` (part ${meta.part} of ${meta.parts})` : ''}`,
    meta.stamp && `Exported: ${meta.stamp}`,
    meta.searched && `Search: ${meta.searched}`,
    'Source: the title, description and notes written on each Simpro job. Written by staff, so spelling and layout vary.',
  ].filter(Boolean).join('\n')
  const body = records.map((r) => {
    const status = [r.stage && `Stage: ${r.stage}`, r.status && `Status: ${r.status}`, r.issued && `Issued: ${r.issued}`].filter(Boolean).join(' | ')
    const who = r.customer === undefined ? '' : [r.customer && `Customer: ${r.customer}`, r.site && `Site: ${r.site}`].filter(Boolean).join(' | ')
    return [
      `## Job ${r.job}${r.title ? ': ' + r.title.replace(/\s+/g, ' ') : ''}`,
      ...(status ? [status] : []),
      ...(who ? [who] : []),
      '',
      '### Description', r.description ? fence(r.description) : '(none)',
      '',
      '### Notes', r.notes ? fence(r.notes) : '(none)',
      '',
      '---',
    ].join('\n')
  })
  return head + '\n\n' + body.join('\n\n') + '\n'
}

export function toJson(records, meta = {}) {
  return JSON.stringify({ exported: meta.stamp || '', search: meta.searched || '', count: records.length, jobs: records }, null, 2) + '\n'
}

// A cell starting with = + - @ is a formula to Excel: a leading apostrophe keeps it text.
const cell = (v) => {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
export function toCsv(records) {
  const cols = Object.keys(records[0] || { job: 1, title: 1, stage: 1, status: 1, issued: 1, description: 1, notes: 1 })
  const rows = [cols.join(','), ...records.map((r) => cols.map((c) => cell(r[c])).join(','))]
  return '﻿' + rows.join('\r\n') + '\r\n' // the BOM makes Excel read it as UTF-8
}

/**
 * The files for an export: [{ name, text, type }]. One file, or when there are more than ZIP_ABOVE jobs several of PER_FILE
 * (the caller zips them). `stamp`: the date for the names and the header (YYYY-MM-DD).
 */
export function buildFiles(records, { format = 'md', stamp = '', searched = '' } = {}) {
  const f = FORMATS.find((x) => x.id === format) || FORMATS[0]
  const parts = []
  if (records.length > ZIP_ABOVE) for (let i = 0; i < records.length; i += PER_FILE) parts.push(records.slice(i, i + PER_FILE))
  else parts.push(records)
  return parts.map((chunk, i) => {
    const meta = { stamp, searched, part: parts.length > 1 ? i + 1 : 0, parts: parts.length }
    const text = f.id === 'json' ? toJson(chunk, meta) : f.id === 'csv' ? toCsv(chunk) : toMarkdown(chunk, meta)
    const name = `simpro-jobs${stamp ? '-' + stamp : ''}${parts.length > 1 ? `-part-${i + 1}` : ''}.${f.ext}`
    return { name, text, type: f.type }
  })
}
