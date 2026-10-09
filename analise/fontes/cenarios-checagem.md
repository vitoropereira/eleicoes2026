# Checagem de cenarios.json (08/10/2026)

## Mudancas
- Datafolha 01/10: campo 29/09-01/10 -> 28/09-01/10 (Times Brasil + 2a materia; Wikipedia 28-30/09 e Tribuna 29/09 divergem).
- Datafolha 08/10: removida citacao (texto nao bate literalmente) e obs sobre Quaest/Parana/RTBD "sem registro" (nao verificavel). Dados conferidos.
- RTBD, Quaest 28/09: citacoes removidas (nao literais). Dados conferidos.
- AtlasIntel: citacao trocada pelo original em pt ("Flavio registrando 47,7% e Lula 47,6%"). Fonte unica.
- ADICIONADAS: PoderData 05-07/10 (3.000, +-1,8, BR-08134/2026, Flavio 53 x Lula 47 validos, fonte unica); Quaest 02-03/10 (3.702, +-2, BR-02197/2026, Flavio 44 x Lula 42).
- Cenario "Datafolha": nome/descricao ajustados (nao e mais a unica pesquisa pos-1T).
- Caiado: URL trocada para IstoE; citacao "A mobilizacao para Flavio sera em tempo integral" (06/10); Kassab liberou filiados.
- Zema: 05/10 (video) confirmado em 3 fontes; A Critica (05/10, "nao apoiou formalmente") e SBT (previa 04/10) estavam desatualizadas. Citacao: "Voto contra o PT, voto no Flavio Bolsonaro". Removida a frase sobre posicao formal do Novo.
- Cury e Renan: neutralidade confirmada; data 2026-10-05.
- Seis candidatos menores: apoio "sem declaracao" nao verificavel -> agregados em 1 linha (260.655 votos), conferido=false.
- fontes_2022: Wikipedia substituida por Metropoles/O Povo/Correio Braziliense/TSE. Tebet 05/10/2022; PDT e Ciro 04/10/2022. Contagens brutas do 1T (57.259.504 / 51.072.345) so em snippet de busca (Band), nao no JSON.

## Aritmetica (recalculada, tudo OK)
- Eliminados = 119.300.788 - 56.104.503 - 53.879.538 = 9.316.747 (7,81%); soma dos 10 candidatos idem.
- Minimo = floor(V/2)+1 = 59.650.395. Flavio precisa 3.545.892 (38,06%); Lula 5.770.857 (61,94%).
- Neutro: Lula 58.537.911 (49,07%) x Flavio 60.762.877 (50,93%).
- Lado declarado: 2.931.636 a Flavio + 6.385.111/2 -> Lula 47,84 x Flavio 52,16 (65,73% dos eliminados a Flavio).
- Datafolha 52/48: Flavio precisa 63,67%, Lula 36,33%.
- 2022: ganhos +2,47 e +5,90 sobre 8,37 -> 29,5% / 70,5%; aplicado: Lula 47,47 x Flavio 52,53.
