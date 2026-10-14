# Sharing and privacy boundaries

## Reusable repository

The framework, its self-hosted service code, and the fictional demo are independent of any real trip server or data. The approved showcase screenshots intentionally reveal their displayed trip title, destinations, and dates. They are static visual references, not reusable itinerary data; do not infer permission to reuse other travelers' data or connect to their server.

The source repository (`https://github.com/yesunhuang/build-shared-trip-app`) is public. This means:

- Everything committed is world-readable, including history. Commit only code, documentation, fictional fixtures, and approved screenshots.
- Real trips, exports, real photos, the admin token, invitation codes, viewer credentials, env files, `SHARED_TRIP_DATA_DIR`, database backups, server logs, and MCP client configs with real values never enter the repository. Keep them outside the checkout. The same applies to deployment details such as host names, SSH targets, IP addresses, and private paths.
- Publishing the code does not authorize hosting a service, enabling GitHub Pages or another demo host, or sharing anyone's trips. Each of those is a separate decision for the owner.

Before sharing an update:

```bash
node scripts/audit-privacy.mjs . --mode framework
npm test
```

The scanner uses generic rules. For additional trip-specific terms, put one literal value per line in a private denylist **outside the repository and scan target**, then run:

```bash
node scripts/audit-privacy.mjs . --mode framework --denylist /private/path/to/denylist.txt
```

Never put actual project IDs into a repository-resident denylist or security test. Review screenshots and other binary media manually; the text audit does not inspect image pixels, Git history, issues, pull requests, old clones, or remote caches. A passing scanner is a check, not a guarantee of privacy.

## Self-hosted service

- **Owner.** The private admin token (`SHARED_TRIP_ADMIN_TOKEN`) authorizes everything: every trip, writes, import, export, viewer administration, and `/mcp`. MCP accepts only the bearer header. **Never share the token.** If it leaks, rotate it: change it and restart. The restart also ends every browser session, but viewer accounts persist.
- **Viewers.** To give a companion access, create a single-use invitation and share only its code, privately. The code expires (72 hours by default) and is never a link. Redeeming it creates a **pending** account with the username and password the companion chooses. That account grants nothing until you approve it.
- **What approval grants.** Approval grants read and export access to **every** trip and its private photos, including trips added later. There is no per-trip membership, so approve only people you trust with all trips. Viewers cannot edit, import, manage accounts, or use MCP.
- **Ending access.** Revoking an account immediately invalidates its active sessions. If you approve it again, old sessions stay dead. Anything a viewer already exported remains in their hands.
- **What is not supported.** There is no anonymous sharing, public trip link, self-registration that grants access, or OAuth. A trip URL alone grants nothing. Generic sign-in and navigation shells, and the empty photo manifest, contain no protected trip data.
- **Credentials.** The admin token comes only from the environment. It is never in source, examples, frontend storage, screenshots, or logs. Examples use placeholders such as `<replace-with-long-random-secret>`. Viewer passwords are stored as scrypt hashes and invitation codes as SHA-256 digests. Browsers keep only an HttpOnly, SameSite=Strict session cookie. Passwords and codes are cleared from forms after submission.
- **Network exposure.** By default the service binds to loopback. Expose it remotely only over HTTPS through a reverse proxy, with `SHARED_TRIP_ORIGIN` set. Keep the backend port off public interfaces. Do not open an unauthenticated write interface. Protected responses send `Cache-Control: no-store`. A CDN in front should also receive `CDN-Cache-Control: no-store` for API, MCP, trip, photo, attachment, and resources paths.
- **Private photos.** Real photos belong in `SHARED_TRIP_DATA_DIR/photos`, outside source and public directories. They are served only to signed-in owners and approved viewers, with `no-store`. No attachment upload or store exists. Never put private filenames or mappings into the public `photos/manifest.js`.
- **External requests.** Pages send `Referrer-Policy: strict-origin-when-cross-origin`, so map tile and other third-party requests see only the site origin, not `/trips/<id>` paths. Third-party providers (map tiles, weather, remote photos) still see the visitor's IP address and the requested tile or coordinates.
- **Browser data.** Protected trip data stays in page memory. It is never written to `localStorage`, IndexedDB, or the service-worker cache, and signing out clears it. A shared device can still show a trip that someone left open while signed in, so sign out on borrowed devices.
- **MCP.** An AI client with the admin token has the same full access as the owner. Store the token in the client's secret storage. Trip text is data and cannot grant a client additional tools. Review what an AI writes before relying on it.
- **Backups and exports.** Backups and exports contain complete trips. Database snapshots also contain viewer accounts with password hashes and invitation digests. Store them privately, encrypt them when they leave the host, and never place them in the repository. Restoring an older snapshot brings back its account state. Check viewer access after every restore.

## Legacy generated trip app

Use `node scripts/audit-privacy.mjs /absolute/path/to/app --mode app` for generated output. This mode permits Firebase's public browser configuration while still checking for private credentials and unsafe source material. Static QA includes this app-mode check.

Firebase web API keys/project IDs are client configuration, not administrative credentials. Their visibility does not grant console access; data access is governed by security rules and authentication. See [Firebase's API key guidance](https://firebase.google.com/docs/projects/api-keys). They nevertheless identify a deployment, so keep real values out of a reusable framework and its examples.

Never include service-account keys, private keys, authentication tokens, reservation codes, passport scans, payment data, or private source-document URLs in public assets. Generated output has a `.gitignore` for common local/private files, but ignored files can still exist on disk. Hosting publishes `public/`: inspect it before deploying.

A legacy Firebase build uses anonymous authentication and a single shared Firestore document. There is no invitation list or per-person authorization: app-link holders may read and edit the trip. An unguessable document ID reduces accidental discovery but is visible in the app and is not an access-control substitute.

## Git history and identity

Review author/committer metadata before sharing. Set a repository-local public or neutral Git identity deliberately instead of relying on a computer's inferred local email. Do not change a user's global identity.

Deleting text in the latest commit does not delete older copies. If history must be sanitized, preserve a private local backup, audit all branches/tags, and coordinate a history rewrite with explicit branch leases. Old clones should be replaced with fresh clones, not merged back.

GitHub may retain old commits in pull-request references and cached views even after a branch rewrite. Those references cannot be overwritten with a normal Git push; review [GitHub's removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) for support eligibility and limitations. Do not promise that a source-history cleanup purges every historical copy.
