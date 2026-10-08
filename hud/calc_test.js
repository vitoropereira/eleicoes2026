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

Deno.test("zero voto apurado: ninguém lidera e o mapa não pinta (2º turno antes das primeiras seções)", async () => {
  const { corPara } = await import("./calc.js");
  const r = linha("presidente", [1000, 0, 0, 0, 0, [0, 0, 0]], LISTA);
  ok(r.vazio === true && r.lider === null && r.segundo === null, "sem líder");
  ok(r.p1 === 0 && r.margem === 0, "p1/margem zerados");
  ok(corPara("municipios", r, "presidente") === null && corPara("vantagem", r, "presidente") === null, "sem cor de partido");
  const r1 = linha("presidente", [1000, 10, 10, 0, 0, [0, 1, 9]], LISTA);
  ok(!r1.vazio && r1.lider.nome === "Garotinho", "um voto já define o líder");
});

// ---------- 2º turno, itens da revisão (a–d)
import { resumoLeitor, fonteTurno2, modoValido, senadoEleitos } from "./calc.js";

const PRES = [{ n: "22", nome: "Flávio Bolsonaro", sg: "PL" }, { n: "13", nome: "Lula", sg: "PT" }];
const META = { cand: { presidente: PRES } };

Deno.test("a. resumo do leitor de tela usa a leitura da UF escolhida durante a linha do tempo", () => {
  const ponto = { ht: "18:32", pst: 36.6, f: 50.63, l: 41.23, uf: { PR: [83.37, 62.1, 30.2] } };
  const base = { turno: 1, temVivo: false, fonte: { br: [1, 1, 1, 0, 0, [1, 0]] }, meta: META, cargo: "presidente", lista: PRES };
  const br = resumoLeitor({ ...base, ponto, pontoUF: ponto, ufSel: null });
  ok(br.includes("36,6%") && br.includes("50,63%"), br);
  const pr = resumoLeitor({ ...base, ponto, pontoUF: ponto, ufSel: "PR" });
  ok(pr.includes("Paraná") && pr.includes("83,4%") && pr.includes("62,10%") && !pr.includes("50,63"), pr);
  const sem = resumoLeitor({ ...base, ponto, pontoUF: ponto, ufSel: "BA" });
  ok(sem.includes("Bahia") && sem.includes("não tinha publicado"), sem);
  // fora da linha do tempo, com UF escolhida: a linha da UF, não a nacional
  const fonte = { br: [0, 0, 100, 0, 0, [60, 40]], uf: { PR: [0, 0, 10, 0, 0, [9, 1]] }, pst: 50, pu: { PR: 80 }, t: "19:06" };
  const t2 = resumoLeitor({ ...base, turno: 2, temVivo: true, fonte, ponto: null, pontoUF: null, ufSel: "PR" });
  ok(t2.includes("Paraná") && t2.includes("90,00%") && t2.includes("80,0%") && t2.includes("19:06"), t2);
  const zero = resumoLeitor({ ...base, turno: 2, temVivo: true, fonte: { br: [9, 0, 0, 0, 0, [0, 0]], pst: 0 }, ponto: null, ufSel: null });
  ok(zero.includes("nenhum voto apurado"), zero);
});

Deno.test("b. minuto da linha do tempo: nunca mostra o ao vivo no lugar do minuto escolhido", () => {
  const vivo = { idg: "9" }, m1 = { t: "18:32", dados: { idg: "1" } };
  ok(fonteTurno2(null, null, m1, vivo).fonte === vivo, "sem minuto: ao vivo");
  ok(fonteTurno2(3, "18:32", m1, vivo).fonte === m1.dados, "minuto carregado");
  const carregando = fonteTurno2(4, "19:06", m1, vivo);
  ok(carregando.fonte === null && carregando.carregando, "minuto novo carregando: nada, nem o anterior nem o ao vivo");
  const falhou = fonteTurno2(4, "19:06", { t: "19:06", erro: new Error("x") }, vivo);
  ok(falhou.fonte === null && falhou.erro === true, "falhou: erro, sem cair no ao vivo");
});

Deno.test("c. Apurado sem pm volta para Municípios (só no 2º turno)", () => {
  ok(modoValido("apurado", 2, { pst: 10 }) === "municipios", "sem pm");
  ok(modoValido("apurado", 2, { pm: {} }) === "apurado", "com pm");
  ok(modoValido("apurado", 1, {}) === "apurado", "1º turno não muda");
  ok(modoValido("estados", 2, { pst: 1 }) === "estados", "outros modos intactos");
  ok(modoValido("apurado", 2, null) === "apurado", "sem dado ainda: não mexe");
});

Deno.test("d. Senado: 'são eleitos' só com status.json E 100% apurado", () => {
  const of = { eleitos: [PRES[0], PRES[1]] };
  ok(senadoEleitos(of, 100)?.length === 2, "oficial + 100%");
  ok(senadoEleitos(of, 99.99) === null, "parcial: nunca eleito");
  ok(senadoEleitos(of, undefined) === null, "sem pst: nunca eleito");
  ok(senadoEleitos({ eleitos: [] }, 100) === null && senadoEleitos(null, 100) === null, "sem status: nunca eleito");
});

Deno.test("série do 2º turno: leitura sem voto (0%) fica de fora; Flávio e Lula pelo número", async () => {
  const { serieTurno2 } = await import("./calc.js");
  const cand = [{ n: "13", nome: "Lula", sg: "PT" }, { n: "22", nome: "Flávio Bolsonaro", sg: "PL" }];
  const s = serieTurno2([
    { t: "17:00", pst: 0, br: [10, 0, 0, 0, 0, [0, 0]] },
    { t: "18:32", pst: 45.6, br: [10, 8, 100, 0, 0, [40, 60]] },
  ], cand);
  ok(s.length === 1 && s[0].ht === "18:32", JSON.stringify(s));
  perto(s[0].f, 60, "Flávio pelo número 22"); perto(s[0].l, 40, "Lula pelo número 13");
  ok(serieTurno2(null, cand).length === 0, "sem índice");
});
