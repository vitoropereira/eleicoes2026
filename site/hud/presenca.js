// "Pessoas agora": presença no Supabase Realtime, sem supabase-js. Protocolo Phoenix (vsn 1.0.0) direto no WebSocket:
// entra no canal público `realtime:<canal>` com uma chave aleatória por aba, anuncia presença (track) e conta as chaves
// de presence_state/presence_diff. Heartbeat a cada 25 s. Qualquer erro esconde o contador (callback com null) e tenta
// de novo com espera crescente e sorteada. Aba escondida desconecta; ao voltar, reconecta. Navegador automatizado
// (navigator.webdriver ou HeadlessChrome: o pré-render do build) não conecta nem conta.
// Proteção da cota (plano FREE, projeto compartilhado com o site pessoal): só conecta com /vivo/config.json
// {"presenca": true}; com 100 pessoas sai do canal e mostra "100+" (10 min de pausa na sessão); 5 falhas seguidas na
// página e desiste.
// A chave usada é a publishable do projeto: pública por desenho (é a mesma que qualquer site Supabase expõe).

export const HEARTBEAT_MS = 25000;
export const ESPERAS_MS = [2000, 4000, 8000, 16000, 30000, 60000];

export const urlRealtime = (url, key) =>
  `${String(url).replace(/^http/, "ws").replace(/\/$/, "")}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`;

/** aplica presence_state (substitui) ou presence_diff (joins/leaves por phx_ref) e devolve o novo estado */
export function aplicarPresenca(estado, evento, payload) {
  if (evento === "presence_state") {
    const out = {};
    for (const [k, v] of Object.entries(payload || {})) if (v?.metas?.length) out[k] = { metas: [...v.metas] };
    return out;
  }
  if (evento !== "presence_diff") return estado;
  const out = Object.fromEntries(Object.entries(estado).map(([k, v]) => [k, { metas: [...v.metas] }]));
  for (const [k, v] of Object.entries(payload?.leaves || {})) {
    if (!out[k]) continue;
    const sai = new Set((v?.metas || []).map((m) => m.phx_ref));
    out[k].metas = out[k].metas.filter((m) => !sai.has(m.phx_ref));
    if (!out[k].metas.length) delete out[k];
  }
  for (const [k, v] of Object.entries(payload?.joins || {})) {
    const ja = new Set((out[k]?.metas || []).map((m) => m.phx_ref));
    out[k] = { metas: [...(out[k]?.metas || []), ...(v?.metas || []).filter((m) => !ja.has(m.phx_ref))] };
  }
  return out;
}

/** navegador de robô: navigator.webdriver (automação) ou Chrome headless (o --headless=new do build tem webdriver=false) */
export const automatizado = (nav) => !!nav && (nav.webdriver === true || /HeadlessChrome/.test(String(nav.userAgent || "")));

const idAleatorio = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export const CONFIG_URL = "/vivo/config.json"; // chave geral: {"presenca": true} liga; ausente/erro = desligado
export const LIMITE = 100; // a partir daqui sai do canal: protege a cota do Realtime (plano FREE, projeto compartilhado)
export const PAUSA_LOTADO_MS = 10 * 60 * 1000;
export const MAX_FALHAS = 5; // falhas seguidas numa página; depois disso, não tenta mais
export const SAUDAVEL_MS = 30000; // conexão só conta como boa (zera o backoff) com presence_state e 30 s no ar
const CHAVE_LOTADO = "hud-presenca-lotado";

/**
 * Conexão de presença. `aoMudar(n)`: n = pessoas no canal (inclui esta aba), "100+" (lotado) ou null (esconder).
 * deps (testes): WebSocket, setTimeout, clearTimeout, setInterval, clearInterval, doc, nav, id, fetch, random, agora, sessao
 */
