import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useApp } from "./estado/store";
import "./estilos.css";

// Conferência visual automatizada (tests/e2e): com "?teste" na URL os scripts alcançam o estado do app.
// Na página publicada não há esse parâmetro, então nada é exposto.
if (new URLSearchParams(window.location.search).has("teste")) Object.assign(window, { __estudio: useApp });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
