// Tipos do núcleo (espelham as tabelas de supabase/migrations/0001_nucleo.sql e 0002).
// Quando houver projeto Supabase: `npx supabase gen types typescript --linked` pode substituir isto.

export type NivelAcesso = "sem_acesso" | "consulta" | "operador" | "gestor" | "administrador";
export type Criticidade = "critica" | "alta" | "normal";
export type StatusPendencia = "aberta" | "em_andamento" | "concluida" | "cancelada";
export type TipoContraparte =
  | "cliente" | "fornecedor" | "orgao_publico" | "tribunal" | "escritorio" | "banco" | "colaborador" | "outro";
export type Canal = "email" | "whatsapp" | "telefone" | "interno";

export type Area = { codigo: string; nome: string; sensivel: boolean; ordem: number };
export type Modulo = { codigo: string; area: string; nome: string; ativo: boolean };

export type Perfil = {
  id: string; nome: string; email: string; admin_geral: boolean; ativo: boolean;
  /** senha definida pelo admin: o usuário só acessa /conta até trocá-la */
  deve_trocar_senha: boolean;
};

export type Empresa = {
  id: string; razao_social: string; nome_curto: string; cnpj: string | null; ativa: boolean;
};

export type Contraparte = {
  id: string; nome: string; documento: string | null; tipos: TipoContraparte[];
  codigo_erp: string | null; observacoes: string | null; ativo: boolean; criado_em: string;
};

export type Contato = {
  id: string; contraparte_id: string; nome: string; funcao: string | null; email: string | null;
  whatsapp: string | null; telefone: string | null; canal_preferido: Canal | null; finalidades: string[]; ativo: boolean;
};

export type Pendencia = {
  id: string; modulo: string; empresa_id: string | null; contraparte_id: string | null;
  titulo: string; descricao: string | null; prazo: string | null; criticidade: Criticidade;
  status: StatusPendencia; responsavel_id: string | null; link: string | null; criado_em: string;
};
