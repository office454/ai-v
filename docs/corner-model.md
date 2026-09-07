# Corner prediction model

## Production inputs

The corner model only uses fields present on the matched HKJC fixture. HKJC remains authoritative for fixture identity, market lines and displayed prices. Highlightly, ESPN and FotMob may supplement live fields after exact team and kickoff matching.

| Signal | Source | Use |
| --- | --- | --- |
| Full-time and team corner lines | HKJC | Market total and home/away share baseline |
| Historical team corner averages and sample size | Settled learning history | Pre-match count expectation when available |
| Current corners, score and official minute | HKJC, Highlightly, ESPN or FotMob fallback | Live pace and remaining-time update |
| Possession, dangerous attacks, final-third entries, crosses | Highlightly, ESPN or FotMob when both team values exist | Bounded home/away attacking-share adjustment |
| Yellow cards, red cards and substitution counts | Highlightly, ESPN or FotMob when bilateral values/events exist | Red-card difference adjusts corner share by at most 8%; other counts are retained but not assumed tactical |
| Team strength, recent form and venue form | Existing fixture model | Pre-match pressure and game-state context |
| Confirmed lineup roles | Highlightly or FotMob fallback | Lineup availability and attacking-role context |
| Player fitness and recent form | Existing data only when explicitly supplied | No default or inferred value is created |

## Calculation

Before kickoff, the web analysis blends the balanced HKJC full-time corner line, HKJC team corner lines and available historical averages into an expected total. The production recommendation engine uses the same calibrated count distribution for corner totals, blended with the existing market probability so sparse history cannot dominate.

The preferred pre-match distribution is Negative Binomial (NB2), calibrated from 15,867 corner-complete historical matches. Nine competitions have explicit league parameters. League matching is strict; unsupported competitions fall back to Poisson rather than borrowing a parameter from a similar league.

```text
E[X] = mu
Var(X) = mu + alpha * mu^2
P(over L) = 1 - P(X <= floor(L))
```

This retains the full count distribution and gives more probability to clustered high-corner outcomes than a same-mean Poisson model. Displayed probabilities also expose decimal fair odds, `1 / model probability`, and expected value, `model probability * HKJC odds - 1`. HKJC remains the displayed price and market authority.

During a live match, the model requires an externally sourced official minute before updating pace. A Gamma prior represents the pre-match corner rate over 95 minutes. Observed corners update that rate conjugately, and the posterior predictive for the remaining interval is Negative Binomial:

```text
prior shape = pre-match expected corners
prior exposure = 95 minutes
posterior shape = prior shape + observed corners
posterior exposure = 95 + elapsed minutes
expected remaining = posterior shape * remaining minutes / posterior exposure
predictive dispersion = 1 / posterior shape
```

This Bayesian shrinkage prevents a quiet opening spell from forcing the remaining expectation to zero. A bounded game-state multiplier is then applied:

- Stronger team trailing after minute 45: remaining corner rate `+12%`
- Stronger team leading by at least two after minute 45: remaining corner rate `-10%`
- Other non-level second-half score: remaining corner rate `+4%`
- Otherwise: no game-state rate adjustment

The current total is never reduced. Available live attacking metrics adjust the home/away allocation with bounded weight; possession alone has only 5% of the attacking-share signal weight. A verified red-card difference shifts the home/away corner share by at most 8%. Yellow cards and generic substitution counts do not change the prediction because they do not establish tactical intent.

## Data integrity rules

- Never estimate a live minute from a status such as `SECONDHALF`.
- Never create dangerous attacks, crosses, possession, player fitness or player form values.
- Only save a live metric when both home and away values parse successfully.
- Keep source attribution (`Highlightly`, `ESPN` or `FotMob`) with live attacking and pressure metrics.
- Treat HKJC team corner lines as a market proxy for attacking share, not as measured tactical width.
- Do not infer that a substitution introduces a target striker without player identity, role and event minute.
- Do not apply a calibrated dispersion parameter to an unrecognized league.
- Do not use a missing field as zero.

## Missing data

| Missing or incomplete input | Current limitation | Required next source or dataset |
| --- | --- | --- |
| Stable dangerous-attacks feed | ESPN/FotMob may omit it and definitions can differ | Licensed event provider with a documented, consistent definition |
| Total and successful crosses with timestamps | Provider payloads may expose only one aggregate or neither | Event-level cross feed, including side, minute and outcome |
| Final-third possession and entries | Optional and not available for every competition | Competition-complete tracking/event feed |
| Tactical width and flank attack share | HKJC team corner lines are only a proxy | Tracking data or event locations for attacks and crosses |
| Formation changes and overlapping full-back runs | Starting role does not describe in-match movement | Formation timeline and player-location events |
| Tactical role of substitutions | Current feeds can establish substitution counts, not whether a target striker or defensive player entered | Event-level substitutions joined to player positions and lineup roles |
| Low-block classification | Strength gap and score are indirect proxies | Defensive-line height, pressure and field-position data |
| Verified player fitness and recent player form | FotMob lineup payload does not provide these values | Injury/availability feed plus player match-performance history |
| Event timestamps for each corner | Only cumulative corner totals are available | Event timeline for point-process or hazard modelling |
| League-complete corner history outside nine calibrated competitions | Unsupported leagues deliberately use Poisson | Multi-season match dataset with home/away corners for each additional competition |
| Historical attacking metrics | Live shares cannot yet be calibrated against corner outcomes | Archived dangerous attacks, final-third entries and crosses |
| Opening and closing corner prices | The Odds API checkpoint adapter currently captures `h2h` only | Bookmaker API coverage for corner markets or a licensed odds archive |
| Out-of-sample corner calibration report | Current historical benchmark targets 1X2 models | Chronological corner-market dataset and walk-forward Brier/log-loss/ROI evaluation |

Until the final two training requirements are met, live attacking metrics remain bounded supporting signals rather than independently learned coefficients. Production promotion of stronger corner parameters should require chronological out-of-sample calibration and ROI confidence intervals, following the same policy as the existing model challengers.
