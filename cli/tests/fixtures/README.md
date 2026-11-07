# Recorded sessions

- `hj10_0897PF.00.01.004.0007_cloud.jsonl` is real: two minutes of
  `hushjet listen --cloud` against an HJ10 on firmware 0897PF.00.01.004.0007,
  recorded on 2026-11-06. The serial is replaced with the fake one the other
  tests use. It holds one `CURRENT-STATE` and five
  `ENVIRONMENTAL-CURRENT-SENSOR-DATA` messages; the state request was also
  answered with sensor data.
- `synthetic_hj10_session.jsonl` is made up, from Pure Cool message shapes,
  to cover what the real capture doesn't: `STATE-CHANGE` pairs, auto mode,
  the sensor reporting `OFF`, and a payload that isn't JSON.

To add another capture, copy a day's raw log here and replace the serial,
since this repo is meant to be public:

```bash
sed 's/YOUR-SERIAL/HJ1-US-TEST000A/g' data/raw/2026-11-07.jsonl > tests/fixtures/hj10_<firmware>_<route>.jsonl
```

Every `*.jsonl` file in this folder runs through `test_every_capture_parses`.
