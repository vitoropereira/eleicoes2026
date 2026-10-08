// Uma rodada do agregador: descobre a eleição, lê o TSE, monta e grava no bucket `vivo`.
import { type Armazenamento, gravarAtomico } from "./gravar.ts";
import { type Evento, gerarEventos, mesclarFeed } from "./feed.ts";
import {
  type Agora,
  type Cand,
  eleitos,
  extrairCandidatos,
  type Linha,
  linhaDe,
  montarAgora,
  type ResumoArquivo,
  resumoArquivo,
  validarAgora,
} from "./montar.ts";
import {
  caminhoMunicipio,
  caminhoMunicipios,
  caminhoUf,
  descobrirEleicao,
  extrairMunicipios,
  type ListaMunicipios,
  type Tse,
} from "./tse.ts";

export interface EstadoUf extends ResumoArquivo {
  etag: string | null;
}

export interface Estado {
  ele: string | null;
  ultimoIdg: string; // maior idg já gravado em agora.json
  ultimoPst: number;
  uf: Record<string, EstadoUf>; // só UFs com todos os municípios confirmados
  mun: Record<string, string>; // "UF:cd" -> etag
  munList: ListaMunicipios | null;
  pendentes: string[]; // UFs que mudaram e ficaram para a próxima rodada
  eleito: string | null; // número do candidato já anunciado como eleito
  travaAte: number; // epoch ms; evita rodadas sobrepostas
}

export const estadoVazio = (): Estado => ({
  ele: null,
  ultimoIdg: "0",
  ultimoPst: 0,
  uf: {},
  mun: {},
  munList: null,
  pendentes: [],
  eleito: null,
  travaAte: 0,
});

export interface Deps {
  tse: Tse;
  st: Armazenamento;
  agora: () => number; // epoch ms (injetável nos testes)
  orcamentoMs?: number; // padrão 120 s
  margemMs?: number; // parar de buscar municípios com menos que isto sobrando (padrão 20 s)
  concorrencia?: number; // padrão 32
  log?: (...a: unknown[]) => void;
}

export type Resultado =
  | { status: "sem-eleicao" }
  | { status: "ocupado" }
  | { status: "sem-dados"; motivo: string }
  | { status: "sem-mudanca"; pendentes: string[] }
  | { status: "idg-regressivo"; novo: string; ultimo: string }
  | {
    status: "gravado";
    idg: string;
    t: string;
    pst: number;
    ufsAtualizadas: string[];
    pendentes: string[];
    ms: number;
  };

const parse = (s: string | null): any => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** Semáforo FIFO: no máximo `n` tarefas simultâneas. */
function limitador(n: number) {
  let ativos = 0;
  const fila: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (ativos >= n) await new Promise<void>((ok) => fila.push(ok));
    ativos++;
    try {
      return await fn();
    } finally {
      ativos--;
      fila.shift()?.();
    }
  };
}

const hhmmBrasilia = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(11, 16);

