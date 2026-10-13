// Analyse einer Session durch Claude ("Analyze with Claude"): Prüfaspekte und Datentypen.

export type ReviewAspect = 'outcome' | 'efficiency' | 'errors' | 'privacy' | 'security' | 'orchestration' | 'improvements';

export interface AspectInfo {
  key: ReviewAspect;
  label: string;
  /** Kurzbeschreibung im Auswahldialog */
  hint: string;
  /** Prüfauftrag an das Modell */
  brief: string;
  default: boolean;
}

export const ASPECTS: AspectInfo[] = [
  {
    key: 'outcome',
    label: 'Task outcome',
    hint: 'Did the agent do what was asked? Anything skipped, half-done or claimed without evidence?',
    brief:
      'Compare the user requests with what was actually done. Point out parts that were skipped, left unfinished or done differently than asked, and claims in the final answers that are not backed by the tool calls (e.g. "tests pass" without a test run).',
    default: true,
  },
  {
    key: 'efficiency',
    label: 'Efficiency & cost',
    hint: 'Wasted tokens and time: redundant reads, loops, oversized context, expensive model for simple work.',
    brief:
      'Find where time, tokens or money were wasted: files read repeatedly, searches that could have been one call, loops and retries, very large contexts, expensive models or subagents used for trivial work, long waits. Use the cost and context figures. Estimate what a leaner run would have looked like.',
    default: true,
  },
  {
    key: 'errors',
    label: 'Errors & dead ends',
    hint: 'Failed tool calls, retries and detours – what went wrong and how much it cost.',
    brief:
      'Go through failed tool calls, denied permissions, retries and abandoned approaches. For each relevant one: the cause, how the agent recovered (or did not), and how much time/cost the detour took.',
    default: false,
  },
  {
    key: 'privacy',
    label: 'Privacy & data protection',
    hint: 'Secrets or personal data read, printed or sent to external services.',
    brief:
      'Check whether sensitive data was touched: credentials, keys, tokens ([REDACTED] marks secrets that appeared in the original), .env files, SSH/cloud configs, personal data (names, emails, addresses, customer data). Did any of it end up in outputs, commits, logs or requests to external services (curl, WebFetch, MCP tools, git push)? Distinguish necessary access from unnecessary exposure.',
    default: true,
  },
  {
    key: 'security',
    label: 'Security & risky actions',
    hint: 'Destructive commands, force pushes, permission bypasses, untrusted code, prompt injection.',
    brief:
      'Look for risky actions: destructive or irreversible commands (rm -rf, reset --hard, force push, dropping data), sudo, disabled safety checks (--no-verify, bypass permissions), installing or running untrusted code (curl | sh, unknown packages), and signs of prompt injection from fetched web content or files that changed the agent\'s behaviour.',
    default: false,
  },
  {
    key: 'orchestration',
    label: 'Agents & delegation',
    hint: 'Subagents and spawned claude workers: sensible split, duplicate work, cost per agent.',
    brief:
      'Assess how work was split across subagents and spawned claude sessions: was delegation worth it, were prompts to subagents clear and complete, did agents duplicate work or wait on each other, which agent cost most relative to its contribution? If there were no subagents, say whether delegation would have helped.',
    default: false,
  },
  {
    key: 'improvements',
    label: 'Setup improvements',
    hint: 'What to change in prompt, CLAUDE.md, permissions or skills so the next run goes smoother.',
    brief:
      'Derive concrete improvements for next time: better phrasing of the request, rules or facts worth adding to CLAUDE.md, permission allow-rules that would have avoided prompts, hooks, skills or subagents that would fit. Give copy-pasteable snippets where possible.',
    default: true,
  },
];

export const REVIEW_MODELS = [
  { key: 'haiku', label: 'Haiku – fast, cheapest' },
  { key: 'sonnet', label: 'Sonnet – balanced' },
  { key: 'opus', label: 'Opus – most thorough' },
] as const;
export type ReviewModel = (typeof REVIEW_MODELS)[number]['key'];

export interface ReviewRequest {
  aspects: ReviewAspect[];
  model: ReviewModel;
  /** eigene Frage, optional */
  question?: string;
  /** BCP-47-Sprache für die Antwort, z. B. "de-DE" */
  language?: string;
}

export interface ReviewRun {
  id: string;
  sessionId: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  request: ReviewRequest;
  /** Antwort (Markdown), wächst während des Laufs */
  text: string;
  error?: string;
  /** vom CLI gemeldete Kosten der Analyse (API-Listenpreis) */
  costUSD?: number;
  modelId?: string;
  digest: DigestStats;
}

export interface DigestStats {
  chars: number;
  /** grobe Schätzung (Zeichen / 3,5) */
  tokens: number;
  agents: number;
  toolCalls: number;
  redactions: number;
  /** Einträge mussten gekürzt werden */
  truncated: boolean;
}

export interface ReviewState {
  /** `claude` gefunden? */
  available: boolean;
  claudePath?: string;
  /** Analyse abgeschaltet (--no-analyze) */
  disabled: boolean;
  digest?: DigestStats;
  runs: ReviewRun[];
}
