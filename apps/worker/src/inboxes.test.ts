import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createApp } from "./app";
import type { Env } from "./types";

declare module "cloudflare:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

interface Inbox {
  id: string;
  address: string;
  display_name: string | null;
  created_at: string;
}

describe("inbox CRUD", () => {
  const app = createApp();

  beforeAll(async () => {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS inboxes (
        id TEXT PRIMARY KEY,
        address TEXT NOT NULL UNIQUE,
        display_name TEXT,
        created_at TEXT NOT NULL
      )`
    ).run();
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM inboxes").run();
  });

  function post(path: string, body: unknown) {
    return app.request(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env
    );
  }

  function get(path: string) {
    return app.request(path, {}, env);
  }

  function del(path: string) {
    return app.request(path, { method: "DELETE" }, env);
  }

  describe("POST /api/inboxes", () => {
    it("creates an inbox", async () => {
      const res = await post("/api/inboxes", { address: "test" });
      expect(res.status).toBe(201);

      const body = (await res.json()) as Inbox;
      expect(body.address).toBe("test");
      expect(body.display_name).toBeNull();
      expect(body.id).toBeDefined();
      expect(body.created_at).toBeDefined();
    });

    it("creates an inbox with display name", async () => {
      const res = await post("/api/inboxes", {
        address: "zero",
        display_name: "Zero",
      });
      expect(res.status).toBe(201);

      const body = (await res.json()) as Inbox;
      expect(body.address).toBe("zero");
      expect(body.display_name).toBe("Zero");
    });

    it("rejects empty address", async () => {
      const res = await post("/api/inboxes", { address: "" });
      expect(res.status).toBe(400);
    });

    it("rejects invalid characters", async () => {
      const res = await post("/api/inboxes", { address: "no spaces" });
      expect(res.status).toBe(400);
    });

    it("rejects duplicate address", async () => {
      await post("/api/inboxes", { address: "dupe" });
      const res = await post("/api/inboxes", { address: "dupe" });
      expect(res.status).toBe(409);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Address already exists");
    });
  });

  describe("GET /api/inboxes", () => {
    it("returns empty list", async () => {
      const res = await get("/api/inboxes");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("returns all inboxes", async () => {
      await post("/api/inboxes", { address: "a" });
      await post("/api/inboxes", { address: "b" });

      const res = await get("/api/inboxes");
      expect(res.status).toBe(200);

      const inboxes = (await res.json()) as Inbox[];
      expect(inboxes).toHaveLength(2);
    });
  });

  describe("GET /api/inboxes/:id", () => {
    it("returns an inbox", async () => {
      const created = (await (
        await post("/api/inboxes", { address: "find-me" })
      ).json()) as Inbox;

      const res = await get(`/api/inboxes/${created.id}`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Inbox;
      expect(body.address).toBe("find-me");
      expect(body.id).toBe(created.id);
    });

    it("returns 404 for unknown id", async () => {
      const res = await get("/api/inboxes/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/inboxes/:id", () => {
    it("deletes an inbox", async () => {
      const created = (await (
        await post("/api/inboxes", { address: "delete-me" })
      ).json()) as Inbox;

      const res = await del(`/api/inboxes/${created.id}`);
      expect(res.status).toBe(204);

      // Verify it's gone
      const getRes = await get(`/api/inboxes/${created.id}`);
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for unknown id", async () => {
      const res = await del("/api/inboxes/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});
