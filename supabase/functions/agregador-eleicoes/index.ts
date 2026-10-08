// Edge Function `agregador-eleicoes`: chamada a cada minuto pelo pg_cron (via pg_net).
// Variáveis de ambiente (não são definidas aqui; ver supabase/PROPOSTA.md):
//   SUPABASE_URL               injetada pelo runtime
//   SUPABASE_SERVICE_ROLE_KEY  injetada pelo runtime; única credencial com escrita no bucket `vivo`
//   AGREGADOR_SEGREDO          segredo compartilhado; chamadas sem `x-agregador: <segredo>` recebem 401
//   TSE_BASE                   opcional; padrão https://resultados.tse.jus.br (o simulador usa outro)
//   AGREGADOR_CONCORRENCIA     opcional; padrão 32 (requisições simultâneas ao TSE)
//   ELEICAO_FORCADA            só ensaio (ex.: 6257 = 1º turno). NUNCA definir em produção
import { executar } from "./executar.ts";
import { criarArmazenamentoSupabase } from "./gravar.ts";
import { criarTse, TSE_BASE_PADRAO } from "./tse.ts";

/** Comparação em tempo constante. */
function igual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

export async function tratar(req: Request): Promise<Response> {
  const segredo = Deno.env.get("AGREGADOR_SEGREDO");
  const url = Deno.env.get("SUPABASE_URL");
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!segredo || !url || !chave) return new Response("configuração incompleta", { status: 500 });
  if (!igual(req.headers.get("x-agregador") ?? "", segredo)) return new Response("não autorizado", { status: 401 });

  const deps = {
    tse: criarTse(Deno.env.get("TSE_BASE") ?? TSE_BASE_PADRAO, { timeoutMs: 10_000, tentativas: 2 }),
    st: criarArmazenamentoSupabase(url, chave),
    agora: () => Date.now(),
    concorrencia: Number(Deno.env.get("AGREGADOR_CONCORRENCIA")) || 32,
    eleicaoForcada: Deno.env.get("ELEICAO_FORCADA") || undefined,
    log: (...a: unknown[]) => console.log(...a),
  };
  const rodar = executar(deps)
    .then((r) => {
      console.log("resultado", JSON.stringify(r));
      return r;
    })
    .catch((e) => {
      console.error("falha", String(e));
      return { status: "erro", erro: String(e) };
    });

  // ?sincrono=1 espera o resultado (testes manuais). O cron não espera: pg_net desiste em poucos segundos.
  if (new URL(req.url).searchParams.get("sincrono") === "1") {
    return Response.json(await rodar);
  }
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(rodar);
  return Response.json({ aceito: true }, { status: 202 });
}

if (import.meta.main) Deno.serve(tratar);
