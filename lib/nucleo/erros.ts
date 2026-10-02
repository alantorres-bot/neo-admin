// Tradução dos erros do Postgres/PostgREST para mensagens que o usuário entende.
type ErroBanco = { code?: string; message: string; details?: string | null };

export function mensagemDeErroBanco(erro: ErroBanco, aoDuplicar = "Já existe um registro com estes dados."): string {
  switch (erro.code) {
    case "23505": // unique_violation
      return aoDuplicar;
    case "42501": // insufficient_privilege / violação de RLS
      return "Você não tem permissão para esta operação.";
    case "23503": // foreign_key_violation
      return "Este registro está ligado a outros e não pode ser alterado desta forma.";
    case "23514": // check_violation
    case "22P02": // invalid_text_representation
      return "Algum dado informado é inválido.";
    case "P0001": // raise exception dos nossos gatilhos (já em português)
      return erro.message;
    default:
      return "Não foi possível salvar. Tente novamente.";
  }
}

/** Tira vírgula, parênteses, aspas e curingas do texto digitado antes de usá-lo em filtros do PostgREST. */
export function sanitizarBusca(texto: string): string {
  return texto.replace(/[,()"'\\%*_]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}
