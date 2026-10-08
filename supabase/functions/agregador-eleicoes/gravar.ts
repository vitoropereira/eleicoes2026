// Escrita no bucket `vivo`. Só a Edge Function (service role) grava; o público lê via Vercel.

export interface Armazenamento {
  /** Conteúdo do objeto, ou null se não existir. */
  ler(caminho: string): Promise<string | null>;
  /** Envia (cria ou substitui) um objeto. */
  enviar(caminho: string, conteudo: string, cacheControlSeg?: number): Promise<void>;
}

/**
 * Grava um objeto inteiro de uma vez com upsert (um único POST com `x-upsert`).
 * Por que não "temporário + copy": o Storage grava o objeto no S3 com um PUT e só então troca a linha de
 * metadados, então o leitor vê o arquivo antigo ou o novo, nunca pela metade, e sem janela de 404; e o `copy` do
 * Storage pode recusar sobrescrever. Dois passos só aumentariam as chamadas (3 por arquivo).
 * A única validação extra é recusar JSON quebrado antes de enviar. A ordem entre arquivos (série, feed,
 * agora.json por último) é responsabilidade de quem chama.
 */
export async function gravarAtomico(
  st: Armazenamento,
  destino: string,
  conteudo: string,
  cacheControlSeg = 15,
): Promise<void> {
  JSON.parse(conteudo);
  await st.enviar(destino, conteudo, cacheControlSeg);
}

/** Storage real, via REST (sem dependências). `base` = SUPABASE_URL, `chave` = service role. */
export function criarArmazenamentoSupabase(base: string, chave: string, bucket = "vivo"): Armazenamento {
  const raiz = `${base.replace(/\/$/, "")}/storage/v1`;
  const auth = { authorization: `Bearer ${chave}`, apikey: chave };
  const url = (c: string) => `${raiz}/object/${bucket}/${c.split("/").map(encodeURIComponent).join("/")}`;
  return {
    async ler(caminho) {
      const r = await fetch(url(caminho), { headers: auth, signal: AbortSignal.timeout(20_000) });
      if (r.status === 404) {
        await r.body?.cancel();
        return null;
      }
      const corpo = await r.text();
      // o Storage devolve 400 com {"error":"not_found","message":"Object not found"} para objeto ausente;
      // qualquer outro 400 (jwt inválido, bucket errado) é erro de verdade e não pode virar "não existe"
      if (r.status === 400 && /not_found|object not found/i.test(corpo)) return null;
      if (!r.ok) throw new Error(`Storage ler ${caminho}: ${r.status} ${corpo.slice(0, 200)}`);
      return corpo;
    },
    async enviar(caminho, conteudo, cacheControlSeg = 15) {
      const r = await fetch(url(caminho), {
        method: "POST",
        headers: {
          ...auth,
          "content-type": "application/json",
          "cache-control": `max-age=${cacheControlSeg}`,
          "x-upsert": "true",
        },
        body: conteudo,
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) throw new Error(`Storage enviar ${caminho}: ${r.status} ${await r.text()}`);
      await r.body?.cancel();
    },
  };
}
