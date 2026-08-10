# HK Football Value Picks Dashboard

This project provides a full-stack baseline for analyzing daily football betting opportunities with lineup refresh 20 minutes before kickoff.

## What it does

- Ingests daily fixtures from pluggable data providers (HKJC page parser + mock fallback)
- Aggregates signals: team strength, player form, recent performance, expert sentiment, and odds movement
- Evaluates all available betting options per fixture and selects the highest-success-probability option
- Scores each market by expected edge and value score with configurable model weights
- Re-checks lineup and rescoring around 20 minutes before kickoff
- Supports backtesting from CSV import and JSON DB persistence
- Displays recommendations on a web dashboard
- Auto-learns after matches finish: settles outcomes, finds blindspots, and applies risk correction to future picks

## Important compliance note

- The HKJC site may use dynamic delivery and anti-automation controls. If parsing returns no fixtures, the API automatically falls back to mock mode.
- For production usage, use officially authorized feeds and ensure terms/regulatory compliance.
- The GraphQL endpoint is reachable, but query schema/fields can change. Use your own observed query and keep request frequency low.
- Follow site terms and robots guidance, and avoid high-frequency polling that may create server load.

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

Use only the root `.env` file. The API is configured to load environment variables from workspace root.

3. Run API + Web (stable single entry):

```bash
npm run dev
```

`npm run dev` now performs an automatic cleanup of stale local processes on ports `8787` and `5180`, then starts API + Web together. Use this as the only local launch command to avoid duplicate dev instances and `EADDRINUSE` issues.

- API: http://localhost:8787
- Web: http://localhost:5180

## Current status

- Workspace scaffolded and validated with lint, test, and build
- VS Code task `dev: fullstack (web:5180)` is created and running
- HKJC provider is active by default with automatic mock fallback
- Supports TheSportsDB as an alternative soccer data provider for model practice

## Debug/launch

- Use only VS Code Task: `dev: fullstack (web:5180)` for local launch.
- This task runs the stable entrypoint with auto-clean and startup healthcheck:
	- API check: `http://localhost:8787/api/health`
	- Web check: `http://localhost:5180/`
- For debug mode, add your preferred launch configuration targeting:
	- API entry: `apps/api/src/server.ts`
	- Web dev server: Vite in `apps/web`

## Scripts

- `npm run dev`: stable fullstack start (auto-clean + run both apps)
- `npm run dev:raw`: run both apps without auto-clean
- `npm run build`: build both apps
- `npm run lint`: lint both apps
- `npm run test`: run API tests

## API endpoints

- `GET /api/recommendations`: latest fixture + recommendation snapshot
- `POST /api/recommendations/refresh`: force lineup-window refresh and rescoring
- `GET /api/model/weights`: read active scoring weights
- `PUT /api/model/weights`: update scoring weights (partial payload supported)
- `GET /api/model/thresholds`: read odds-filter/high-odds thresholds
- `PUT /api/model/thresholds`: update odds-filter/high-odds thresholds
- `GET /api/model/data-source`: read current data-source health (provider, odds availability, last error)
- `POST /api/model/data-source/snapshot`: save a HKJC JSON snapshot and optionally activate snapshot mode for the current API process
- `GET /api/model/practice`: read the latest practice cycle and assistant insight
- `POST /api/model/practice/trigger`: manually trigger one practice + assistant cycle (protected by localhost or token)
- `GET /api/model/learning`: read learning summary (recent hit rate, blindspots, correction profile)
- `GET /api/model/learning/history`: list learning recommendation history and final result; supports `market`, `status`, `limit`
- `POST /api/model/learning/settle-backfill`: trigger pending learning settlements with fixture-id backfill
- `GET /api/model/auto-training`: read background training progress (last added, total auto records, recent hit rate)
- `POST /api/backtest/csv`: replace backtest DB with CSV file
- `POST /api/backtest/records`: append manual backtest records
- `GET /api/backtest/summary`: get ROI/hit-rate summary from DB

## Frontend learning summary

Homepage now shows a learning summary panel with:

- Recent 20 settled picks hit rate
- Biggest blindspot market (lowest hit-rate market with enough sample)
- Current correction strength (average and max active penalty)

For local development, this is fetched from `/api/recommendations` snapshot.
For cloud deployment with separated domains, set web env `VITE_API_BASE_URL` to your API public URL.

## Deploy for mobile access (recommended: Railway + Vercel)

This setup gives you a permanent HTTPS URL usable on mobile.

### Ready-made platform files included

- Railway config: `railway.json`
- Vercel config: `apps/web/vercel.json`

### 1) Deploy API (Railway)

