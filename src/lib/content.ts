import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

export type TaskStatus = 'pending' | 'active' | 'done' | 'blocked';

export interface Criterion {
  text: string;
  status: TaskStatus;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  criteria: Criterion[];
  phase: string;
}

export interface Phase {
  name: string;
  goal: string;
  tasks: Task[];
}

export interface SessionLogEntry {
  title: string;
  body: string;
}

export interface ArchivedTask {
  id: string;
  title: string;
  archive: string;
  description: string;
  criteria: Criterion[];
}

export interface ArchiveGroup {
  archive: string;
  tasks: ArchivedTask[];
}

export interface DocumentEntry {
  slug: string;
  title: string;
  group: string;
  path: string;
  source: string;
}

export interface ProjectEntry {
  key: string;
  name: string;
  scope: string;
  root: string;
}

const trackerRoot = fileURLToPath(new URL('../../', import.meta.url));
const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT ?? path.dirname(trackerRoot));
const statusMap: Record<string, TaskStatus> = {
  ' ': 'pending',
  '~': 'active',
  x: 'done',
  '-': 'blocked',
};

export function getProjects(): ProjectEntry[] {
  return fs
    .readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== path.basename(trackerRoot))
    .flatMap((scope) => {
      const scopeRoot = path.join(workspaceRoot, scope.name);
      return fs
        .readdirSync(scopeRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          key: `${scope.name}/${entry.name}`,
          scope: scope.name,
          root: path.join(scopeRoot, entry.name),
        }));
    })
    .filter((entry) => fs.existsSync(path.join(entry.root, 'TASKS.md')))
    .map((entry) => ({ ...entry, name: readProjectName(entry.root) }))
    .sort((left, right) => left.scope.localeCompare(right.scope) || left.name.localeCompare(right.name));
}

export function getProject(projectKey?: string | null): ProjectEntry {
  const projects = getProjects();
  const selected = projects.find((project) => project.key === projectKey) ?? projects[0];
  if (!selected) throw new Error(`No scoped projects with TASKS.md found in ${workspaceRoot}`);
  return selected;
}

export function readRepoFile(project: ProjectEntry, relativePath: string): string {
  return fs.readFileSync(path.join(project.root, relativePath), 'utf8');
}

