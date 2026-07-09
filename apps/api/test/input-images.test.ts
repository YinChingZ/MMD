import { describe, expect, it } from "vitest";
import {
  MAX_INPUT_IMAGES,
  MAX_INPUT_IMAGE_BYTES,
  MAX_TOTAL_INPUT_IMAGE_BYTES,
  validateInputImages,
} from "../src/routes/runs.js";

const png = (encoded = "AQID") => ({ dataUrl: `data:image/png;base64,${encoded}` });

describe("M6.5 input-image validation", () => {
  it("accepts canonical JPEG, PNG, and WebP base64 data URLs", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validateInputImages([{ dataUrl: `data:${mime};base64,AQID` }])).toEqual({ ok: true });
    }
  });

  it("rejects unsupported, malformed, and non-canonical data URLs", () => {
    expect(validateInputImages([{ dataUrl: "data:image/gif;base64,AQID" }]).ok).toBe(false);
    expect(validateInputImages([{ dataUrl: "data:image/png;base64,AQI" }]).ok).toBe(false);
    expect(validateInputImages([{ dataUrl: "data:image/png;base64,AQ!D" }]).ok).toBe(false);
  });

  it("enforces image-count, single-image, and aggregate-byte limits", () => {
    expect(validateInputImages(Array.from({ length: MAX_INPUT_IMAGES + 1 }, () => png())).ok).toBe(false);
    const tooLarge = Buffer.alloc(MAX_INPUT_IMAGE_BYTES + 1).toString("base64");
    expect(validateInputImages([png(tooLarge)]).ok).toBe(false);
    const totalTooLarge = Buffer.alloc(MAX_TOTAL_INPUT_IMAGE_BYTES / 2 + 1).toString("base64");
    expect(validateInputImages([png(totalTooLarge), png(totalTooLarge)]).ok).toBe(false);
  });
});