1. Push repo to GitHub.
2. In Railway, click **New Project** -> **Deploy from GitHub Repo**.
3. Select this repo and deploy.
4. Railway will auto-use `railway.json` at repo root.
5. In Railway service **Variables**, add at least:
	- `DATA_PROVIDER`
	- `HKJC_GRAPHQL_ENDPOINT`
	- `HKJC_GRAPHQL_REFERER`
	- `HKJC_QUERY_VERSION`
	- `HKJC_GRAPHQL_QUERY`
	- `HKJC_GRAPHQL_VARIABLES_JSON`
	- `HKJC_MIN_REQUEST_INTERVAL_MS`
	- `MIN_RECOMMENDED_ODDS`
	- `HIGH_ODDS_THRESHOLD`
	- `HIGH_ODDS_MIN_EDGE_SCORE`
	- `HIGH_ODDS_MIN_VALUE_SCORE`
	- `PERSISTENT_DATA_DIR=/data/ai-v`
	- `BACKTEST_DB_PATH=/data/ai-v/backtest-db.json`
	- `LEARNING_DB_PATH=/data/ai-v/learning-db.json`
	- `MODEL_SETTINGS_PATH=/data/ai-v/model-settings.json`
6. In Railway service **Volumes**, mount a persistent volume to `/data`.
7. The API will auto-seed missing state files from bundled defaults on startup:
	- `learning-db.json`
	- `backtest-db.json`
	- `model-settings.json`
8. For CORS, set:
	- `CORS_ORIGIN=https://<your-web>.vercel.app`
	- `CORS_ORIGIN_REGEX=^https://.*\\.vercel\\.app$`
9. Open generated Railway domain and confirm:
	- `https://<your-api>.up.railway.app/api/health`

### 2) Deploy Web (Vercel)

1. In Vercel, click **Add New...** -> **Project** -> import same GitHub repo.
2. Set **Root Directory** to `apps/web`.
3. Vercel will read `apps/web/vercel.json`.
4. In Vercel **Environment Variables**, add:
	- `VITE_API_BASE_URL=https://<your-api>.up.railway.app`
5. Deploy.

### 3) Cross-origin final check

1. Redeploy API once after Vercel domain is final.
2. Open web URL on mobile.
3. Verify homepage can load:
	- Top 5 recommendations
	- Learning summary panel

### Production env notes

- API reads platform `PORT` automatically when `API_PORT` is not set.
- API supports multi-origin CORS via:
  - `CORS_ORIGIN` (primary)
  - `CORS_ADDITIONAL_ORIGINS` (comma-separated)
  - `CORS_ORIGIN_REGEX` (for preview domains)
- Web API endpoint is configurable via `VITE_API_BASE_URL`.

## HKJC GraphQL mode

- Set `DATA_PROVIDER=hkjc_graphql`.
- Set `HKJC_QUERY_VERSION` for your current query batch (for example `devtools-2026-07-14`).
- Provide `HKJC_GRAPHQL_QUERY` and optional `HKJC_GRAPHQL_VARIABLES_JSON` from your own browser network observation.
- Use `HKJC_MIN_REQUEST_INTERVAL_MS` to enforce polite throttling (minimum 3000 ms).
- If GraphQL parsing fails, server startup tries HKJC HTML, then falls back to mock provider.
- Use `GET /api/model/data-source` to verify `hasCurrentOdds=true` before trusting recommendations.

To enable full market-option analysis (all bet types), use the detailed GraphQL request that returns `foPools -> lines -> combinations -> selections`. If query does not return `foPools`, system logs a warning and uses HAD fallback data.

## HKJC snapshot mode

- Set `DATA_PROVIDER=hkjc_snapshot` to read HKJC data from a local JSON snapshot instead of replaying live GraphQL.
- Configure `HKJC_SNAPSHOT_PATH` to point at the snapshot file location.
- Supported snapshot shapes:
	- one raw GraphQL response object with `data`
	- `{ "matches": [...] }`
	- an array of batch GraphQL payloads, for example multiple odds-type requests captured from DevTools
- You can also `POST /api/model/data-source/snapshot` with JSON body `{ "snapshot": <your payload>, "activate": true }`.
- When `activate=true`, the running API immediately switches to `hkjc_snapshot` for the current process. To keep that behavior after restart, also set `DATA_PROVIDER=hkjc_snapshot` in `.env`.

## Daily practice and OpenRouter review

The API also runs a practice cycle every 4 hours that replays the main HKJC source plus external practice sources such as TheSportsDB.

What it does:

- Refreshes practice sources every 4 hours
- Runs the same scoring and backtest cycle against practice data
- Stores practice records separately from auto-training records
- Sends the latest practice and learning context to OpenRouter when `OPENROUTER_API_KEY` is configured; otherwise falls back to a local conservative review
- Optionally applies small weight and threshold corrections when `OPENROUTER_AUTO_APPLY=true`

Control with env:

