# Data source responsibilities

Each source has one explicit responsibility. Research or enrichment failures must never replace a valid HKJC fixture with mock data.

| Purpose | Source | Runtime role |
| --- | --- | --- |
| Historical model training | Football-Data.co.uk | Offline CSV import only |
| Daily fixtures and Hong Kong prices | HKJC | Production authority |
| Live score, lineup and result gaps | ESPN, FotMob, TheSportsDB | Supplement HKJC fixtures only |
| Injuries and additional match statistics | API-Football | Optional future enrichment; disabled without a key |
| Cross-bookmaker price comparison | The Odds API | Optional market-consensus signal; never replaces HKJC prices |
| xG research | Manually exported FBref data | Offline research only |
| Automated website research | `soccerdata` | Experimental offline work only; never a production dependency |

## Football-Data workflow

1. Download a league and season CSV from <https://www.football-data.co.uk/data.php>.
2. Keep the raw file under `apps/api/data/raw/football-data/`. Raw files and generated databases are ignored by Git.
3. Import it from the workspace root:

```bash
npm run import:football-data -- \
  --file=apps/api/data/raw/football-data/E0-2025-26.csv \
  --league="Premier League" \
  --season=2025-26
```

The default output is `apps/api/data/historical/football-data.json`. Set `HISTORICAL_DB_PATH` or pass `--output=` to change it.

The importer requires settled full-time scores and accepts these optional Football-Data fields:

- Half-time result: `HTHG`, `HTAG`, `HTR`
- Shots: `HS`, `AS`, `HST`, `AST`
- Corners: `HC`, `AC`
- Cards: `HY`, `AY`, `HR`, `AR`
- 1X2 prices: Pinnacle closing, Bet365 closing, Pinnacle, Bet365, then market average
- Over/under 2.5 prices when present

Imports are idempotent by division, season, kickoff time and team names. Corrected source rows update the existing match rather than creating a duplicate.

Generate the leakage-safe model dataset after importing CSV files:

```bash
npm run build:historical-features
```

This writes `apps/api/data/historical/football-data-features.jsonl` and a neighboring metadata file. Each row contains:

- League rolling home/away goal, shot and corner baselines
- Home and away team rolling 5-match and 10-match metrics
- Venue-specific 10-match attack and defence metrics
- Prior-smoothed attack/defence strengths and Poisson expected goals
- De-vigged opening and closing probabilities plus their pre-match movement
- The match result in a separate `target` object

Rows are processed chronologically. All fixtures with the same kickoff timestamp are featurized before any result in that group is added to history. Poisson features default to ineligible until the league has 20 prior matches and each side has three prior matches in the relevant venue role.

Run the expanding-window model comparison with:

```bash
npm run eval:historical-models
```

The default folds train on all earlier seasons and test on the next untouched season. It compares:

- `current_model`: the production HAD probability formula using reconstructed pre-match fixtures
- `poisson`: the rolling attack/defence expected-goals distribution without market blending
- `ml_logistic`: a multinomial logistic baseline trained separately inside each fold

RPS, top-pick ECE, hit rate and flat-stake ROI are reported per fold, in aggregate, and by league, season and selected-odds bucket. ROI includes a deterministic month-block bootstrap 95% interval and chronological maximum drawdown. Each fold selects its EV threshold from `2%, 4%, 6%, 8%, 10%` using only an inner chronological validation window from the training period. If no adequately sampled threshold has positive validation ROI, that model is set to no-bet for the next test season. Override the candidates with `--ev-thresholds=0.02,0.04,0.06` and the minimum validation bet count with `--threshold-min-bets=50`. The output defaults to `apps/api/data/historical/model-benchmark.json`.

The benchmark also fits a time-decayed Dixon-Coles shadow challenger independently for each league and outer fold. It estimates league intercept, home advantage, low-score correlation (`rho`), and team attack/defence parameters from earlier seasons only. The default decay half-life is 365 days; use `--dc-half-life-days=180` and `--dc-epochs=250` to tune offline evaluation. Fitted parameters are stored under each fold's `dixonColesLeagueParameters`. The report fixes this model to `mode: "shadow"` and `productionEnabled: false`. Promotion requires out-of-sample RPS below the closing market, a positive ROI whose 95% confidence interval lower bound is above zero, and stable results across seasons and leagues.

## Model boundary

Historical rows must be transformed into chronological rolling features before entering a model. A prediction may only use matches played before that fixture's kickoff. Do not merge historical rows into recommendation learning history, because that history measures recommendations actually issued by this system.

Recommended activation gates for a league/team model:

- At least three complete seasons for the target league
- At least 15 prior matches for each team-level rolling estimate
- Walk-forward evaluation against the current baseline
- Better RPS and ECE without materially worse ROI

## Optional APIs

`API_FOOTBALL_API_KEY` and `THE_ODDS_API_KEY` are reserved configuration slots. They do nothing until an adapter is deliberately enabled. This prevents free quotas from being consumed by the normal 30-minute HKJC refresh.

Before enabling either source, add fixture identity mapping, request caching, quota accounting and provider-specific tests. HKJC remains authoritative for displayed prices even when The Odds API is used to estimate market consensus.

## FBref and soccerdata

Place manual FBref exports under `apps/api/data/raw/fbref/`. Keep notebooks, Python environments and scraper caches outside the production API runtime. Website layouts, access limits and usage terms can change, so `soccerdata` must remain an optional research tool rather than a startup dependency.