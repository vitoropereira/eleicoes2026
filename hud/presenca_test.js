// deno test hud/  — "pessoas agora" com WebSocket e relógio falsos (o teste contra o Realtime real está no relatório)
import { aplicarPresenca, criarPresenca, urlRealtime, HEARTBEAT_MS, ESPERAS_MS } from "./presenca.js";

const ok = (c, m) => { if (!c) throw new Error(m || "falhou"); };
const CFG = { url: "https://abc.exemplo.test", key: "sb_publishable_x", canal: "eleicoes-hud" };

function ambiente({ webdriver = false, userAgent = "Mozilla/5.0 Chrome/155", config = { presenca: true }, configStatus = 200, sorteio = 0.5, sessao = new Map() } = {}) {
  const sockets = [], timers = [], intervalos = [], vistos = [], pedidos = [];
  let t = 1_000_000;
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.enviadas = []; sockets.push(this); }
    send(t) { this.enviadas.push(JSON.parse(t)); }
    close() { this.readyState = 3; this.fechado = true; }
    abrir() { this.readyState = 1; this.onopen?.(); }
    receber(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
    cair() { this.readyState = 3; this.onclose?.(); }
    entrar() { this.abrir(); this.receber({ topic: TOP, event: "phx_reply", ref: this.enviadas[0].ref, payload: { status: "ok", response: {} } }); }
  }
  const ouvintes = {};
  const doc = { hidden: false, addEventListener: (ev, f) => { ouvintes[ev] = f; }, removeEventListener() {} };
  const p = criarPresenca(CFG, (n) => vistos.push(n), {
    WebSocket: FakeWS, doc, nav: { webdriver, userAgent }, id: "aba-1",
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {},
    setInterval: (f, ms) => { intervalos.push({ f, ms }); return intervalos.length; }, clearInterval() {},
    fetch: async (url, opts) => {
      pedidos.push({ url, opts });
      if (config instanceof Error) throw config;
      return { ok: configStatus === 200, status: configStatus, json: async () => config };
    },
    random: () => sorteio, agora: () => t,
    sessao: { getItem: (k) => sessao.get(k) ?? null, setItem: (k, v) => sessao.set(k, String(v)) },
  });
  const passo = async () => { const x = timers.pop(); await x.f(); await esperar(); };
  return { p, sockets, timers, intervalos, vistos, doc, ouvintes, pedidos, sessao, passo, avancar: (ms) => { t += ms; } };
}
const esperar = () => new Promise((r) => setTimeout(r, 0));
const TOP = "realtime:eleicoes-hud";

Deno.test("presença: URL do Realtime com a chave e vsn 1.0.0", () => {
  ok(urlRealtime(CFG.url, CFG.key) === "wss://abc.exemplo.test/realtime/v1/websocket?apikey=sb_publishable_x&vsn=1.0.0");
});

