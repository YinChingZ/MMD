import type { InputImageInput } from "./api";

export const MAX_INPUT_IMAGES = 3;
export const MAX_INPUT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_INPUT_IMAGE_BYTES = 12 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface SelectedImage extends InputImageInput {
  id: string;
  name: string;
  bytes: number;
}

export function validateImageFiles(
  files: readonly Pick<File, "type" | "size">[],
  existing: readonly Pick<SelectedImage, "bytes">[] = []
): string | undefined {
  if (existing.length + files.length > MAX_INPUT_IMAGES) {
    return `You can attach at most ${MAX_INPUT_IMAGES} images.`;
  }
  let totalBytes = existing.reduce((sum, image) => sum + image.bytes, 0);
  for (const file of files) {
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      return "Only JPEG, PNG, and WebP images are supported.";
    }
    if (file.size === 0 || file.size > MAX_INPUT_IMAGE_BYTES) {
      return "Each image must be between 1 byte and 5MB.";
    }
    totalBytes += file.size;
  }
  return totalBytes > MAX_TOTAL_INPUT_IMAGE_BYTES
    ? "Attached images must total 12MB or less."
    : undefined;
}

export async function readImageFiles(files: readonly File[]): Promise<SelectedImage[]> {
  return Promise.all(
    files.map(async (file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      bytes: file.size,
      dataUrl: await readAsDataUrl(file),
    }))
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read image."));
      } else {
        resolve(reader.result);
      }
    };
    reader.readAsDataURL(file);
  });
}
