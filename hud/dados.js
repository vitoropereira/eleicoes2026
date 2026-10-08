// Único lugar com fetch do HUD: arquivos do 1º turno (estáticos), malha e o ao vivo do 2º turno.

const GEO = "/geo/";
const cache = new Map();

async function json(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) { const e = new Error(`${url}: HTTP ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}

/** arquivo estático do 1º turno (meta, presidente, governador, senador, depfed, depest, serie, feed) — cacheado */
export function t1(nome) {
  const url = `${GEO}t1/${nome}.json`;
  if (!cache.has(url)) cache.set(url, json(url).catch((e) => { cache.delete(url); throw e; }));
  return cache.get(url);
}

export function malha() {
  const url = `${GEO}municipios.topo.json`;
  if (!cache.has(url)) cache.set(url, json(url).catch((e) => { cache.delete(url); throw e; }));
  return cache.get(url);
}

// ---------------- 2º turno: /vivo/agora.json
// Regras: só faz polling com a aba do 2º turno ativa e depois do 1º fetch que deu certo;
// mantém o último estado bom; descarta resposta com idg menor ou inválida.
export const VIVO_URL = "/vivo/agora.json";
const INTERVALO = 15000;

const idgNum = (x) => { try { return BigInt(String(x ?? "").replace(/\D/g, "") || "0"); } catch { return 0n; } };
const valido = (d) => d && typeof d === "object" && Array.isArray(d.br) && d.mu && typeof d.mu === "object";

export function criarVivo(aoMudar) {
  const est = { status: "inicial", dados: null, erro: null, ultimoOk: null, falhas: 0 };
  let timer = 0, ativo = false, carregando = false;
  const emitir = () => aoMudar({ ...est });

  async function buscar() {
    if (carregando) return;
    carregando = true;
    if (!est.dados) { est.status = "carregando"; emitir(); }
    try {
      const d = await json(`${VIVO_URL}?t=${Math.floor(Date.now() / 15000)}`, { cache: "no-store" });
      if (!valido(d)) throw new Error("agora.json inválido");
      if (est.dados && idgNum(d.idg) < idgNum(est.dados.idg)) { /* mais velho: descarta */ }
      else { est.dados = d; }
      est.status = "ok"; est.erro = null; est.falhas = 0; est.ultimoOk = Date.now();
    } catch (e) {
      est.falhas++;
      est.erro = e;
      // sem dado nenhum ainda: estado vazio ("aguardando o TSE"); com dado: mantém o último bom
      est.status = est.dados ? "atrasado" : (e.status === 404 ? "vazio" : "erro");
    } finally {
      carregando = false;
      emitir();
      agendar();
    }
  }

  function agendar() {
    clearTimeout(timer);
    if (ativo && est.dados) timer = setTimeout(buscar, INTERVALO);
  }

  return {
    ativar() { if (ativo) return; ativo = true; buscar(); },
    desativar() { ativo = false; clearTimeout(timer); },
    get estado() { return { ...est }; },
  };
}
