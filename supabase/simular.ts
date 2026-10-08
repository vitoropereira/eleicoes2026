// Simulador do TSE para o ensaio geral: serve os arquivos do 1º turno (eleição 6257) como se fossem o 2º turno.
//
//   # 1) baixar uma vez (~5,7 mil arquivos, ~50 MB; fora do git em .build/)
//   deno run --allow-net --allow-write --allow-read supabase/simular.ts baixar .build/tse-1t
//   # 2) servir (o 2º turno "aparece" como eleição 6258, igual ao padrão de 2022)
//   deno run --allow-net --allow-read supabase/simular.ts servir .build/tse-1t --porta 8787
//   # 3) apontar o agregador para ele: TSE_BASE=http://127.0.0.1:8787
//
//   # medir o limite do TSE (resultado em supabase/PROPOSTA.md, Riscos)
//   deno run --allow-net --allow-write --allow-read supabase/simular.ts medir .build/tse-1t --concorrencia 8
//
// Opções do `servir`: --ele2 6258 (código exposto) · --origem 6257 (código real dos arquivos)
//                     --sem-turno2 (não publica o 2º turno: ensaia o caminho "ainda não existe")
//                     --progressivo [--raiz .] (a noite fatiada por UF; `/_passo/<i>` troca o passo; ver supabase/ensaio.md)
//                     --host 127.0.0.1 (0.0.0.0 para o container do supabase functions serve alcançar)
//                     --atraso-ms 0 (latência artificial por resposta)
import {
  caminhoEleicoes,
  caminhoMunicipio,
  caminhoMunicipios,
  caminhoUf,
  criarTse,
  extrairMunicipios,
  LimiteTse,
} from "./functions/agregador-eleicoes/tse.ts";

const aqui = (dir: string, caminho: string) => `${dir}${caminho}`;

async function baixar(dir: string, origem: string) {
  const tse = criarTse("https://resultados.tse.jus.br", {
    timeoutMs: 20_000,
    tentativas: 3,
  });
  const gravar = async (caminho: string, json: unknown) => {
    const destino = aqui(dir, caminho);
    await Deno.mkdir(destino.slice(0, destino.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeTextFile(destino, JSON.stringify(json));
  };
  const pegar = async (caminho: string) => {
    try {
      await Deno.stat(aqui(dir, caminho));
      return; // já baixado
    } catch { /* segue */ }
    for (let i = 0;; i++) {
      try {
        const r = await tse.buscar(caminho);
        if (r.status === 200) await gravar(caminho, r.json);
        else console.warn(caminho, r.status);
        return;
      } catch (e) {
        // 429: o TSE bloqueia o IP por alguns minutos; espera e retoma (o download é retomável)
        if (!(e instanceof LimiteTse) || i >= 30) throw e;
        console.warn("429, aguardando 30 s");
        await new Promise((ok) => setTimeout(ok, 30_000));
      }
    }
  };
  await pegar(caminhoEleicoes());
  await pegar(caminhoMunicipios(origem));
  const lista = extrairMunicipios(
    JSON.parse(await Deno.readTextFile(aqui(dir, caminhoMunicipios(origem)))),
  );
  const tarefas: string[] = [];
  for (const [uf, muns] of Object.entries(lista)) {
    tarefas.push(caminhoUf(origem, uf));
    for (const m of muns) tarefas.push(caminhoMunicipio(origem, uf, m.cd));
  }
  let feitos = 0;
  const fila = [...tarefas];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let c = fila.shift(); c; c = fila.shift()) {
      await pegar(c);
      if (++feitos % 500 === 0) console.log(`${feitos}/${tarefas.length}`);
    }
  }));
  console.log(`pronto: ${tarefas.length} arquivos em ${dir}`);
}

