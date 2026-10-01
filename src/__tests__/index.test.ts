import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { sendCommandReply } from "../index";

describe("sendCommandReply", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends formatted reply using MarkdownV2 if plainText is false", async () => {
    let capturedUrl: string | URL | Request = "";
    let capturedOpts: RequestInit | undefined;

    const fetchMock = mock(async (url: any, opts: any) => {
      capturedUrl = url;
      capturedOpts = opts;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const replyText = "hello (world)";
    await sendCommandReply(12345, replyText, "fake_token", "MarkdownV2", false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedUrl.toString()).toContain("botfake_token/sendMessage");

    const body = JSON.parse(capturedOpts?.body as string);
    expect(body.chat_id).toBe(12345);
    expect(body.parse_mode).toBe("MarkdownV2");
    expect(body.text).toContain("\\(world\\)");
  });

  it("sends unformatted reply without parse_mode if plainText is true", async () => {
    let capturedOpts: RequestInit | undefined;

    const fetchMock = mock(async (url: any, opts: any) => {
      capturedOpts = opts;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const replyText = "hello (world)";
    await sendCommandReply(12345, replyText, "fake_token", "MarkdownV2", true);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = JSON.parse(capturedOpts?.body as string);
    expect(body.chat_id).toBe(12345);
    expect(body.parse_mode).toBeUndefined();
    expect(body.text).toBe("hello (world)");
  });

  it("retries as plain text if the initial MarkdownV2 request fails (e.g. 400)", async () => {
    const fetchMock = mock(async (url: any, opts: any) => {
      const body = JSON.parse((opts?.body as string) || "{}");
      if (body.parse_mode === "MarkdownV2") {
        return new Response(JSON.stringify({ ok: false, description: "Bad Request" }), { status: 400 });
      } else {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const replyText = "hello *world*";
    await sendCommandReply(12345, replyText, "fake_token", "MarkdownV2", false);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstCallArgs = fetchMock.mock.calls[0];
    const secondCallArgs = fetchMock.mock.calls[1];

    const firstBody = JSON.parse(firstCallArgs[1]?.body as string);
    expect(firstBody.parse_mode).toBe("MarkdownV2");

    const secondBody = JSON.parse(secondCallArgs[1]?.body as string);
    expect(secondBody.parse_mode).toBeUndefined();
    expect(secondBody.text).toBe("hello *world*");
  });

  it("swallows errors and logs if the plain text fallback also fails", async () => {
    const fetchMock = mock(async (url: any, opts: any) => {
      return new Response(JSON.stringify({ ok: false }), { status: 500 });
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const replyText = "hello";
    await sendCommandReply(12345, replyText, "fake_token", "MarkdownV2", false);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
