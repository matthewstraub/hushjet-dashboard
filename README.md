# hushjet-dashboard

A web dashboard for a Dyson HushJet Purifier Compact (HJ10): current air
quality and filter life, read live from the purifier, and their history. It
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
| `drizzle/` | The `readings` table and its migrations |
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
database. To take one reading from the command line:

```bash
npx pnpm@10.4.1 sync
```

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | The server with Vite middleware and hot reload |
| `sync` | Takes one reading through Dyson's cloud and stores it; the scheduled job |
| `check` | TypeScript typecheck |
| `test` | Vitest: the Dyson client against the CLI's real HJ10 capture, sessions, routers |
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
unknown. When the dashboard says Dyson rejected it, run
`hushjet login --force` in `cli/` and update `DYSON_TOKEN` where it's set.

## Plan

Done:

1. Prove Dyson's cloud route: `hushjet listen --cloud` in `cli/`, confirmed on
   a real HJ10.
2. Scaffold this app.
3. Port the Dyson client and message parser to TypeScript, tested against the
   CLI's captures in `cli/tests/fixtures/`.
4. The `readings` table, its first migration, and `pnpm sync`.
5. The dashboard: live readings with Refresh, fan and monitoring status, and
   history charts with a table view.

Live readings and `pnpm sync` are checked against the real purifier. History
is built but waits for a database, so it hasn't stored or charted a real
reading yet.

Next:

6. Deploy: a `hushjet` database on TiDB, the Render Blueprint in
   `render.yaml` (its build runs `db:push`), and a GitHub workflow that runs
   `pnpm sync` every 15 minutes, with a healthcheck.

The sync runs in GitHub Actions rather than on Render because the purifier
keeps no history, so readings must be recorded every few minutes. Waking a
free Render service that often would keep it up almost all month, and the 750
free instance hours are shared with the other dashboards.
