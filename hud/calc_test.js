// deno test hud/  — contas do HUD (sem rede, sem DOM)
import { linha, linhaSerie, somar, oficial, duelo } from "./calc.js";

const ok = (c, m) => { if (!c) throw new Error(m || "falhou"); };
const perto = (a, b, m) => ok(Math.abs(a - b) < 1e-9, `${m}: ${a} != ${b}`);

const LISTA = [
  { n: "22", nome: "Ruas", sg: "PL" },
  { n: "55", nome: "Paes", sg: "PSD" },
  { n: "10", nome: "Garotinho", sg: "REPUBLICANOS", sj: true },
];

Deno.test("denominador = válidos + anulados sub judice (regra do TSE)", () => {
  const r = linha("governador", [1000, 900, 800, 50, 50, [420, 300, 80], 80], LISTA);
  perto(r.total, 880, "total");
  perto(r.cands[0].p, 420 / 880, "1º");
  perto(r.cands[1].p, 300 / 880, "2º");
});

Deno.test("sub judice tem % e etiqueta, e pode liderar o município", () => {
  const r = linha("governador", [1000, 900, 700, 50, 50, [200, 100, 400], 400], LISTA);
  ok(r.lider.nome === "Garotinho" && r.lider.sj === true, "líder do município é o mais votado");
  perto(r.lider.p, 400 / 1100, "% do sub judice");
});

Deno.test("somar regiões soma votos e vansj", () => {
  const s = somar([[10, 8, 6, 1, 1, [4, 2], 1], [20, 16, 12, 2, 2, [5, 7], 3], null]);
  ok(JSON.stringify(s) === JSON.stringify([30, 24, 18, 3, 3, [9, 9], 4]), JSON.stringify(s));
});

Deno.test("linha do tempo por UF acha Flávio e Lula pelo número, não pela posição", () => {
  const lista = [{ n: "13", nome: "Lula", sg: "PT" }, { n: "22", nome: "Flávio Bolsonaro", sg: "PL" }];
  const r = linhaSerie([36.6, 50.63, 41.23], lista);
  ok(r.lider.nome === "Flávio Bolsonaro" && r.lider.sg === "PL", r.lider.nome);
  perto(r.p1, 0.5063, "p1"); perto(r.pst, 36.6, "pst");
  ok(duelo([]).F.n === "22" && duelo([]).L.n === "13", "fallback");
});

Deno.test("situação oficial vem do status.json, pelo número", () => {
  const st = { governador: { RJ: { status: "2turno", a: "22", b: "55" } }, senador: { PR: { eleitos: ["55", "22"] } } };
  const o = oficial(st, "governador", "RJ", LISTA);
  ok(o.status === "2turno" && o.a.nome === "Ruas" && o.b.nome === "Paes");
  ok(oficial(st, "senador", "PR", LISTA).eleitos.map((c) => c.nome).join() === "Paes,Ruas");
  ok(oficial(null, "governador", "RJ", LISTA) === null, "sem status → null (manchete neutra)");
});
