/** Caixa recolhível "O que fazer aqui": passo a passo da tela em linguagem simples (para quem opera sem conhecer o assunto). */
export function Ajuda({ titulo, passos, regra }: { titulo: string; passos: readonly string[]; regra?: readonly string[] }) {
  return (
    <details className="rounded-[3px] border border-sky-700/40 bg-sky-50 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-sky-900">O que fazer aqui — {titulo}</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        {passos.map((p) => <li key={p}>{p}</li>)}
      </ol>
      {regra && (
        <div className="mt-2 border-t border-sky-700/20 pt-2 text-[13px] text-sky-950">
          <p className="font-medium">A regra:</p>
          <ul className="list-disc space-y-0.5 pl-5">{regra.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
    </details>
  );
}
