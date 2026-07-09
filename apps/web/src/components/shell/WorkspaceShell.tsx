"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "../../lib/cn";
import { messages } from "../../lib/messages";
import { IconButton } from "../ui/icon-button";
import { AppSidebar } from "./AppSidebar";

interface PanelContextValue {
  container: HTMLElement | null;
  /** ContextPanel 挂载/卸载时增减，决定右栏是否显示 */
  addContent: () => () => void;
  setTitle: (title: string | null) => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

export function usePanelContext(): PanelContextValue | null {
  return useContext(PanelContext);
}

const COLLAPSE_KEY = "mmd.panel.collapsed";

/**
 * 三栏桌面工作区：左侧 272px 侧栏 / 中央内容 / 右侧 320px 决策面板。
 * 右栏内容由页面通过 <ContextPanel> 注入（portal），无内容时整栏隐藏。
 */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [contentCount, setContentCount] = useState(0);
  const [title, setTitle] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      localStorage.setItem(COLLAPSE_KEY, prev ? "0" : "1");
      return !prev;
    });
  };

  const addContent = useCallback(() => {
    setContentCount((n) => n + 1);
    return () => setContentCount((n) => n - 1);
  }, []);

  const hasPanel = contentCount > 0;

  return (
    <PanelContext.Provider value={{ container, addContent, setTitle }}>
      <div className="flex h-screen overflow-hidden bg-background">
        <AppSidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        <aside
          className={cn(
            "hidden shrink-0 border-l border-border bg-surface transition-[width] duration-200 lg:flex lg:flex-col",
            !hasPanel && "lg:hidden",
            collapsed ? "w-12" : "w-80",
          )}
        >
          <div
            className={cn(
              "flex h-12 shrink-0 items-center border-b border-border",
              collapsed ? "justify-center" : "justify-between pl-4 pr-2",
            )}
          >
            {!collapsed && (
              <span className="truncate text-sm font-medium text-ink">
                {title ?? messages.shell.panelTitle}
              </span>
            )}
            <IconButton
              size="sm"
              label={
                collapsed
                  ? messages.shell.expandPanel
                  : messages.shell.collapsePanel
              }
              onClick={toggleCollapsed}
            >
              {collapsed ? (
                <PanelRightOpen className="h-4 w-4" />
              ) : (
                <PanelRightClose className="h-4 w-4" />
              )}
            </IconButton>
          </div>
          <div
            ref={(el) => {
              containerRef.current = el;
              setContainer(el);
            }}
            className={cn(
              "min-h-0 flex-1 overflow-y-auto",
              collapsed && "hidden",
            )}
          />
        </aside>
      </div>
    </PanelContext.Provider>
  );
}