export async function executar(deps: Deps): Promise<Resultado> {
  const { tse, st } = deps;
  const log = deps.log ?? (() => {});
  const orcamento = deps.orcamentoMs ?? 120_000;
  const margem = deps.margemMs ?? 20_000;
  const limite = limitador(deps.concorrencia ?? 32);
  const t0 = deps.agora();
  const estourou = () => deps.agora() - t0 > orcamento - margem;

  // 1) eleição
  const ele = await descobrirEleicao(tse);
  if (!ele) {
    log("2º turno federal ainda não publicado em ele-c.json; nada a fazer");
    return { status: "sem-eleicao" };
  }

  // 2) estado + trava
  let estado: Estado = { ...estadoVazio(), ...(parse(await st.ler("_estado.json")) ?? {}) };
  if (estado.ele !== ele) estado = { ...estadoVazio(), ele };
  if (estado.travaAte > t0) {
    log("rodada anterior ainda em andamento");
    return { status: "ocupado" };
  }
  const original = structuredClone(estado);
  estado.travaAte = t0 + orcamento + 30_000;
  await st.enviar("_estado.json", JSON.stringify(estado), 0);
  const liberar = async (e: Estado) => {
    e.travaAte = 0;
    await st.enviar("_estado.json", JSON.stringify(e), 0);
  };

  try {
    // 3) lista de municípios (estática: fica no estado)
    if (!estado.munList) {
      const r = await tse.buscar(caminhoMunicipios(ele));
      if (r.status !== 200) {
        await liberar(original);
        return { status: "sem-dados", motivo: "lista de municípios indisponível" };
      }
      estado.munList = extrairMunicipios(r.json);
    }
    const lista = estado.munList;
    const ufs = Object.keys(lista).sort();

    // 4) agora.json anterior (base para reaproveitar o que não mudou)
    let prev: Agora | null = parse(await st.ler("agora.json"));
    if (prev && (prev.ele !== ele || validarAgora(prev).length > 0)) prev = null;
    if (!prev) {
      estado.uf = {};
      estado.mun = {};
    }

    // 5) arquivos de UF (+ZZ), com ETag
    const lidos = await Promise.all(ufs.map((uf) =>
      limite(async () => {
        try {
          const r = await tse.buscar(caminhoUf(ele, uf), estado.uf[uf]?.etag);
          return { uf, r };
        } catch (e) {
          log(`UF ${uf}: erro ${e}`);
          return { uf, r: { status: 304 as const } };
        }
      })
    ));
    const novos: Record<string, { json: any; resumo: ResumoArquivo; etag: string | null }> = {};
    let cand: Cand[] = prev?.cand ?? [];
    let eleitoNovo: Cand | null = null;
    for (const { uf, r } of lidos) {
      if (r.status === 404) {
        log(`UF ${uf}: ainda não publicada`);
        continue;
      }
      if (r.status !== 200) continue;
      const resumo = resumoArquivo(r.json);
      const velho = estado.uf[uf];
      if (velho && velho.idg === resumo.idg && velho.pst === resumo.pst && prev?.uf[uf]) {
        estado.uf[uf] = { ...velho, etag: r.etag }; // só o ETag mudou
        continue;
      }
      novos[uf] = { json: r.json, resumo, etag: r.etag };
      const c = extrairCandidatos(r.json);
      if (c.length > 0 && cand.length === 0) cand = c;
      const el = eleitos(r.json)[0];
      if (el && estado.eleito !== el.n) eleitoNovo = c.find((x) => x.n === el.n) ?? el;
    }
    // candidatos mudaram de ordem/conjunto: o que está salvo não serve mais
    if (prev && cand.length > 0 && JSON.stringify(prev.cand) !== JSON.stringify(cand)) {
      log("lista de candidatos mudou; recomeçando do zero");
      prev = null;
      estado.uf = {};
      estado.mun = {};
    }
    const candFinal = cand;

    // 6) trabalho em memória: parte do anterior, troca UF por UF
    const uf: Record<string, Linha> = structuredClone(prev?.uf ?? {});
    const mu: Record<string, Linha> = structuredClone(prev?.mu ?? {});
    const ex: Record<string, Linha> = structuredClone(prev?.ex ?? {});
    const pu: Record<string, number> = structuredClone(prev?.pu ?? {});
    const pm: Record<string, number> = structuredClone(prev?.pm ?? {});
    const prioridade = (u: string) => (estado.pendentes.includes(u) ? 0 : 1);
    const mudadas = Object.keys(novos).sort((a, b) => prioridade(a) - prioridade(b) || a.localeCompare(b));
    const confirmadas: string[] = [];
    const etagsMun: Record<string, string> = {};

    await Promise.all(mudadas.map(async (u) => {
      const { json, resumo, etag } = novos[u];
      const alvos = (lista[u] ?? []).filter((m) => u === "ZZ" || m.cdi);
      const linhasMun: Record<string, { linha: Linha; pst: number }> = {};
      const etagsLocais: Record<string, string> = {};
      let completo = true;
      await Promise.all(alvos.map((m) =>
        limite(async () => {
          if (!completo) return;
          if (estourou()) {
            completo = false;
            return;
          }
          const chave = u === "ZZ" ? m.cd : m.cdi;
          const chaveEtag = `${u}:${m.cd}`;
          const existente = (u === "ZZ" ? ex : mu)[chave];
          try {
            const r = await tse.buscar(caminhoMunicipio(ele, u, m.cd), existente ? estado.mun[chaveEtag] : null);
            if (r.status === 200) {
              linhasMun[chave] = { linha: linhaDe(r.json, candFinal), pst: resumoArquivo(r.json).pst };
              if (r.etag) etagsLocais[chaveEtag] = r.etag;
            } else if (r.status === 404 && !existente) {
              log(`município ${u}/${m.cd}: ainda não publicado`);
            }
          } catch (e) {
            log(`município ${u}/${m.cd}: erro ${e}`);
            completo = false;
          }
        })
      ));
      if (!completo) return; // UF fica inteira como estava; tenta de novo na próxima rodada
      // commit atômico da UF em memória
      uf[u] = linhaDe(json, candFinal);
      pu[u] = resumo.pst;
      for (const [k, v] of Object.entries(linhasMun)) {
        (u === "ZZ" ? ex : mu)[k] = v.linha;
        if (u !== "ZZ") pm[k] = v.pst;
      }
      Object.assign(etagsMun, etagsLocais);
      estado.uf[u] = { ...resumo, etag };
      confirmadas.push(u);
    }));
    Object.assign(estado.mun, etagsMun);
    estado.pendentes = mudadas.filter((u) => !confirmadas.includes(u));
    if (estado.pendentes.length > 0) {
      log(
        `orçamento/erro: ${estado.pendentes.length} UF(s) ficam para a próxima rodada: ${estado.pendentes.join(",")}`,
      );
    }

    if (confirmadas.length === 0) {
      estado.travaAte = 0;
      await st.enviar("_estado.json", JSON.stringify(estado), 0);
      return prev || mudadas.length === 0
        ? { status: "sem-mudanca", pendentes: estado.pendentes }
        : { status: "sem-dados", motivo: "nenhuma UF completa dentro do orçamento" };
    }

    // 7) montar e validar
    const meta: Record<string, ResumoArquivo> = {};
    for (const u of Object.keys(uf)) if (estado.uf[u]) meta[u] = estado.uf[u];
    const agora = montarAgora({ ele, cand: candFinal, uf, mu, ex, pu, pm, meta });
    if (!/^\d\d:\d\d$/.test(agora.t)) agora.t = hhmmBrasilia(deps.agora());
    const erros = validarAgora(agora);
    if (erros.length > 0) throw new Error(`agora.json inválido: ${erros.slice(0, 3).join("; ")}`);

    // 8) guarda: idg nunca regride
    if (BigInt(agora.idg) < BigInt(original.ultimoIdg)) {
      log(`idg ${agora.idg} < último gravado ${original.ultimoIdg}; não grava`);
      await liberar(original);
      return { status: "idg-regressivo", novo: agora.idg, ultimo: original.ultimoIdg };
    }

    // 9) gravar: série e feed primeiro, agora.json por último, estado no fim
    const hhmm = agora.t.replace(":", "");
    const corpo = JSON.stringify(agora);
    await gravarAtomico(st, `serie/${hhmm}.json`, corpo, 3600);

    const indice: any[] = parse(await st.ler("serie/index.json")) ?? [];
    const entrada = { t: agora.t, idg: agora.idg, pst: agora.pst, br: agora.br };
    const novoIndice = [...indice.filter((e) => e?.t !== agora.t), entrada].sort((a, b) => a.t.localeCompare(b.t));
    await gravarAtomico(st, "serie/index.json", JSON.stringify(novoIndice));

    const feedAntigo: Evento[] = parse(await st.ler("feed.json")) ?? [];
    const eventos = gerarEventos(prev, agora, eleitoNovo);
    await gravarAtomico(st, "feed.json", JSON.stringify(mesclarFeed(feedAntigo, eventos)));

    await gravarAtomico(st, "agora.json", corpo);

    estado.ultimoIdg = agora.idg;
    estado.ultimoPst = agora.pst;
    if (eleitoNovo) estado.eleito = eleitoNovo.n;
    estado.travaAte = 0;
    await st.enviar("_estado.json", JSON.stringify(estado), 0);

    return {
      status: "gravado",
      idg: agora.idg,
      t: agora.t,
      pst: agora.pst,
      ufsAtualizadas: confirmadas.sort(),
      pendentes: estado.pendentes,
      ms: deps.agora() - t0,
    };
  } catch (e) {
    await liberar(original).catch(() => {});
    throw e;
  }
}
