# Como contribuir

Obrigado pelo interesse! Este repositório guarda o histórico da apuração de 2026 e o código que gera o site.

## O que é bem-vindo

- **Correções de dados ou de texto**: um número errado, um nome mal grafado, uma afirmação sem fonte.
- **Novas análises**: por município, por região, comparação com 2018 e 2022, votos de cada partido.
- **Melhorias no site**: acessibilidade, performance, visualizações.
- **2º turno (25/10)**: preparar o painel e o relatório para a nova eleição do TSE.

## Regras simples

1. Abra uma issue antes de mudanças grandes, para combinarmos o caminho.
2. Um PR por assunto. PR que mistura dados, código e texto fica difícil de revisar.
3. **Toda afirmação precisa de fonte.** Número que vem do TSE cita o arquivo; número de fora cita o link.
4. Não altere os dados brutos em `relatorio/dados/` nem os `snapshots/`: eles são o registro histórico. Correções vão no código que os lê.
5. Rode `python3 build_site.py` e confira o site em `site/` antes de abrir o PR.

## Ambiente

Python 3 (só biblioteca padrão) e Google Chrome, usado no pré-render e nas imagens Open Graph. No macOS, o caminho do Chrome está em `CHROME`, no topo do `build_site.py`.
