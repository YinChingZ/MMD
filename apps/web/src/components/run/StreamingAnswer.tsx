import { messages } from "../../lib/messages";
import { Markdown } from "../Markdown";

/** compose 阶段的流式最终答案：markdown + 闪烁光标。 */
export function StreamingAnswer({
  text,
  title,
}: {
  text: string;
  title?: string;
}) {
  return (
    <div className="mmd-enter rounded-lg border border-accent/30 bg-surface p-5 shadow-card">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
        {title ?? messages.run.composing}
        <span className="mmd-pulse h-2 w-2 rounded-full bg-accent" aria-hidden />
      </h2>
      <div className="leading-relaxed">
        <Markdown text={text} />
        <span className="mmd-caret" aria-hidden />
      </div>
    </div>
  );
}
