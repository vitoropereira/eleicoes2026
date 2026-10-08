// deno test --allow-read supabase/simular_test.ts — o modo progressivo do simulador (sem rede)
import {
  escalarMunicipio,
  passosDaNoite,
  secoesPorMunicipio,
  somarNaUf,
} from "./simular.ts";
import {
  extrairCandidatos,
  linhaDe,
} from "./functions/agregador-eleicoes/montar.ts";

const ok = (c: unknown, m = "falhou") => {
  if (!c) throw new Error(m);
};
const fx = (n: string) =>
  JSON.parse(
    Deno.readTextFileSync(
      new URL(
        `./functions/agregador-eleicoes/fixtures/${n}.json`,
        import.meta.url,
      ),
    ),
  );

Deno.test("seções por município: batem o alvo da UF e nunca andam para trás", () => {
  const ts = { a: 100, b: 250, c: 40, d: 900 };
  const total = 1290;
  let antes: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
  for (const alvo of [0, 0.2, 0.45, 0.7, 0.93, 0.997, 1]) {
    const st = secoesPorMunicipio(ts, alvo);
    const soma = Object.values(st).reduce((s, x) => s + x, 0);
    ok(Math.abs(soma - alvo * total) <= 4, `alvo ${alvo}: ${soma}`);
    for (const k of Object.keys(ts)) {
      ok(
        st[k] >= antes[k] && st[k] <= ts[k as keyof typeof ts],
        `${k} recuou/estourou`,
      );
    }
    antes = st;
  }
});

Deno.test("município escalado fecha (válidos = soma nominal; válidos + brancos + nulos = comparecimento)", () => {
  const j = fx("mun-pr-curitiba");
  const cand = extrairCandidatos(j);
  const m = escalarMunicipio(j, Math.round(Number(j.s.ts) * 0.4));
  const l = linhaDe(m, cand);
  ok(l[5].reduce((a, b) => a + b, 0) === l[2], "nominais = válidos");
  ok(l[2] + l[3] + l[4] === l[1], "fecha com o comparecimento");
  ok(
    m.s.pst ===
      (100 * Number(m.s.st) / Number(m.s.ts)).toFixed(2).replace(".", ","),
    m.s.pst,
  );
  const zero = linhaDe(escalarMunicipio(j, 0), cand);
  ok(zero[1] === 0 && zero[5].every((v) => v === 0), "0 seção = 0 voto");
});

Deno.test("UF = soma dos municípios", () => {
  const a = escalarMunicipio(fx("mun-pr-curitiba"), 1000),
    b = escalarMunicipio(fx("mun-pr-adrianopolis"), 10);
  const cand = extrairCandidatos(a);
  const uf = linhaDe(somarNaUf(fx("uf-pr"), [a, b]), cand);
  const la = linhaDe(a, cand), lb = linhaDe(b, cand);
  for (let i = 0; i < 5; i++) {
    ok(uf[i] === (la[i] as number) + (lb[i] as number), `coluna ${i}`);
  }
  uf[5].forEach((v, i) => ok(v === la[5][i] + lb[5][i], `cand ${i}`));
});

Deno.test("passos: 0% primeiro, 100% por último, leituras da noite no meio em ordem", () => {
  const p = passosDaNoite(
    new URL("..", import.meta.url).pathname.replace(/\/$/, ""),
  );
  ok(p[0].padrao === 0 && p.at(-1)!.padrao === 100, "pontas");
  ok(p.length >= 3, `${p.length} passos`);
  for (let i = 1; i < p.length; i++) {
    ok(p[i].padrao >= p[i - 1].padrao, "ordem");
  }
});
