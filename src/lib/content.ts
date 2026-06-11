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

export function getDocuments(project: ProjectEntry): DocumentEntry[] {
  const entries = [
    { file: 'README.md', group: 'Overview' },
    { file: 'TASKS.md', group: 'Planning' },
    ...listMarkdown(project, 'docs').map((file) => ({ file, group: 'Product docs' })),
    ...listMarkdown(project, 'tasks').map((file) => ({ file, group: 'Task history' })),
  ].filter(({ file }) => fs.existsSync(path.join(project.root, file)));

  return entries.map(({ file, group }) => {
    const source = readRepoFile(project, file);
    return {
      slug: file.replace(/\.md$/, '').replaceAll('/', '--').toLowerCase(),
      title: source.match(/^# (.+)$/m)?.[1] ?? path.basename(file, '.md'),
      group,
      path: file,
      source,
    };
  });
}

export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false }) as string;
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
