import { describe, expect, it } from "vitest";
import { formatarWhatsapp, normalizarCnpj, normalizarDocumento, normalizarWhatsapp, validarCnpj, validarCpf } from "./documentos";

describe("CNPJ e CPF", () => {
  it("valida pelos dígitos verificadores", () => {
    expect(validarCnpj("11.444.777/0001-61")).toBe(true);
    expect(validarCnpj("11444777000161")).toBe(true);
    expect(validarCnpj("11.444.777/0001-62")).toBe(false);
    expect(validarCpf("529.982.247-25")).toBe(true);
    expect(validarCpf("529.982.247-24")).toBe(false);
  });

  it("recusa sequências repetidas e tamanhos errados", () => {
    expect(validarCnpj("00000000000000")).toBe(false);
    expect(validarCpf("111.111.111-11")).toBe(false);
    expect(validarCnpj("1144477700016")).toBe(false);
  });

  it("normaliza sempre com máscara, para o índice único tratar as variações como um só cadastro", () => {
    expect(normalizarDocumento("11444777000161")).toEqual({ ok: true, valor: "11.444.777/0001-61" });
    expect(normalizarDocumento(" 11.444.777/0001-61 ")).toEqual({ ok: true, valor: "11.444.777/0001-61" });
    expect(normalizarDocumento("52998224725")).toEqual({ ok: true, valor: "529.982.247-25" });
  });

  it("documento vazio é permitido (vira null); inválido devolve o motivo", () => {
    expect(normalizarDocumento("")).toEqual({ ok: true, valor: null });
    expect(normalizarDocumento(null)).toEqual({ ok: true, valor: null });
    expect(normalizarDocumento("11444777000162")).toEqual({ ok: false, erro: "CNPJ inválido." });
    expect(normalizarDocumento("52998224724")).toEqual({ ok: false, erro: "CPF inválido." });
    expect(normalizarDocumento("123")).toMatchObject({ ok: false });
  });

  it("empresa só aceita CNPJ", () => {
    expect(normalizarCnpj("11444777000161")).toEqual({ ok: true, valor: "11.444.777/0001-61" });
    expect(normalizarCnpj("52998224725")).toMatchObject({ ok: false });
  });
});

describe("WhatsApp", () => {
  it("normaliza celular e fixo para +55DDDnúmero", () => {
    expect(normalizarWhatsapp("(65) 99999-9999")).toBe("+5565999999999");
    expect(normalizarWhatsapp("65999999999")).toBe("+5565999999999");
    expect(normalizarWhatsapp("+55 65 99999-9999")).toBe("+5565999999999");
    expect(normalizarWhatsapp("55 65 3333-4444")).toBe("+556533334444");
    expect(normalizarWhatsapp("0055 65 99999-9999")).toBe("+5565999999999");
  });

  it("recusa número sem DDD, curto ou que não é do Brasil", () => {
    expect(normalizarWhatsapp("99999-9999")).toBeNull();
    expect(normalizarWhatsapp("")).toBeNull();
    expect(normalizarWhatsapp(null)).toBeNull();
    expect(normalizarWhatsapp("+1 415 555 2671")).toBeNull();
    expect(normalizarWhatsapp("(65) 89999-9999")).toBeNull(); // celular de 9 dígitos precisa começar com 9
  });

  it("formata para exibição", () => {
    expect(formatarWhatsapp("+5565999999999")).toBe("(65) 99999-9999");
    expect(formatarWhatsapp("+556533334444")).toBe("(65) 3333-4444");
    expect(formatarWhatsapp(null)).toBe("");
  });
});
