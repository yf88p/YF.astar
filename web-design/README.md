# Three Directions

A mini design gallery built with Next.js 16 App Router, React, TypeScript, and CSS Modules. All illustrations are original inline SVG or CSS; no external assets, font downloads, or additional runtime dependencies are required.

## Routes

- `/`: A simple index linking to the three designs.
- `/design-one`: **Forma**, an editorial furniture collection in warm neutrals and terracotta. Includes collection filters, product previews, upholstery choices, session-only saved pieces, journal stories, and a demo newsletter form.
- `/design-two`: **Offscript**, an independent creative studio in acid yellow and ink. Includes animated sculptural artwork, project filters and previews, service accordions, and a demo contact form.
- `/design-three`: **Slow Days**, an illustrated Mediterranean retreat in cobalt and butter yellow. Includes accommodation filters, experience accordions, and a booking-inquiry demo with date validation, guest limits, and estimated totals.

The shared floating gallery navigation connects all three destinations. Each design has its own layout, typography, motion, and responsive styles. Motion respects `prefers-reduced-motion`; dialogs use native focus management and support Escape.

## Development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run lint
npm run build
npm run start
```

Each route lives in its own directory under `src/app/`. Shared gallery navigation lives in `src/components/`; global styles are limited to the reset, focus defaults, and reduced-motion behavior.

## Demo Boundaries

These are fictional design concepts. Forms do not transmit or persist information, newsletter submissions do not subscribe anyone, and booking inquiries do not check live availability or make reservations. Saved furniture pieces and form state last only for the current mounted page session. No backend, payment flow, tracking, or external service is connected.
