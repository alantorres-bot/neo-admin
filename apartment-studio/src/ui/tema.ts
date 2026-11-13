import { useSyncExternalStore } from "react";

export type Tema = "claro" | "escuro";

function temaAtual(): Tema {
  if (typeof document === "undefined") return "claro";
  const escolhido = document.documentElement.getAttribute("data-theme");
  if (escolhido === "dark") return "escuro";
  if (escolhido === "light") return "claro";
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
}

function assinar(aoMudar: () => void) {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", aoMudar);
  const obs = new MutationObserver(aoMudar);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    mq.removeEventListener("change", aoMudar);
    obs.disconnect();
  };
}

/** Tema do visualizador: escolha explícita (data-theme) ou, sem ela, a preferência do sistema. */
export function useTema(): Tema {
  return useSyncExternalStore(assinar, temaAtual, () => "claro");
}
