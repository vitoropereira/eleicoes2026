# Painel ao vivo por município + redesign com a brand vitorpereira.ia.br

Data: 07/10/2026 · Status: aprovado em conversa, aguardando revisão do spec escrito

## 1. Objetivo

Ter, para o **2º turno de 25/10/2026**, um painel de apuração em tela cheia inspirado no
seuimposto.com (mapa por município, painéis laterais, linha do tempo), e levar o site
inteiro para a identidade visual do vitorpereira.ia.br.

Sucesso = no domingo 25/10 o `/ao-vivo/` mostra presidente (e governadores nos estados com
2º turno) por município, atualizando sozinho a cada ~1 min a partir do TSE, sem depender do
Mac do Vitor ligado, e aguentando o pico de acesso pelo CDN.

## 2. Decisões fechadas

| Tema | Decisão |
|---|---|
| Referência | seuimposto.com é **inspiração de layout**. Nada da Pandora é copiado: sem logo, sem texto, sem assets, sem consumir os JSONs/feed deles |
| Fonte de dados | **TSE** (`resultados.tse.jus.br`) + **malha municipal do IBGE**, direto da fonte |
| Backend do ao vivo | Supabase, projeto pessoal `qzczyicspbizosjogmlq` (o mesmo do vitorpereira.ia.br). Recursos **novos** (bucket, Edge Function, cron), sem tocar nos existentes |
| Credenciais | `.env` deste repo (`SUPABASE_PROJECT_REF`, `SUPABASE_TOKEN`). `.env` entra no `.gitignore` no PR 1 |
| Front do HUD | Preact + htm via CDN, sem build de Node. Mapa em `<canvas>` |
| Visual | tokens da brand vitorpereira.ia.br (seção 5) |
| Escopo | tudo que o painel de referência tem: núcleo, linha do tempo + gráfico, busca + feed, Senado/Deputados (replay do 1º turno) e "pessoas agora". Linha de corte em 18/10 (seção 11) |

## 3. Fatos verificados sobre o TSE (07/10/2026)

| Fato | Verificação |
|---|---|
| Presidente por município: `/oficial/ele2026/6257/dados/{uf}/{uf}{cdTSE}-c0001-e006257-u.json` | Curitiba `pr75353`: 200, 9,3 KB. Traz `s` (seções), `e` (eleitorado/comparecimento), `v` (válidos/brancos/nulos), `carg[0].agr[].par[].cand[]` com `vap` e `e:"s"` para eleito |
| Governador, Senado, Dep. Federal, Dep. Estadual por município: eleição **6259**, `c0003/c0005/c0006/c0007` | Curitiba: 200, com 7 KB, 8 KB, 111 KB e 159 KB |
| Lista de municípios com o código IBGE | `/oficial/ele2026/6257/config/mun-e006257-cm.json` (534 KB). Cada município tem `cd` (TSE) e `cdi` (IBGE) |
| Exterior | `/dados/zz/zz-c0001-e006257-u.json`: 200 |
| Códigos do 2º turno | **ainda não publicados** em `/oficial/comum/config/ele-c.json` (só 6257, 6259 e 6261). Pelo padrão de 2022 devem ser 6258/6260, mas isso é hipótese. O agregador descobre o código lendo o `ele-c.json` |

## 4. Arquitetura

```
TSE ──► Supabase: pg_cron (1 min) ─► Edge Function "agregador"
          1) lê os 27 arquivos de UF (+ZZ); só para as UFs que mudaram, busca os municípios (com ETag)
          2) monta agora.json, serie/HHMM.json, serie/index.json, feed.json
          3) grava no bucket público "vivo" (grava em arquivo temporário e depois troca)
                         │
Vercel: rewrite /vivo/* ─► Storage, Cache-Control s-maxage=15, stale-while-revalidate=30
                         │
Navegador /ao-vivo/: Preact+htm, polling de agora.json a cada 15 s (só redesenha se o idg mudou)
                     canvas + /geo/municipios.topo.json (estático)

build_site.py (uma vez): malha IBGE simplificada, replay do 1º turno por município (todos os
cargos), candidatos e fotos.
"Pessoas agora": Supabase Realtime presence com chave anon.
```

