# claude_inspect – Konzept

Ein lokales Web-Tool, das den Zustand aller Claude-Code-Agenten auf diesem Rechner anzeigt: was gerade läuft, wer wen gestartet hat, welche Tools was ausgeführt haben, und die komplette History.
Es liest **nur passiv** die Dateien, die Claude Code ohnehin schreibt. Es richtet keine Hooks ein und ändert keine Konfiguration.

Stand der Analyse: 28.09.2026, Claude Code 2.1.72 bis 2.1.283 auf diesem Rechner.

---

## 1. Was auf der Platte liegt (Bestandsaufnahme)

### 1.1 Datenquellen

| Quelle | Pfad | Inhalt | Wofür im Tool |
|---|---|---|---|
| **Session-Transcripts** | `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` | vollständiger Verlauf: Prompts, Antworten, Thinking, Tool-Aufrufe und Ergebnisse, Tokens, Metadaten | Kern: Timeline, Tools, History |
| **Subagent-Transcripts** | `…/<sessionId>/subagents/agent-<agentId>.jsonl` | Verlauf des Subagenten (`isSidechain: true`) | Aufrufbaum |
| **Subagent-Metadaten** | `…/<sessionId>/subagents/agent-<agentId>.meta.json` | `agentType`, `description`, `toolUseId`, `spawnDepth`, `requestShape` (background/foreground) | Verknüpfung Eltern → Kind |
| Ausgelagerte Tool-Ergebnisse | `…/<sessionId>/tool-results/toolu_*.txt`, `*.bin` | große Tool-Outputs (`persistedOutputPath`) | Detailansicht Tool |
| Session-Titel | `…/<sessionId>/custom-title.json` | Titel | Anzeige |
| Projekt-Index | `…/sessions-index.json`, `*.desktop-released.json` | Index und Desktop-App-Status | Übersicht |
| Projekt-Memory | `…/memory/*.md` | Memory-Dateien des Projekts | Info-Tab je Projekt |
| **Laufende Prozesse** | `~/.claude/sessions/<pid>.json` | `pid`, `sessionId`, `cwd`, `version`, `kind` (interactive/bg), `entrypoint`, `name`, `status` (busy/idle), `jobId`/`parkedJobId`, `bridgeSessionId`, `messagingSocketPath` | **Live-Status** |
| **Hintergrund-Jobs** | `~/.claude/jobs/<short>/state.json` | `state`, `detail` (aktueller Schritt), `tempo`, `inFlight`, `fan` (laufende Shells und Monitore), `tokens`, `children`, `resumeSessionId`, `intent` | Live-Status und aktuelle Aktivität |
| Job-Timeline | `~/.claude/jobs/<short>/timeline.jsonl` | Statuswechsel mit Zeitstempel und Text | Job-Verlauf |
| Daemon | `~/.claude/daemon/roster.json`, `daemon.status.json`, `daemon.lock`, `daemon.log` | Worker je Job, `dispatch.launch` (resume/fork, Quell-Session, Flags) | Wer hat den Job gestartet (Fork-Beziehung) |
| Task-Listen | `~/.claude/tasks/<sessionId>/<n>.json` | `subject`, `description`, `status`, `blocks`, `blockedBy` | Aufgaben-Board je Session |
| Prompt-History | `~/.claude/history.jsonl` | jede Eingabe mit `project`, `sessionId`, `timestamp` | globale Suche, Aktivitäts-Heatmap |
| File-History | `~/.claude/file-history/<sessionId>/<hash>@vN` | Backups editierter Dateien | Diff-Ansicht „vorher/nachher“ |
| IDE-Verbindungen | `~/.claude/ide/<port>.lock` | IDE-Name, Workspace-Ordner, pid | Anzeige, welche IDE angebunden ist |
| Globale Statistik | `~/.claude.json` → `projects.*.last*`, `toolUsage`, `skillUsage` | Kosten und Tokens der letzten Session je Projekt, Tool-Nutzung | Statistik |
| Sonstiges | `stats-cache.json`, `plugins/`, `skills/`, `agents/`, `settings.json` | Konfiguration | Info-Seite |

Umfang hier: 382 JSONL-Dateien, rund 600 MB, etwa 260 Subagenten, rund 150.000 Transcript-Zeilen.

