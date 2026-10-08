# Agregador do 2º turno: o que precisa do seu OK

Nada aqui foi executado. Nenhum deploy, bucket, extensão, cron ou migration existe ainda.
Projeto: `qzczyicspbizosjogmlq` (compartilhado com vitorpereira.ia.br: só recursos novos, nomes `vivo` e `eleicoes-agregador`).

O que está pronto no repo: `supabase/functions/agregador-eleicoes/` (função + testes) e `supabase/simular.ts` (simulador do TSE).

## 0. Variáveis de ambiente da função

| Variável | Origem | Para quê |
|---|---|---|
| `SUPABASE_URL` | injetada pelo runtime | Storage |
| `SUPABASE_SERVICE_ROLE_KEY` | injetada pelo runtime | única credencial que grava em `vivo` |
| `AGREGADOR_SEGREDO` | `supabase secrets set` (passo 4) | sem `x-agregador: <segredo>` a função responde 401 |
| `TSE_BASE` | opcional | padrão `https://resultados.tse.jus.br`; o simulador usa outro |
| `AGREGADOR_CONCORRENCIA` | opcional | padrão 16, mínimo 1 (ver "Riscos", item 1) |
| `ELEICAO_FORCADA` | só ensaio | ex. `6257`; **nunca em produção** (publicaria o 1º turno como se fosse o 2º) |

## 1. Bucket público `vivo` (Storage API, chave service role)

```bash
# SERVICE_ROLE_KEY e SUPABASE_URL na sua shell; não colar em arquivo do repo
curl -sS -X POST "$SUPABASE_URL/storage/v1/bucket" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"id":"vivo","name":"vivo","public":true,"file_size_limit":5242880,"allowed_mime_types":["application/json"]}'
```

Público = leitura sem autenticação. Escrita continua exigindo service role.

## 2. Anon não escreve em `vivo` (SQL, para você aprovar)

`storage.objects` tem RLS ligada e, sem policy de INSERT/UPDATE/DELETE para `anon`, a escrita é negada. Conferir que
ninguém abriu essa porta, e fechar explicitamente (cinto e suspensório; policy `restrictive` só afeta `vivo`):

```sql
-- 2a. conferência (esperado: nenhuma linha com cmd INSERT/UPDATE/DELETE/ALL que cite 'vivo' ou não filtre bucket)
select policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'storage' and tablename = 'objects' order by policyname;

-- 2b. trava explícita: nenhuma role de API grava em vivo, mesmo que alguém crie uma policy permissiva depois
create policy "vivo: so service role grava (insert)" on storage.objects
  as restrictive for insert to anon, authenticated with check (bucket_id <> 'vivo');
create policy "vivo: so service role grava (update)" on storage.objects
  as restrictive for update to anon, authenticated using (bucket_id <> 'vivo') with check (bucket_id <> 'vivo');
create policy "vivo: so service role grava (delete)" on storage.objects
  as restrictive for delete to anon, authenticated using (bucket_id <> 'vivo');
```

Rollback (as 3 policies):
```sql
drop policy "vivo: so service role grava (insert)" on storage.objects;
drop policy "vivo: so service role grava (update)" on storage.objects;
drop policy "vivo: so service role grava (delete)" on storage.objects;
```
Aviso: restrictive é AND com as policies permissivas existentes; como `bucket_id <> 'vivo'` é verdadeiro nos outros
buckets, o comportamento deles não muda. Confirmar com 2a antes e depois.

### Verificação (os dois lados: resiste e funciona)

```bash
ANON=<anon key do projeto>   # a pública, a mesma do site
# A. anon NÃO cria          -> esperado 403 (ou 400 com "row-level security")
curl -i -X POST "$SUPABASE_URL/storage/v1/object/vivo/anon-teste.json" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"x":1}'
# B. anon NÃO sobrescreve   -> esperado 403/400 (rodar depois do passo D)
curl -i -X POST "$SUPABASE_URL/storage/v1/object/vivo/teste.json" -H "x-upsert: true" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"x":"anon"}'
# C. anon NÃO apaga         -> esperado 403/400 (ou 200 com lista vazia: conferir que o objeto continua lá)
curl -i -X DELETE "$SUPABASE_URL/storage/v1/object/vivo/teste.json" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
# D. service role grava     -> esperado 200 (controle positivo)
curl -i -X POST "$SUPABASE_URL/storage/v1/object/vivo/teste.json" -H "x-upsert: true" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d '{"x":"servico"}'
# E. leitura pública        -> esperado 200 {"x":"servico"}
curl -i "$SUPABASE_URL/storage/v1/object/public/vivo/teste.json"
# F. limpeza do teste
curl -i -X DELETE "$SUPABASE_URL/storage/v1/object/vivo/teste.json" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```

