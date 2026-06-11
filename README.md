# Reusable Project Tracker

Dev-only Astro dashboard that automatically discovers scoped repositories using a Markdown task board.

## Expected target structure

```text
your-project/
  README.md
  TASKS.md
  docs/        # optional
  tasks/       # optional archive
```

Task headings use this format:

```md
### Phase 1 — Name
> Goal: phase goal

#### TASK-1 — [~] Task title
**What:** Short description.

**Acceptance criteria:**
- [ ] Pending criterion
- [x] Completed criterion
```

Statuses are `[ ]` pending, `[~]` active, `[x]` done, and `[-]` blocked.

## Workspace layout

```text
workspace/
  project-tracker/
  work/
    app-one/
      TASKS.md
    app-two/
      TASKS.md
  personal/
    app-three/
      TASKS.md
```

Each folder beside `project-tracker/` is treated as a project scope. Any immediate child of a scope containing `TASKS.md` appears automatically in the website's project selector.

To add a project, create or copy its folder inside a scope, ensure it has `TASKS.md`, then refresh the browser. No project registration or tracker copy is required.

## Run

```sh
npm install --ignore-scripts
npm run dev
```

This is a dev-server-only workspace tool:

- Keep the dev server running and reuse it across project work.
- Do not stop it after verification.
- Do not run or require `astro build` or a production deployment adapter.
- Verify changes through source checks and the running dev server.

Set `WORKSPACE_ROOT=/another/folder` when the scope folders are not siblings of the tracker.
