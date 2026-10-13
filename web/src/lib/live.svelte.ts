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

const reconnectListeners = new Set<() => void>();

/** Nach einer Unterbrechung (z. B. Tab war im Hintergrund) – Ansichten können nachladen. */
export function onReconnect(fn: () => void): () => void {
  reconnectListeners.add(fn);
  return () => reconnectListeners.delete(fn);
}

const reviewListeners = new Set<(r: ReviewRun) => void>();

/** Fortschritt laufender Analysen ("Analyze with Claude") */
export function onReview(fn: (r: ReviewRun) => void): () => void {
  reviewListeners.add(fn);
  return () => reviewListeners.delete(fn);
}

/**
 * Live-Verbindung nur, solange der Tab sichtbar ist: Ein Tab im Hintergrund trennt nach kurzer
 * Zeit, damit der Server in den Sparbetrieb wechselt; beim Zurückkommen wird neu verbunden.
 */
export function connect(): void {
  let es: EventSource | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let opened = false;
  const sync = () => {
    clearTimeout(hideTimer);
    if (document.visibilityState === 'visible') {
      if (!es) {
        const again = opened;
        es = open();
        opened = true;
        if (again) for (const fn of reconnectListeners) fn();
      }
    } else {
      hideTimer = setTimeout(() => {
        es?.close();
        es = undefined;
        live.connected = false;
      }, 15_000);
    }
  };
  document.addEventListener('visibilitychange', sync);
  sync();
}

function open(): EventSource {
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
  return es;
}
