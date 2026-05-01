import { describe, expect, it } from "vitest";
import { extractTextFromGatewayMessage, mapGatewayContentToParts, stripInboundWrapperText } from "./gatewayMessages";

describe("stripInboundWrapperText", () => {
  it("removes leading inbound metadata blocks and keeps user text", () => {
    const input = [
      "Conversation info (untrusted metadata):",
      "```json",
      '{"message_id":"abc"}',
      "```",
      "",
      "Sender (untrusted metadata):",
      "```json",
      '{"label":"Alice"}',
      "```",
      "",
      "你好",
    ].join("\n");

    expect(stripInboundWrapperText(input)).toBe("你好");
  });

  it("cleans metadata split across text content parts", () => {
    const message = {
      content: [
        { type: "text" as const, text: "Sender (untrusted metadata):" },
        { type: "text" as const, text: "```json" },
        { type: "text" as const, text: '{"label":"Alice"}' },
        { type: "text" as const, text: "```" },
        { type: "text" as const, text: "实际消息" },
      ],
    };

    expect(extractTextFromGatewayMessage(message)).toBe("实际消息");
    expect(mapGatewayContentToParts(message)).toEqual([{ kind: "text", text: "实际消息" }]);
  });

  it("treats metadata-only gateway-client messages as internal", async () => {
    const { isInternalOpenClawMessage } = await import("./gatewayMessages");
    const message = {
      role: "assistant",
      senderLabel: "gateway-client",
      text: [
        "Sender (untrusted metadata):",
        "```json",
        '{"label":"gateway-client","id":"gateway-client"}',
        "```",
      ].join("\n"),
    };

    expect(isInternalOpenClawMessage(message)).toBe(true);
  });
});
