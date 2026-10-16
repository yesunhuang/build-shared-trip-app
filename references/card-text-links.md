# Card text links

Plan cards project safe links into a separate compact group of labelled, locally drawn icon
anchors. Saved `relatedLinks` appear first in their saved order, followed by links from review,
description and notes in field/text order. Identical validated serialized destinations share one
action; distinct explicit labels are retained in encounter order. Query order, fragments and encoded
path semantics are not rewritten. An unlabelled raw URL uses its actual serialized hostname.

This projection never writes trip data. Clearly trailing link-only runs after a complete sentence
or line are lifted out; meaningful inline labels remain plain prose words, and sentence punctuation
stays intact. Malformed or unsafe constructs remain literal. Parsing retains the existing input,
label, URL and per-field link bounds. Other card types keep their existing inline-link renderer.

The location/address has its own map-icon row with native Maps anchors and the existing destination
selection rules. Multiple destinations stay separately labelled and omitted locations stay inert.
The row replaces an identical footer Maps action; a matching related-link label accompanies that
same location action. No icons, favicons or metadata are fetched, and the six-link editor is unchanged.

Traveler card text can contain native links. No HTML is parsed. The bounded parser is
`assets/app-template/public/text-links.js`; plan presentation is in `card-link-presentation.js`.

## Where it applies

| Rendered text | Source field (after localization) | Element / class (unchanged) |
| --- | --- | --- |
| Plan review | `slot.review` (and its `i18n.<lang>.review` patch) | `p.timeline-card__review` |
| Plan description | `slot.description` (and patch); omitted when it repeats the review | `p.timeline-card__description` |
| Plan notes | `slot.notes` (and patch) | `p.note-line` |
| Plan location line | `slot.address` (and patch), or explicit place label | `div.plan-location` |
| Recommendation description | `recommendations.*[].description` | `p.recommendation-card__description` |
| Flight segment detail (legacy seed `flightBookings`) | `segment.detail` | `p.muted` |
| Hotel option note | `hotelAreas[].options[].note` | `p.muted` |

Headings, titles, chips, inputs, editor fields, day summaries/tips, guide notes, place-source and photo-credit lines are not linkified. Ordinary text remains text, including HTML-looking content.

## Location line

The address uses `googleMapsDestinations(slot, { allowNameFallback: true })` with the ordinary search fallback enabled. A saved validated destination or selected-place coordinate URL is preferred and matches the existing map action. If no destination is saved, the name/address forms an encoded ordinary Maps search URL. This constructs a navigation URL only, without a Places request or invented Place ID.

- Verified stored Google Maps URL (`normalizeGoogleMapsUrl`): linked.
- Selected OpenStreetMap place with saved coordinates: linked to the existing coordinate navigation URL. No Google place is implied.
- Unsafe or look-alike saved URLs are ignored; available name/address text can still form a safe search. Several verified destinations appear as separately labelled anchors. Explicit omissions stay plain and missing location data produces no row. Location anchors use local map icons; identical footer actions are consolidated into that row.

The anchor's accessible name is `<localized "open Google Maps">: <address or destination label>`. See [related links](plan-related-links.md) for the additional ordered, editable per-plan link collection.

## Supported syntax (deliberately small)

1. **Raw URLs** that literally begin with `http://` or `https://` (case-insensitive), including internationalized hosts and Unicode paths/query values. Inline renderers keep the visible URL; plan groups use its honest hostname. The href uses WHATWG URL serialization (punycode/percent encoding).
   - Whitespace and sentence punctuation delimit raw URLs. Ordinary Unicode letters never silently truncate a target to its host. Ambiguous unseparated prose should use a space or an explicit Markdown link.
   - Trailing `. , ; : ! ? ' * _ ~` are not part of the URL.
   - A trailing `)` is kept only if it balances an `(` inside the URL.
   - The character before the URL must not be an ASCII letter, a digit or one of `_ - / . @ + % = &`. So `xhttps://…` and `src=https://…` are not linked. CJK text, spaces, brackets, quotes and `Label:` may come right before a URL.
2. **Inline Markdown links** `[label](https://…)`:
   - The label is 1–200 characters on one line, with no `[` or `]`, and is shown as plain text.
   - The target follows the same rules as a raw URL, may contain one level of nested parentheses, and may contain no spaces or titles.
3. A backslash before `[` or `http` keeps the following text literal.

Everything else stays literal text. This includes:

- HTML and entities
- images `![alt](…)` (the whole construct, never an image or link)
- reference links, autolinks `<…>` and link titles
- nested or empty labels
- scheme-less domains (`www.example.org`)

When Markdown syntax is malformed, its brackets stay visible. A valid raw URL inside it is still linked as itself.

## URL acceptance (`contentLinkUrl`)

This check is stricter than `safeLinkUrl`. A URL is accepted only if all of these hold:

- It is absolute `http:` or `https:` with the scheme at the very start.
- It is at most 2,048 characters long.
- Its host, path and query pass the bounded Unicode-aware scan and WHATWG serialization; controls, bidi/format and default-ignorable characters are rejected.
- It contains no backslash, quotes, angle brackets, backtick or whitespace.
- It has no userinfo (`user@`, `user:pw@` or a bare `@` in the authority) and no percent-encoded host.
- It has a real hostname.
- It also passes `safeLinkUrl` and WHATWG URL parsing.

Rejected forms include:

- `javascript:`, `data:`, `vbscript:` and `file:` URLs, in any letter case
- protocol-relative, root-relative and other schemes
- URLs containing control characters, soft hyphens, zero-width or bidi formatting characters, or a BOM

If such a character ends a raw URL candidate, the whole candidate stays literal. The source files contain these characters only as numeric code points.

## Output and activation

- Text renders as escaped text nodes; native anchors use `target="_blank" rel="noopener noreferrer"`. Plan anchors have decorative inline SVGs and visible text labels.
- No `innerHTML`, `DOMParser`, `insertAdjacentHTML`, event listeners or `window.open` are used.
- Activation stays native: click, Enter, Ctrl/Meta/Shift, middle-click, long-press and touch all work as usual.
- Events propagate normally. The existing `createLinkActivationGuard` defers background re-renders while a link is pressed, and `startsOnInteractive` keeps the phone sheet drag from starting on a link.
- A 401 or 403 clears protected UI immediately, as before.
- Card containers with links get an extra `has-text-links` class, used only for wrapping styles.

## Bounds

- Strings longer than 8,000 characters render as one text node. Server text fields are capped at 4,000.
- At most 40 links are rendered per string. Text after that stays literal.
- Labels are at most 200 characters.
- Each candidate scan is bounded and the overall scan is linear. Pathological inputs are covered by tests.

## Limitations

- Unicode prose without a delimiter can be ambiguous next to a URL; use whitespace or `[label](url)` to specify the intended target.
- There is no `mailto:`, `tel:` or relative links, and no Markdown emphasis, lists, images or HTML.
- A stored Maps URL that would fail `contentLinkUrl` leaves the address as plain text. The map button keeps working.

## Tests

```bash
node scripts/test-card-text-links.mjs      # pure parser/validator + jsdom rendering
node scripts/test-card-text-links-ui.mjs   # trip page DOM simulation (desktop/phone emulation)
```

Both tests use jsdom and fictional data. They do not show real browser, device or provider behavior.
