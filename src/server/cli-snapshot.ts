// Terminal-Ausgabe "laufende Agenten + letzte Aktion" – nützlich zum Testen der Parser.
import { Inspector } from './inspector.js';

const inspector = new Inspector();
await inspector.start();
// Komplettscan nach claude-Aufrufen abwarten
await inspector.spawns.refresh(inspector.index.list(), (await inspector.getDashboard()).processes.map((p) => p.process), true);
const d = await inspector.getDashboard();
inspector.stop();

const ago = (iso?: string) => (iso ? `${Math.round((Date.now() - Date.parse(iso)) / 1000)}s` : '?');
for (const dp of d.processes) {
  const { process: p, job, session: s } = dp;
  const mark = p.alive ? (p.status === 'idle' ? '○' : '●') : '✕';
  console.log(`${mark} ${p.name ?? s?.title ?? p.sessionId.slice(0, 8)}  [${p.kind ?? '?'}/${p.status ?? '?'}]  pid ${p.pid}  ${p.cwd ?? ''}  v${p.version ?? '?'}`);
  if (dp.spawnedBy) console.log(`    ⇠ gestartet von ${dp.spawnedBy.parentTitle ?? dp.spawnedBy.parentSessionId.slice(0, 8)} [${dp.spawnedBy.confidence}: ${dp.spawnedBy.evidence.join(', ')}]`);
  if (job) console.log(`    job ${job.short}: ${job.state} – ${job.detail ?? ''}`);
  if (s) {
    console.log(`    ${s.model ?? '?'} · ctx ${s.contextTokens ?? '?'} · ${s.toolCalls} Tools · ${s.current?.kind}: ${s.current?.label ?? ''} (vor ${ago(s.current?.since)})`);
    for (const t of s.pendingTools) console.log(`    ⏳ ${t.name}: ${t.summary}`);
    for (const c of s.spawned) console.log(`    ⇢ claude ${c.agent ?? ''} ${c.childSessionId.slice(0, 8)} ${c.status} [${c.confidence}: ${c.evidence.join(', ')}]`);
    for (const a of s.subagents) console.log(`    ↳ ${a.agentType ?? 'agent'} "${a.description ?? ''}" ${a.status}${a.current ? ' – ' + a.current.label : ''}`);
  }
}
if (d.orphanJobs.length) console.log(`\n${d.orphanJobs.length} Jobs ohne Prozess`);
const { decoders, drift } = inspector.formats();
console.log(`\nDecoder-Treffer: ${decoders.filter((x) => x.hits).map((x) => `${x.id}=${x.hits}`).join(', ')}`);
console.log(`Drift-Einträge: ${drift.length}`);
for (const x of drift.slice(0, 15)) console.log(`  ${x.source}/${x.recordType}.${x.field} ×${x.count} (${x.firstVersion ?? '?'}–${x.lastVersion ?? '?'})`);