- `PRACTICE_ENABLED=true` (default)
- `PRACTICE_SCHEDULE=0 */4 * * *` (default every 4 hours)
- `PRACTICE_TIMEZONE=Asia/Hong_Kong`
- `PRACTICE_INCLUDE_THESPORTSDB=true` (default)
- `OPENROUTER_ENABLED=true` to keep the review pipeline active
- `OPENROUTER_API_KEY=...` to turn on actual OpenRouter review
- `OPENROUTER_MODEL=openai/gpt-4o` to choose the model
- `OPENROUTER_FALLBACK_MODELS=model-a,model-b` to try backup models automatically when the primary model is rate-limited or unavailable
- `OPENROUTER_RECOMMENDATION_CONSENSUS_ENABLED=true` to let AI review the model shortlist before final recommendations are published
- `OPENROUTER_RECOMMENDATION_CONSENSUS_CANDIDATE_LIMIT=8` to control how many model-picked candidates enter the AI consensus step
- `OPENROUTER_REFERER=http://localhost:5180` to identify your app
- `OPENROUTER_TITLE=HK Football Value Picks Dashboard` to label requests
- `OPENROUTER_AUTO_APPLY=false` to keep AI suggestions advisory only

Use `GET /api/model/practice` to inspect the latest practice results and assistant insight.

Recommendation thresholds are configurable in root `.env`:

- `MIN_RECOMMENDED_ODDS` (default `2.0`): strict low-odds floor to avoid treating 1.x lines as priority picks.
- `HIGH_ODDS_THRESHOLD` (default `2.2`): odds line for entering the high-odds review bucket.
- `HIGH_ODDS_MIN_EDGE_SCORE` (default `2.2`): high-odds picks must have `edgeScore >= this value`.
- `HIGH_ODDS_MIN_VALUE_SCORE` (default `0.07`): high-odds picks must have `valueScore >= this value`.

The API validates required `.env` fields at startup and prints a friendly, field-by-field error list if any required value is missing or invalid.

## TheSportsDB practice mode

If you want the model to learn/practice with TheSportsDB football data, set:

- `DATA_PROVIDER=thesportsdb`
- `THESPORTSDB_API_KEY=123` (free key) or your premium key
- `THESPORTSDB_LEAGUE_IDS=4328,4335,4332` (comma-separated league IDs)

Provider behavior in this mode:

- Fetches upcoming + recent league events from TheSportsDB v1 schedule endpoints
- Maps events into internal fixtures for recommendation engine input
- Uses recent match results to estimate team form and derive practice odds/features

### Automatic background training (no manual trigger required)

The API now runs auto-training in background jobs:

- After scheduled fixture refresh (every 30 minutes)
- During pre-kickoff lineup refresh windows

What it does automatically:

- Uses settled fixtures (with final score) to generate model-vs-result training records
- Writes deduplicated records into backtest DB with source `auto`
- Lets learning and backtest summaries evolve continuously without manual uploads

Control with env:

- `AUTO_TRAINING_ENABLED=true` (default)

## External enrichment and source whitelist

The assistant review pipeline can enrich recommendations with external news, injury updates, and weather signals. To improve source reliability, domain whitelists are configurable.

Control with env:

- `ENRICHMENT_ENABLED=true` to enable external enrichment collection
- `ENRICHMENT_MAX_RECOMMENDATIONS=3` to control how many top picks are enriched each run (1-5)
- `ENRICHMENT_NEWS_SOURCE_WHITELIST=fifa.com,uefa.com,the-afc.com,premierleague.com,bundesliga.com,laliga.com,ligue1.com,bbc.com,skysports.com,espn.com`
- `ENRICHMENT_INJURY_SOURCE_WHITELIST=premierinjuries.com,physioroom.com,transfermarkt.com,fifa.com,uefa.com,bbc.com,skysports.com,espn.com`

### Manual practice trigger security

`POST /api/model/practice/trigger` is protected with either localhost access or token auth.

Control with env:

- `PRACTICE_TRIGGER_ALLOW_LOCALHOST=true` allows local loopback callers (`localhost`, `127.0.0.1`, `::1`)
- `PRACTICE_TRIGGER_TOKEN=` optional token for remote trigger access

Production recommendation:

- Set `PRACTICE_TRIGGER_ALLOW_LOCALHOST=false`
- Set a strong `PRACTICE_TRIGGER_TOKEN`
- Trigger with either header:
	- `x-practice-trigger-token: <token>`
	- `Authorization: Bearer <token>`

Example:

```bash
curl -X POST "https://<your-api>.up.railway.app/api/model/practice/trigger" \
	-H "Authorization: Bearer <PRACTICE_TRIGGER_TOKEN>"
```

## CSV backtest format

Required headers:

- `fixtureId`
- `market` (`homeWin`, `draw`, `awayWin`)
- `odds`
- `modelProbability`
- `stake`
- `result` (`win` or `loss`)
- `placedAt` (ISO timestamp, optional)

Sample file is available at `apps/api/data/sample-backtest.csv`.

## Next integration steps

- Implement real providers under `apps/api/src/providers`
- Add bookmaker-specific odds normalization
- Plug in lineup source with confidence scoring
