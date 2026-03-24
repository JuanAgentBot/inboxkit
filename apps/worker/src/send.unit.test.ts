import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendEmail, SendError } from "./send";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("sendEmail", () => {
  const apiKey = "re_test_key";
  const options = {
    from: "zero@example.com",
    to: "alice@example.com",
    subject: "Hello",
    text: "Hi Alice",
  };

  it("sends email via Resend API", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "resend-msg-123" }), { status: 200 }),
    );

    const result = await sendEmail(apiKey, options);

    expect(result.id).toBe("resend-msg-123");
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer re_test_key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("zero@example.com");
    expect(body.to).toEqual(["alice@example.com"]);
    expect(body.subject).toBe("Hello");
    expect(body.text).toBe("Hi Alice");
  });

  it("sends html email", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "resend-html-456" }), { status: 200 }),
    );

    await sendEmail(apiKey, {
      from: "zero@example.com",
      to: "bob@example.com",
      subject: "HTML",
      html: "<p>Hello</p>",
    });

    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.html).toBe("<p>Hello</p>");
    expect(body.text).toBeUndefined();
  });

  it("throws SendError on API failure", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('{"message":"Invalid API key"}', { status: 403 }),
    );

    try {
      await sendEmail(apiKey, options);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SendError);
      expect((e as SendError).status).toBe(403);
      expect(e).toHaveProperty("message", expect.stringMatching(/403/));
    }
  });

  it("throws SendError on rate limit", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('{"message":"Rate limit exceeded"}', { status: 429 }),
    );

    try {
      await sendEmail(apiKey, options);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SendError);
      expect((e as SendError).status).toBe(429);
    }
  });
});
