// Eventos do feed (`vivo/feed.json`): +N% de seções, eleito definido, virada de líder numa UF. Puro.
import { type Agora, type Cand, lider, type Linha } from "./montar.ts";

export interface Evento {
  h: string;
  t: "apuracao" | "eleito" | "virada";
  uf?: string;
  txt: string;
}

export const MAX_EVENTOS = 50;

const pct1 = (x: number) => x.toFixed(1).replace(".", ",") + "%";

/** Os dois primeiros por votos de uma linha, com % dos válidos. */
function topo(l: Linha, cand: Cand[]): string {
  const validos = l[2] || 1;
  const ord = l[5].map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, 2);
  return ord.map((o) => `${cand[o.i].nome} ${pct1((o.v / validos) * 100)}`).join(" × ");
}

export function gerarEventos(prev: Agora | null, novo: Agora, eleitoNovo: Cand | null): Evento[] {
  const out: Evento[] = [];
  const h = novo.t;
  const antes = prev ? Math.floor(prev.pst) : -1;
  const agora = Math.floor(novo.pst);
  if (agora > antes && agora > 0) {
    out.push({ h, t: "apuracao", txt: `${agora}% das seções · ${topo(novo.br, novo.cand)}` });
  }
  if (prev) {
    for (const [uf, l] of Object.entries(novo.uf)) {
      const p = prev.uf[uf];
      if (!p || uf === "ZZ") continue;
      const a = lider(p);
      const b = lider(l);
      if (a >= 0 && b >= 0 && a !== b) {
        out.push({ h, t: "virada", uf, txt: `${uf}: ${novo.cand[b].nome} assume a liderança · ${topo(l, novo.cand)}` });
      }
    }
  }
  if (eleitoNovo) {
    out.push({ h, t: "eleito", txt: `${eleitoNovo.nome} (${eleitoNovo.sg}) é eleito presidente` });
  }
  return out;
}

export function mesclarFeed(antigo: Evento[], novos: Evento[]): Evento[] {
  const vistos = new Set<string>();
  const out: Evento[] = [];
  for (const e of [...novos, ...antigo]) {
    const k = `${e.h}|${e.t}|${e.uf ?? ""}|${e.txt}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(e);
  }
  return out.slice(0, MAX_EVENTOS);
}
