/* Hands the person a file they asked for (an export of what they are looking at). */
export function download(name, text, type = 'text/plain') {
  // The BOM keeps Excel reading accented letters as UTF-8.
  const blob = new Blob(['﻿', text], { type: type + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
