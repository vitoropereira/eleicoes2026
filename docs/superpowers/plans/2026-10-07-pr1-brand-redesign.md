# PR 1: brand vitorpereira.ia.br + redesign das páginas atuais: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a identidade visual de todas as páginas do site pela brand do vitorpereira.ia.br, num único arquivo de tokens, sem mudar nenhum número publicado, e deixar o repo pronto para o Supabase (`.env` ignorado, `AGENTS.md`).

**Architecture:** um `brand.css` na raiz é a única fonte de cores e fontes. Os três templates (`template.html`, `template_aovivo.html`, `relatorio/template_relatorio.html`) trocam seus blocos `:root` por um marcador `/*__BRAND__*/`, que `brand.py` substitui na geração (`gerar.py`, `relatorio/montar.py`). O `build_site.py` passa a usar os tokens no cabeçalho, no rodapé, no banner de cookies, no favicon e nas imagens OG, e copia as fontes (hospedadas por nós) para `site/fonts/`.

**Tech Stack:** Python 3 só com a biblioteca padrão (`unittest`), HTML/CSS estático, Chrome headless (já usado no pré-render).

**Spec:** `docs/superpowers/specs/2026-10-07-painel-ao-vivo-design.md` (seções 2, 5 e 11, PR 1)

## Global Constraints

- Sem dependências novas: só Python 3 com a biblioteca padrão. Testes com `python3 -m unittest`.
- Repo **público**: `.env`, `SUPABASE_TOKEN` e chaves nunca entram em commit, nem em `AGENTS.md`. `SUPABASE_PROJECT_REF` pode aparecer (não é segredo).
- Tokens escuro (padrão): `--bg #070B12`, `--card #0C121D`, `--line #1E2A3D`, `--ink #E9EEF7`, `--muted #8593AB`, `--brand #24C8FF`.
- Tokens claro: `--bg #FBFCFE`, `--card #FFFFFF`, `--line #E2E8F1`, `--ink #0B1220`, `--muted #566072`, `--brand #0A76AD`.
- Fontes: **Inter** (texto e UI) e **JetBrains Mono** (títulos, números grandes, rótulos), servidas de `/fonts/`, sem Google Fonts em tempo de execução.
- Regra de cor: dados usam só cores de partido. PL `#2F5BD3` (claro) / `#5B7FE8` (escuro). O ciano da brand nunca aparece em mapa, barra ou número de candidato.
- Tema escuro por padrão; o claro só com `prefers-color-scheme: light` ou `data-theme="light"`.
- **Nenhum número publicado muda:** `relatorio/relatorio.json` e `historico.json` ficam idênticos aos da `main` depois de regenerar.
- Nada de push na `main`; tudo no branch `feat/brand` em worktree próprio.

## Review Focus

1. **Visitante com o sistema em modo claro**: o site precisa abrir no tema claro com contraste AA, não num escuro forçado nem numa mistura dos dois. Teste: Task 2 (contraste nos dois temas) + Task 5, Step 4 (screenshots com `--blink-settings=preferredColorScheme=1`).
2. **Página aberta como arquivo local (`painel.html` via `file://`)**: as fontes em `/fonts/` não carregam. O texto precisa cair em fonte do sistema sem quebrar o layout. Teste: Task 3 confere o fallback na pilha de `font-family`.
3. **Gráficos Chart.js leem cores via `css('--flavio')`**: se um token sumir, a linha fica preta e invisível no fundo escuro. Teste: Task 3 confere que todo `var(--x)`/`css('--x')` usado nos templates está definido no `brand.css`.
4. **Imagens OG geradas pelo Chrome**: precisam sair com a nova paleta, sem a antiga. Teste: Task 4 verifica que o HTML do card OG não contém mais `#f7f6f3`.
5. **Regeneração altera dados sem querer**: rodar `montar.py` reescreve `relatorio.json`. Teste: Task 5 faz `git diff --exit-code` nos JSONs.

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `.gitignore` | modificar | ignorar `.env*` (exceto `.env.example`) |
| `.env.example` | criar | nomes das variáveis, sem valores |
| `AGENTS.md` | criar | o específico do repo: pilha, projeto Supabase, comandos, regras |
| `brand.css` | criar | tokens dos dois temas + `@font-face` + tipografia base |
| `brand.py` | criar | `aplicar(html) -> str` substitui `/*__BRAND__*/` pelo `brand.css` |
| `assets/fonts/*.woff2` + `assets/fonts/README.md` | criar | fontes hospedadas, com origem e licença (OFL) |
| `template.html`, `template_aovivo.html`, `relatorio/template_relatorio.html` | modificar | trocar blocos `:root` por `/*__BRAND__*/` e `font:` por `var(--font-sans)` |
| `gerar.py`, `relatorio/montar.py` | modificar | chamar `brand.aplicar` ao gerar HTML |
| `build_site.py` | modificar | logo, favicon, theme-color, foco, banner de cookies, OG, copiar fontes |
| `tests/test_brand.py` | criar | contraste, cobertura de tokens, marcador, aplicação |
| `tests/test_site.py` | criar | saída do build: fontes, sem paleta antiga, sem `.env` |

