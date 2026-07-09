import { describe, expect, it } from "vitest";
import {
  MAX_INPUT_IMAGE_BYTES,
  validateImageFiles,
} from "../src/lib/image-input";

const file = (type: string, size: number) => ({ type, size }) as File;

describe("M6.5 image-input validation", () => {
  it("accepts supported files within count and byte limits", () => {
    expect(validateImageFiles([file("image/jpeg", 10), file("image/webp", 20)])).toBeUndefined();
  });

  it("rejects unsupported types, oversized files, too many files, and an oversized total", () => {
    expect(validateImageFiles([file("image/gif", 10)])).toMatch(/JPEG/);
    expect(validateImageFiles([file("image/png", MAX_INPUT_IMAGE_BYTES + 1)])).toMatch(/5MB/);
    expect(validateImageFiles([file("image/png", 1), file("image/png", 1), file("image/png", 1), file("image/png", 1)])).toMatch(/at most/);
    expect(validateImageFiles([file("image/png", 5 * 1024 * 1024), file("image/png", 5 * 1024 * 1024), file("image/png", 3 * 1024 * 1024)])).toMatch(/12MB/);
  });
});
