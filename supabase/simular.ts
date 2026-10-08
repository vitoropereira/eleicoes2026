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
  else if (cmd === "servir") {
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
