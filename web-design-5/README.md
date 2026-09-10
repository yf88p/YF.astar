# Five Creative Perspectives

Five independent creative-agency concepts built with Next.js 16 App Router, React 19, TypeScript, and scoped CSS Modules.

| Route           | Studio           | Art Direction                                                  |
| --------------- | ---------------- | -------------------------------------------------------------- |
| `/`             | Collection index | Simple navigation to the five concepts                         |
| `/design-one`   | FORMA            | Swiss-modern, vermilion, architectural brand mockups           |
| `/design-two`   | STILL            | Quiet editorial, warm ivory, expressive serif typography       |
| `/design-three` | OFFSCRIPT        | Acid-yellow brutalism, kinetic typography, cultural identities |
| `/design-four`  | PLAYDATE         | Cobalt and butter, cut-paper collage, playful packaging        |
| `/design-five`  | MONOGRAM         | Cinematic photography, espresso, champagne serif typography    |

## Development

```bash
npm install
npm run dev
```

## Production

```bash
npm run lint
npm run build
npm run start
```

## Implementation

Each concept has its own server-rendered page, metadata, and CSS Module. The only shared interactive UI is in `src/components/agency-interactions.tsx`: native project-detail dialogs and a validated project-inquiry composer. Dialogs support keyboard dismissal, focus restoration, backdrop dismissal, and scroll locking. OFFSCRIPT's category filtering and the service disclosures work without JavaScript.

Inquiry forms prepare an email draft rather than claiming to send a message. Nothing is transmitted until the visitor chooses to send the email in their own mail app. Studio addresses are illustrative and should be replaced before a real launch.

Google Fonts are self-hosted at build time through `next/font`. Photography is served from Unsplash; an internet connection is required for the initial font build and external images. Original typographic artwork and packaging mockups are built with CSS and SVG. All motion respects `prefers-reduced-motion`.
