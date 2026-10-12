# Connected Healthcare Systems — Design System

Connected Healthcare Systems (CHS, trading online as chsnz.co.nz) is a New Zealand owned and operated medical technology distributor based at 6C Jack Conway Avenue, Manukau, Auckland. CHS brings Kiwi hospitals and aged-care providers the latest patient monitoring, resuscitation, diagnostic, surgical, anaesthesia and ventilation equipment as the New Zealand distributor for **Mindray Medical**, and hands-free clinical communications as the representative for **Vocera Communication Systems**.

The company's differentiator is proximity: 36 NZ-based staff strategically located across the country, delivering in-region accountability, rapid response and deep clinical understanding — without the latency of offshore engineering or technical assistance.

**Mission:** Connect Patients, Connecting Lives, Connected Health. This is also the logic behind the three-stripe brand device (see VISUAL FOUNDATIONS) — one word, one colour, one figure each.

## Sources this system was built from

| Source | What it gave us |
| --- | --- |
| `assets/source/J5065 Connected_Brand Guidelines.pdf` (Brand Guidelines, August 2014, 11pp) | Logo rules, full Pantone/CMYK/RGB colour swatch, typefaces, clear space and minimum size, graphic devices (ghost graphic + three stripes), misuse rules, contact |
| `guidelines/source-brand-guidelines-2014.txt` | Text extraction of the above, kept verbatim for reference |
| `assets/source/Connected Logo Final.png` / `.pdf` | The master logo artwork — every logo asset here is derived from it, nothing was redrawn |
| https://www.chsnz.co.nz (home, About us) | Product/solution taxonomy, education programme list, navigation structure, body copy and tone |

**No product code, Figma file or screenshot set was supplied.** The website UI kit therefore rebuilds the live site's information architecture against the brand guidelines rather than pixel-copying it (the live site is a Wix template with no exportable component source). Flagged substitutions are listed at the bottom of this file.

## Index