export function criarPresenca({ url, key, canal }, aoMudar, deps = {}) {
  const WS = deps.WebSocket || globalThis.WebSocket;
  const ST = deps.setTimeout || ((f, ms) => setTimeout(f, ms)), CT = deps.clearTimeout || ((t) => clearTimeout(t));
  const SI = deps.setInterval || ((f, ms) => setInterval(f, ms)), CI = deps.clearInterval || ((t) => clearInterval(t));
  const doc = deps.doc !== undefined ? deps.doc : (typeof document !== "undefined" ? document : null);
  const nav = deps.nav !== undefined ? deps.nav : (typeof navigator !== "undefined" ? navigator : null);
  const F = deps.fetch || ((...a) => fetch(...a));
  const sorteio = deps.random || Math.random, agora = deps.agora || (() => Date.now());
  const sessao = deps.sessao !== undefined ? deps.sessao : (() => { try { return globalThis.sessionStorage || null; } catch { return null; } })();
  const id = deps.id || idAleatorio();
  const topico = `realtime:${canal}`;
  let ws = null, ref = 0, joinRef = null, hb = 0, espera = 0, tentativa = 0, falhas = 0, desistiu = false;
  let ligado = false, conectando = false, estado = {}, ultimo, abertoEm = 0, viuEstado = false;

  const emitir = (n) => { if (n !== ultimo) { ultimo = n; aoMudar(n); } };
  const mandar = (msg) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); } catch { /* cai no onclose */ } };
  const lotadoAte = () => { try { return Number(sessao?.getItem(CHAVE_LOTADO) || 0) + PAUSA_LOTADO_MS; } catch { return 0; } };

  function fechar() {
    CI(hb); hb = 0;
    const w = ws; ws = null; estado = {}; viuEstado = false;
    if (w) { w.onopen = w.onmessage = w.onclose = w.onerror = null; try { w.close(); } catch { /* já fechado */ } }
  }

  function falhou() {
    // a conexão que caiu foi boa (estado recebido e 30 s no ar)? então zera o backoff e a contagem de falhas
    if (viuEstado && agora() - abertoEm >= SAUDAVEL_MS) { tentativa = 0; falhas = 0; }
    fechar();
    emitir(null);
    if (++falhas >= MAX_FALHAS) { desistiu = true; CT(espera); return; } // nesta página, chega
    if (!ligado || doc?.hidden) return;
    CT(espera);
    const base = ESPERAS_MS[Math.min(tentativa++, ESPERAS_MS.length - 1)];
    espera = ST(conectar, base * (0.5 + sorteio()));
  }

  /** passou do teto: anuncia saída, sai do canal, fecha e só volta depois de 10 min (vale para a sessão do navegador) */
  function lotou() {
    mandar({ topic: topico, event: "presence", ref: String(++ref), join_ref: joinRef, payload: { type: "presence", event: "untrack" } });
    mandar({ topic: topico, event: "phx_leave", ref: String(++ref), join_ref: joinRef, payload: {} });
    fechar();
    try { sessao?.setItem(CHAVE_LOTADO, String(agora())); } catch { /* sem sessionStorage: vale só o timer */ }
    emitir(`${LIMITE}+`);
    CT(espera);
    if (ligado) espera = ST(conectar, PAUSA_LOTADO_MS);
  }

  async function configLigada() {
    try {
      const r = await F(`${CONFIG_URL}?t=${Math.floor(agora() / 15000)}`, { cache: "no-store" });
      if (!r.ok) return false;
      const c = await r.json();
      return c?.presenca === true;
    } catch { return false; }
  }

  async function conectar() {
    CT(espera); espera = 0;
    if (!ligado || ws || conectando || desistiu || doc?.hidden || !WS) return;
    const ate = lotadoAte();
    if (ate > agora()) { emitir(`${LIMITE}+`); espera = ST(conectar, ate - agora()); return; }
    conectando = true;
    const ok = await configLigada();
    conectando = false;
    if (!ok) { emitir(null); return; } // chave geral desligada (ou sem config): nada de Realtime nesta tentativa
    if (!ligado || ws || desistiu || doc?.hidden) return;
    try { ws = new WS(urlRealtime(url, key)); } catch { falhou(); return; }
    ws.onopen = () => {
      abertoEm = agora();
      joinRef = String(++ref);
      mandar({
        topic: topico, event: "phx_join", ref: joinRef, join_ref: joinRef,
        payload: { config: { broadcast: { self: false, ack: false }, presence: { key: id, enabled: true }, postgres_changes: [], private: false } },
      });
      hb = SI(() => mandar({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(++ref) }), HEARTBEAT_MS);
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.topic !== topico) return; // respostas do heartbeat (topic "phoenix") não interessam
      if (m.event === "phx_reply" && m.ref === joinRef) {
        if (m.payload?.status !== "ok") return falhou();
        mandar({ topic: topico, event: "presence", ref: String(++ref), join_ref: joinRef, payload: { type: "presence", event: "track", payload: { t: agora() } } });
      } else if (m.event === "presence_state" || m.event === "presence_diff") {
        if (m.event === "presence_state") viuEstado = true;
        estado = aplicarPresenca(estado, m.event, m.payload);
        const n = Object.keys(estado).length;
        if (n >= LIMITE) return lotou();
        emitir(n || null);
      } else if (m.event === "phx_error" || m.event === "phx_close" || m.event === "system" && m.payload?.status === "error") {
        falhou();
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => { if (ws) falhou(); };
  }

  const pausar = () => { CT(espera); fechar(); if (typeof ultimo !== "string") emitir(null); };
  const retomar = () => { conectar(); };
  const aoMudarVisibilidade = () => { if (ligado) (doc.hidden ? pausar() : retomar()); };
  const aoEsconderPagina = () => { if (ligado) pausar(); }; // pagehide: fecha o socket (inclusive indo para o bfcache)
  const aoMostrarPagina = () => { if (ligado && !doc?.hidden) retomar(); }; // pageshow: volta do bfcache

  return {
    id,
    ligar() {
      if (ligado || automatizado(nav)) return; // pré-render e navegador automatizado não contam
      ligado = true;
      doc?.addEventListener?.("visibilitychange", aoMudarVisibilidade);
      doc?.defaultView?.addEventListener?.("pagehide", aoEsconderPagina);
      doc?.defaultView?.addEventListener?.("pageshow", aoMostrarPagina);
      return conectar();
    },
    desligar,
  };
  function desligar() {
    if (!ligado) return;
    ligado = false;
    CT(espera);
    doc?.removeEventListener?.("visibilitychange", aoMudarVisibilidade);
    doc?.defaultView?.removeEventListener?.("pagehide", aoEsconderPagina);
    doc?.defaultView?.removeEventListener?.("pageshow", aoMostrarPagina);
    fechar();
    emitir(null);
  }
}

// uma conexão por página, compartilhada pelos componentes que mostram o contador
let unica = null, ouvintes = new Set(), valor = null;
/** assina o contador; devolve a função que cancela a assinatura (a última desliga a conexão) */
export function assinarPresenca(cfg, cb) {
  if (!cfg?.url || !cfg?.key || !cfg?.canal) return () => {};
  ouvintes.add(cb);
  if (!unica) {
    unica = criarPresenca(cfg, (n) => { valor = n; ouvintes.forEach((f) => f(n)); });
    unica.ligar();
  } else cb(valor);
  return () => {
    ouvintes.delete(cb);
    if (!ouvintes.size && unica) { unica.desligar(); unica = null; valor = null; }
  };
}
