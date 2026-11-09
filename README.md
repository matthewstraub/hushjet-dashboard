# hushjet-dashboard

A web dashboard for a Dyson HushJet Purifier Compact (HJ10): current air
quality and filter life, read live from the purifier, and their history,
including the 15-minute averages Dyson keeps for the MyDyson app. It
uses the same stack as the PetLibro and Dexcom dashboards: a Vite, React and
Recharts client, an Express and tRPC server, Drizzle on TiDB, password
sign-in, and a free Render web service.

Signed in with the admin password, you can change the purifier's settings on
the Controls tab: power, Auto, fan speed, night mode, the sleep timer and
continuous monitoring. The Dashboard tab only shows them, so looking through
the readings can't change the purifier. Notes about what was going on at
home, like cooking, cleaning or open windows, are added in a pop-up on the
Dashboard and marked on its charts. The Schedule tab shows the schedule set
in the MyDyson app. The
Info tab explains the purifier, where each number comes from, and terms like
PM2.5, µg/m³, AQI and NO₂. The Settings tab picks light, dark, or the
device's theme (the default), saved in each browser.

The look follows Dyson's own: Futura-style type in a quiet black, white and
gray interface. Dyson's DysonFutura is proprietary, so it uses Jost, a free
typeface modeled on Futura, and no Dyson logos or font files are in the repo.

This is unofficial. It relies on the community-documented MyDyson App API,
which Dyson can change without notice.

## What's here

| Folder | What |
| --- | --- |
| `client/` | The React app: Vite, Tailwind and shadcn/ui components |
| `server/` | Express and tRPC. `server/_core/` holds sign-in, sessions and security headers, from the Dexcom app |
| `server/dyson/` | The Dyson client: App API calls, the AWS IoT connection and the message parser, ported from the CLI |
| `shared/` | Code and types the client and server share |
| `drizzle/` | The `readings`, `history_slots`, `outdoor_readings` and `notes` tables and their migrations |
| `cli/` | The Python `hushjet` CLI: Dyson login, the device list, and live MQTT on the home network or through Dyson's cloud. See [cli/README.md](cli/README.md) |

## How a reading works

1. Get the device list (`/v3/manifest`) and pick the HushJet, product type 897.
2. Get fresh AWS IoT credentials for it (`/v2/authorize/iot-credentials`).
3. Connect to Dyson's broker with MQTT 3.1.1 over TLS websockets, ask for the
   current state, sensor data and fault report, wait for them, and
   disconnect. The purifier now and then ignores a request, so anything
   missing is asked for once more; a reading without its fault report still
   counts.

That takes two or three seconds and works from anywhere, so neither the server
nor the sync needs to be on the purifier's network. The dashboard reuses a
reading for a minute, refreshes an open tab every two minutes, and does a new
read when you press Refresh. Every new reading is stored when `DATABASE_URL`
is set.

## Status

The status card on the dashboard shows:

- **Purifier checks:** the purifier's own fault report, 28 checks on the
  HJ10, each "OK" when fine. One is the filter warning (`fltr`); what most of
  the other codes mean isn't documented, so a problem shows its raw code.
- **Dyson cloud:** whether the last live reading worked, or why not (for
  example, Dyson rejecting the token).
- **Wi-Fi signal:** from the purifier's state message, in dBm.
- **Firmware:** whether Dyson has an update waiting.
- **Scheduled sync:** when `pnpm sync` last stored a reading. GitHub runs it
  irregularly, so it only warns after six hours.
- **Saved history:** the newest 15-minute slot in the database.

## History

Dyson's cloud keeps 15-minute averages of the purifier for the MyDyson app's
charts: PM2.5, PM10, an air quality index, the fan's average speed, and how
long the fan ran (`/v1/messageprocessor/devices/{serial}/environmentdata/daily`).
It covers the last seven days: a rolling window that starts at midnight six
days ago, in the account's time zone, and moves forward a day at a time. (On
Sunday, November 8, 2026 it started on Monday, November 2, so it doesn't reset
weekly.) Every `pnpm sync` copies all seven days into the `history_slots`
table, updating the newest slot as it fills in, and loading the charts does
the same, at most every ten minutes. A slot is lost only if nothing copies it
for about a week.

