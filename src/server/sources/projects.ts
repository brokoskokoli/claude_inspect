import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionSummary } from '../../shared/types.js';
import { paths, relToClaude } from '../config.js';
import { registry } from '../formats/index.js';
import type { DecodedEntry } from '../formats/transcript/common.js';
import { isObj, num, str } from '../formats/util.js';
import { readHeadTail } from '../util/jsonl.js';
import { compareVersions } from '../util/semver.js';

export interface TranscriptFile {
  sessionId: string;
  projectDir: string;
  path: string;
  size: number;
  mtime: number;
}

/** Letztes Segment eines Pfads – egal ob mit "/" (macOS/Linux) oder "\\" (Windows). */
export function pathTail(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
}

export function projectName(cwd: string | undefined, projectDir: string): string {
  if (cwd) return pathTail(cwd);
  // kodiertes Home-Verzeichnis: -Users-<name>- (macOS), -home-<name>- (Linux), C--Users-<name>- (Windows)
  return projectDir.replace(/^(?:[A-Za-z]-)?-(?:Users|home)-[^-]+-/, '');
}

/**
 * Index über alle Session-Transcripts unter ~/.claude/projects.
 * Hält nur Dateinamen, Größe und mtime; Zusammenfassungen werden lazy
 * aus Anfang und Ende der Datei gebildet und nach (size, mtime) gecacht.
 */
export class ProjectIndex {
  private files = new Map<string, TranscriptFile>();
  private summaries = new Map<string, { size: number; mtime: number; summary: SessionSummary }>();

  async scan(): Promise<void> {
    const next = new Map<string, TranscriptFile>();
    let dirs: string[] = [];
    try {
      dirs = await readdir(paths.projects);
    } catch {
      /* noch keine Projekte */
    }
    await Promise.all(
      dirs.map(async (projectDir) => {
        const dir = join(paths.projects, projectDir);
        let names: string[];
        try {
          names = await readdir(dir);
        } catch {
          return;
        }
        for (const name of names) {
          if (!name.endsWith('.jsonl')) continue;
          const path = join(dir, name);
          try {
            const st = await stat(path);
            const sessionId = name.slice(0, -'.jsonl'.length);
            next.set(sessionId, { sessionId, projectDir, path, size: st.size, mtime: st.mtimeMs });
          } catch {
            /* gerade gelöscht */
          }
        }
      }),
    );
    this.files = next;
  }

  /** Aktualisiert einen einzelnen Eintrag nach einem Watch-Event. */
  async touch(path: string): Promise<void> {
    const m = /^projects\/([^/]+)\/([^/]+)\.jsonl$/.exec(relToClaude(path));
    if (!m) return;
    try {
      const st = await stat(path);
      this.files.set(m[2], { sessionId: m[2], projectDir: m[1], path, size: st.size, mtime: st.mtimeMs });
    } catch {
      this.files.delete(m[2]);
    }
  }

  get(sessionId: string): TranscriptFile | undefined {
    return this.files.get(sessionId);
  }

  list(): TranscriptFile[] {
    return [...this.files.values()].sort((a, b) => b.mtime - a.mtime);
  }

  async summary(f: TranscriptFile): Promise<SessionSummary> {
    const cached = this.summaries.get(f.path);
    if (cached && cached.size === f.size && cached.mtime === f.mtime) return cached.summary;
    const summary = await summarize(f);
    this.summaries.set(f.path, { size: f.size, mtime: f.mtime, summary });
    return summary;
  }
}

async function countSubagents(sessionDir: string): Promise<number> {
  try {
    return (await readdir(join(sessionDir, 'subagents'))).filter((n) => n.endsWith('.jsonl')).length;
  } catch {
    return 0;
  }
}

async function summarize(f: TranscriptFile): Promise<SessionSummary> {
  const s: SessionSummary = {
    sessionId: f.sessionId,
    projectDir: f.projectDir,
    project: projectName(undefined, f.projectDir),
    size: f.size,
    mtime: f.mtime,
    versions: [],
    subagentCount: 0,
  };
  const sessionDir = f.path.slice(0, -'.jsonl'.length);
  s.subagentCount = await countSubagents(sessionDir);

  let head: unknown[] = [];
  let tail: unknown[] = [];
  try {
    ({ head, tail } = await readHeadTail(f.path, 32 * 1024, 256 * 1024));
  } catch {
    return s;
  }
  const versions = new Set<string>();
  const titles: Record<string, string> = {};

  const fold = (raws: unknown[]) => {
    for (const raw of raws) {
      if (!isObj(raw)) continue;
      const { out } = registry.decode<DecodedEntry[]>('transcript', raw, f.path, 0, { silent: true });
      const v = str(raw.version);
      if (v) versions.add(v);
      if (str(raw.cwd)) s.cwd = str(raw.cwd);
      if (str(raw.gitBranch)) s.gitBranch = str(raw.gitBranch);
      for (const e of out) {
        if (e.timestamp) {
          if (!s.firstTimestamp || e.timestamp < s.firstTimestamp) s.firstTimestamp = e.timestamp;
          if (!s.lastTimestamp || e.timestamp > s.lastTimestamp) s.lastTimestamp = e.timestamp;
        }
        if (e.kind === 'meta') {
          const d = e.data;
          if (e.metaType === 'custom-title' && str(d.customTitle)) titles.custom = str(d.customTitle)!;
          if (e.metaType === 'agent-name' && str(d.agentName)) titles.agent = str(d.agentName)!;
          if (e.metaType === 'ai-title' && str(d.aiTitle)) titles.ai = str(d.aiTitle)!;
          if (e.metaType === 'last-prompt' && str(d.lastPrompt)) s.lastPrompt = str(d.lastPrompt);
          if (e.metaType === 'cost-state' && num(d.totalCostUSD) !== undefined) s.costUSD = num(d.totalCostUSD);
        }
        if ((e.kind === 'assistant-text' || e.kind === 'tool-use' || e.kind === 'thinking') && e.model && e.model !== '<synthetic>') {
          s.model = e.model;
        }
      }
    }
  };
  fold(head);
  fold(tail);

  try {
    const ct = JSON.parse(await readFile(join(sessionDir, 'custom-title.json'), 'utf8'));
    if (isObj(ct) && str(ct.customTitle)) titles.custom ??= str(ct.customTitle)!;
  } catch {
    /* optional */
  }
  s.title = titles.custom ?? titles.agent ?? titles.ai;
  s.versions = [...versions].sort(compareVersions);
  s.project = projectName(s.cwd, f.projectDir);
  return s;
}
