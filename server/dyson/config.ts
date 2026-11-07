/**
 * Where the dashboard finds its Dyson settings. In production they come from
 * the environment (Render and GitHub secrets). Locally, the token can come
 * from the Python CLI's saved login instead, so running `hushjet login` in
 * cli/ is all the setup a development machine needs. The token itself is
 * never logged or sent to the browser.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_BASE, API_BASE_CN, DEFAULT_USER_AGENT } from "./appApi";

export type TokenSource = "DYSON_TOKEN" | "cli login";

export interface DysonConfig {
  token: string;
  tokenSource: TokenSource;
  serial: string | null;
  baseUrl: string;
  userAgent: string;
}

/** No token, or a setting that can't work. */
export class DysonConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DysonConfigError";
  }
}

/** The file `hushjet login` writes: HUSHJET_STATE_DIR/auth.json, ~/.config/hushjet by default. */
export function cliAuthFile(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HUSHJET_STATE_DIR?.trim();
  const dir = configured
    ? configured.replace(/^~(?=$|\/)/, os.homedir())
    : path.join(os.homedir(), ".config", "hushjet");
  return path.join(dir, "auth.json");
}

function readCliToken(file: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const token = JSON.parse(text)?.response?.token;
    return typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

export function loadDysonConfig(env: NodeJS.ProcessEnv = process.env): DysonConfig {
  const country = (env.DYSON_COUNTRY?.trim() || "US").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new DysonConfigError(`DYSON_COUNTRY must be a two-letter code like US, not ${country}`);
  }
  const settings = {
    serial: env.DYSON_SERIAL?.trim() || null,
    baseUrl: country === "CN" ? API_BASE_CN : API_BASE,
    userAgent: env.DYSON_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
  };
  const fromEnv = env.DYSON_TOKEN?.trim();
  if (fromEnv) return { ...settings, token: fromEnv, tokenSource: "DYSON_TOKEN" };
  const file = cliAuthFile(env);
  const fromCli = readCliToken(file);
  if (fromCli) return { ...settings, token: fromCli, tokenSource: "cli login" };
  throw new DysonConfigError(
    `No Dyson token. Set DYSON_TOKEN, or run \`hushjet login\` in cli/ (it saves the token in ${file}).`
  );
}

/** Where the token would come from, without handing the token to the caller. */
export function dysonTokenSource(env: NodeJS.ProcessEnv = process.env): TokenSource | null {
  try {
    return loadDysonConfig(env).tokenSource;
  } catch {
    return null;
  }
}
