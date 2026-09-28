// Kurzbeschreibung eines Tool-Aufrufs für Listen und Statuszeilen.

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function basename(p: string): string {
  const i = p.replace(/\/+$/, '').lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function firstLine(s: string, max = 120): string {
  const line = s.split('\n', 1)[0] ?? '';
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

/** "mcp__claude-in-chrome__navigate" → { server: "claude-in-chrome", tool: "navigate" } */
export function splitMcpName(name: string): { server?: string; tool: string } {
  const m = /^mcp_{1,2}(.+?)__(.+)$/.exec(name);
  return m ? { server: m[1], tool: m[2] } : { tool: name };
}

export function toolSummary(name: string, input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  switch (name) {
    case 'Bash':
      return str(i.description) ?? firstLine(str(i.command) ?? '');
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return basename(str(i.file_path) ?? str(i.notebook_path) ?? '');
    case 'Grep':
    case 'Glob':
      return (str(i.pattern) ?? '') + (str(i.path) ? ` in ${basename(str(i.path)!)}` : '');
    case 'Agent':
    case 'Task':
      return [str(i.subagent_type), str(i.description)].filter(Boolean).join(': ');
    case 'WebFetch':
      return str(i.url) ?? '';
    case 'WebSearch':
      return str(i.query) ?? '';
    case 'Skill':
      return str(i.skill) ?? '';
    case 'SendMessage':
      return `→ ${str(i.to) ?? '?'}`;
    case 'ToolSearch':
      return str(i.query) ?? '';
    case 'ScheduleWakeup':
      return str(i.reason) ?? '';
    case 'TaskCreate':
    case 'TaskUpdate':
      return str(i.subject) ?? str(i.taskId) ?? '';
    case 'AskUserQuestion': {
      const q = Array.isArray(i.questions) ? (i.questions[0] as Record<string, unknown>) : undefined;
      return firstLine(str(q?.question) ?? '');
    }
  }
  for (const k of ['description', 'command', 'url', 'query', 'path', 'file_path', 'prompt', 'action', 'name']) {
    const v = str(i[k]);
    if (v) return firstLine(v);
  }
  const keys = Object.keys(i);
  return keys.length ? keys.slice(0, 3).join(', ') : '';
}
