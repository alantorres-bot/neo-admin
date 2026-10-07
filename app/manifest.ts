import type { MetadataRoute } from "next";

// Permite "Adicionar à tela inicial" no celular: abre o Neo Admin em tela cheia, como um aplicativo.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Neo Admin",
    short_name: "Neo Admin",
    description: "Plataforma do Administrativo do grupo Neo Formas.",
    start_url: "/inicio",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#d9433c",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
