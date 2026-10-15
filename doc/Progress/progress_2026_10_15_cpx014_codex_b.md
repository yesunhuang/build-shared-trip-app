# Progress report - Codex B, checkpoint 014

- Date: 2026-10-15 UTC.
- Agent: Codex B.
- Status: complete; implementation and local acceptance complete, deployment outside this assignment.
- Approximate active time: 70 minutes.
- Implementation commit: `8e93bb5da64c54587e995ed7103a061fb48668dd`.

## Scope and coordination

Read current instructions and the latest reports. Checkpoint 013's comment contained no new directive, and no local continuation prompt or active handoff branch was found. Canonical main was current at `d3789534b246e1f94c283b7f0bf80b62f2f3d277`. Existing map/card callbacks were retained and extended rather than replaced; no equivalent place-search implementation was present. Unrelated local edits and existing processes were preserved.

`server/lookups.mjs` adds explicit, editor-only place and photo search, disabled by default. Provider requests are serialized at least 1,100 ms apart, with a bounded queue, per-account limit, timeout, response-size limits, and a private persistent cache bounded to 500 entries and 8 MiB. Known tracking parameters are removed from image URLs; arbitrary hosts, query parameters and redirects remain refused.

`server/domain/validate.mjs` and `service.mjs` share selected-place and managed-photo validation across HTTP, MCP and import. Selected coordinates and addresses are saved with provenance and attribution. Existing IDs, version conflicts and durable retries remain intact. Older photo records retain their metadata. No SQLite schema change is required.

`assets/app-template/public/` adds candidate comparison, explicit selection, saved previews, Search/Refresh, staged clear/remove actions, credits, coordinate navigation and matching marker/card highlights. Opening, rendering, polling, typing and unrelated saves perform no place/photo search. Four-language copy and the phone planner are preserved. `docs/` was regenerated from the shared source. Contracts, provider research and optional Compose settings are documented in `references/place-and-photo-lookups.md` and related guides.

## Provider choice and cost

Use OpenStreetMap/Nominatim-compatible place data and reusable Wikimedia Commons photos, with saved attribution. Public endpoints require no paid API account or key; hosting, image bandwidth and service limits still apply. Nominatim use requires identifying requests, caching, moderate usage, no autocomplete or bulk jobs, and no confidential query material. Its policy must be reviewed before enabling. [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/), [OSM licence](https://www.openstreetmap.org/copyright), [Commons reuse](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia).

Google was evaluated against current primary sources. Global Text Search Pro includes 5,000 monthly calls, then $32 per 1,000 at the first paid tier; Place Details Photos includes 1,000, then $7 per 1,000. Places coordinate retention is limited to 30 days, and Places content cannot accompany this non-Google map. Those restrictions do not meet indefinite update-only storage. The full comparison includes other relevant SKUs and photo restrictions. [Google pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [service terms](https://cloud.google.com/maps-platform/terms/maps-service-terms).

## Acceptance evidence

| Check | Actual outcome |
| --- | --- |
| Full regression | `npm test` passed, exit 0, about 79 seconds, including the new backend and picker suites. |
| Generation | `node scripts/build-docs-demo.mjs` passed. Fresh fictional generation outside the checkout and `scripts/qa-static.mjs` passed. |
| Backend, mocked providers | Real local HTTP and official MCP SDK checks passed: role and origin denials, strict input, query caching/refresh, rate/queue limits, failures/timeouts, selected-data writes, isolation, atomic refusal, conflicts/retries, import/export, restart and validated snapshot/restore. Legacy records and the unchanged schema were verified with fictional data. |
| Real providers | The integrated local API returned 200 with one place candidate and five reusable photo candidates. Repeating the place query, including after restart, added zero provider requests. Public research queries only; no private itinerary was used. |
| Browser | Chrome at 1280 x 900, 390 x 844 and 375 x 812 passed relevant editor/planner interactions and overflow checks. All four languages were checked, including reopening after a language change. Save/Cancel, coordinate links, two-way selection and keyboard sheet resizing worked. Actual map tiles and a credited remote image loaded; the provider returned a 960-pixel thumbnail for the requested 640-pixel width. |
| Browser request counts | Lookup responses were mocked in the browser fixture, while mutations used the real local service. Initial view/editor/typing made zero search requests. Six explicit searches, including cached repeats and Refresh, produced three mock upstream calls. Reloads, language changes, polling, image failure and an unrelated edit added none. The unrelated edit preserved a legacy photo exactly. |
| Publication | Compose `config --quiet`, whitespace checks, changed-document local link paths and framework privacy auditing with an external private denylist passed. Actual outgoing content and neutral Git metadata were reviewed. |

Browser screenshots are fictional, private local evidence, not public repository artifacts. Phone widths are desktop browser emulation. Physical-phone gestures and installation, production egress and deployment remain unverified for this feature.

## Corrections and delegation

Restricted file-only Claude helpers worked from public exports using verified `claude-opus-5-5`. They implemented the backend, UI, tests and documentation. A later capacity failure prevented another helper pass; Codex completed focused integration corrections without retrying that route.

Acceptance caught and corrected legacy photo rejection, oversized Unicode caches being discarded on restart, the current Commons thumbnail-host/tracking format, and retained picker labels after language changes. Test instrumentation now accounts for aborted mock requests, waits for rendered home cards, and accelerates polling without shortening HTTP deadlines. A synthetic negative-test key was adjusted to the existing privacy-test convention. The final suite passes.

## Current state and next action

The committed feature is ready for operator setup and a separately authorized deployment. Supply the private identifying User-Agent/contact and review provider policies before enabling `SHARED_TRIP_LOOKUPS_ENABLED=1`. The base Compose network remains internal; an existing or deliberately configured outbound HTTPS route is needed. Saved data renders while lookups are disabled. The six MCP tools retain their existing authority and can save these snapshots; lookup search is HTTP-only.

No live deployment, real-data migration, billing setup or live access change occurred. No design decision blocks the completed implementation.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