/**
 * Mede o limite do TSE: baixa o 1º turno inteiro (UFs + municípios) com `conc` conexões e registra req/s,
 * latência, 429/403 (com horário) e o menor `x-ratelimit-remaining` visto. Para na hora no primeiro 429
 * (não insiste: insistir prolonga o bloqueio). `--condicional <dir>` reenvia os ETags de uma medição anterior
 * (esperado: 304). Grava os arquivos em `dir` (mesmo layout do `baixar`) e o resumo em `dir/_medicao-cN.json`.
 */
async function medir(
  dir: string,
  origem: string,
  conc: number,
  condicional: string | null,
) {
  const base = "https://resultados.tse.jus.br";
  const etagsAntes: Record<string, string> = condicional
    ? JSON.parse(await Deno.readTextFile(`${condicional}/_etags.json`))
    : {};
  const etags: Record<string, string> = {};
  const salvar = async (c: string, txt: string) => {
    const destino = aqui(dir, c);
    await Deno.mkdir(destino.slice(0, destino.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeTextFile(destino, txt);
  };
  const cfgTxt = await (await fetch(base + caminhoMunicipios(origem))).text();
  await salvar(caminhoMunicipios(origem), cfgTxt);
  await salvar(
    caminhoEleicoes(),
    await (await fetch(base + caminhoEleicoes())).text(),
  );
  const lista = extrairMunicipios(JSON.parse(cfgTxt));
  const tarefas: string[] = [];
  for (const [uf, muns] of Object.entries(lista)) {
    tarefas.push(caminhoUf(origem, uf));
    for (const m of muns) tarefas.push(caminhoMunicipio(origem, uf, m.cd));
  }
  const porStatus: Record<string, number> = {};
  const limites: {
    t: string;
    status: number;
    caminho: string;
    feitos: number;
  }[] = [];
  const lat: number[] = [];
  let minRestante = Infinity, feitos = 0, parar = false, bytes = 0;
  const fila = [...tarefas];
  const t0 = performance.now();
  const inicio = new Date().toISOString();
  await Promise.all(Array.from({ length: conc }, async () => {
    for (let c = fila.shift(); c && !parar; c = fila.shift()) {
      const h: Record<string, string> = { accept: "application/json" };
      if (etagsAntes[c]) h["if-none-match"] = etagsAntes[c];
      const ti = performance.now();
      let status = 0;
      try {
        const r = await fetch(base + c, {
          headers: h,
          signal: AbortSignal.timeout(20_000),
        });
        status = r.status;
        const rest = Number(
          (r.headers.get("x-ratelimit-remaining") ?? "").split(",")[0],
        );
        if (r.headers.has("x-ratelimit-remaining") && Number.isFinite(rest)) {
          minRestante = Math.min(minRestante, rest);
        }
        const tag = r.headers.get("etag");
        if (tag) etags[c] = tag;
        else if (status === 304 && etagsAntes[c]) etags[c] = etagsAntes[c];
        if (status === 200) {
          const txt = await r.text();
          bytes += txt.length;
          await salvar(c, txt);
        } else await r.body?.cancel();
        if (status === 429 || status === 403) {
          limites.push({
            t: new Date().toISOString(),
            status,
            caminho: c,
            feitos,
          });
          console.warn(
            `${
              new Date().toISOString()
            } ${status} em ${c} (após ${feitos}); parando`,
          );
          parar = true;
        }
      } catch (e) {
        status = -1;
        console.warn(c, String(e));
      }
      lat.push(performance.now() - ti);
      porStatus[status] = (porStatus[status] ?? 0) + 1;
      if (++feitos % 1000 === 0) {
        const s = (performance.now() - t0) / 1000;
        console.log(
          `${feitos}/${tarefas.length} · ${
            (feitos / s).toFixed(1)
          } req/s · restante mín ${minRestante}`,
        );
      }
    }
  }));
  const seg = (performance.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const q = (p: number) =>
    Math.round(lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] ?? 0);
  const resumo = {
    inicio,
    fim: new Date().toISOString(),
    concorrencia: conc,
    condicional: !!condicional,
    arquivos: tarefas.length,
    feitos,
    porStatus,
    segundos: Math.round(seg * 10) / 10,
    reqPorSeg: Math.round((feitos / seg) * 10) / 10,
    latenciaMs: { p50: q(0.5), p95: q(0.95), max: Math.round(lat.at(-1) ?? 0) },
    mb: Math.round(bytes / 1e5) / 10,
    menorRatelimitRestante: Number.isFinite(minRestante) ? minRestante : null,
    limites,
  };
  await Deno.writeTextFile(`${dir}/_etags.json`, JSON.stringify(etags));
  await Deno.writeTextFile(
    `${dir}/_medicao-c${conc}${condicional ? "-etag" : ""}.json`,
    JSON.stringify(resumo, null, 1),
  );
  console.log(JSON.stringify(resumo, null, 1));
}

async function sha(txt: string) {
  const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(txt));
  return `"${
    [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("")
  }"`;
}

// ---------------------------------------------------------------- modo progressivo (a noite fatiada)
//
// Reproduz a noite com os arquivos finais do 1º turno: em cada passo, cada UF fica com o % de seções que tinha naquela
// leitura do 1º turno (`snapshots/*/dados.json` e `marcos/*/dados.json`, campo `states[].pst`). Dentro da UF, cada
// município anda num ritmo próprio (determinístico, sempre para a frente) e os votos dele são escalados pela fração de
// seções apuradas. A UF é a soma dos seus municípios (e o ZZ, a soma das cidades do exterior). É ensaio: aproximação.

export interface Passo {
  nome: string;
  hg: string; // HH:MM:SS do passo (vira `agora.t`)
  padrao: number; // % das UFs que não aparecem em `pst`
  pst: Record<string, number>; // UF -> % de seções
}

/** 0% (configuração publicada, nenhuma seção) → leituras da noite do 1º turno → 100%. */
export function passosDaNoite(raiz = "."): Passo[] {
  const lidos = new Map<string, Passo>();
  for (const pasta of ["snapshots", "marcos"]) {
    let nomes: string[] = [];
    try {
      nomes = [...Deno.readDirSync(`${raiz}/${pasta}`)].filter((d) =>
        d.isDirectory
      ).map((d) => d.name);
    } catch { /* pasta ausente */ }
    for (const n of nomes) {
      try {
        const d = JSON.parse(
          Deno.readTextFileSync(`${raiz}/${pasta}/${n}/dados.json`),
        );
        if (!Array.isArray(d.states) || !d.ht) continue;
        lidos.set(d.ht, {
          nome: `${d.pst}%`,
          hg: d.ht,
          padrao: Number(d.pst),
          pst: Object.fromEntries(
            d.states.map((
              x: any,
            ) => [String(x.uf).toUpperCase(), Number(x.pst)]),
          ),
        });
      } catch { /* sem dados.json */ }
    }
  }
  const meio = [...lidos.values()].sort((a, b) => a.padrao - b.padrao);
  return [{ nome: "0%", hg: "17:00:00", padrao: 0, pst: {} }, ...meio, {
    nome: "100%",
    hg: "22:40:00",
    padrao: 100,
    pst: {},
  }];
}

/** ritmo do município: 1..3, fixo por código (quem tem ritmo 3 termina quando a UF chega a 33%) */
function ritmo(cd: string): number {
  let h = 2166136261;
  for (const ch of cd) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return 1 + 2 * ((h >>> 0) % 1000) / 999;
}

/**
 * Seções apuradas por município para a UF chegar a `alvo` (0..1) das seções: st_m = min(1, λ·ritmo_m)·ts_m, com λ
 * achado por bisseção. λ cresce com o alvo, então nenhum município anda para trás entre passos.
 */
export function secoesPorMunicipio(
  ts: Record<string, number>,
  alvo: number,
): Record<string, number> {
  const cds = Object.keys(ts);
  if (alvo <= 0) return Object.fromEntries(cds.map((c) => [c, 0]));
  if (alvo >= 1) return { ...ts };
  const total = cds.reduce((s, c) => s + ts[c], 0);
  const soma = (l: number) =>
    cds.reduce((s, c) => s + Math.min(1, l * ritmo(c)) * ts[c], 0);
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (soma(m) < alvo * total) lo = m;
    else hi = m;
  }
  return Object.fromEntries(
    cds.map((c) => [c, Math.round(Math.min(1, hi * ritmo(c)) * ts[c])]),
  );
}

