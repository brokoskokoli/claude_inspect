import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { registry } from '../formats/index.js';
import type { DecodedSubagentMeta } from '../formats/subagent/meta.js';
import { readJson } from '../util/jsonl.js';

export interface SubagentFile {
  agentId: string;
  path: string;
  mtime: number;
  size: number;
  meta: DecodedSubagentMeta;
}

export function subagentDir(sessionPath: string): string {
  return join(sessionPath.slice(0, -'.jsonl'.length), 'subagents');
}

export async function listSubagents(sessionPath: string): Promise<SubagentFile[]> {
  const dir = subagentDir(sessionPath);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: SubagentFile[] = [];
  for (const name of names) {
    const m = /^agent-(.+)\.jsonl$/.exec(name);
    if (!m) continue;
    const path = join(dir, name);
    const metaPath = join(dir, `agent-${m[1]}.meta.json`);
    let meta: DecodedSubagentMeta = {};
    try {
      meta = registry.decode<DecodedSubagentMeta>('subagent-meta', await readJson(metaPath), metaPath).out;
    } catch {
      /* ältere Versionen ohne meta.json */
    }
    try {
      const st = await stat(path);
      out.push({ agentId: m[1], path, mtime: st.mtimeMs, size: st.size, meta });
    } catch {
      /* gelöscht */
    }
  }
  return out;
}

/**
 * Welche Agent-Tool-Aufrufe (tool_use ids) stecken in einer Datei?
 * Schneller Textscan statt vollständigem Parsen; gecacht nach Dateigröße.
 */
const agentCallCache = new Map<string, { size: number; ids: Set<string> }>();
const AGENT_CALL = /"id":"([^"]+)","name":"(?:Agent|Task)"/g;

export async function agentCallIds(path: string, size: number): Promise<Set<string>> {
  const c = agentCallCache.get(path);
  if (c && c.size === size) return c.ids;
  const ids = new Set<string>();
  try {
    const text = await readFile(path, 'utf8');
    for (const m of text.matchAll(AGENT_CALL)) ids.add(m[1]);
  } catch {
    /* gelöscht */
  }
  agentCallCache.set(path, { size, ids });
  return ids;
}
