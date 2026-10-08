// Ensaio geral local do 2º turno: simulador progressivo do TSE (HTTP de verdade, com ETag) + o agregador (`executar`,
// o mesmo código da Edge Function) + um Storage que grava em arquivos (`.build/vivo/`). Nada em produção.
//
//   deno run -A supabase/ensaio.ts <passo> [--tse .build/tse-1t] [--vivo .build/vivo] [--corte-ms N] [--zerar]
//
//   <passo>       índice do passo (0 = 0%, depois as leituras da noite do 1º turno, por último 100%); `lista` mostra os passos
//   --corte-ms N  orçamento de N ms para ler municípios: as UFs que não fecharem a tempo ficam em `pend` (ensaia "UFs atualizando")
//   --zerar       apaga `.build/vivo/` antes (recomeça a noite)
// Comandos completos, na ordem, em supabase/ensaio.md.
import { criarSimulador, passosDaNoite } from "./simular.ts";
import { executar } from "./functions/agregador-eleicoes/executar.ts";
import type { Armazenamento } from "./functions/agregador-eleicoes/gravar.ts";
import { validarAgora } from "./functions/agregador-eleicoes/montar.ts";
import { criarTse } from "./functions/agregador-eleicoes/tse.ts";

/** Storage em arquivos: o mesmo contrato do bucket `vivo` (ler devolve null quando o objeto não existe). */
export function armazenamentoEmArquivos(raiz: string): Armazenamento {
  return {
    async ler(c) {
      try {
        return await Deno.readTextFile(`${raiz}/${c}`);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) return null;
        throw e;
      }
    },
    async enviar(c, conteudo) {
      const destino = `${raiz}/${c}`;
      await Deno.mkdir(destino.slice(0, destino.lastIndexOf("/")), {
        recursive: true,
      });
      // grava ao lado e renomeia: o servidor local nunca entrega arquivo pela metade
      await Deno.writeTextFile(`${destino}.tmp`, conteudo);
      await Deno.rename(`${destino}.tmp`, destino);
    },
  };
}

if (import.meta.main) {
  const [alvo = "lista", ...resto] = Deno.args;
  const op = (nome: string, padrao: string) => {
    const i = resto.indexOf(nome);
    return i >= 0 ? resto[i + 1] : padrao;
  };
  const passos = passosDaNoite(op("--raiz", "."));
  if (alvo === "lista") {
    passos.forEach((p, i) => console.log(`${i}\t${p.nome}\t${p.hg}`));
    Deno.exit(0);
  }
  const i = Number(alvo);
  if (!Number.isInteger(i) || i < 0 || i >= passos.length) {
    console.error(`passo inválido: ${alvo} (0..${passos.length - 1})`);
    Deno.exit(2);
  }
  const vivo = op("--vivo", ".build/vivo");
  if (resto.includes("--zerar")) {
    await Deno.remove(vivo, { recursive: true }).catch(() => {});
  }
  await Deno.mkdir(vivo, { recursive: true });

  const sim = criarSimulador({ dir: op("--tse", ".build/tse-1t"), passos });
  sim.passo = i;
  const porta = Number(op("--porta", "8787"));
  const servidor = Deno.serve({
    port: porta,
    hostname: "127.0.0.1",
    onListen() {},
  }, sim.handler);

  // monta o passo antes de medir o tempo (o simulador calcula os 5,8 mil arquivos na primeira leitura)
  await sim.handler(
    new Request(
      `http://127.0.0.1:${porta}/oficial/ele2026/6258/dados/ac/ac-c0001-e006258-u.json`,
    ),
  );
  const corte = resto.includes("--corte-ms")
    ? Number(op("--corte-ms", "0"))
    : null;
  const t0 = performance.now();
  const r = await executar({
    tse: criarTse(`http://127.0.0.1:${porta}`, {
      timeoutMs: 10_000,
      tentativas: 2,
    }),
    st: armazenamentoEmArquivos(vivo),
    agora: () => Date.now(),
    concorrencia: Number(op("--concorrencia", "16")),
    ...(corte !== null ? { orcamentoMs: corte, margemMs: 0 } : {}),
    log: resto.includes("--verboso")
      ? (...a: unknown[]) => console.log(...a)
      : undefined,
  });
  const ms = Math.round(performance.now() - t0);
  await servidor.shutdown();

  console.log(
    `passo ${i} (${passos[i].nome}, ${passos[i].hg}) em ${ms} ms:`,
    JSON.stringify(r),
  );
  const txt = await armazenamentoEmArquivos(vivo).ler("agora.json");
  if (txt) {
    const a = JSON.parse(txt);
    const erros = validarAgora(a);
    const soma = (k: number) =>
      Object.values(a.uf as Record<string, number[]>).reduce(
        (s, l) => s + (l[k] as number),
        0,
      );
    console.log(
      `agora.json: t=${a.t} pst=${a.pst} idg=${a.idg} ufs=${
        Object.keys(a.uf).length
      } mu=${Object.keys(a.mu).length}` +
        ` ex=${Object.keys(a.ex).length} pm=${Object.keys(a.pm).length} pend=[${
          a.pend.join(",")
        }]` +
        ` br.validos=${a.br[2]} (soma UFs ${soma(2)}) ${
          erros.length ? "INVÁLIDO: " + erros.slice(0, 3).join("; ") : "válido"
        }`,
    );
  } else console.log("agora.json: ainda não existe");
}