- **Sem tabelas no Postgres.** O estado vive em JSON no Storage, e o banco só roda `pg_cron`/`pg_net`.
- **`service_role` só existe dentro da Edge Function.** O navegador usa apenas a chave anon (Realtime) e leitura pública via Vercel.
- **O público nunca bate direto no Storage.** O CDN da Vercel absorve o tráfego, o que evita estourar os 5 GB/mês de saída do Supabase.

## 5. Visual (brand vitorpereira.ia.br, extraída do CSS publicado)

| Token | Escuro (padrão) | Claro |
|---|---|---|
| `--bg` | `#070B12` | `#FBFCFE` |
| `--card` | `#0C121D` | `#FFFFFF` |
| `--border` | `#1E2A3D` | `#E2E8F1` |
| `--fg` / `--muted` | `#E9EEF7` / `#8593AB` | `#0B1220` / `#566072` |
| `--brand` | `#24C8FF` | `#0A76AD` |
| `--radius` | 10px | 10px |
| Títulos e números grandes | JetBrains Mono | |
| Texto e UI | Inter | |
| Rótulos | mono, caixa alta, `letter-spacing:.1em` | |
| Logo | `vitor pereira▌` com cursor ciano | |

**Regra de cor:** dados usam **só cores de partido**. O PL usa `#2F5BD3`, longe do ciano da brand.
O ciano fica só na moldura (logo, links, foco, "● ao vivo", aba ativa) e nunca em mapa, barra ou
número de candidato. Os cards são sólidos. Sobre o mapa usam leve transparência (`--card` a 88%).

**Tema:** escuro por padrão, com a variante clara para quem tem `prefers-color-scheme: light`.

**Acessibilidade:** contraste AA, foco visível, respeito a `prefers-reduced-motion`, e tabela alternativa ao mapa para leitor de tela.

## 6. Layout do `/ao-vivo/`

**Desktop (tela cheia, sem rolagem):**
- cabeçalho com logo, abas Presidente/Governadores/Senado/Deputados, busca ⌘K, status "● HHhMM · X% apurado", Exterior e tela cheia
- mapa ocupando o fundo, com modos Municípios/Estados/Vantagem/Apurado e zoom
- painel esquerdo: manchete, placar, demais candidatos, válidos/comparecimento/brancos e nulos, gráfico da noite
- painel direito: por região (N/NE/CO/SE/S/Exterior) e feed
- rodapé: linha do tempo arrastável, "pessoas agora" e "● Ao vivo"

**Celular (390px):** coluna única com rolagem: cabeçalho, abas roláveis, painel esquerdo, mapa com
altura fixa e zoom por pinça, regiões, feed. A linha do tempo fica fixa no rodapé.

**Outras páginas** (resultado final, histórico, método): mesma estrutura e conteúdo de hoje, com os
tokens novos e o mesmo cabeçalho do HUD. O mapa por UF do relatório continua em SVG.

## 7. Dados servidos

| Arquivo | Conteúdo | Tamanho gzip estimado |
|---|---|---|
| `/vivo/agora.json` | `{t, idg, eleicao, cargo, br:{…}, uf:{SP:[…]}, mu:{"<cdIBGE>":[pctSecoes, comparec, v1, v2, …]}}` | 80–120 KB |
| `/vivo/serie/index.json` | totais nacionais por minuto | ~10 KB |
| `/vivo/serie/HHMM.json` | `agora.json` daquele minuto, carregado sob demanda (cache LRU de 16 no navegador) | ~100 KB cada |
| `/vivo/feed.json` | últimos ~50 eventos: +N seções, eleito definido, virada de líder em UF | ~5 KB |
| `/geo/municipios.topo.json` | malha IBGE simplificada, chaveada pelo código IBGE | 1–1,5 MB |
| `/geo/replay-1t/{cargo}.json` | 1º turno final por município. Deputados = partido mais votado + 3 candidatos mais votados | presidente ~150 KB · deputados ~1 MB |