### 1.2 Record-Typen in den Transcripts

Jede Zeile ist ein JSON-Objekt mit `type`. Gefunden wurden 23 Typen:

- **Nachrichten:** `user`, `assistant`, `attachment`, `system`
  - Gemeinsame Felder: `uuid`, `parentUuid`, `timestamp`, `sessionId`, `version`, `cwd`, `gitBranch`, `isSidechain`, `agentId`, `entrypoint`, `sessionKind`, `slug`
  - `assistant.message`: `model`, `content[]` (`text` | `thinking` | `tool_use`), `stop_reason`, `usage` (Input, Output, Cache-Read und Cache-Write inkl. 5m/1h, Thinking-Tokens, Web-Requests), plus `requestId`, `effort`, `attributionSkill`, `attributionAgent`, `attributionMcpServer`, `advisorModel`, `isApiErrorMessage`
  - `user.message.content[]`: `text` | `tool_result` | `image`. Dazu `toolUseResult` (strukturiertes Ergebnis, je nach Tool: `stdout`/`stderr`, `structuredPatch`, `oldString`/`newString`, `agentId`, `totalTokens`, `toolStats`, `backgroundTaskId` …), `sourceToolAssistantUUID`, `toolDenialKind`, `isCompactSummary`, `promptSource`, `origin`
  - `system.subtype`: `stop_hook_summary`, `turn_duration`, `api_error` (mit Retry-Infos), `away_summary`, `local_command`, `compact_boundary`, `bridge_status`, `informational`
  - `attachment.attachment.type`: 38 Arten, u. a. `edited_text_file`, `file`, `queued_command`, `task_reminder`, `skill_listing`, `hook_additional_context`, `model`, `date_change`, `nested_memory`, `budget_usd`
- **Zustand und Metadaten:** `custom-title`, `ai-title`, `agent-name`, `agent-setting`, `mode`, `permission-mode`, `last-prompt`, `cost-state` (Gesamtkosten, Dauer, Lines added/removed, `modelUsage`), `worktree-state`, `relocated`, `continued-in`, `bridge-session`, `queue-operation` (enqueue/dequeue mit Inhalt), `file-history-snapshot`, `file-history-delta`, `frame-link`, `atis-latch`, `artifact-*`

Tools, die in der History vorkommen: Bash (30.000×), Read, Edit, Write, Grep, Agent (384×), Browser-MCP, ScheduleWakeup, ToolSearch, WebFetch, AskUserQuestion, SendMessage, TaskCreate/TaskUpdate, Monitor, Skill und weitere.

### 1.3 Beziehungen („wer hat wen aufgerufen“)

Diese Verknüpfungen lassen sich rein aus den Dateien rekonstruieren:

```
Nachricht ──parentUuid──▶ Nachricht        (Gesprächsbaum inkl. Verzweigungen/Rewinds)
tool_use.id ◀──tool_result.tool_use_id      (Aufruf ↔ Ergebnis, Dauer = Δ timestamp)
Agent-tool_use.id ──▶ toolUseResult.agentId ──▶ subagents/agent-<id>.jsonl
                  ◀── agent-<id>.meta.json.toolUseId   (+ spawnDepth für Verschachtelung)
Session ──continued-in──▶ Session           (Fortsetzung)
compact_boundary.logicalParentUuid          (Kontext-Kompaktierung überbrückt)
jobs/<short>/state.json.resumeSessionId     (Job setzt Session fort)
daemon/roster.json.dispatch.launch{sessionId, fork}   (Job ist Fork von Session X)
sessions/<pid>.json.jobId / parkedJobId     (Prozess ↔ Job; interaktiv „parkt“ in bg-Job)
SendMessage-tool_use {to: name}             (Peer-Nachricht zwischen Sessions)
worktree-state                              (Session arbeitet in Worktree)
```

Daraus ergibt sich ein **Agenten-Graph**: Prozess → Session → (Subagenten, rekursiv) → Tools, plus Kanten für Fork/Resume/Peer-Message.

### 1.4 Live-Status ermitteln (ohne Hooks)

