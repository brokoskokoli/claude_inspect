# claude-inspect

> English: [README.md](README.md) · Screenshots: [docs/screenshots](docs/screenshots)
>
> Die Oberfläche ist englisch; hell, dunkel oder nach Systemeinstellung (Umschalter oben rechts).

Lokales Live-Dashboard für Claude-Code-Agenten. Liest **passiv** die Dateien unter
`~/.claude`, ohne Hooks, ohne Konfigurationsänderung und ohne eigene Datenablage.

## Start

```bash
npx claude-inspect --open          # einmal ausprobieren
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
anderen Port, `CLAUDE_CONFIG_DIR=/pfad` für ein anderes Datenverzeichnis.

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

Neue Dateiformate: siehe [docs/FORMATS.md](docs/FORMATS.md). Gesamtkonzept: [KONZEPT.md](KONZEPT.md).

## Speicher & Leistung

Nichts wird auf Platte geschrieben. Beim Start liest der Server nur Prozess-, Job- und
Kopfdaten (unter 1 s); die komplette History (hier ~600 MB) wird im Hintergrund in
2–3 s aggregiert und danach nur noch inkrementell nachgeführt. Vollständige Verläufe
werden erst beim Öffnen geladen und mit einer Obergrenze im Speicher gehalten.
