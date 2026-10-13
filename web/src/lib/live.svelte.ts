import type { ReviewRun } from '$shared/review';
import type { CpuSnapshot, Dashboard } from '$shared/types';

type TranscriptEvent = { sessionId: string; agentId?: string; total: number };

export const live = $state<{ dashboard: Dashboard | null; cpu: CpuSnapshot | null; connected: boolean }>({ dashboard: null, cpu: null, connected: false });

/** Sekundentakt für relative Zeitangaben. */
export const clock = $state({ now: Date.now() });
setInterval(() => (clock.now = Date.now()), 1000);

const transcriptListeners = new Set<(e: TranscriptEvent) => void>();

export function onTranscript(fn: (e: TranscriptEvent) => void): () => void {
  transcriptListeners.add(fn);
  return () => transcriptListeners.delete(fn);
}

const reviewListeners = new Set<(r: ReviewRun) => void>();

/** Fortschritt laufender Analysen ("Analyze with Claude") */
export function onReview(fn: (r: ReviewRun) => void): () => void {
  reviewListeners.add(fn);
  return () => reviewListeners.delete(fn);
}

export function connect(): void {
  const es = new EventSource('/api/stream');
  es.onopen = () => (live.connected = true);
  es.onerror = () => (live.connected = false); // EventSource verbindet sich selbst neu
  es.addEventListener('dashboard', (ev) => {
    live.dashboard = JSON.parse((ev as MessageEvent).data);
    live.connected = true;
  });
  es.addEventListener('cpu', (ev) => {
    live.cpu = JSON.parse((ev as MessageEvent).data);
  });
  es.addEventListener('review', (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as ReviewRun;
    for (const fn of reviewListeners) fn(data);
  });
  es.addEventListener('transcript', (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as TranscriptEvent;
    for (const fn of transcriptListeners) fn(data);
  });
}
