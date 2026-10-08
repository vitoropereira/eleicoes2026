// Cores de partido: o ÚNICO lugar do HUD com cor literal de dado.
// PL e PT usam os tokens da brand (--flavio, --lula); partido sem cor própria usa --outros.
// Regra da brand: nenhuma cor aqui pode ficar a menos de 25° de matiz do ciano da brand, --brand no tema escuro (testado em tests/test_hud.py).

const TOKEN = { PL: "--flavio", PT: "--lula" };

const FIXAS = {
  PSD: "#E3A33B", MDB: "#4FAE5E", "UNIÃO": "#8B6BE0", PP: "#C45AB3", REPUBLICANOS: "#D9733F",
  PSB: "#E6CE45", PODE: "#93BA45", PDT: "#E05C7E", PSDB: "#B9A2EC", PSOL: "#F2B36B",
  NOVO: "#F08A2E", PCDOB: "#B5473C", PV: "#78C46A", AVANTE: "#D69ABF", SOLIDARIEDADE: "#E87C55",
  CIDADANIA: "#C7B35B", PRD: "#A58D6A", REDE: "#5FBF8F", "MISSÃO": "#9E7BB8", AGIR: "#B88A5A",
  MOBILIZA: "#8FA05A", DC: "#C08080", DEMOCRATA: "#A07090", UP: "#D06060", PSTU: "#C04848",
  PCB: "#B03A3A", PCO: "#A03030",
};

const norm = (sg) => String(sg || "").toUpperCase().replace("UNIAO", "UNIÃO").replace("MISSAO", "MISSÃO");

/** cor para CSS (aceita var()) */
export function corCSS(sg) {
  const s = norm(sg);
  if (TOKEN[s]) return `var(${TOKEN[s]})`;
  return FIXAS[s] || "var(--outros)";
}

const hex2rgb = (h) => {
  h = h.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

let cache = new Map();
/** lê um token da brand já resolvido (muda com o tema) */
export function token(nome) {
  if (!cache.has(nome)) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
    cache.set(nome, v.startsWith("#") ? hex2rgb(v) : [128, 128, 128]);
  }
  return cache.get(nome);
}
/** chamar quando o tema muda */
export function limparCache() { cache = new Map(); }

/** cor para canvas, [r,g,b] */
export function corRGB(sg) {
  const s = norm(sg);
  if (TOKEN[s]) return token(TOKEN[s]);
  return FIXAS[s] ? hex2rgb(FIXAS[s]) : token("--outros");
}

/** mistura a cor com o fundo: t=1 cor pura, t=0 fundo */
export function misturar(rgb, fundo, t) {
  const c = rgb.map((v, i) => Math.round(fundo[i] + (v - fundo[i]) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