export function parseTaskBoard(project: ProjectEntry): Phase[] {
  const source = readRepoFile(project, 'TASKS.md');
  const lines = source.split('\n');
  const phases: Phase[] = [];
  let phase: Phase | undefined;
  let task: Task | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const phaseMatch = line.match(/^### (.+)$/);
    const taskMatch = line.match(/^#### ([A-Z]+-\d+) — \[([ x~-])\] (.+)$/);

    if (phaseMatch) {
      phase = { name: phaseMatch[1], goal: '', tasks: [] };
      phases.push(phase);
      task = undefined;
      continue;
    }

    if (phase && line.startsWith('> Goal:')) {
      phase.goal = line.replace('> Goal:', '').trim();
      continue;
    }

    if (phase && taskMatch) {
      task = {
        id: taskMatch[1],
        title: stripTicks(taskMatch[3]),
        description: '',
        status: statusMap[taskMatch[2]],
        criteria: [],
        phase: phase.name,
      };
      phase.tasks.push(task);
      continue;
    }

    if (!task) continue;

    const descriptionMatch = line.match(/^\*\*What:\*\* (.+)$/);
    if (descriptionMatch) {
      task.description = stripTicks(descriptionMatch[1]);
      continue;
    }

    const criterionMatch = line.match(/^- \[([ x~-])\] (.+)$/);
    if (criterionMatch) {
      task.criteria.push({
        status: statusMap[criterionMatch[1]],
        text: stripTicks(criterionMatch[2]),
      });
    }
  }

  return phases.filter((entry) => entry.tasks.length > 0);
}

const sessionFileCandidates = ['SESSIONS.md', 'docs/SESSIONS.md', 'tasks/SESSIONS.md'];

export function parseSessionLog(project: ProjectEntry): SessionLogEntry[] {
  const sessionFile = sessionFileCandidates.find((relative) => fs.existsSync(path.join(project.root, relative)));
  if (sessionFile) {
    // Dedicated log file: every `### ` heading is an entry.
    return collectSessionEntries(readRepoFile(project, sessionFile), () => true);
  }
  // Fallback: the log lives in a `## Session Log` section inside TASKS.md.
  let inLog = false;
  return collectSessionEntries(readRepoFile(project, 'TASKS.md'), (line) => {
    const sectionMatch = line.match(/^## (.+)$/);
    if (sectionMatch) inLog = sectionMatch[1].trim().toLowerCase() === 'session log';
    return inLog;
  });
}

function collectSessionEntries(source: string, isInScope: (line: string) => boolean): SessionLogEntry[] {
  // Drop HTML comments so the commented-out entry template is not parsed.
  const lines = source.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const entries: SessionLogEntry[] = [];
  let current: SessionLogEntry | undefined;

  for (const line of lines) {
    if (!isInScope(line)) {
      current = undefined;
      continue;
    }

    const entryMatch = line.match(/^### (.+)$/);
    if (entryMatch) {
      current = { title: entryMatch[1].trim(), body: '' };
      entries.push(current);
      continue;
    }

    if (current) current.body += `${line}\n`;
  }

  return entries.map((entry) => ({ ...entry, body: entry.body.trim() }));
}

const taskIdPattern = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[a-z]?$/;

export function parseTaskArchives(project: ProjectEntry): ArchivedTask[] {
  const archiveFiles = ['docs', 'tasks']
    .flatMap((directory) => listMarkdown(project, directory))
    .filter((file) => /^TASKS.*archive.*\.md$/i.test(path.basename(file)))
    .sort();
  const tasks = new Map<string, ArchivedTask>();

  for (const archive of archiveFiles) {
    for (const task of parseArchiveFile(readRepoFile(project, archive), archive)) {
      const existing = tasks.get(task.id);
      if (!existing || archiveTaskDetailScore(task) >= archiveTaskDetailScore(existing)) {
        tasks.set(task.id, task);
      }
    }
  }

  return [...tasks.values()];
}

function parseArchiveFile(source: string, archive: string): ArchivedTask[] {
  const lines = source.split('\n');
  const tasks = new Map<string, ArchivedTask>();

  for (const line of lines) {
    if (line.trimStart().startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      const [id, title] = cells;
      if (id && title && taskIdPattern.test(id)) {
        tasks.set(id, { id, title: stripTicks(title), archive, description: '', criteria: [] });
      }
    }

    const headingMatch = line.match(/^#{2,5}\s+([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[a-z]?)\s+—\s+(?:\[[ x~-]\]\s+)?(.+)$/);
    if (headingMatch && taskIdPattern.test(headingMatch[1])) {
      const [, id, title] = headingMatch;
      tasks.set(id, { id, title: stripTicks(title.replace(/\s+\*\(.+\)\*$/, '')), archive, description: '', criteria: [] });
    }
  }

  for (const task of tasks.values()) {
    const section = findTaskDetailSection(lines, task.id);
    if (!section) continue;

    for (const line of section) {
      const descriptionMatch = line.match(/^\*\*What:\*\*\s*(.+)$/);
      if (descriptionMatch) task.description = stripTicks(descriptionMatch[1]);

      const criterionMatch = line.match(/^- \[([ x~-])\]\s+(.+)$/) ?? line.match(/^-\s+(.+)$/);
      if (criterionMatch) {
        const hasStatus = criterionMatch.length === 3;
        task.criteria.push({
          status: hasStatus ? statusMap[criterionMatch[1]] : 'done',
          text: stripTicks(criterionMatch[hasStatus ? 2 : 1]),
        });
      }
    }
  }

  return [...tasks.values()];
}

function findTaskDetailSection(lines: string[], taskId: string): string[] | undefined {
  const escapedId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingPattern = new RegExp(`^(#{2,5})\\s+${escapedId}(?:\\s|$)`);
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start < 0) return undefined;

  const level = lines[start].match(/^#+/)?.[0].length ?? 5;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const nextHeading = lines[index].match(/^(#+)\s+/);
    if (nextHeading && nextHeading[1].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function archiveTaskDetailScore(task: ArchivedTask): number {
  return task.criteria.length * 10 + (task.description ? 5 : 0);
}

export function groupArchivedTasks(tasks: ArchivedTask[]): ArchiveGroup[] {
  const groups = new Map<string, ArchivedTask[]>();
  for (const task of tasks) {
    const key = task.archive || 'Unsorted';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(task);
  }
  return [...groups.entries()].map(([archive, grouped]) => ({ archive, tasks: grouped }));
}

export function getDocuments(project: ProjectEntry): DocumentEntry[] {
  const entries = [
    { file: 'README.md', group: 'Overview' },
    { file: 'TASKS.md', group: 'Planning' },
    ...sessionFileCandidates.map((file) => ({ file, group: 'Planning' })),
    ...listMarkdown(project, 'docs').filter(notTrackerMetadata).map((file) => ({ file, group: 'Product docs' })),
    ...listMarkdown(project, 'tasks').filter(notTrackerMetadata).map((file) => ({ file, group: 'Task history' })),
  ].filter(({ file }) => fs.existsSync(path.join(project.root, file)));

  return entries.map(({ file, group }) => {
    const source = readRepoFile(project, file);
    return {
      slug: toDocumentSlug(file),
      title: source.match(/^# (.+)$/m)?.[1] ?? path.basename(file, '.md'),
      group,
      path: file,
      source,
    };
  });
}

export function renderMarkdown(source: string, options: { breaks?: boolean } = {}): string {
  return marked.parse(source, { async: false, breaks: options.breaks ?? false }) as string;
}

export function toDocumentSlug(filePath: string): string {
  return filePath.replace(/\.md$/, '').replaceAll('/', '--').toLowerCase();
}

function listMarkdown(project: ProjectEntry, directory: string): string[] {
  const directoryPath = path.join(project.root, directory);
  if (!fs.existsSync(directoryPath)) return [];

  return fs
    .readdirSync(directoryPath)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => `${directory}/${file}`);
}

function readProjectName(projectRoot: string): string {
  const readmePath = path.join(projectRoot, 'README.md');
  if (fs.existsSync(readmePath)) {
    const heading = fs.readFileSync(readmePath, 'utf8').match(/^# (.+)$/m)?.[1];
    if (heading) return heading;
  }

  return path.basename(projectRoot);
}

function stripTicks(value: string): string {
  return value.replaceAll('`', '');
}

function notTrackerMetadata(file: string): boolean {
  const basename = path.basename(file).toLowerCase();
  return basename !== 'tasks.index.md' && basename !== 'sessions.md';
}
