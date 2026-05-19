import { describe, expect, it } from "vitest";
import { buildModelOptions, canonicalizeModelRef, ensureSelectedModelOption, findGemini31ProPreviewOption, isDeprecatedGemini3ProPreview } from "./modelOptions";

describe("buildModelOptions", () => {
  it("uses Gateway model key before composing provider/id", () => {
    expect(buildModelOptions({
      models: [
        {
          id: "kimi-k2.5",
          key: "moonshot/kimi-k2.5",
          provider: "openai-codex",
          name: "Kimi K2.5",
        },
      ],
    })).toEqual([
      {
        value: "moonshot/kimi-k2.5",
        label: "Kimi K2.5 · openai-codex",
      },
    ]);
  });

  it("keeps ref as the highest-priority canonical value", () => {
    expect(buildModelOptions({
      models: [
        {
          id: "kimi-k2.5",
          key: "moonshot/kimi-k2.5",
          ref: "bailian/kimi-k2.5",
          provider: "moonshot",
          name: "Kimi K2.5",
        },
      ],
    })[0]?.value).toBe("bailian/kimi-k2.5");
  });

  it("puts the default model first and labels it", () => {
    expect(buildModelOptions({
      models: [
        { id: "kimi-k2.5", key: "moonshot/kimi-k2.5", provider: "moonshot", name: "Kimi K2.5" },
        { id: "gpt-5.5", key: "openai-codex/gpt-5.5", provider: "openai-codex", name: "GPT-5.5", tags: ["default"] },
      ],
    })).toEqual([
      { value: "openai-codex/gpt-5.5", label: "GPT-5.5 · openai-codex · 默认" },
      { value: "moonshot/kimi-k2.5", label: "Kimi K2.5 · moonshot" },
    ]);
  });

  it("uses the configured session default when Gateway model rows are not tagged", () => {
    expect(buildModelOptions({
      models: [
        { id: "kimi-k2.5", key: "moonshot/kimi-k2.5", provider: "moonshot", name: "Kimi K2.5" },
        { id: "gpt-5.5", key: "openai-codex/gpt-5.5", provider: "openai-codex", name: "GPT-5.5" },
      ],
    }, "openai-codex/gpt-5.5")).toEqual([
      { value: "openai-codex/gpt-5.5", label: "GPT-5.5 · openai-codex · 默认" },
      { value: "moonshot/kimi-k2.5", label: "Kimi K2.5 · moonshot" },
    ]);
  });

  it("adds the configured default even when it is missing from configured model rows", () => {
    expect(buildModelOptions({
      models: [
        { id: "kimi-k2.5", key: "moonshot/kimi-k2.5", provider: "moonshot", name: "Kimi K2.5" },
      ],
    }, "openai-codex/gpt-5.5")).toEqual([
      { value: "openai-codex/gpt-5.5", label: "openai-codex/gpt-5.5 · 默认" },
      { value: "moonshot/kimi-k2.5", label: "Kimi K2.5 · moonshot" },
    ]);
  });
});

describe("canonicalizeModelRef", () => {
  const options = [
    { value: "bailian/kimi-k2.5", label: "Kimi K2.5 · bailian" },
    { value: "moonshot/kimi-k2.5", label: "Kimi K2.5 · moonshot" },
  ];

  it("expands bare model ids by provider when available", () => {
    expect(canonicalizeModelRef("kimi-k2.5", options, "moonshot")).toBe("moonshot/kimi-k2.5");
  });

  it("falls back to a configured model instead of sending a bare id", () => {
    expect(canonicalizeModelRef("kimi-k2.5", options)).toBe("bailian/kimi-k2.5");
  });
});

describe("ensureSelectedModelOption", () => {
  it("keeps the default option first when adding a missing current model", () => {
    expect(ensureSelectedModelOption([
      { value: "openai-codex/gpt-5.5", label: "openai-codex/gpt-5.5 · 默认" },
      { value: "moonshot/kimi-k2.5", label: "Kimi K2.5 · moonshot" },
    ], "kimi-k2.5")).toEqual([
      { value: "openai-codex/gpt-5.5", label: "openai-codex/gpt-5.5 · 默认" },
      { value: "kimi-k2.5", label: "当前: kimi-k2.5" },
      { value: "moonshot/kimi-k2.5", label: "Kimi K2.5 · moonshot" },
    ]);
  });
});

describe("Gemini preview migration helpers", () => {
  it("detects deprecated Gemini 3 Pro preview ids", () => {
    expect(isDeprecatedGemini3ProPreview("google/gemini-3-pro-preview")).toBe(true);
    expect(isDeprecatedGemini3ProPreview("gemini-3-pro-preview")).toBe(true);
    expect(isDeprecatedGemini3ProPreview("google/gemini-3.1-pro-preview")).toBe(false);
  });

  it("finds the configured Gemini 3.1 Pro Preview option", () => {
    expect(findGemini31ProPreviewOption([
      { value: "moonshot/kimi-k2.5", label: "Kimi" },
      { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1" },
    ])).toEqual({ value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1" });
  });
});
