import type { Metadata } from "next";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTA_BANCO_HORAS } from "@/lib/modulos/rh/banco-horas/modulo";
import { horas } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerParametros, lerSaldos } from "../dados";
import { AvisoAoLider } from "./aviso-lider";
import { SetorDaPessoa } from "./setor-pessoa";

export const metadata: Metadata = { title: "Banco de horas" };

export default async function PaginaBancoHoras() {
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const [saldos, par, gmail, { data: setoresAtivos }] = await Promise.all([
    lerSaldos(supabase), lerParametros(supabase),
    supabase.from("gmail_contas").select("email").eq("perfil_id", sessao.userId).is("desconectado_em", null).maybeSingle(),
    supabase.from("rh_pt_setores").select("id, nome").eq("ativo", true).order("nome"),
  ]);
  const listaSetores = (setoresAtivos ?? []) as { id: string; nome: string }[];
  const semSetor = saldos.filter((s) => !s.setor_id).length;
  const podeOperar = temAcesso(sessao.acesso, "rh", "operador");
  // setores com crédito vencendo no prazo do aviso
  const setores = [...new Map(saldos.filter((s) => s.vencendo_min > 0 && s.setor_id).map((s) => [s.setor_id!, s.setor])).entries()].map(([id, nome]) => {
    const doSetor = saldos.filter((s) => s.setor_id === id && s.vencendo_min > 0);
    return { id, nome, pessoas: doSetor.length, minutos: doSetor.reduce((t, s) => t + s.vencendo_min, 0), primeiro: doSetor.map((s) => s.proximo_vencimento!).sort()[0] };
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Conta desde {formatarData(par.inicio)} (o saldo anterior é ignorado). Aviso {par.avisoDias} dias antes do vencimento; saldo abaixo de -{horas(par.limiteNegativoMin)} alerta.
        O saldo do Control iD aparece ao lado para conferência.
      </p>
      {semSetor > 0 && <p className="text-sm text-amber-800">{semSetor} pessoa(s) sem setor: escolha na coluna Setor (o CSV do Control iD não traz). Sem setor, só o RH é avisado.</p>}
      {setores.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {setores.map((s) => (
            <div key={s.id} className="rounded-[3px] border border-amber-600 bg-amber-50 p-3 text-sm">
              <p className="font-medium">{s.nome}: {s.pessoas} pessoa(s), {horas(s.minutos)} vencendo</p>
              <p className="text-muted-foreground">Primeiro vencimento em {formatarData(s.primeiro)}</p>
              {podeOperar && <AvisoAoLider setorId={s.id} gmail={(gmail.data?.email as string | undefined) ?? null} />}
            </div>
          ))}
        </div>
      )}
      {saldos.length === 0 && <p className="rounded-[3px] border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum banco de horas importado. Use a aba Importações.</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pessoa</TableHead><TableHead>Setor</TableHead><TableHead className="text-right">Saldo (6 meses)</TableHead>
            <TableHead className="text-right">Saldo Control iD</TableHead><TableHead className="text-right">Vencendo</TableHead><TableHead>Próximo vencimento</TableHead>
            <TableHead className="text-right">Vencido a pagar</TableHead><TableHead>Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {saldos.map((s) => {
            const negativo = s.saldo_min < -s.limite_negativo_min;
            const situacao = [s.vencido_min > 0 && "Pagar na folha", s.vencendo_min > 0 && "Vencendo", negativo && "Negativo", !s.colaborador_id && "Sem cadastro"].filter(Boolean).join(" · ");
            return (
              <TableRow key={s.pessoa_id}>
                <TableCell className="font-medium"><Link href={`${ROTA_BANCO_HORAS}/pessoa/${s.pessoa_id}`} className="text-elo hover:underline">{s.nome}</Link></TableCell>
                <TableCell>{podeOperar ? <SetorDaPessoa pessoa={s.pessoa_id} setor={s.setor_id} setores={listaSetores} nome={s.nome} /> : s.setor || "Sem setor"}</TableCell>
                <TableCell className={`text-right tabular-nums ${s.saldo_min < 0 ? "text-destructive" : ""} ${negativo ? "font-bold" : ""}`}>{horas(s.saldo_min)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{horas(s.saldo_controlid_min)}</TableCell>
                <TableCell className="text-right tabular-nums">{s.vencendo_min ? horas(s.vencendo_min) : ""}</TableCell>
                <TableCell className="tabular-nums">{formatarData(s.proximo_vencimento)}</TableCell>
                <TableCell className={`text-right tabular-nums ${s.vencido_min ? "font-medium text-destructive" : ""}`}>{s.vencido_min ? horas(s.vencido_min) : ""}</TableCell>
                <TableCell className="text-xs">{situacao}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