const br2 = (x: number) => x.toFixed(2).replace(".", ",");

/** Arquivo de município escalado para `st` de `ts` seções. Válidos = soma dos nominais; comparecimento fecha. */
export function escalarMunicipio(j: any, st: number): any {
  const c = structuredClone(j);
  const ts = Number(c.s.ts);
  const r = ts > 0 ? st / ts : 0;
  const k = (x: unknown) => Math.round(Number(x ?? 0) * r);
  let vv = 0;
  for (const cg of c.carg ?? []) {
    for (const a of cg.agr ?? []) {
      let ta = 0;
      for (const p of a.par ?? []) {
        let tp = 0;
        for (const cand of p.cand ?? []) {
          cand.vap = String(k(cand.vap));
          tp += Number(cand.vap);
        }
        p.tvtn = p.tvan = String(tp);
        ta += tp;
      }
      if (String(cg.cd) === "1") vv += ta;
    }
  }
  const vb = k(c.v.vb), vn = k(c.v.vn), vnt = k(c.v.vnt), tvn = vn + vnt;
  Object.assign(c.v, {
    vv: String(vv),
    vvc: String(vv),
    vnom: String(vv),
    vb: String(vb),
    vn: String(vn),
    vnt: String(vnt),
  });
  c.v.tvn = String(tvn);
  c.v.tv = String(vv + vb + tvn);
  c.e.c = String(vv + vb + tvn);
  c.e.a = String(Number(c.e.te) - (vv + vb + tvn));
  c.s.st = String(st);
  c.s.snt = String(ts - st);
  c.s.pst = br2(ts > 0 ? (100 * st) / ts : 0);
  return c;
}

