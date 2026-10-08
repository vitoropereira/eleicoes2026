// Dublês de teste: Storage em memória e TSE servido a partir dos fixtures reais do 1º turno (eleição 6257).
import type { Armazenamento } from "./gravar.ts";
import type { Leitura, Tse } from "./tse.ts";

export const fixture = (nome: string): any =>
  JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${nome}.json`, import.meta.url)));

export class StorageFake implements Armazenamento {
  objetos = new Map<string, string>();
  escritas: string[] = []; // caminhos enviados, em ordem
  falharEm: string | null = null;
  ler(c: string) {
    return Promise.resolve(this.objetos.get(c) ?? null);
  }
  enviar(c: string, conteudo: string) {
    if (this.falharEm && c.includes(this.falharEm)) return Promise.reject(new Error("falha simulada"));
    this.escritas.push(c);
    this.objetos.set(c, conteudo);
    return Promise.resolve();
  }
  copiar(o: string, d: string) {
    if (this.objetos.has(d)) return Promise.resolve("existe" as const);
    this.objetos.set(d, this.objetos.get(o)!);
    this.escritas.push(`copy:${d}`);
    return Promise.resolve("ok" as const);
  }
  remover(c: string) {
    this.objetos.delete(c);
    return Promise.resolve();
  }
  json(c: string) {
    return JSON.parse(this.objetos.get(c)!);
  }
}

/** Soma `delta` aos votos do primeiro candidato e avança idg/pst, como se uma nova totalização tivesse saído. */
export function avancar(j: any, delta: number, idg: number): any {
  const c = structuredClone(j);
  c.idg = String(idg);
  for (const a of c.carg[0].agr) {
    for (const p of a.par) {
      for (const k of p.cand) {
        if (k.n === "13") {
          k.vap = String(Number(k.vap) + delta);
        }
      }
    }
  }
  c.v.vv = String(Number(c.v.vv) + delta);
  c.e.c = String(Number(c.e.c) + delta);
  return c;
}

export const MUNS_FAKE = {
  abr: [
    { cd: "df", mu: [{ cd: "97012", cdi: "5300108" }] },
    { cd: "pr", mu: [{ cd: "75353", cdi: "4106902" }, { cd: "74039", cdi: "4100202" }] },
    { cd: "zz", mu: [{ cd: "29254", cdi: "" }] },
  ],
};

export function eleC(comSegundoTurno: boolean): any {
  const base = fixture("ele-c-1t");
  if (comSegundoTurno) {
    const ciclo = base.pl.find((p: any) => p.c === "ele2026");
    ciclo.e.push(
      { cd: "6258", cdt2: "", nm: "Eleição Ordinária Federal - 2026 2º Turno", t: "2", abr: [{ cd: "br" }] },
      { cd: "6260", cdt2: "", nm: "Eleição Ordinária Estadual - 2026 2º Turno", t: "2", abr: [{ cd: "br" }] },
    );
  }
  return base;
}

export interface TseFake extends Tse {
  chamadas: string[];
  arquivos: Map<string, any>;
  /** chamado a cada leitura de município (para avançar um relógio simulado) */
  aoLerMunicipio?: () => void;
}

/** TSE fake: ele-c, lista de municípios, UFs DF/PR/ZZ e seus municípios. As demais UFs devolvem 404. */
export function criarTseFake(ele = "6258", comSegundoTurno = true): TseFake {
  const arquivos = new Map<string, any>();
  const p = (u: string, cd?: string) =>
    cd
      ? `/oficial/ele2026/${ele}/dados/${u}/${u}${cd}-c0001-e00${ele}-u.json`
      : `/oficial/ele2026/${ele}/dados/${u}/${u}-c0001-e00${ele}-u.json`;
  arquivos.set("/oficial/comum/config/ele-c.json", eleC(comSegundoTurno));
  arquivos.set(`/oficial/ele2026/${ele}/config/mun-e00${ele}-cm.json`, MUNS_FAKE);
  arquivos.set(p("df"), fixture("uf-df"));
  arquivos.set(p("df", "97012"), fixture("mun-df-brasilia"));
  arquivos.set(p("pr"), fixture("uf-pr"));
  arquivos.set(p("pr", "75353"), fixture("mun-pr-curitiba"));
  arquivos.set(p("pr", "74039"), fixture("mun-pr-adrianopolis"));
  arquivos.set(p("zz"), fixture("uf-zz"));
  arquivos.set(p("zz", "29254"), fixture("mun-zz-abidja"));
  const chamadas: string[] = [];
  const fake: TseFake = {
    chamadas,
    arquivos,
    buscar(caminho: string, etag?: string | null): Promise<Leitura> {
      chamadas.push(caminho);
      if (/\/dados\/\w+\/\w+\d+-c0001/.test(caminho)) fake.aoLerMunicipio?.();
      const j = arquivos.get(caminho);
      if (!j) return Promise.resolve({ status: 404 });
      const tag = `"${caminho.length}-${j.idg ?? "x"}-${j.v?.vv ?? ""}"`;
      if (etag && etag === tag) return Promise.resolve({ status: 304 });
      return Promise.resolve({ status: 200, json: structuredClone(j), etag: tag });
    },
  };
  return fake;
}
