import type { SubagentInfo, ToolResultEntry, ToolUseEntry } from '$shared/types';

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
export const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
export const n = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

export function resultText(r: ToolResultEntry | undefined): string {
  if (!r) return '';
  return r.parts
    .map((p) => {
      switch (p.type) {
        case 'text':
          return p.text + (p.truncated ? `\n… [${p.truncated} Zeichen gekürzt]` : '');
        case 'image':
          return `[Bild ${p.mediaType ?? ''}]`;
        case 'tool_reference':
          return `[Tool geladen: ${p.toolName}]`;
        default:
          return JSON.stringify(p.value);
      }
    })
    .join('\n');
}

export function structured(r: ToolResultEntry | undefined): Obj | undefined {
  return isObj(r?.structured) ? r.structured : undefined;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export function hunks(v: unknown): Hunk[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  return v.filter(isObj).map((h) => ({
    oldStart: n(h.oldStart) ?? 0,
    oldLines: n(h.oldLines) ?? 0,
    newStart: n(h.newStart) ?? 0,
    newLines: n(h.newLines) ?? 0,
    lines: Array.isArray(h.lines) ? h.lines.map(String) : [],
  }));
}

export type UserTextView =
  | { type: 'plain'; text: string }
  | { type: 'command'; name: string; args: string }
  | { type: 'stdout'; text: string }
  | { type: 'notification'; text: string }
  | { type: 'meta'; text: string };

export function parseUserText(text: string): UserTextView {
  const cmd = /<command-name>([\s\S]*?)<\/command-name>/.exec(text);
  if (cmd) return { type: 'command', name: cmd[1].trim(), args: /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1].trim() ?? '' };
  const out = /<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>/.exec(text);
  if (out) return { type: 'stdout', text: out[1] };
  if (/<task-notification>|<teammate-message|<channel-message/.test(text)) return { type: 'notification', text: text.replace(/<\/?[a-z-]+[^>]*>/g, '').trim() };
  if (/^\s*<(local-command-caveat|system-reminder)>/.test(text)) return { type: 'meta', text };
  return { type: 'plain', text };
}

export interface ToolViewProps {
  use: ToolUseEntry;
  result?: ToolResultEntry;
  sessionId: string;
  subagent?: SubagentInfo;
}
