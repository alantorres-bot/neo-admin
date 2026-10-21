import type { Metadata } from "next";
import Link from "next/link";
import { Ajuda } from "@/components/plataforma/ajuda";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AJUDA, REGRA_EM_UMA_FRASE } from "@/lib/modulos/rh/banco-horas/ajuda";
import { ROTA_BANCO_HORAS } from "@/lib/modulos/rh/banco-horas/modulo";
import { horas } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerParametros, lerSaldos } from "../dados";
import { AvisoAoLider } from "./aviso-lider";

export const metadata: Metadata = { title: "Banco de horas" };

export default async function PaginaBancoHoras() {
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const [saldos, par, gmail] = await Promise.all([
    lerSaldos(supabase), lerParametros(supabase),
    supabase.from("gmail_contas").select("email").eq("perfil_id", sessao.userId).is("desconectado_em", null).maybeSingle(),
  ]);
  const semSetor = saldos.filter((s) => !s.setor_id).length;
  const podeOperar = temAcesso(sessao.acesso, "rh", "operador");
  const vencendo = (s: (typeof saldos)[number]) => s.folgar_min > 0 || s.repor_min > 0;
  // setores com horas vencendo no prazo do aviso
  const setores = [...new Map(saldos.filter((s) => vencendo(s) && s.setor_id).map((s) => [s.setor_id!, s.setor])).entries()].map(([id, nome]) => {
    const doSetor = saldos.filter((s) => s.setor_id === id && vencendo(s));
    return {
      id, nome, pessoas: doSetor.length, folgar: doSetor.reduce((t, s) => t + s.folgar_min, 0), repor: doSetor.reduce((t, s) => t + s.repor_min, 0),
      primeiro: doSetor.map((s) => s.proximo_vencimento!).sort()[0],
    };
  });
  const pendentesFolha = saldos.filter((s) => s.pagar_min > 0 || s.descontar_min > 0).length;

  return (
    <div className="space-y-4">
      <Ajuda titulo={AJUDA.saldos.titulo} passos={AJUDA.saldos.passos} regra={REGRA_EM_UMA_FRASE} />
      <p className="text-sm text-muted-foreground">
        Conta desde {formatarData(par.inicio)} (o saldo anterior é ignorado). Aviso {par.avisoDias} dias antes do vencimento; devendo mais de {horas(par.limiteNegativoMin)} gera alerta.
        O saldo do Control iD aparece ao lado para conferência.
      </p>
      {pendentesFolha > 0 && (
        <p className="rounded-[3px] border border-destructive/50 p-3 text-sm text-destructive">
          {pendentesFolha} pessoa(s) com horas vencidas a acertar na folha. Vá em <Link href={`${ROTA_BANCO_HORAS}/fechamentos`} className="underline">Fechamento do mês</Link>.
        </p>
      )}
      {semSetor > 0 && <p className="text-sm text-amber-800">{semSetor} pessoa(s) sem setor. O setor vem do departamento do colaborador (RH &gt; Colaboradores, &quot;Importar do Control iD&quot;) e tem de existir com o mesmo nome em RH &gt; Ponto &gt; Setores. Sem setor, só o RH é avisado.</p>}
      {setores.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {setores.map((s) => (
            <div key={s.id} className="rounded-[3px] border border-amber-600 bg-amber-50 p-3 text-sm">
              <p className="font-medium">{s.nome}: {s.pessoas} pessoa(s) com horas vencendo</p>
              <p className="text-muted-foreground">
                {s.folgar ? `${horas(s.folgar)} a folgar` : ""}{s.folgar && s.repor ? " · " : ""}{s.repor ? `${horas(s.repor)} a repor` : ""} · primeiro vencimento {formatarData(s.primeiro)}
              </p>
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
            <TableHead className="text-right">Saldo Control iD</TableHead><TableHead className="text-right">Folgar</TableHead><TableHead className="text-right">Repor</TableHead>
            <TableHead>Até</TableHead><TableHead className="text-right">Empresa paga</TableHead><TableHead className="text-right">Descontar</TableHead><TableHead>Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {saldos.map((s) => {
            const negativo = s.saldo_min < -s.limite_negativo_min;
            const situacao = [(s.pagar_min || s.descontar_min) && "Acertar na folha", vencendo(s) && "Vencendo", negativo && "Devendo muito", !s.colaborador_id && "Sem cadastro"].filter(Boolean).join(" · ");
            return (
              <TableRow key={s.pessoa_id}>
                <TableCell className="font-medium"><Link href={`${ROTA_BANCO_HORAS}/pessoa/${s.pessoa_id}`} className="text-elo hover:underline">{s.nome}</Link></TableCell>
                <TableCell>{s.setor || <span className="text-amber-800">Sem setor</span>}</TableCell>
                <TableCell className={`text-right tabular-nums ${s.saldo_min < 0 ? "text-destructive" : ""} ${negativo ? "font-bold" : ""}`}>{horas(s.saldo_min)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{horas(s.saldo_controlid_min)}</TableCell>
                <TableCell className="text-right tabular-nums">{s.folgar_min ? horas(s.folgar_min) : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{s.repor_min ? horas(s.repor_min) : ""}</TableCell>
                <TableCell className="tabular-nums">{vencendo(s) ? formatarData(s.proximo_vencimento) : ""}</TableCell>
                <TableCell className={`text-right tabular-nums ${s.pagar_min ? "font-medium text-destructive" : ""}`}>{s.pagar_min ? horas(s.pagar_min) : ""}</TableCell>
                <TableCell className={`text-right tabular-nums ${s.descontar_min ? "font-medium text-destructive" : ""}`}>{s.descontar_min ? horas(s.descontar_min) : ""}</TableCell>
                <TableCell className="text-xs">{situacao}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
