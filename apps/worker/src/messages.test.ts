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
}

interface MessageSummary {
  id: string;
  inbox_id: string;
  from_address: string;
  from_name: string | null;
  subject: string;
  raw_size: number;
  received_at: string;
}

interface Message extends MessageSummary {
  text_body: string | null;
  html_body: string | null;
  raw_key: string;
}

describe("message endpoints", () => {
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
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        inbox_id TEXT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
        from_address TEXT NOT NULL,
        from_name TEXT,
        subject TEXT DEFAULT '',
        text_body TEXT,
        html_body TEXT,
        raw_size INTEGER NOT NULL,
        raw_key TEXT NOT NULL,
        received_at TEXT NOT NULL
      )`
    ).run();
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM messages").run();
    await env.DB.prepare("DELETE FROM inboxes").run();
  });

  async function createInbox(address: string): Promise<Inbox> {
    const res = await app.request(
      "/api/inboxes",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      },
      env,
    );
    return (await res.json()) as Inbox;
  }

  async function insertMessage(
    inboxId: string,
    opts: { from?: string; fromName?: string; subject?: string; text?: string; html?: string } = {},
  ): Promise<string> {
    const id = crypto.randomUUID();
    const rawKey = `${inboxId}/${id}/raw.eml`;
    const rawContent = `From: ${opts.from ?? "sender@example.com"}\nSubject: ${opts.subject ?? "Hello"}\n\n${opts.text ?? "body"}`;

    // Store raw email in R2
    await env.STORAGE.put(rawKey, rawContent);

    await env.DB.prepare(
      `INSERT INTO messages (id, inbox_id, from_address, from_name, subject, text_body, html_body, raw_size, raw_key, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        inboxId,
        opts.from ?? "sender@example.com",
        opts.fromName ?? null,
        opts.subject ?? "Hello",
        opts.text ?? "body",
        opts.html ?? null,
        rawContent.length,
        rawKey,
        new Date().toISOString(),
      )
      .run();
    return id;
  }

  function get(path: string) {
    return app.request(path, {}, env);
  }

  describe("GET /api/inboxes/:id/messages", () => {
    it("returns empty list for inbox with no messages", async () => {
      const inbox = await createInbox("empty");
      const res = await get(`/api/inboxes/${inbox.id}/messages`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("returns messages for an inbox", async () => {
      const inbox = await createInbox("test");
      await insertMessage(inbox.id, { subject: "First" });
      await insertMessage(inbox.id, { subject: "Second" });

      const res = await get(`/api/inboxes/${inbox.id}/messages`);
      expect(res.status).toBe(200);

      const messages = (await res.json()) as MessageSummary[];
      expect(messages).toHaveLength(2);
      expect(messages[0].subject).toBeDefined();
      expect(messages[0].inbox_id).toBe(inbox.id);
    });

    it("does not include message bodies in list", async () => {
      const inbox = await createInbox("nobody");
      await insertMessage(inbox.id, { text: "secret" });

      const res = await get(`/api/inboxes/${inbox.id}/messages`);
      const messages = (await res.json()) as Record<string, unknown>[];
      expect(messages).toHaveLength(1);
      expect(messages[0].text_body).toBeUndefined();
      expect(messages[0].html_body).toBeUndefined();
    });

    it("does not return messages from other inboxes", async () => {
      const inbox1 = await createInbox("one");
      const inbox2 = await createInbox("two");
      await insertMessage(inbox1.id, { subject: "For one" });
      await insertMessage(inbox2.id, { subject: "For two" });

      const res = await get(`/api/inboxes/${inbox1.id}/messages`);
      const messages = (await res.json()) as MessageSummary[];
      expect(messages).toHaveLength(1);
      expect(messages[0].subject).toBe("For one");
    });

    it("returns 404 for nonexistent inbox", async () => {
      const res = await get("/api/inboxes/nonexistent/messages");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/messages/:id", () => {
    it("returns a message with bodies", async () => {
      const inbox = await createInbox("detail");
      const msgId = await insertMessage(inbox.id, {
        from: "alice@example.com",
        fromName: "Alice",
        subject: "Test",
        text: "Hello world",
        html: "<p>Hello world</p>",
      });

      const res = await get(`/api/messages/${msgId}`);
      expect(res.status).toBe(200);

      const msg = (await res.json()) as Message;
      expect(msg.id).toBe(msgId);
      expect(msg.from_address).toBe("alice@example.com");
      expect(msg.from_name).toBe("Alice");
      expect(msg.subject).toBe("Test");
      expect(msg.text_body).toBe("Hello world");
      expect(msg.html_body).toBe("<p>Hello world</p>");
      expect(msg.raw_key).toContain("raw.eml");
    });

    it("returns 404 for nonexistent message", async () => {
      const res = await get("/api/messages/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/messages/:id/raw", () => {
    it("returns the raw email from R2", async () => {
      const inbox = await createInbox("raw");
      const msgId = await insertMessage(inbox.id, {
        from: "bob@example.com",
        subject: "Raw test",
        text: "raw body",
      });

      const res = await get(`/api/messages/${msgId}/raw`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("message/rfc822");

      const body = await res.text();
      expect(body).toContain("bob@example.com");
      expect(body).toContain("Raw test");
    });

    it("returns 404 for nonexistent message", async () => {
      const res = await get("/api/messages/nonexistent/raw");
      expect(res.status).toBe(404);
    });
  });
});
