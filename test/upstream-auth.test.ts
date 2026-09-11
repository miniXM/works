import { describe, expect, it } from "vitest";
import { clientBearerAuthorization, ToolGatewayAuthError, upstreamAuthHeaders, upstreamAuthorization } from "../src/upstream-auth.js";

describe("stateless upstream authentication", () => {
  it("passes the client Bearer credential through by default", () => {
    expect(upstreamAuthorization({ authorization: "Bearer client-secret" }, { upstreamBearerToken: "deployer-secret" }))
      .toBe("Bearer client-secret");
  });

  it("matches header and scheme casing and emits a canonical header", () => {
    expect(clientBearerAuthorization({ Authorization: "bearer client-secret" })).toBe("Bearer client-secret");
    expect(upstreamAuthHeaders({ AUTHORIZATION: "BEARER client-secret" }, {})).toEqual({ authorization: "Bearer client-secret" });
  });

  it("uses the deployer credential only when the client omitted Authorization", () => {
    expect(upstreamAuthorization({}, { upstreamBearerToken: "deployer-secret" })).toBe("Bearer deployer-secret");
    expect(upstreamAuthorization({}, {})).toBeUndefined();
  });

  it.each([
    "Basic client-secret",
    "Bearer",
    "Bearer first, Bearer second",
    "Bearer secret value",
    "Bearer 密钥",
    "Bearer secret\r\ninjected: value",
  ])("rejects malformed credentials instead of falling back: %s", (authorization) => {
    expect(() => upstreamAuthorization({ authorization }, { upstreamBearerToken: "deployer-secret" }))
      .toThrowError(ToolGatewayAuthError);
  });

  it("rejects duplicate or array-valued Authorization headers", () => {
    expect(() => clientBearerAuthorization({ authorization: ["Bearer first", "Bearer second"] })).toThrowError(ToolGatewayAuthError);
    expect(() => clientBearerAuthorization({ authorization: "Bearer first", Authorization: "Bearer second" })).toThrowError(ToolGatewayAuthError);
  });

  it("does not include credentials in validation errors", () => {
    const secret = "private-secret-value";
    try {
      clientBearerAuthorization({ authorization: `Basic ${secret}` });
      throw new Error("expected authentication to fail");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
