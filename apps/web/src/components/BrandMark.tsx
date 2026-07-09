/** 六点汇聚品牌标识：六个模型向中心共识收敛。 */
export function BrandMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <circle cx="32" cy="32" r="8" fill="var(--accent)" />
      <circle cx="32" cy="11" r="5" fill="var(--accent)" opacity="0.85" />
      <circle cx="50.2" cy="21.5" r="5" fill="var(--accent)" opacity="0.7" />
      <circle cx="50.2" cy="42.5" r="5" fill="var(--accent)" opacity="0.55" />
      <circle cx="32" cy="53" r="5" fill="var(--accent)" opacity="0.7" />
      <circle cx="13.8" cy="42.5" r="5" fill="var(--accent)" opacity="0.85" />
      <circle cx="13.8" cy="21.5" r="5" fill="var(--accent)" opacity="0.55" />
    </svg>
  );
}
