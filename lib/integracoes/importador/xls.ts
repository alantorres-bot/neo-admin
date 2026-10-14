// Leitura de .xls (Excel 97, BIFF8) sem biblioteca externa, tolerante a arquivos gerados fora do padrão.
//
// Por que existe: o sistema do escritório de contabilidade gera a "Relação Geral dos Líquidos" em .xls com dois defeitos que
// fazem as bibliotecas comuns recusarem o arquivo (o Excel abre normalmente):
//   1. o contêiner OLE (Compound File) não tem tamanho múltiplo do setor — o último setor vem cortado;
//   2. o registro BOUNDSHEET aponta para um deslocamento errado da planilha.
// Por isso: (1) setores além do fim do arquivo são lidos como cortados, e (2) as planilhas são achadas percorrendo os registros
// EM SEQUÊNCIA (cada BOF de planilha abre uma nova), sem usar o deslocamento do BOUNDSHEET.
// Lê: textos (LABELSST/LABEL/RSTRING), números (NUMBER/RK/MULRK) e o resultado numérico de fórmulas. Datas ficam como número de
// série do Excel (quem interpreta é o módulo que usa).

export type ValorXls = string | number;
export type PlanilhaXls = { nome: string; linhas: (ValorXls | null)[][] };
export type ResultadoXls = { ok: true; planilhas: PlanilhaXls[] } | { ok: false; erro: string };

const ASSINATURA_OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FIM_DE_CADEIA = 0xfffffffe;
const LIVRE = 0xffffffff;

// ---------------------------------------------------------------- contêiner OLE (Compound File Binary)

function lerStreamOle(bytes: Uint8Array, nomes: string[]): Uint8Array | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tamSetor = 1 << dv.getUint16(0x1e, true);
  const tamMini = 1 << dv.getUint16(0x20, true);
  const primeiroDir = dv.getUint32(0x30, true);
  const corteMini = dv.getUint32(0x38, true) || 4096;
  const primeiraMiniFat = dv.getUint32(0x3c, true);
  let difatSetor = dv.getUint32(0x44, true);
  const qtdDifat = dv.getUint32(0x48, true);

  const setor = (n: number): Uint8Array => {
    const ini = (n + 1) * tamSetor;
    if (ini >= bytes.length) return new Uint8Array(tamSetor);
    const fatia = bytes.subarray(ini, Math.min(ini + tamSetor, bytes.length));
    if (fatia.length === tamSetor) return fatia;
    const cheio = new Uint8Array(tamSetor); // último setor cortado (defeito 1)
    cheio.set(fatia);
    return cheio;
  };
  const u32 = (b: Uint8Array, pos: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(pos, true);

  // FAT: setores listados na DIFAT do cabeçalho (109) e na cadeia DIFAT.
  const setoresFat: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = dv.getUint32(0x4c + 4 * i, true);
    if (s !== LIVRE && s !== FIM_DE_CADEIA) setoresFat.push(s);
  }
  for (let k = 0; k < qtdDifat && difatSetor !== FIM_DE_CADEIA && difatSetor !== LIVRE; k++) {
    const b = setor(difatSetor);
    for (let i = 0; i < tamSetor / 4 - 1; i++) {
      const s = u32(b, 4 * i);
      if (s !== LIVRE && s !== FIM_DE_CADEIA) setoresFat.push(s);
    }
    difatSetor = u32(b, tamSetor - 4);
  }
  const fat: number[] = [];
  for (const s of setoresFat) {
    const b = setor(s);
    for (let i = 0; i < tamSetor / 4; i++) fat.push(u32(b, 4 * i));
  }
  const cadeia = (inicio: number, tabela: number[]): number[] => {
    const lista: number[] = [];
    const vistos = new Set<number>();
    for (let s = inicio; s !== FIM_DE_CADEIA && s !== LIVRE && s < tabela.length && !vistos.has(s); s = tabela[s]) {
      vistos.add(s);
      lista.push(s);
    }
    return lista;
  };
  const juntar = (partes: Uint8Array[], tamanho: number) => {
    const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    for (const p of partes) { out.set(p, pos); pos += p.length; }
    return out.subarray(0, Math.min(tamanho, out.length));
  };

  // Diretório
  const dir = juntar(cadeia(primeiroDir, fat).map(setor), Number.MAX_SAFE_INTEGER);
  type Entrada = { nome: string; tipo: number; inicio: number; tamanho: number };
  const entradas: Entrada[] = [];
  for (let pos = 0; pos + 128 <= dir.length; pos += 128) {
    const e = dir.subarray(pos, pos + 128);
    const tamNome = new DataView(e.buffer, e.byteOffset, 128).getUint16(64, true);
    const nome = new TextDecoder("utf-16le").decode(e.subarray(0, Math.max(0, tamNome - 2)));
    entradas.push({ nome, tipo: e[66], inicio: u32(e, 116), tamanho: u32(e, 120) });
  }
  const raiz = entradas.find((e) => e.tipo === 5);
  const alvo = entradas.find((e) => e.tipo === 2 && nomes.includes(e.nome));
  if (!alvo) return null;
  if (alvo.tamanho >= corteMini || !raiz) return juntar(cadeia(alvo.inicio, fat).map(setor), alvo.tamanho);

  // Stream pequeno: está no mini stream (dentro do stream da raiz), endereçado pela mini FAT.
  const miniStream = juntar(cadeia(raiz.inicio, fat).map(setor), raiz.tamanho);
  const miniFatBytes = juntar(cadeia(primeiraMiniFat, fat).map(setor), Number.MAX_SAFE_INTEGER);
  const miniFat: number[] = [];
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(u32(miniFatBytes, i));
  const partes = cadeia(alvo.inicio, miniFat).map((s) => miniStream.subarray(s * tamMini, (s + 1) * tamMini));
  return juntar(partes, alvo.tamanho);
}

