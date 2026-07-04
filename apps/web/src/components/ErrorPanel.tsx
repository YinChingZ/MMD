export function ErrorPanel({ error }: { error: string | null }) {
  return (
    <div className="rounded border border-red-200 bg-red-50 p-4">
      <h2 className="mb-1 text-sm font-semibold text-red-800">Run failed</h2>
      <p className="text-sm text-red-700">{error ?? "Unknown error."}</p>
    </div>
  );
}
