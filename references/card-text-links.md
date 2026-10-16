# Card text links

Traveler card text can contain links. Each link renders as a native anchor. No HTML is parsed. The implementation is `assets/app-template/public/text-links.js`. It has no dependencies other than `safeLinkUrl` from `link-activation.js`.

## Where it applies

| Rendered text | Source field (after localization) | Element / class (unchanged) |
| --- | --- | --- |
| Plan review | `slot.review` (and its `i18n.<lang>.review` patch) | `p.timeline-card__review` |
| Plan description | `slot.description` (and patch); omitted when it repeats the review | `p.timeline-card__description` |
| Plan notes | `slot.notes` (and patch) | `p.note-line` |
| Plan location line | `slot.address` (and patch) | first `li` of `ul.meta-list` |
| Recommendation description | `recommendations.*[].description` | `p.recommendation-card__description` |
| Flight segment detail (legacy seed `flightBookings`) | `segment.detail` | `p.muted` |
| Hotel option note | `hotelAreas[].options[].note` | `p.muted` |

Headings, titles, chips, inputs, editor fields, day summaries/tips, guide notes, place-source and photo-credit lines are not linkified. Ordinary text remains text, including HTML-looking content.

## Location line

The address uses `googleMapsDestinations(slot, { allowNameFallback: true })` with the ordinary search fallback enabled. A saved validated destination or selected-place coordinate URL is preferred and matches the existing map action. If no destination is saved, the name/address forms an encoded ordinary Maps search URL. This constructs a navigation URL only, without a Places request or invented Place ID.

- Verified stored Google Maps URL (`normalizeGoogleMapsUrl`): linked.
- Selected OpenStreetMap place with saved coordinates: linked to the existing coordinate navigation URL. No Google place is implied.
- Unsafe or look-alike saved URLs are ignored; available name/address text can still form a safe search. Several verified destinations appear as separately labelled anchors beside the address. Explicitly omitted locations stay plain, missing location data produces no row, and nonlink metadata has no decorative link arrow. Existing map buttons are unchanged.

The anchor's accessible name is `<localized "open Google Maps">: <address or destination label>`. See [related links](plan-related-links.md) for the additional ordered, editable per-plan link collection.

## Supported syntax (deliberately small)

1. **Raw URLs** that literally begin with `http://` or `https://` (case-insensitive), including internationalized hosts and Unicode paths/query values. The visible URL keeps the author's text; its href uses WHATWG URL serialization (punycode/percent encoding).
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

- Text renders only as `Text` nodes and as `<a class="text-link|location-link" href target="_blank" rel="noopener noreferrer">`, with a text-only label.
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
