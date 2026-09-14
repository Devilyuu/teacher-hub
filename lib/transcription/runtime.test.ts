import { describe, expect, it } from "vitest";
import { selectMinutesGenerationAdapter, selectTranscriptionAdapter } from "./runtime";

describe("selectTranscriptionAdapter", () => {
  it("only enables the fake adapter through an explicit setting", () => {
    expect(selectTranscriptionAdapter({ TRANSCRIPTION_ADAPTER: "fake" }).provider).toBe("fake");
  });

  it("fails closed when the production Tencent credentials are absent", () => {
    expect(() => selectTranscriptionAdapter({})).toThrow(/腾讯云转写尚未配置/);
  });
});

describe("selectMinutesGenerationAdapter", () => {
  it("returns manual fallback when minutes settings are absent", () => {
    expect(selectMinutesGenerationAdapter({})).toBeNull();
  });

  it("only enables the fake adapter through an explicit setting", () => {
    expect(selectMinutesGenerationAdapter({ MINUTES_ADAPTER: "fake" })?.provider).toBe("fake");
  });
});