| Path | What's there |
| --- | --- |
| `styles.css` | The single entry point consumers link. Imports everything below. |
| `tokens/` | `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `radius.css`, `elevation.css`, `motion.css`, `base.css` |
| `components/core/` | Button, IconButton, Icon, Logo, StripeRule, Card, Badge, Tag |
| `components/forms/` | Field, Input, Textarea, Select, Checkbox, RadioGroup, Switch |
| `components/navigation/` | Tabs, Breadcrumbs, Pagination |
| `components/feedback/` | Alert, Dialog, Toast, Tooltip |
| `ui_kits/website/` | Click-through recreation of chsnz.co.nz — home, solution detail, education hub, about, contact |
| `ui_kits/stationery/` | Letterhead, business card, email signature and presentation title slide |
| `guidelines/` | Foundation specimen cards (Colors, Type, Spacing, Brand) + the source guideline text |
| `assets/` | Logo artwork: `logo-full-colour.png`, `logo-full-reversed.png`, `logo-mark.png`, `logo-mark-white.png`, plus `source/` originals |
| `skills/accessory-guide.md` | Recipe for building a printable A4 accessory/consumables guide as a Design Component |
| `SKILL.md` | Agent Skills front matter, for use in Claude Code |

### Components

Core: **Button**, **IconButton**, **Icon**, **Logo**, **StripeRule**, **Card**, **Badge**, **Tag**.
Forms: **Field**, **Input**, **Textarea**, **Select**, **Checkbox**, **RadioGroup**, **Switch**.
Navigation: **Tabs**, **Breadcrumbs**, **Pagination**.
Feedback: **Alert**, **Dialog**, **Toast**, **Tooltip**.

Each has a sibling `.d.ts` (props contract) and `.prompt.md` (what & when, usage example, variants).

#### Intentional additions
The 2014 guidelines are a print brand book — they define no UI inventory, so the component set above is the standard primitive set sized to CHS's needs. Three additions are brand-specific rather than generic:
- **Logo** — wraps the supplied artwork so nobody re-typesets or recolours it.
- **StripeRule** — the guidelines' three-stripe graphic device as a reusable rule/cap.
- **Icon** — a Lucide wrapper. The brand ships no icon set; see ICONOGRAPHY.

### Document page size

New Zealand, not US — **all printable documents in this system (letterhead, guides, reports) use A4**, never Letter. Use the `doc-page` starter with `size="a4"`, or A4 proportions (595×842pt / 210×297mm) for any hand-built page. `ui_kits/stationery/Stationery.jsx`'s `Letterhead` and `skills/accessory-guide.md`'s accessory guide both follow this.

### Document text alignment

Running body copy in any printable document (Word, PDF, letterhead, guide, report, proposal) is **justified** — `text-align:justify` with `text-wrap:pretty` and `hyphens:auto` to avoid rivers and loose lines. Left-align everything that isn't running copy: headings, overlines, captions, table cells, list labels, badges, contact blocks and cover text. On-screen UI (the website kit, components) stays left-aligned throughout — justification is a print convention only.

---

## CONTENT FUNDAMENTALS

**Voice.** Plain, factual, quietly proud. CHS writes like a supplier that answers the phone, not like a technology vendor. The published copy is declarative and unembellished: "Connected Healthcare Systems is a New Zealand owned and operated Company bringing NZ customers the very latest in high quality medical devices, and technology."

**Person.** "We" for the company, "you" / "your ward" for the reader. Never "I". Partnership is stated in the first person plural and with visible pride — "Proud to be partnering with Mindray Medical", "We are pleased to be the New Zealand Distributor for their products."

**Casing.** Sentence case for headings and buttons. The logo is never used inside a sentence; the company is written in title case as **Connected Healthcare Systems**. Product names keep the manufacturer's casing (Mindray A9, Vocera Voice, VS9, D30/D60). Only the small overline label is uppercased, and only in the UI.

**Sentence shape.** Medium-length, one idea each, comfortable with commas. Claims are specific and countable — 36 staff, 0800 424 797, one working day — never vague superlatives. Where a benefit is claimed, the mechanism is given: in-region accountability *because* the engineers are here.

**New Zealand register.** NZ English spelling (organisation, colour, anaesthesia). "Kiwis" is used warmly for patients and the public. Te reo greetings ("Ngā mihi") are appropriate in correspondence; macrons are always correct. Regions use current Health NZ names.

**Clinical care.** Never imply a clinical claim CHS doesn't make. Equipment does not "save lives" in CHS copy; it is supported, serviced and taught. Safety and prerequisite information is stated flatly in an `Alert`, not softened.

**Emoji: never.** Not in product UI, not in marketing, not in email. Status is carried by colour, a `Badge`, or a Lucide icon.

**Examples to write like:**
- Hero: "Improving healthcare outcomes for Kiwis" / "36 NZ-based staff, strategically located across the country."
- Button: "Talk to us", "Request a quote", "Book education" — verb first, two or three words.
- Field hint: "We reply within one working day."
- Empty state: "No programmes match that search." — states the fact, offers no apology.

**Avoid:** "solutions" as a synonym for everything (it is a nav label, not a filler noun), "seamless", "cutting-edge", "revolutionise", exclamation marks, and any sentence that could sit on any distributor's website unchanged.

---

## VISUAL FOUNDATIONS

**The idea.** The mark shows three figures — healthcare staff, patients and Connected® — turning into each other to reach a positive outcome. Everything visual restates that: three colours, three stripes, three-part compositions. The palette is unusually bright for a medical brand, so restraint elsewhere (white space, grey type, flat surfaces) is what keeps it credible.

**Colour.** Three brand primaries of equal status — Connected Purple `#554596`, Connected Green `#80bd01`, Connected Orange `#ef7d00` — each with 60/30/20% tints, plus a black tint ladder for everything structural. In the UI, purple leads (primary actions, links, focus), green signals positive or educational, orange signals warmth and attention. Body copy is 80% black `#575756`, not pure black. Never more than two brand colours in one block. Red `#c8102e` is the only colour added to the 2014 swatch, reserved for genuine alarm and field-notice states.

**Backgrounds.** White first, always. Second choice is the 5% grey `#f4f4f5` for alternating bands. Colour arrives as a full-bleed flat purple/green/orange block, or as a graduated version — the guidelines permit 0–80% black laid over a brand colour, which is where the hero gradients come from. No decorative gradients outside that rule, no bluish-purple tech gradients, no textures, no patterns, no hand-drawn illustration. The one permitted ornament is the **ghost graphic**: the device watermarked at 5% (letterhead), 8% (business card) or 6% white (dark grounds), always cropped off an edge, never centred.

**Typography.** Display face for headlines and titles (Mercedes in print, **Titillium Web** substituted on the web), semibold, tight leading, slightly negative tracking at display sizes. Body face for everything else (Myriad Pro in print, **Source Sans 3** substituted), light 300 for running copy at 1.55 line height, semibold 600 for body titles. Mercedes/display is never used for body copy — that is an explicit guideline. IBM Plex Mono appears only for device readouts, model and part numbers. Overlines are 11.5px uppercase at 0.14em tracking.