/** Soma arquivos (de município) numa linha de UF, no formato do TSE, partindo do arquivo da UF como molde. */
export function somarNaUf(molde: any, muns: any[]): any {
  const c = structuredClone(molde);
  const votos = new Map<string, number>();
  let st = 0, ts = 0, vv = 0, vb = 0, vn = 0, vnt = 0, te = 0;
  for (const m of muns) {
    st += Number(m.s.st);
    ts += Number(m.s.ts);
    vv += Number(m.v.vv);
    vb += Number(m.v.vb);
    vn += Number(m.v.vn);
    vnt += Number(m.v.vnt ?? 0);
    te += Number(m.e.te);
    for (const cg of m.carg ?? []) {
      for (const a of cg.agr ?? []) {
        for (const p of a.par ?? []) {
          for (const k of p.cand ?? []) {
            votos.set(
              String(k.n),
              (votos.get(String(k.n)) ?? 0) + Number(k.vap),
            );
          }
        }
      }
    }
  }
  for (const cg of c.carg ?? []) {
    for (const a of cg.agr ?? []) {
      for (const p of a.par ?? []) {
        let tp = 0;
        for (const k of p.cand ?? []) {
          k.vap = String(votos.get(String(k.n)) ?? 0);
          tp += Number(k.vap);
        }
        p.tvtn = p.tvan = String(tp);
      }
    }
  }
  const tvn = vn + vnt;
  Object.assign(c.v, {
    vv: String(vv),
    vvc: String(vv),
    vnom: String(vv),
    vb: String(vb),
    vn: String(vn),
    vnt: String(vnt),
  });
  c.v.tvn = String(tvn);
  c.v.tv = c.e.c = String(vv + vb + tvn);
  c.e.te = String(te);
  c.e.a = String(te - (vv + vb + tvn));
  Object.assign(c.s, {
    st: String(st),
    ts: String(ts),
    snt: String(ts - st),
    pst: br2(ts > 0 ? (100 * st) / ts : 0),
  });
  return c;
}

