# claude-inspect

> English: [README.md](README.md) · Screenshots: [docs/screenshots](docs/screenshots)
>
> Die Oberfläche ist englisch; hell, dunkel oder nach Systemeinstellung (Umschalter oben rechts).

Lokales Live-Dashboard für Claude-Code-Agenten. Liest **passiv** die Dateien unter
`~/.claude`, ohne Hooks, ohne Konfigurationsänderung und ohne eigene Datenablage.

## Start

```bash
npm install
npm run build      # Oberfläche bauen und Server zu JavaScript kompilieren
npm start          # Server auf localhost:7717, öffnet den Browser
```

Dauerhaft im Hintergrund (Autostart beim Login, Neustart nach Absturz, ohne Token):

```bash
npm run build
npm run service:install          # http://localhost:47717 – als Lesezeichen anlegen
npm run service:status           # Zustand und Log-Datei
npm run service:uninstall        # entfernen
```

Die URL enthält ein Zufallstoken (`?t=…`). Nach dem ersten Aufruf merkt sich der Browser
das Token als Cookie. Der Server ist nur lokal erreichbar und rein lesend.
Für ein festes Lesezeichen: `CLAUDE_INSPECT_TOKEN=meingeheimnis npm start` (oder `--token`).

Entwicklung mit Hot-Reload: `npm run dev` (API ohne Token) und parallel `npm run dev:web`
(Vite auf http://127.0.0.1:5173).

Weitere Befehle:

- `npm run snapshot`: laufende Agenten und Drift-Report als Terminal-Ausgabe
- `npm test`: Tests (Decoder-Snapshots je Version, Linker, History-Aggregator)
- `npm run demo`: Demo-Datensatz erzeugen und Server darauf starten
- `npm run fixtures`: Fixtures neu aus den lokalen Transcripts erzeugen (anonymisiert)
- `npm run test:update`: Decoder-Snapshots nach gewollter Änderung aktualisieren
- `npm run check`: Typprüfung für Server und Frontend

Anderes Datenverzeichnis: `CLAUDE_CONFIG_DIR=/pfad npm start`.

Ohne eigene Daten ausprobieren: `npm run demo` (fiktiver `~/.claude` mit laufenden Agenten und zwei Wochen History, http://127.0.0.1:7718/?t=demo).

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
