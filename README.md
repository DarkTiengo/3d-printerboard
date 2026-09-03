# 3D Printerboard

Run your 3D print farm from one screen — remotely, from your own server.
Live cameras, print control, a G-code library with a queue, alerts, and the
thing Moonraker does not do: **automatic backups of every machine's
configuration**.

Built for people who own several Klipper/Moonraker printers and are tired of
keeping one browser tab open per machine.

Everything runs in a single container: the same process serves the API and the
web app, and holds a persistent WebSocket to each Moonraker host.

![Dashboard — camera wall with the selected printer's control panel](docs/dashboard.jpg)

<details>
<summary>More screens</summary>

![Sign in](docs/login.jpg)

![Backups — per-machine state, with printers queued until they go idle](docs/backups.jpg)

</details>

## What you need

- **A machine to host it**: anything that runs Docker on the same LAN as the
  printers — a mini PC, a NAS, a spare Raspberry Pi. It does not go on the
  printers themselves.
- **Klipper + Moonraker** on each printer, reachable over HTTP. That is the only
  supported firmware: the app speaks Moonraker's API, not OctoPrint's or a
  vendor cloud.
- **A camera per printer, optionally** — MJPEG or a JPEG snapshot endpoint, which
  is what crowsnest, ustreamer and mjpg-streamer all serve.

## Getting started

```bash
cp .env.example .env
# set ADMIN_PASSWORD and generate JWT_SECRET:
openssl rand -hex 32

mkdir -p data                 # must exist and be yours — see PUID/PGID in .env
docker compose up --build -d
```

Open `http://localhost:8080` and sign in with the `ADMIN_USER`/`ADMIN_PASSWORD`
from your `.env`. That first admin is created only on the first boot; after
that, change the password in the app — editing `.env` has no effect.

Keep `NETWORK_MODE=host`. The container needs to see your LAN directly:
multicast does not cross Docker's default bridge, and without it `.local`
addresses and camera discovery stop working.

### Try it without hardware

```bash
MOCK_PRINTERS=true docker compose up
```

Brings up eight simulated printers in different states (printing, idle, paused,
attention) with synthetic cameras, files and working backups. You can walk
through all seven screens before registering a single real machine.

## Adding your printers

Settings button in the top bar (admin only) → **+**. For each machine:

| Field | Example |
| --- | --- |
| Moonraker URL | `http://ender-a.local:7125` |
| API key | leave blank unless Moonraker requires one |
| Camera URL | `http://ender-a.local/webcam/?action=stream` |

**Test connection** sits right under the URL field, and runs on its own as soon
as you leave that field. It checks the printer, and then **finds the camera for
you**: it asks Moonraker which webcams it has configured (`/server/webcams/list`,
which is where Mainsail and Fluidd store them), falls back to the conventional
crowsnest paths, fills the camera field in, and shows **a real frame** so you can
confirm the angle and that it is the machine you think it is — before saving.

### .local addresses (mDNS)

`.local` names work out of the box. Worth knowing why that took effort: the
image runs on Alpine, whose musl libc has no NSS and therefore ignores mDNS
entirely — `ender-a.local` would never resolve, not even with host networking.
Instead of switching the base image or mounting an Avahi socket from the host,
the server speaks multicast DNS itself (`src/lib/mdns.ts`), caches answers by
their TTL, and falls back to regular DNS. It needs `NETWORK_MODE=host` to reach
the multicast group.

## The screens

**Dashboard** — camera wall plus a control panel for the selected printer (job,
temperatures, jog, macros), or the queue when nothing is selected.
**Cameras** — 2×2 quadrant with controls and a thumbnail strip.
**Files** — G-code library across the whole farm; one click sends a file to the queue.
**Backups** — per-machine state, manual runs and restore.
**Alerts** — list by severity, with the camera frame captured at that moment.
**Settings** — printer CRUD.

## Language

The interface ships in **English, Brazilian Portuguese, Spanish, French and
Italian**. The picker sits in the top bar and on the sign-in screen; the choice
is remembered per browser, and the first visit follows your browser's language
list. Dates, numbers, clock format and relative times follow the selected
locale.

Adding a language is one file: copy `apps/web/src/i18n/en.ts`, translate the
values, and register it in `apps/web/src/i18n/index.ts`. The dictionary is typed
against the Portuguese one, so the compiler tells you if a key is missing.

## Roles

| | read-only | operator | admin |
| --- | --- | --- | --- |
| See everything | ✓ | ✓ | ✓ |
| Pause/resume/cancel, emergency stop, queue | | ✓ | ✓ |
| Run a backup | | ✓ | ✓ |
| Restore a backup, manage printers and users | | | ✓ |

Enforced on the server. The front end only mirrors it by disabling buttons.

## Backups

Runs daily at 03:00 (`BACKUP_CRON`) over Moonraker's HTTP API only — no SSH, no
operating-system credentials. It covers the three lines on each card:

- **profiles** — `printer.cfg`, macros and the rest of the `config` root, plus a
  dump of Moonraker's database (Mainsail/Fluidd slicing profiles)
- **firmware/calibration** — `machine.system_info` and `machine.update.status`
- **G-code** — the `gcodes` root

Each run becomes `data/backups/<printer>/<timestamp>.tar.gz` with a
`manifest.json`. G-code goes into a content-addressed store under `data/blobs/`:
eight machines print largely the same files, and without deduplication a 7-day
retention would fill the disk.

### Idle printers only

**No backup ever runs on a machine that is working** — that holds for the
scheduled cycle, the manual button and catch-up alike. Pulling a gigabyte of
G-code off a Raspberry Pi mid-print competes with Klipper for CPU and network,
and the price is stutter in the print.

A busy printer is not refused, it is queued, and copied as soon as the print
ends. Idle means idle: paused, attention and offline all wait. The card shows
`QUEUED — WAITING FOR THE PRINTER TO GO IDLE`, and the manual button tells you
it will run later.

If a printer never opens an idle window, that does not stay silent: after two
intervals in the queue, a medium-severity alert says so.

### Catch-up on reconnect

The scheduled cycle only reaches machines that were on at the time, and in a
home farm they spend days switched off. So **every time a printer reappears on
the network the system checks its last backup**: if more than
`BACKUP_INTERVAL_HOURS` (24 by default) has passed, it joins the queue and is
copied once idle, with a low-severity alert recording that it had fallen behind.
It waits for Klipper to finish booting before asking anything.

When the whole farm powers up together, backups go out one at a time.

### Restore

Overwrites the configuration on the target printer — which may be a *different*
printer, the way you clone the machine that works. Admin role and an explicit
confirmation required.

## Cameras

One upstream connection per camera on the server, fanned out to every viewer —
the camera host sees a single connection, not one per open tab.

In the browser almost everything is **snapshot polling**, not MJPEG: HTTP/1.1
allows only 6 connections per origin, and one stream per tile would consume all
of them, leaving the event stream and the API itself queued behind. Only the
focused feed stays live (the control panel, or the first quadrant on the
Cameras screen).

## Security

The trust model is simple: **whoever signs in is trusted within their role, and
everything else is verified on the server.**

- Every route requires a session except sign-in. The role is read from the
  database on each request, not from the token — removing a user or demoting
  them takes effect immediately rather than whenever the JWT expires.
- Permissions are never decided in the browser. The front end disables buttons
  for convenience; the server is what actually refuses.
- Session in an `httpOnly` + `SameSite=Strict` cookie. The `Secure` flag is
  decided per connection (`COOKIE_SECURE=auto`): always setting it would break
  access over `http://` on a local network, which is how a farm is used.
- Security headers via helmet, with a CSP that allows no external and no inline
  scripts.
- Rate limits on the sensitive routes (sign-in, print control, G-code, emergency
  stop, restore, user creation). Deliberately not global: the camera wall does
  legitimate polling well above a thousand requests per minute.
- The Moonraker API key never leaves the server — the settings screen only ever
  sees `••••`.
- Restore validates every path in the manifest before reading a file.

Two capabilities that are powerful **on purpose**, and worth knowing about:

- `POST /api/printers/:id/gcode` runs arbitrary G-code on the machine. That is
  the point of the app (macros and console), and Moonraker exposes the same.
  This is why `operator` is already a trusted role.
- An admin registers the URLs the server fetches (Moonraker and cameras), so an
  admin can point the server at any address reachable on the network. That is
  inherent to the product; `admin` is the highest-trust role.

## Development

```bash
npm install
npm run build -w @3dfarm/shared          # everything else depends on its dist
MOCK_PRINTERS=true npm run dev:server    # API on :8080, data in ./data
npm run dev:web                          # Vite on :5173, proxying the API

npm test         # Vitest: normalizer, queue engine, MJPEG demuxer, mDNS codec, formatters
npm run typecheck
```

Outside Docker the server reads `DATA_DIR` (default `./data`) and `WEB_DIR`
(default `apps/web/dist`); the image sets both for you.

```
packages/shared   types shared by both sides
apps/server       Fastify, SQLite, Moonraker clients, backup, queue, alerts, mDNS
apps/web          React + Vite, screens and components
design/           the design package — README.md is the visual source of truth
```

`design/README.md` carries the final measurements, colours and states for every
screen; check it whenever you touch the UI.

Two things are still written in Brazilian Portuguese, and it is worth being
straight about it: the source comments and log lines, and the **prose inside
alert details** — the sentence explaining what happened. Alert *titles* are
translated (they carry a stable code the front end maps), and every other string
in the UI is too; only that description is still emitted by the server in the
language it was written in. The design package is in Portuguese as well.
