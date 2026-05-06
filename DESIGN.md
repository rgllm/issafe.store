# IsSafe.store Design System

IsSafe.store uses a crisp, utility-first interface for checking online store risk before checkout. The design is intentionally quiet: white canvas, compact navigation, a centered lookup flow, and evidence cards that read like a trustworthy operational tool rather than a marketing page.

## Brand

- **Logo:** `public/logo.svg`, a green gradient padlock with a white checkmark.
- **Primary brand color:** logo green `#289e62` in light mode; the brighter logo green `#4fd78e` is used in dark mode for contrast.
- **Wordmark treatment:** `is` uses foreground black, `safe` uses primary green, and `.store` uses muted gray with a light weight.
- **Logo usage:** show the SVG mark alongside the wordmark in header and footer, and as the primary hero brand signal.
- **Favicon/PWA icons:** `logo.svg` is canonical; `logo192.png` and `logo512.png` are generated from it for manifest/apple usage.

## Layout

- **Header:** 48px tall top bar with bottom border, max-width `72rem`, horizontal padding `24px`, brand left and lightweight nav right.
- **Hero:** centered single-column lookup experience with the logo mark, wordmark, H1, supporting copy, and URL form.
- **Main sections:** full-width bands separated by thin borders, with constrained inner content.
- **Footer:** compact three-part row on desktop, stacked on mobile: brand, disclaimer, and maker credit.
- **Cards:** use small `6px` radii, one-pixel borders, white/card backgrounds, and no decorative shadows.

## Color Tokens

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--background` | `oklch(1 0 0)` | `oklch(0.11 0.015 245)` | Page background |
| `--foreground` | `oklch(0.18 0.015 255)` | `oklch(0.94 0.006 240)` | Primary text |
| `--primary` | `#289e62` | `#4fd78e` | Logo green, buttons, links, focus states |
| `--primary-foreground` | `#ffffff` | dark ink | Text on primary actions |
| `--muted` | cool light gray | dark blue-gray | Subtle panels and fills |
| `--muted-foreground` | cool mid gray | cool muted gray | Secondary text |
| `--border` | cool light border | dark border | Separators, inputs, cards |
| `--signal-safe` | logo green | bright logo green | Safe report signals |
| `--signal-caution` | amber | amber | Caution report signals |
| `--signal-risk` | red/orange | red/orange | Risk/error report signals |

## Typography

- **Font:** Inter from Google Fonts, with system fallback.
- **Hero wordmark:** 48px, extra-bold, tight tracking.
- **H1:** 30px, bold, balanced line wrapping.
- **Body copy:** 16px, 1.75 line height for explanatory text.
- **UI labels/buttons:** 14px, medium to semibold.
- **Footer text:** 12px, muted.

## Components

- **Primary button:** green rectangular button, `6px` radius, semibold 14px text, hover via `bg-primary/90`, disabled opacity at 50%.
- **URL input:** white/card field, one-pixel border, `6px` radius, focus border and ring use primary green.
- **Signal cards:** two-column grid from small desktop up, icon tile in `bg-primary/8`, title and compact supporting text.
- **Report UI:** preserves neutral card shell with colored verdict badges from the signal tokens.
- **Error state:** bordered warm risk background with alert icon and risk text.

## SEO & Metadata

- The root document owns canonical metadata, Open Graph, Twitter summary tags, theme color, manifest link, and SVG favicon link.
- Default title: `IsSafe.store | Check store risk before you buy`.
- Default description emphasizes public-signal store risk checks, confidence, recommendation, and cited evidence.

## Accessibility

- Logo images are decorative inside linked brand labels; the header link uses an explicit `aria-label`.
- Forms retain visible placeholders and screen-reader labels.
- Focus states use the primary green ring.
- External maker link uses `target="_blank"` with `rel="noreferrer"`.
