# Aki Swiss

A Swiss Grid Minimalist design system for Aki's personal site (`akiaki1996.github.io`), organizing resume history, engineering notes, and personal life archives on a strict typographic grid.

## Content fundamentals

- **Voice**: Concise, factual, first-person engineering prose in Chinese with original English technical terms preserved (`TypeScript`, `Docker`, `PD`). No filler, no exclamation-heavy marketing copy, and no emoji as UI icons.
- **Structure**: Index every section with a two-digit monospace number (`01 / RESUME`, `02 / DEV NOTES`, `03 / LIFE`). Use `[待填写]` placeholders explicitly where personal data is not yet supplied.

## Visual foundations

- **Color & Themes**: Set page backgrounds in `ground`, cards and cells in `surface`, and primary text in `ink` (`ink-secondary` for summaries, `ink-muted` for metadata). Reserve `accent` (Swiss forest green) strictly for primary actions, active navigation markers, and key links; use `on-accent` for text over `accent`. Both `light` (Paper Light) and `dark` (Carbon Dark) themes maintain >= 4.5:1 text contrast.
- **Borders over shadows**: Separate regions with `1px solid var(--line)` and anchor top-level sections with `2px solid var(--line-strong)`. Interactive controls use `line-control` (`>= 3:1`). Never apply drop shadows (`shadow-none`).
- **Typography**: Set display, headings, and body copy in `var(--font-sans)` (`Inter` + `Noto Sans SC`). Set dates, grid indices, tags, and optometry specs in `var(--font-mono)` (`JetBrains Mono`) with tabular figures.
- **Geometry**: Keep containers architectural and sharp (`radius-none` `0px`), using `radius-xs` (`2px`) only on `Button` and `Tag`.

## Iconography

- Use `assets/Marks/aki-monogram.svg` (`24px`–`48px`) as the geometric site mark.
- For UI arrows, external link indicators, and toggles, use crisp `1.5px` inline stroke SVGs (`currentColor`). Never use emoji.

## Components

Components live in `components/bundle.js` under `window.AkiSwiss` (`Button`, `Tag`, `SpecRow`) and expect React 18 plus `tokens.css` and `components/bundle.css`. Use `AkiSwiss.Button` for actions, `AkiSwiss.Tag` for category/stack badges, and `AkiSwiss.SpecRow` for tabular key-value entries.
