/**
 * 轻量跨组件通知：会话列表变化时（新建/删除/首问命名），
 * 侧栏监听此事件重新拉取，避免引入全局状态库。
 */

const EVENT = "mmd:conversations-changed";

export function notifyConversationsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

export function onConversationsChanged(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
