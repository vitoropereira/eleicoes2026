// "Pessoas agora": presença no Supabase Realtime, sem supabase-js. Protocolo Phoenix (vsn 1.0.0) direto no WebSocket:
// entra no canal público `realtime:<canal>` com uma chave aleatória por aba, anuncia presença (track) e conta as chaves
// de presence_state/presence_diff. Heartbeat a cada 25 s. Qualquer erro esconde o contador (callback com null) e tenta
// de novo com espera crescente. Aba escondida desconecta; ao voltar, reconecta. Navegador automatizado
// (navigator.webdriver ou HeadlessChrome: o pré-render do build) não conecta nem conta.
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

/**
 * Conexão de presença. `aoMudar(n)`: n = pessoas no canal (inclui esta aba) ou null (desconectado/erro: esconder).
 * deps (testes): WebSocket, setTimeout, clearTimeout, setInterval, clearInterval, doc, nav, id
 */
export function criarPresenca({ url, key, canal }, aoMudar, deps = {}) {
  const WS = deps.WebSocket || globalThis.WebSocket;
  const ST = deps.setTimeout || ((f, ms) => setTimeout(f, ms)), CT = deps.clearTimeout || ((t) => clearTimeout(t));
  const SI = deps.setInterval || ((f, ms) => setInterval(f, ms)), CI = deps.clearInterval || ((t) => clearInterval(t));
  const doc = deps.doc !== undefined ? deps.doc : (typeof document !== "undefined" ? document : null);
  const nav = deps.nav !== undefined ? deps.nav : (typeof navigator !== "undefined" ? navigator : null);
  const id = deps.id || idAleatorio();
  const topico = `realtime:${canal}`;
  let ws = null, ref = 0, joinRef = null, hb = 0, espera = 0, tentativa = 0, ligado = false, estado = {}, ultimo;

  const emitir = (n) => { if (n !== ultimo) { ultimo = n; aoMudar(n); } };
  const mandar = (msg) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); } catch { /* cai no onclose */ } };

  function fechar() {
    CI(hb); hb = 0;
    const w = ws; ws = null; estado = {};
    if (w) { w.onopen = w.onmessage = w.onclose = w.onerror = null; try { w.close(); } catch { /* já fechado */ } }
  }

  function falhou() {
    fechar();
    emitir(null);
    if (!ligado || doc?.hidden) return;
    CT(espera);
    espera = ST(conectar, ESPERAS_MS[Math.min(tentativa++, ESPERAS_MS.length - 1)]);
  }

  function conectar() {
    CT(espera); espera = 0;
    if (!ligado || ws || doc?.hidden || !WS) return;
    try { ws = new WS(urlRealtime(url, key)); } catch { falhou(); return; }
    ws.onopen = () => {
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
        tentativa = 0;
        mandar({ topic: topico, event: "presence", ref: String(++ref), join_ref: joinRef, payload: { type: "presence", event: "track", payload: { t: Date.now() } } });
      } else if (m.event === "presence_state" || m.event === "presence_diff") {
        estado = aplicarPresenca(estado, m.event, m.payload);
        emitir(Object.keys(estado).length || null);
      } else if (m.event === "phx_error" || m.event === "phx_close" || m.event === "system" && m.payload?.status === "error") {
        falhou();
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => { if (ws) falhou(); };
  }

  const pausar = () => { CT(espera); fechar(); emitir(null); };
  const retomar = () => { tentativa = 0; conectar(); };
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
      conectar();
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