---

### Task 1: Base do repo: `.env` ignorado, `.env.example`, `AGENTS.md`, esqueleto de testes

**Files:**
- Modify: `.gitignore`
- Create: `.env.example`, `AGENTS.md`, `tests/__init__.py`, `tests/test_repo.py`

**Interfaces:**
- Produces: pasta `tests/` rodável com `python3 -m unittest discover -s tests -v`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/__init__.py` vazio. `tests/test_repo.py`:

```python
import subprocess, unittest
from pathlib import Path

R = Path(__file__).resolve().parent.parent


class Repo(unittest.TestCase):
    def ignorado(self, nome):
        return subprocess.run(["git", "-C", str(R), "check-ignore", "-q", nome]).returncode == 0

    def test_env_ignorado(self):
        for nome in (".env", ".env.local", ".env.development.local"):
            self.assertTrue(self.ignorado(nome), f"{nome} precisa estar no .gitignore")

    def test_env_example_versionado_e_sem_valores(self):
        self.assertFalse(self.ignorado(".env.example"))
        for linha in (R / ".env.example").read_text().splitlines():
            if linha and not linha.startswith("#"):
                nome, _, valor = linha.partition("=")
                self.assertEqual(valor, "", f"{nome} não pode ter valor no .env.example")

    def test_agents_md_sem_segredo(self):
        texto = (R / "AGENTS.md").read_text()
        self.assertNotIn("sbp_", texto)
        self.assertNotIn("service_role\":", texto)
        self.assertIn("qzczyicspbizosjogmlq", texto)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python3 -m unittest discover -s tests -v`
Expected: FAIL em `test_env_ignorado` (`.env` não ignorado) e erro de arquivo inexistente em `.env.example`/`AGENTS.md`.

- [ ] **Step 3: Implementar**

Acrescentar ao fim do `.gitignore`:

```
# credenciais locais (repo público: nunca versionar)
.env
.env.*
!.env.example
```

`.env.example`:

```
# Supabase pessoal (projeto do painel ao vivo). Valores só no .env local.
SUPABASE_PROJECT_REF=
SUPABASE_TOKEN=
```

`AGENTS.md`:

```markdown
# eleicoes-2026: o específico deste repo

Pilha **pessoal** do Vitor (conta GitHub `vitoropereira`). Não é Pixel.
Repo **público**: nada de segredo em commit.

## Stack
- Python 3 só com a biblioteca padrão; Chrome headless para pré-render e imagens OG.
- Site estático em `site/`, publicado na Vercel (`build_site.py` gera tudo).
- Visual: `brand.css` é a única fonte de cores e fontes (brand do vitorpereira.ia.br).

## Supabase (painel ao vivo)
- Projeto `qzczyicspbizosjogmlq` (us-east-1), conta pessoal do Vitor.
  É o mesmo projeto do vitorpereira.ia.br: crie recursos **novos**, não mexa nos existentes.
- Credenciais só no `.env` deste repo (`SUPABASE_PROJECT_REF`, `SUPABASE_TOKEN`, que é um PAT da conta inteira).
- O MCP do Supabase desta máquina está logado na org PIXEL: **não usar** para este repo.
- Sem tabelas: o estado do ao vivo é JSON no Storage (bucket `vivo`). O público lê via rewrite
  da Vercel com cache, nunca direto no Storage.