**Layout.** 1180px max container, 24px gutters, 80px vertical section rhythm (48px on tighter pages). Content is left-aligned; centred text is used only inside small cards. The header is sticky, 92px tall, with the three-stripe rule pinned under it — that rule is the one fixed decorative element. Footer is 100% black with the ghost device bleeding off the bottom-right.

**Cards.** White, 10px radius, no visible border, two-layer neutral shadow (`0 1px 2px` + `0 4px 12px` at 6–7% black). Colour enters a card only as a 5px top cap — a single brand colour or the three-stripe device. **Never a coloured left border.** Outlined variant swaps the shadow for a 1px `#d1d3d4` hairline; tinted variant fills with 5% grey; inverse fills with black.

**Borders and radii.** 1px hairlines in `#d1d3d4` (structural) or `#e8e9ea` (subtle). Radii: 3px on small controls, 6px on buttons/inputs, 10px on cards, pill on badges and tags. Nothing is fully square except full-bleed colour blocks and the stripe device.

**Shadows.** Four steps only: hairline ring, card, card-hover, overlay (`0 16px 48px` at 20%). All neutral black, never tinted purple. One inner shadow exists — the pressed state of a primary button.

**Interaction.** Hover on a filled button darkens the fill about 12%; on a secondary or ghost button it fills with the matching 20% tint; on a card it lifts 2px and steps the shadow up. Press adds an inset shadow rather than a scale — nothing shrinks or bounces. Focus is a 3px purple halo at 32% opacity, never removed. Links change colour and underline on hover.

**Motion.** 150ms for control states, 220ms for surfaces (card lift, switch travel, toast entry), 400ms for page-level fades, all on `cubic-bezier(.2,.6,.2,1)`. Fades and short translations only. No bounce, no spring, no parallax, no scroll-triggered reveal on clinical content.

**Transparency and blur.** Used in exactly two places: the dialog scrim (50% black, 2px blur) and white text on colour at 82–86% opacity for supporting copy. Nothing else is translucent — no frosted panels, no glass cards. Text over a photograph would need a protection gradient, but the guidelines forbid the logo over imagery, and no photography was supplied, so no protection-gradient pattern is defined here.

**Imagery.** None was supplied. When real photography arrives it should be clinical documentary — real NZ wards, natural cool-neutral light, no heavy grade, no grain, people at work rather than posed. Until then, image areas show an explicit "not supplied" empty state rather than stock stand-ins.

---

## ICONOGRAPHY

The brand ships **no icon set** — the 2014 guidelines contain only the logo, the device and the three stripes, and the website uses Wix's stock social glyphs. There is no icon font, sprite sheet or SVG library to copy.

**Substitution (flagged):** this system uses **Lucide 0.451.0** from CDN (`https://unpkg.com/lucide@0.451.0/dist/umd/lucide.js`), wrapped by the `Icon` component. Lucide was chosen for its even 2px stroke and rounded terminals, which sit closest to the rounded geometry of the logo wordmark. If CHS has a licensed icon set, replace `Icon`'s renderer and drop the CDN script.

Rules:
- Stroke weight 2 at 16–32px; 1.5 only above 32px. Never mix stroke weights in one view.
- Icons are monochrome and inherit `currentColor`; they take a brand colour only when they are the single focal element of a card.
- Icons never appear inside body copy, only in controls, list markers and card headers.
- Icon-only controls must carry a label via `IconButton label=`, and normally a `Tooltip`.
- **No emoji, ever.** No unicode dingbats as icons either — the three exceptions already in the components are typographic, not decorative: the select chevron `▾`, the checkbox tick `✓` and the dialog close `×`.
- The device (`assets/logo-mark.png`) doubles as app icon, favicon and avatar. It is never used as a bullet or inline glyph.

---

## Flagged substitutions — please send replacements

1. **Mercedes** (logo/headline face) → substituted with **Titillium Web**. Not a perfect match; if CHS holds a web licence for Mercedes, send WOFF2 files and `tokens/fonts.css` can be swapped to real `@font-face` rules.
2. **Myriad Pro** (body face) → substituted with **Source Sans 3**, which shares Adobe's humanist skeleton and is very close. Same swap applies.
3. **Icons** → Lucide, as described above.
4. **Partner logos** (Mindray, Vocera) → not included; third-party marks. Set in type with a visible placeholder note in the website kit.
5. **Photography** → none supplied. Image areas are explicit empty states.
