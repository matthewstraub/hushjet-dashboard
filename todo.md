# Project TODO

What's built, and ideas to pick up later. As of November 2026 the plan is to
use the dashboard as it is for a while before adding more.

## Built

- [x] Live readings through Dyson's cloud: PM2.5, PM10, filter life, fan and night mode
- [x] Dyson's 15-minute history copied into TiDB, with 24-hour, 7-day and 30-day charts
- [x] Indoor vs. outdoor air, from Dyson's hourly outdoor estimate
- [x] Daily summary: average and peak PM2.5, time over the WHO guideline, spikes and fan use
- [x] Status card: purifier faults, Dyson's cloud, Wi-Fi, firmware, and how fresh the sync and history are
- [x] Scheduled sync in GitHub Actions
- [x] Info tab explaining the purifier, where the data comes from, and the terms
- [x] Light and dark themes, a Settings tab, and a Dyson-like look
- [x] Controls tab for the admin role: power, Auto, night mode, monitoring, fan speed and sleep timer
- [x] Read-only Schedule tab showing the schedule set in the MyDyson app
- [x] "Sign in as admin" link for viewers
- [x] Notes: cooking, cleaning, open windows, heating, air conditioning or other, added in a pop-up on the Dashboard and marked on its charts. Admins add and edit them; everyone sees them
- [x] The MyDyson app's air quality scale, Good to Severe in its colors: an Air quality card with the bar, bands on the PM tiles and the indoor vs. outdoor card, PM2.5 and PM10 charts whose lines take each band's color, and the scale explained on the Info page

## Ideas for later

- [ ] **Alerts on your phone or by email**
  - Push through ntfy (a free app, no account needed), or email through Resend, as ferrwood-bench uses.
  - Check during each sync. Send one message when a problem starts and one when it clears, with the state kept in TiDB.
  - Worth alerting on:
    - Dyson rejecting the token, so it's time to log in again
    - a purifier fault or filter warning, or the purifier unreachable through Dyson's cloud
    - a filter at 10% or less
    - a PM2.5 spike: a 15-minute average of 35 µg/m³ or more
  - Alerts are only as prompt as the sync, so they need the reliable clock below to be useful.
- [ ] **A reliable, free clock for the sync**
  - GitHub runs this schedule rarely. In the three days to November 8, 2026, it started 7 of the 288 runs asked for, about six hours apart. A missed hour of outdoor air is lost for good, and saved readings are patchy.
  - A Cloudflare Worker with a Cron Trigger (the free plan allows 5 per account) can start the existing workflow every 15 minutes through GitHub's API (`workflow_dispatch`). Runs started that way don't wait in the queue for scheduled runs.
  - Needs a free Cloudflare account and a fine-grained GitHub token that can only run Actions in this repo, kept as a Worker secret.
  - Then remove the workflow's `schedule`. That also ends GitHub's pause of scheduled workflows in public repos after 60 days without a commit.
- [ ] **Hear about failed syncs, with no code**
  - Set the `HEALTHCHECK_URL` secret to a free healthchecks.io check. The workflow already pings it.
- [ ] **What a note did to the air**
  - For each note, the PM2.5 peak in the hours after it and how long until the 15-minute average was back under 15, like the daily summary's spikes.
  - Then averages by kind: how much cooking usually raises PM2.5, and how long it takes to clear.
  - The notes table already has what this needs: the kind, the start and the end.
- [ ] **Notes in the daily summary**
  - The icons of each day's notes beside its row, so a bad day points to its likely cause.
- [ ] **The Auto target on the charts**
  - The MyDyson app draws a line for the level above which Auto speeds the fan up. Worth adding if the HJ10 reports that level in its state.
- [ ] **Filter-life forecast**
  - Once there are a few weeks of filter readings to project from. Both filters read 99–100% in November 2026.

## Decided against

- A Render Cron Job for the sync. It would cost about $1 a month, and the Cloudflare clock above is free.