## 3. Extensões (SQL)

```sql
select extname from pg_extension where extname in ('pg_net','pg_cron','supabase_vault');  -- ver o que já existe
create extension if not exists pg_net;
-- pg_cron e supabase_vault normalmente já vêm habilitadas; se faltar: create extension if not exists pg_cron; (idem vault)
```

## 4. Segredo compartilhado (Vault + secret da função)

```bash
SEGREDO=$(openssl rand -hex 32)
supabase secrets set AGREGADOR_SEGREDO="$SEGREDO" --project-ref qzczyicspbizosjogmlq
```
```sql
select vault.create_secret('<mesmo valor de $SEGREDO>', 'agregador_segredo', 'segredo do cron do agregador de eleições');
```

## 5. Deploy da função (comando para você rodar quando aprovar)

```bash
supabase functions deploy agregador-eleicoes --project-ref qzczyicspbizosjogmlq --no-verify-jwt
```
`--no-verify-jwt` porque a autenticação é o segredo `x-agregador`, não JWT. Teste (sem eleição publicada o esperado é `sem-eleicao`):

```bash
curl -i -X POST "$SUPABASE_URL/functions/v1/agregador-eleicoes?sincrono=1"                        # 401
curl -i -X POST "$SUPABASE_URL/functions/v1/agregador-eleicoes?sincrono=1" -H "x-agregador: errado"  # 401
curl -sS -X POST "$SUPABASE_URL/functions/v1/agregador-eleicoes?sincrono=1" -H "x-agregador: $SEGREDO" # {"status":"sem-eleicao"}
```

## 6. Cron, criado **inativo**

```sql
select cron.schedule('eleicoes-agregador', '* * * * *', $$
  select net.http_post(
    url := 'https://qzczyicspbizosjogmlq.supabase.co/functions/v1/agregador-eleicoes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agregador', (select decrypted_secret from vault.decrypted_secrets where name = 'agregador_segredo')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
$$);
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'eleicoes-agregador'), active := false);
select jobname, schedule, active from cron.job where jobname = 'eleicoes-agregador';   -- active = false
```
O `net.http_post` desiste em 5 s; a função responde 202 e termina o trabalho em segundo plano (`EdgeRuntime.waitUntil`).
Uma trava em `_estado.json` impede rodadas sobrepostas.

**Ativar em 25/10** (quando `?sincrono=1` deixar de devolver `sem-eleicao`):
```sql
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'eleicoes-agregador'), active := true);
```
**Acompanhar:** `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;`
e `select status_code, created from net._http_response order by created desc limit 5;`

**Remover depois da apuração:**
```sql
select cron.unschedule('eleicoes-agregador');
delete from vault.secrets where name = 'agregador_segredo';
-- desfazer o passo 2b (opcional):
drop policy "vivo: so service role grava (insert)" on storage.objects;
drop policy "vivo: so service role grava (update)" on storage.objects;
drop policy "vivo: so service role grava (delete)" on storage.objects;
```
```bash
supabase secrets unset AGREGADOR_SEGREDO --project-ref qzczyicspbizosjogmlq
supabase functions delete agregador-eleicoes --project-ref qzczyicspbizosjogmlq
```
A extensão `pg_net` **continua instalada de propósito**: o projeto é compartilhado com o vitorpereira.ia.br e remover
extensão pode afetar o que já usa. Só derrube com `drop extension pg_net` se você confirmar que nada mais depende dela.
(O bucket `vivo` fica com os resultados para consulta; esvaziar/apagar só se você quiser.)

## 6b. O que a função publica (e como se comporta)

| Objeto em `vivo/` | Quando muda |
|---|---|
| `agora.json` | **só quando as 28 UFs (27 + ZZ) estão presentes**. Carrega `pend: [UFs]`, as UFs cujo dado ficou atrás do TSE nesta publicação (o front mostra "UFs atualizando") |
| `_parcial.json` | rascunho gravado a cada rodada com o progresso (mesmo formato do `agora.json`). A rodada seguinte parte dele (cai para `agora.json` se não existir). Na primeira carga, várias rodadas curtas convergem aqui e só então publicam |
| `serie/HHMM.json`, `serie/index.json`, `feed.json` | junto com o `agora.json` |
| `_estado.json` | ETags, idg por UF, trava (`dono`/`travaAte`) e pausa (`pausaAte`/`pausaMs`) |

Rodada sem as 28 UFs devolve `{"status":"sem-dados","motivo":"UFs faltando: ..."}` e não publica. Um `idg` por UF menor
que o já aceito é ignorado. Depois de um 429 do TSE a função fica em pausa de 2, depois 4, depois 8 minutos
(`{"status":"pausa"}`), e zera numa rodada limpa. Rodada que perde a trava para outra aborta sem gravar.

