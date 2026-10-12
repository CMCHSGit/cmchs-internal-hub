# Upgrade: Home page v2

Paste into Claude Code from the root of the existing internal-hub repo:

> Read `design_handoff_internal_hub/UPGRADE-v2.md` and update the home page to match `design/CMCHS Internal Hub v2.dc.html` (screen 2a/2b in `design/Hub Overview.dc.html`). Keep the header, tool view, People, Manage, auth and `tools.json` as they are. Show me the plan before editing.

## Reference
- Design: `design/CMCHS Internal Hub v2.dc.html` — open in a browser. Its logic class holds the data shapes (`ANNS`, `EVENTS`, `SHORT`, stats, calendar build).
- Only the home screen changed. Everything below the global header and above nothing else.
- New asset: `design/assets/logo-mark-white.png` (ghost graphic). Copy into the app's assets.

## What changed
1. **Header** — search box hidden on Home (the hero has it). Still shown on other screens.
2. **Hero** (new) — full-width, `linear-gradient(135deg,#554596,#3f3374)`. White logo mark at 7% opacity cropped off bottom-right (560px, right -120, bottom -160) and 5% top-left (420px, left -140, top -170). Centred: overline date (white 86%), h1 "Kia ora, {firstName}" Titillium 600 48px (34px mobile), sub "{n} people out today · {name} is on call this week" 300 17px white 86%. Search Input `lg`, max 640px, same tool+people dropdown as the header. Row of round quick-launch buttons, one per visible tool: 68px white circle (56 mobile), purple 26px icon, shadow `0 4px 12px rgba(0,0,0,.18)`, hover #dbd7ed + lift 2px; white 600 13.5px label using short names (Demo tracker, Staff schedule, Service orders, Ansur reports, Simpro sync, Outlook, Teams). Add an optional `short` field to `tools.json`; fall back to `name`.
3. **StripeRule** 6px under the hero.
4. **At a glance** — 4 Cards (4 cols, 2 on mobile), accents purple/green/orange/stripes: In the office (office + customer calls), On site, Remote or home (remote + WFH), Out today (leave + non-working). Overline + icon (building, map-pin, laptop, calendar-x), number Titillium 600 40px, first 3 names "+N". Click → People.
5. **News and announcements** — replaces the old side Announcements card. Section header: two 18×4 stripes, overline, h3. Tag filters: All / Announcements / Events / Tool updates. 3-col grid of Cards (padding 0): 190px photo area on top, orange solid "Pinned" badge, category Badge (Announcements purple, Events green, Tool updates orange) + "date · author", title Titillium 600 19px, body 300 15px. Add `category` and optional `image` to `announcements.json`; with no image show the #f4f4f5 block. Empty: "Nothing posted in this category yet."
6. **Who's where today + Calendar** — two cols `minmax(0,1fr) 380px` (stacks on mobile).
   - Left: search + department Tags, first 8 people as Cards (2 cols at ≥1180px, else 1), ghost button "See all {n} people" → People.
   - Right: Card with month nav (IconButtons), Monday-first 7-col grid, 38px cells. Today = #554596 fill white text; events #e9f2da with green dot; public holidays #fee7d1 with orange dot; weekends #a7a9ac. Legend, then the month's events (big day number, month abbr, title, time, Badge). Add `events.json` `{date, title, time, tag, kind: "event"|"holiday"}`. NZ public holidays for 2026: 26 Oct Labour Day, 25 Dec Christmas, 28 Dec Boxing Day (observed).
7. **Tools** — same grouped grid as before, now under a section header with the Recent tools as Tags on the right. The old "Recently used" button row is removed.
8. **Footer** (new) — #1d1d1d, ghost mark 6% bottom-right, "CMCHS Internal Hub" + address left, "Hub support" contact right.
9. Spacing — page padding 40px 24px 72px (28px 16px 40px mobile), 56px between sections (36px mobile).

## Data notes
- Stats and directory use today's entries from the staff schedule feed. Hide those blocks if the feed is not available.
- The sample announcements and the A9 training event are placeholders.
