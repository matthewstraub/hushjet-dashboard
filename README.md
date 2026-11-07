# hushjet-dashboard

A web dashboard for a Dyson HushJet Purifier Compact (HJ10): current air
quality and filter life, read live from the purifier, and their history,
including the 15-minute averages Dyson keeps for the MyDyson app. It
uses the same stack as the PetLibro and Dexcom dashboards: a Vite, React and
Recharts client, an Express and tRPC server, Drizzle on TiDB, password
sign-in, and a free Render web service.

This is unofficial. It relies on the community-documented MyDyson App API,
which Dyson can change without notice.

## What's here

| Folder | What |
| --- | --- |
| `client/` | The React app: Vite, Tailwind and shadcn/ui components |
| `server/` | Express and tRPC. `server/_core/` holds sign-in, sessions and security headers, from the Dexcom app |
| `server/dyson/` | The Dyson client: App API calls, the AWS IoT connection and the message parser, ported from the CLI |
| `shared/` | Code and types the client and server share |
| `drizzle/` | The `readings` and `history_slots` tables and their migrations |
| `cli/` | The Python `hushjet` CLI: Dyson login, the device list, and live MQTT on the home network or through Dyson's cloud. See [cli/README.md](cli/README.md) |

## How a reading works

1. Get the device list (`/v3/manifest`) and pick the HushJet, product type 897.
2. Get fresh AWS IoT credentials for it (`/v2/authorize/iot-credentials`).
3. Connect to Dyson's broker with MQTT 3.1.1 over TLS websockets, ask for the
   current state and sensor data, wait for both, and disconnect.

That takes about three seconds and works from anywhere, so neither the server
nor the sync needs to be on the purifier's network. The dashboard reuses a
reading for a minute, refreshes an open tab every two minutes, and does a new
read when you press Refresh. Every new reading is stored when `DATABASE_URL`
is set.

## History

Dyson's cloud keeps 15-minute averages of the purifier for the MyDyson app's
charts: PM2.5, PM10, an air quality index, the fan's average speed, and how
long the fan ran (`/v1/messageprocessor/devices/{serial}/environmentdata/daily`).
It covers only the current week, from Sunday at midnight in the account's
time zone, so a new week presumably starts empty. Every `pnpm sync` copies
the whole week into the `history_slots` table, updating the newest slot as it
fills in, and loading the charts does the same, at most every ten minutes.
Slots that aren't copied before their week ends are likely lost.

The charts use those slots for PM and fan speed. Filter life isn't in Dyson's
history, so it comes from the stored readings.

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

To copy the week's history and take one reading from the command line:

```bash
npx pnpm@10.4.1 sync
```

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | The server with Vite middleware and hot reload |
| `sync` | Copies the week's 15-minute history from Dyson's cloud and takes one reading, storing both. `sync --ci` is the scheduled job's version |
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
| `ADMIN_PASSWORD` | Optional | A second password for settings changes, once there are some |
| `SESSION_SECRET` | In production | Signs session cookies, e.g. `openssl rand -hex 32` |
| `DYSON_TOKEN` | In production | The token from `hushjet login`. Locally it's read from the CLI's saved login instead |
| `DYSON_SERIAL` | Optional | Which device, when the account has more than one HushJet |
| `DYSON_COUNTRY` | Optional | Defaults to US; CN uses Dyson's China host |
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
slots it stored and when the reading was taken, never the values or the
device name. It fails rather than passes when the database can't be used, or
when either the history or the reading fails, after storing the other. Each secret reaches only the step that uses
it. GitHub pauses schedules in a public repo after 60 days without a commit;
a healthcheck notices, and the Actions tab re-enables it.

GitHub also runs scheduled workflows late and skips many runs. Each run copies
the whole week, so the history only loses slots when no run, and no visit to
the dashboard, comes after them before the week ends; readings have gaps
wherever runs were skipped.

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
  GitHub secret), `VIEWER_PASSWORD`, `DYSON_TOKEN`, and a `SESSION_SECRET`
  Render generated. `ADMIN_PASSWORD` is unset, since nothing needs it yet.

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
