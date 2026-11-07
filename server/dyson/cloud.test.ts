import { describe, expect, it } from "vitest";
import { bareHost, cloudAuthFromResponse, cloudClientOptions, cloudHeaders, cloudUrl } from "./cloud";
import { IOT_RESPONSE } from "./testData";

const creds = IOT_RESPONSE.IoTCredentials;

describe("cloudAuthFromResponse", () => {
  it("reads the endpoint and the custom authorizer token", () => {
    expect(cloudAuthFromResponse(IOT_RESPONSE)).toEqual({
      endpoint: IOT_RESPONSE.Endpoint,
      clientId: creds.ClientId,
      authorizerName: "TestAuthorizer",
      tokenKey: "token",
      tokenValue: creds.TokenValue,
      tokenSignature: creds.TokenSignature,
    });
  });

  it.each(["host.example", "wss://host.example/mqtt", "host.example:443", "https://host.example"])(
    "reduces %s to a bare host",
    endpoint => {
      expect(bareHost(endpoint)).toBe("host.example");
    }
  );

  it("names every missing field", () => {
    const data = { Endpoint: "host.example", IoTCredentials: { ClientId: "abc", TokenKey: "token" } };
    expect(() => cloudAuthFromResponse(data)).toThrow(
      "The IoT credentials response has no CustomAuthorizerName, TokenValue, TokenSignature"
    );
  });
});

describe("the connection", () => {
  const auth = cloudAuthFromResponse(IOT_RESPONSE);

  it("goes to /mqtt over TLS websockets with the token in the handshake", () => {
    expect(cloudUrl(auth)).toBe(`wss://${IOT_RESPONSE.Endpoint}/mqtt`);
    expect(cloudHeaders(auth)).toEqual({
      token: creds.TokenValue,
      "X-Amz-CustomAuthorizer-Name": "TestAuthorizer",
      "X-Amz-CustomAuthorizer-Signature": creds.TokenSignature,
    });
  });

  it("uses MQTT 3.1.1, the issued ClientId and no retries", () => {
    expect(cloudClientOptions(auth)).toMatchObject({
      clientId: creds.ClientId,
      protocolVersion: 4,
      reconnectPeriod: 0,
      wsOptions: { headers: cloudHeaders(auth) },
    });
  });
});