// ---------------------------------------------------------------- BIFF8

type Registro = { tipo: number; dados: Uint8Array };

function registros(wb: Uint8Array): Registro[] {
  const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  const lista: Registro[] = [];
  for (let pos = 0; pos + 4 <= wb.length; ) {
    const tipo = dv.getUint16(pos, true);
    const tam = dv.getUint16(pos + 2, true);
    lista.push({ tipo, dados: wb.subarray(pos + 4, Math.min(pos + 4 + tam, wb.length)) });
    pos += 4 + tam;
  }
  return lista;
}

/** Cursor sobre o SST e seus CONTINUE: um texto pode ser cortado entre registros (o pedaço seguinte começa com novo byte de opções). */
class LeitorSst {
  private i = 0;
  private pos = 0;
  constructor(private blocos: Uint8Array[]) {}
  private garantir() {
    while (this.i < this.blocos.length && this.pos >= this.blocos[this.i].length) { this.i++; this.pos = 0; }
  }
  byte(): number { this.garantir(); return this.blocos[this.i]?.[this.pos++] ?? 0; }
  u16(): number { return this.byte() | (this.byte() << 8); }
  u32(): number { return (this.u16() | (this.u16() << 16)) >>> 0; }
  pular(n: number) { for (let k = 0; k < n; k++) this.byte(); }
  texto(): string {
    const n = this.u16();
    let opcoes = this.byte();
    const rich = opcoes & 0x08 ? this.u16() : 0;
    const ext = opcoes & 0x04 ? this.u32() : 0;
    let s = "";
    let bloco = this.i;
    for (let k = 0; k < n; k++) {
      this.garantir();
      if (this.i !== bloco) { // texto cortado: o CONTINUE começa com um novo byte de largura dos caracteres
        bloco = this.i;
        opcoes = (opcoes & ~1) | (this.byte() & 1);
      }
      s += String.fromCharCode(opcoes & 1 ? this.u16() : this.byte());
    }
    this.pular(4 * rich + ext);
    return s;
  }
}

function textoBiff(d: Uint8Array, pos: number): string {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const n = dv.getUint16(pos, true);
  const opcoes = d[pos + 2];
  let p = pos + 3;
  if (opcoes & 0x08) p += 2;
  if (opcoes & 0x04) p += 4;
  let s = "";
  for (let k = 0; k < n && p < d.length; k++) {
    if (opcoes & 1) { s += String.fromCharCode(dv.getUint16(p, true)); p += 2; }
    else s += String.fromCharCode(d[p++]);
  }
  return s;
}

function rk(v: number): number {
  let n: number;
  if (v & 2) {
    n = v >> 2; // inteiro de 30 bits com sinal
  } else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(4, (v & 0xfffffffc) >>> 0, true);
    n = buf.getFloat64(0, true);
  }
  return v & 1 ? n / 100 : n;
}

