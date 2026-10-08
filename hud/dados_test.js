// deno test hud/  — leitura do 2º turno com fetch e relógio falsos
import { criarVivo, INTERVALO, INTERVALO_VAZIO } from "./dados.js";

const ok = (c, m) => { if (!c) throw new Error(m || "falhou"); };
const AGORA = (idg, pst) => ({ idg, pst, t: "18:00", cand: [{ n: "22" }, { n: "13" }], br: [1, 1, 1, 0, 0, [1, 0]], uf: {}, mu: {} });

function ambiente(respostas) {
  const timers = [];
  const deps = {
    fetch: async () => {
      const r = respostas.shift();
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
