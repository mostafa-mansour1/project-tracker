# Project Tracker

A dev-server-only [Astro](https://astro.build) dashboard that automatically discovers the projects in your workspace and renders their Markdown task boards as a single, browsable site. No database, no per-project setup, no production build — drop a `TASKS.md` into a project folder and it shows up.

---

## How it works

The tracker scans the **workspace root** (its own parent folder by default) and builds the site from whatever it finds on disk at request time:

1. Every folder beside `project-tracker/` is treated as a **scope**.
2. Every immediate child of a scope that contains a `TASKS.md` is treated as a **project**.
3. Each project's `TASKS.md` is parsed into live phases, tasks, acceptance criteria, and status counts.
4. Files named like `TASKS.full-archive-*.md` under `docs/` or `tasks/` are parsed directly and shown with live tasks on the Roadmap.
5. Archived tasks are deduplicated by task ID across snapshot archives, keeping the copy with the richest available details.
6. A dedicated `SESSIONS.md` is shown newest-first on the History page. Projects that still keep a `## Session Log` inside `TASKS.md` remain supported.
7. Project Markdown is exposed in the document viewer, except `TASKS.index.md`, which is intentionally not used or shown by the tracker.

Discovery happens on every page load, so adding or editing a project is instant — just refresh the browser. There is no registration step and the tracker is never copied into a project.

All of this logic lives in [`src/lib/content.ts`](src/lib/content.ts); the pages in [`src/pages/`](src/pages) render it.

---

## Workspace layout

The tracker expects projects to live two levels deep — `<scope>/<project>` — beside the tracker itself:

```text
workspace/
  project-tracker/        # this tool
  work/                   # a scope
    app-one/
      TASKS.md            # required — makes app-one a tracked project
      README.md           # optional — its "# Heading" becomes the display name
      SESSIONS.md         # optional — dedicated session log shown in History
      docs/               # optional — extra Markdown, shown under "Product docs"
        TASKS.full-archive-2026-06-01.md  # optional — archived tasks shown on Roadmap
      tasks/              # optional — archive files and task-history Markdown
    app-two/
      TASKS.md
  personal/               # another scope
    app-three/
      TASKS.md
```

- A folder only becomes a project if it contains `TASKS.md`.
- A project's display name comes from the first `# Heading` in its `README.md`, falling back to the folder name.
- Projects are grouped by scope in the selector and sorted by scope, then name.
- Archive files are discovered by filenames containing `TASKS` and `archive`; no task index is required.
- `TASKS.index.md` may still exist for agent workflows, but the tracker does not read or display it.

If your scope folders are **not** siblings of the tracker, point it elsewhere:

```sh
WORKSPACE_ROOT=/path/to/workspace npm run dev
```

---

## `TASKS.md` format

The parser is strict about headings so boards stay consistent. Use `###` for phases and `####` for tasks:

```md
### Phase 1 — Foundation
> Goal: stand up the core models and storage

#### TASK-1 — [~] Build the attempt model
**What:** Short description of the task.

**Acceptance criteria:**
- [ ] Pending criterion
- [~] In-progress criterion
- [x] Completed criterion
- [-] Blocked criterion
```

Rules that matter:

- **Phase:** `### <name>`, with an optional `> Goal: <text>` line directly under it.
- **Task:** `#### <ID> — [<status>] <title>` where `<ID>` matches `[A-Z]+-\d+` (e.g. `TASK-1`, `DEPLOY-12`).
- **Description:** an optional `**What:** <text>` line.
- **Criteria:** `- [<status>] <text>` checklist items belonging to the task above.

### Status markers

| Marker | Status        | Shown as      |
| :----: | ------------- | ------------- |
| `[ ]`  | pending       | Pending       |
| `[~]`  | active        | In progress   |
| `[x]`  | done          | Done          |
| `[-]`  | blocked       | Blocked       |

In-progress tasks are highlighted and auto-expanded in the board. If a status never appears, it simply means no task currently carries that marker — not a bug.

---

## Archive and session files

The Roadmap is the complete task view. It combines:

- Live work from the project's root `TASKS.md`.
- Completed work parsed directly from `docs/TASKS*archive*.md` and `tasks/TASKS*archive*.md`.

Archive files can use task tables, detailed task headings, or both. The tracker extracts task IDs, titles, `**What:**` descriptions, and checklist or bullet details where available. When several snapshot archives contain the same task ID, only one task card is shown.

The History page is reserved for session entries. The preferred source is `SESSIONS.md`, with `docs/SESSIONS.md` and `tasks/SESSIONS.md` also supported. If none exists, the tracker falls back to a `## Session Log` section in `TASKS.md`.

Plan completion uses live and archived task counts and displays one decimal place, so an incomplete plan cannot round from `99.6%` to `100%`.

---

## Project structure

```text
project-tracker/
  src/
    layouts/
      BaseLayout.astro        # shared page shell
    lib/
      content.ts              # discovery + live/archive/session Markdown parsing
    pages/
      index.astro             # combined live + archived task board
      history.astro           # newest-first session history
      document.astro          # single Markdown document viewer
      documents/
        index.astro           # per-project document index
  astro.config.mjs            # dev server config (host: true)
  package.json                # only a "dev" script — no build by design
  CLAUDE.md / AGENTS.md       # standing instructions for AI agents
```

---

## Running

```sh
npm install --ignore-scripts
npm run dev
```

Then open the printed local URL (default `http://localhost:4321`).

This is intentionally a **dev-server-only** tool:

- Keep the dev server running and reuse it across your work; don't stop it after verifying a change.
- There is no `build` script and no deployment adapter — `astro build` is deliberately not supported.
- Verify changes through source review and the running dev server.

---

## Adding a project

1. Create `<scope>/<project>/` in the workspace (create the scope folder first if it's new).
2. Add a `TASKS.md` using the format above.
3. Optionally add a `README.md` (for the display name) and `docs/` or `tasks/` Markdown.
4. Refresh the browser — the project appears automatically.