1. `~/.claude/sessions/*.json` lesen. Jeder Eintrag ist ein laufender (oder abgestürzter) Prozess.
2. Lebt der Prozess? Mit `kill(pid, 0)` prüfen und `procStart` vergleichen, damit ein wiederverwendeter PID nicht fälschlich als lebendig zählt. Das ist ein reiner Lese-Check, keine Interaktion mit dem Prozess.
3. `status` (busy/idle) aus der Datei, bei Jobs zusätzlich `jobs/<id>/state.json` (`state`, `detail`, `fan` = gerade laufende Shell-Befehle).
4. Aktivität im Transcript: die letzte Zeile. Offene `tool_use` ohne `tool_result` bedeuten „Tool läuft gerade“, laufende Subagenten sind Agent-Aufrufe ohne Abschluss.
5. Veraltet: `updatedAt` älter als X Minuten und PID tot → „beendet/abgestürzt“.

---

## 2. Architektur

```
┌────────────────────────── Backend (lokal, 127.0.0.1) ──────────────────────────┐
│                                                                                 │
│  Watcher (fs.watch/chokidar)                                                    │
│     │  Datei geändert → Offset merken, nur neue Bytes lesen (Tail)              │
│     ▼                                                                           │
│  Source-Adapter (je Dateiart)  ──▶  Format-Registry  ──▶  Decoder (versioniert) │
│     sessions/*.json                    erkennt Format        liefert normierte  │
│     projects/**/*.jsonl                pro Record            Domain-Events      │
│     jobs/**/state.json …               (Score-basiert)                          │
│                                              │                                  │
│                                              ▼                                  │
│                          Domain-Model / Index (nur im Arbeitsspeicher)          │
│                          Agents · Sessions · Messages · ToolCalls · Edges       │
│                                              │                                  │
│                              REST (Abfragen)  +  SSE/WebSocket (Live-Updates)   │
└──────────────────────────────────────────────┼──────────────────────────────────┘
                                               ▼
                                    Frontend (SPA im Browser)
```

### 2.1 Stack-Vorschlag

- **Backend:** Node.js + TypeScript (Fastify o. ä.) oder Bun. Gleiche Sprache wie das Frontend, Decoder-Typen teilen sich Frontend und Backend.
- **Keine eigene Persistenz:** Das Tool speichert nichts. Die Quelle der Wahrheit sind ausschließlich die Dateien unter `~/.claude`, der Index lebt nur im Arbeitsspeicher. Was Claude Code aufräumt, verschwindet auch aus dem Tool.
- **Zweistufiges Laden**, weil 600 MB beim Start komplett zu parsen zu langsam wäre:
  1. *Beim Start:* Nur die leichten Quellen vollständig lesen (`sessions/`, `jobs/`, `daemon/`, `tasks/`, `history.jsonl`, `*.meta.json`, `custom-title.json`). Von jedem Transcript nur Größe, mtime sowie Anfang und Ende. Das reicht für Titel, Zeitraum, letzten Prompt und `cost-state`. So entsteht eine Session-Liste mit Kennzahlen.
  2. *Bei Bedarf:* Ein Transcript wird erst beim Öffnen komplett geparst und im Speicher gehalten (LRU-Cache, Obergrenze z. B. 500 MB). Aktive Sessions werden per Tail inkrementell nachgeführt, pro Datei merkt sich das Tool den Byte-Offset.
  - Übergreifende Auswertungen (Tool-Explorer, Kosten, Suche) laufen als Hintergrund-Scan über alle Dateien. Sie werden progressiv angezeigt und nur als kompakte Aggregate im Speicher gehalten.
- **Frontend:** Svelte oder React + Vite. Graph mit Cytoscape.js oder ELK/dagre, Timeline mit eigener SVG-Komponente oder vis-timeline, Diffs mit `diff2html`.
- **Start:** `npx claude-inspect`, öffnet `http://127.0.0.1:<port>`.

### 2.2 Format-Erkennung und Erweiterbarkeit (Kernstück)

**Wichtige Beobachtung:** Innerhalb *einer* Datei kommen mehrere Versionen vor. Eine Session, die mit 2.1.274 begonnen und mit 2.1.283 fortgesetzt wurde, enthält Records beider Versionen. Die Erkennung muss darum **pro Record** passieren, nicht pro Datei.

