import { describe, expect, it } from "vitest";
import { PATH_IOT_CREDENTIALS, PATH_MANIFEST, PATH_PROVISION } from "./appApi";
import { DeviceSelectionError } from "./devices";
import { readPurifier } from "./live";
import { CURRENT_STATE, SENSOR_DATA } from "./messages";
import {
  capturePayloads,
  FakeMqttClient,
  fakeFetch,
  IOT_RESPONSE,
  jsonResponse,
  MANIFEST_ENTRY,
  REAL_CAPTURE,
  SERIAL,
  TOKEN,
} from "./testData";

const payloads = capturePayloads(REAL_CAPTURE) as Array<{ msg: string }>;
const replies = [payloads.find(p => p.msg === CURRENT_STATE), payloads.find(p => p.msg === SENSOR_DATA)];

function dysonCloud() {
  return fakeFetch(url => {
    if (url.pathname === PATH_PROVISION) return jsonResponse("5.0.21061");
    if (url.pathname === PATH_MANIFEST) return jsonResponse([MANIFEST_ENTRY]);
    if (url.pathname === PATH_IOT_CREDENTIALS) return jsonResponse(IOT_RESPONSE);
    return new Response(null, { status: 404 });
  });
}

describe("readPurifier", () => {
  it("finds the HushJet, gets IoT credentials and takes one snapshot", async () => {
    const { fetch, calls } = dysonCloud();
    const live = await readPurifier({
      env: { DYSON_TOKEN: TOKEN },
      fetch,
      connect: () => new FakeMqttClient({ replies }),
    });
    expect(calls.map(call => call.url.pathname)).toEqual([PATH_PROVISION, PATH_MANIFEST, PATH_IOT_CREDENTIALS]);
    expect(live.device).toMatchObject({ serial: SERIAL, name: "Bedroom", firmwareVersion: "0897PF.00.01.004.0007" });
    expect(live.reading).toMatchObject({ serial: SERIAL, pm25: 3, pm10: 2, hepaFilterPct: 100 });
  });

  it("stops before connecting when DYSON_SERIAL isn't on the account", async () => {
    const { fetch, calls } = dysonCloud();
    await expect(
      readPurifier({ env: { DYSON_TOKEN: TOKEN, DYSON_SERIAL: "NOPE" }, fetch, connect: () => new FakeMqttClient() })
    ).rejects.toThrow(DeviceSelectionError);
    expect(calls.map(call => call.url.pathname)).not.toContain(PATH_IOT_CREDENTIALS);
  });
});
