/** 六点汇聚品牌标识：六个模型向中心共识收敛。 */
export function BrandMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <g stroke="var(--accent)" strokeWidth="2" opacity="0.38">
        <path d="M32 16v8M45 24l-7 5M45 40l-7-5M32 48v-8M19 40l7-5M19 24l7 5" />
      </g>
      <circle cx="32" cy="32" r="8" fill="var(--accent)" />
      <g fill="none" stroke="var(--accent)" strokeWidth="3">
        <circle cx="32" cy="11" r="5" />
        <circle cx="50.2" cy="21.5" r="5" />
        <circle cx="50.2" cy="42.5" r="5" />
        <circle cx="32" cy="53" r="5" />
        <circle cx="13.8" cy="42.5" r="5" />
        <circle cx="13.8" cy="21.5" r="5" />
      </g>
    </svg>
  );
}