```ts
interface Decoder<Raw = unknown> {
  id: string;                    // "transcript.assistant.v2"
  source: SourceKind;            // "transcript" | "session-registry" | "job-state" | …
  /** 0 = passt nicht, höher = passt besser. Nutzt version, Feld-Fingerprint, type. */
  match(raw: Raw, ctx: DecodeContext): number;
  decode(raw: Raw, ctx: DecodeContext): DomainEvent[];
}
```

- **Registry:** Alle Decoder liegen in `src/formats/<source>/<name>.ts` und werden automatisch geladen. Ein neues Format bedeutet: eine neue Datei anlegen, sonst nichts ändern.
- **Matching:** Zuerst harte Kriterien (`type`, `version` in einem semver-Bereich), dann ein Struktur-Fingerprint (Pflichtfelder vorhanden). Der Decoder mit dem höchsten Score gewinnt.
- **Fallback-Decoder:** Er passt immer mit Score 1, legt den Record als `UnknownRecord` ab und zeigt ihn roh an. **Es geht keine Information verloren.**
- **Feld-Abdeckung:** Jeder Decoder meldet, welche Felder er verarbeitet hat. Nicht verarbeitete Felder landen als `extra` am Domain-Objekt und werden in der UI angezeigt. Zusätzlich gibt es die Seite **„Schema-Drift“**: neue Record-Typen, neue Felder und neue Attachment-Arten mit der ersten Version, in der sie aufgetaucht sind. So sieht man sofort, wenn Claude Code ein Update mit neuen Daten bringt, und weiß, wo ein Decoder nachgezogen werden sollte.
- **Tool-Renderer** laufen genauso über eine Registry (`src/tools/Bash.ts`, `Edit.ts`, `Agent.ts` …). Sie bestimmen, wie Input und Ergebnis eines Tools dargestellt werden. Unbekannte Tools bekommen einen generischen JSON-Renderer.
- **Tests:** Anonymisierte Beispiel-Records je Version liegen als Fixtures bei, dazu gibt es Snapshot-Tests je Decoder.

### 2.3 Normiertes Domain-Model

```
Process   { pid, alive, kind, entrypoint, version, status, name, cwd, jobId, ideLink }
Job       { short, state, detail, tempo, fan[], tokens, intent, resumeSessionId, timeline[] }
Session   { id, project, cwd, gitBranch, titles, mode, permissionMode, versions[],
            models[], cost, tokens, startedAt, lastActivity, worktree, extra }
Agent     { id, sessionId, parentToolCallId, agentType, description, depth,
            background, model, status, tokens, toolStats }
Message   { uuid, parentUuid, role, kind, text/thinking, model, usage, timestamp, extra }
ToolCall  { id, name, input, result, structuredResult, isError, denied,
            startedAt, endedAt, durationMs, callerAgentId, persistedOutput }
Edge      { from, to, kind: spawn | fork | resume | continue | message | compact }
Task      { id, sessionId, subject, description, status, blocks[], blockedBy[] }
```

---

## 3. Ansichten im Frontend

1. **Live-Dashboard (Startseite)**
   - Karten je laufendem Prozess oder Job: Name, Projekt, Status (busy/idle/tot), aktuelles Detail (z. B. „running integration tests for part 2“), laufende Tools und Shells mit Laufzeit, Tokens und Kosten, Modell, Effort, Permission-Mode, Remote-Control ja/nein, IDE.
   - Aktualisiert sich live über SSE.
2. **Agenten-Graph („wer hat wen aufgerufen“)**
   - Baum bzw. Graph: Prozess → Session → Subagenten (beliebig tief) → Tool-Aufrufe (gruppiert). Fork-, Resume- und Peer-Message-Kanten sind gestrichelt.
   - Knoten sind nach Status eingefärbt (läuft, fertig, Fehler) und anklickbar für Details.
3. **Session-Timeline**
   - Gantt-artige Spuren je Agent (Hauptagent und Subagenten parallel). Balken für Tool-Aufrufe, Thinking und Antworten. Hier sieht man, wer wann parallel gearbeitet hat.
   - Markiert werden Compaction, API-Fehler mit Retries, Hook-Läufe, Permission-Ablehnungen und Rewinds bzw. Verzweigungen.
