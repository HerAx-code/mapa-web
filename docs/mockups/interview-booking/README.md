# Interview Booking — mockups

Static UI mockups for the appointment / interview-booking feature
(see [`../../appointment-system-plan.md`](../../appointment-system-plan.md)).
Pixel-matched to the app's design system (`src/index.css` tokens — brand teal
`#0F6E56`, Inter, `card-hero`, `filter-pill`, `stat-tile`, 44px controls).

## Live, editable canvas

A pan/zoom design canvas (click-to-edit, PNG/PDF export) is published to the
owner's Claude gallery:

- **https://claude.ai/code/artifact/5907d1d0-9b66-4535-b571-7bda4cec97f4**

That link is the durable, editable copy. In the Claude Code terminal, `/artifacts`
also lists it (o = open, c = copy link).

## The artboards (source here)

| File | Surface | Notes |
|---|---|---|
| `Main.dc.html` | Patient · **Book** | mobile 390×844, bilingual — day rail + slot grid + confirm bar |
| `PatientBooked.dc.html` | Patient · **Booked** | reuses the app's `card-hero`; pro-social reminder note |
| `PatientEmpty.dc.html` | Patient · **No slots yet** | the gated empty state |
| `AdminAvailability.dc.html` | CRMC · **Availability manager** | desktop 1280×860, English-only — publisher + week grid |
| `InterviewGate.dc.html` | CRMC · **Per-request gate** | the "Let patient self-book" toggle |
| `canvas.json` | — | canvas layout (positions, notes, launch view) |

These are **static** mockups (no real data; sample copy/initials are placeholders).

## Re-editing the canvas from these sources

The sources are `.dc.html` Design Component files. To regenerate the publishable
canvas and update the live artifact, run the `design` skill (`/design`) in Claude
Code, edit the files here, then re-seed and republish to the same URL. The ~2.5 MB
generated `mapa-interview-booking.html` is intentionally **not** committed — it is
rebuilt from these sources.
