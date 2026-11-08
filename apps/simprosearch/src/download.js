/* Saving an export on this computer: one file, or a zip when buildFiles (export.js) made several. */
import { makeZip } from '../../testbench/src/zip.js'

function save(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/** files: buildFiles()'s result. Returns how many files were made (more than one means they are in a zip). */
export function saveFiles(files, stamp) {
  if (files.length === 1) { save(files[0].name, files[0].text, files[0].type); return 1 }
  const enc = new TextEncoder()
  save(`simpro-jobs-${stamp}.zip`, makeZip(files.map((f) => ({ name: f.name, bytes: enc.encode(f.text) }))), 'application/zip')
  return files.length
}
