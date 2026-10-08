import { assert, assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { avancar, criarTseFake, eleC, fixture, StorageFake } from "./_fakes.ts";
import { executar } from "./executar.ts";
import { gerarEventos, mesclarFeed } from "./feed.ts";
import { gravarAtomico } from "./gravar.ts";
import { extrairCandidatos, linhaDe, montarAgora, nomeExibicao, validarAgora } from "./montar.ts";
import { tratar } from "./index.ts";
import { acharEleicaoFederal2T, descobrirEleicao } from "./tse.ts";

const ELE = "6258";
const p = (u: string, cd?: string) =>
  cd
    ? `/oficial/ele2026/${ELE}/dados/${u}/${u}${cd}-c0001-e00${ELE}-u.json`
    : `/oficial/ele2026/${ELE}/dados/${u}/${u}-c0001-e00${ELE}-u.json`;
const relogio = (passo = 0) => {
  let t = 1_000_000;
  return { agora: () => t, avancar: () => (t += passo) };
};

// ---------------------------------------------------------------- descoberta

Deno.test("descoberta: só existem códigos de 1º turno -> null (arquivo real do TSE)", async () => {
  assertEquals(acharEleicaoFederal2T(fixture("ele-c-1t")), null);
  const tse = criarTseFake(ELE, false);
  assertEquals(await descobrirEleicao(tse), null);
});

Deno.test("descoberta: acha turno 2 Federal 2026 e ignora Estadual, turno 1 e outros ciclos", () => {
  assertEquals(acharEleicaoFederal2T(eleC(true)), "6258");
  const so_estadual = eleC(false);
  so_estadual.pl.find((x: any) => x.c === "ele2026").e.push({
    cd: "6260",
    nm: "Eleição Ordinária Estadual - 2026 2º Turno",
    t: "2",
  });
  assertEquals(acharEleicaoFederal2T(so_estadual), null);
  const outro_ciclo = eleC(false);
  outro_ciclo.pl.find((x: any) => x.c === "ele2024").e.push({ cd: "999", nm: "Federal 2º Turno", t: "2" });
  assertEquals(acharEleicaoFederal2T(outro_ciclo), null);
  assertEquals(acharEleicaoFederal2T({}), null);
});

Deno.test("sem eleição: devolve sem-eleicao e não escreve nada", async () => {
  const st = new StorageFake();
  const r = await executar({ tse: criarTseFake(ELE, false), st, agora: relogio().agora });
  assertEquals(r.status, "sem-eleicao");
  assertEquals(st.escritas, []);
  assertEquals(st.objetos.size, 0);
});

// ---------------------------------------------------------------- transformação

Deno.test("montar: linha do contrato a partir de um município real (Curitiba)", () => {
  const j = fixture("mun-pr-curitiba");
  const cand = extrairCandidatos(j);
  assertEquals(cand.length, 12);
  assertEquals(cand[0].nome.length > 0, true);
  const l = linhaDe(j, cand);
  assertEquals(l.length, 6);
  assertEquals(l[0], 1415148); // eleitores
  assertEquals(l[1], 1136092); // comparecimento
  assertEquals(l[2], 1093434); // válidos
  assertEquals(l[3], 19244); // brancos
  assertEquals(l[4], 23414); // nulos (23378 + 36 técnicos): fecha com o comparecimento
  assertEquals(l[2] + l[3] + l[4], l[1]);
  assertEquals(l[5].reduce((a, b) => a + b, 0), l[2]); // votos nominais somam os válidos
});

Deno.test("montar: nomes de exibição", () => {
  assertEquals(nomeExibicao("FLAVIO BOLSONARO"), "Flávio Bolsonaro");
  assertEquals(nomeExibicao("LULA"), "Lula");
  assertEquals(nomeExibicao("MARIA DA SILVA"), "Maria da Silva");
});

async function rodada1() {
  const st = new StorageFake();
  const tse = criarTseFake(ELE);
  const r = await executar({ tse, st, agora: relogio().agora });
  return { st, tse, r };
}

Deno.test("agora.json: formato idêntico ao contrato (presidente.json + t, idg, pst)", async () => {
  const { st, r } = await rodada1();
  assertEquals(r.status, "gravado");
  const a = st.json("agora.json");
  assertEquals(validarAgora(a), []);
  // chaves do contrato
  for (const k of ["br", "uf", "mu", "ex", "t", "idg", "pst"]) assert(k in a, `falta ${k}`);
  assertEquals(a.br.length, 6);
  assertEquals(a.br[5].length, a.cand.length);
  assertEquals(Object.keys(a.uf), ["DF", "PR", "ZZ"]);
  assertEquals(Object.keys(a.mu).sort(), ["4100202", "4106902", "5300108"]); // IBGE de 7 dígitos
  assertEquals(Object.keys(a.ex), ["29254"]);
  assertEquals(typeof a.idg, "string");
  assertEquals(a.t, "12:51");
  assertEquals(a.pst, 100);
  // JSON compacto, sem espaços
  assertEquals(st.objetos.get("agora.json")!.includes(": "), false);
  // br = soma das UFs
  const somaVV = Object.values<any>(a.uf).reduce((s, l) => s + l[2], 0);
  assertEquals(a.br[2], somaVV);
  // idg do arquivo = maior idg das UFs
  assertEquals(a.idg, String(Math.max(...["uf-df", "uf-pr", "uf-zz"].map((n) => Number(fixture(n).idg)))));
});

Deno.test("invariante: total da UF == soma dos municípios (DF tem 1 município, dados reais)", async () => {
  const { st } = await rodada1();
  const a = st.json("agora.json");
  assertEquals(a.uf.DF, a.mu["5300108"]);
  // vale também sobre os arquivos brutos
  const c = extrairCandidatos(fixture("uf-df"));
  assertEquals(linhaDe(fixture("uf-df"), c), linhaDe(fixture("mun-df-brasilia"), c));
});

Deno.test("grava série, índice, feed e estado; nada fica em _tmp", async () => {
  const { st } = await rodada1();
  for (const c of ["agora.json", "serie/1251.json", "serie/index.json", "feed.json", "_estado.json"]) {
    assert(st.objetos.has(c), `falta ${c}`);
  }
  assertEquals([...st.objetos.keys()].filter((k) => k.startsWith("_tmp/")), []);
  assertEquals(st.json("serie/1251.json"), st.json("agora.json"));
  const idx = st.json("serie/index.json");
  assertEquals(idx.length, 1);
  assertEquals(idx[0].t, "12:51");
  assertEquals(idx[0].br, st.json("agora.json").br);
  assert(st.json("feed.json").length <= 50);
  assertEquals(st.json("_estado.json").travaAte, 0);
  // agora.json é a última coisa gravada antes do estado
  const iAgora = st.escritas.lastIndexOf("agora.json");
  assert(st.escritas.indexOf("serie/1251.json") < iAgora || st.escritas.some((e) => e.startsWith("copy:serie/1251")));
});

// ---------------------------------------------------------------- incremental / ETag

Deno.test("segunda rodada sem mudança: 304 em tudo, não regrava agora.json", async () => {
  const { st, tse } = await rodada1();
  const antes = st.escritas.filter((e) => e.includes("agora.json")).length;
  tse.chamadas.length = 0;
  const r = await executar({ tse, st, agora: relogio().agora });
  assertEquals(r.status, "sem-mudanca");
  assertEquals(st.escritas.filter((e) => e.includes("agora.json")).length, antes);
  assertEquals(tse.chamadas.filter((c) => /pr\d+-c0001/.test(c)), []); // nenhum município rebuscado
});

Deno.test("UF que mudou: rebusca só os municípios dela, com If-None-Match", async () => {
  const { st, tse } = await rodada1();
  const idgPr = Number(fixture("uf-pr").idg);
  tse.arquivos.set(p("pr"), avancar(fixture("uf-pr"), 500, idgPr + 10));
  tse.arquivos.set(p("pr", "75353"), avancar(fixture("mun-pr-curitiba"), 500, idgPr + 10));
  tse.chamadas.length = 0;
  const r = await executar({ tse, st, agora: relogio().agora });
  assertEquals(r.status, "gravado");
  if (r.status === "gravado") assertEquals(r.ufsAtualizadas, ["PR"]);
  assertEquals(tse.chamadas.filter((c) => c.includes("/df")).length, 1); // só o arquivo da UF (304)
  const a = st.json("agora.json");
  assertEquals(a.mu["4106902"][2], 1093434 + 500);
  assertEquals(a.mu["4100202"][2], 4201); // Adrianópolis veio do cache (304)
  // feed ganhou evento; índice tem as duas rodadas se o minuto mudou (aqui mesmo minuto -> 1 entrada)
  assert(st.json("serie/index.json").length >= 1);
});

// ---------------------------------------------------------------- idg monotônico

Deno.test("idg nunca regride: arquivos com idg menor não sobrescrevem agora.json", async () => {
  const { st, tse } = await rodada1();
  const antes = st.objetos.get("agora.json");
  const idgAntes = st.json("agora.json").idg;
  for (const [u, m] of [["df", "97012"], ["pr", "75353"], ["pr", "74039"], ["zz", "29254"]] as const) {
    tse.arquivos.set(p(u, m), avancar(tse.arquivos.get(p(u, m)), 10, 100));
  }
  for (const u of ["df", "pr", "zz"]) tse.arquivos.set(p(u), avancar(tse.arquivos.get(p(u)), 10, 100));
  const r = await executar({ tse, st, agora: relogio().agora });
  assertEquals(r.status, "idg-regressivo");
  assertEquals(st.objetos.get("agora.json"), antes);
  assertEquals(st.json("agora.json").idg, idgAntes);
  const est = st.json("_estado.json");
  assertEquals(est.ultimoIdg, idgAntes);
  assertEquals(est.travaAte, 0);
  assertNotEquals(est.uf.PR.idg, "100"); // estado não absorveu o dado regressivo
});

// ---------------------------------------------------------------- orçamento

Deno.test("orçamento: ao estourar, a UF incompleta fica inteira como estava e o resto segue na rodada seguinte", async () => {
  const { st, tse } = await rodada1();
  const antes = st.json("agora.json");
  const idg0 = Number(fixture("uf-df").idg);
  // todas as UFs têm dados novos
  for (const [u, m] of [["df", "97012"], ["pr", "75353"], ["pr", "74039"], ["zz", "29254"]] as const) {
    tse.arquivos.set(
      p(u, m),
      avancar(
        fixture(
          u === "zz"
            ? "mun-zz-abidja"
            : m === "97012"
            ? "mun-df-brasilia"
            : m === "75353"
            ? "mun-pr-curitiba"
            : "mun-pr-adrianopolis",
        ),
        700,
        9_000_000,
      ),
    );
  }
  for (const u of ["df", "pr", "zz"]) tse.arquivos.set(p(u), avancar(fixture(`uf-${u}`), 700, 9_000_000 + idg0 % 7));

  // cada leitura de município "custa" 60 s: o orçamento (120 s, margem 20 s) acaba na 2ª leitura
  const rel = relogio(60_000);
  tse.aoLerMunicipio = rel.avancar;
  const r = await executar({ tse, st, agora: rel.agora, concorrencia: 1 });
  assertEquals(r.status, "gravado");
  if (r.status !== "gravado") return;
  assertEquals(r.ufsAtualizadas, ["DF"]);
  assertEquals(r.pendentes.sort(), ["PR", "ZZ"]);

  const meio = st.json("agora.json");
  assertEquals(validarAgora(meio), []);
  assertEquals(meio.uf.DF[2], antes.uf.DF[2] + 700); // DF novo
  assertEquals(meio.mu["5300108"][2], antes.mu["5300108"][2] + 700);
  assertEquals(meio.uf.PR, antes.uf.PR); // PR inteiro como antes
  assertEquals(meio.mu["4106902"], antes.mu["4106902"]);
  assertEquals(meio.mu["4100202"], antes.mu["4100202"]);
  assertEquals(meio.uf.ZZ, antes.uf.ZZ);
  assertEquals(meio.ex, antes.ex);
  assertEquals(st.json("_estado.json").pendentes.sort(), ["PR", "ZZ"]);
  assertEquals(BigInt(meio.idg) >= BigInt(antes.idg), true);

  // próxima rodada, com tempo normal: carrega o restante
  tse.aoLerMunicipio = undefined;
  const r2 = await executar({ tse, st, agora: relogio().agora });
  assertEquals(r2.status, "gravado");
  if (r2.status === "gravado") {
    assertEquals(r2.ufsAtualizadas, ["PR", "ZZ"]);
    assertEquals(r2.pendentes, []);
  }
  const fim = st.json("agora.json");
  assertEquals(fim.mu["4106902"][2], antes.mu["4106902"][2] + 700);
  assertEquals(fim.uf.PR[2], antes.uf.PR[2] + 700);
});

Deno.test("trava: rodada sobreposta é recusada", async () => {
  const { st, tse } = await rodada1();
  const e = st.json("_estado.json");
  e.travaAte = Date.now() + 100_000_000;
  st.objetos.set("_estado.json", JSON.stringify(e));
  const r = await executar({ tse, st, agora: () => Date.now() });
  assertEquals(r.status, "ocupado");
});

Deno.test("falha de escrita libera a trava e propaga o erro", async () => {
  const st = new StorageFake();
  st.falharEm = "serie__index.json";
  await assertRejects(() => executar({ tse: criarTseFake(ELE), st, agora: relogio().agora }));
  assertEquals(st.json("_estado.json").travaAte, 0);
  assertEquals(st.objetos.has("agora.json"), false); // agora.json só depois de série e feed
});

// ---------------------------------------------------------------- gravação atômica e feed

Deno.test("gravarAtomico: temporário some; sobrescrita cai no upsert quando o copy recusa", async () => {
  const st = new StorageFake();
  await gravarAtomico(st, "agora.json", '{"a":1}', 15, () => "x");
  assertEquals(st.objetos.get("agora.json"), '{"a":1}');
  assertEquals([...st.objetos.keys()], ["agora.json"]);
  await gravarAtomico(st, "agora.json", '{"a":2}', 15, () => "y");
  assertEquals(st.objetos.get("agora.json"), '{"a":2}');
  assertEquals([...st.objetos.keys()], ["agora.json"]);
  // o temporário foi escrito antes do definitivo
  assertEquals(st.escritas[0], "_tmp/agora.json.x");
});

Deno.test("feed: virada de líder, +N% de seções e eleito; no máximo 50 eventos", () => {
  const cand = [{ n: "13", nome: "Lula", sg: "PT" }, { n: "22", nome: "Flávio Bolsonaro", sg: "PL" }];
  const base = (pst: number, pr: [number, number]) => ({
    t: "19:00",
    dg: "25/10/2026",
    idg: "1",
    pst,
    ele: "6258",
    cargo: "presidente" as const,
    cand,
    br: [0, 0, 100, 0, 0, [50, 50]] as any,
    mu: {},
    ex: {},
    pu: {},
    pm: {},
    uf: { PR: [0, 0, 100, 0, 0, pr] as any, ZZ: [0, 0, 1, 0, 0, [1, 0]] as any },
  });
  const ev = gerarEventos(base(10.2, [40, 60]), base(11.4, [55, 45]), cand[0]);
  assertEquals(ev.map((e) => e.t), ["apuracao", "virada", "eleito"]);
  assertEquals(ev[1].uf, "PR");
  assertEquals(ev[0].txt.startsWith("11% das seções"), true);
  assertEquals(gerarEventos(base(11.1, [55, 45]), base(11.9, [55, 45]), null), []); // mesmo inteiro, sem virada
  const muitos = Array.from({ length: 80 }, (_, i) => ({ h: "19:00", t: "apuracao" as const, txt: `e${i}` }));
  assertEquals(mesclarFeed(muitos, []).length, 50);
  assertEquals(mesclarFeed(muitos.slice(0, 3), muitos.slice(0, 2)).length, 3); // sem duplicata
});

Deno.test("montarAgora recusa entrada vazia", () => {
  let erro = false;
  try {
    montarAgora({ ele: "1", cand: [], uf: {}, mu: {}, ex: {}, pu: {}, pm: {}, meta: {} });
  } catch {
    erro = true;
  }
  assert(erro);
});

// ---------------------------------------------------------------- segurança da função

Deno.test("index: sem o segredo certo é 401; sem configuração é 500", async () => {
  const antes = ["AGREGADOR_SEGREDO", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].map((k) =>
    [k, Deno.env.get(k)] as const
  );
  try {
    Deno.env.delete("AGREGADOR_SEGREDO");
    assertEquals((await tratar(new Request("http://x/"))).status, 500);
    Deno.env.set("AGREGADOR_SEGREDO", "segredo-de-teste");
    Deno.env.set("SUPABASE_URL", "http://127.0.0.1:1");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "k");
    const sem = await tratar(new Request("http://x/"));
    assertEquals(sem.status, 401);
    await sem.body?.cancel();
    const errado = await tratar(new Request("http://x/", { headers: { "x-agregador": "outro" } }));
    assertEquals(errado.status, 401);
    await errado.body?.cancel();
    const bearer = await tratar(new Request("http://x/", { headers: { authorization: "Bearer segredo-de-teste" } }));
    assertEquals(bearer.status, 401); // só o cabeçalho x-agregador vale
    await bearer.body?.cancel();
  } finally {
    for (const [k, v] of antes) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
});
