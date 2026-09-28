import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskItem } from '../../shared/types.js';
import { paths } from '../config.js';
import { registry } from '../formats/index.js';
import { readJson } from '../util/jsonl.js';

export async function readTasks(sessionId: string): Promise<TaskItem[]> {
  if (!/^[\w-]+$/.test(sessionId)) return [];
  const dir = join(paths.tasks, sessionId);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: TaskItem[] = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const file = join(dir, n);
    try {
      out.push(registry.decode<TaskItem>('task', await readJson(file), file).out);
    } catch {
      /* halb geschrieben */
    }
  }
  return out.sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id));
}