Deno.test("presença: entra no canal com a chave da aba, anuncia (track) depois do ok, heartbeat de 25 s, conta as chaves", async () => {
  const a = ambiente();
  a.p.ligar(); await esperar();
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

Deno.test("presença: erro esconde o contador e reconecta com espera crescente", async () => {
  const a = ambiente();
  a.p.ligar(); await esperar();
  a.sockets[0].abrir();
  a.sockets[0].receber({ topic: TOP, event: "presence_state", payload: { x: { metas: [{ phx_ref: "1" }] } } });
  ok(a.vistos.at(-1) === 1);
  a.sockets[0].cair();
  ok(a.vistos.at(-1) === null, "caiu: esconde");
  ok(a.timers.at(-1).ms === ESPERAS_MS[0], "1ª espera");
  await a.passo();
  ok(a.sockets.length === 2, "reconectou");
  a.sockets[1].abrir();
  a.sockets[1].receber({ topic: TOP, event: "phx_reply", ref: a.sockets[1].enviadas[0].ref, payload: { status: "error", response: { reason: "x" } } });
  ok(a.vistos.at(-1) === null && a.timers.at(-1).ms === ESPERAS_MS[1], "join recusado: esconde e espera mais");
});

Deno.test("presença: aba escondida desconecta; ao voltar, reconecta", async () => {
  const a = ambiente();
  a.p.ligar(); await esperar();
  a.sockets[0].abrir();
  a.doc.hidden = true; a.ouvintes.visibilitychange();
  ok(a.sockets[0].fechado && a.vistos.at(-1) === null, "fechou e escondeu");
  a.doc.hidden = false; a.ouvintes.visibilitychange(); await esperar();
  ok(a.sockets.length === 2, "nova conexão ao voltar");
});

Deno.test("presença: navegador automatizado (pré-render/headless) não conecta", async () => {
  const a = ambiente({ webdriver: true });
  a.p.ligar(); await esperar();
  ok(a.sockets.length === 0 && a.pedidos.length === 0, "sem WebSocket nem config");
  // o Chrome --headless=new do pré-render tem navigator.webdriver = false: o user agent denuncia
  const h = ambiente({ userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 HeadlessChrome/155.0.0.0 Safari/537.36" });
  h.p.ligar(); await esperar();
  ok(h.sockets.length === 0, "headless sem WebSocket");
  const gente = ambiente();
  gente.p.ligar(); await esperar();
  ok(gente.sockets.length === 1, "navegador comum conecta");
});

Deno.test("presença: diff remove só a conexão que saiu (mesma chave com duas conexões)", () => {
  let e = aplicarPresenca({}, "presence_state", { k: { metas: [{ phx_ref: "a" }, { phx_ref: "b" }] } });
  e = aplicarPresenca(e, "presence_diff", { joins: {}, leaves: { k: { metas: [{ phx_ref: "a" }] } } });
  ok(Object.keys(e).length === 1 && e.k.metas.length === 1, JSON.stringify(e));
});

// ---------- segurança da cota (plano FREE, projeto compartilhado)

Deno.test("backoff: join ok e depois erro → a espera cresce (ok do join não zera a contagem)", async () => {
  const a = ambiente();
  a.p.ligar(); await esperar();
  a.sockets[0].entrar(); a.sockets[0].cair();
  ok(a.timers.at(-1).ms === ESPERAS_MS[0], `1ª: ${a.timers.at(-1).ms}`);
  await a.passo();
  a.sockets[1].entrar(); a.sockets[1].cair();
  ok(a.timers.at(-1).ms === ESPERAS_MS[1], `2ª cresce: ${a.timers.at(-1).ms}`);
  await a.passo();
  // só zera depois do 1º presence_state E de 30 s de conexão
  a.sockets[2].entrar();
  a.sockets[2].receber({ topic: TOP, event: "presence_state", payload: { x: { metas: [{ phx_ref: "1" }] } } });
  a.avancar(29_000); a.sockets[2].cair();
  ok(a.timers.at(-1).ms === ESPERAS_MS[2], "29 s no ar: não zera");
  await a.passo();
  a.sockets[3].entrar();
  a.sockets[3].receber({ topic: TOP, event: "presence_state", payload: { x: { metas: [{ phx_ref: "1" }] } } });
  a.avancar(31_000); a.sockets[3].cair();
  ok(a.timers.at(-1).ms === ESPERAS_MS[0], "estado + 31 s no ar: zera");
});

Deno.test("backoff: espera com sorteio (0,5× a 1,5×)", async () => {
  for (const [s, f] of [[0, 0.5], [0.999, 1.499]]) {
    const a = ambiente({ sorteio: s });
    a.p.ligar(); await esperar();
    a.sockets[0].cair();
    ok(Math.abs(a.timers.at(-1).ms - ESPERAS_MS[0] * f) < 1, `${s}: ${a.timers.at(-1).ms}`);
  }
});

Deno.test("a. chave geral: só conecta com /vivo/config.json {presenca: true}; ausente/404/erro = desligado", async () => {
  const liga = ambiente();
  liga.p.ligar(); await esperar();
  ok(liga.sockets.length === 1, "ligado");
  ok(liga.pedidos[0].url.startsWith("/vivo/config.json") && liga.pedidos[0].opts?.cache === "no-store", JSON.stringify(liga.pedidos[0]));
  for (const caso of [{ config: { presenca: false } }, { config: {} }, { configStatus: 404 }, { configStatus: 400, config: { statusCode: "404", error: "not_found" } }, { config: new Error("rede") }, { config: { presenca: "true" } }]) {
    const a = ambiente(caso);
    a.p.ligar(); await esperar();
    ok(a.sockets.length === 0 && a.vistos.every((v) => v == null), `não conecta: ${JSON.stringify(caso)}`);
  }
});

const muitos = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, { metas: [{ phx_ref: `r${i}` }] }]));

Deno.test("b. teto de 100: sai do canal, fecha, mostra '100+' e não volta por 10 min (sessionStorage)", async () => {
  const a = ambiente();
  a.p.ligar(); await esperar();
  const ws = a.sockets[0];
  ws.entrar();
  ws.receber({ topic: TOP, event: "presence_state", payload: muitos(99) });
  ok(a.vistos.at(-1) === 99 && !ws.fechado, "99: normal");
  ws.receber({ topic: TOP, event: "presence_diff", payload: { joins: { k99: { metas: [{ phx_ref: "x" }] } }, leaves: {} } });
  const ev = ws.enviadas.map((m) => `${m.event}:${m.payload?.event || ""}`);
  ok(ev.includes("presence:untrack") && ev.includes("phx_leave:"), ev.join());
  ok(ws.fechado && a.vistos.at(-1) === "100+", `fechou e mostra 100+: ${a.vistos.at(-1)}`);
  ok(a.sessao.size === 1, "guardou o horário");
  ok(a.timers.at(-1).ms >= 10 * 60_000, `só volta depois de 10 min: ${a.timers.at(-1).ms}`);
  // nova página na mesma sessão, 3 min depois: nem tenta
  const b = ambiente({ sessao: a.sessao });
  b.p.ligar(); await esperar();
  ok(b.sockets.length === 0 && b.vistos.at(-1) === "100+", "outra página na sessão: não conecta");
  // presence_state já com 100+
  const c = ambiente();
  c.p.ligar(); await esperar();
  c.sockets[0].entrar();
  c.sockets[0].receber({ topic: TOP, event: "presence_state", payload: muitos(150) });
  ok(c.sockets[0].fechado && c.vistos.at(-1) === "100+", "estado inicial lotado");
});

Deno.test("c. depois de 5 falhas seguidas na mesma página, não reconecta mais (nem ao voltar à aba)", async () => {
  const a = ambiente();
  a.p.ligar(); await esperar();
  for (let i = 0; i < 4; i++) { a.sockets[i].cair(); await a.passo(); }
  ok(a.sockets.length === 5, `5 tentativas: ${a.sockets.length}`);
  const timers = a.timers.length;
  a.sockets[4].cair();
  ok(a.timers.length === timers, "5ª falha: nada agendado");
  a.doc.hidden = true; a.ouvintes.visibilitychange();
  a.doc.hidden = false; a.ouvintes.visibilitychange(); await esperar();
  ok(a.sockets.length === 5 && a.vistos.at(-1) === null, "desistiu de vez");
});
