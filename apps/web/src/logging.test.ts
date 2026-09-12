import { afterEach, describe, expect, it, vi } from "vitest";

import { logError } from "./logging.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logError", () => {
  it("logs only an error message, never sensitive fields carried by the error object", () => {
    const secret = "database-password-must-not-reach-logs";
    const error = Object.assign(new Error("Postgres connection failed"), {
      connectionParameters: { password: secret },
    });
    const write = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logError("request failed", error, { method: "POST", status: 500 });

    expect(write).toHaveBeenCalledOnce();
    const line = String(write.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      level: "error",
      msg: "request failed",
      method: "POST",
      status: 500,
      error: "Postgres connection failed",
    });
    expect(line).not.toContain(secret);
    expect(line).not.toContain("connectionParameters");
  });
});
