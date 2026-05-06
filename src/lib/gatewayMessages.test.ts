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

  it("maps OpenClaw media attachment markers to file parts", () => {
    const message = {
      text: [
        "请看附件",
        "[media attached: /Users/zhangzy/.openclaw/media/inbound/爱宠日常费用-2026.5.6---b92e37bf-7bac-44dc-9593-443efddb38dd.xlsx (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)]",
      ].join("\n"),
    };

    expect(extractTextFromGatewayMessage(message)).toBe("请看附件");
    expect(mapGatewayContentToParts(message)).toEqual([
      { kind: "text", text: "请看附件" },
      {
        kind: "file",
        name: "爱宠日常费用-2026.5.6---b92e37bf-7bac-44dc-9593-443efddb38dd.xlsx",
        path: "/Users/zhangzy/.openclaw/media/inbound/爱宠日常费用-2026.5.6---b92e37bf-7bac-44dc-9593-443efddb38dd.xlsx",
        mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ]);
  });

  it("maps structured gateway file parts to file attachments", () => {
    const message = {
      content: [
        { type: "text" as const, text: "请看表格" },
        {
          type: "file" as const,
          path: "/tmp/report.xlsx",
          fileName: "report.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: 2048,
        },
      ],
    };

    expect(mapGatewayContentToParts(message)).toEqual([
      { kind: "text", text: "请看表格" },
      {
        kind: "file",
        name: "report.xlsx",
        path: "/tmp/report.xlsx",
        mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: 2048,
      },
    ]);
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