- Toda escrita/DDL e criação de recurso: mostrar o SQL/comando ao Vitor e esperar o OK.

## Comandos
- Testes: `python3 -m unittest discover -s tests -v`
- Relatório: `cd relatorio && python3 montar.py && cd ..`
- Site: `python3 build_site.py`
- PR: `/ship`

## Regras
- `relatorio/relatorio.json` e `historico.json` são dados publicados: mudança visual não pode alterá-los.
- Dados usam só cores de partido; o ciano da brand é só para a moldura.
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python3 -m unittest discover -s tests -v`
Expected: 3 testes, OK.

- [ ] **Step 5: Commit**

```bash
git add .gitignore .env.example AGENTS.md tests/__init__.py tests/test_repo.py
git commit -m "Ignora .env e documenta o repo para o Supabase do ao vivo"
```

---

### Task 2: `brand.css` + `brand.py` com contraste testado

**Files:**
- Create: `brand.css`, `brand.py`, `tests/test_brand.py`

**Interfaces:**
- Produces: `brand.aplicar(html: str) -> str` (troca a primeira e única ocorrência de `/*__BRAND__*/` pelo conteúdo do `brand.css`; levanta `ValueError` se o marcador não existir). `brand.CSS: str`. Tokens: `--bg --card --ink --ink2 --muted --line --soft --brand --flavio --lula --outros --neutral --amber --live --b1..--b4 --r1..--r4 --g0 --font-sans --font-mono`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_brand.py`:

```python
import colorsys, re, unittest
from pathlib import Path

R = Path(__file__).resolve().parent.parent
import sys; sys.path.insert(0, str(R))
import brand


def bloco(seletor_regex):
    m = re.search(seletor_regex + r"\s*\{([^}]*)\}", brand.CSS)
    assert m, f"bloco não encontrado: {seletor_regex}"
    return dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", m.group(1)))


def tema(nome):
    base = bloco(r":root")
    return base if nome == "escuro" else {**base, **bloco(r":root\[data-theme=\"light\"\]")}


def lum(hexcor):
    h = hexcor.strip().lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contraste(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


class Brand(unittest.TestCase):
    def test_valores_da_brand(self):
        e, c = tema("escuro"), tema("claro")
        self.assertEqual((e["--bg"], e["--card"], e["--brand"]), ("#070B12", "#0C121D", "#24C8FF"))
        self.assertEqual((c["--bg"], c["--card"], c["--brand"]), ("#FBFCFE", "#FFFFFF", "#0A76AD"))

    def test_contraste_aa_nos_dois_temas(self):
        for nome in ("escuro", "claro"):
            t = tema(nome)
            for fg in ("--ink", "--ink2", "--muted"):
                for bg in ("--bg", "--card"):
                    self.assertGreaterEqual(contraste(t[fg], t[bg]), 4.5, f"{nome}: {fg} sobre {bg}")
            # cores de partido aparecem em números grandes: AA para texto grande
            for fg in ("--flavio", "--lula"):
                self.assertGreaterEqual(contraste(t[fg], t["--card"]), 3.0, f"{nome}: {fg} sobre --card")

    def test_pl_longe_do_ciano(self):
        for nome in ("escuro", "claro"):
            t = tema(nome)
            hue = lambda x: colorsys.rgb_to_hsv(*(int(x.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)))[0] * 360
            # medido: escuro 29,6°, claro 23,7° (no claro a luminosidade também separa)
            self.assertGreaterEqual(abs(hue(t["--flavio"]) - hue(t["--brand"])), 20, nome)

    def test_claro_tambem_pelo_sistema(self):
        self.assertIn('@media (prefers-color-scheme: light){:root:not([data-theme="dark"])', brand.CSS)

    def test_aplicar(self):
        self.assertIn("--bg:#070B12", brand.aplicar("<style>/*__BRAND__*/body{}</style>"))
        with self.assertRaises(ValueError):
            brand.aplicar("<style>body{}</style>")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python3 -m unittest tests.test_brand -v`
Expected: ERROR `ModuleNotFoundError: No module named 'brand'`.

- [ ] **Step 3: Implementar**

`brand.css`. Os blocos claros ficam em uma linha cada, porque o teste lê `:root[data-theme="light"]{…}`:

```css
/* Brand vitorpereira.ia.br: única fonte de cores e fontes do site. Escuro por padrão. */
@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/inter-latin-wght-normal.woff2) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:100 800;font-display:swap;src:url(/fonts/jetbrains-mono-latin-wght-normal.woff2) format("woff2")}
:root{color-scheme:dark;--bg:#070B12;--card:#0C121D;--ink:#E9EEF7;--ink2:#AEB8CA;--muted:#8593AB;--line:#1E2A3D;--soft:#111A28;--brand:#24C8FF;--flavio:#5B7FE8;--lula:#E35A4F;--outros:#8593AB;--neutral:#3A4558;--amber:#E0A530;--live:#3ECF7C;--b1:#1E2A55;--b2:#2D4596;--b3:#4466D6;--b4:#8AA5F5;--r1:#5A2E2A;--r2:#8F3A31;--r3:#D0564A;--r4:#F29185;--g0:#1A2334;--font-sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){color-scheme:light;--bg:#FBFCFE;--card:#FFFFFF;--ink:#0B1220;--ink2:#3B4558;--muted:#566072;--line:#E2E8F1;--soft:#F1F5FA;--brand:#0A76AD;--flavio:#2F5BD3;--lula:#D1453B;--outros:#566072;--neutral:#A3ABB8;--amber:#C98A12;--live:#1F9D55;--b1:#D6DFF7;--b2:#9DB2EF;--b3:#4F72DD;--b4:#2443A8;--r1:#F7D3CE;--r2:#EFA198;--r3:#E0604F;--r4:#A8322A;--g0:#E9EDF3}}
:root[data-theme="light"]{color-scheme:light;--bg:#FBFCFE;--card:#FFFFFF;--ink:#0B1220;--ink2:#3B4558;--muted:#566072;--line:#E2E8F1;--soft:#F1F5FA;--brand:#0A76AD;--flavio:#2F5BD3;--lula:#D1453B;--outros:#566072;--neutral:#A3ABB8;--amber:#C98A12;--live:#1F9D55;--b1:#D6DFF7;--b2:#9DB2EF;--b3:#4F72DD;--b4:#2443A8;--r1:#F7D3CE;--r2:#EFA198;--r3:#E0604F;--r4:#A8322A;--g0:#E9EDF3}
h1,h2,.kicker,.tile .v,.prob .v{font-family:var(--font-mono);letter-spacing:-.02em}
.tile .k,header p.kicker{font-family:var(--font-mono);letter-spacing:.1em}
a{color:var(--brand)}
```

`brand.py`:

```python
"""Brand do vitorpereira.ia.br: injeta brand.css no lugar do marcador /*__BRAND__*/ dos templates."""
from pathlib import Path

MARCADOR = "/*__BRAND__*/"
CSS = (Path(__file__).resolve().parent / "brand.css").read_text()


def aplicar(html: str) -> str:
    if MARCADOR not in html:
        raise ValueError("template sem o marcador /*__BRAND__*/")
    return html.replace(MARCADOR, CSS, 1)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python3 -m unittest tests.test_brand -v`
Expected: 5 testes, OK. Se `test_contraste_aa_nos_dois_temas` falhar num par, ajuste **só** o token que falhou (por exemplo `--ink2`), nunca os valores da brand fixados em `test_valores_da_brand`.

- [ ] **Step 5: Commit**

```bash
git add brand.css brand.py tests/test_brand.py
git commit -m "Tokens da brand vitorpereira.ia.br num único brand.css"
```

---

### Task 3: Templates usam a brand; geradores aplicam; fontes hospedadas

**Files:**
- Create: `assets/fonts/inter-latin-wght-normal.woff2`, `assets/fonts/jetbrains-mono-latin-wght-normal.woff2`, `assets/fonts/README.md`
- Modify: `template.html:9-17`, `template_aovivo.html:8-19`, `relatorio/template_relatorio.html:8-19`, a linha `body{…font:…}` de cada template
- Modify: `gerar.py:115-117`, `relatorio/montar.py:171-173`
- Test: `tests/test_brand.py` (acrescentar a classe `Templates`)

**Interfaces:**
- Consumes: `brand.aplicar`, `brand.CSS` (Task 2).
- Produces: templates com exatamente um `/*__BRAND__*/` e sem token de cor próprio.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `tests/test_brand.py`, antes do `if __name__`:

