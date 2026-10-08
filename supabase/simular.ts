// Simulador do TSE para o ensaio geral: serve os arquivos do 1º turno (eleição 6257) como se fossem o 2º turno.
//
//   # 1) baixar uma vez (~5,7 mil arquivos, ~50 MB; fora do git em .build/)
//   deno run --allow-net --allow-write --allow-read supabase/simular.ts baixar .build/tse-1t
//   # 2) servir (o 2º turno "aparece" como eleição 6258, igual ao padrão de 2022)
//   deno run --allow-net --allow-read supabase/simular.ts servir .build/tse-1t --porta 8787
//   # 3) apontar o agregador para ele: TSE_BASE=http://127.0.0.1:8787
//
// Opções do `servir`: --ele2 6258 (código exposto) · --origem 6257 (código real dos arquivos)
//                     --sem-turno2 (não publica o 2º turno: ensaia o caminho "ainda não existe")
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
async function medir(dir: string, origem: string, conc: number, condicional: string | null) {
  const base = "https://resultados.tse.jus.br";
  const etagsAntes: Record<string, string> = condicional
    ? JSON.parse(await Deno.readTextFile(`${condicional}/_etags.json`))
    : {};
  const etags: Record<string, string> = {};
  const salvar = async (c: string, txt: string) => {
    const destino = aqui(dir, c);
    await Deno.mkdir(destino.slice(0, destino.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(destino, txt);
  };
  const cfgTxt = await (await fetch(base + caminhoMunicipios(origem))).text();
  await salvar(caminhoMunicipios(origem), cfgTxt);
  await salvar(caminhoEleicoes(), await (await fetch(base + caminhoEleicoes())).text());
  const lista = extrairMunicipios(JSON.parse(cfgTxt));
  const tarefas: string[] = [];
  for (const [uf, muns] of Object.entries(lista)) {
    tarefas.push(caminhoUf(origem, uf));
    for (const m of muns) tarefas.push(caminhoMunicipio(origem, uf, m.cd));
  }
  const porStatus: Record<string, number> = {};
  const limites: { t: string; status: number; caminho: string; feitos: number }[] = [];
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
        const r = await fetch(base + c, { headers: h, signal: AbortSignal.timeout(20_000) });
        status = r.status;
        const rest = Number((r.headers.get("x-ratelimit-remaining") ?? "").split(",")[0]);
        if (r.headers.has("x-ratelimit-remaining") && Number.isFinite(rest)) minRestante = Math.min(minRestante, rest);
        const tag = r.headers.get("etag");
        if (tag) etags[c] = tag;
        else if (status === 304 && etagsAntes[c]) etags[c] = etagsAntes[c];
        if (status === 200) {
          const txt = await r.text();
          bytes += txt.length;
          await salvar(c, txt);
        } else await r.body?.cancel();
        if (status === 429 || status === 403) {
          limites.push({ t: new Date().toISOString(), status, caminho: c, feitos });
          console.warn(`${new Date().toISOString()} ${status} em ${c} (após ${feitos}); parando`);
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
        console.log(`${feitos}/${tarefas.length} · ${(feitos / s).toFixed(1)} req/s · restante mín ${minRestante}`);
      }
    }
  }));
  const seg = (performance.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const q = (p: number) => Math.round(lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] ?? 0);
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
  await Deno.writeTextFile(`${dir}/_medicao-c${conc}${condicional ? "-etag" : ""}.json`, JSON.stringify(resumo, null, 1));
  console.log(JSON.stringify(resumo, null, 1));
}

async function sha(txt: string) {
  const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(txt));
  return `"${
    [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("")
  }"`;
}

function servir(
  dir: string,
  host: string,
  porta: number,
  ele2: string,
  origem: string,
  turno2: boolean,
  atrasoMs: number,
) {
  Deno.serve({ port: porta, hostname: host }, async (req) => {
    const caminho = new URL(req.url).pathname;
    if (atrasoMs > 0) await new Promise((ok) => setTimeout(ok, atrasoMs));
    let corpo: string;
    try {
      if (caminho === caminhoEleicoes()) {
        const j = JSON.parse(await Deno.readTextFile(aqui(dir, caminho)));
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
        corpo = await Deno.readTextFile(
          aqui(dir, caminho.replaceAll(ele2, origem)),
        );
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
  });
  console.log(
    `simulador em http://${host}:${porta} (2º turno ${
      turno2 ? ele2 : "ausente"
    }, arquivos de ${origem})`,
  );
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
      resto.includes("--condicional") ? op("--condicional", dir).replace(/\/$/, "") : null,
    );
  } else if (cmd === "servir") {
    servir(
      dir.replace(/\/$/, ""),
      op("--host", "127.0.0.1"),
      Number(op("--porta", "8787")),
      op("--ele2", "6258"),
      origem,
      !resto.includes("--sem-turno2"),
      Number(op("--atraso-ms", "0")),
    );
  } else {
    console.error(
      "uso: simular.ts baixar|servir <dir> [opções] (ver o cabeçalho do arquivo)",
    );
    Deno.exit(2);
  }
}
