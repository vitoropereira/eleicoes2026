// deno test hud/  — "pessoas agora" com WebSocket e relógio falsos (o teste contra o Realtime real está no relatório)
import { aplicarPresenca, criarPresenca, urlRealtime, HEARTBEAT_MS, ESPERAS_MS } from "./presenca.js";

const ok = (c, m) => { if (!c) throw new Error(m || "falhou"); };
const CFG = { url: "https://abc.exemplo.test", key: "sb_publishable_x", canal: "eleicoes-hud" };

function ambiente({ webdriver = false, userAgent = "Mozilla/5.0 Chrome/155" } = {}) {
  const sockets = [], timers = [], intervalos = [], vistos = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.enviadas = []; sockets.push(this); }
    send(t) { this.enviadas.push(JSON.parse(t)); }
    close() { this.readyState = 3; this.fechado = true; }
    abrir() { this.readyState = 1; this.onopen?.(); }
    receber(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
    cair() { this.readyState = 3; this.onclose?.(); }
  }
  const ouvintes = {};
  const doc = { hidden: false, addEventListener: (ev, f) => { ouvintes[ev] = f; }, removeEventListener() {} };
  const p = criarPresenca(CFG, (n) => vistos.push(n), {
    WebSocket: FakeWS, doc, nav: { webdriver, userAgent }, id: "aba-1",
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {},
    setInterval: (f, ms) => { intervalos.push({ f, ms }); return intervalos.length; }, clearInterval() {},
  });
  return { p, sockets, timers, intervalos, vistos, doc, ouvintes };
}
const TOP = "realtime:eleicoes-hud";

Deno.test("presença: URL do Realtime com a chave e vsn 1.0.0", () => {
  ok(urlRealtime(CFG.url, CFG.key) === "wss://abc.exemplo.test/realtime/v1/websocket?apikey=sb_publishable_x&vsn=1.0.0");
});

Deno.test("presença: entra no canal com a chave da aba, anuncia (track) depois do ok, heartbeat de 25 s, conta as chaves", () => {
  const a = ambiente();
  a.p.ligar();
  const ws = a.sockets[0];
  ws.abrir();
  const join = ws.enviadas[0];
  ok(join.topic === TOP && join.event === "phx_join" && join.payload.config.presence.key === "aba-1", JSON.stringify(join));
  ok(a.intervalos[0].ms === HEARTBEAT_MS, "heartbeat");
  a.intervalos[0].f();
  ok(ws.enviadas.at(-1).topic === "phoenix" && ws.enviadas.at(-1).event === "heartbeat", "heartbeat no tópico phoenix");
  ws.receber({ topic: TOP, event: "phx_reply", ref: join.ref, payload: { status: "ok", response: {} } });
  const track = ws.enviadas.at(-1);
  ok(track.event === "presence" && track.payload.type === "presence" && track.payload.event === "track", JSON.stringify(track));
  ws.receber({ topic: TOP, event: "presence_state", payload: { "aba-1": { metas: [{ phx_ref: "r1" }] }, outra: { metas: [{ phx_ref: "r2" }] } } });
  ok(a.vistos.at(-1) === 2, `2 pessoas: ${a.vistos}`);
  ws.receber({ topic: TOP, event: "presence_diff", payload: { joins: { tres: { metas: [{ phx_ref: "r3" }] } }, leaves: { outra: { metas: [{ phx_ref: "r2" }] } } } });
  ok(a.vistos.at(-1) === 2, "entrou uma, saiu uma");
  ws.receber({ topic: TOP, event: "presence_diff", payload: { joins: {}, leaves: { tres: { metas: [{ phx_ref: "r3" }] } } } });
  ok(a.vistos.at(-1) === 1, "só esta aba");
});

Deno.test("presença: erro esconde o contador e reconecta com espera crescente", () => {
  const a = ambiente();
  a.p.ligar();
  a.sockets[0].abrir();
  a.sockets[0].receber({ topic: TOP, event: "presence_state", payload: { x: { metas: [{ phx_ref: "1" }] } } });
  ok(a.vistos.at(-1) === 1);
  a.sockets[0].cair();
  ok(a.vistos.at(-1) === null, "caiu: esconde");
  ok(a.timers.at(-1).ms === ESPERAS_MS[0], "1ª espera");
  a.timers.at(-1).f();
  ok(a.sockets.length === 2, "reconectou");
  a.sockets[1].abrir();
  a.sockets[1].receber({ topic: TOP, event: "phx_reply", ref: a.sockets[1].enviadas[0].ref, payload: { status: "error", response: { reason: "x" } } });
  ok(a.vistos.at(-1) === null && a.timers.at(-1).ms === ESPERAS_MS[1], "join recusado: esconde e espera mais");
});

Deno.test("presença: aba escondida desconecta; ao voltar, reconecta", () => {
  const a = ambiente();
  a.p.ligar();
  a.sockets[0].abrir();
  a.doc.hidden = true; a.ouvintes.visibilitychange();
  ok(a.sockets[0].fechado && a.vistos.at(-1) === null, "fechou e escondeu");
  a.doc.hidden = false; a.ouvintes.visibilitychange();
  ok(a.sockets.length === 2, "nova conexão ao voltar");
});

Deno.test("presença: navegador automatizado (pré-render/headless) não conecta", () => {
  const a = ambiente({ webdriver: true });
  a.p.ligar();
  ok(a.sockets.length === 0, "sem WebSocket");
  // o Chrome --headless=new do pré-render tem navigator.webdriver = false: o user agent denuncia
  const h = ambiente({ userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 HeadlessChrome/155.0.0.0 Safari/537.36" });
  h.p.ligar();
  ok(h.sockets.length === 0, "headless sem WebSocket");
  const gente = ambiente();
  gente.p.ligar();
  ok(gente.sockets.length === 1, "navegador comum conecta");
});

Deno.test("presença: diff remove só a conexão que saiu (mesma chave com duas conexões)", () => {
  let e = aplicarPresenca({}, "presence_state", { k: { metas: [{ phx_ref: "a" }, { phx_ref: "b" }] } });
  e = aplicarPresenca(e, "presence_diff", { joins: {}, leaves: { k: { metas: [{ phx_ref: "a" }] } } });
  ok(Object.keys(e).length === 1 && e.k.metas.length === 1, JSON.stringify(e));
});
