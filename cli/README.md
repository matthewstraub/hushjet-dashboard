# hushjet

Reads a Dyson HushJet Purifier Compact (HJ10) over MQTT: fan state, PM2.5 and
PM10, and HEPA and carbon filter life. It talks either to the purifier's own
broker on the home network or, with `--cloud`, to Dyson's AWS IoT broker from
anywhere. The readings go to SQLite and a terminal table.

This is unofficial. It relies on the community-documented MyDyson App API
([libdyson-wg/appapi](https://github.com/libdyson-wg/appapi), marked unstable),
which Dyson can change without notice.

## Setup

This CLI lives in the `cli/` folder of hushjet-dashboard. Run every command
here from that folder.

```bash
uv sync
```

If the repo is in an iCloud-synced folder like `~/Documents`, keep the
environment outside it, with `.venv` linking to it (Troubleshooting says why):

```bash
uv venv ~/.local/share/hushjet/cli-venv && ln -s ~/.local/share/hushjet/cli-venv .venv && uv sync
```

Optional: `cp .env.example .env` and set `DYSON_EMAIL`, plus `DYSON_HOST` if
mDNS can't find the purifier. Without a `.env`, `login` prompts for the email.
Leave `DYSON_PASSWORD` unset so the password is typed at a hidden prompt
instead of stored on disk.

Turn on **Continuous monitoring** in the MyDyson app first. It ships off, and
the unit doesn't measure air quality while idle until it's on.

## Use

```bash
uv run hushjet login
```

Asks for the password, has Dyson email a one-time code, and asks for the code.
The token is saved owner-only in `~/.config/hushjet/auth.json`. Running
`login` again reuses it without a new code; `login --force` gets a new one.

```bash
uv run hushjet devices
```

Lists each device's serial, product type, MQTT topic prefix, firmware, whether
an update is waiting, whether its local credential decrypts (and from which
manifest), and its LAN address from mDNS. Prints the HushJet's full manifest
entry with credentials redacted.

```bash
uv run hushjet listen --duration 1h
```

Connects to the purifier on port 1883, asks for its state once and its sensor
data every 30 seconds, and prints a row per message. Every message in and out
goes to `data/raw/<date>.jsonl`; every state or sensor message adds a row to
`data/hushjet.db`. Ctrl-C (or `--duration`) stops it and prints how many times
the connection dropped. `--offline` skips the cloud and uses the saved device
list.

```bash
uv run hushjet listen --cloud --duration 1h
```

The same, through Dyson's cloud instead of the home network, so it works from
anywhere and needs no IP address. It fetches AWS IoT credentials for the
purifier (`POST /v2/authorize/iot-credentials`), then connects with MQTT 3.1.1
over TLS websockets on port 443, the way hass-dyson and opendyson do. The
credentials are fetched fresh each run and never written to disk or logs.

```bash
uv run hushjet show
```

Prints the latest rows from SQLite.

```bash
uv run hushjet replay data/raw/*.jsonl --db data/rebuilt.db
```

Re-parses raw captures into a fresh database, for example after a parser fix.

## Where things go

| What | Where | Notes |
| --- | --- | --- |
| Account password | Hidden prompt, or `DYSON_PASSWORD` in `.env` | `.env` is gitignored |
| Token, device list with the local credential, last mDNS addresses | `~/.config/hushjet/` | Owner-only files outside the repo; change with `HUSHJET_STATE_DIR` |
| Readings | `data/hushjet.db` | SQLite in WAL mode, so a dashboard can read it while `listen` writes |
| Raw messages | `data/raw/YYYY-MM-DD.jsonl` | Every message in and out, plus connection events |

Credentials never reach the terminal, logs or `data/`: manifest entries print
with credentials redacted, errors never include decrypted text, and `-v` debug
logging only records method, path and status.

## The readings table

One row per state or sensor message, each a full snapshot of what's known at
that moment. Sensor rows arrive every poll; state rows appear when something
changes.

```sql
SELECT received_at, pm25, pm10, hepa_filter_pct, carbon_filter_pct
FROM readings
WHERE msg = 'ENVIRONMENTAL-CURRENT-SENSOR-DATA'
ORDER BY id DESC LIMIT 10;
```

Numbers are parsed from zero padded strings. PM is NULL when the sensor reports
`OFF`, `INIT` or `FAIL`, with the word in `sensor_status`. Carbon filter life
is NULL when it reports `INV`. Every field, known or not, is kept in
`state_json` and `sensor_json`, for example
`json_extract(sensor_json, '$.p25r')`.

## Tests

```bash
uv run pytest
```

No device or network needed. The tests replay recorded sessions from
`tests/fixtures/`, including a real HJ10 capture. They run the App API client
against a fake Dyson cloud, and the listener against a fake purifier: a small
MQTT broker on localhost that checks the protocol version, credentials,
subscription, request timing, reconnects and refusals. With `websocket=True`
it stands in for Dyson's AWS IoT broker and checks the handshake headers. See
[tests/fixtures/README.md](tests/fixtures/README.md).

## What the upstream code adds to the handoff

- **MQTT 3.1.** libdyson-neon connects with protocol 3.1 (`MQIsdp`), and the
  HJ10 patch runs on it, so this does the same.
- **User-Agent.** libdyson-neon and the spec still send `android client`, as
  the handoff said to. libdyson-rest moved to `DysonLink/205298 Darwin/27.0.0`,
  the MyDyson iOS app's header, after `android client` logins started getting
  429s, and this does the same. Set `DYSON_USER_AGENT` to send something else.
- **Sensor words.** libdyson-neon treats `OFF`, `INIT` and `FAIL` as sensor
  values, so they are handled here too.
- **Credential key.** libdyson-rest decrypts the v3 `localBrokerCredentials`
  with the same key as the v2 `LocalCredentials`, and a real HJ10 on firmware
  0897PF.00.01.004.0007 confirms it (`ok (v3)`). If a later firmware changes
  that, `devices` falls back to the v2 credential, and the credential column
  says which one worked.
- **Model code.** The v3 manifest gives the HJ10's model as `SP01-AB`, with
  `variant` null and the capabilities `EnvironmentalData`, `ExtendedAQ`,
  `Scheduling` and `ChangeWifi`. Product type 897 is what identifies it.
- **Token lifetime.** The login response has only `account`, `token` and
  `tokenType`, with no expiry, so how long a token lasts is still unknown.
- **Cloud route.** Confirmed on a real HJ10: the IoT credentials call works
  with the same Bearer token, and the purifier answers state and sensor
  requests through an AWS IoT endpoint in eu-west-1, on the same topics as the
  local broker. How long the IoT credentials last is still unknown.
- **Real HJ10 payloads.** None were public, so the first capture is in
  `tests/fixtures/`. The HJ10 sends filter life (`hflr`, `cflr`) and filter
  types (`hflt`, `cflt`) but no error or warning codes, and answers a state
  request with sensor data too. `messages.py` lists every field it sends.
- **State refresh.** State is requested again every tenth poll (about five
  minutes) in case filter life never triggers a `STATE-CHANGE`.

## Checking the handoff's done list

| Done when | How to check |
| --- | --- |
| One login, later runs reuse the token | `hushjet login` twice; the second says "Already logged in" |
| The HushJet appears in `devices` | Its row shows the serial, topic `897` and firmware |
| The raw log shows both message types | `grep -c ENVIRONMENTAL-CURRENT-SENSOR-DATA data/raw/*.jsonl` |
| PM and filter life every 30 s for an hour, no drops | `hushjet listen --duration 1h` ends with "dropped 0 time(s)" and about 120 sensor messages |
| Tests replay recorded messages | `uv run pytest` |

## Troubleshooting

- **"Dyson rejected the saved token"**: run `hushjet login --force`. The
  message gives the token's age, which helps answer how long tokens last.
- **429**: too many code requests. Wait before trying again.
- **mDNS finds nothing**: give the purifier a DHCP reservation and set
  `DYSON_HOST`, or pass `--host`.
- **"refused the serial and password"**: run `hushjet devices` to refresh the
  credential.
- **"the IoT credentials may have expired"** with `--cloud`: run the command
  again; it fetches new ones.
- **PM shows `off`**: Continuous monitoring is off.
- **`No module named 'hushjet'`**: in an iCloud-synced folder like
  `~/Documents`, files inside `.venv` keep getting macOS's hidden flag (even
  in a `.nosync` folder), and Python 3.13 and later skip hidden `.pth` files,
  which is how `uv sync` links this package in. Move the environment out of
  the synced folder and link it back:
  `rm -rf .venv && uv venv ~/.local/share/hushjet/cli-venv && ln -s ~/.local/share/hushjet/cli-venv .venv && uv sync`.

Not built yet, as the handoff allows: commands (`STATE-SET`) and a dashboard.
