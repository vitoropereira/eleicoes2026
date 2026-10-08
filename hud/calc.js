// Contas e textos do HUD (sem DOM): normaliza o formato do contrato, cores por modo, resumos.
import { corRGB, corCSS, misturar, token } from "./partidos.js";

export const UF_NOME = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba",
  PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins", ZZ: "Exterior",
};
export const UFS = Object.keys(UF_NOME).filter((u) => u !== "ZZ").sort();
export const REGIOES = [
  ["Norte", ["AC", "AM", "AP", "PA", "RO", "RR", "TO"]],
  ["Nordeste", ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"]],
  ["Centro-Oeste", ["DF", "GO", "MS", "MT"]],
  ["Sudeste", ["ES", "MG", "RJ", "SP"]],
  ["Sul", ["PR", "RS", "SC"]],
];
export const CARGOS = [
  ["presidente", "Presidente"], ["governador", "Governadores"], ["senador", "Senado"],
  ["depfed", "Dep. Federal"], ["depest", "Dep. Estadual"],
];
export const CARGO_NOME = Object.fromEntries(CARGOS);
export const MODOS = [["municipios", "Municípios"], ["estados", "Estados"], ["vantagem", "Vantagem"], ["apurado", "Apurado"]];

// ---------- formatação pt-BR
export const pct = (x, d = 1) => (Number.isFinite(x) ? x.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
export const int = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString("pt-BR") : "–");
const PART = new Set(["de", "da", "do", "dos", "das", "e", "d'"]);
/** "ABIDJÃ" → "Abidjã"; nomes já em caixa de título passam intactos */
export const titulo = (s) => (s && s === s.toUpperCase()
  ? s.toLowerCase().split(" ").map((w, i) => (i && PART.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ")
  : s || "");
export const semAcento = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const primeiroNome = (n) => {
  const p = String(n).split(" ");
  return p.length > 2 ? p.slice(0, 2).join(" ") : n;
};

const CURTA = { REPUBLICANOS: "REPUB", SOLIDARIEDADE: "SD", CIDADANIA: "CID", DEMOCRATA: "DEM", MOBILIZA: "MOB" };
/** sigla curta para rótulos no mapa */
export const curta = (sg) => CURTA[sg] || sg;

export const ehDep = (c) => c === "depfed" || c === "depest";

/**
 * Resultado normalizado de uma linha do contrato.
 * pres/gov/sen: [eleitores, comparecimento, validos, brancos, nulos, [votos...]] com candidatos de `lista`
 * dep: [validos, "PL", votos_partido_top, [["Nome","PL",votos],...]]
 */
export function linha(cargo, row, lista) {
  if (!row) return null;
  if (ehDep(cargo)) {
    const [vv, sg, vp, top] = row;
    const cands = (top || []).map(([nome, s, v]) => ({ nome, sg: s, v, p: vv ? v / vv : 0 }));
    return { dep: true, validos: vv, sg, partidoV: vp, partidoP: vv ? vp / vv : 0, cands, lider: { sg }, p1: vv ? vp / vv : 0, margem: null };
  }
  const [el, comp, vv, vb, vn, votos] = row;
  const cands = (lista || []).map((c, i) => ({ ...c, v: votos?.[i] || 0 }));
  const soma = cands.reduce((s, c) => s + c.v, 0);
  const base = vv || soma || 1;
  cands.forEach((c) => { c.p = c.v / base; });
  cands.sort((a, b) => b.v - a.v);
  const [a, b] = cands;
  return {
    eleitores: el, comparecimento: comp, validos: vv, brancos: vb, nulos: vn, cands,
    lider: a, segundo: b, p1: a ? a.p : 0, margem: a ? a.p - (b ? b.p : 0) : 0,
    pc: el ? comp / el : 0, pbn: comp ? (vb + vn) / comp : 0,
  };
}

const lim = (x) => Math.max(0, Math.min(1, x));

/** intensidade (0..1) da cor de um resultado em cada modo */
export function intensidade(modo, r, cargo) {
  if (!r) return 0;
  if (modo === "vantagem") return r.margem == null ? 0.35 + 0.65 * lim((r.p1 - 0.1) / 0.3) : 0.12 + 0.88 * lim(r.margem / 0.45);
  if (ehDep(cargo)) return 0.42 + 0.58 * lim((r.p1 - 0.08) / 0.35);
  return 0.42 + 0.58 * lim((r.p1 - 0.3) / 0.4);
}

/** cor de preenchimento de canvas para um resultado */
export function corPara(modo, r, cargo, pstFrac = 1) {
  const bg = token("--bg");
  if (!r) return null;
  if (modo === "apurado") return misturar(token("--ink2"), bg, 0.12 + 0.75 * lim(pstFrac));
  return misturar(corRGB(r.lider?.sg), bg, intensidade(modo, r, cargo));
}

export const cor = corCSS;

/** linha de UF a partir de um ponto da série: [pst, f, l] */
export function linhaSerie(uf3, lista) {
  if (!uf3) return null;
  const [pst, f, l] = uf3;
  const F = lista?.[0] || { nome: "Flávio Bolsonaro", sg: "PL" }, L = lista?.[1] || { nome: "Lula", sg: "PT" };
  const cands = [{ ...F, p: f / 100 }, { ...L, p: l / 100 }].sort((a, b) => b.p - a.p);
  return { cands, lider: cands[0], segundo: cands[1], p1: cands[0].p, margem: cands[0].p - cands[1].p, pst };
}

/** soma linhas no formato [el, comp, vv, vb, vn, [votos]] */
export function somar(rows) {
  const out = [0, 0, 0, 0, 0, []];
  for (const r of rows) {
    if (!r) continue;
    for (let i = 0; i < 5; i++) out[i] += r[i] || 0;
    r[5].forEach((v, i) => { out[5][i] = (out[5][i] || 0) + v; });
  }
  return out;
}

export const fundo = () => token("--bg");
