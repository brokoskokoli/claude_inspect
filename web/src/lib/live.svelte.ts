import type { Dashboard } from '$shared/types';

type TranscriptEvent = { sessionId: string; agentId?: string; total: number };

export const live = $state<{ dashboard: Dashboard | null; connected: boolean }>({ dashboard: null, connected: false });

/** Sekundentakt für relative Zeitangaben. */
export const clock = $state({ now: Date.now() });
setInterval(() => (clock.now = Date.now()), 1000);

const transcriptListeners = new Set<(e: TranscriptEvent) => void>();

export function onTranscript(fn: (e: TranscriptEvent) => void): () => void {
  transcriptListeners.add(fn);
  return () => transcriptListeners.delete(fn);
}

export function connect(): void {
  const es = new EventSource('/api/stream');
  es.onopen = () => (live.connected = true);
  es.onerror = () => (live.connected = false); // EventSource verbindet sich selbst neu
  es.addEventListener('dashboard', (ev) => {
    live.dashboard = JSON.parse((ev as MessageEvent).data);
    live.connected = true;
  });
  es.addEventListener('transcript', (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as TranscriptEvent;
    for (const fn of transcriptListeners) fn(data);
  });
}
