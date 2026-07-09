"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePanelContext } from "./WorkspaceShell";

/**
 * 页面用它把内容注入右侧决策面板（portal 到壳层的右栏容器）。
 * 面板标题随内容状态切换（准备 / 协商中 / 已完成）。
 */
export function ContextPanel({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  const ctx = usePanelContext();

  useEffect(() => {
    if (!ctx) return;
    const remove = ctx.addContent();
    return remove;
  }, [ctx]);

  useEffect(() => {
    if (!ctx) return;
    ctx.setTitle(title ?? null);
    return () => ctx.setTitle(null);
  }, [ctx, title]);

  if (!ctx?.container) return null;
  return createPortal(<div className="p-4">{children}</div>, ctx.container);
}
