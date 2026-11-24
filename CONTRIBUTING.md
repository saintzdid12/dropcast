# Contributing

Use Node.js 22+. Run `npm test` and `npm run check` before opening a pull request. For browser changes, also run `node scripts/browser-smoke.mjs` with Chrome/Edge installed, and inspect the desk at phone and desktop widths.

Keep the app dependency-free unless a new dependency solves a clear problem. Scoring logic and validation live in `public/model.js`, persistence and SSE in `server.mjs`, and the operator/overlay rendering in `public/app.js`.

Report bugs with reproduction steps, Node version, OS, browser/OBS version, and a sanitized show export. Remove personal data and private logo URLs. Do not include `.dropcast/` state or credentials. Propose large changes in an issue before implementation. Contributions are MIT licensed.
