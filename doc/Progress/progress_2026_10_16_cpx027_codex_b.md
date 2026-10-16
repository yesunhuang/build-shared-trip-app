# CP027 — Recoverable weather loading

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: complete — implemented, tested, published and deployed
- Approximate active time: 45 minutes
- Source and deployed commit: `7cb3498d54f72b5c2acd9e1b0d98d538e0ef1a62`
- Main implementation: `50ddffdf2691c46aae60589dd0f74d9f1bf74b9a`; final message-layout correction: `7cb3498`
- Baseline: [CP026](progress_2026_10_16_cpx026_codex_b.md), `b83bdc0`

## Findings and changes

Continued the authorized weather regression assignment after checking main, the worker handoff and current instructions. CP026 had no additional actionable comment. The unrelated ignore-file edit was preserved. The established Claude capacity blocker remained; Codex used the documented fallback, with no helper execution claimed.

Controlled reproduction against the prior code confirmed three defects: the request deadline ended before response-body parsing, caller cancellation stopped reaching that parsing stage, and null measurements became zero. The former ten-second deadline also left little margin for slower responses. A two-point public-coordinate request in actual Chrome returned HTTP 200 with valid sixteen-day data in 215 ms. The reported phone request trace was unavailable, so its exact failure remains unverified; timeout is a plausible contributor, not an established device diagnosis.

`assets/app-template/public/weather-forecast.js` now keeps a thirty-second deadline and cancellation active through headers, body parsing and validation. It distinguishes timeout, cancellation, offline, blocked/network fetch, HTTP, rate limit, invalid response and empty response. Browser fetch failures alone cannot establish CORS as the cause.

Transient failures receive at most three attempts per batch, with 1.5- and 4-second backoff. Only failed points are retried. Long provider retry delays end the automatic cycle; manual retry respects those delays, an ordinary five-second cooldown and a five-minute automatic failure cooldown. Renders cannot launch overlapping retry cycles. Unambiguous partial results and usable same-point forecasts survive failed refreshes; trip changes clear forecast memory. Forecasts remain memory-only.

Missing, null, nonnumeric and nonfinite measurements stay missing; valid zeroes remain zero. Daily and hourly data are independent, and ambiguous location IDs cannot overwrite another point. Request identity includes the trip-local date, preserving local-midnight reactivity and stale-response rejection. The [official Open-Meteo documentation](https://open-meteo.com/en/docs) specifies up to sixteen forecast days, timezone-local timestamps and coordinate-batch responses; the existing date window and provider remain.

`app.js` keeps every date visible during loading and outages, offers native Retry weather, and separates request failures, missing coordinates, explicit off, partial measurements and out-of-window dates. Authorized editors retain automatic/manual/off controls during an outage. Template styles and four-language copy were updated. Browser acceptance caught clipped per-day messages; the final correction makes them wrap. README, `references/weather-association.md` and fictional `docs/` match the behavior.

## Evidence

| Check | Actual result |
| --- | --- |
| Final `npm test` | Passed, exit 0, 162 seconds, including server/HTTP/MCP, roles, conflicts, persistence, weather, links and allowance regressions |
| Deterministic weather tests | Slow headers/body, parsing deadline and cancellation, malformed/empty/partial/null payloads, 429/5xx, offline/network categories, bounded retries, cooldowns, late bodies, trip isolation, local-midnight boundaries and mixed horizon/off states passed with injected clocks/fetch |
| UI simulation | Four-language viewer/editor outage cases, manual retry, missing measurements, null-safe multi-area aggregation and hourly fallback passed at desktop/phone dimensions |
| Generation/privacy | Demo regeneration and fresh disposable fictional generation/static QA passed; framework privacy with the external denylist and actual outgoing diff review passed |
| Production image | Focused weather association/resilience, weather server, related-link and map-link suites passed in isolated Linux containers; server, authentication, mutations and Google modules were unchanged |
| Actual Chrome, mocked provider | Main candidate recovered from separate twelve-second header and body delays; retained usable data after partial/malformed responses; three-attempt 503 cycle and one-attempt 429 with disabled retry passed. Final image passed desktop 1280×900 and phone-width 390×844 error wrapping, manual controls, native keyboard retry recovery and separate horizon notice |
| Fixture preservation | Both fictional trip versions stayed unchanged; automatic/off/explicit weather choices, original image and links remained intact. Google, place/photo search and trip-write counters stayed zero |

Reviewed fictional previews: [desktop outage states](../evidence/cp027-weather-desktop.jpg), [phone-width recovered forecast and horizon](../evidence/cp027-weather-phone.jpg). Phone dimensions are browser emulation. Physical-phone behavior and the owner's original failing request remain unverified. The one public provider probe was live; resilience and interactive acceptance responses were controlled fixtures.

An older static-QA assertion expected the previous aggregation expression. It was updated for null-safe aggregation, whose actual behavior is covered by the UI suite. Final full regression and fresh generation were repeated after the layout correction.

## Deployment and preservation

Fresh online and stopped-state backups restored in isolation under the new and retained prior images, with all eleven application tables matching exactly. A fictional new/prior/new read/write round trip preserved weather choices, photos, links and later edits. Photo archives and off-host database/photo copies passed digest checks. The separate allowance snapshot was retained as evidence only.

Only the application image tag changed. After cutover, every live database row matched the stopped-state snapshot exactly: trip IDs, versions, content, weather choices, Google flags and authentication/access/revocation records were preserved. Photos matched their fingerprint. The allowance ledger retained its file identity, rows and counts. Credentials and existing Google configuration stayed unchanged; acceptance used no Google requests or real trip edits.

Seventeen served assets matched the committed source. Public and direct-origin HTTPS health, eleven no-store/anonymous access-boundary checks and quiet Compose validation passed. The application port remained private; existing proxy/gateway containers were unchanged. The prior image/configuration and validated backups remain recoverable. Rollback needs no schema migration and must preserve later edits and allowance usage.

Owned acceptance containers, tunnels, baseline helper and fixture tabs were removed; viewport overrides were reset. No persistent live test trip was created. The rollout is complete. The smallest useful follow-up is a normal physical-phone retry; a remaining failure would need its request outcome and timing to distinguish network, provider and parsing behavior.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
