/**
 * Send email via Resend API.
 */

export interface SendOptions {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface SendResult {
  id: string;
}

export class SendError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SendError";
  }
}

const RESEND_API_URL = "https://api.resend.com/emails";

export async function sendEmail(
  apiKey: string,
  options: SendOptions,
): Promise<SendResult> {
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: options.from,
      to: [options.to],
      subject: options.subject,
      text: options.text,
      html: options.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new SendError(res.status, `Resend API error (${res.status}): ${body}`);
  }

  return (await res.json()) as SendResult;
}
