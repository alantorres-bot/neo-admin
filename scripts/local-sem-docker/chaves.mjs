// SOMENTE DESENVOLVIMENTO LOCAL: gera o segredo e as chaves anon/service_role do ambiente sem Docker. Nunca use em produção.
import { createHmac } from "node:crypto";
const segredo = "segredo-local-de-desenvolvimento-com-32-caracteres-ou-mais";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (role) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ role, iss: "supabase-local", iat: 1700000000, exp: 2000000000 });
  return `${h}.${p}.${createHmac("sha256", segredo).update(`${h}.${p}`).digest("base64url")}`; };
console.log(`SEGREDO=${segredo}\nANON=${token("anon")}\nSERVICE=${token("service_role")}`);
