/**
 * Erzeugt anonymisierte Test-Fixtures aus den lokalen Transcripts:
 * je Claude-Code-Version ein Beispiel pro Record-Form (type/subtype/Attachment-/Block-Typ).
 * Alle frei formulierten Inhalte werden ersetzt; erhalten bleiben Struktur, Feldnamen,
 * Typ-Diskriminatoren, Tool- und Modellnamen. Aufruf: npm run fixtures
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../src/server/config.js';

/** Werte dieser Schlüssel sind Formatinformation, keine Inhalte. */
const KEEP = new Set([
  'type', 'subtype', 'version', 'role', 'name', 'model', 'stop_reason', 'level', 'operation', 'mode',
  'permissionMode', 'promptSource', 'entrypoint', 'userType', 'sessionKind', 'metaType', 'service_tier',
  'status', 'media_type', 'effort', 'perTurnEffort', 'trigger', 'source', 'agentType', 'requestShape', 'speed',
]);

let counter = 0;
const ids = new Map<string, string>();
/** Ersetzt IDs (UUIDs, toolu_/msg_/req_/session_…) stabil durch Platzhalter; sonst undefined. */
function anonId(v: string): string | undefined {
  const hit = ids.get(v);
  if (hit) return hit;
  let out: string | undefined;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) out = `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  else if (/^(toolu|msg|req|session|cse|srvtoolu)_\w+$/.test(v)) out = `${v.slice(0, v.indexOf('_'))}_fixture${++counter}`;
  if (out) ids.set(v, out);
  return out;
}

/**
 * Zeitstempel werden auf ein fiktives Datum verschoben (Abstände bleiben erhalten,
 * damit Dauern weiter berechnet werden können).
 */
const BASE = Date.parse('2026-01-01T09:00:00.000Z');
let firstTs: number | undefined;
function shiftTs(v: string): string {
  const t = Date.parse(v);
  if (Number.isNaN(t)) return v;
  firstTs ??= t;
  return new Date(BASE + ((t - firstTs) % (30 * 86_400_000))).toISOString();
}

function anon(v: unknown, key = ''): unknown {
  if (typeof v === 'string') {
    if (KEEP.has(key)) return v;
    const id = anonId(v);
    if (id) return id;
    if (/^\d{4}-\d\d-\d\dT/.test(v)) return shiftTs(v);
    if (key === 'command') return 'echo fixture';
    if (key === 'file_path' || key === 'filePath' || key === 'cwd') return '/fixture/path/file.txt';
    return v.length ? 'x'.repeat(Math.min(12, v.length)) : '';
  }
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => anon(x, key));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    const t = (v as Record<string, unknown>).type;
    for (const [k, x] of Object.entries(v)) {
      // "name" ist nur bei Tool-Aufrufen Formatinformation (Tool-Name), sonst z. B. Skill-/Projektname
      const keep = k !== 'name' || t === 'tool_use' || t === 'server_tool_use';
      // IDs kommen auch als Objekt-Schlüssel vor (z. B. wireToolInputs["toolu_…"])
      out[anonId(k) ?? k] = keep ? anon(x, k) : anon(x, `${k}#`);
    }
    return out;
  }
  return v;
}

function shapeKey(r: Record<string, any>): string {
  const blocks = Array.isArray(r.message?.content) ? r.message.content.map((b: any) => b?.type).join('+') : typeof r.message?.content;
  return [r.type, r.subtype, r.attachment?.type, blocks, r.toolUseResult ? typeof r.toolUseResult : ''].join('|');
}

const byVersion = new Map<string, Map<string, unknown>>();
const files: string[] = [];
for (const d of readdirSync(paths.projects)) {
  const dir = join(paths.projects, d);
  if (!statSync(dir).isDirectory()) continue;
  for (const n of readdirSync(dir)) if (n.endsWith('.jsonl')) files.push(join(dir, n));
}
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r: Record<string, any>;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const v = typeof r.version === 'string' ? r.version.split('.').slice(0, 3).join('.') : 'none';
    const m = byVersion.get(v) ?? new Map();
    byVersion.set(v, m);
    const key = shapeKey(r);
    if (!m.has(key)) m.set(key, anon(r));
  }
}
// Pro Version eine Datei; Records ohne Version gehen in "none"
for (const [v, m] of byVersion) {
  writeFileSync(join('tests/fixtures', `transcript-${v}.jsonl`), [...m.values()].map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`${v}: ${m.size} Record-Formen`);
}