function planilhasDoWorkbook(wb: Uint8Array): PlanilhaXls[] {
  const regs = registros(wb);
  const sst: string[] = [];
  const nomes: string[] = [];
  regs.forEach((r, i) => {
    if (r.tipo === 0x00fc) {
      const blocos = [r.dados];
      for (let j = i + 1; j < regs.length && regs[j].tipo === 0x003c; j++) blocos.push(regs[j].dados);
      const l = new LeitorSst(blocos);
      l.u32();
      const unicos = l.u32();
      for (let k = 0; k < unicos; k++) sst.push(l.texto());
    }
    if (r.tipo === 0x0085) nomes.push(textoCurto(r.dados, 6)); // BOUNDSHEET: só o nome (o deslocamento é ignorado)
  });
  const planilhas: PlanilhaXls[] = [];
  let atual: Map<string, ValorXls> | null = null;
  const fechar = () => {
    if (!atual) return;
    const linhas: (ValorXls | null)[][] = [];
    for (const [k, v] of atual) {
      const [r, c] = k.split(",").map(Number);
      (linhas[r] ??= [])[c] = v;
    }
    for (let r = 0; r < linhas.length; r++) {
      linhas[r] ??= [];
      for (let c = 0; c < linhas[r].length; c++) linhas[r][c] ??= null;
    }
    planilhas.push({ nome: nomes[planilhas.length] ?? `Planilha${planilhas.length + 1}`, linhas });
    atual = null;
  };
  for (const { tipo, dados } of regs) {
    const dv = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
    if (tipo === 0x0809) {
      fechar();
      if (dados.length >= 4 && dv.getUint16(2, true) === 0x0010) atual = new Map(); // BOF de planilha
      continue;
    }
    if (!atual || dados.length < 6) continue;
    const cel = (r: number, c: number, v: ValorXls) => atual!.set(`${r},${c}`, v);
    const r = dv.getUint16(0, true), c = dv.getUint16(2, true);
    if (tipo === 0x00fd && dados.length >= 10) cel(r, c, sst[dv.getUint32(6, true)] ?? "");
    else if (tipo === 0x0203 && dados.length >= 14) cel(r, c, dv.getFloat64(6, true));
    else if (tipo === 0x027e && dados.length >= 10) cel(r, c, rk(dv.getUint32(6, true)));
    else if (tipo === 0x00bd) {
      const n = (dados.length - 6) / 6;
      for (let k = 0; k < n; k++) cel(r, c + k, rk(dv.getUint32(4 + 6 * k + 2, true)));
    } else if ((tipo === 0x0204 || tipo === 0x00d6) && dados.length >= 9) cel(r, c, textoBiff(dados, 6));
    else if (tipo === 0x0006 && dados.length >= 14 && !(dv.getUint16(12, true) === 0xffff)) cel(r, c, dv.getFloat64(6, true));
  }
  fechar();
  return planilhas;
}

function textoCurto(d: Uint8Array, pos: number): string {
  const n = d[pos];
  const opcoes = d[pos + 1];
  let s = "";
  for (let k = 0, p = pos + 2; k < n && p < d.length; k++) {
    if (opcoes & 1) { s += String.fromCharCode(d[p] | (d[p + 1] << 8)); p += 2; }
    else s += String.fromCharCode(d[p++]);
  }
  return s;
}

/** Lê um .xls (Excel 97). Recusa com mensagem quando não é .xls ou não tem planilha. */
export function lerXls(buffer: ArrayBuffer | Uint8Array): ResultadoXls {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 512 || !ASSINATURA_OLE.every((b, i) => bytes[i] === b)) return { ok: false, erro: "O arquivo não é um .xls (Excel 97-2003)." };
  try {
    const wb = lerStreamOle(bytes, ["Workbook", "Book"]);
    if (!wb) return { ok: false, erro: "O .xls não tem a pasta de trabalho (stream Workbook)." };
    const planilhas = planilhasDoWorkbook(wb);
    return planilhas.length ? { ok: true, planilhas } : { ok: false, erro: "O .xls não tem planilha com dados." };
  } catch {
    return { ok: false, erro: "Não foi possível ler o .xls (arquivo corrompido)." };
  }
}
