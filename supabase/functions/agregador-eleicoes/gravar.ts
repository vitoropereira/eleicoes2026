// Escrita no bucket `vivo`. Só a Edge Function (service role) grava; o público lê via Vercel.

export interface Armazenamento {
  /** Conteúdo do objeto, ou null se não existir. */
  ler(caminho: string): Promise<string | null>;
  /** Envia (cria ou substitui) um objeto. */
  enviar(caminho: string, conteudo: string, cacheControlSeg?: number): Promise<void>;
  /** Copia origem -> destino. "existe" quando o Storage se recusa a sobrescrever. */
  copiar(origem: string, destino: string): Promise<"ok" | "existe">;
  remover(caminho: string): Promise<void>;
}

/**
 * Gravação em duas etapas: sobe para um nome temporário e só então coloca no nome final.
 * 1) o conteúdo completo já está no Storage antes de o nome final ser tocado;
 * 2) copy -> se o Storage não sobrescreve ("existe"), cai para um PUT com upsert, que é atômico por objeto.
 * O leitor nunca vê arquivo pela metade nem 404 em objeto que já existia.
 */
export async function gravarAtomico(
  st: Armazenamento,
  destino: string,
  conteudo: string,
  cacheControlSeg = 15,
  sufixo: () => string = () => crypto.randomUUID().slice(0, 8),
): Promise<void> {
  const tmp = `_tmp/${destino.replaceAll("/", "__")}.${sufixo()}`;
  await st.enviar(tmp, conteudo, cacheControlSeg);
  try {
    const r = await st.copiar(tmp, destino);
    if (r === "existe") await st.enviar(destino, conteudo, cacheControlSeg);
  } finally {
    await st.remover(tmp).catch(() => {});
  }
}

/** Storage real, via REST (sem dependências). `base` = SUPABASE_URL, `chave` = service role. */
export function criarArmazenamentoSupabase(base: string, chave: string, bucket = "vivo"): Armazenamento {
  const raiz = `${base.replace(/\/$/, "")}/storage/v1`;
  const auth = { authorization: `Bearer ${chave}`, apikey: chave };
  const url = (c: string) => `${raiz}/object/${bucket}/${c.split("/").map(encodeURIComponent).join("/")}`;
  return {
    async ler(caminho) {
      const r = await fetch(url(caminho), { headers: auth, signal: AbortSignal.timeout(20_000) });
      if (r.status === 404 || r.status === 400) {
        await r.body?.cancel();
        return null; // o Storage devolve 400 "Object not found" em alguns casos
      }
      if (!r.ok) throw new Error(`Storage ler ${caminho}: ${r.status}`);
      return await r.text();
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
    async copiar(origem, destino) {
      const r = await fetch(`${raiz}/object/copy`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json", "x-upsert": "true" },
        body: JSON.stringify({ bucketId: bucket, sourceKey: origem, destinationKey: destino }),
        signal: AbortSignal.timeout(30_000),
      });
      if (r.ok) {
        await r.body?.cancel();
        return "ok";
      }
      const txt = await r.text();
      if (r.status === 409 || /exist|duplicate/i.test(txt)) return "existe";
      throw new Error(`Storage copiar ${origem}->${destino}: ${r.status} ${txt}`);
    },
    async remover(caminho) {
      const r = await fetch(url(caminho), { method: "DELETE", headers: auth, signal: AbortSignal.timeout(20_000) });
      await r.body?.cancel();
    },
  };
}
