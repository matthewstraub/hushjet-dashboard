import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { API_BASE, API_BASE_CN } from "./appApi";
import { cliAuthFile, DysonConfigError, dysonTokenSource, loadDysonConfig } from "./config";

const dirs: string[] = [];

/** A HUSHJET_STATE_DIR holding an auth.json like `hushjet login` writes. */
function stateDir(saved?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hushjet-state-"));
  dirs.push(dir);
  if (saved !== undefined) {
    fs.writeFileSync(path.join(dir, "auth.json"), typeof saved === "string" ? saved : JSON.stringify(saved));
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("loadDysonConfig", () => {
  it("prefers DYSON_TOKEN", () => {
    const dir = stateDir({ response: { token: "from-cli" } });
    const config = loadDysonConfig({ DYSON_TOKEN: " from-env ", HUSHJET_STATE_DIR: dir });
    expect(config).toMatchObject({ token: "from-env", tokenSource: "DYSON_TOKEN", baseUrl: API_BASE });
  });

  it("falls back to the CLI's saved login", () => {
    const dir = stateDir({ email: "x@example.com", response: { token: "from-cli", tokenType: "Bearer" } });
    const config = loadDysonConfig({ HUSHJET_STATE_DIR: dir, DYSON_SERIAL: " HJ1-US-TEST000A " });
    expect(config).toMatchObject({ token: "from-cli", tokenSource: "cli login", serial: "HJ1-US-TEST000A" });
  });

  it("says how to get a token when there is none", () => {
    for (const saved of [undefined, "not json", { response: {} }]) {
      const dir = stateDir(saved);
      expect(() => loadDysonConfig({ HUSHJET_STATE_DIR: dir })).toThrow(DysonConfigError);
      expect(() => loadDysonConfig({ HUSHJET_STATE_DIR: dir })).toThrow("run `hushjet login` in cli/");
      expect(dysonTokenSource({ HUSHJET_STATE_DIR: dir })).toBeNull();
    }
  });

  it("uses the China host for CN and rejects other nonsense", () => {
    expect(loadDysonConfig({ DYSON_TOKEN: "t", DYSON_COUNTRY: "cn" }).baseUrl).toBe(API_BASE_CN);
    expect(() => loadDysonConfig({ DYSON_TOKEN: "t", DYSON_COUNTRY: "USA" })).toThrow("two-letter code");
  });
});

describe("cliAuthFile", () => {
  it("defaults to ~/.config/hushjet and expands ~", () => {
    expect(cliAuthFile({})).toBe(path.join(os.homedir(), ".config", "hushjet", "auth.json"));
    expect(cliAuthFile({ HUSHJET_STATE_DIR: "~/elsewhere" })).toBe(path.join(os.homedir(), "elsewhere", "auth.json"));
  });
});
