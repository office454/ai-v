# Corner prediction model

## Production inputs

The corner model only uses fields present on the matched HKJC fixture. HKJC remains authoritative for fixture identity, market lines and displayed prices. ESPN and FotMob may supplement live fields after exact team and kickoff matching.

| Signal | Source | Use |
| --- | --- | --- |
| Full-time and team corner lines | HKJC | Market total and home/away share baseline |
| Historical team corner averages and sample size | Settled learning history | Pre-match Poisson expectation when available |
| Current corners, score and official minute | HKJC, ESPN or FotMob fallback | Live pace and remaining-time update |
| Possession, dangerous attacks, final-third entries, crosses | ESPN or FotMob when both team values exist | Bounded home/away attacking-share adjustment |
| Team strength, recent form and venue form | Existing fixture model | Pre-match pressure and game-state context |
| Confirmed lineup roles | FotMob fallback | Lineup availability and attacking-role context |
| Player fitness and recent form | Existing data only when explicitly supplied | No default or inferred value is created |

## Calculation

Before kickoff, the web analysis blends the balanced HKJC full-time corner line, HKJC team corner lines and available historical averages into an expected total. The production recommendation engine uses a historical corner expectation for a Poisson probability when the relevant sample is present, blended with the existing market probability so sparse history cannot dominate.

For a total-corner line `L` and expected total `lambda`:

```text
P(X = k) = exp(-lambda) * lambda^k / k!
P(over L) = 1 - sum(P(X = k), k = 0..floor(L))
```

During a live match, the model requires an externally sourced official minute before using pace. It blends the pre-match rate with observed corners per minute, projects only the remaining interval, and applies a bounded game-state multiplier:

- Stronger team trailing after minute 45: remaining corner rate `+12%`
- Stronger team leading by at least two after minute 45: remaining corner rate `-10%`
- Other non-level second-half score: remaining corner rate `+4%`
- Otherwise: no game-state rate adjustment

The current total is never reduced. Poisson is then applied to the expected number of additional corners. Available live attacking metrics adjust the home/away allocation with bounded weight; possession alone has only 5% of the attacking-share signal weight.

## Data integrity rules

- Never estimate a live minute from a status such as `SECONDHALF`.
- Never create dangerous attacks, crosses, possession, player fitness or player form values.
- Only save a live metric when both home and away values parse successfully.
- Keep source attribution (`ESPN` or `FotMob`) with live attacking metrics.
- Treat HKJC team corner lines as a market proxy for attacking share, not as measured tactical width.
- Do not use a missing field as zero.

## Missing data

| Missing or incomplete input | Current limitation | Required next source or dataset |
| --- | --- | --- |
| Stable dangerous-attacks feed | ESPN/FotMob may omit it and definitions can differ | Licensed event provider with a documented, consistent definition |
| Total and successful crosses with timestamps | Provider payloads may expose only one aggregate or neither | Event-level cross feed, including side, minute and outcome |
| Final-third possession and entries | Optional and not available for every competition | Competition-complete tracking/event feed |
| Tactical width and flank attack share | HKJC team corner lines are only a proxy | Tracking data or event locations for attacks and crosses |
| Formation changes and overlapping full-back runs | Starting role does not describe in-match movement | Formation timeline and player-location events |
| Low-block classification | Strength gap and score are indirect proxies | Defensive-line height, pressure and field-position data |
| Verified player fitness and recent player form | FotMob lineup payload does not provide these values | Injury/availability feed plus player match-performance history |
| Event timestamps for each corner | Only cumulative corner totals are available | Event timeline for point-process or hazard modelling |
| Long, league-complete corner history | Current learning history can be sparse and selection-biased | Multi-season match dataset with home/away corners for all fixtures |
| Historical attacking metrics | Live shares cannot yet be calibrated against corner outcomes | Archived dangerous attacks, final-third entries and crosses |
| Opening and closing corner prices | The Odds API checkpoint adapter currently captures `h2h` only | Bookmaker API coverage for corner markets or a licensed odds archive |
| Out-of-sample corner calibration report | Current historical benchmark targets 1X2 models | Chronological corner-market dataset and walk-forward Brier/log-loss/ROI evaluation |

Until the final two training requirements are met, live attacking metrics remain bounded supporting signals rather than independently learned coefficients. Production promotion of stronger corner parameters should require chronological out-of-sample calibration and ROI confidence intervals, following the same policy as the existing model challengers.
