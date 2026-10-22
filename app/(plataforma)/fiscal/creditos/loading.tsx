export default function Carregando() {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <div className="h-6 w-56 animate-pulse rounded bg-muted" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-[3px] bg-muted" />)}
      </div>
      <span className="sr-only">Carregando…</span>
    </div>
  );
}
