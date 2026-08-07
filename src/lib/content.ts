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
  objective: string;
  expectedOutputs: string[];
  validationRequirements: string[];
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

export interface AdminSessionEntry {
  id: string;
  type: string;
  title: string;
  source: string;
  searchText: string;
}

export interface AdminSessionsDocument {
  path: string;
  source: string;
  introduction: string;
  entries: AdminSessionEntry[];
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
  type: 'html' | 'markdown';
}

export interface ProjectEntry {
  key: string;
  name: string;
  scope: string;
  root: string;
  tasksRoot: string;
}

type ProjectCandidate = Omit<ProjectEntry, 'name' | 'tasksRoot'>;

const trackerRoot = fileURLToPath(new URL('../../', import.meta.url));
const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT ?? path.dirname(trackerRoot));
const statusMap: Record<string, TaskStatus> = {
  ' ': 'pending',
  '~': 'active',
  x: 'done',
  '-': 'blocked',
};

// A project keeps TASKS.md/SESSIONS.md at its true root (the common case) or,
// as a fallback, inside docs/ai/ — used when those files must stay out of a
// tracked docs/ folder. Root takes priority so existing true-root projects
// are unaffected.
function resolveTasksRoot(root: string): string | null {
  if (fs.existsSync(path.join(root, 'TASKS.md'))) return '';
  if (fs.existsSync(path.join(root, 'docs/ai/TASKS.md'))) return 'docs/ai';
  return null;
}

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
    .flatMap(expandWorkbenchRepos)
    .flatMap((entry) => {
      const tasksRoot = resolveTasksRoot(entry.root);
      return tasksRoot === null ? [] : [{ ...entry, tasksRoot }];
    })
    .map((entry) => ({ ...entry, name: readProjectName(entry.root) }))
    .sort((left, right) => left.scope.localeCompare(right.scope) || left.name.localeCompare(right.name));
}

