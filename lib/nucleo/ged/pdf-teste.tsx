// Só para testes: PDF com uma camada de texto (como os gerados pelo ERP) ou vazio (como o escaneado, sem texto).
import React from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";

export async function pdfComTexto(texto: string): Promise<Uint8Array> {
  const doc = (
    <Document>
      <Page size="A4">{texto ? <Text>{texto}</Text> : null}</Page>
    </Document>
  );
  return new Uint8Array(await renderToBuffer(doc));
}
