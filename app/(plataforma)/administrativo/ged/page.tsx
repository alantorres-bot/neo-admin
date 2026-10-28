import { redirect } from "next/navigation";

// Rota do módulo pela convenção (/administrativo/ged): a Central de Documentos fica em /documentos (especificação, seção 7).
export default function PaginaModuloGed() {
  redirect("/documentos");
}
