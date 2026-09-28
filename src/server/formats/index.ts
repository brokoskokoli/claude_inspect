import { jobStateDecoder, jobStateFallback, jobTimelineDecoder, jobTimelineFallback, rosterDecoder, rosterFallback } from './job/job.js';
import { processDecoderV1, processDecoderV2, processFallback } from './process/session-file.js';
import { FormatRegistry } from './registry.js';
import { historyFallback, historyPromptDecoder } from './history/prompt.js';
import { subagentMetaDecoder, subagentMetaFallback } from './subagent/meta.js';
import { taskDecoder, taskFallback } from './task/task.js';
import { messageDecoder } from './transcript/message.js';
import { attachmentDecoder, metaDecoder, systemDecoder, transcriptFallback } from './transcript/other.js';

/** Zentrale Registry. Neue Decoder hier eintragen. */
export const registry = new FormatRegistry()
  // Transcripts
  .register(messageDecoder)
  .register(systemDecoder)
  .register(attachmentDecoder)
  .register(metaDecoder)
  .register(transcriptFallback)
  // Prozesse
  .register(processDecoderV2)
  .register(processDecoderV1)
  .register(processFallback)
  // Jobs & Daemon
  .register(jobStateDecoder)
  .register(jobStateFallback)
  .register(jobTimelineDecoder)
  .register(jobTimelineFallback)
  .register(rosterDecoder)
  .register(rosterFallback)
  // Subagenten
  .register(subagentMetaDecoder)
  .register(subagentMetaFallback)
  // Tasks & Eingabe-Historie
  .register(taskDecoder)
  .register(taskFallback)
  .register(historyPromptDecoder)
  .register(historyFallback);
