---
name: Grounded Journal
description: A private place-grounded journaling instrument in an e-ink reader's world.
colors:
  primary: "#233fa8"
  reading-room-paper: "#f4f4f1"
  sheet-white: "#fbfbfa"
  ink-black: "#1b1b19"
  ink-secondary: "#61615c"
  hairline: "#dcdcd6"
  hairline-strong: "#c4c4bd"
  reflection-wash: "#ececea"
  session-wash: "#e7ecf8"
  sealing-wax: "#7e2a1e"
  leaf-ok: "#2a6b2a"
  selection-wash: "#c9d4f5"
typography:
  display:
    fontFamily: "Georgia, Charter, 'Times New Roman', serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "Georgia, Charter, 'Times New Roman', serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.6
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  none: "0"
  sm: "3px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "20px"
  lg: "36px"
components:
  button-primary:
    backgroundColor: "{colors.ink-black}"
    textColor: "{colors.reading-room-paper}"
    rounded: "{rounded.sm}"
    padding: "0.55rem 1.1rem"
  button-primary-hover:
    backgroundColor: "#000000"
    textColor: "{colors.reading-room-paper}"
    rounded: "{rounded.sm}"
    padding: "0.55rem 1.1rem"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-black}"
    rounded: "{rounded.sm}"
    padding: "0.375rem 0.8rem"
  input-field:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.ink-black}"
    rounded: "{rounded.sm}"
    padding: "0.625rem 0.7rem"
  seg-active:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.none}"
    padding: "0.4rem 0.75rem"
  reflection-model:
    backgroundColor: "{colors.reflection-wash}"
    textColor: "{colors.ink-black}"
    rounded: "{rounded.sm}"
    padding: "0.7rem 0.8rem"
  reflection-user:
    backgroundColor: "{colors.session-wash}"
    textColor: "{colors.ink-black}"
    rounded: "{rounded.sm}"
    padding: "0.7rem 0.8rem"
---

# Design System: Grounded Journal

## Overview

**Creative North Star: "The Reading Instrument"**

Grounded Journal is a quiet precision instrument for private thought, dressed in the e-ink reader's world: neutral paper, ink-black prose, hairline rules, and a single ink-blue accent held by law. Nothing performs and nothing decorates; the interface recedes until only the entry, its grounding, and its reflection remain. Density is editorial rather than dashboard-like: one focused column, generous air above each heading, tight groups within.

The system refuses the category's two defaults — the card-grid SaaS dashboard and the marketing hero — because the visitor came to operate a private ritual, not to browse or to be persuaded. What makes it unmistakable is restraint with one exception: the entry field carries the largest type on the page, so the visitor's own words, not the chrome, own the first viewport.

**Key Characteristics:**
- Ruled segments, never cards; separation by hairline, never shadow.
- Type as matter: the entry's words are the visual anchor of the page.
- One accent, held by law, reserved for grounded and reflection states.
- Tabular metadata; tabular numerals everywhere counts appear.

## Colors

Quiet neutrals carry the surface; a single saturated blue carries state.

