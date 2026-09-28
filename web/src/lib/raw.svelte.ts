import { api } from './api';

export const rawView = $state<{ open: boolean; title: string; data: unknown; error?: string }>({ open: false, title: '', data: null });

export async function showRaw(sessionId: string, agentId: string | undefined, line: number) {
  rawView.open = true;
  rawView.title = `${agentId ? `agent-${agentId}` : sessionId}.jsonl · Zeile ${line + 1}`;
  rawView.data = null;
  rawView.error = undefined;
  try {
    rawView.data = await api.raw(sessionId, agentId, line);
  } catch (e) {
    rawView.error = String(e);
  }
}
