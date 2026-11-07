/**
 * Dyson's AWS IoT broker, the route that works from anywhere.
 *
 * POST /v2/authorize/iot-credentials returns an endpoint and a signed token
 * for an AWS IoT custom authorizer. The client connects with MQTT 3.1.1 over
 * TLS websockets on port 443, sends the token in the handshake headers, and
 * uses the ClientId it was given, unchanged. Topics and messages are the same
 * as on the purifier's own broker. This matches cli/src/hushjet/cloud.py,
 * which was confirmed on a real HJ10, and hass-dyson and opendyson.
 */

import type { IClientOptions } from "mqtt";
import { DysonApiError, isObject, type JsonObject } from "./appApi";

export interface CloudAuth {
  endpoint: string;
  clientId: string;
  authorizerName: string;
  tokenKey: string;
  tokenValue: string;
  tokenSignature: string;
}

/** The bare host name, whether the API sends a host or a URL. */
export function bareHost(endpoint: unknown): string | null {
  let host = String(endpoint ?? "").trim();
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  }
  return host.split("/")[0]!.split(":")[0] || null;
}

export function cloudAuthFromResponse(data: JsonObject): CloudAuth {
  const credentials = isObject(data.IoTCredentials) ? data.IoTCredentials : {};
  const values = {
    Endpoint: bareHost(data.Endpoint),
    ClientId: credentials.ClientId,
    CustomAuthorizerName: credentials.CustomAuthorizerName,
    TokenKey: credentials.TokenKey,
    TokenValue: credentials.TokenValue,
    TokenSignature: credentials.TokenSignature,
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new DysonApiError(`The IoT credentials response has no ${missing.join(", ")}`);
  }
  return {
    endpoint: String(values.Endpoint),
    clientId: String(values.ClientId),
    authorizerName: String(values.CustomAuthorizerName),
    tokenKey: String(values.TokenKey),
    tokenValue: String(values.TokenValue),
    tokenSignature: String(values.TokenSignature),
  };
}

/** Websocket handshake headers for Dyson's custom authorizer. */
export function cloudHeaders(auth: CloudAuth): Record<string, string> {
  return {
    [auth.tokenKey]: auth.tokenValue,
    "X-Amz-CustomAuthorizer-Name": auth.authorizerName,
    "X-Amz-CustomAuthorizer-Signature": auth.tokenSignature,
  };
}

export function cloudUrl(auth: CloudAuth): string {
  return `wss://${auth.endpoint}/mqtt`;
}

export function cloudClientOptions(auth: CloudAuth): IClientOptions {
  return {
    // AWS IoT only accepts the ClientId it issued, unchanged, and MQTT 3.1.1.
    clientId: auth.clientId,
    protocolVersion: 4,
    clean: true,
    // One short connection per reading: a failure is reported, not retried.
    reconnectPeriod: 0,
    connectTimeout: 10_000,
    wsOptions: { headers: cloudHeaders(auth) },
  };
}
