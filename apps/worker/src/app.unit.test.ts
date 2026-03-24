import { describe, it, expect } from "vitest";
import { createApp } from "./app";

describe("app", () => {
  const app = createApp();

  it("GET /api/health returns service info", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      service: "inboxkit",
      version: "0.1.0",
    });
  });

  it("GET /unknown returns 404", async () => {
    const res = await app.request("/unknown");
    expect(res.status).toBe(404);
  });
});
