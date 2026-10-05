---
name: ship
description: "Verifica, commita, publica e abre PR — com os gates que este repo exige"
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# /ship

Leva o trabalho da árvore até um PR aberto, passando pelos gates que este repo
exige. Adaptado do `/ship` do `vitorpereira.ia.br-cursos`: aqui é **Python puro +
HTML estático**, sem pnpm, sem banco e sem testes automatizados. Os gates são
regenerar o site e conferir os números.

O repo é **público**: tudo o que entra no commit fica visível para qualquer pessoa.

## Passo 0 — Conta do GitHub (sempre primeiro)

```bash
gh auth switch --user vitoropereira
```

A máquina tem duas contas no `gh`. Com a errada ativa, o `fetch`/`push` falha com
_"Invalid username or token"_ — erro que parece problema de remote e não é.

## Passo 1 — Contexto

Em paralelo:

- `git fetch -q && git status --short`
- `git diff --stat` e `git diff --cached --stat`
- `git branch --show-current`
- `git log --oneline -5` (para casar o estilo de mensagem)

**Se estiver na `main`:** pare e crie uma branch (`dados/…`, `feat/…`, `fix/…`).
Nunca commite direto nela.

**Se a pasta puder estar aberta em outra sessão:** use `git worktree`. Trocar de
branch redireciona os commits da outra sessão, e isso só aparece no `push`.

## Passo 2 — O que não pode mudar

Antes de qualquer coisa, olhe se o diff **altera** (não só acrescenta) algum destes:

| Caminho | Regra |
|---|---|
| `snapshots/*/` e `marcos/*/` | registro histórico da noite — só se **acrescenta** rodada nova; nunca se edita uma existente |
| `relatorio/dados/*.json` | só muda via `relatorio/baixar.py` (dado bruto do TSE, sem edição à mão) |
| `historico.json` | só se **acrescenta** ponto; pontos antigos não mudam |

Se o diff edita um desses, pare e pergunte. A correção vai no código que lê os
dados, não no registro.

## Passo 3 — Documentação que talvez precise acompanhar

Só o que for **diretamente** afetado pelo diff.

| Se o diff… | Confira |
|---|---|
| acrescenta rodada ou muda o resultado | a tabela "Log da noite" no `README.md` |
| muda regra de cálculo (eleito, projeção, soma das UFs) | a seção "Como os números são calculados" do `README.md`, `relatorio/README.md` e o bloco "Método e fontes" do relatório |
| muda página, rota ou SEO | a tabela de páginas no `README.md`, `sitemap.xml`/`llms.txt` gerados pelo `build_site.py` |
| muda como contribuir ou rodar | `CONTRIBUTING.md` e a seção "Rodar" do `README.md` |

Se nada disso se aplica, diga "nenhum doc afetado" e siga.

## Passo 4 — Gates (obrigatórios, nesta ordem)

Corrija e repita até tudo limpo. **Não pule nenhum.**

### 4a. Os scripts compilam

```bash
python3 -m py_compile gerar.py build_site.py relatorio/baixar.py relatorio/montar.py
```

### 4b. O site está em dia com o código e os dados

`site/` é gerado e vai versionado. Se o diff toca **template, script ou dado** e
não toca `site/`, o site publicado fica velho.

```bash
cd relatorio && python3 montar.py && cd ..   # se mexeu em relatório/dados
python3 build_site.py                        # sempre que template, script ou dado mudou
git status --short site/                     # o build precisa ter rodado depois da última mudança
```

### 4c. Os números fecham

Confira os totais. Número que não fecha é bug de leitura, não detalhe:

```bash
python3 - <<'PY'
import json
d = json.load(open("relatorio/relatorio.json"))
assert len(d["gov"]) == 27, "governadores != 27"
assert sum(n for _, n in d["sen_part"]) == 54, "Senado != 54 vagas"
assert d["depfed"]["total"] == 513, "Câmara != 513"
assert d["depest"]["total"] == 1059, "Assembleias + CLDF != 1059"
assert sum(n for _, n in d["depfed"]["por_partido"]) == 513, "partidos da Câmara não somam 513"
c = {x["nome"]: x["p"] for x in d["nac"]["cand"]}
print("ok ·", d["nac"]["pst"], "% apurado ·", {k: v for k, v in list(c.items())[:2]})
PY
```

