# Contributing to claude-inspect

Thanks for helping! Bug reports, decoders for new Claude Code versions, renderers and docs are all welcome.
Issues labeled [good first issue](https://github.com/brokoskokoli/claude_inspect/labels/good%20first%20issue)
are a good place to start; questions and ideas go to [Discussions](https://github.com/brokoskokoli/claude_inspect/discussions).

## Setup

Requires Node.js ≥ 22.

```bash
git clone https://github.com/brokoskokoli/claude_inspect.git && cd claude_inspect
npm install
npm run dev        # API without token on :7717 (tsx watch, reads your ~/.claude)
npm run dev:web    # Vite dev server on :5173 with hot reload, proxies to the API
npm run demo       # full app on fictional demo data – no Claude Code data needed
```

Before opening a pull request:

```bash
npm run check      # type checks (server + Svelte)
npm test           # unit tests and decoder snapshots
npm run build && npm run smoke   # builds, starts the CLI and checks the API
```

CI runs the same steps on macOS, Linux and Windows with Node 22 and 24.

## Calibrating the plan budgets

The share of the weekly limit and of the 5-hour window shown in the UI is based on the values in
`src/shared/budget.ts` (API list-price equivalent of a full limit per plan). Anthropic publishes no
dollar or token limits, so they are calibrated from real data:

1. Run `/usage` in Claude Code now and then – in the CLI, not the desktop app (only the CLI writes
   the readings into the transcripts). More readings at higher percentages give better numbers.
2. Collect the `~/.claude` directories of **all** machines that use the same account – the limit is
   per account, so usage elsewhere would otherwise be missing. For a server, e.g.:
   ```bash
   rsync -a --exclude=.credentials.json server:~/.claude/ ~/claude-server/.claude/
   ```
3. Run the calibration from a clone of this repository:
   ```bash
   npm run calibrate -- ~/.claude ~/claude-server/.claude
   ```
   It sums the API equivalent of every model response (each response once, across all directories),
   compares it with the `/usage` percentages and prints the dollar value of 100 % per period. A drop of
   the weekly percentage before its reset (plan change) starts a new period.
4. Put the new values for your plan into `PLANS` in `src/shared/budget.ts` and update
   `BUDGET_CALIBRATED`.

Users can also override the values for their own browser in the UI (*Budget* → *$…/week*).

## Project layout

```
src/shared/   domain types, tool summaries, price table (server + UI)
src/server/   formats/ (decoders + registry) · sources/ (files, processes, jobs, spawn linker)
              model/ (activity, timeline, CPU) · history/ (aggregator, search) · http.ts, inspector.ts
web/          Svelte 5 UI (pages/, components/, components/tools/ = per-tool renderers)
tests/        anonymized fixtures per Claude Code version, snapshots, tests
```

## Claude Code file formats

Claude Code's files under `~/.claude` are undocumented and change between versions. claude-inspect
detects the format **per record**: every decoder in `src/server/formats/` scores a raw record, the best
one decodes it into the types in `src/shared/types.ts`, and a fallback keeps anything unknown. Fields no
decoder knows show up on the *Formats* page (schema drift).

- New field in a known record → add it to the decoder's `*_FIELDS` list (and to the model if useful).
- New record type → often just an entry in `META_TYPES` (`formats/transcript/other.ts`), otherwise a new decoder.
- Incompatible change → a new decoder with its own id (`…@3`); keep the old one for older files.

Details (German): [docs/FORMATS.md](docs/FORMATS.md). To add fixtures from your own data, run
`npm run fixtures` (anonymizes them) and `npm run test:update` to refresh snapshots – please review the
fixture diff for anything private before committing.

## Ground rules

- **Read-only towards `~/.claude`.** No hooks, no settings changes, never read credential files.
- **Local only.** The server binds to `127.0.0.1`; no telemetry, no outbound requests.
- **Cross-platform.** Process and path handling must work on macOS, Linux and Windows.
- Keep pull requests focused; describe what you changed and how you tested it (screenshots for UI changes).
- Match the surrounding code style; the UI uses the CSS variables in `web/src/app.css` (light and dark mode).

By contributing you agree that your contributions are licensed under the [MIT license](LICENSE).
