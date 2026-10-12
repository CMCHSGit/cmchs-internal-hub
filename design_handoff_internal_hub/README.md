# Handoff: CMCHS Internal Hub (internal.chsnz.co.nz)

## Overview
A staff intranet portal for Cass Medical / Connected Healthcare Systems. One Microsoft (Entra) sign-in, then a home page that lists every internal tool grouped by category, plus who's on call / out today (from the staff schedule), recently used tools, announcements, a staff directory and search across tools and people. Tools open inside the hub (header stays, tool fills the page in an iframe) with a pop-out button; some (Outlook, Teams) always open in a new tab. New tools are added by editing `tools.json` in Git; an in-app "Add a tool" admin form is phase 2.

Chosen layout: **Launcher grid** (screen 1a in `design/Hub Overview.dc.html`). Layouts 1b (sidebar) and 1c (search first) were explored and rejected — don't build them.

## About the design files
Everything in `design/` is a **design reference built in HTML** — a working prototype of the intended look and behaviour, not production code. Recreate it in a real codebase. No hub codebase exists yet, so pick the stack (recommended below). Open `design/Hub Overview.dc.html` in a browser to see every screen; `design/CMCHS Internal Hub.dc.html` is the interactive prototype (the `layout`, `initialScreen`, `forceMobile` props drive the overview frames). The `.dc.html` format and `support.js` are prototype tooling only — don't port them.

`tools/` holds the three existing single-file tools **as production files**. Ship them as-is under `/tools/`.

## Fidelity
**High fidelity.** Final colours, type, spacing and copy, all from the Connected Healthcare Systems design system (bundled at `design/_ds/…`, guide in its `README.md`). Match it closely.

## Recommended stack & hosting
- Static site: Vite + React (or plain TS) — no server needed beyond Azure's built-ins.
- Host on **Azure Static Web Apps**, repo `CMCHSGit/internal-hub`, branch `main`, deploy via the GitHub Actions workflow Azure generates.
- Custom domain `internal.chsnz.co.nz` (CNAME at the chsnz.co.nz registrar).
- Auth: `staticwebapp.config.json`:
```json
{
  "routes": [{ "route": "/*", "allowedRoles": ["authenticated"] }],
  "responseOverrides": { "401": { "redirect": "/.auth/login/aad", "statusCode": 302 } }
}
```
  The Free plan's built-in AAD login accepts any Microsoft account. To restrict to the Cass Medical tenant, use a custom Entra app registration (Standard plan) — needs IT approval. User name/initials come from `/.auth/me`.
- Later: embed in SharePoint (Embed web part; allow `internal.chsnz.co.nz` under HTML Field Security) and add as a Teams Website tab.

## Data files (repo root)
**`tools.json`** — array, one entry per tool:
```json
{ "id": "ansur", "name": "Ansur PVT Report Builder",
  "description": "Turn Fluke Ansur test records (.mtr) into PDF reports",
  "link": "tools/Ansur PVT Report Builder.html",
  "category": "Service", "icon": "file-check", "opens": "hub", "visible": true }
```
- `category`: Demo | Service | Schedule | Sales | Clinical | Admin | Microsoft 365 (render in that order; unknown categories appended after; empty categories hidden).
- `icon`: any Lucide 0.451 name. `opens`: `hub` (iframe) | `tab` (new tab).

Seed with:
| id | name | description | link | category | icon | opens |
|---|---|---|---|---|---|---|
| demo | Demo equipment tracker | Scan, loan, and track CMCHS demo equipment | https://demo.chsnz.co.nz | Demo | package | hub |
| schedule | Staff schedule | View rosters, on-call, and leave | https://schedule.chsnz.co.nz | Schedule | calendar-days | hub |
| parser | Service Order Parser | Paste a service order, extract the fields, copy to the sheet | tools/Service Order Parser.html | Service | clipboard-list | hub |
| ansur | Ansur PVT Report Builder | Turn Fluke Ansur test records (.mtr) into PDF reports | tools/Ansur PVT Report Builder.html | Service | file-check | hub |
| simpro | Simpro Asset Sync | Updates and adds customer assets in cass.simprosuite.com from an asset list | tools/SimproSync.html | Service | refresh-cw | hub |
| outlook | Outlook | Email and calendar | https://outlook.office.com | Microsoft 365 | mail | tab |
| teams | Teams | Chat, calls and meetings | https://teams.microsoft.com | Microsoft 365 | message-square | tab |

**`announcements.json`** — `{ id, title, body, date, author, pinned }[]`; pinned first. The three in the prototype are placeholder copy — replace with real content or start empty.

