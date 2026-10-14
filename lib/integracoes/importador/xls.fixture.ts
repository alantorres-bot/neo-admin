// Gerador de .xls (BIFF8 em contêiner OLE) sintético, só para testes: reproduz os defeitos do arquivo do escritório
// (deslocamento errado no BOUNDSHEET, contêiner com o fim cortado), stream pequeno no mini stream e texto partido em CONTINUE.
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const f64 = (n: number) => { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, n, true); return [...new Uint8Array(b.buffer)]; };
const reg = (tipo: number, dados: number[]) => [...u16(tipo), ...u16(dados.length), ...dados];
const str8 = (s: string) => [...[...s].map((ch) => ch.charCodeAt(0))];

export type CelulaTeste = [number, number, string | number];

/**
 * Pasta de trabalho BIFF8 com uma planilha. Reproduz o defeito do escritório: BOUNDSHEET com deslocamento errado.
 * `sstPartido`: corta o SST num CONTINUE no meio de um texto (a continuação começa com novo byte de largura).
 */
function workbook(celulas: CelulaTeste[], sstPartido = false): Uint8Array {
  const textos = [...new Set(celulas.map((c) => c[2]).filter((v): v is string => typeof v === "string"))];
  const corpoSst = [...u32(textos.length), ...u32(textos.length)];
  const pedacos: number[][] = [];
  let atual = [...corpoSst];
  for (const t of textos) {
    const cab = [...u16(t.length), 0x00];
    const chars = str8(t);
    if (sstPartido && t.length > 4 && pedacos.length === 0) {
      atual.push(...cab, ...chars.slice(0, 3));
      pedacos.push(atual);
      atual = [0x00, ...chars.slice(3)]; // CONTINUE: byte de largura + resto do texto
    } else atual.push(...cab, ...chars);
  }
  pedacos.push(atual);
  const sst = [...reg(0x00fc, pedacos[0]), ...pedacos.slice(1).flatMap((p) => reg(0x003c, p))];
  const globais = [
    ...reg(0x0809, [...u16(0x0600), ...u16(0x0005), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...reg(0x0085, [...u32(999999), 0, 0, 5, 0, ...str8("Folha")]), // deslocamento errado de propósito
    ...sst,
    ...reg(0x000a, []),
  ];
  const corpo: number[] = [];
  for (const [r, c, v] of celulas) {
    if (typeof v === "string") corpo.push(...reg(0x00fd, [...u16(r), ...u16(c), ...u16(15), ...u32(textos.indexOf(v))]));
    else if (Number.isInteger(v) && Math.abs(v) < 2 ** 29) corpo.push(...reg(0x027e, [...u16(r), ...u16(c), ...u16(15), ...u32(((v << 2) | 2) >>> 0)]));
    else corpo.push(...reg(0x0203, [...u16(r), ...u16(c), ...u16(15), ...f64(v)]));
  }
  const planilha = [...reg(0x0809, [...u16(0x0600), ...u16(0x0010), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...corpo, ...reg(0x000a, [])];
  return new Uint8Array([...globais, ...planilha]);
}

/** Contêiner OLE com o stream "Workbook". Stream < 4096 vai para o mini stream. `cortar`: tira bytes do fim (defeito do escritório). */
function ole(stream: Uint8Array, cortar = 0): Uint8Array {
  const S = 512;
  const setores = (b: Uint8Array) => Math.ceil(b.length / S);
  const mini = stream.length < 4096;
  const fat: number[] = [];
  const conteudo: Uint8Array[] = [];
  const cadeia = (n: number) => { const ini = fat.length; for (let k = 0; k < n; k++) fat.push(k === n - 1 ? 0xfffffffe : ini + k + 1); return ini; };
  const pad = (b: Uint8Array) => { const out = new Uint8Array(setores(b) * S || S); out.set(b); return out; };
  // setor 0 = FAT (reservado), 1 = diretório
  fat.push(0xfffffffd);
  const dirIni = cadeia(1);
  let raizIni = 0xfffffffe, raizTam = 0, wbIni: number, miniFatIni = 0xfffffffe, qtdMiniFat = 0;
  if (mini) {
    const miniSet = Math.ceil(stream.length / 64);
    const miniFat = Array.from({ length: miniSet }, (_, k) => (k === miniSet - 1 ? 0xfffffffe : k + 1));
    const miniFatBytes = new Uint8Array(miniFat.flatMap(u32));
    miniFatIni = cadeia(setores(miniFatBytes)); qtdMiniFat = setores(miniFatBytes);
    const miniStream = new Uint8Array(miniSet * 64); miniStream.set(stream);
    raizIni = cadeia(setores(miniStream)); raizTam = miniStream.length;
    wbIni = 0;
    conteudo.push(pad(miniFatBytes), pad(miniStream));
  } else {
    wbIni = cadeia(setores(stream));
    conteudo.push(pad(stream));
  }
  while (fat.length % 128) fat.push(0xffffffff);
  const entrada = (nome: string, tipo: number, ini: number, tam: number) => {
    const e = new Uint8Array(128);
    const n = [...nome].flatMap((ch) => u16(ch.charCodeAt(0)));
    e.set(n); e.set(u16(n.length + 2), 64); e[66] = tipo; e[67] = 1;
    e.set(u32(0xffffffff), 68); e.set(u32(0xffffffff), 72); e.set(u32(tipo === 5 ? 1 : 0xffffffff), 76);
    e.set(u32(ini), 116); e.set(u32(tam), 120);
    return e;
  };
  const dir = new Uint8Array(S);
  dir.set(entrada("Root Entry", 5, raizIni, raizTam), 0);
  dir.set(entrada("Workbook", 2, wbIni, stream.length), 128);
  const cab = new Uint8Array(S);
  cab.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  cab.set(u16(0x3e), 0x18); cab.set(u16(3), 0x1a); cab.set(u16(0xfffe), 0x1c); cab.set(u16(9), 0x1e); cab.set(u16(6), 0x20);
  cab.set(u32(1), 0x2c); cab.set(u32(dirIni), 0x30); cab.set(u32(4096), 0x38); cab.set(u32(miniFatIni), 0x3c); cab.set(u32(qtdMiniFat), 0x40);
  cab.set(u32(0xfffffffe), 0x44); cab.set(u32(0), 0x48);
  cab.set(u32(0), 0x4c);
  for (let i = 1; i < 109; i++) cab.set(u32(0xffffffff), 0x4c + 4 * i);
  const fatBytes = new Uint8Array(fat.slice(0, 128).flatMap(u32));
  const tudo = [cab, fatBytes, dir, ...conteudo];
  const out = new Uint8Array(tudo.reduce((n, b) => n + b.length, 0));
  let p = 0; for (const b of tudo) { out.set(b, p); p += b.length; }
  return out.subarray(0, out.length - cortar);
}

export function xlsSintetico(celulas: CelulaTeste[], opcoes: { sstPartido?: boolean; cortar?: number; preencher?: number } = {}): Uint8Array {
  const extra: CelulaTeste[] = Array.from({ length: opcoes.preencher ?? 0 }, (_, k) => [500 + k, 0, 1.5 + k]);
  return ole(workbook([...celulas, ...extra], opcoes.sstPartido), opcoes.cortar ?? 0);
}