### Primary
- **Ink-Blue Ledger** (#233fa8): grounded places, the selected filter and view, links, focus rings, the pin glyph. Appears only where groundedness, selection, or reflection-state is being communicated.

### Neutral
- **Reading-Room Paper** (#f4f4f1): page ground. Neutral, not cream.
- **Sheet White** (#fbfbfa): input grounds and the map-note panel.
- **Ink Black** (#1b1b19): prose, primary buttons, the masthead rule.
- **Ink Secondary** (#61615c): labels, hints, metadata, placeholders. Holds 5.8:1 on paper.
- **Hairline** (#dcdcd6): row and list separators.
- **Hairline Strong** (#c4c4bd): input borders, section rules, the selected-history outline partner.
- **Reflection Wash** (#ececea): model turns.
- **Session Wash** (#e7ecf8): user turns and the selected history entry; tinted from the accent hue, never gray.
- **Sealing-Wax Oxblood** (#7e2a1e): freeze refusals and error states.
- **Leaf Ok** (#2a6b2a): success confirmations.
- **Selection Wash** (#c9d4f5): text selection.

### Named Rules
**The Accent Law.** The blue marks groundedness, selection, and reflection-state, and nothing else. A decorative blue is a violation however small.
**The Paper Rule.** Grounds stay neutral gray-white; warm cream is never the ground.

## Typography

**Display Font:** Georgia, Charter, Times New Roman (with serif fallback)
**Body Font:** system-ui, -apple-system, Segoe UI, Roboto (with sans-serif fallback)
**Label/Mono Font:** system sans for labels; tabular numerals (`font-variant-numeric: tabular-nums`) for counts, metadata, and timestamps. No decorative mono.

**Character:** A workhorse sans runs the instrument; a reading serif speaks the journal. The pairing reads as paper that happens to be software.

### Hierarchy
- **Display** (700, 1.75rem, 1.2): the masthead name only.
- **Headline** (400, 1.25rem/1.6 serif): the entry field; the largest type on the page.
- **Title** (650, 1.05rem, 1.4): segment headings (Write, Ground, Reflect, History).
- **Body** (400, 1rem/1.55): controls, rows, hints. Prose measure 65–75ch via the 46rem column.
- **Label** (600, 0.8125rem): field labels, metadata, audit lines.

### Named Rules
**The Type-as-Matter Rule.** The entry field is always the largest type in view; chrome never outscales content.
**The One-Family Control Rule.** Labels, buttons, and data never take the serif; the serif never takes a control.

## Layout

One focused column (46rem max, 2rem/1.25rem page padding) divided into ruled segments with 36px of air above each segment and 12px below its heading. History metadata and counts run tabular. Responsive behavior is structural: below 32.5rem the page padding tightens and the entry type steps to 1.125rem; columns never multiply because there is only one. Toolbar rows wrap; the follow-up input flexes to fill.

## Elevation & Depth

No shadows anywhere. Depth is conveyed by tonal layering alone: paper ground, sheet-white inputs, wash-grounded turns. Borders are hairlines, never elevations.

## Shapes

Functional 3px radius on buttons, inputs, turns, and panels; square (0) suggestion rows and segmented-control joins. Rules are 1px hairlines except the masthead's 2px ink rule and the dashed map-note frame. The pin glyph is a 12px outline marker in a 1.5px stroke, always in the accent.

## Components

### Buttons
- **Shape:** barely rounded (3px).
- **Primary:** ink-black ground, paper text, 0.55rem 1.1rem padding.
- **Hover / Focus:** near-black ground on hover; 2px accent outline offset 2px on focus-visible; 1px downward press on active; 180ms ease-out.
- **Secondary / Ghost:** the quiet variant — transparent ground, ink text, strong-hairline border, smaller padding; washes on hover.
- **Disabled:** 45% opacity, no press; exempt from contrast minima because it must read as unavailable.

### Segmented control
- **Style:** hairline-bordered pill group on sheet white; dividers between options.
- **State:** the pressed option floods ink-blue with white text; the Map option explains itself via title and note rather than color.

### Inputs / Fields
- **Style:** sheet-white ground, strong-hairline stroke, 3px radius.
- **Focus:** 2px accent outline, offset 2px; hover darkens the stroke.
- **Error / Disabled:** errors speak through the status line in sealing-wax, never through red inputs.

### Grounding ledger
- **Style:** ruled rows under a top hairline; place name in semibold with accent pin; attribution and cached details in secondary tabular meta.
- **State:** Details expands the cache-only payload inline; Remove is a quiet button with a named aria-label.

### Session thread
- **Style:** model turns on reflection wash, user turns on session wash, both in reading serif; audit lines in small sans name the places a model turn saw.
- **State:** busy buttons rename (Reflecting…, Sending…); the follow-up row flexes.

### History
- **Style:** ruled entries with serif entry text, state line (accent grounded glyph or plain Ungrounded), tabular timestamp and turn counts, two-turn previews, and a Continue-session link.
- **State:** the open entry floods session wash with an accent outline; filters are pressed-state segments; loading shows static skeleton rules; empty states teach (first-entry cue, filter-reset cue).

### Status line
- **Style:** a single polite live region under the masthead; secondary ink at rest, leaf confirmations, sealing-wax errors, muted busy narration.

## Do's and Don'ts

### Do:
- **Do** keep the entry field the largest type in every viewport.
- **Do** reserve the blue for groundedness, selection, and reflection-state (The Accent Law).
- **Do** write errors that name the problem and the recovery, as the blocked-sign-in message does.
- **Do** render counts, timestamps, and metadata with tabular numerals.
- **Do** theme browser surfaces (selection, caret, focus ring, scrollbars, link offset) from the palette.

### Don't:
- **Don't** reach for cards, shadows, heroes, kickers, section numbers, or gradient text; the floor bans them and this world has no use for them.
- **Don't** put the serif on a control or a control face on the prose.
- **Don't** warm the paper toward cream or cool the ink toward slate; the ground is neutral by law.
- **Don't** add a second accent for emphasis; emphasis comes from weight or scale.
- **Don't** fetch for display: history and details read from cache only, and the UI must never imply a live lookup.