O replay de deputados exige baixar ~1,5 GB do TSE **uma vez**, no build. Os arquivos brutos não entram no git.

## 8. Componentes do front

| Componente | Responsabilidade |
|---|---|
| `dados.js` | único lugar com `fetch`: polling, `idg` monotônico, último estado bom, status de conexão |
| `Cabecalho` | logo, abas de cargo, busca, status, Exterior, tela cheia |
| `Mapa` | canvas em 3 camadas (base, hover, destaque), zoom e arraste, 4 modos |
| `PainelEsquerdo` | manchete, placar, candidatos, totais, `GraficoNoite` |
| `PainelDireito` | `PorRegiao` + `Feed` |
| `LinhaDoTempo` | navega pela série; ao soltar, volta para o ao vivo |
| `Busca` | índice local de municípios e candidatos |
| `PessoasAgora` | presence; se falhar, se esconde |

## 9. Erros

| Falha | Comportamento |
|---|---|
| TSE lento ou fora | mantém o último `agora.json`; o site mostra "TSE sem resposta, último dado às HH:MM" |
| Agregador estoura os 150 s | processa por UF em lotes encadeados; troca atômica por arquivo |
| `agora.json` inválido ou com `idg` menor | o navegador descarta e mantém o anterior |
| Realtime fora | só o contador some |
| Aparelho fraco (`deviceMemory` < 2 ou `saveData`) | abre no modo Estados e só carrega a malha municipal no zoom |

## 10. Testes

- **Agregador:** testes de unidade com arquivos reais do TSE salvos (Curitiba, ZZ, UF incompleta, candidato sub judice). Invariante: total da UF = soma dos municípios.
- **Segurança (os dois lados):** gravar no bucket `vivo` com a chave anon **falha** (403); com a função, funciona.
- **Ensaio geral:** um simulador reproduz a noite do 1º turno a partir de `snapshots/` como se fosse o TSE, e o painel roda a noite acelerada. Conferência na tela renderizada em 1440px e 390px.
- **Carga:** 500 requisições simultâneas em `/vivo/agora.json`; o Storage deve receber ~1 a cada 15 s.
- **Medição do limite:** tempo da carga completa (5.570 municípios) dentro da Edge Function, medido contra o TSE real antes de assumir que cabe em 150 s.

## 11. Entrega

Um PR por escopo, cada um mergeado antes do próximo.

| Até | PR |
|---|---|
| 09/10 | 1. Tokens da brand + redesign das páginas atuais + `.gitignore` do `.env` + `AGENTS.md` do repo |
| 12/10 | 2. Malha IBGE + replay do 1º turno por município (build) |
| 15/10 | 3. HUD núcleo (mapa, painéis, abas, Exterior) sobre o replay |
| 17/10 | 4. Agregador Supabase + bucket + cron + rewrite Vercel |
| **18/10** | **Linha de corte:** ensaio geral completo. O que não passar sai do ar no dia 25 |
| 21/10 | 5. Linha do tempo + gráfico · 6. Busca + feed · 7. Senado/Deputados + pessoas agora |
| 24/10 | Ensaio final; cron pausado até o TSE publicar o código do 2º turno |

**Exige o OK do Vitor:** deploy de produção, SQL e criação de recursos no Supabase (mostrados antes), e cada merge na main.

## 12. Fora do escopo

- Resultados por zona eleitoral (o seuimposto tem; fica para depois de 25/10)
- Seção a seção
- Qualquer escrita de dado por visitante
