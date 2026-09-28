import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobInfo, JobTimelineItem } from '../../shared/types.js';
import { paths } from '../config.js';
import { registry } from '../formats/index.js';
import type { DecodedJobState, RosterLaunch } from '../formats/job/job.js';
import { readHeadTail, readJson } from '../util/jsonl.js';

async function readRoster(): Promise<RosterLaunch> {
  try {
    return registry.decode<RosterLaunch>('daemon-roster', await readJson(paths.daemonRoster), paths.daemonRoster).out;
  } catch {
    return {};
  }
}

async function readTimeline(file: string): Promise<JobTimelineItem[]> {
  try {
    const { tail } = await readHeadTail(file, 0, 32 * 1024);
    return tail.slice(-30).map((raw) => registry.decode<JobTimelineItem>('job-timeline', raw, file).out);
  } catch {
    return [];
  }
}

/** Zuletzt gelesener Zustand je Job – neu dekodiert wird nur bei geänderter Datei. */
const cache = new Map<string, { key: string; job: JobInfo }>();

export async function readJobs(): Promise<JobInfo[]> {
  let names: string[] = [];
  try {
    names = await readdir(paths.jobs);
  } catch {
    return [];
  }
  const roster = await readRoster();
  const jobs: JobInfo[] = [];
  for (const short of names) {
    const dir = join(paths.jobs, short);
    try {
      if (!(await stat(dir)).isDirectory()) continue;
      const file = join(dir, 'state.json');
      const tl = join(dir, 'timeline.jsonl');
      const [st, tst] = await Promise.all([stat(file), stat(tl).catch(() => undefined)]);
      const key = `${st.mtimeMs}:${st.size}:${tst?.mtimeMs ?? 0}:${JSON.stringify(roster[short] ?? null)}`;
      const hit = cache.get(short);
      if (hit && hit.key === key) {
        jobs.push(hit.job);
        continue;
      }
      const { out, decoder } = registry.decode<DecodedJobState>('job-state', await readJson(file), file);
      const job: JobInfo = { ...out, short, decoder, launch: roster[short], timeline: await readTimeline(tl) };
      cache.set(short, { key, job });
      jobs.push(job);
    } catch {
      /* Job ohne state.json */
    }
  }
  return jobs;
}
