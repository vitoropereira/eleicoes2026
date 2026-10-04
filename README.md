# Eleições 2026 — Presidente, 1º turno (04/10/2026)

Painel com a apuração do TSE e projeções do resultado final.

## Uso

```bash
cd ~/projects/eleicoes-2026
python3 gerar.py          # busca o TSE, atualiza painel.html, acrescenta ponto no historico.json e arquiva em snapshots/
open painel.html
```

## Arquivos

| Arquivo | O que é |
|---|---|
| `gerar.py` | busca o JSON do TSE (eleição 6257, cargo 1) por UF, projeta e gera o HTML |
| `template.html` | layout e gráficos (Chart.js) — os dados são injetados no `/*__DATA__*/` |
| `painel.html` | última versão gerada |
| `historico.json` | um ponto (% apurado, Flávio, Lula) por rodada, alimenta a linha "apurado" |
| `snapshots/<data>_<hora TSE>_<pct>pct/` | cópia imutável de cada rodada (`painel.html` + `dados.json`) |

## Modelo

- **Projeção base:** o voto que falta em cada UF segue o % já apurado daquela UF. Corrige o viés entre estados, mas não o viés dentro de cada estado.
- **Monte Carlo (20 mil):** sobre a base, viés nacional no voto restante ~N(+1 pt Lula, 3 pt) e ruído por UF ~N(0, 2 pt). São premissas escolhidas, não estimadas.
- **Pesquisas:** tabela agregada da Wikipedia, convertida para votos válidos. Não conferidas uma a uma nos institutos.

## Log das rodadas

| Hora TSE | % apurado | Flávio | Lula | Proj. base F × L | P(Flávio vence no 1º) | P(Flávio termina na frente) |
|---|---|---|---|---|---|---|
| 18:19 | 24,45 | 50,94 | 40,97 | 49,0 × 43,0 | — | — |
| 18:23 | 27,88 | 50,85 | 41,05 | 48,8 × 43,2 | 18% | 85% |
| 18:32 | 36,60 | 50,63 | 41,23 | 48,4 × 43,6 | 9% | 86% |
| 19:06 | 64,81 | 49,58 | 42,25 | 47,8 × 44,2 | 0,2% | 95,5% |
| 19:32 | 84,93 | 48,47 | 43,49 | 47,5 × 44,6 | 0,0% | 99,8% |

Marcos (`marcos/<N>pct/`, gerados por `watch.sh`):
- **50%** salvo com 64,81% apurado, porque o TSE saltou de 47,26% (18:44) direto para 64,81% (19:06).
- **75%** salvo com 84,93% apurado. O arquivo nacional (`br`) do TSE congelou em 64,81% (última modificação 19:14), enquanto os arquivos das UFs seguiam atualizando. Desde então o % nacional é a **soma das seções das UFs**. O arquivo de PE vem com horário ~50 min adiantado, então ele fica de fora da "hora dos dados".

### Comparação das fontes no marco de 75% (`marcos/75pct/comparacao_fontes.json`)

| Fonte | Dados de | % apurado | Flávio | Lula |
|---|---|---|---|---|
| Arquivo nacional `br` (travado) | 19:06 | 64,81 | 49,58 | 42,25 |
| Soma das UFs (usada no marco) | 19:32 | 84,93 | 48,47 | 43,49 |
| Arquivo nacional `br` (destravado) | 19:45 | 84,96 | 48,47 | 43,49 |
| Soma das UFs (mesmo instante) | ~19:45 | 85,21 | 48,46 | 43,50 |

Quando o `br` destravou, ele confirmou a soma das UFs. Por isso a soma virou a fonte padrão.

A rodada das 18:19 foi só a análise no terminal: não tem painel nem snapshot. As rodadas a partir de 18:32 estão em `snapshots/`.
