import { describe, expect, test, mock, afterEach } from "bun:test";
import { sendChatAction, TelegramChatAction } from "../telegram";

describe("sendChatAction", () => {
  const originalFetch = globalThis.fetch;
  const mockBotToken = "test-bot-token-123";
  const mockChatId = 123456789;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends typing action successfully", async () => {
    const mockFetch = mock().mockResolvedValue({
      ok: true,
      status: 200,
    }) as unknown as typeof fetch;

    globalThis.fetch = mockFetch;

    await sendChatAction(mockBotToken, mockChatId, "typing");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${mockBotToken}/sendChatAction`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: mockChatId,
          action: "typing",
        }),
      },
    );
  });

  test("sends upload_document action successfully", async () => {
    const mockFetch = mock().mockResolvedValue({
      ok: true,
      status: 200,
    }) as unknown as typeof fetch;

    globalThis.fetch = mockFetch;

    await sendChatAction(mockBotToken, mockChatId, "upload_document");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${mockBotToken}/sendChatAction`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: mockChatId,
          action: "upload_document",
        }),
      },
    );
  });

  test("handles all valid Telegram chat action types", async () => {
    const validActions: TelegramChatAction[] = [
      "typing",
      "upload_photo",
      "record_video",
      "upload_video",
      "record_voice",
      "upload_voice",
      "upload_document",
      "find_location",
      "record_video_note",
      "upload_video_note",
    ];

    const mockFetch = mock().mockResolvedValue({
      ok: true,
      status: 200,
    }) as unknown as typeof fetch;

    globalThis.fetch = mockFetch;

    for (const action of validActions) {
      await sendChatAction(mockBotToken, mockChatId, action);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${mockBotToken}/sendChatAction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: mockChatId,
            action: action,
          }),
        },
      );
    }

    expect(mockFetch).toHaveBeenCalledTimes(validActions.length);
  });

  test("throws error on API error response", async () => {
    const mockFetch = mock().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "Bad Request: chat not found",
    }) as unknown as typeof fetch;

    globalThis.fetch = mockFetch;

    await expect(
      sendChatAction(mockBotToken, mockChatId, "typing"),
    ).rejects.toThrow("Telegram API error (400): Bad Request: chat not found");
  });

  test("throws error on unauthorized response", async () => {
    const mockFetch = mock().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Unauthorized",
    }) as unknown as typeof fetch;

    globalThis.fetch = mockFetch;

    await expect(
      sendChatAction(mockBotToken, mockChatId, "typing"),
    ).rejects.toThrow("Telegram API error (401): Unauthorized");
  });

  test("throws error on network failure", async () => {
    const mockFetch = mock().mockRejectedValue(
      new Error("Network Error"),
    ) as unknown as typeof fetch;

    globalThis.fetch = mockFetch;

    await expect(
      sendChatAction(mockBotToken, mockChatId, "typing"),
    ).rejects.toThrow("Network Error");
  });

  test("includes correct headers in request", async () => {
    const mockFetch = mock().mockResolvedValue({
      ok: true,
      status: 200,
    }) as unknown as typeof fetch;

    globalThis.fetch = mockFetch;

    await sendChatAction(mockBotToken, mockChatId, "typing");

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1]?.headers).toEqual({
      "Content-Type": "application/json",
    });
  });

  test("uses POST method", async () => {
    const mockFetch = mock().mockResolvedValue({
      ok: true,
      status: 200,
    }) as unknown as typeof fetch;

    globalThis.fetch = mockFetch;

    await sendChatAction(mockBotToken, mockChatId, "typing");

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1]?.method).toBe("POST");
  });

  test("formats correct API URL with bot token", async () => {
    const mockFetch = mock().mockResolvedValue({
      ok: true,
      status: 200,
    }) as unknown as typeof fetch;

    globalThis.fetch = mockFetch;

    await sendChatAction(mockBotToken, mockChatId, "typing");

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe(
      `https://api.telegram.org/bot${mockBotToken}/sendChatAction`,
    );
  });
});
