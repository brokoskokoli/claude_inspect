// Feste Zuordnung Entität → Farbslot (Farbe folgt der Entität, nie dem Rang).

const MODEL_ORDER = [
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-fable-5-1',
  'claude-haiku-4-5',
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
];

export function modelColor(model: string): string {
  const i = MODEL_ORDER.findIndex((m) => model === m || model.startsWith(m + '-') || model.startsWith(m + '['));
  return i >= 0 ? `var(--series-${i + 1})` : 'var(--series-other)';
}

export const TOOL_CATEGORIES = [
  { key: 'bash', label: 'Bash', color: 'var(--series-1)' },
  { key: 'write', label: 'Edit/Write', color: 'var(--series-2)' },
  { key: 'read', label: 'Read/Grep/Glob', color: 'var(--series-3)' },
  { key: 'agent', label: 'Agent', color: 'var(--series-7)' },
  { key: 'web', label: 'Web/Browser', color: 'var(--series-5)' },
  { key: 'other', label: 'Sonstige', color: 'var(--series-other)' },
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number]['key'];

export function toolCategory(name: string): ToolCategory {
  if (name === 'Bash' || name === 'Monitor') return 'bash';
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) return 'write';
  if (['Read', 'Grep', 'Glob'].includes(name)) return 'read';
  if (name === 'Agent' || name === 'Task' || name === 'SendMessage') return 'agent';
  if (name.startsWith('Web') || /browser|chrome|computer/i.test(name)) return 'web';
  return 'other';
}

export function toolColor(name: string): string {
  const c = toolCategory(name);
  return TOOL_CATEGORIES.find((x) => x.key === c)!.color;
}
