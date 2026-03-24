/**
 * HTTP API using Hono.
 */

import { Hono } from "hono";
import { z } from "zod";
import { sendEmail, SendError } from "./send";
import type { Env } from "./types";

const CreateInboxSchema = z.object({
  address: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, "Only letters, numbers, dots, hyphens, underscores"),
  display_name: z.string().max(256).optional(),
});

const SendMessageSchema = z.object({
  inbox_id: z.string().min(1),
  to: z.string().email(),
  subject: z.string().max(998),
  text: z.string().optional(),
  html: z.string().optional(),
}).refine((data) => data.text || data.html, {
  message: "At least one of text or html is required",
});

export const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/health", (c) =>
    c.json({ ok: true, service: "inboxkit", version: "0.1.0" })
  );

  app.post("/api/inboxes", async (c) => {
    const body = await c.req.json();
    const parsed = CreateInboxSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const { address, display_name } = parsed.data;
    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();

    try {
      await c.env.DB.prepare(
        "INSERT INTO inboxes (id, address, display_name, created_at) VALUES (?, ?, ?, ?)"
      )
        .bind(id, address, display_name ?? null, created_at)
        .run();
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
        return c.json({ error: "Address already exists" }, 409);
      }
      throw e;
    }

    return c.json(
      { id, address, display_name: display_name ?? null, created_at },
      201
    );
  });

  app.get("/api/inboxes", async (c) => {
    const result = await c.env.DB.prepare(
      "SELECT * FROM inboxes ORDER BY created_at DESC"
    ).all();
    return c.json(result.results);
  });

  app.get("/api/inboxes/:id", async (c) => {
    const { id } = c.req.param();
    const inbox = await c.env.DB.prepare("SELECT * FROM inboxes WHERE id = ?")
      .bind(id)
      .first();
    if (!inbox) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(inbox);
  });

  app.delete("/api/inboxes/:id", async (c) => {
    const { id } = c.req.param();
    const result = await c.env.DB.prepare("DELETE FROM inboxes WHERE id = ?")
      .bind(id)
      .run();
    if (result.meta.changes === 0) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.body(null, 204);
  });

  // -- Messages --

  app.get("/api/inboxes/:id/messages", async (c) => {
    const { id } = c.req.param();

    const inbox = await c.env.DB.prepare("SELECT id FROM inboxes WHERE id = ?")
      .bind(id)
      .first();
    if (!inbox) {
      return c.json({ error: "Not found" }, 404);
    }

    const result = await c.env.DB.prepare(
      "SELECT id, inbox_id, from_address, from_name, subject, raw_size, received_at FROM messages WHERE inbox_id = ? ORDER BY received_at DESC"
    )
      .bind(id)
      .all();
    return c.json(result.results);
  });

  app.get("/api/messages/:id", async (c) => {
    const { id } = c.req.param();
    const message = await c.env.DB.prepare("SELECT * FROM messages WHERE id = ?")
      .bind(id)
      .first();
    if (!message) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(message);
  });

  app.get("/api/messages/:id/raw", async (c) => {
    const { id } = c.req.param();
    const message = await c.env.DB.prepare(
      "SELECT raw_key FROM messages WHERE id = ?"
    )
      .bind(id)
      .first<{ raw_key: string }>();
    if (!message) {
      return c.json({ error: "Not found" }, 404);
    }

    const object = await c.env.STORAGE.get(message.raw_key);
    if (!object) {
      return c.json({ error: "Raw email not found in storage" }, 404);
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": "message/rfc822",
        "Content-Disposition": `attachment; filename="${id}.eml"`,
      },
    });
  });

  // -- Send --

  app.post("/api/messages", async (c) => {
    const body = await c.req.json();
    const parsed = SendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const { inbox_id, to, subject, text, html } = parsed.data;

    if (!c.env.RESEND_API_KEY) {
      return c.json({ error: "Sending not configured (missing RESEND_API_KEY)" }, 503);
    }
    if (!c.env.MAIL_DOMAIN) {
      return c.json({ error: "Sending not configured (missing MAIL_DOMAIN)" }, 503);
    }

    const inbox = await c.env.DB.prepare(
      "SELECT id, address, display_name FROM inboxes WHERE id = ?"
    )
      .bind(inbox_id)
      .first<{ id: string; address: string; display_name: string | null }>();
    if (!inbox) {
      return c.json({ error: "Inbox not found" }, 404);
    }

    const fromAddress = `${inbox.address}@${c.env.MAIL_DOMAIN}`;
    const from = inbox.display_name
      ? `${inbox.display_name} <${fromAddress}>`
      : fromAddress;

    let resendId: string;
    try {
      const result = await sendEmail(c.env.RESEND_API_KEY, {
        from,
        to,
        subject,
        text,
        html,
      });
      resendId = result.id;
    } catch (e) {
      if (e instanceof SendError) {
        return c.json({ error: `Failed to send: ${e.message}` }, 502);
      }
      throw e;
    }

    const id = crypto.randomUUID();
    const sentAt = new Date().toISOString();

    // Compose a minimal representation for R2 storage
    const composed = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${sentAt}`,
      `X-Resend-Id: ${resendId}`,
      "",
      text ?? "",
    ].join("\r\n");

    const rawKey = `${inbox.id}/${id}/raw.eml`;
    await c.env.STORAGE.put(rawKey, composed);

    await c.env.DB.prepare(
      `INSERT INTO messages (id, inbox_id, from_address, from_name, to_address, subject, text_body, html_body, raw_size, raw_key, direction, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'outbound', ?)`
    )
      .bind(
        id,
        inbox.id,
        fromAddress,
        inbox.display_name,
        to,
        subject,
        text ?? null,
        html ?? null,
        composed.length,
        rawKey,
        sentAt,
      )
      .run();

    return c.json(
      {
        id,
        inbox_id: inbox.id,
        from: fromAddress,
        to,
        subject,
        direction: "outbound",
        sent_at: sentAt,
      },
      201,
    );
  });

  return app;
};
