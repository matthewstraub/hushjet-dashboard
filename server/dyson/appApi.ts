/**
 * The MyDyson App API calls the dashboard needs: the device list and AWS IoT
 * credentials. Logging in needs a code from your email, so it stays in the
 * Python CLI (`hushjet login` in cli/), which saves the token this uses.
 *
 * Paths and headers follow https://github.com/libdyson-wg/appapi and
 * cli/src/hushjet/appapi.py. Errors never include response bodies, which can
 * carry tokens.
 */

export const API_BASE = "https://appapi.cp.dyson.com";
export const API_BASE_CN = "https://appapi.cp.dyson.cn";
/**
 * The MyDyson iOS app's header. libdyson-rest moved to it in October 2026
 * after "android client" (what the spec and the handoff used) started
 * getting 429s at login. Set DYSON_USER_AGENT to send something else.
 */
export const DEFAULT_USER_AGENT = "DysonLink/205298 Darwin/27.0.0";

export const PATH_PROVISION = "/v1/provisioningservice/application/Android/version";
export const PATH_MANIFEST = "/v3/manifest";
export const PATH_IOT_CREDENTIALS = "/v2/authorize/iot-credentials";

export type JsonObject = Record<string, unknown>;

export class DysonApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "DysonApiError";
  }
}

/** 401 or 403: Dyson rejected the token, usually because it expired. */
export class DysonAuthError extends DysonApiError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "DysonAuthError";
  }
}

export interface DysonAppApiOptions {
  token: string;
  baseUrl?: string;
  userAgent?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class DysonAppApi {
  private provisioned = false;
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: DysonAppApiOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? API_BASE;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  /** Dyson ignores clients that haven't made this call recently. */
  async provision(): Promise<void> {
    await this.send("GET", PATH_PROVISION, { auth: false });
    this.provisioned = true;
  }

  /** Every device on the account, with camelCase fields. */
  async manifest(): Promise<JsonObject[]> {
    const data = await this.send("GET", PATH_MANIFEST);
    if (!Array.isArray(data)) throw new DysonApiError(`${PATH_MANIFEST} didn't return a list`);
    return data.filter(isObject);
  }

  /** Endpoint plus IoTCredentials for one device; see cloud.ts. */
  async iotCredentials(serial: string): Promise<JsonObject> {
    const data = await this.send("POST", PATH_IOT_CREDENTIALS, { body: { Serial: serial } });
    if (!isObject(data)) throw new DysonApiError(`${PATH_IOT_CREDENTIALS} didn't return an object`);
    return data;
  }

  /**
   * The current week's 15-minute history, the data behind the MyDyson app's
   * charts: start_time, resolution and one array per series. See history.ts.
   * Null when Dyson has none.
   */
  async environmentHistory(serial: string): Promise<JsonObject | null> {
    const path = `/v1/messageprocessor/devices/${encodeURIComponent(serial)}/environmentdata/daily`;
    const data = await this.send("GET", path);
    if (data === null) return null;
    if (!isObject(data)) throw new DysonApiError("The history response wasn't an object");
    return data;
  }

  private async send(
    method: "GET" | "POST",
    path: string,
    { auth = true, body }: { auth?: boolean; body?: JsonObject } = {}
  ): Promise<unknown> {
    if (path !== PATH_PROVISION && !this.provisioned) await this.provision();
    const headers: Record<string, string> = { "User-Agent": this.userAgent };
    // A POST without a Content-Type gets a 415.
    if (method === "POST") headers["Content-Type"] = "application/json";
    if (auth) headers.Authorization = `Bearer ${this.token}`;

    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new DysonApiError(`${method} ${path} failed: ${reason}`);
    }

    const { status } = response;
    if (status === 401 || status === 403) {
      throw new DysonAuthError(
        `Dyson rejected the token (${method} ${path} returned ${status}). ` +
          "Log in again with `hushjet login --force` in cli/.",
        status
      );
    }
    if (status === 429) {
      throw new DysonApiError("Dyson says too many requests (429); wait before trying again", status);
    }
    if (!response.ok) throw new DysonApiError(`${method} ${path} returned ${status}`, status);

    const text = await response.text();
    if (status === 204 || !text.trim()) return null; // No content, e.g. no history yet.
    try {
      return JSON.parse(text);
    } catch {
      if (path === PATH_PROVISION) return text; // A bare version string is fine here.
      throw new DysonApiError(`${path} didn't return JSON`);
    }
  }
}