**Staff schedule feed** — the home "today" cards and People screen need today's entry per person from the staff schedule (repo `CMCHSGit/Staff-Schedule_v2`; `design/Staff Schedule.dc.html` shows its data model: people with `dept` and per-day codes `O` office, `S:<place>` site, `R` remote, `W` WFH, `C` customer calls, `L` leave, `N` non-working day, `H` public holiday, `T` training, plus an on-call person). Expose a read-only JSON endpoint/file from that app; until it exists, hide those cards rather than showing fake data.

## Screens

### Global header (all signed-in screens)
- White, min-height 64px, horizontal padding 24px (16px mobile), then a 4px three-stripe rule (`StripeRule`: purple #554596 / green #80bd01 / orange #ef7d00).
- Left: full-colour logo 150px wide + 1px×28px #d1d3d4 divider + "Internal Hub" (h4: Titillium Web 600). Mobile: logo mark 32px. **When a tool is open, hide the logo** (avoid a double logo with the tool's own); "Internal Hub" text stays and goes home on click.
- Tabs (desktop): Home / People / Manage, aligned to header bottom. Active = purple underline.
- Search input (sm, 340px, max 40vw, search icon) "Search tools and people". Typing shows a dropdown (400px, white, radius 10, shadow `0 16px 48px rgba(29,29,29,.2)`, padding 8): matching tools (32px purple-tint #dbd7ed icon tile, name 600, description caption) then up to 5 people (32px round grey initials, name, "Dept · where today"). Empty: "No tools or people match that search."
- Right: 34px purple avatar with initials (white 600 13px) + name / team caption (desktop only).

### Home — launcher grid
Container max 1180px, centred, padding 32px 24px 56px (mobile 20px 16px 32px), column gap 28px.
1. Overline date ("Monday 5 October": 11.5px uppercase .14em #747577) + h1 "Kia ora, {firstName}".
2. Three today cards, 3-col grid gap 12 (1 col mobile). Each a `Card` (padding 16px 18px, interactive, opens Staff schedule): overline with 14px icon + chips (radius 3, padding 2px 8px, 14px #1d1d1d). Cards & chip colours (from the schedule's own legend):
   - "On call this week" (phone) — #FF7C80
   - "Customer calls today" (headset) — #FFFF00
   - "Out today" (calendar-x) — leave #FFC000, non-working day #D9D9D9. Empty text "Everyone is in." / "No one assigned."
3. Two columns `minmax(0,1fr) 340px`, gap 28 (stacks on mobile):
   - Left: **Recently used** — up to 4 buttons (white, 1px #d1d3d4, radius 6, min-height 44, purple 18px icon, 600 14px; hover bg #dbd7ed border #cac4e3). Stored per user in localStorage (`cmchs-hub-recent`), most recent first. Then **one section per category**: header = two 12×4px stripes (category colours below) + category name (h4) + count (mono 11.5px #a7a9ac); grid `repeat(auto-fill,minmax(250px,1fr))` gap 14 of tool cards.
   - Tool card: `Card` padding 18, interactive (hover lift 2px). Top row: 40px #dbd7ed tile with 20px #554596 icon; right an IconButton "Open in a new tab" (external-link 16). Name 600 16px #1d1d1d, description body-sm #575756, host in mono 11.5px #747577 (ellipsis).
   - Category stripe colours: Demo purple+green, Service purple+orange, Schedule green+orange, Sales orange+purple, Clinical green+purple, Admin purple+purple, Microsoft 365 #a7a9ac×2.
   - Right: **Announcements** — `Card` padding 0, accent="stripes"; rows padding 16px 18px separated by 1px #e8e9ea; orange "Pinned" badge, caption "date · author", title 600 15px, body body-sm.

### Tool open
- Sub-bar under header: white, 1px #e8e9ea bottom border, min-height 52, padding 8px 24px. Ghost sm button "All tools" (chevron-left; "Back" on mobile) + divider, 30px icon tile, tool name 600 16px (+ host mono on desktop), up to 3 recent hub tools as `Tag`s to switch, secondary sm "Pop out" button (external-link). Mobile: icon button instead.
- Below: full-size iframe, no border. Main area doesn't scroll; the iframe does.
- Check `X-Frame-Options` / CSP `frame-ancestors` on demo.chsnz.co.nz and schedule.chsnz.co.nz — they must allow `internal.chsnz.co.nz`. If a tool can't be framed, set `opens: "tab"`.

### People
Overline "Staff directory", h2 "Who's where today", caption "{n} people · from the staff schedule · {name} is on call". Search input (220px) + department Tags (All, Admin, Management, Engineers, Sales, Applications; multi-select). Grid `repeat(auto-fill,minmax(260px,1fr))` gap 10 of Cards (padding 12px 14px): 38px round initials (on-call person: #FF7C80 bg, name suffixed " - OnCall"), name 600 15px, 10px swatch of today's status colour + where (e.g. "Tauranga", "Cass Office", "Leave"), dept caption right. Empty: "No one matches that search."

### Manage (admin)
Overline "Manage", h2 "Tools and announcements", primary button "Add a tool" / "Post announcement" depending on tab. Tabs: Tools (count) / Announcements (count).
- Tools tab: two columns `minmax(0,1fr) 340px`. Left Card table: header row bg #f4f4f5 (Tool / Category / Opens / Shown); rows: icon tile + name + host, category, "Inside the hub"/"New tab", `Switch` for visible (hidden rows at 55% opacity), pencil IconButton → edit dialog. Right tinted Card "Or edit it in Git" explaining `tools.json` + `tools/`, with a dark code block (#1d1d1d bg, #e8e9ea text, mono 12px).
- Announcements tab: rows with title, "date · author", "Pinned" Switch, trash IconButton.
- Toast (success) bottom-right on every change, auto-dismiss 3.2s.
- **Phase 2:** writes need a backend. Suggest an Azure Functions API (bundled with Static Web Apps) that commits to `tools.json` / `announcements.json` via the GitHub API, gated to an `admin` role (SWA role assignment). Until then, show Manage as read-only or hide it for non-admins.

### Add / edit tool dialog
`Dialog` width 560, title "Add a tool" / "Edit tool", description "It appears on everyone's home page as soon as you save." Fields: Tool name* (placeholder "Quote builder"), Link* (hint "A web address, or a file path in the tools/ folder."), What it does* (hint "One line. Shown under the name."), Category (Select) + Opens (Select: Inside the hub / New browser tab) side by side, Icon picker (12 × 44px buttons: wrench, clipboard-list, file-text, calculator, package, calendar-days, users, stethoscope, graduation-cap, chart-line, refresh-cw, link; selected = purple border + #dbd7ed). Footer: ghost "Cancel", primary "Add tool"/"Save changes". Validation: name, link, description required → toast "Name, link and description are required."

### Post announcement dialog
Width 520. Title*, Message (Textarea 4 rows), "Pin to the top" Switch. Footer Cancel / Post.

### Sign in (only if not using SWA's redirect)
Centred column max 380px on white: three 30×5 stripes, logo 180px, overline "internal.chsnz.co.nz", h2 "CMCHS Internal Hub", body "Sign in with your Cass Medical Microsoft 365 account to open the demo tracker, staff schedule and service tools.", lg block primary "Sign in with Microsoft", caption "Trouble signing in? Call the office on 0800 424 797."

### Mobile (< 760px)
Header shows mark logo + "Internal Hub" + avatar (no tabs/search in header). Bottom nav (white, top hairline, 3 cols, min-height 60): Home (house) / People (users) / Manage (settings); active #554596, inactive #747577; hidden when a tool is open. All grids collapse to one column. Toasts sit 76px from the bottom.

## Design tokens (from the CHS design system)
- Colours: purple #554596 (tint 20% #dbd7ed, 30% #cac4e3, hover dark #3f3374), green #80bd01 (#e9f2da), orange #ef7d00 (#fee7d1), ink #1d1d1d, body #575756, muted #747577, faint #a7a9ac, hairline #d1d3d4, subtle #e8e9ea, page grey #f4f4f5, white. Red #c8102e only for alarms.
- Type: Titillium Web (display, 600, slight negative tracking) for h1–h4; Source Sans 3 for body (300 running copy, 600 titles); IBM Plex Mono for hosts/codes. Overline 11.5px uppercase .14em.
- Radius: 3 small controls/chips, 6 buttons/inputs/tiles, 10 cards, pill badges/tags.
- Shadows: card `0 1px 2px` + `0 4px 12px` at 6–7% black; overlay `0 16px 48px rgba(29,29,29,.2)`.
- Motion: 150ms controls, 220ms surfaces, `cubic-bezier(.2,.6,.2,1)`. No bounce.
- Never: emoji, coloured left borders, decorative gradients.
Full tokens: `design/_ds/…/tokens/*.css`; component contracts: `components/**/*.d.ts` in the design system.

## Assets
- `design/assets/logo-full-colour.png`, `logo-mark.png` — CHS logo (from the design system; don't redraw).
- Icons: Lucide 0.451.0.
- `tools/*.html` — existing production tools (Service Order Parser, Ansur PVT Report Builder, SimproSync).

## Security notes
- demo.chsnz.co.nz and schedule.chsnz.co.nz are on GitHub Pages with no auth. Once the hub is live, move them behind the same SWA login (or into the hub repo).
- SimproSync calls the Simpro API — don't commit any API keys into the hub repo.

## Files
- `design/Hub Overview.dc.html` — every screen side by side (1a home, 1d/1e tool open, 1f manage, 1g add tool, 1h people, 1i sign in, 1j–1l mobile).
- `design/CMCHS Internal Hub.dc.html` — interactive prototype; its logic class has the seed data and behaviour.
- `design/Staff Schedule.dc.html` — staff schedule data model / status colours.
- `tools/` — the three tools to ship.
