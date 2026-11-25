/** Copy text; true when it worked. Falls back to the old way (a field or a hidden box, selected) where the clipboard API isn't offered. */
export async function copyText(text, field) {
  try { await navigator.clipboard.writeText(text); return true } catch { /* try the old way */ }
  try {
    const box = field || Object.assign(document.createElement('textarea'), { value: text })
    if (!field) document.body.appendChild(box)
    box.select()
    const ok = document.execCommand('copy')
    if (!field) box.remove()
    return ok
  } catch { return false }
}