4. **Transcript-Ansicht**
   - Chat-Verlauf mit ein- und ausklappbarem Thinking. Tool-Aufrufe erscheinen mit spezifischem Renderer: Bash als Befehl plus stdout/stderr, Edit und Write als Diff, Read als Dateiausschnitt, Agent als Link in den Subagenten.
   - Attachments und System-Records lassen sich optional einblenden. Jeder Eintrag hat einen „Raw JSON“-Knopf.
5. **Tool-Explorer**
   - Alle Tool-Aufrufe über alle Sessions: filterbar nach Tool, Projekt, Zeitraum und Fehler, sortierbar nach Dauer.
   - Statistik: die häufigsten Befehle, die langsamsten Tools, die am häufigsten bearbeiteten Dateien.
6. **Dateien**
   - Welche Dateien welche Session geändert hat, mit Diff aus `structuredPatch` bzw. `file-history`.
7. **History und Suche**
   - Volltextsuche über Prompts (`history.jsonl`, sofort) sowie über Antworten und Tool-Inputs (Streaming-Suche direkt über die JSONL-Dateien, Treffer erscheinen progressiv).
   - Aktivitäts-Heatmap nach Tag und Projekt.
8. **Kosten und Tokens**
   - Nach Session, Projekt, Modell und Tag, aufgeteilt in Input, Output, Cache-Read und Cache-Write sowie nach Subagent.
9. **Tasks**
   - Board je Session aus `tasks/`, mit Abhängigkeiten.
10. **Rohdaten und Schema-Drift**
   - Dateibrowser über `~/.claude` mit Record-Viewer. Unbekannte Typen und Felder werden hervorgehoben.

---

## 4. Sicherheit und Datenschutz

- Der Server bindet **nur an 127.0.0.1**, dazu kommt ein zufälliges Token in der URL. Transcripts enthalten Code, Prompts und eventuell Secrets aus Tool-Outputs.
- **Nie lesen oder anzeigen:** `sessions/*.key` (peerToken), `daemon/control.key`, `daemon/auth/`, `authToken` in `ide/*.lock`, `.credentials*`. Diese Pfade stehen auf einer Deny-Liste, Felder mit Namen wie `*token*`, `*key*` oder `*secret*` werden standardmäßig maskiert.
- Das Tool arbeitet strikt read-only. Es schreibt nichts nach `~/.claude` und legt auch sonst keine Daten ab.
- Es werden keine Sockets unter `/tmp/cc-socks` angesprochen. Die sind zwar vorhanden, würden aber aktive Kommunikation mit den Agenten bedeuten.

---

## 5. Umsetzungsphasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **1 – Fundament** ✅ | Watcher, inkrementeller JSONL-Tail, Decoder-Registry mit Fallback, Decoder für `sessions/*.json` und Transcript-Kerntypen, Domain-Model im Speicher | CLI-Ausgabe „laufende Agenten + letzte Aktion“ |
| **2 – Live-Dashboard** ✅ | Web-Server, SSE, Dashboard, Transcript-Ansicht mit Tool-Renderern (Bash, Read, Edit, Write, Agent, generisch) | erste nutzbare Web-UI |
| **3 – Aufrufbaum** ✅ | Subagent-Verknüpfung, Jobs und Daemon, Fork/Resume-Kanten, Graph und Timeline | „wer hat wen aufgerufen“ |
| **4 – History** ✅ | Hintergrund-Scan mit Aggregaten, Suche, Tool-Explorer, Kosten, Dateien/Diffs, Tasks | vollständige History |
| **5 – Robustheit** ✅ | Schema-Drift-Seite, Fixtures je Version, Snapshot-Tests, Doku „Neues Format hinzufügen“ | wartbar bei neuen Versionen |

---

## 6. Entscheidungen (28.09.2026)

- **Umfang:** Erst einmal nur Claude Code. Die Adapter-Architektur bleibt trotzdem offen für andere Agenten.
- **Stack:** TypeScript durchgehend (Backend Node.js und Frontend).
- **Zugriff:** Nur lokal im Browser (`127.0.0.1`), keine Auth über das URL-Token hinaus.
- **Persistenz:** Keine. Das Tool speichert selbst keine Sessions und keinen Index, alles wird aus `~/.claude` gelesen und nur im Speicher gehalten.