```python
TEMPLATES = [R / "template.html", R / "template_aovivo.html", R / "relatorio" / "template_relatorio.html"]


class Templates(unittest.TestCase):
    def test_um_marcador_e_sem_tokens_proprios(self):
        for t in TEMPLATES:
            h = t.read_text()
            self.assertEqual(h.count("/*__BRAND__*/"), 1, t.name)
            self.assertNotRegex(h, r"--(bg|ink|card|flavio|lula)\s*:\s*#", f"{t.name} ainda define cor própria")

    def test_todo_token_usado_existe(self):
        da_brand = set(re.findall(r"(--[\w-]+)\s*:", brand.CSS))
        for t in TEMPLATES:
            h = t.read_text()
            definidos = da_brand | set(re.findall(r"(--[\w-]+)\s*:", h))  # locais, ex.: style="--c:…"
            usados = set(re.findall(r"var\((--[\w-]+)", h)) | set(re.findall(r"css\('(--[\w-]+)'\)", h))
            self.assertEqual(usados - definidos, set(), t.name)

    def test_fonte_do_corpo_tem_fallback(self):
        self.assertIn("-apple-system", brand.CSS)
        for t in TEMPLATES:
            self.assertNotIn("-apple-system", t.read_text(), f"{t.name}: use var(--font-sans)")

    def test_fontes_existem(self):
        for f in re.findall(r"url\(/fonts/([^)]+)\)", brand.CSS):
            p = R / "assets" / "fonts" / f
            self.assertTrue(p.exists() and p.stat().st_size > 10_000, f)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python3 -m unittest tests.test_brand -v`
Expected: FAIL nos 4 testes novos.

- [ ] **Step 3: Baixar as fontes**

```bash
mkdir -p assets/fonts
curl -sfL -o assets/fonts/inter-latin-wght-normal.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-wght-normal.woff2"
curl -sfL -o assets/fonts/jetbrains-mono-latin-wght-normal.woff2 "https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono:vf@latest/latin-wght-normal.woff2"
ls -l assets/fonts   # esperado: ~48 KB e ~40 KB
```

`assets/fonts/README.md`:

```markdown
Fontes da brand vitorpereira.ia.br, hospedadas aqui (sem Google Fonts em tempo de execução).

| Arquivo | Fonte | Licença | Origem |
|---|---|---|---|
| inter-latin-wght-normal.woff2 | Inter (variável, subset latin) | SIL OFL 1.1 | fontsource via jsDelivr |
| jetbrains-mono-latin-wght-normal.woff2 | JetBrains Mono (variável, subset latin) | SIL OFL 1.1 | fontsource via jsDelivr |
```

- [ ] **Step 4: Trocar os blocos `:root` dos templates**

Em cada um dos 3 templates, apague as linhas do primeiro `:root{` até o fim do bloco `:root[data-theme="dark"]{…}` (inclusive) e ponha no lugar uma única linha:

```css
/*__BRAND__*/
```

Para conferir que o bloco saiu inteiro, rode `grep -nE -- '--(bg|flavio):#' template.html template_aovivo.html relatorio/template_relatorio.html`. A saída esperada é vazia.

Na regra `body{…}` de cada template, troque o trecho da fonte:
- `template.html`: `font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif` → `font:15px/1.5 var(--font-sans)`
- `template_aovivo.html` e `relatorio/template_relatorio.html`: `font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif` → `font:15px/1.55 var(--font-sans)`

- [ ] **Step 5: Aplicar a brand nos geradores**

`gerar.py`. No topo, junto aos imports:

```python
import brand
```

e na geração (linha ~117):

```python
    html = brand.aplicar(tpl.replace("/*__DATA__*/null", json.dumps(data, ensure_ascii=False)))
```

`relatorio/montar.py`. No topo:

```python
import sys; sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import brand
```

(se `Path` ainda não estiver importado no topo de `montar.py`, use `from pathlib import Path` antes dessa linha) e na escrita (linha ~173):

```python
    (H / "relatorio_final.html").write_text(brand.aplicar(tpl.replace("/*__DATA__*/null", json.dumps(data, ensure_ascii=False))))
```

