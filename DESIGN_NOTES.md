# Design notes: finance outreach dashboard

The source of truth is the CSI-KJSCE **recruitment-admin-panel** frontend
(`frontend/app/globals.css` + `frontend/components/chrome.jsx`). It was extracted
into `~/design-tokens.md`, which has file:line citations for every value.

**Figma: nothing was fetched.** The frame link supplied for this pass
(`https://github.com/glips/figma-context-mcp`) is a GitHub repo, not a Figma
frame. No Figma read calls were spent (0 of the 2 budgeted). If a real frame
turns up later, add what it shows here, so it only has to be fetched once.

## Tokens (copy verbatim; don't invent new ones without noting them here)

```css
--bg:#0d0f13; --surface:#13161c; --surface-2:#191d25; --surface-3:#222731;
--line:#242932; --line-2:#333a46;
--ink:#e8eaee; --ink-2:#98a0b0; --ink-3:#656d7c;
--accent:#6d8dff; --accent-ink:#0b0d11; --accent-soft:rgba(109,141,255,.14); --accent-line:rgba(109,141,255,.45);
--good:#63b892; --warn:#d3a25c; --bad:#d4796f;
--alarm:#3a1d1b; --alarm-line:#d67c72; --alarm-ink:#f0d7d4;
--score:#4fb3c9; --score-soft:rgba(79,179,201,.10); --score-line:rgba(79,179,201,.55);
--radius:10px; --radius-lg:14px; --radius-pill:999px;
--measure:68ch;
--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
```

This app adds two tokens:

| Token | Value | Why |
|---|---|---|
| `--later` | `#b494ff` | The "Keep for later" status needed a hue the panel palette doesn't have. It was a hard-coded literal before this pass. |
| `--tap` | `44px` | Minimum touch target on coarse pointers (WCAG 2.5.5 / Apple HIG). |

## Type scale

| Role | Size / weight / colour |
|---|---|
| Body | 15px/1.6 `--sans`, `--ink` |
| h1 | 24px, line-height 1.25, -.018em, UA bold (20px under 720px) |
| h2 | 15px, 600, -.005em |
| Lede | 14px `--ink-2`, max `--measure` |
| Eyebrow / field caption / table head | 11px uppercase, .05em, `--ink-3`, 500 |
| Helper / hint (informative) | 12–12.5px, **`--ink-2`** (see Contrast) |
| Empty state | 13px `--ink-2` |
| Weights in use | 400 / 450 / 500 / 550 / 600 / 650 only. There's no 700+ except the UA h1. |

## Spacing and layout
- Page: `max-width` 1240px (panel: 1080/1320), padding `30px 20px 90px`; `22px 16px 70px` under 720px.
- App bar: sticky, 56px, `rgba(13,15,19,.88)` + `blur(10px)`, bottom `--line`.
- Panel: `--surface`, 1px `--line`, `--radius-lg`, `.pad` = `18px 20px`.
- Breakpoints: **1060px** (the two-column work area stacks) and **720px** (phone: the table becomes cards, the bar is compact).

## Component recipes
- **.btn**: `--surface-2`, 1px `--line-2`, `--radius`, `10px 15px`, 13.5px. Hover: border `--accent-line`. `.primary` is `--accent`/`--accent-ink`/600; `.ghost` is transparent; `.sm` is `6px 11px` 12.5px.
- **Pill filter** (panel `.qf`): `--surface-2`, 1px `--line`, `--radius-pill`, 12.5px `--ink-2`. The on state is `--accent-soft` + `--accent-line`. The status filters use the status tone instead of accent.
- **Chip** (status): pill, 12px/550, text `--tone`, border `--tone` at 45%, fill at 12%. It has a 6px round dot. `.solid` fills with the tone.
- **Banner**: `--radius-lg`, `14px 16px`. `.error` is `--bad` at 10% + 1px `--bad`. Duplicate warnings use the same shape in `--warn`.
- **Inputs**: `--surface-2`, 1px `--line-2`, `--radius` (8–10px), `9px 11px`, 14px, placeholder `--ink-3`.
- **Focus**: global `:focus-visible { outline:2px solid var(--accent); outline-offset:2px }`. Never remove it.
- **Motion**: none except state changes. Everything goes under the global `prefers-reduced-motion` guard.

## Status colours

| Status | Tone |
|---|---|
| Not contacted | `--ink-3` |
| Didn't pick up | `--warn` |
| Messaged | `--accent` |
| Follow-up | `--score` |
| Interested | `--good` |
| Keep for later | `--later` |
| Confirmed | `--good`, solid |
| Rejected | `--bad` |
| Invalid number | `--ink-2` |

## Contrast (computed, WCAG relative luminance)

| Pair | Ratio | Use |
|---|---|---|
| `--ink` on `--surface` | ≈ 15:1 | body |
| `--ink-2` on `--surface` | ≈ 6.9:1 | helpers, hints, meta: **passes AA** |
| `--ink-3` on `--surface` | ≈ 3.5:1 | **fails AA for small text**. Used only for placeholders, decoration and the panel's 11px uppercase captions. Keeping it on captions matches the panel but is an open decision (tune the token, or move captions to `--ink-2`). |

## Deliberate deviations from the panel
- **Particle canvas background** (kept by decision, 28 Sep 2026). The panel's background is flat `--bg`. The canvas is masked behind the content column and stops under `prefers-reduced-motion`.
