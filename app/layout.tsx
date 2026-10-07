import type { Metadata, Viewport } from "next";
import { Geist_Mono, Roboto, Roboto_Condensed } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const roboto = Roboto({ variable: "--font-roboto", subsets: ["latin"], weight: ["400", "500", "700"] });
const robotoCondensed = Roboto_Condensed({ variable: "--font-roboto-condensed", subsets: ["latin"], weight: ["400", "700"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Neo Admin", template: "%s · Neo Admin" },
  description: "Plataforma do Administrativo do grupo Neo Formas.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#d9433c" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${roboto.variable} ${robotoCondensed.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
