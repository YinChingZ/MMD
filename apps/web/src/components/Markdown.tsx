import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Real model output for final_answer/section_answer/executive_summary
// routinely comes back as markdown (headers, lists, bold) rather than plain
// prose — confirmed with real planning-mode runs. Rendered here instead of
// as literal text so "## Recommended Tool" doesn't show up as raw "##" in
// the UI. No @tailwindcss/typography plugin — just enough element styling to
// match the rest of this app's minimal utility-class look.
const components: Components = {
  h1: (props) => <h3 className="mt-3 mb-1 text-base font-semibold" {...props} />,
  h2: (props) => <h3 className="mt-3 mb-1 text-base font-semibold" {...props} />,
  h3: (props) => <h4 className="mt-2 mb-1 text-sm font-semibold" {...props} />,
  p: (props) => <p className="mb-2 text-sm text-gray-800 last:mb-0" {...props} />,
  ul: (props) => <ul className="mb-2 ml-4 list-disc text-sm text-gray-800" {...props} />,
  ol: (props) => <ol className="mb-2 ml-4 list-decimal text-sm text-gray-800" {...props} />,
  li: (props) => <li className="mb-0.5" {...props} />,
  strong: (props) => <strong className="font-semibold" {...props} />,
  code: (props) => <code className="rounded bg-gray-100 px-1 py-0.5 text-xs" {...props} />,
  a: (props) => <a className="underline" target="_blank" rel="noreferrer" {...props} />,
};

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}
