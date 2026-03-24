import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
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

interface SendResponse {
  id: string;
  inbox_id: string;
  from: string;
  to: string;
  subject: string;
  direction: string;
  sent_at: string;
}

// Mock fetch to intercept Resend API calls
const originalFetch = globalThis.fetch;

function mockResendSuccess(resendId = "resend-test-123") {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "https://api.resend.com/emails") {
      return new Response(JSON.stringify({ id: resendId }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

function mockResendFailure(status: number, message: string) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "https://api.resend.com/emails") {
      return new Response(JSON.stringify({ message }), { status });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

describe("POST /api/messages (send email)", () => {
  const app = createApp();

  // Env with send config
  const sendEnv = {
    ...env,
    RESEND_API_KEY: "re_test_key",
    MAIL_DOMAIN: "example.com",
  };

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
        to_address TEXT,
        subject TEXT DEFAULT '',
        text_body TEXT,
        html_body TEXT,
        raw_size INTEGER NOT NULL,
        raw_key TEXT NOT NULL,
        direction TEXT NOT NULL DEFAULT 'inbound',
        received_at TEXT NOT NULL
      )`
    ).run();
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM messages").run();
    await env.DB.prepare("DELETE FROM inboxes").run();
    globalThis.fetch = originalFetch;
  });

  async function createInbox(
    address: string,
    displayName?: string,
  ): Promise<Inbox> {
    const body: Record<string, string> = { address };
    if (displayName) body.display_name = displayName;

    const res = await app.request(
      "/api/inboxes",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      sendEnv,
    );
    return (await res.json()) as Inbox;
  }

  function send(body: unknown, envOverride: Env = sendEnv) {
    return app.request(
      "/api/messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      envOverride,
    );
  }

  it("sends a text email", async () => {
    mockResendSuccess();
    const inbox = await createInbox("zero");

    const res = await send({
      inbox_id: inbox.id,
      to: "alice@example.com",
      subject: "Hello",
      text: "Hi Alice",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as SendResponse;
    expect(body.from).toBe("zero@example.com");
    expect(body.to).toBe("alice@example.com");
    expect(body.subject).toBe("Hello");
    expect(body.direction).toBe("outbound");
    expect(body.sent_at).toBeDefined();
  });

  it("sends an html email", async () => {
    mockResendSuccess();
    const inbox = await createInbox("zero");

    const res = await send({
      inbox_id: inbox.id,
      to: "bob@example.com",
      subject: "HTML email",
      html: "<p>Hello Bob</p>",
    });

    expect(res.status).toBe(201);
  });

  it("sends with both text and html", async () => {
    mockResendSuccess();
    const inbox = await createInbox("zero");

    const res = await send({
      inbox_id: inbox.id,
      to: "carol@example.com",
      subject: "Both",
      text: "Plain text",
      html: "<p>Rich text</p>",
    });

    expect(res.status).toBe(201);
  });

  it("uses display name in from header", async () => {
    mockResendSuccess();
    const inbox = await createInbox("zero", "Zero Agent");

    await send({
      inbox_id: inbox.id,
      to: "alice@example.com",
      subject: "Named",
      text: "Hi",
    });

    // Verify the Resend API was called with display name
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const reqBody = JSON.parse((fetchCall as [string, RequestInit])[1].body as string);
    expect(reqBody.from).toBe("Zero Agent <zero@example.com>");
  });

  it("stores the sent message in D1", async () => {
    mockResendSuccess();
    const inbox = await createInbox("zero");

    const res = await send({
      inbox_id: inbox.id,
      to: "alice@example.com",
      subject: "Stored",
      text: "Check D1",
    });

    const body = (await res.json()) as SendResponse;

    // Verify message is in D1
    const msg = await env.DB.prepare("SELECT * FROM messages WHERE id = ?")
      .bind(body.id)
      .first();
    expect(msg).not.toBeNull();
    expect(msg!.direction).toBe("outbound");
    expect(msg!.to_address).toBe("alice@example.com");
    expect(msg!.from_address).toBe("zero@example.com");
    expect(msg!.text_body).toBe("Check D1");
  });

  it("stores the composed email in R2", async () => {
    mockResendSuccess("resend-r2-test");
    const inbox = await createInbox("zero");

    const res = await send({
      inbox_id: inbox.id,
      to: "alice@example.com",
      subject: "R2 test",
      text: "Check R2",
    });

    const body = (await res.json()) as SendResponse;

    // Verify raw email is in R2
    const msg = await env.DB.prepare("SELECT raw_key FROM messages WHERE id = ?")
      .bind(body.id)
      .first<{ raw_key: string }>();
    const object = await env.STORAGE.get(msg!.raw_key);
    expect(object).not.toBeNull();

    const raw = await object!.text();
    expect(raw).toContain("From: zero@example.com");
    expect(raw).toContain("To: alice@example.com");
    expect(raw).toContain("Subject: R2 test");
    expect(raw).toContain("X-Resend-Id: resend-r2-test");
  });

  it("rejects missing body content", async () => {
    const inbox = await createInbox("zero");
    const res = await send({
      inbox_id: inbox.id,
      to: "alice@example.com",
      subject: "No body",
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid email address", async () => {
    const inbox = await createInbox("zero");
    const res = await send({
      inbox_id: inbox.id,
      to: "not-an-email",
      subject: "Bad to",
      text: "Hi",
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for nonexistent inbox", async () => {
    mockResendSuccess();
    const res = await send({
      inbox_id: "nonexistent",
      to: "alice@example.com",
      subject: "No inbox",
      text: "Hi",
    });
    expect(res.status).toBe(404);
  });

  it("returns 503 when RESEND_API_KEY is missing", async () => {
    const inbox = await createInbox("zero");
    const res = await send(
      {
        inbox_id: inbox.id,
        to: "alice@example.com",
        subject: "No key",
        text: "Hi",
      },
      { ...env, MAIL_DOMAIN: "example.com" },
    );
    expect(res.status).toBe(503);
  });

  it("returns 503 when MAIL_DOMAIN is missing", async () => {
    const inbox = await createInbox("zero");
    const res = await send(
      {
        inbox_id: inbox.id,
        to: "alice@example.com",
        subject: "No domain",
        text: "Hi",
      },
      { ...env, RESEND_API_KEY: "re_test" },
    );
    expect(res.status).toBe(503);
  });

  it("returns 502 when Resend API fails", async () => {
    mockResendFailure(403, "Invalid API key");
    const inbox = await createInbox("zero");

    const res = await send({
      inbox_id: inbox.id,
      to: "alice@example.com",
      subject: "Fail",
      text: "Hi",
    });

    expect(res.status).toBe(502);
  });
});
