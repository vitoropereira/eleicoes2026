// Acesso aos arquivos públicos de resultado do TSE: descoberta da eleição e leitura com ETag.

export const TSE_BASE_PADRAO = "https://resultados.tse.jus.br";

/** Resposta de uma leitura condicional. 304 = o conteúdo não mudou desde o `etag` enviado. */
export type Leitura =
  | { status: 200; json: any; etag: string | null }
  | { status: 304 }
  | { status: 404 };

/** Tudo o que o agregador precisa do TSE. Os testes trocam isto por um fake. */
export interface Tse {
  buscar(caminho: string, etag?: string | null): Promise<Leitura>;
}

/** O TSE (Akamai) respondeu 429/403: está limitando este IP. Quem recebe deve parar de buscar nesta rodada. */
export class LimiteTse extends Error {
  constructor(caminho: string, status: number) {
    super(`TSE limitou o acesso (${status}) em ${caminho}`);
    this.name = "LimiteTse";
  }
}

/** Cliente real: `fetch` com timeout, If-None-Match e 2 novas tentativas em erro transitório. */
export function criarTse(base = TSE_BASE_PADRAO, opcoes: { timeoutMs?: number; tentativas?: number } = {}): Tse {
  const timeoutMs = opcoes.timeoutMs ?? 15_000;
  const tentativas = opcoes.tentativas ?? 3;
  return {
    async buscar(caminho, etag) {
      let ultimoErro: unknown;
      for (let i = 0; i < tentativas; i++) {
        try {
          const headers: Record<string, string> = { accept: "application/json" };
          if (etag) headers["if-none-match"] = etag;
          const r = await fetch(base + caminho, { headers, signal: AbortSignal.timeout(timeoutMs) });
          if (r.status === 304) return { status: 304 };
          if (r.status === 404) {
            await r.body?.cancel();
            return { status: 404 };
          }
          if (r.status === 429 || r.status === 403) {
            await r.body?.cancel();
            throw new LimiteTse(caminho, r.status); // sem nova tentativa: insistir prolonga o bloqueio
          }
          if (!r.ok) {
            await r.body?.cancel();
            throw new Error(`TSE ${r.status} em ${caminho}`);
          }
          return { status: 200, json: JSON.parse(await r.text()), etag: r.headers.get("etag") };
        } catch (e) {
          if (e instanceof LimiteTse) throw e;
          ultimoErro = e;
          if (i < tentativas - 1) await new Promise((ok) => setTimeout(ok, 250 * (i + 1)));
        }
      }
      throw ultimoErro;
    },
  };
}

// ---------------------------------------------------------------- caminhos

export const caminhoEleicoes = () => "/oficial/comum/config/ele-c.json";
export const caminhoMunicipios = (ele: string) => `/oficial/ele2026/${ele}/config/mun-e00${ele}-cm.json`;
export const caminhoUf = (ele: string, uf: string) =>
  `/oficial/ele2026/${ele}/dados/${uf.toLowerCase()}/${uf.toLowerCase()}-c0001-e00${ele}-u.json`;
export const caminhoMunicipio = (ele: string, uf: string, cd: string) =>
  `/oficial/ele2026/${ele}/dados/${uf.toLowerCase()}/${uf.toLowerCase()}${cd}-c0001-e00${ele}-u.json`;

// ---------------------------------------------------------------- descoberta

/**
 * Acha o código da eleição federal de 2026 em 2º turno em `ele-c.json`.
 * Devolve `null` enquanto o TSE não publicar (hoje só existem 6257/6259/6261, todos de 1º turno).
 * Não chuta código: só aceita entrada do ciclo ele2026 com `t === "2"` e "Federal" no nome.
 */
export function acharEleicaoFederal2T(eleC: any): string | null {
  const ciclos: any[] = Array.isArray(eleC?.pl) ? eleC.pl : [];
  for (const ciclo of ciclos) {
    if (ciclo?.c !== "ele2026") continue;
    for (const e of ciclo.e ?? []) {
      if (String(e?.t) === "2" && /federal/i.test(String(e?.nm ?? "")) && /^\d+$/.test(String(e?.cd))) {
        return String(e.cd);
      }
    }
  }
  return null;
}

export async function descobrirEleicao(tse: Tse): Promise<string | null> {
  const r = await tse.buscar(caminhoEleicoes());
  if (r.status !== 200) return null;
  return acharEleicaoFederal2T(r.json);
}

/** Lista de municípios por UF: `{ PR: [{cd, cdi}], ZZ: [{cd, cdi: ""}] }` (chaves em maiúsculas). */
export type ListaMunicipios = Record<string, { cd: string; cdi: string }[]>;

export function extrairMunicipios(cfg: any): ListaMunicipios {
  const out: ListaMunicipios = {};
  for (const a of cfg?.abr ?? []) {
    if (!a?.cd || !Array.isArray(a.mu)) continue;
    out[String(a.cd).toUpperCase()] = a.mu.map((m: any) => ({ cd: String(m.cd), cdi: String(m.cdi ?? "") }));
  }
  return out;
}