The charts use those slots for PM and fan speed. Filter life isn't in Dyson's
history, so it comes from the stored readings.

## Outdoor air

Dyson also reports the outdoor air for the purifier's area, as the MyDyson app
shows it: an AQI with its band ("Good"), PM2.5, PM10 and NO2 for the current
hour (`/v1/environment/devices/{serial}/data`). Dyson doesn't say which unit
NO2 is in. Each history copy fetches it too and stores the hour in
`outdoor_readings`; the place name in the response is never read or stored.

An "Indoor vs. outdoor air" card puts the purifier's latest reading and
Dyson's latest outdoor hour side by side: PM2.5 and PM10 for both, and the AQI
and NO2 outdoors (the purifier doesn't measure those). The history charts
outdoor PM2.5 as a gray step line behind indoor PM2.5. Dyson only gives the
current hour, so outdoor history builds up from the first copy, and an hour
without a sync or a page load leaves a gap.

## Daily summary

Below the charts, one row per day for the last seven days, from the same
15-minute slots and by day in the viewer's time zone:

- **Avg PM2.5** and the **peak** 15-minute average, with its time. A day
  averaging over 15 µg/m³, the WHO's guideline for a 24-hour average, is
  marked with a warning sign.
- **Over 15:** how long the 15-minute averages were above that guideline.
- **Spike cleared in:** when the day's peak was a spike (35 µg/m³ or more),
  how long until the average was back under 15. "Not yet" if it hasn't been.
- **Avg fan speed** while the fan ran, and how many **hours it ran**.

Today's row is marked "so far", and a day with less than about 23 hours of
data is marked partial.

## Controls

The admin role gets a Controls tab: power, Auto, night mode, continuous
monitoring, fan speeds 1 to 10, and a sleep timer. The switches are only on
that tab. The Dashboard shows the same settings as text, for everyone, so
looking through the readings can't change the purifier.

Each change is one `STATE-SET` command on the purifier's command topic in
Dyson's cloud, in the format hass-dyson uses for cloud-connected Dyson
models. The server waits up to eight seconds for the purifier to report the
new values back, then takes a fresh reading, so the tab shows what the
purifier reports rather than what was asked for. A change takes two to four
seconds.

- **Who can change things:** only the admin role. Viewers don't get the tab,
  and the server refuses their changes. In production that means signing in
  with `ADMIN_PASSWORD`, so the tab stays hidden until it's set. Viewers get a
  "Sign in as admin" link to the admin sign-in page, `/login?admin=1`. Signing
  in there replaces the viewer session, so there's no need to sign out first.
  Locally, with no `VIEWER_PASSWORD`, the site is open and the controls work
  without signing in.
- **A speed** turns Auto off, as it does in the MyDyson app.
- **Night mode** on the HJ10 turns Auto off and holds the fan at speed 4, even
  when Auto is sent with it. Turning night mode off leaves Auto off; switch
  Auto back on to let the purifier choose again.
- **The sleep timer** turns the purifier off after 15 minutes to 8 hours. A
  timer set in the MyDyson app shows as the time left.
- **Continuous monitoring** keeps the sensor measuring while the fan is off.

## Schedule

The Schedule tab lists the schedule set in the MyDyson app: each period's
start and end, its days, and what it sets (Auto or a speed, night mode,
power), and whether the schedule is on. It's read-only; change the schedule
in the app. The server reads it from Dyson's unified scheduler
(`/v1/unifiedscheduler/{serial}/events`) and keeps it for five minutes. Dyson
stores each period as two events in one group, its start and its end.

On the HJ10, a period that asks for Auto with night mode on runs at speed 4,
since night mode turns Auto off (see [Controls](#controls)). The fan history
shows that: a steady speed 4 through the scheduled night, then Auto again
after the morning change.

## Notes

Notes are a log of what was going on at home that can change the air:
cooking, cleaning, open windows, the heating, the air conditioning, or
anything else. They're there to look back on, for example to see how much
cooking raises PM2.5 and how long the purifier takes to clear it. They live
with the charts, on the Dashboard's History card, as in the PetLibro
dashboard.

- **Adding one:** **Add note**, above the charts, opens a pop-up set for now.
  With a mouse, clicking a chart opens it set for the 15-minute slot clicked.
  Each note has a kind, a start, an optional end and optional details, which
  Other needs. **Now**, beside Until, ends a note at the current time, for
  something that just stopped.
- **On the charts:** the PM, indoor and outdoor, and fan charts mark each
  note with a dashed line at its start, a faint band for how long it lasted,
  and its icon above the plot. Notes too close together to tell apart share
  one icon, with a count. The charts reach as far as the newest note, so one
  made just now shows before Dyson's next 15-minute average arrives. Pointing
  at a chart lists the notes at that time in the tooltip.
- **Opening one:** click or tap an icon above a chart. The admin role can
  edit or delete the note there; when several share the icon, the pop-up
  lists them first.
- **Lists:** under the charts, the notes in the chart's range, newest first.
  **All notes** opens a page with every note, a page at a time.
- **Who can change notes:** everyone signed in sees them. Only the admin role
  adds, edits or deletes them, and the server refuses changes from viewers.
  Viewers get a "Sign in as admin" link instead of the buttons.
- **Rules:** a note can't start in the future, can last up to 31 days, and
  can have up to 1,000 characters of details. The form and the server check
  the same rules, in `shared/notes.ts`.
- **Storage:** the `notes` table, with times in UTC, shown in each viewer's
  time zone. Its migration runs with the others when Render builds.

## Run it locally

Log in to Dyson once with the CLI. It asks for your password and the code
Dyson emails you, and saves the token where this app looks for it:

```bash
cd cli && uv run hushjet login
```

Then, from the repo root. The project pins pnpm 10.4.1; without a global pnpm,
run it through npx (or install it once with `npm install -g pnpm@10.4.1` and
drop the `npx` prefix):

```bash
npx pnpm@10.4.1 install
```

```bash
npx pnpm@10.4.1 dev
```

The dashboard runs at http://localhost:3000, or the next free port; set `PORT`
to choose. Without a `.env`, sign-in is off and history says it needs a
database. With `DATABASE_URL` in `.env`, this creates the tables, and the dev
server picks the database up on its next start:

```bash
npx pnpm@10.4.1 db:push
```

To copy the last seven days of history and take one reading from the command line:

```bash
npx pnpm@10.4.1 sync
```

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | The server with Vite middleware and hot reload |
| `sync` | Copies the last seven days of 15-minute history and the hour's outdoor air from Dyson's cloud and takes one reading, storing them. `sync --ci` is the scheduled job's version |
| `check` | TypeScript typecheck |
| `test` | Vitest: the Dyson client against real HJ10 captures and history, the stores, sessions, routers |
| `build` | The client into `dist/public`, the server into `dist/index.js` |
| `start` | Runs the production build |
| `db:push` | Generates and applies Drizzle migrations to `DATABASE_URL` |

## Configuration

| Variable | Needed | What |
| --- | --- | --- |
| `DATABASE_URL` | For history | TiDB or MySQL. TiDB needs `?ssl={"rejectUnauthorized":true}` |
| `VIEWER_PASSWORD` | In production | The site password |
| `ADMIN_PASSWORD` | For controls and notes | A second password that unlocks the Controls tab and adding notes. Without it, nobody can change settings or add notes from the dashboard |
| `SESSION_SECRET` | In production | Signs session cookies, e.g. `openssl rand -hex 32` |
| `DYSON_TOKEN` | In production | The token from `hushjet login`. Locally it's read from the CLI's saved login instead |
| `DYSON_SERIAL` | Optional | Which device, when the account has more than one HushJet |
| `DYSON_COUNTRY` | Optional | Defaults to US; CN uses Dyson's China host |
| `DYSON_USER_AGENT` | Optional | The User-Agent for Dyson's API. Defaults to the MyDyson iOS app's, `DysonLink/205298 Darwin/27.0.0` |
| `HUSHJET_STATE_DIR` | Optional | Where `hushjet login` saved its token, if not `~/.config/hushjet` |
| `PORT` | Optional | Defaults to 3000 |

Never commit `.env`, the purifier's serial or the Dyson token. They belong in
Render's and GitHub's secret settings. How long a Dyson token lasts is
unknown; [Deployment](#deployment) says how to replace it.

## Scheduled sync

[.github/workflows/sync.yml](.github/workflows/sync.yml) runs `pnpm sync --ci`
every 15 minutes, and on demand from the Actions tab. It needs these
repository secrets (Settings > Secrets and variables > Actions):

| Secret | Needed | What |
| --- | --- | --- |
| `DATABASE_URL` | Yes | The same TiDB connection string Render uses |
| `DYSON_TOKEN` | Yes | The token `hushjet login` saved |
| `DYSON_SERIAL` | Optional | Only when the account has more than one HushJet |
| `HEALTHCHECK_URL` | Optional | A healthchecks.io ping URL, to hear about failed runs |

To set `DYSON_TOKEN` from your saved login without the token appearing on
screen or in your shell history:

```bash
python3 -c 'import json, pathlib; print(json.loads((pathlib.Path.home() / ".config/hushjet/auth.json").read_text())["response"]["token"])' | gh secret set DYSON_TOKEN --repo matthewstraub/hushjet-dashboard
```

Until `DATABASE_URL` and `DYSON_TOKEN` are set, each run posts a notice and
skips the sync, so there are no failure emails before TiDB exists. This repo
is public, so its Actions logs are too: `--ci` prints only how many history
slots it stored, whether it stored outdoor air, and when the reading was
taken, never the values or the device name. Error messages show `{serial}`
in place of the purifier's serial. It fails rather than passes when the database can't be used, or
when either the history or the reading fails, after storing the other. Each secret reaches only the step that uses
it. GitHub pauses schedules in a public repo after 60 days without a commit;
a healthcheck notices, and the Actions tab re-enables it.

GitHub also runs scheduled workflows late and skips many runs. Each run copies
all seven days, so the history only loses slots if nothing runs and nobody
opens the dashboard for about a week; readings have gaps wherever runs were
skipped.

## Deployment

The dashboard is live at https://hushjet-dashboard.onrender.com.

| Piece | Where | Settings |
| --- | --- | --- |
| Database | TiDB Cloud cluster `hushjet-dashboard` | Starter (free), AWS us-east-1, database `hushjet`. The cluster's own root login is used by nothing else |
| Web service | Render, Matt's Projects → Production | `hushjet-dashboard`: Node, Free, Oregon, branch `main`, auto-deploy on commit, health check `/api/health` |
| Readings | GitHub Actions | [Scheduled sync](#scheduled-sync), every 15 minutes |

Like the PetLibro and Dexcom services, the Render service was created in the
dashboard rather than from a Blueprint, so Render doesn't read
[render.yaml](render.yaml); the file records the same settings. The service
uses:

- Build: `pnpm install --frozen-lockfile && pnpm run build && pnpm run db:push`.
  Migrations run here, so a schema change ships with the push that adds it.
- Start: `pnpm run start`
- Environment: `NODE_ENV=production`, `DATABASE_URL` (the same string as the
  GitHub secret), `VIEWER_PASSWORD`, `ADMIN_PASSWORD` (a different password,
  for the Controls tab and notes), `DYSON_TOKEN`, and a `SESSION_SECRET`
  Render generated.

Saving an environment variable redeploys the service. The old server keeps
answering until the new one is live, so a new or changed password only works
once Render shows that deploy as live.

Every push to `main` redeploys, including changes to docs.

### Replacing the Dyson token

When the dashboard says Dyson rejected the token, log in again:

```bash
cd cli && uv run hushjet login --force
```

Then update `DYSON_TOKEN` in both places. For GitHub, rerun the
`gh secret set DYSON_TOKEN` command in [Scheduled sync](#scheduled-sync). For
Render, copy the token without printing it, then paste it into the service's
Environment page, which redeploys:

```bash
python3 -c 'import json, pathlib; print(json.loads((pathlib.Path.home() / ".config/hushjet/auth.json").read_text())["response"]["token"], end="")' | pbcopy
```

The sync runs in GitHub Actions rather than on Render because the purifier
keeps no history, so readings must be recorded every few minutes. Waking a
free Render service that often would keep it up almost all month, and the 750
free instance hours are shared with the other dashboards.