function expandWorkbenchRepos(entry: ProjectCandidate): ProjectCandidate[] {
  const reposRoot = path.join(entry.root, 'repos');
  if (!fs.existsSync(reposRoot)) return [entry];

  const repos = fs
    .readdirSync(reposRoot, { withFileTypes: true })
    .filter((repo) => repo.isDirectory())
    .map((repo) => ({
      key: `${entry.key}/${repo.name}`,
      scope: entry.scope,
      root: path.join(reposRoot, repo.name),
    }));

  return repos.length > 0 ? repos : [entry];
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
  const source = readRepoFile(project, path.join(project.tasksRoot, 'TASKS.md'));
  const lines = source.split('\n');
  const phases: Phase[] = [];
  let phase: Phase | undefined;
  let task: Task | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // A phase is any `#`..`###` heading; tasks can live under a milestone-style
    // `## ` section or a release-style `# ` section. Empty phases are dropped below.
    const phaseMatch = line.match(/^#{1,3} (.+)$/);
    // IDs are `ID-04`, `STRUCT-02a` or release-style `R1.1`.
    const taskMatch = line.match(/^#### ([A-Z][A-Z0-9]*(?:[-.][A-Z0-9]+)*[a-z]?) — \[([ x~-])\] (.+)$/);

    if (phaseMatch) {
      phase = { name: phaseMatch[1], goal: '', tasks: [] };
      phases.push(phase);
      task = undefined;
      continue;
    }

    const goalMatch = line.match(/^> (?:Goal|Demo): (.+)$/);
    if (phase && goalMatch) {
      phase.goal = goalMatch[1].trim();
      continue;
    }

    // A goal/demo sentence may wrap over several quoted lines.
    if (phase && !task && phase.goal && line.startsWith('> ')) {
      phase.goal += ` ${line.slice(2).trim()}`;
      continue;
    }

    if (phase && taskMatch) {
      task = {
        id: taskMatch[1],
        title: stripTicks(taskMatch[3]),
        description: '',
        objective: '',
        expectedOutputs: [],
        validationRequirements: [],
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

    const objectiveMatch = line.match(/^\*\*Objective:\*\* (.+)$/);
    if (objectiveMatch) {
      task.objective = stripTicks(objectiveMatch[1]);
      continue;
    }

    const currentSection = findCurrentTaskSection(lines, index);
    const bulletMatch = line.match(/^- (?!\[)(.+)$/);
    if (bulletMatch && currentSection === 'Expected outputs') {
      task.expectedOutputs.push(stripTicks(bulletMatch[1]));
      continue;
    }
    if (bulletMatch && currentSection === 'Validation requirements') {
      task.validationRequirements.push(stripTicks(bulletMatch[1]));
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

function findCurrentTaskSection(lines: string[], index: number): string | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const line = lines[cursor];
    if (/^#### /.test(line)) return null;
    const sectionMatch = line.match(/^\*\*(Expected outputs|Validation requirements|Completion criteria):\*\*$/);
    if (sectionMatch) return sectionMatch[1];
  }
  return null;
}

const sessionFileCandidates = ['SESSIONS.md', 'docs/SESSIONS.md', 'tasks/SESSIONS.md'];
const adminSessionsFileCandidates = ['ADMIN_SESSIONS.md', 'docs/ADMIN_SESSIONS.md', 'tasks/ADMIN_SESSIONS.md'];

export function parseSessionLog(project: ProjectEntry): SessionLogEntry[] {
  const candidates = [path.join(project.tasksRoot, 'SESSIONS.md'), ...sessionFileCandidates];
  const sessionFile = candidates.find((relative) => fs.existsSync(path.join(project.root, relative)));
  if (sessionFile) {
    // Dedicated log file: every `### ` heading is an entry.
    return collectSessionEntries(readRepoFile(project, sessionFile), () => true);
  }
  // Fallback: the log lives in a `## Session Log` section inside TASKS.md.
  let inLog = false;
  return collectSessionEntries(readRepoFile(project, path.join(project.tasksRoot, 'TASKS.md')), (line) => {
    const sectionMatch = line.match(/^## (.+)$/);
    if (sectionMatch) inLog = sectionMatch[1].trim().toLowerCase() === 'session log';
    return inLog;
  });
}

export function getAdminSessions(project: ProjectEntry): AdminSessionsDocument | null {
  const candidates = [path.join(project.tasksRoot, 'ADMIN_SESSIONS.md'), ...adminSessionsFileCandidates];
  const adminSessionsFile = candidates.find((relative) => fs.existsSync(path.join(project.root, relative)));
  if (!adminSessionsFile) return null;

  const source = readRepoFile(project, adminSessionsFile);
  const lines = source.split('\n');
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^##\s+ADM-\d+[a-z]?\s+—\s+.+$/i.test(line));
  const firstEntryIndex = headings[0]?.index ?? lines.length;
  const entries = headings.map(({ line, index }, entryIndex) => {
    const headingMatch = line.match(/^##\s+(ADM-\d+[a-z]?)\s+—\s+(.+)$/i);
    if (!headingMatch) throw new Error(`Invalid admin session heading: ${line}`);

    const end = headings[entryIndex + 1]?.index ?? lines.length;
    const entrySource = lines.slice(index, end).join('\n').trim();
    const body = lines.slice(index + 1, end).join('\n');
    const type = body.match(/^\*\*Type:\*\*\s*`?([A-Z][A-Z0-9-]*)`?/im)?.[1] ?? 'ADM-UNKNOWN';

    return {
      id: headingMatch[1].toUpperCase(),
      type: type.toUpperCase(),
      title: headingMatch[2].trim(),
      source: entrySource,
      searchText: `${headingMatch[1]} ${type} ${headingMatch[2]} ${body}`.toLowerCase(),
    };
  });

  return {
    path: adminSessionsFile,
    source,
    introduction: lines.slice(0, firstEntryIndex).join('\n').trim(),
    entries,
  };
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
    .flatMap((directory) => listDocuments(project, directory))
    // Archives are named `TASKS-archive-*.md`, or any `TASKS*.md` inside an archive folder.
    .filter((file) => /^TASKS.*\.md$/i.test(path.basename(file)) && /archive/i.test(file))
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
  const entries = listDocuments(project, '.')
    .map((file) => ({ file, group: documentGroup(file, project.tasksRoot) }))
    .sort((left, right) => {
      const groupOrder = documentGroupOrder.indexOf(left.group) - documentGroupOrder.indexOf(right.group);
      return groupOrder || left.file.localeCompare(right.file);
    });

  return entries.map(({ file, group }) => {
    const source = readRepoFile(project, file);
    const type = file.toLowerCase().endsWith('.html') ? 'html' : 'markdown';
    return {
      slug: toDocumentSlug(file),
      title: documentTitle(file, source, type),
      group,
      path: file,
      source,
      type,
    };
  });
}

export function renderMarkdown(source: string, options: { breaks?: boolean } = {}): string {
  return marked.parse(source, { async: false, breaks: options.breaks ?? false }) as string;
}

export function renderInlineMarkdown(source: string): string {
  return marked.parseInline(source, { async: false }) as string;
}

export function toDocumentSlug(filePath: string): string {
  const normalized = filePath.toLowerCase();
  const withoutExtension = normalized.endsWith('.md') ? normalized.slice(0, -3) : normalized;
  return withoutExtension.replaceAll('/', '--');
}

function listDocuments(project: ProjectEntry, directory: string): string[] {
  const directoryPath = path.join(project.root, directory);
  if (!fs.existsSync(directoryPath)) return [];

  const files: string[] = [];
  const visit = (currentPath: string) => {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.isDirectory() && !ignoredDocumentDirectories.has(entry.name)) {
        visit(path.join(currentPath, entry.name));
      } else if (entry.isFile() && ['.html', '.md'].includes(path.extname(entry.name).toLowerCase())) {
        files.push(path.relative(project.root, path.join(currentPath, entry.name)));
      }
    }
  };

  visit(directoryPath);
  return files.sort();
}

function documentTitle(file: string, source: string, type: DocumentEntry['type']): string {
  if (type === 'markdown') return source.match(/^# (.+)$/m)?.[1] ?? path.basename(file, '.md');

  const title = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?? source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  return title?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || path.basename(file, '.html');
}

function readProjectName(projectRoot: string): string {
  const readmePath = path.join(projectRoot, 'README.md');
  if (fs.existsSync(readmePath)) {
    const source = fs.readFileSync(readmePath, 'utf8');
    const headings = [...source.matchAll(/^(#{1,6})\s+(.+)$/gm)];
    const firstHeading = headings[0];

    if (firstHeading?.[1] === '#') {
      const heading = firstHeading[2].trim();
      if (!genericProjectHeadings.has(heading.toLowerCase())) return heading;

      const nextHeadingIndex = headings[1]?.index ?? source.length;
      const introduction = source.slice((firstHeading.index ?? 0) + firstHeading[0].length, nextHeadingIndex);
      const emphasizedName = introduction.match(/^\*\*(.+)\*\*$/m)?.[1]?.trim();
      if (emphasizedName) return emphasizedName;
    }
  }

  return path.basename(projectRoot);
}

function stripTicks(value: string): string {
  return value.replaceAll('`', '');
}

const ignoredDocumentDirectories = new Set([
  '.astro',
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

const documentGroupOrder = [
  'Overview',
  'Planning',
  'Feature docs',
  'Product docs',
  'Module docs',
  'Task history',
  'Repository docs',
];

const genericProjectHeadings = new Set(['introduction', 'overview']);

function documentGroup(file: string, tasksRoot: string): string {
  const normalized = file.toLowerCase();
  if (file === 'README.md') return 'Overview';
  if (file === path.join(tasksRoot, 'TASKS.md') || file === path.join(tasksRoot, 'SESSIONS.md') || sessionFileCandidates.includes(file)) return 'Planning';
  if (normalized.startsWith('docs/ai/')) return 'Feature docs';
  if (normalized.startsWith('docs/')) return 'Product docs';
  if (normalized.startsWith('tasks/')) return 'Task history';
  if (normalized.startsWith('.github/')) return 'Repository docs';
  if (file.includes('/')) return 'Module docs';
  return 'Repository docs';
}
