# claude-inspect – Claude-Code-Dashboard & Monitor für Agenten, Subagenten und Verbrauch

[![npm](https://img.shields.io/npm/v/claude-inspect)](https://www.npmjs.com/package/claude-inspect)
[![npm downloads](https://img.shields.io/npm/dm/claude-inspect)](https://www.npmjs.com/package/claude-inspect)
[![CI](https://github.com/brokoskokoli/claude_inspect/actions/workflows/ci.yml/badge.svg)](https://github.com/brokoskokoli/claude_inspect/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/brokoskokoli/claude_inspect/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/brokoskokoli/claude_inspect?style=social)](https://github.com/brokoskokoli/claude_inspect)

**htop plus Flugschreiber für Claude Code. Keine Hooks, kein Proxy, ein `npx`.**

Lokales Live-Dashboard und Monitor für Claude-Code-Agenten: laufende Sessions, Subagenten,
per `claude -p` gestartete Worker, Tool-Aufrufe, Zeitleisten, CPU- und Token-Verbrauch
und ein Transcript-Viewer mit durchsuchbarer History.

```bash
npx claude-inspect --open          # Node.js ≥ 22 · macOS, Linux, Windows
```

Liest **passiv** die Dateien unter `~/.claude`, ohne Hooks und ohne Konfigurationsänderung.
Das Einzige, was es schreibt, ist ein CPU-Protokoll im eigenen Datenverzeichnis (siehe *CPU*).

> English: [README.md](https://github.com/brokoskokoli/claude_inspect/blob/main/README.md) · Website: [brokoskokoli.github.io/claude_inspect](https://brokoskokoli.github.io/claude_inspect/) · Mitmachen: [CONTRIBUTING.md](https://github.com/brokoskokoli/claude_inspect/blob/main/CONTRIBUTING.md)
>
> Die Oberfläche ist englisch; hell, dunkel oder nach Systemeinstellung (Umschalter oben rechts).

![Live-Dashboard mit laufenden Agenten, Subagenten und einer gestarteten Worker-Session](https://raw.githubusercontent.com/brokoskokoli/claude_inspect/main/docs/screenshots/dashboard.jpg)

## Installation

```bash
npm install -g claude-inspect      # dauerhaft installieren
claude-inspect service install     # Autostart → http://localhost:47717 (Lesezeichen)
claude-inspect demo --open         # ohne eigene Daten ausprobieren
claude-inspect --help              # alle Optionen
```

Der Autostart ist unter macOS ein LaunchAgent, unter Linux ein `systemd --user`-Dienst. Er startet
beim Login und nach Abstürzen neu und läuft ohne Token (nur von localhost erreichbar).
`claude-inspect service status` zeigt Zustand und Log, `claude-inspect service uninstall` entfernt ihn.

Manuell gestartet gibt `claude-inspect` eine URL mit Zufallstoken (`?t=…`) aus; der Browser merkt
es sich als Cookie. `--token` für einen festen Token, `--no-auth` für keinen, `--port` für einen
anderen Port, `CLAUDE_CONFIG_DIR=/pfad` für ein anderes Datenverzeichnis, `--no-cpu-log` ohne
CPU-Protokoll, `CLAUDE_INSPECT_DATA_DIR=/pfad` für einen anderen Ablageort des CPU-Protokolls.

Aus den Quellen: `git clone …`, `npm install`, `npm run build`, `npm start`
(`npm run dev` + `npm run dev:web` für die Entwicklung mit Hot-Reload).

## Was angezeigt wird

- **Live**: laufende Prozesse (`sessions/*.json`, Lebendprüfung per `ps`), jeweils mit
  aktueller Aktivität, laufenden Tools, Hintergrund-Job samt laufender Shells, aktiven
  Subagenten, Modell, Kontextgröße, Tokens und Permission-Mode
- **Sessions**: alle Transcripts mit Suche
- **Session-Detail**, mit Tabs:
  - *Transcript*: Agentenbaum (Hauptagent → Subagenten, auch verschachtelt),
  kompletter Verlauf mit Tool-Renderern (Bash, Read, Edit/Write als Diff, Agent mit Link
  zum Subagenten, Grep/Glob, generisch für alle anderen), Filter, Suche und Rohansicht
  jeder Zeile. Bei laufenden Sessions werden Änderungen live nachgeladen.
  - *Timeline*: eine Spur je Agent (inkl. gestarteter Sitzungen), Tool-Aufrufe als
    Balken, Aufruf-Verbindungen, Pausen über 10 min zusammengeschoben, Zoom
  - *Call graph*: wer wen aufgerufen hat, inkl. Fork/Fortsetzung
  - *Tasks*: Task-Liste der Session als Board
  - *CPU*: Auslastung des Claude-Prozesses samt aller Unterprozesse (Shells, Builds, Tests,
  MCP-Server …) als gestapelter Verlauf je Programmname, dazu die Prozesse mit der meisten CPU-Zeit
  - *Cost*: geschätzte Kosten (API-Listenpreis) der Session samt aller Subagenten und per
  `claude` gestarteten Sitzungen, je Agent und je Modell mit Tokens (Input, Output, Cache)
  - Beim Hochscrollen blendet sich eine kompakte Kopfzeile mit Sprung nach oben/unten ein
- **CPU**: alle 3 s aus der Prozesstabelle gemessen (100 % = ein Kern), Verlaufslinie auf der
  Dashboard-Karte. Pro Session eine CSV-Datei im App-Datenverzeichnis (macOS
  `~/Library/Application Support/claude-inspect/cpu`, Linux `~/.local/share/claude-inspect/cpu`,
  Windows `%LOCALAPPDATA%\claude-inspect\cpu`), damit der Verlauf nach Sessionende abrufbar bleibt.
  Dateien älter als 30 Tage werden gelöscht. Gemessen wird nur, solange claude-inspect läuft;
  Prozesse, die kürzer als 3 s leben, fehlen. Abschalten mit `--no-cpu-log`.
- **Statistics**: API-Gegenwert (Schätzung nach Listenpreisen), Tokens je Modell/Tag/Projekt,
  Cache-Anteil, Aktivitäts-Heatmap, Tool-Statistik mit Fehlern und Dauer (p95)
- **Tools**: alle Tool-Aufrufe aller Sessions, filterbar; Klick springt an die Stelle im Verlauf
- **Files**: welche Dateien Agenten gelesen/geändert haben
- **Search**: Volltext über alle Verläufe, Subagenten und die Eingabe-Historie
- **Claude-Aufrufe**: Sitzungen, die ein Agent per Bash startet (`claude -p …`,
  `claude --agent …`), werden dem aufrufenden Tool-Aufruf zugeordnet und erscheinen im
  Agentenbaum, auf der Dashboard-Karte und am Bash-Aufruf. Konfidenz:
  - *exakt*: Prozessbaum (laufendes Kind → Shell → Eltern-Prozess) oder `--session-id` im Befehl
  - *sicher*: erster Prompt des Kindes steht im Befehl, dazu Zeit, `--agent` und Verzeichnis
  - *wahrscheinlich*: schwächere Indizien, z. B. nur kurzer Prompt und Zeitfenster
  (siehe `src/server/sources/spawns.ts`)
- **Formats**: registrierte Decoder mit Trefferzahlen und alle Felder, die noch kein
  Decoder kennt (Schema-Drift)
- **Handy**: Auf schmalen Bildschirmen (Handy, kleines iframe) klappt die Navigation in
  ein Menü, Tabellen werden zu kompakten Listen, die Session-Ansicht ist einspaltig, und
  lange Inhalte (Code, Pfade, JSON) scrollen innerhalb ihres Blocks. Der Server lauscht
  weiterhin nur auf 127.0.0.1 – für den Zugriff vom Handy braucht es einen eigenen Tunnel
  oder Reverse-Proxy, der mit lokalem `Host`-Header weiterleitet (andere Hosts werden
  abgewiesen).

## Architektur

```
src/shared/        Domain-Typen, Tool-Kurzbeschreibungen, Preistabelle (Server + Frontend)
src/server/
  formats/         Decoder je Quelle + Registry (Format-Erkennung pro Record)
  sources/         Dateizugriff: Projekte, Transcripts (inkrementell), Prozesse, Jobs, Subagenten
  model/           Aktivität/offene Tools (analyze.ts), Zeitleisten-Daten (flow.ts)
  history/         Aggregator (Tokens, Kosten, Tools, Dateien) und Volltextsuche
  inspector.ts     Zustand, Dateiüberwachung, Dashboard-Aufbau
  http.ts          REST + Server-Sent Events
web/               Svelte-5-Frontend
tests/             Fixtures je Claude-Code-Version, Snapshots, Tests
scripts/           Fixture-Generator
```

Neue Dateiformate: siehe [docs/FORMATS.md](https://github.com/brokoskokoli/claude_inspect/blob/main/docs/FORMATS.md). Gesamtkonzept: [KONZEPT.md](https://github.com/brokoskokoli/claude_inspect/blob/main/KONZEPT.md).

## Speicher & Leistung

Außer dem CPU-Log im eigenen Datenverzeichnis wird nichts auf Platte geschrieben. Beim Start liest der Server nur Prozess-, Job- und
Kopfdaten (unter 1 s); die komplette History (hier ~600 MB) wird im Hintergrund in
2–3 s aggregiert und danach nur noch inkrementell nachgeführt. Vollständige Verläufe
werden erst beim Öffnen geladen und mit einer Obergrenze im Speicher gehalten.
