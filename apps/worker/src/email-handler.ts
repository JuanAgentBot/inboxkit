/**
 * Cloudflare Email Worker handler.
 *
 * Receives inbound email via catch-all Email Routing, parses it with
 * postal-mime, stores the raw email in R2, and saves metadata + bodies in D1.
 */

import PostalMime from "postal-mime";
import type { Env } from "./types";

/**
 * Extract the local part from an email address.
 * "zero@example.com" → "zero"
 */
function localPart(address: string): string {
  const at = address.indexOf("@");
  return at === -1 ? address : address.slice(0, at);
}

export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  const toLocal = localPart(message.to);

  // Look up inbox by address (local part)
  const inbox = await env.DB.prepare("SELECT id FROM inboxes WHERE address = ?")
    .bind(toLocal)
    .first<{ id: string }>();

  if (!inbox) {
    message.setReject("Unknown recipient");
    return;
  }

  // Read raw email into a buffer (needed for both R2 and parsing)
  const rawBytes = await new Response(message.raw).arrayBuffer();

  const messageId = crypto.randomUUID();
  const rawKey = `${inbox.id}/${messageId}/raw.eml`;

  // Store raw email in R2
  await env.STORAGE.put(rawKey, rawBytes);

  // Parse email
  const parsed = await PostalMime.parse(rawBytes);

  const fromAddress = message.from;
  const fromName = parsed.from?.name || null;
  const subject = parsed.subject || "";
  const textBody = parsed.text || null;
  const htmlBody = parsed.html || null;
  const receivedAt = new Date().toISOString();

  // Store metadata in D1
  await env.DB.prepare(
    `INSERT INTO messages (id, inbox_id, from_address, from_name, subject, text_body, html_body, raw_size, raw_key, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      messageId,
      inbox.id,
      fromAddress,
      fromName,
      subject,
      textBody,
      htmlBody,
      message.rawSize,
      rawKey,
      receivedAt,
    )
    .run();
}
