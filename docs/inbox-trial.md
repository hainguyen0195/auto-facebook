# Messenger inbox trial

The main `/inbox` now reads observations reported by the selected desktop runner,
using the existing confirmed Facebook profile on Windows or macOS. The bridge
below is retained for rollback of the earlier trial; its profile is not deleted
or imported. The new website does not require `INBOX_MONITOR_*` or contact this
monitor. See `docs/desktop.md` for upgrade, multi-machine and MacBook instructions.

This is an isolated, read-only experiment for one explicitly chosen personal
Facebook account. It does not change application routes, Prisma tables, posting
consent, the worker, or Windows browser profiles. It is not a supported Messenger
integration and does not promise complete or real-time inbox coverage.

## Components

- `tools/inbox-trial/compose.yml`: separate Compose project, one CPU, 2 GiB memory,
  256 processes, persistent profile, loopback-only dashboard and noVNC ports.
- `scripts/inbox-trial.ts`: identity-checked DOM observations every 30 seconds.
- `src/inbox-trial/`: DOM extraction, scoped checkpoints, 24-hour data retention.

Only the home-page Messenger preview panel is automatically opened. Conversation
links are never clicked. An opened chat/editor, unsupported UI, PIN prompt,
checkpoint or different active identity prevents collection. An empty/unloaded
list does not mean there are zero unread conversations. Unknown read state is
kept unknown. Only explicit readable markers are accepted as read/unread evidence.

There are no stealth features, CAPTCHA solvers, credential imports, message
submission, private Facebook API calls, or attempts to bypass Messenger encryption.
Name/preview extraction and read markers must be checked against the live UI.

## Configuration and deployment

Create `.data/inbox-trial/config.json` privately, not in source control:

```json
{
  "workspaceId": "WORKSPACE_ID",
  "accountId": "FACEBOOK_ACCOUNT_ID",
  "accountName": "Minh Phan",
  "expectedIdentityHash": "64_CHAR_CONFIRMED_IDENTITY_HASH"
}
```

Read the confirmed identity from the existing account connection; do not set it
from whichever account happens to be logged into the trial browser. The trial
never writes to the application database. Give container UID/GID 1101 access to
this data directory (directory mode 0700, configuration mode 0600).

From the repository root on the VPS:

```sh
docker compose -p autotool-inbox-trial -f tools/inbox-trial/compose.yml build
docker compose -p autotool-inbox-trial -f tools/inbox-trial/compose.yml up -d
docker compose -p autotool-inbox-trial -f tools/inbox-trial/compose.yml ps
```

Use explicit `-p` and `-f`; the production `.env` sets both the project name and
Compose selection and would otherwise override the trial's isolation.
Only this separate project's monitor is built, started or restarted.

Forward private ports from the operator's Windows computer:

```sh
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:18787:127.0.0.1:18787 -L 127.0.0.1:16080:127.0.0.1:16080 deploy@194.233.95.126
```

Open `http://127.0.0.1:18787/` for results and
`http://127.0.0.1:16080/vnc.html?autoconnect=true&resize=scale` for the remote browser.
The viewer intentionally permits manual login/control and has no public ingress;
do not expose it through Traefik, publish it on a public interface, or share the
SSH session. Only the user enters passwords, verification codes and PINs.

Keep the Facebook home page open. Do not open any conversation in the VPS viewer.
After login, the monitor checks the confirmed identity before opening the preview
panel and before saving any extracted rows. If the panel cannot be recognized,
inspect its actual structure before changing selectors; never fall back to
opening a thread. Replies remain on the user's phone.

## Meaning of results

- The first valid list is a quiet baseline, not a burst of new-message alerts.
- Subsequent events mean an unread conversation was observed, its preview changed,
  or an explicit read marker changed. They do not establish message counts.
- Only observed rows are retained. Virtualized/missing rows are not marked read.
- Repeated identical messages without distinguishable UI evidence may be missed.
  Loading a previously unseen old row may produce an observed-unread event.
- Checkpoints and fingerprints survive process restarts, with atomic writes and
  an exclusive profile lock. Corrupt/cross-account checkpoints fail closed.
- Connection probing establishes reachability, not guaranteed Facebook UI freshness.
  The dashboard distinguishes last observation from a connectivity failure.
- Private observation fields, events and fingerprints expire after 24 hours;
  expiration runs at startup and every poll, including offline polls. Responses
  also filter expired records. A stopped service must be started to purge its
  on-disk checkpoint, or have `state.json` removed during explicit cleanup.
- The browser profile persists separately for login, is sensitive, and is not a
  message-history backup. Cookies are never put in application logs or copied
  from Windows. Logs include timestamps and status codes only.

## Website integration

The application includes `/inbox` and an authenticated `GET /api/v1/inbox` route.
Only the configured workspace and existing confirmed Facebook account can read
the trial results. Other workspaces receive an unconfigured state without any
request to the monitor. The bridge validates and filters results, expires old
observations and never returns credentials, identity hashes or internal addresses.

Create the dedicated `autotool_inbox_bridge` Docker network before bringing up
the trial. Include `compose.inbox.yml` as the third production Compose override,
setting `INBOX_MONITOR_WORKSPACE_ID`, `INBOX_MONITOR_ACCOUNT_ID` and
`INBOX_MONITOR_IDENTITY_HASH` privately. Both the production web and trial monitor
join this dedicated network; there is no Traefik route for the monitor/viewer.
The application does not mount the browser profile or need a new Facebook login.

For an already-running authenticated trial, connect it without restarting it:

```sh
docker network create autotool_inbox_bridge
docker network connect --alias inbox-monitor autotool_inbox_bridge autotool-inbox-trial-monitor-1
```

Inspect before creating/connecting if the network already exists. The updated
trial Compose file preserves this network attachment on subsequent deployments.
The existing `/data/profile` remains unchanged. Keep login/verification in the
private SSH viewer; never embed its unauthenticated control interface publicly.

The website polls the bridge without reloading the page. Viewing a preview does
not open a Facebook thread or change Facebook's read marker. A failed fetch keeps
the last client snapshot visible with an error. Badges only show observations
from a fresh ONLINE snapshot; counts always describe observed conversations.

Local development can point `INBOX_MONITOR_ORIGIN` at the SSH-forwarded
`http://127.0.0.1:18787`, with the same workspace/account/identity binding. A local
database with a different workspace gets the unconfigured state. No Facebook
profile is copied or re-created by the website integration.

## Tests

```sh
npm run typecheck
npx vitest run tests/unit/inbox-trial.test.ts
npx playwright test --config tools/inbox-trial/playwright.config.ts
node --import tsx tests/inbox-trial/runtime.ts
```

Browser tests use intercepted synthetic pages and synthetic cookies, never live
Facebook accounts. The TSX smoke test exercises the production serialization path.

Live acceptance requires user login and manually sent test messages. Check one
conversation, another conversation, multiple messages, the phone marking a chat
read, VPS process restart, network failure, and 15 minutes with Windows asleep.
Observe at least 60 minutes after login. Record measured latency (target <=90s),
preview accuracy, read-marker coverage, restart behavior and resource usage.
Passing synthetic tests does not satisfy these live checks.

## Stop / rollback

```sh
docker compose -p autotool-inbox-trial -f tools/inbox-trial/compose.yml down
```

This only removes the trial container/network; the profile and checkpoint remain
private in `.data/inbox-trial`. Application services are not restarted. On request,
remove trial observation files and/or the profile separately after stopping it.
PWA installation, iPhone push and icon badges are a later phase after live evidence.