### 4d. Nada sensível no commit

```bash
git diff --cached -U0 | grep -nEi "(api[_-]?key|secret|token|password|BEGIN (RSA|OPENSSH)|vcp_|ghp_|sk-[a-z0-9]{20})" || echo "sem segredos"
git diff --cached -U0 | grep -nE "/Users/|@hotmail|@gmail" || echo "sem caminho local nem e-mail"
```

Falso positivo comum: "dese**nha**do" casa com "senha" — leia a linha antes de
concluir.

## Passo 5 — Verificação que o build não faz

O build terminar **não prova** que a página está certa.

### 5a. Texto sem JavaScript (o que Google e IAs leem)

```bash
python3 - <<'PY'
import re, html, pathlib
for f in ["site/index.html", "site/ao-vivo/index.html", "site/apuracao/index.html"]:
    s = pathlib.Path(f).read_text()
    t = html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>|<style.*?</style>", "", s, flags=re.S)))
    print(f, len(t.split()), "palavras visíveis sem JS")
PY
```

Página com poucas palavras sem JS = pré-render quebrado.

### 5b. Erros de JavaScript e tela renderizada

Sirva `site/` (porta livre; **não mate processo que não é seu**) e:

- abra em Chrome headless com `window.onerror` capturando erro;
- olhe a tela em **claro e escuro**, **desktop e 375px** — `curl` respondendo
  prova que o arquivo existe, não que a tela renderiza;
- em mudança de dado, confira 2 ou 3 números na tela contra `relatorio/relatorio.json`.

Encerre só o servidor que você subiu.

## Passo 6 — Commit

Mensagem em **pt-BR**, imperativa, explicando o **porquê**. Um commit por escopo
(dados de uma rodada ≠ mudança de template ≠ mudança de cálculo).

```bash
git add <arquivos>   # nunca `git add -A` sem olhar o que entrou
git commit -F - <<'EOF'
resumo curto do que muda

Por que a mudança existe, não o que o diff já mostra.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

## Passo 7 — Push

```bash
git push -u origin HEAD    # sem upstream
git push                   # já rastreando
```

Nunca `--force`. Push rejeitado significa que o remote andou — investigue, não
sobrescreva.

## Passo 8 — PR

Sempre contra `main`. **Um PR por escopo** — PR com escopos misturados não passa
em review.

```bash
gh pr create --base main --title "<título>" --body "$(cat <<'EOF'
## O que muda

<uma frase por item, dizendo o porquê>

## Verificação

- Scripts compilam — <resultado>
- `build_site.py` — <N páginas, rodado depois da última mudança>
- Números fecham — <27 governos / 54 Senado / 513 Câmara / 1059 Assembleias>
- Sem segredos — <resultado>
- Texto sem JS — <palavras por página>
- Visual: <o que você olhou, ou **"não verificado"** — nunca omita>

## Pendências conhecidas

<o que ficou de fora e por quê, ou "nenhuma">

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Se já existe PR para a branch, informe a URL em vez de abrir outro.

**Diga o que você não verificou.** PR que omite a lacuna é pior que PR que a
declara — o revisor assume cobertura que não existe.

## Passo 9 — Não mergear nem publicar sozinho

Abra o PR e devolva a URL. Merge e deploy são decisão do Vitor, salvo pedido
explícito. Quando o deploy for pedido:

```bash
cd site
export VERCEL_TOKEN="$VERCEL_TOKEN_PESSOAL"   # token SEMPRE por variável, nunca como argumento
vercel link --yes --project eleicoes2026 --scope vitor-pereiras-projects-3b2efe5b   # o build apaga site/.vercel
vercel deploy --prod --yes --scope vitor-pereiras-projects-3b2efe5b
```

Por que o token vai por variável: passado como `--token "$X"` num shell que não
separa palavras, o CLI rejeita o argumento e **imprime o token no erro**.

Depois do deploy, confira no domínio (`https://eleicoes2026.vitorpereira.ia.br`)
que as páginas respondem 200 e mostram o número novo — não só a URL da Vercel.
