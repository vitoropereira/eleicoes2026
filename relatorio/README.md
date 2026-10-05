# Relatório final do 1º turno — Eleições 2026

`relatorio_final.html` reúne presidente (com mapa por UF), governadores (com mapa de situação), Senado, Câmara (gráfico em semicírculo), Assembleias, a noite da apuração e as fontes.

```bash
cd ~/projects/eleicoes-2026/relatorio
python3 baixar.py   # baixa do TSE os 137 arquivos (presidente por UF + governador, senador, dep. federal, estadual e distrital)
python3 montar.py   # gera relatorio.json e relatorio_final.html a partir de template_relatorio.html
open relatorio_final.html
```

| Arquivo | O que é |
|---|---|
| `dados/` | JSON brutos do TSE (eleições 6257 e 6259) e contornos dos estados (`br-states.geojson`, click_that_hood) |
| `relatorio.json` | dados consolidados, sem o mapa |
| `template_relatorio.html` | layout, em HTML/SVG puro, sem bibliotecas externas |

## Regras e ressalvas

- O TSE ainda não tinha proclamado os eleitos quando os dados foram lidos (04/10/2026 ~22:05). Por isso:
  - **Governador:** eleito quem passa de 50% dos válidos. Se houver candidato com registro anulado sub judice, o script calcula com e sem os votos dele. No RJ, o resultado muda conforme a conta (por causa de Garotinho), então o estado fica "indefinido".
  - **Senado:** os 2 mais votados de cada UF, sem contar candidatos com registro anulado.
  - **Deputados:** as vagas por partido ou federação vêm do campo `vag` publicado pelo TSE (a soma dá 513 federais e 1.059 estaduais/distritais). A divisão dentro das federações é estimada pelos mais votados.
- As cores indicam a relação com a disputa presidencial: azul = PL, vermelho = coligação de Lula registrada no TSE. Elas não classificam ideologia.