/** Último passo: o mais votado do país sai como "Eleito" (exercita o evento de eleito do feed). */
function marcarEleito(j: any, n: string) {
  for (const cg of j.carg ?? []) {
    for (const a of cg.agr ?? []) {
      for (const p of a.par ?? []) {
        for (const k of p.cand ?? []) {
          const el = String(k.n) === n;
          k.e = el ? "s" : "n";
          k.st = el ? "Eleito" : "Não eleito";
        }
      }
    }
  }
}

export interface OpcoesSimulador {
  dir: string; // arquivos do 1º turno (layout do `baixar`)
  ele2?: string; // código exposto (padrão 6258)
  origem?: string; // código real dos arquivos (padrão 6257)
  turno2?: boolean; // false: só o ele-c.json, sem 2º turno
  atrasoMs?: number;
  passos?: Passo[]; // presente = modo progressivo
}

/** Simulador como handler HTTP (o `servir` e o `ensaio.ts` usam o mesmo). */
export function criarSimulador(o: OpcoesSimulador) {
  const ele2 = o.ele2 ?? "6258",
    origem = o.origem ?? "6257",
    turno2 = o.turno2 ?? true;
  const passos = o.passos ?? null;
  let passo = 0;
  const lista = extrairMunicipios(
    JSON.parse(Deno.readTextFileSync(aqui(o.dir, caminhoMunicipios(origem)))),
  );
  const ler = (c: string) => JSON.parse(Deno.readTextFileSync(aqui(o.dir, c)));
  const cacheOriginal = new Map<string, any>();
  const original = (c: string) => {
    if (!cacheOriginal.has(c)) cacheOriginal.set(c, ler(c));
    return cacheOriginal.get(c);
  };
  // passo -> caminho (de origem) -> corpo pronto
  const montados = new Map<number, Map<string, string>>();
  let vencedor: string | null = null;

  function montarPasso(i: number): Map<string, string> {
    const p = passos![i];
    const out = new Map<string, string>();
    const idg = String(3_000_000 + i * 1000);
    const hora = (j: any) =>
      Object.assign(j, {
        ele: ele2,
        t: "2",
        idg,
        hg: p.hg,
        ht: p.hg,
        dg: "25/10/2026",
        dt: "25/10/2026",
      });
    const ufs: Record<string, any> = {};
    for (const [uf, muns] of Object.entries(lista)) {
      const arqs = Object.fromEntries(
        muns.map((m) => [m.cd, original(caminhoMunicipio(origem, uf, m.cd))]),
      );
      const ts = Object.fromEntries(
        muns.map((m) => [m.cd, Number(arqs[m.cd].s.ts)]),
      );
      const st = secoesPorMunicipio(ts, (p.pst[uf] ?? p.padrao) / 100);
      const escalados = muns.map((m) => {
        return [m.cd, hora(escalarMunicipio(arqs[m.cd], st[m.cd]))] as const;
      });
      ufs[uf] = hora(
        somarNaUf(original(caminhoUf(origem, uf)), escalados.map(([, e]) => e)),
      );
      for (const [cd, e] of escalados) {
        out.set(caminhoMunicipio(origem, uf, cd), JSON.stringify(e));
      }
    }
    if (i === passos!.length - 1) {
      // o mais votado do país, pela soma das UFs
      const tot = new Map<string, number>();
      for (const j of Object.values(ufs)) {
        for (const a of j.carg[0].agr) {
          for (const pa of a.par) {
            for (const k of pa.cand) {
              tot.set(k.n, (tot.get(k.n) ?? 0) + Number(k.vap));
            }
          }
        }
      }
      vencedor = [...tot.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      if (vencedor) {
        for (const j of Object.values(ufs)) marcarEleito(j, vencedor);
      }
    }
    for (const [uf, j] of Object.entries(ufs)) {
      out.set(caminhoUf(origem, uf), JSON.stringify(j));
    }
    return out;
  }

  const corpoDe = (caminhoOrigem: string): string => {
    if (!passos) return Deno.readTextFileSync(aqui(o.dir, caminhoOrigem));
    if (!montados.has(passo)) montados.set(passo, montarPasso(passo));
    const c = montados.get(passo)!.get(caminhoOrigem);
    if (c === undefined) {
      return Deno.readTextFileSync(aqui(o.dir, caminhoOrigem)); // config
    }
    return c;
  };

  async function handler(req: Request): Promise<Response> {
    const caminho = new URL(req.url).pathname;
    const m = caminho.match(/^\/_passo\/(\d+)$/);
    if (m && passos) {
      passo = Math.min(passos.length - 1, Number(m[1]));
      return Response.json({
        passo,
        nome: passos[passo].nome,
        hg: passos[passo].hg,
      });
    }
    if (o.atrasoMs) await new Promise((ok) => setTimeout(ok, o.atrasoMs));
    let corpo: string;
    try {
      if (caminho === caminhoEleicoes()) {
        const j = JSON.parse(await Deno.readTextFile(aqui(o.dir, caminho)));
        if (turno2) {
          j.pl.find((p: any) => p.c === "ele2026").e.push({
            cd: ele2,
            cdt2: "",
            nm: "Eleição Ordinária Federal - 2026 2º Turno (SIMULADO)",
            t: "2",
            tp: "1",
            abr: [{ cd: "br" }],
          });
        }
        corpo = JSON.stringify(j);
      } else {
        if (!turno2 || !caminho.includes(ele2)) {
          return new Response("não encontrado", { status: 404 });
        }
        corpo = corpoDe(caminho.replaceAll(ele2, origem));
      }
    } catch {
      return new Response("não encontrado", { status: 404 });
    }
    const etag = await sha(corpo);
    const cabecalhos = {
      etag,
      "content-type": "application/json",
      "cache-control": "max-age=0",
    };
    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: cabecalhos });
    }
    return new Response(corpo, { headers: cabecalhos });
  }

  return {
    handler,
    passos,
    get passo() {
      return passo;
    },
    set passo(i: number) {
      passo = i;
    },
    get vencedor() {
      return vencedor;
    },
  };
}

