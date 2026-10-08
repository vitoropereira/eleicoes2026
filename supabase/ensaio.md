# Ensaio geral do 2º turno (local, nada em produção)

A noite do 1º turno reencenada como se fosse o 2º turno (eleição 6258): simulador do TSE progressivo → agregador
(`executar`, o mesmo código da Edge Function) → arquivos em `.build/vivo/` → HUD servido localmente.
Tudo fica em `.build/` (fora do git). Não usa Supabase, Storage, cron nem a Vercel.

## 0. Uma vez: os arquivos do 1º turno

```bash
deno run --allow-net --allow-write --allow-read supabase/simular.ts baixar .build/tse-1t   # ~5,8 mil arquivos, ~53 MB, retomável
```

## 1. Os passos da noite

```bash
deno run -A supabase/ensaio.ts lista
```

| Passo | Nome | Hora (`agora.t`) | Origem do % por UF |
|---|---|---|---|
| 0 | 0% | 17:00 | configuração publicada, nenhuma seção (arquivos com zero voto) |
| 1 | 36.6% | 18:32 | `snapshots/2026-10-04_1832_36.6pct/dados.json` |
| 2 | 64.81% | 19:06 | `snapshots/…_1906_64.8pct` (= `marcos/50pct`) |
| 3 | 84.93% | 19:32 | `snapshots/…_1932_84.9pct` (= `marcos/75pct`) |
| 4 | 93.21% | 20:47 | `snapshots/…_2047_93.2pct` (= `marcos/pre-final`) |
| 5 | 99.71% | 21:56 | `snapshots/…_2156_99.7pct` (= `marcos/final`) |
| 6 | 100% | 22:40 | arquivos finais; o mais votado sai como "Eleito" (exercita o evento de eleito do feed) |

Como cada passo é montado (`simular.ts`, modo progressivo): cada UF fica com o `states[].pst` daquela leitura; dentro da
UF cada município anda num ritmo fixo (1 a 3×, pelo código) e nunca volta; os votos do município são os finais vezes a
fração de seções apuradas; a UF é a soma dos municípios (ZZ, a soma das cidades do exterior). Aproximação de ensaio.
Atenção: nos snapshots o % das UFs foi lido alguns minutos depois do % nacional, então o `pst` publicado no passo 1 é
45,6% (não 36,6%) e no passo 2, 71,4%. O nome do passo é o rótulo do snapshot.

## 2. Rodar a noite (um terminal)

```bash
deno run -A supabase/ensaio.ts 0 --zerar          # recomeça: apaga .build/vivo/
deno run -A supabase/ensaio.ts 1
deno run -A supabase/ensaio.ts 2
deno run -A supabase/ensaio.ts 3
deno run -A supabase/ensaio.ts 4 --corte-ms 300   # orçamento curto: parte das UFs fica em `pend` ("UFs atualizando")
deno run -A supabase/ensaio.ts 4                  # a rodada seguinte fecha as pendentes
deno run -A supabase/ensaio.ts 5
deno run -A supabase/ensaio.ts 6
```

Cada comando sobe o simulador em `127.0.0.1:8787` (HTTP de verdade, com ETag/304), roda **uma** rodada do agregador e
imprime o resultado e um resumo do `agora.json` (UFs, municípios, `pend`, válidos do país = soma das UFs, validação do
contrato). Opções: `--concorrencia 16`, `--verboso` (log do agregador), `--porta 8787`, `--vivo .build/vivo`.
Com `--corte-ms` muito baixo nenhuma UF fecha e a rodada não publica (`sem-mudanca`): suba o valor.

## 3. Ver no HUD (outro terminal)

```bash
python3 supabase/ensaio_site.py --porta 8790      # http://127.0.0.1:8790/ao-vivo/
```

Serve `site/` como na Vercel, `/vivo/*` de `.build/vivo/` e `/hud/*.js` direto de `hud/` (testa mudança no HUD sem
rodar o build). Objeto que não existe em `/vivo/` responde como o Storage responde hoje (HTTP 400 + `NoSuchKey`).
Recarregue a página depois de cada passo (ou espere o polling de 15 s).

Capturas (desktop e celular):

```bash
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$C" --headless=new --hide-scrollbars --window-size=1440,900 --virtual-time-budget=10000 --screenshot=passo.png http://127.0.0.1:8790/ao-vivo/
```
Celular: uma página com `<iframe src="http://127.0.0.1:8790/ao-vivo/" style="width:390px;height:844px;border:0">`
servida por **http** (`python3 -m http.server`); aberta como `file://` o iframe não abre no 2º turno.

## O que conferir em cada passo

| Passo | Esperado |
|---|---|
| 0 | abre sozinho no 2º turno; "Nenhuma seção apurada ainda"; mapa sem cor de partido; sem legenda; feed vazio |
| 1 | mapa por município colorido; manchete "lidera com X% das seções"; feed com o 1º evento; gráfico sem o ponto 0% |
| 4 (`--corte-ms`) | "UFs atualizando: …" com as UFs pendentes; modo Apurado ligado (há `pm`) |
| 6 | 100%; feed com "é eleito presidente"; manchete continua "lidera" (o 2º turno não tem status.json) |
| linha do tempo | arrastar troca para o `serie/HHMM.json` daquele minuto e o selo vira "Revendo a noite"; se o minuto falhar, aviso com "Tentar de novo" e nada do ao vivo |

## Ensaio com a função de verdade (Docker, opcional)

O simulador progressivo também serve HTTP sozinho; `/_passo/<i>` troca o passo:
```bash
deno run --allow-net --allow-read supabase/simular.ts servir .build/tse-1t --progressivo --host 0.0.0.0 --porta 8787
curl -s http://127.0.0.1:8787/_passo/1
```
e a função local segue o roteiro de `PROPOSTA.md`, seção 7 (`supabase start` + `supabase functions serve`).
