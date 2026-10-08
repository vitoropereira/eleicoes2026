# Painel ao vivo (HUD): contrato de dados e escopo de 08/10/2026

Complementa `2026-10-07-painel-ao-vivo-design.md`. Vale sobre ele onde divergir.

## Mudança de escopo (08/10)
- Tudo num dia: o painel sai **com o 1º turno completo** (resultado final por município), e o **2º turno fica como aba aberta e vazia** ("Aguardando o TSE · 25/10").
- O painel **substitui `/ao-vivo/`** (o template antigo `template_aovivo.html` sai de uso e é arquivado em `docs/old/`).
- **Linha do tempo do 1º turno:** o TSE não publica histórico por município, só temos a noite por UF (`snapshots/*/dados.json`, `marcos/*/dados.json`) e a trajetória nacional (`historico.json`). Arrastar a linha do tempo põe o mapa em modo **Estados**; no fim (100%) volta para Municípios.
- **Exterior:** 186 cidades sem código IBGE, mostradas como **lista** (painel), não no mapa.
- **Agregador do 2º turno no Supabase:** etapa seguinte, depois do painel. O SQL e o cron são mostrados ao Vitor antes de rodar.

## Arquivos (gerados por `municipios/montar.py`, servidos em `site/geo/`)

Todos em JSON compacto (`separators=(",",":")`, `ensure_ascii=False`). Códigos de município = **código IBGE de 7 dígitos como string** (campo `cdi` do TSE = `codarea` do IBGE).

### `geo/municipios.topo.json`
A malha do IBGE **como vem**:
`https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=municipio&formato=application/json&qualidade=minima`
TopoJSON, objeto `BRMU`, 5.570 geometrias, `properties.codarea`, com `transform`.

### `geo/t1/meta.json`
```json
{
  "dg": "05/10/2026", "ht": "12:51:05",
  "mun": {"4106902": ["Curitiba", "PR"], "...": ["Nome", "UF"]},
  "exterior": [["ABIDJÃ", "29254"], "..."],
  "cand": {
    "presidente": [{"n": "22", "nome": "Flávio Bolsonaro", "sg": "PL"}, "... ordem por votos nacionais desc"],
    "governador": {"PR": [{"n": "..", "nome": "..", "sg": ".."}], "...": []},
    "senador":    {"PR": [{"n": "..", "nome": "..", "sg": ".."}], "...": []}
  }
}
```
Nomes com acento e caixa de título (o TSE manda MAIÚSCULO; `NOME_EXIBICAO` do `build_site.py` mostra o padrão). `nome` = nome de urna.

### `geo/t1/presidente.json`
```json
{
  "br": [eleitores, comparecimento, validos, brancos, nulos, [votos_c0, votos_c1, ...]],
  "uf": {"PR": [ ...mesmo formato... ], "ZZ": [ ... ]},
  "mu": {"4106902": [ ...mesmo formato... ]},
  "ex": {"29254": [ ...mesmo formato... ]}
}
```
`votos_ci` na **mesma ordem** de `meta.cand.presidente`. Inteiros.

### `geo/t1/governador.json` e `geo/t1/senador.json`
Mesmo formato do presidente, sem `br` e sem `ex`; a lista de votos segue a ordem de `meta.cand.<cargo>[UF]`.
Senador: votos nominais por candidato (cada eleitor vota em 2 neste ano; não normalizar).

### `geo/t1/depfed.json` e `geo/t1/depest.json`
```json
{ "mu": {"4106902": [validos, "PL", votos_partido_top, [["Nome", "PL", votos], ["..", "..", 0], ["..", "..", 0]]]},
  "uf": {"PR": [validos, "PL", votos_partido_top, [[...top 3 da UF...]]]} }
```
`depest` para o DF é a Câmara Legislativa (distrital), mesmo formato.

### `geo/t1/serie.json`
Noite do 1º turno, ordenada por hora:
```json
[{"ht": "18:19", "pst": 24.45, "f": 50.94, "l": 40.97, "uf": null},
 {"ht": "18:32", "pst": 36.6, "f": 50.63, "l": 41.23, "uf": {"AC": [pst, f, l], "...": []}}]
```
Pontos de `historico.json` (sem `uf`) fundidos com os snapshots e marcos (com `uf`, de `states[]`: `pst`, `f`, `l`). Último ponto = final (100%, de `relatorio/relatorio.json`).

### `geo/t1/feed.json`
Até 60 eventos derivados de `relatorio/relatorio.json` e de `serie.json`, mais recentes primeiro:
`[{"h": "21:56", "t": "apuracao", "txt": "99,7% das seções · Flávio 47,1% × Lula 45,2%"}, {"h": "…", "t": "eleito", "uf": "PR", "txt": "Paraná: Fulano (PSD) é eleito governador"}, …]`

## Leitura do 2º turno (para o front já tratar)
`/vivo/agora.json` (ainda não existe; 404 = estado vazio "Aguardando o TSE · 25/10 a partir das 17h"). Formato = `presidente.json` + `{"t": "HH:MM", "idg": "…", "pst": 98.7}`.

## Cores de partido
Usar os tokens do `brand.css`: `--flavio` (PL), `--lula` (PT), `--outros`. Demais partidos: tabela fixa em `hud/partidos.js` com cores distintas do ciano da brand.

## Emendas (08/10, depois da integração com os dados reais)
- **7º elemento `vansj`** em toda linha de presidente/governador/senador (`br`/`uf`/`mu`/`ex`): votos anulados sub judice. Em `meta.json`, candidato com votos anulados tem `"sj": true`.
- **Percentual de governador e Senado = votos / (validos + vansj)**, a regra do TSE (o `pvap` publicado). Candidato sub judice **tem %** e aparece com a etiqueta "sub judice". Presidente: vansj = 0, mesma conta. O mais votado do município (inclusive sub judice) é quem colore o mapa.
- **"Eleito" e "2º turno" vêm de `/hud/status.json`**, gerado no build a partir do `relatorio.json` (candidato identificado pelo número), nunca de porcentagem. Sem status, a manchete é neutra ("lidera com X%"). Na linha do tempo (leitura parcial) a manchete é sempre "lidera com X% das seções".
- **`serie.json` e `feed.json` com `d`** ("04/10"/"05/10"); a série vem ordenada por pst; item do feed com `"h": null` é exibido como "05/10 · resultado final".
- **`/vivo/agora.json`**: traz a própria lista `cand` (os votos seguem essa ordem, não o meta.json); chaves extras ignoradas (`t`, `idg`, `pst`, `dg`, `ele`, `cargo`); `pend` = UFs atrasadas em relação ao TSE (o HUD mostra "UFs atualizando: …"); `pu` = % de seções por UF e `pm` = % por município (modo Apurado e rótulos; sem `pm`, Apurado fica desabilitado no 2º turno). O HUD também lê `/vivo/feed.json` e `/vivo/serie/index.json` (+ `/vivo/serie/HHMM.json` sob demanda) e abre no 2º turno quando `agora.json` existe.
- **5101837 (Boa Esperança do Norte, MT)** está em `meta.mun` e nos dados, mas não tem geometria na malha do IBGE: aparece na busca e na dica, não no mapa.