`build_site.py`: as páginas de leitura e o ao vivo leem os templates direto. Aplicar nos dois pontos:

```python
import brand  # junto aos imports do topo
...
        raw = brand.aplicar(tpl.replace("/*__DATA__*/null", json.dumps(d, ensure_ascii=False)))   # linha ~377
...
    raw = brand.aplicar((R / "template_aovivo.html").read_text().replace("/*__MAPA__*/null", mapa))   # linha ~434
```

- [ ] **Step 6: Rodar e ver passar**

Run: `python3 -m unittest discover -s tests -v`
Expected: todos OK.

- [ ] **Step 7: Commit**

```bash
git add assets/fonts template.html template_aovivo.html relatorio/template_relatorio.html gerar.py relatorio/montar.py build_site.py tests/test_brand.py
git commit -m "Templates passam a usar o brand.css e fontes hospedadas"
```

---

### Task 4: Moldura do site na brand (cabeçalho, logo, favicon, cookies, OG) + cópia das fontes

**Files:**
- Modify: `build_site.py` (`FAVICON` l.59, `SITE_CSS` l.61-101, `MEDICAO_BODY` l.108-118, `sitebar` l.155-160, `head` l.205-206, `og_card` l.318-329, `main` início e fim)
- Create: `tests/test_site.py`

**Interfaces:**
- Consumes: `brand.CSS` (Task 2), `assets/fonts/` (Task 3).
- Produces: `site/fonts/*.woff2`; `build_site.og_card(...)` com a mesma assinatura de hoje.

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_site.py`. Importar `build_site` roda só definições e leitura de JSON, sem o `main()`:

```python
import re, sys, unittest
from pathlib import Path

R = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(R))
import build_site as B

PALETA_ANTIGA = ["#f7f6f3", "#1b1c1e", "#1a1a19", "#232322", "#2563c9", "#5b8def"]


class Moldura(unittest.TestCase):
    def test_sem_paleta_antiga_na_moldura(self):
        moldura = B.SITE_CSS + B.MEDICAO_BODY + B.FAVICON + B.og_card("t", "s", 47.0, 45.2, "r") + B.head("t", "d", "/", "/og/x.png", [], "a", "b")
        for cor in PALETA_ANTIGA:
            self.assertNotIn(cor, moldura.lower(), cor)

    def test_logo_da_brand(self):
        s = B.sitebar("/")
        self.assertIn("vitor", s); self.assertIn("pereira", s); self.assertIn('class="cursor"', s)

    def test_foco_usa_brand(self):
        self.assertNotIn("var(--flavio)", B.SITE_CSS + B.MEDICAO_BODY)


class Saida(unittest.TestCase):
    SITE = R / "site"

    @unittest.skipUnless((R / "site" / "index.html").exists(), "rode python3 build_site.py antes")
    def test_fontes_publicadas(self):
        for f in ("inter-latin-wght-normal.woff2", "jetbrains-mono-latin-wght-normal.woff2"):
            self.assertTrue((self.SITE / "fonts" / f).exists(), f)

    @unittest.skipUnless((R / "site" / "index.html").exists(), "rode python3 build_site.py antes")
    def test_paginas_com_brand_e_sem_segredo(self):
        for p in self.SITE.rglob("*.html"):
            h = p.read_text()
            self.assertIn("--bg:#070B12", h, p)
            self.assertNotIn("sbp_", h, p)
        self.assertFalse(any(self.SITE.rglob(".env*")))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python3 -m unittest tests.test_site -v`
Expected: FAIL em `test_sem_paleta_antiga_na_moldura`, `test_logo_da_brand` e `test_foco_usa_brand`; os testes de `Saida` falham ou são pulados.

- [ ] **Step 3: Implementar a moldura**

Em `build_site.py`:

`FAVICON` (cursor ciano sobre o fundo da brand, mesmo motivo do logo):

```python
FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#070B12"/><rect x="12" y="34" width="10" height="18" rx="2" fill="#5B7FE8"/><rect x="26" y="22" width="10" height="30" rx="2" fill="#E35A4F"/><rect x="42" y="12" width="9" height="40" rx="2" fill="#24C8FF"/></svg>"""
```

`sitebar`: substituir o `<a class="brand">…</a>` por:

```python
            f'<a class="brand" href="/" aria-label="Eleições 2026, por Vitor Pereira">'
            f'<span class="wm">vitor<span class="dim">pereira</span><span class="cursor" aria-hidden="true"></span></span>'
            f'<span class="sep" aria-hidden="true">/</span><span>eleições 2026</span></a>'
