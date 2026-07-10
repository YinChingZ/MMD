"use client";

import { useState } from "react";
import { messages } from "@/lib/messages";
import { Dialog, DialogContent } from "./ui/dialog";

/** 已发送消息附带图片的回看：缩略图行，点击弹出原图。 */
export function ImageThumbnails({
  images,
}: {
  images: { dataUrl: string }[];
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (images.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {images.map((image, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setOpenIndex(i)}
            className="overflow-hidden rounded-sm border border-border transition-opacity hover:opacity-80"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.dataUrl}
              alt=""
              className="h-14 w-14 object-cover"
            />
          </button>
        ))}
      </div>
      <Dialog
        open={openIndex !== null}
        onOpenChange={(open) => !open && setOpenIndex(null)}
      >
        <DialogContent title={messages.images.viewTitle} className="max-w-2xl">
          {openIndex !== null && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={images[openIndex].dataUrl}
              alt=""
              className="mt-3 max-h-[75vh] w-full rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