## 7. Ensaio geral com o simulador (tudo local, nada em produção)

```bash
# baixa o 1º turno do TSE uma vez (~5,8 mil arquivos; retomável; fora do git)
deno run --allow-net --allow-write --allow-read supabase/simular.ts baixar .build/tse-1t
# serve como se fosse o 2º turno (eleição 6258); --sem-turno2 ensaia o caminho "ainda não existe"
deno run --allow-net --allow-read supabase/simular.ts servir .build/tse-1t --porta 8787 --host 0.0.0.0
```
Função local contra o Supabase local (Docker), em outro terminal:
```bash
supabase start
curl -X POST http://127.0.0.1:54321/storage/v1/bucket -H "Authorization: Bearer <service_role LOCAL do supabase status>" \
  -H "Content-Type: application/json" -d '{"id":"vivo","name":"vivo","public":true}'
printf 'AGREGADOR_SEGREDO=ensaio\nTSE_BASE=http://host.docker.internal:8787\n' > supabase/.env.local   # ignorado pelo git (.env.*)
supabase functions serve agregador-eleicoes --no-verify-jwt --env-file supabase/.env.local
curl -sS -X POST "http://127.0.0.1:54321/functions/v1/agregador-eleicoes?sincrono=1" -H "x-agregador: ensaio"
```
A noite progressiva (0% → leituras do 1º turno por UF → 100%) tem modo próprio (`servir --progressivo`) e um roteiro
completo sem Docker, com o agregador gravando em `.build/vivo/` e o HUD servido localmente: `supabase/ensaio.md`.

## Riscos e decisões que dependem de você

1. **Limite do TSE (medido em 08/10/2026, 15h22-15h25 de Brasília, a partir da máquina local do Vitor, não da Edge Function).**
   `deno run --allow-net --allow-read --allow-write supabase/simular.ts medir <dir> --concorrencia N [--condicional <dir>]`
   baixou o 1º turno inteiro de presidente (eleição 6257: 28 arquivos de UF + 5.757 de município = 5.785, ~9 KB cada, 52,7 MB):

   | Passada | Conexões | Tempo | req/s | Respostas | 429/403 | Latência p50 / p95 |
   |---|---|---|---|---|---|---|
   | 1. carga completa | 8 | 80,4 s | 71,9 | 5.784 × 200, 1 timeout (20 s) | 0 | 86 / 221 ms |
   | 2. revalidação com ETag (`If-None-Match`) | 12 | 38,0 s | 152,2 | 5.784 × 304, 1 × 200 (o do timeout) | 0 | 60 / 150 ms |
   | 3. carga completa, pasta nova | 16 | 40,0 s | 144,6 | 5.785 × 200 | 0 | 93 / 202 ms |

   O TSE anuncia `x-ratelimit-limit: 2000, 2000;w=1` (2.000 por segundo); o menor `x-ratelimit-remaining` visto foi 1.513.
   Resumos brutos: `.build/tse-1t/_medicao-c8.json`, `_medicao-c12-etag.json`, `.build/tse-1t-c16/_medicao-c16.json` (fora do git).
   **Decisão:** padrão da função = 16 (o maior que rodou sem nenhum 429). Ressalvas: (a) num teste anterior, também com 16
   conexões, o TSE respondeu 429 depois de ~1,5 mil arquivos e bloqueou por vários minutos, então o limite real varia
   (carga do TSE/Akamai, IP); (b) a função roda nos EUA (us-east-1), com latência maior e outro IP, e na noite da eleição o
   TSE está sob carga. Por isso o secret de produção `AGREGADOR_CONCORRENCIA=12` pode ficar como está: com 12 a carga
   completa leva ~50 s, dentro do orçamento de 100 s por rodada, e as rodadas seguintes são quase só 304. A função trata
   429 como disjuntor (para de buscar na rodada, mantém o último `agora.json` e entra em pausa de 2, 4, 8 min).
2. **Código do 2º turno desconhecido.** A descoberta lê `ele-c.json` e só aceita entrada `ele2026`, `t=2`, nome com "Federal".
   Fallback: usa o `cdt2` da entrada federal de 1º turno (hoje `6258`) apenas se o arquivo de municípios dessa eleição já responde 200.
3. **Gravação.** Cada arquivo vai com um único POST `x-upsert: true` (o Storage troca o objeto de uma vez; o leitor vê o
   antigo ou o novo). Não há mais temporário + copy. A ordem série, feed, `agora.json` por último é mantida.
4. `_estado.json` fica no bucket público (ETags e idg, sem dado sensível).
