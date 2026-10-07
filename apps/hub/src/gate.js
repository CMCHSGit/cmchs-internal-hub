// /shared/gate.js — the sign-in check for plain pages (the /service tools).
//
// A page opts in with two lines at the top of <head>:
//   <script>document.documentElement.style.visibility='hidden'</script>
//   <script type="module" src="/shared/gate.js"></script>
//
// Signed in at the hub already (the usual case): the page shows straight away,
// with a slim "Internal Hub" bar on top. No second sign-in: the session is the
// hub's own, shared by every page on this site.
// Signed out: off to the hub's Microsoft sign-in, then straight back here.
import { goToSignIn, initialsOf, watchUser } from '../../../shared/session.js'

const BAR_CSS = `
.hub-bar{all:initial;display:flex;align-items:center;gap:12px;box-sizing:border-box;min-height:44px;padding:0 16px;
  background:#fff;border-bottom:1px solid #e8e9ea;font:400 14px/1.2 "Source Sans 3","Segoe UI",system-ui,sans-serif;color:#1d1d1d;position:relative;z-index:2147483000}
.hub-bar *{box-sizing:border-box}
.hub-bar a{display:flex;align-items:center;gap:10px;color:#1d1d1d;text-decoration:none;font-weight:600;padding:4px 6px;border-radius:6px}
.hub-bar a:hover{background:#dbd7ed}
.hub-bar a:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(85,69,150,.32)}
.hub-bar img{width:22px;height:22px;display:block}
.hub-bar .hub-back{color:#747577;font-size:18px;line-height:1}
.hub-bar .hub-fill{flex:1}
.hub-bar .hub-av{width:28px;height:28px;border-radius:999px;background:#554596;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px}
.hub-stripes{all:initial;display:flex;height:3px}
.hub-stripes span{flex:1}`

function addBar(user) {
  const style = document.createElement('style')
  style.textContent = BAR_CSS
  document.head.appendChild(style)

  const bar = document.createElement('div')
  bar.className = 'hub-bar'
  bar.innerHTML = `
    <a href="/" title="Back to Internal Hub"><span class="hub-back" aria-hidden="true">&lsaquo;</span><img src="/brand/logo-mark.png" alt="">Internal Hub</a>
    <span class="hub-fill"></span>
    <span class="hub-av"></span>`
  const av = bar.querySelector('.hub-av')
  av.textContent = initialsOf(user)
  av.title = user.displayName || user.email || ''

  const stripes = document.createElement('div')
  stripes.className = 'hub-stripes'
  stripes.setAttribute('aria-hidden', 'true')
  stripes.innerHTML = '<span style="background:#554596"></span><span style="background:#80bd01"></span><span style="background:#ef7d00"></span>'

  document.body.prepend(bar, stripes)
}

function reveal() {
  document.documentElement.style.visibility = ''
}

let decided = false
const unsubscribe = watchUser(user => {
  if (decided) return
  decided = true
  queueMicrotask(() => unsubscribe?.())
  if (!user) return goToSignIn()
  const show = () => { addBar(user); reveal() }
  if (document.body) show()
  else document.addEventListener('DOMContentLoaded', show, { once: true })
})

// If the sign-in check itself breaks, say so instead of leaving a blank page.
setTimeout(() => {
  if (decided) return
  reveal()
  const note = document.createElement('div')
  note.setAttribute('role', 'alert')
  note.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font:16px/1.5 system-ui,sans-serif;color:#1d1d1d;text-align:center'
  note.innerHTML = 'Couldn’t check your sign-in. <a href="" style="color:#554596;margin-left:6px">Reload the page</a>'
  document.body.appendChild(note)
}, 15000)
