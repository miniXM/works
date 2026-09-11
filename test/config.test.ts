import { describe, expect, it } from "vitest";
import { loadToolGatewayConfig } from "../src/config.js";

describe("tool gateway config", () => {
  it("loads a deployer-owned upstream with conservative defaults", () => {
    expect(loadToolGatewayConfig({ MINIXM_TOOL_GATEWAY_UPSTREAM_URL: " https://llm.example.test/v1/ " })).toEqual({
      host: "127.0.0.1",
      port: 31006,
      upstreamUrl: "https://llm.example.test/v1",
      upstreamBearerToken: undefined,
      upstreamTimeoutMs: 240_000,
    });
  });

  it("reads an optional fallback credential without persisting it", () => {
    const config = loadToolGatewayConfig({
      MINIXM_TOOL_GATEWAY_UPSTREAM_URL: "http://127.0.0.1:3000",
      MINIXM_TOOL_GATEWAY_UPSTREAM_BEARER_TOKEN: " deployer-secret ",
      MINIXM_TOOL_GATEWAY_HOST: "0.0.0.0",
      MINIXM_TOOL_GATEWAY_PORT: "32006",
      MINIXM_TOOL_GATEWAY_UPSTREAM_TIMEOUT_MS: "130000",
    });
    expect(config).toMatchObject({
      host: "0.0.0.0",
      port: 32006,
      upstreamUrl: "http://127.0.0.1:3000",
      upstreamBearerToken: "deployer-secret",
      upstreamTimeoutMs: 130_000,
    });
  });

  it.each([
    {},
    { MINIXM_TOOL_GATEWAY_UPSTREAM_URL: "file:///tmp/model" },
    { MINIXM_TOOL_GATEWAY_UPSTREAM_URL: "https://user:pass@example.test" },
    { MINIXM_TOOL_GATEWAY_UPSTREAM_URL: "https://example.test?token=secret" },
  ])("rejects missing or unsafe upstream URLs", (env) => {
    expect(() => loadToolGatewayConfig(env)).toThrow(/UPSTREAM_URL/);
  });

  it("rejects invalid numeric configuration", () => {
    expect(() => loadToolGatewayConfig({ MINIXM_TOOL_GATEWAY_UPSTREAM_URL: "https://example.test", MINIXM_TOOL_GATEWAY_PORT: "0" })).toThrow(/PORT/);
    expect(() => loadToolGatewayConfig({ MINIXM_TOOL_GATEWAY_UPSTREAM_URL: "https://example.test", MINIXM_TOOL_GATEWAY_UPSTREAM_TIMEOUT_MS: "fast" })).toThrow(/TIMEOUT/);
  });

  it.each(["two words", "token,second", "secret\r\ninjected:value"])("rejects an unsafe configured Bearer token", (token) => {
    expect(() => loadToolGatewayConfig({
      MINIXM_TOOL_GATEWAY_UPSTREAM_URL: "https://example.test",
      MINIXM_TOOL_GATEWAY_UPSTREAM_BEARER_TOKEN: token,
    })).toThrow(/BEARER_TOKEN/);
  });
});
