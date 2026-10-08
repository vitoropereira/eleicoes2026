// deno test hud/  — leitura do 2º turno com fetch e relógio falsos
import { criarVivo, vivoExtra, vivoMinuto, INTERVALO, INTERVALO_VAZIO } from "./dados.js";

const ok = (c, m) => { if (!c) throw new Error(m || "falhou"); };
const AGORA = (idg, pst) => ({ idg, pst, t: "18:00", cand: [{ n: "22" }, { n: "13" }], br: [1, 1, 1, 0, 0, [1, 0]], uf: {}, mu: {} });

function ambiente(respostas) {
  const timers = [];
  const deps = {
    fetch: async () => {
      const r = respostas.shift();
      if (r === 400) return { ok: false, status: 400, json: async () => ({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }) };
      if (r === 503) return { ok: false, status: 503, json: async () => ({}) };
      if (r === 404) return { ok: false, status: 404, json: async () => ({}) };
      if (r === "quebrado") return { ok: true, status: 200, json: async () => { throw new SyntaxError("JSON quebrado"); } };
      return { ok: true, status: 200, json: async () => r };
    },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    clearTimeout: () => {},
    doc: { hidden: false, addEventListener() {} },
  };
  const estados = [];
  const v = criarVivo((e) => estados.push(e), deps);
  const tick = async () => { const t = timers.shift(); await t.f(); await new Promise((r) => setTimeout(r, 0)); };
  return { v, timers, estados, tick, ultimo: () => estados[estados.length - 1] };
}
const esperar = () => new Promise((r) => setTimeout(r, 0));

Deno.test("404 → estado vazio e continua consultando a cada 60 s", async () => {
  const a = ambiente([404, 404, AGORA("10", 1)]);
  a.v.ativar(); await esperar();
  ok(a.ultimo().status === "vazio", a.ultimo().status);
  ok(a.timers.at(-1).ms === INTERVALO_VAZIO, "60 s sem dado");
  await a.tick();
  ok(a.ultimo().status === "vazio" && a.timers.at(-1).ms === INTERVALO_VAZIO, "segue tentando");
  await a.tick();
  ok(a.ultimo().status === "ok" && a.ultimo().dados.idg === "10", "pegou quando apareceu");
  ok(a.timers.at(-1).ms === INTERVALO, "com dado: 15 s");
});

Deno.test("idg menor é ignorado", async () => {
  const a = ambiente([AGORA("200", 40), AGORA("150", 30)]);
  a.v.ativar(); await esperar();
  await a.tick();
  ok(a.ultimo().dados.idg === "200" && a.ultimo().dados.pst === 40, "manteve o mais novo");
});

Deno.test("JSON quebrado mantém o último estado bom", async () => {
  const a = ambiente([AGORA("300", 50), "quebrado"]);
  a.v.ativar(); await esperar();
  await a.tick();
  ok(a.ultimo().dados.idg === "300", "dado anterior mantido");
  ok(a.ultimo().status === "atrasado", a.ultimo().status);
});

Deno.test("aba do navegador escondida não consulta; volta a consultar ao reaparecer", async () => {
  let n = 0, aoVoltar = null;
  const timers = [], doc = { hidden: true, addEventListener: (_, f) => { aoVoltar = f; } };
  const v = criarVivo(() => {}, {
    fetch: async () => { n++; return { ok: true, status: 200, json: async () => AGORA(String(n), n) }; },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {}, doc,
  });
  v.ativar(); await esperar();
  ok(n === 1, "1ª leitura ao ativar");
  await timers.shift().f(); await esperar();
  ok(n === 1, "escondida: só reagenda");
  doc.hidden = false; aoVoltar(); await esperar();
  ok(n === 2, "voltou à aba: busca na hora");
});

Deno.test("400 + Bucket not found (rewrite do Supabase) → vazio e segue a cada 60 s", async () => {
  const a = ambiente([400, 400, AGORA("10", 1)]);
  a.v.ativar(); await esperar();
  ok(a.ultimo().status === "vazio", a.ultimo().status);
  ok(a.timers.at(-1).ms === INTERVALO_VAZIO, "60 s sem dado");
  await a.tick();
  ok(a.ultimo().status === "vazio" && a.timers.at(-1).ms === INTERVALO_VAZIO, "segue tentando");
  await a.tick();
  ok(a.ultimo().status === "ok", "pegou quando apareceu");
});

