# Project Tracker — Standing Instructions

The project tracker is a persistent, dev-server-only Astro workspace tool.

## Runtime

- Run with `npm run dev`.
- Reuse the existing dev server when it is already running.
- Keep the dev server running across project work and after verification.
- Do not run or require a production build.
- Do not add a deployment adapter only to make `astro build` pass.

## Verification

- Prefer source review and focused checks first.
- Verify runtime behavior against the running dev server when needed.
- A production build is never an acceptance criterion for this project.

## Scope

- Keep changes focused on tracker behavior.
- The tracker reads scoped projects at `<workspace>/<scope>/<project>/TASKS.md`.
- Do not modify tracked projects while working on the tracker.
