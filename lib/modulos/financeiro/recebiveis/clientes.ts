// Regras do cadastro de contatos dos clientes: ficam em `supabase/functions/_shared/clientes.ts` (a Edge Function e as telas
// usam as mesmas). Este arquivo só reexporta para as telas.
export {
  clienteNoEscopoDeCadastro, DIAS_ESCOPO_CADASTRO, titulaNoEscopoDeCadastro, type TituloParaEscopo,
} from "../../../../supabase/functions/_shared/clientes";