Deno.test("503 → erro (TSE sem resposta de verdade), também a cada 60 s", async () => {
  const a = ambiente([503]);
  a.v.ativar(); await esperar();
  ok(a.ultimo().status === "erro", a.ultimo().status);
  ok(a.timers.at(-1).ms === INTERVALO_VAZIO, "60 s");
});

Deno.test("sondar: bucket inexistente → false sem virar erro; leitores de feed/minuto tratam como vazio", async () => {
  const a = ambiente([400]);
  ok((await a.v.sondar()) === false, "sondar false");
  const F400 = async () => ({ ok: false, status: 400, json: async () => ({ statusCode: "404", error: "Bucket not found" }) });
  ok((await vivoExtra("feed.json", F400)) === null, "feed null");
  const F200err = async () => ({ ok: true, status: 200, json: async () => ({ statusCode: "404", error: "not_found" }) });
  ok((await vivoExtra("feed.json", F200err)) === null, "feed 200 com corpo de erro → null");
  let erro = null;
  try { await vivoMinuto("1800", F200err); } catch (e) { erro = e; }
  ok(erro && erro.vazio === true, "minuto: corpo de erro rejeita como vazio");
});

Deno.test("produção hoje: HTTP 400 + NoSuchKey (bucket existe, agora.json não) → vazio, sem virar erro", async () => {
  // corpo real de /vivo/agora.json em 08/10 (bucket `vivo` criado, objeto ainda não gravado)
  const corpo = { statusCode: "404", error: "not_found", message: "Object not found", code: "NoSuchKey" };
  const timers = [];
  const estados = [];
  const v = criarVivo((e) => estados.push(e), {
    fetch: async () => ({ ok: false, status: 400, json: async () => corpo }),
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {},
    doc: { hidden: false, addEventListener() {} },
  });
  v.ativar(); await esperar();
  ok(estados.at(-1).status === "vazio", estados.at(-1).status);
  ok(timers.at(-1).ms === INTERVALO_VAZIO, "60 s sem dado");
  const F = async () => ({ ok: false, status: 400, json: async () => corpo });
  ok((await v.sondar()) === false, "sondar false: não abre no 2º turno");
  ok((await vivoExtra("serie/index.json", F)) === null, "série null");
  // mesmo corpo vindo com 200 (proxy que reescreve status) também é vazio
  const F200 = async () => ({ ok: true, status: 200, json: async () => corpo });
  ok((await vivoExtra("feed.json", F200)) === null, "feed 200+NoSuchKey → null");
});

Deno.test("b. minuto: pedido novo cancela o anterior e resposta velha é descartada; falha devolve erro", async () => {
  const { criarMinuto } = await import("./dados.js");
  const pendentes = [];
  const F = (url, opts) => new Promise((ok_, falha) => {
    pendentes.push({ url, ok_, falha });
    opts?.signal?.addEventListener("abort", () => falha(new DOMException("abortado", "AbortError")));
  });
  const m = criarMinuto(F);
  const a = m.ler("17:01"), b = m.ler("17:02");
  ok(pendentes.length === 2 && pendentes[1].url.includes("1702"), "dois pedidos");
  pendentes[1].ok_({ ok: true, status: 200, json: async () => ({ idg: "2" }) });
  ok((await a) === null, "o primeiro (cancelado/velho) volta null");
  const rb = await b;
  ok(rb.t === "17:02" && rb.dados.idg === "2", "o último vale");
  // falha: devolve erro com o minuto escolhido
  const c = m.ler("17:03");
  pendentes[2].ok_({ ok: false, status: 503, json: async () => ({}) });
  const rc = await c;
  ok(rc.t === "17:03" && rc.erro && !rc.dados, "erro sem dado");
  // resposta que chega depois de um pedido mais novo é ignorada mesmo sem abort
  const semAbort = criarMinuto((url) => new Promise((ok_) => pendentes.push({ url, ok_ })));
  const d1 = semAbort.ler("17:04"), d2 = semAbort.ler("17:05");
  pendentes.at(-1).ok_({ ok: true, status: 200, json: async () => ({ idg: "5" }) });
  pendentes.at(-2).ok_({ ok: true, status: 200, json: async () => ({ idg: "4" }) });
  ok((await d1) === null && (await d2).dados.idg === "5", "resposta velha descartada");
});