```

Em `SITE_CSS`, trocar a regra `.sitebar .brand…` e `.sitebar .brand svg…` por:

```css
.sitebar{background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px)}
.sitebar .brand{font-family:var(--font-mono);font-weight:600;display:flex;align-items:center;gap:8px;letter-spacing:-.01em}
.sitebar .brand .dim{color:var(--muted);margin-left:.45em}
.sitebar .brand .cursor{display:inline-block;width:.5em;height:1.05em;background:var(--brand);margin-left:2px;vertical-align:-.15em}
.sitebar .brand .sep{color:var(--line)}
```

e trocar todo `outline:2px solid var(--flavio)` de `SITE_CSS` por `outline:2px solid var(--brand)`. Também trocar `.banner div{…border-left:4px solid var(--amber,#c98a12)…}` por `border-left:4px solid var(--brand)`.

`MEDICAO_BODY`: trocar os fallbacks antigos (`#fff`, `#1b1c1e`, `#e6e5e1`, `#55595f`, `#2563c9`) pelos tokens sem fallback (`var(--card)`, `var(--ink)`, `var(--line)`, `var(--ink2)`, `var(--brand)`) e o botão de aceitar por:

```css
.consent button.ok{background:var(--brand);color:#04121B;border-color:var(--brand)}
```

`head`: as duas linhas `theme-color` viram:

```python
<meta name="theme-color" content="#FBFCFE" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#070B12" media="(prefers-color-scheme: dark)">
<link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/jetbrains-mono-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
```

`og_card`: fundo, fontes e cores da brand (o Chrome do build carrega as fontes do servidor local):

```python
def og_card(titulo, sub, f, l, rodape_txt):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:Inter;font-weight:100 900;src:url(/fonts/inter-latin-wght-normal.woff2)}}
@font-face{{font-family:"JetBrains Mono";font-weight:100 800;src:url(/fonts/jetbrains-mono-latin-wght-normal.woff2)}}
*{{box-sizing:border-box}}body{{margin:0;width:1200px;height:630px;background:#070B12;font-family:Inter,sans-serif;color:#E9EEF7}}
.w{{padding:64px 72px;height:100%;display:flex;flex-direction:column}}
.k{{font:500 22px "JetBrains Mono",monospace;color:#8593AB;letter-spacing:.1em;text-transform:uppercase}}
h1{{font:600 60px/1.05 "JetBrains Mono",monospace;margin:14px 0 0;letter-spacing:-.02em}}
.row{{display:flex;gap:28px;margin-top:auto}}.c{{flex:1;background:#0C121D;border:2px solid #1E2A3D;border-radius:20px;padding:24px 30px;border-top:10px solid var(--c)}}
.n{{font-size:28px;color:#8593AB}}.p{{font:600 92px/1 "JetBrains Mono",monospace;color:var(--c)}}
.f{{margin-top:26px;font-size:22px;color:#8593AB;display:flex;justify-content:space-between}}
.f b{{color:#E9EEF7;font:600 22px "JetBrains Mono",monospace}}.f b i{{display:inline-block;width:11px;height:24px;background:#24C8FF;vertical-align:-4px;margin-left:3px}}</style></head><body><div class="w">
<div class="k">{html.escape(sub)}</div><h1>{html.escape(titulo)}</h1>
<div class="row"><div class="c" style="--c:#5B7FE8"><div class="n">Flávio Bolsonaro · PL</div><div class="p">{fmt(f, 2)}%</div></div>
<div class="c" style="--c:#E35A4F"><div class="n">Lula · PT</div><div class="p">{fmt(l, 2)}%</div></div></div>
<div class="f"><span>{html.escape(rodape_txt)}</span><b>vitor pereira<i></i></b></div></div></body></html>"""
```

`main()`: logo depois de `BUILD.mkdir(); OUT.mkdir()`:

```python
    for dest in (BUILD / "fonts", OUT / "fonts"):
        shutil.copytree(R / "assets" / "fonts", dest, ignore=shutil.ignore_patterns("*.md"))
```

E no `vercel` dict, um cabeçalho de cache para as fontes, acrescentado à lista `headers`:

```python
                    {"source": "/fonts/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=31536000, immutable"}]},
```

O `<style>` do índice `/apuracao/` e da 404 vem do `relatorio_final.html` já com a brand aplicada (Task 3), então não precisa de mudança.

- [ ] **Step 4: Rodar os testes de unidade**

Run: `python3 -m unittest tests.test_site.Moldura -v`
Expected: 3 testes, OK.

- [ ] **Step 5: Commit**

```bash
git add build_site.py tests/test_site.py
git commit -m "Cabeçalho, favicon, cookies e imagens OG na brand"
```

---

### Task 5: Regenerar, provar que os dados não mudaram e conferir na tela

**Files:**
- Modify (gerados): `relatorio/relatorio_final.html`, `painel.html`, `site/**`, `vercel.json`

**Interfaces:**
- Consumes: tudo das Tasks 1–4.

- [ ] **Step 1: Regenerar o relatório e o site**

```bash
cd relatorio && python3 montar.py && cd ..
python3 build_site.py
```

Expected: `site/ ok · 10 páginas · 7 imagens OG · … KB` (mesma contagem de páginas e imagens de antes).

Para regenerar o `painel.html` da raiz sem buscar o TSE, rode este one-off (não commitar como script):

```bash
python3 -c "import json,brand,pathlib as p; d=json.load(open('marcos/final/dados.json')) if p.Path('marcos/final/dados.json').exists() else None; print('sem dados.json do marco final: painel.html fica como está') if d is None else p.Path('painel.html').write_text(brand.aplicar(p.Path('template.html').read_text().replace('/*__DATA__*/null', json.dumps(d, ensure_ascii=False))))"
```

- [ ] **Step 2: Dados publicados intactos**

Run: `git diff --exit-code -- relatorio/relatorio.json historico.json relatorio/dados/`
Expected: saída vazia, exit 0. **Se mudar algo, pare**: a mudança visual alterou dado. Investigue antes de seguir.

- [ ] **Step 3: Todos os testes, incluindo os da saída**

Run: `python3 -m unittest discover -s tests -v`
Expected: tudo OK, sem testes pulados (o `site/` agora existe).

- [ ] **Step 4: Conferência visual na tela renderizada**

```bash
S=$(mktemp -d); C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
(cd site && python3 -m http.server 8790 >/dev/null 2>&1 &) ; sleep 1
for p in "" "ao-vivo/" "apuracao/" "apuracao/93-2/"; do n=$(echo "${p:-home}" | tr '/' '_')
  "$C" --headless=new --hide-scrollbars --window-size=1440,900 --virtual-time-budget=6000 --screenshot=$S/d_$n.png "http://127.0.0.1:8790/$p" 2>/dev/null
  "$C" --headless=new --hide-scrollbars --window-size=390,844 --virtual-time-budget=6000 --screenshot=$S/m_$n.png "http://127.0.0.1:8790/$p" 2>/dev/null
  "$C" --headless=new --hide-scrollbars --blink-settings=preferredColorScheme=1 --window-size=1440,900 --virtual-time-budget=6000 --screenshot=$S/l_$n.png "http://127.0.0.1:8790/$p" 2>/dev/null
done; echo $S; pkill -f "http.server 8790"
```

Abra cada PNG (ferramenta Read) e confira:
- fundo `#070B12`, logo `vitor pereira▌`, títulos em mono
- mapa e barras em azul-PL e vermelho-PT, **sem ciano nos dados**
- gráficos do Chart.js visíveis (linhas não pretas)
- 390px sem rolagem horizontal
- no tema claro (`l_*`), tudo legível

Abra também `site/og/index.png`.

- [ ] **Step 5: Commit dos gerados**

```bash
git add relatorio/relatorio_final.html painel.html site vercel.json
git commit -m "Site regenerado com a brand"
```

- [ ] **Step 6: Abrir o PR**

Rodar `/ship`. Ele troca a conta do `gh` para `vitoropereira`, confere os gates e abre o PR para a `main`. **Merge e deploy só com o OK do Vitor.**
