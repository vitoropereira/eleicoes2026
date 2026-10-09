# Aba "Análise": spec (08/10/2026)

Decisões tomadas em entrevista com o Vitor. Este documento é a autoridade para a implementação.

## Objetivo
Painel amplo de análises do cenário eleitoral de 2026 que **gere curiosidade** e **atraia acesso** (busca e redes). Pergunta-motor: por que Lula tem ~54 mi de votos e a esquerda elege tão poucos deputados e senadores? Isso é padrão real ou ilusão dos números?

## Princípios
- **Voto é secreto.** Todo número que não é contagem do TSE é **estimativa**, marcada visualmente ("estimativa", faixa de incerteza, método explicado). Totais oficiais e estimativas aparecem juntos.
- Sem seção sobre fraude.
- Tom: manchete curta, jornalística e neutra + "Entenda" expansível, didático (quociente eleitoral, federações, inferência ecológica).
- Cada número é rastreável à fonte (TSE, nota de partido, matéria).

## Classificação dos partidos ("lados")
- **2026:** lado = apoio no 2º turno presidencial (Flávio × Lula) e coligações formadas/em formação. Três categorias: **Lula**, **Flávio**, **Centro/sem lado** (quem não declarou, com prova, fica no centro).
- Prova aceita: nota oficial do partido, coligação registrada no TSE, imprensa reconhecida, declaração pública de dirigente. Cada classificação guarda link + data.
- Escopo da posição: se a declaração é nacional, vale para o Brasil; se é de diretório estadual, vale para aquela UF (override por UF).
- Mantida em `analise/lados-2026.json` (partido → lado nacional, overrides por UF, provas). Congelada com data ("posição em DD/MM"); o Claude pesquisa e atualiza quando o Vitor pedir.
- **2022:** lado = apoio no 2º turno de 2022 (Lula × Jair Bolsonaro), mesmo padrão de prova, em `analise/lados-2022.json`.

## Análises (todas na primeira versão)
1. **Votos por campo e cargo**: Lula/Centro/Flávio em presidente, governador, Senado (votos totais, cada eleitor tinha 2; explicado), dep. federal, dep. estadual. Brasil e por UF.
2. **Voto dividido estimado**: quantos eleitores de Lula votaram em deputado/senador/governador de outro campo (e o inverso), por inferência ecológica sobre os municípios, com intervalo; Brasil e UF. Sempre "estimativa".
3. **Votos × cadeiras**: % de votos vs % de cadeiras por campo (Câmara, Assembleias, Senado).
4. **Divergências** (várias formas): ranking de municípios e estados onde um lado levou presidente e o outro levou deputado/senador/governador; mapa; filtro por cargo e UF.
5. **Brancos e nulos por cargo**.
6. **Fragmentação e centrão**: número efetivo de partidos, peso do centro.
7. **Voto de legenda** por campo e UF.
8. **Puxadores de voto**: mais votados e quantos colegas "puxaram" pelo quociente.
9. **2022 × 2026**: presidente e Legislativo por município: viradas (ex.: Lula venceu em 2022, Flávio em 2026), ganho/perda por campo; mapa e lista.
10. **Cenários do 2º turno**: quanto cada um precisa dos eliminados; para onde foram votos equivalentes em 2022; média de pesquisas de 2º turno publicadas (com fontes). Marcado como cenário, não previsão.
11. **FAQ** (perguntas que as pessoas buscam) com JSON-LD FAQPage.

## Onde e como
- **/analise/**: página própria, rolável, texto e gráficos já no HTML pré-renderizado (SEO), mesmo cabeçalho do painel com aba "Análise" ativa. Gráficos interativos (hover), **seletor de UF** que recalcula tudo, versão leve no celular. Brand vitorpereira.ia.br, regra de cores (dados só com cores de campo/partido, ciano só na moldura).
- **Painel (/ao-vivo/)**: aba "Análise" no cabeçalho; cartões com os números mais curiosos + novo modo de mapa **"Divergência"**, com link para /analise/.
- **Compartilhamento**: link por gráfico (#âncora + imagem de prévia OG por gráfico), botões WhatsApp / X / copiar link, **imagem 1080×1350** por análise (brand + eleicoes2026.vitorpereira.ia.br + @vitorpereirasaas).

## Dados
- 2026: `municipios/geo/t1/partidos-<cargo>.json`, `cadeiras.json` (prontos, branch feat/analise).
- 2022: baixar do TSE (resultados 2022 por município e partido, todos os cargos) para `municipios/geo/t2022/`, com o mesmo formato; mapear códigos de município.
- Saída das análises: `analise/dados/*.json` (gerados por `analise/calcular.py`), consumidos pela página e pelo painel.

## Entrega
Tudo agora, em paralelo. Revisão final + verificação na tela renderizada antes do merge.