if (import.meta.main) {
  const [cmd, dir = ".build/tse-1t", ...resto] = Deno.args;
  const op = (nome: string, padrao: string) => {
    const i = resto.indexOf(nome);
    return i >= 0 ? resto[i + 1] : padrao;
  };
  const origem = op("--origem", "6257");
  if (cmd === "baixar") await baixar(dir.replace(/\/$/, ""), origem);
  else if (cmd === "medir") {
    await medir(
      dir.replace(/\/$/, ""),
      origem,
      Math.max(1, Number(op("--concorrencia", "8"))),
      resto.includes("--condicional")
        ? op("--condicional", dir).replace(/\/$/, "")
        : null,
    );
  } else if (cmd === "servir") {
    const turno2 = !resto.includes("--sem-turno2");
    const passos = resto.includes("--progressivo")
      ? passosDaNoite(op("--raiz", "."))
      : undefined;
    const sim = criarSimulador({
      dir: dir.replace(/\/$/, ""),
      ele2: op("--ele2", "6258"),
      origem,
      turno2,
      atrasoMs: Number(op("--atraso-ms", "0")),
      passos,
    });
    const host = op("--host", "127.0.0.1"),
      porta = Number(op("--porta", "8787"));
    Deno.serve({ port: porta, hostname: host }, sim.handler);
    console.log(
      `simulador em http://${host}:${porta} (2º turno ${
        turno2 ? op("--ele2", "6258") : "ausente"
      }, arquivos de ${origem})`,
    );
    if (passos) {
      console.log(
        `modo progressivo: POST/GET /_passo/<i> troca o passo. Passos: ${
          passos.map((p, i) => `${i}=${p.nome}`).join(" ")
        }`,
      );
    }
  } else {
    console.error(
      "uso: simular.ts baixar|medir|servir <dir> [opções] (ver o cabeçalho do arquivo)",
    );
    Deno.exit(2);
  }
}
