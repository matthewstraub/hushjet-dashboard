import { describe, expect, it } from "vitest";
import {
  DysonApiError,
  DysonAppApi,
  DysonAuthError,
  PATH_IOT_CREDENTIALS,
  PATH_MANIFEST,
  PATH_PROVISION,
} from "./appApi";
import { fakeFetch, IOT_RESPONSE, jsonResponse, MANIFEST_ENTRY, SERIAL, TOKEN } from "./testData";

function cloud(overrides: Record<string, () => Response> = {}) {
  return fakeFetch(url => {
    const override = overrides[url.pathname];
    if (override) return override();
    if (url.pathname === PATH_PROVISION) return jsonResponse("5.0.21061");
    if (url.pathname === PATH_MANIFEST) return jsonResponse([MANIFEST_ENTRY]);
    if (url.pathname === PATH_IOT_CREDENTIALS) return jsonResponse(IOT_RESPONSE);
    return new Response(null, { status: 404 });
  });
}

const headersOf = (init: RequestInit) => new Headers(init.headers);

describe("DysonAppApi", () => {
  it("provisions once first, then sends the token and JSON headers", async () => {
    const { fetch, calls } = cloud();
    const api = new DysonAppApi({ token: TOKEN, fetch });
    expect(await api.manifest()).toEqual([MANIFEST_ENTRY]);
    expect(await api.iotCredentials(SERIAL)).toEqual(IOT_RESPONSE);

    expect(calls.map(call => call.url.pathname)).toEqual([PATH_PROVISION, PATH_MANIFEST, PATH_IOT_CREDENTIALS]);
    expect(calls.every(call => headersOf(call.init).get("User-Agent") === "android client")).toBe(true);
    expect(headersOf(calls[0]!.init).get("Authorization")).toBeNull();
    expect(headersOf(calls[1]!.init).get("Authorization")).toBe(`Bearer ${TOKEN}`);

    const iot = calls[2]!;
    expect(iot.init.method).toBe("POST");
    expect(headersOf(iot.init).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(iot.init.body))).toEqual({ Serial: SERIAL });
  });

  it("turns 401 into DysonAuthError without repeating the response", async () => {
    const { fetch } = cloud({ [PATH_MANIFEST]: () => jsonResponse({ token: "leaked-value" }, 401) });
    const error = await new DysonAppApi({ token: TOKEN, fetch }).manifest().catch(e => e);
    expect(error).toBeInstanceOf(DysonAuthError);
    expect(error.status).toBe(401);
    expect(error.message).toContain("hushjet login --force");
    expect(error.message).not.toContain("leaked-value");
  });

  it.each([
    [429, "too many requests"],
    [500, "returned 500"],
  ])("reports a %i", async (status, text) => {
    const { fetch } = cloud({ [PATH_IOT_CREDENTIALS]: () => jsonResponse({}, status) });
    await expect(new DysonAppApi({ token: TOKEN, fetch }).iotCredentials(SERIAL)).rejects.toThrow(text);
  });

  it("reports a network failure", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    await expect(new DysonAppApi({ token: TOKEN, fetch }).manifest()).rejects.toThrow(
      `GET ${PATH_PROVISION} failed: fetch failed`
    );
  });

  it("rejects a manifest that isn't a list", async () => {
    const { fetch } = cloud({ [PATH_MANIFEST]: () => jsonResponse({ devices: [] }) });
    await expect(new DysonAppApi({ token: TOKEN, fetch }).manifest()).rejects.toThrow(DysonApiError);
  });
});
