#!/usr/bin/env python3
"""Gera o site estático em site/: página principal (relatório final), uma página por leitura da apuração,
SEO (meta, Open Graph, JSON-LD, sitemap, robots) e GEO (llms.txt, FAQ visível, texto pré-renderizado).
Pré-renderiza cada página com Chrome headless (--dump-dom) para que o texto já esteja no HTML.
Uso: python3 relatorio/montar.py && python3 build_site.py"""
import json, re, shutil, subprocess, threading, functools, html, http.server, socketserver, time
from datetime import datetime
from pathlib import Path

BASE = "https://eleicoes2026.vitorpereira.ia.br"
SITE_NAME = "Eleições 2026 · Apuração e resultados"
AUTOR = dict(nome="Vitor Onofre Pereira", url="https://vitorpereira.ia.br")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
R = Path(__file__).parent
OUT = R / "site"
BUILD = R / ".build"
ISO = lambda dt: dt.strftime("%Y-%m-%dT%H:%M:00-03:00")
fmt = lambda x, d=1: f"{x:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")

rel = json.loads((R / "relatorio" / "relatorio.json").read_text())
N = rel["nac"]
cF = next(c for c in N["cand"] if c["nome"].startswith("Flavio")); cL = next(c for c in N["cand"] if c["nome"] == "Lula")
gov2 = [g for g in rel["gov"] if g["status"] == "2turno"]; govIn = [g for g in rel["gov"] if g["status"] == "indefinido"]
govEl = [g for g in rel["gov"] if g["status"] == "eleito"]
plFed = dict(rel["depfed"]["por_partido"]).get("PL", 0); plSen = dict(rel["sen_part"]).get("PL", 0)
ufF = [u for u in rel["pres_uf"] if u["uf"] != "ZZ" and u["saldo"] > 0]; ufL = [u for u in rel["pres_uf"] if u["uf"] != "ZZ" and u["saldo"] < 0]
GOV_OFICIAL = all(g.get("oficial") for g in rel["gov"]); SEN_OFICIAL = all(s.get("oficial") for s in rel["sen"])
DEP_PENDENTES = sorted(set(rel["depfed"].get("ufs_pendentes", []) + rel["depest"].get("ufs_pendentes", [])))
apertado = min((u for u in rel["pres_uf"] if u["uf"] != "ZZ"), key=lambda u: abs(u["saldo"]))
LEITURA = datetime.strptime(f'{N["dg"]} {N["ht"]}', "%d/%m/%Y %H:%M:%S")

# ---------------- rodadas da apuração (dados de cada snapshot, renderizados com o template atual)
def dados_snapshot(path):
    if path.startswith("git:"):
        return json.loads(subprocess.check_output(["git", "-C", str(R), "show", path[4:]]).decode())
    return json.loads((R / path).read_text())

RODADAS = [("snapshots/2026-10-04_1832_36.6pct/dados.json", "36-6"),
           ("snapshots/2026-10-04_1906_64.8pct/dados.json", "64-8"),
           ("marcos/75pct/dados.json", "84-9"),
           ("snapshots/2026-10-04_2047_93.2pct/dados.json", "93-2"),
           ("snapshots/2026-10-04_2156_99.7pct/dados.json", "99-7")]
hist_all = json.loads((R / "historico.json").read_text())
rodadas = []
for src, slug in RODADAS:
    d = dados_snapshot(src)
    d["hist"] = [h for h in hist_all if h["pst"] <= d["pst"] + 1e-9]  # trajetória até aquele momento
    rodadas.append(dict(slug=slug, d=d, url=f"/apuracao/{slug}/"))

# ---------------- peças compartilhadas
FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1b1c1e"/><rect x="12" y="34" width="11" height="18" rx="3" fill="#5b8def"/><rect x="27" y="22" width="11" height="30" rx="3" fill="#e35a4f"/><rect x="42" y="12" width="11" height="40" rx="3" fill="#a3a7ad"/></svg>"""

SITE_CSS = """<style id="site-chrome">
.sitebar{background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.sitebar .in{max-width:1160px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.sitebar a{color:var(--ink);text-decoration:none}
.sitebar .brand{font-weight:700;letter-spacing:-.01em;display:flex;align-items:center;gap:8px}
.sitebar .brand svg{width:22px;height:22px}
.sitebar nav.top{display:flex;gap:4px;margin:0 0 0 auto;flex-wrap:wrap}
.sitebar nav.top a{border:0;background:none}
nav.crumbs{display:block;margin:14px auto 0}
nav.crumbs a{border:0;padding:0;background:none;font-size:13px}
.sitebar nav.top a{font-size:13.5px;color:var(--ink2);padding:5px 10px;border-radius:8px}
.sitebar nav.top a[aria-current=page],.sitebar nav.top a:hover{background:var(--soft,var(--line));color:var(--ink)}
.crumbs{max-width:1160px;margin:14px auto 0;padding:0 16px;font-size:13px;color:var(--ink2)}
.crumbs a{color:var(--ink2)}
.banner{max-width:1160px;margin:14px auto 0;padding:0 16px}
.banner div{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--amber,#c98a12);border-radius:10px;padding:10px 14px;font-size:14px}
.banner a{color:var(--ink);font-weight:600}
.rounds{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.rounds a{font-size:12.5px;border:1px solid var(--line);border-radius:999px;padding:2px 10px;color:var(--ink2);text-decoration:none;font-variant-numeric:tabular-nums}
.rounds a[aria-current=page]{background:var(--ink);color:var(--card);border-color:var(--ink)}
footer.site{border-top:1px solid var(--line);margin-top:20px}
footer.site .in{max-width:1160px;margin:0 auto;padding:20px 16px 36px;font-size:13px;color:var(--ink2);display:flex;gap:18px;flex-wrap:wrap;justify-content:space-between}
footer.site a{color:var(--ink2)}
.faq details{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:0 0 8px}
.faq summary{cursor:pointer;font-weight:600;color:var(--ink);font-size:15px}
.faq p{margin:8px 0 0;color:var(--ink2)}
.skip{position:absolute;left:-999px}.skip:focus{left:12px;top:12px;z-index:50;background:var(--card);padding:6px 10px;border-radius:8px}
a:focus-visible,summary:focus-visible{outline:2px solid var(--flavio);outline-offset:2px;border-radius:4px}
</style>"""


FAVICON_INLINE = FAVICON.replace("<svg ", '<svg aria-hidden="true" ')


def sitebar(atual):
    links = [("/", "Resultado final"), ("/ao-vivo/", "Ao vivo"), ("/apuracao/", "Histórico da apuração"), ("/#metodo", "Método e fontes")]
    nav = "".join(f'<a href="{u}"{" aria-current=page" if u == atual else ""}>{t}</a>' for u, t in links)
    return (f'<a class="skip" href="#conteudo">Pular para o conteúdo</a><header class="sitebar"><div class="in">'
            f'<a class="brand" href="/">{FAVICON_INLINE}<span>Eleições 2026</span></a>'
            f'<nav class="top" aria-label="Principal">{nav}</nav></div></header>')


def rodape():
    return (f'<footer class="site"><div class="in"><span>Análise independente de <a href="{AUTOR["url"]}" rel="author">{AUTOR["nome"]}</a> '
            f'com dados públicos do <a href="https://resultados.tse.jus.br/oficial/app/index.html" rel="noopener">TSE</a>. '
            f'Não é um site oficial da Justiça Eleitoral.</span><span><a href="/dados/relatorio.json">Baixar dados (JSON)</a> · '
            f'<a href="/sitemap.xml">Sitemap</a> · <a href="/llms.txt">llms.txt</a></span></div></footer>')


def jsonld(obj):
    return f'<script type="application/ld+json">{json.dumps(obj, ensure_ascii=False)}</script>'


def head(title, desc, path, og_img, extra_ld, published, modified):
    url = BASE + path
    return f"""<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<meta name="author" content="{AUTOR["nome"]}">
<meta name="theme-color" content="#f7f6f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1a1a19" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="alternate" type="text/plain" href="/llms.txt" title="Resumo para LLMs">
<meta property="og:type" content="article">
<meta property="og:site_name" content="{SITE_NAME}">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}{og_img}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{html.escape(title)}">
<meta property="article:published_time" content="{published}">
<meta property="article:modified_time" content="{modified}">
<meta property="article:author" content="{AUTOR["url"]}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{html.escape(title)}">
<meta name="twitter:description" content="{html.escape(desc)}">
<meta name="twitter:image" content="{BASE}{og_img}">
{"".join(jsonld(x) for x in extra_ld)}
{SITE_CSS}"""


PESSOA = {"@type": "Person", "name": AUTOR["nome"], "url": AUTOR["url"]}
FONTE_TSE = {"@type": "Organization", "name": "Tribunal Superior Eleitoral", "url": "https://www.tse.jus.br"}
ELEICAO = {"@type": "Event", "name": "Eleições Gerais 2026 no Brasil — 1º turno", "startDate": "2026-10-04",
           "eventStatus": "https://schema.org/EventScheduled", "location": {"@type": "Country", "name": "Brasil"},
           "organizer": FONTE_TSE}


def montar_pagina(raw_html, title, desc, path, og_img, ld, published, modified, atual, extra_top=""):
    h = raw_html
    h = re.sub(r"<title>.*?</title>", "", h, count=1, flags=re.S)
    h = h.replace('<meta name="viewport" content="width=device-width, initial-scale=1">',
                  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' + head(title, desc, path, og_img, ld, published, modified), 1)
    h = h.replace("<body>", "<body>" + sitebar(atual) + extra_top, 1)
    h = h.replace("<main>", '<main id="conteudo">', 1)
    h = h.replace("</body>", rodape() + "</body>", 1)
    # Chart.js: tira do <head> (bloqueante) e carrega logo antes do script da página
    m = re.search(r'<script src="https://cdnjs[^"]+chart[^"]+"[^>]*></script>\n?', h)
    if m:
        tag = m.group(0).strip()
        h = h.replace(m.group(0), "", 1)
        h = h.replace("<script>\nconst D=", tag + "\n<script>\nconst D=", 1)
    return h


# ---------------- FAQ (visível + FAQPage) — respostas geradas dos dados
def faq():
    pst = fmt(N["pst"], 2)
    qa = [
        ("Quem vai para o 2º turno da eleição presidencial de 2026?",
         f"Flávio Bolsonaro (PL) e Lula (PT). Com {pst}% das seções apuradas pelo TSE, Flávio teve {fmt(cF['p'], 2)}% dos votos válidos e Lula, {fmt(cL['p'], 2)}%. Nenhum candidato passou de 50%."),
        ("Quando é o 2º turno das eleições de 2026?",
         "Domingo, 25 de outubro de 2026, o último domingo de outubro, como define a Constituição. Haverá 2º turno para presidente e para governador nos estados em que ninguém passou de 50% dos votos válidos."),
        ("Em quais estados Flávio Bolsonaro e Lula venceram?",
         f"Flávio venceu em {len(ufF)} unidades da federação ({', '.join(u['uf'] for u in sorted(ufF, key=lambda u: u['uf']))}). Lula venceu em {len(ufL)} ({', '.join(u['uf'] for u in sorted(ufL, key=lambda u: u['uf']))}). A disputa mais apertada foi no {apertado['uf']}, decidida por {fmt(abs(apertado['saldo']), 0)} votos."),
        ("Quais estados terão 2º turno para governador?",
         f"{', '.join(g['uf'] for g in gov2)}" + (f". No {', '.join(g['uf'] for g in govIn)}, o resultado depende do julgamento de uma candidatura sub judice" if govIn else "") +
         f". Os outros {len(govEl)} estados elegeram o governador no 1º turno" + (" (situação oficial do TSE)." if GOV_OFICIAL else " (cálculo pelas regras eleitorais, antes da proclamação oficial).")),
        ("Qual partido elegeu mais deputados federais em 2026?",
         f"O PL, com {plFed} das 513 cadeiras da Câmara, segundo os eleitos marcados pelo TSE" + (f" ({', '.join(rel['depfed']['ufs_pendentes'])} ainda em totalização)" if rel["depfed"].get("ufs_pendentes") else "") + ". Em 2022, o PL tinha eleito 99 deputados."),
        ("Quantas vagas do Senado o PL conquistou em 2026?",
         f"{plSen} das {sum(n for _, n in rel['sen_part'])} vagas em disputa (dois terços do Senado, duas por estado)."),
        ("Qual foi a abstenção no 1º turno de 2026?",
         f"{fmt(N['pa'], 2)}% dos eleitores, cerca de {fmt(N['abstencao'] / 1e6, 1)} milhões de pessoas. Em 2022, a abstenção no 1º turno foi de 20,95%."),
        ("As pesquisas acertaram o 1º turno?",
         f"Para Lula, sim. Para Flávio, a maioria errou: Datafolha, Quaest, PoderData, MDA e AtlasIntel indicavam entre 42,1% e 44,1% dos válidos na véspera, e ele fez {fmt(cF['p'], 1)}%."),
    ]
    vis = '<section id="perguntas" class="faq"><h2>Perguntas frequentes</h2><p class="lead">Respostas curtas, com os números da apuração.</p>' + \
          "".join(f"<details{' open' if i < 2 else ''}><summary>{html.escape(q)}</summary><p>{html.escape(a)}</p></details>" for i, (q, a) in enumerate(qa)) + "</section>"
    ld = {"@context": "https://schema.org", "@type": "FAQPage",
          "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in qa]}
    return vis, ld, qa


# ---------------- servidor local + pré-render
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_GET(self):
        if self.path.startswith("/tse/"):  # mesmo repasse que o vercel.json faz em produção
            import urllib.request
            try:
                body = urllib.request.urlopen("https://resultados.tse.jus.br/oficial/" + self.path[5:], timeout=30).read(); code = 200
            except Exception as e:
                body, code = b"{}", getattr(e, "code", 502)
            self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body); return
        return super().do_GET()


def serve(dirpath, port=8799):
    handler = functools.partial(Quiet, directory=str(dirpath))
    class Srv(socketserver.TCPServer): allow_reuse_address = True
    srv = Srv(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def chrome(*args):
    return subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", *args],
                          capture_output=True, text=True, timeout=90).stdout


def prerender(url):
    dom = chrome("--virtual-time-budget=6000", "--dump-dom", url)
    assert "<html" in dom, f"pré-render vazio: {url}"
    return "<!doctype html>\n" + dom


# ---------------- imagem de compartilhamento (1200×630)
def og_card(titulo, sub, f, l, rodape_txt):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
*{{box-sizing:border-box}}body{{margin:0;width:1200px;height:630px;background:#f7f6f3;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1b1c1e}}
.w{{padding:64px 72px;height:100%;display:flex;flex-direction:column}}
.k{{font-size:26px;color:#55595f;letter-spacing:.02em}}h1{{font-size:62px;line-height:1.05;margin:10px 0 0;letter-spacing:-.02em}}
.row{{display:flex;gap:28px;margin-top:auto}}.c{{flex:1;background:#fff;border:2px solid #e6e5e1;border-radius:22px;padding:24px 30px;border-top:10px solid var(--c)}}
.n{{font-size:28px;color:#55595f}}.p{{font-size:92px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}}
.f{{margin-top:26px;font-size:22px;color:#55595f;display:flex;justify-content:space-between}}</style></head><body><div class="w">
<div class="k">{html.escape(sub)}</div><h1>{html.escape(titulo)}</h1>
<div class="row"><div class="c" style="--c:#2563c9"><div class="n">Flávio Bolsonaro · PL</div><div class="p">{fmt(f, 2)}%</div></div>
<div class="c" style="--c:#d1453b"><div class="n">Lula · PT</div><div class="p">{fmt(l, 2)}%</div></div></div>
<div class="f"><span>{html.escape(rodape_txt)}</span><span>eleicoes2026.vitorpereira.ia.br</span></div></div></body></html>"""


def main():
    if BUILD.exists(): shutil.rmtree(BUILD)
    if OUT.exists(): shutil.rmtree(OUT)
    BUILD.mkdir(); OUT.mkdir()
    srv = serve(BUILD)
    base_url = "http://127.0.0.1:8799"
    publicado = ISO(datetime(2026, 10, 4, 18, 25)); modificado = ISO(LEITURA)
    paginas = []  # (path, lastmod, prioridade)

    # ---- página principal = relatório final
    faq_vis, faq_ld, qa = faq()
    raw = (R / "relatorio" / "relatorio_final.html").read_text()
    raw = raw.replace('<section id="metodo">', faq_vis + '\n<section id="metodo">', 1)
    raw = raw.replace('<a href="#metodo">Método e fontes</a>', '<a href="#perguntas">Perguntas</a><a href="#metodo">Método e fontes</a>', 1)
    titulo = f"Eleições 2026: Flávio {fmt(cF['p'], 1)}% × Lula {fmt(cL['p'], 1)}% no 1º turno"
    desc = (f"Flávio Bolsonaro e Lula vão ao 2º turno em 25/10. Mapa por estado, governadores, Senado, Câmara e Assembleias "
            f"com {fmt(N['pst'], 2)}% das urnas apuradas pelo TSE.")
    ld = [{"@context": "https://schema.org", "@type": "WebSite", "name": SITE_NAME, "url": BASE + "/", "inLanguage": "pt-BR", "publisher": PESSOA},
          {"@context": "https://schema.org", "@type": "NewsArticle", "headline": titulo[:110], "description": desc, "inLanguage": "pt-BR",
           "datePublished": publicado, "dateModified": modificado, "author": PESSOA, "publisher": PESSOA,
           "image": [BASE + "/og/index.png"], "mainEntityOfPage": BASE + "/", "about": ELEICAO,
           "isBasedOn": "https://resultados.tse.jus.br/oficial/app/index.html", "keywords": "eleições 2026, resultado 1º turno, Flávio Bolsonaro, Lula, 2º turno, governadores, Senado, Câmara dos Deputados, TSE"},
          {"@context": "https://schema.org", "@type": "Dataset", "name": "Resultados consolidados do 1º turno das Eleições 2026 (por UF e cargo)",
           "description": "Presidente por UF, governadores, Senado e distribuição de vagas para deputados federais, estaduais e distritais, consolidados a partir dos arquivos públicos de divulgação do TSE.",
           "url": BASE + "/", "creator": PESSOA, "isBasedOn": "https://resultados.tse.jus.br/oficial/app/index.html", "license": "https://creativecommons.org/licenses/by/4.0/",
           "temporalCoverage": "2026-10-04", "spatialCoverage": {"@type": "Country", "name": "Brasil"}, "inLanguage": "pt-BR",
           "distribution": [{"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": BASE + "/dados/relatorio.json"}]},
          faq_ld]
    rounds_nav = "".join(f'<a href="{r["url"]}">{fmt(r["d"]["pst"], 1)}%</a>' for r in rodadas)
    top = (f'<div class="banner"><div>Resultado com <b>{fmt(N["pst"], 2)}%</b> das seções apuradas (TSE, {N["dg"]} {N["ht"]}). '
           f'Veja como a apuração evoluiu durante a noite: <span class="rounds">{rounds_nav}<a href="/apuracao/">todas as leituras →</a></span></div></div>')
    (BUILD / "index.html").write_text(montar_pagina(raw, titulo, desc, "/", "/og/index.png", ld, publicado, modificado, "/", top))
    paginas.append(("/", modificado, "1.0"))

    # ---- uma página por leitura
    tpl = (R / "template.html").read_text()
    for i, r in enumerate(rodadas):
        d = r["d"]; pst = fmt(d["pst"], 1); hora = d["ht"][:5]
        raw = tpl.replace("/*__DATA__*/null", json.dumps(d, ensure_ascii=False))
        raw = raw.replace("<h1>Presidente 2026 · 1º turno — apuração e projeções</h1>", f"<h1>Apuração com {pst}% das urnas: Flávio {fmt(d['f'], 2)}% × Lula {fmt(d['l'], 2)}%</h1>", 1)
        titulo = f"Apuração {pst}%: Flávio × Lula | Eleições 2026"
        mc = d["mc"]
        desc = (f"Leitura parcial do TSE às {hora} de 04/10/2026: Flávio {fmt(d['f'], 2)}%, Lula {fmt(d['l'], 2)}%. "
                f"Projeção do resultado final e chance de cada cenário naquele momento.")
        nav = "".join(f'<a href="{x["url"]}"{" aria-current=page" if x is r else ""}>{fmt(x["d"]["pst"], 1)}%</a>' for x in rodadas)
        top = (f'<nav class="crumbs" aria-label="Trilha"><a href="/">Início</a> › <a href="/apuracao/">Apuração</a> › {pst}%</nav>'
               f'<div class="banner"><div>Esta é uma <b>leitura parcial</b>: o retrato da apuração às {hora}, com {pst}% das urnas. '
               f'<a href="/">Veja o resultado final →</a><span class="rounds">{nav}</span></div></div>')
        path = r["url"]
        ld = [{"@context": "https://schema.org", "@type": "NewsArticle", "headline": titulo[:110], "description": desc, "inLanguage": "pt-BR",
               "datePublished": ISO(datetime.strptime("04/10/2026 " + d["ht"], "%d/%m/%Y %H:%M:%S")), "dateModified": ISO(datetime.strptime("04/10/2026 " + d["ht"], "%d/%m/%Y %H:%M:%S")),
               "author": PESSOA, "publisher": PESSOA, "image": [f"{BASE}/og/apuracao-{r['slug']}.png"], "mainEntityOfPage": BASE + path, "about": ELEICAO},
              {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
                  {"@type": "ListItem", "position": 1, "name": "Início", "item": BASE + "/"},
                  {"@type": "ListItem", "position": 2, "name": "Apuração", "item": BASE + "/apuracao/"},
                  {"@type": "ListItem", "position": 3, "name": f"{pst}% apurado", "item": BASE + path}]}]
        (BUILD / path.strip("/")).mkdir(parents=True, exist_ok=True)
        (BUILD / path.strip("/") / "index.html").write_text(montar_pagina(raw, titulo, desc, path, f"/og/apuracao-{r['slug']}.png", ld, publicado, modificado, "/apuracao/", top))
        paginas.append((path, ISO(datetime.strptime("04/10/2026 " + d["ht"], "%d/%m/%Y %H:%M:%S")), "0.6"))

    # ---- índice da apuração (HTML estático, sem JS)
    linhas = "".join(
        f'<a class="rd" href="{r["url"]}"><span class="t">{r["d"]["ht"][:5]}</span><span class="p">{fmt(r["d"]["pst"], 1)}%<small>apurado</small></span>'
        f'<span class="bar"><i style="width:{r["d"]["f"]}%;background:var(--flavio)"></i><i style="width:{r["d"]["l"]}%;background:var(--lula)"></i></span>'
        f'<span class="v">Flávio {fmt(r["d"]["f"], 2)}% × Lula {fmt(r["d"]["l"], 2)}%<small>projeção final: {fmt(r["d"]["traj"]["mc50"][-1]["f"] if "traj" in r["d"] else r["d"]["scen"][0]["f"], 1)} × {fmt(r["d"]["traj"]["mc50"][-1]["l"] if "traj" in r["d"] else r["d"]["scen"][0]["l"], 1)}</small></span></a>'
        for r in rodadas)
    idx_css = """<style>
.rd{display:grid;grid-template-columns:70px 120px 1fr 260px;gap:16px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 10px;color:var(--ink);text-decoration:none}
.rd:hover{border-color:var(--muted)}.rd .t{color:var(--ink2);font-variant-numeric:tabular-nums}.rd .p{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}
.rd small{display:block;font-size:12px;font-weight:400;color:var(--muted)}.rd .bar{height:12px;border-radius:4px;background:var(--line);display:flex;gap:2px;overflow:hidden}.rd .bar i{display:block;height:100%}
.rd .v{font-size:14px;font-variant-numeric:tabular-nums}.final{border-left:4px solid var(--ink)}
@media (max-width:760px){.rd{grid-template-columns:60px 1fr}.rd .bar,.rd .v{grid-column:1/-1}}</style>"""
    rows_final = (f'<a class="rd final" href="/"><span class="t">{N["ht"][:5]}</span><span class="p">{fmt(N["pst"], 2)}%<small>resultado</small></span>'
                  f'<span class="bar"><i style="width:{cF["p"]}%;background:var(--flavio)"></i><i style="width:{cL["p"]}%;background:var(--lula)"></i></span>'
                  f'<span class="v"><b>Flávio {fmt(cF["p"], 2)}% × Lula {fmt(cL["p"], 2)}%</b><small>relatório final completo →</small></span></a>')
    base_tpl = (R / "relatorio" / "relatorio_final.html").read_text()
    style = re.search(r"<style>.*?</style>", base_tpl, re.S).group(0)
    titulo = "Apuração do 1º turno de 2026, leitura a leitura"
    desc = "Como a apuração de 04/10/2026 evoluiu: cada leitura do TSE com o % de urnas, os votos de Flávio e Lula e a projeção do resultado naquele momento."
    pagina = f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>x</title>{style}{idx_css}</head><body><main>
<header><h1>A apuração do 1º turno, leitura a leitura</h1><p>Flávio começou a noite com mais de 50% porque o Sul e o Centro-Oeste foram apurados mais rápido. Conforme o Nordeste entrou, Lula reduziu a diferença, mas não passou. Cada página abaixo é o painel exatamente como estava naquele momento.</p></header>
<section style="margin-top:22px">{rows_final}{linhas}</section>
<p class="note">As leituras de 24,5% (18:19) e 27,9% (18:23) não têm painel salvo; os números delas aparecem na trajetória de cada página.</p></main></body></html>"""
    ld = [{"@context": "https://schema.org", "@type": "CollectionPage", "name": titulo, "description": desc, "url": BASE + "/apuracao/", "inLanguage": "pt-BR", "author": PESSOA,
           "hasPart": [{"@type": "NewsArticle", "url": BASE + r["url"], "headline": f"Apuração com {fmt(r['d']['pst'], 1)}% das urnas"} for r in rodadas]},
          {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
              {"@type": "ListItem", "position": 1, "name": "Início", "item": BASE + "/"},
              {"@type": "ListItem", "position": 2, "name": "Apuração", "item": BASE + "/apuracao/"}]}]
    (BUILD / "apuracao").mkdir(exist_ok=True)
    (BUILD / "apuracao" / "index.html").write_text(montar_pagina(pagina, titulo, desc, "/apuracao/", "/og/index.png", ld, publicado, modificado, "/apuracao/",
                                                              '<nav class="crumbs" aria-label="Trilha"><a href="/">Início</a> › Apuração</nav>'))
    paginas.append(("/apuracao/", modificado, "0.8"))

    # ---- ao vivo (busca o TSE no navegador; o pré-render guarda a leitura do momento do build)
    mapa = (R / "relatorio" / "dados" / "mapa.json").read_text()
    raw = (R / "template_aovivo.html").read_text().replace("/*__MAPA__*/null", mapa)
    titulo = "Apuração ao vivo das Eleições 2026 | Resultados do TSE"
    desc = "Resultado das Eleições 2026 em tempo real: presidente e governadores por estado, lidos dos arquivos públicos do TSE e atualizados a cada minuto. Pronto para o 2º turno em 25/10."
    ld = [{"@context": "https://schema.org", "@type": "WebPage", "name": titulo, "description": desc, "url": BASE + "/ao-vivo/", "inLanguage": "pt-BR",
           "author": PESSOA, "about": ELEICAO, "isBasedOn": "https://resultados.tse.jus.br/oficial/app/index.html", "dateModified": modificado},
          {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
              {"@type": "ListItem", "position": 1, "name": "Início", "item": BASE + "/"},
              {"@type": "ListItem", "position": 2, "name": "Ao vivo", "item": BASE + "/ao-vivo/"}]}]
    (BUILD / "ao-vivo").mkdir(exist_ok=True)
    (BUILD / "ao-vivo" / "index.html").write_text(montar_pagina(raw, titulo, desc, "/ao-vivo/", "/og/ao-vivo.png", ld, publicado, modificado, "/ao-vivo/",
                                                             '<nav class="crumbs" aria-label="Trilha"><a href="/">Início</a> › Ao vivo</nav>'))
    paginas.append(("/ao-vivo/", modificado, "0.9"))

    # ---- 404
    (BUILD / "404.html").write_text(montar_pagina(f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>x</title>{style}</head><body><main><header><h1>Página não encontrada</h1><p><a href="/">Voltar ao resultado do 1º turno</a> · <a href="/apuracao/">Ver a apuração</a></p></header></main></body></html>""",
                                                  "Página não encontrada · Eleições 2026", "Página não encontrada.", "/404.html", "/og/index.png", [], publicado, modificado, ""))

    # ---- pré-render de todas as páginas
    for p in ["index.html", "ao-vivo/index.html", "apuracao/index.html", "404.html"] + [r["url"].strip("/") + "/index.html" for r in rodadas]:
        url = base_url + "/" + p.replace("index.html", "")
        dom = prerender(url)
        # o mapa já está desenhado no HTML: tira os contornos duplicados dos dados embutidos
        m = re.search(r"const D=(\{.*?\});\n", dom, re.S)
        if m and '"mapa"' in m.group(1):
            d = json.loads(m.group(1)); d.pop("mapa", None)
            dom = dom[:m.start(1)] + json.dumps(d, ensure_ascii=False) + dom[m.end(1):]
        dest = OUT / p; dest.parent.mkdir(parents=True, exist_ok=True); dest.write_text(dom)
    (OUT / "404.html").write_text((OUT / "404.html").read_text().replace('<meta name="robots" content="index,follow', '<meta name="robots" content="noindex,follow', 1))

    # ---- imagens OG
    (BUILD / "og").mkdir(exist_ok=True); (OUT / "og").mkdir(exist_ok=True)
    cards = [("index", "Resultado do 1º turno", f"Eleições 2026 · {fmt(N['pst'], 2)}% apurado (TSE)", cF["p"], cL["p"], "2º turno em 25 de outubro")]
    cards += [("ao-vivo", "Apuração ao vivo", "Eleições 2026 · dados do TSE a cada minuto", cF["p"], cL["p"], "Presidente e governadores por estado")]
    cards += [(f"apuracao-{r['slug']}", f"Apuração com {fmt(r['d']['pst'], 1)}% das urnas", f"Eleições 2026 · 04/10 às {r['d']['ht'][:5]}", r["d"]["f"], r["d"]["l"], "Leitura parcial do TSE") for r in rodadas]
    for nome, t, s, f, l, rp in cards:
        (BUILD / "og" / f"{nome}.html").write_text(og_card(t, s, f, l, rp))
        chrome("--window-size=1200,630", f"--screenshot={OUT / 'og' / (nome + '.png')}", f"{base_url}/og/{nome}.html")
    (BUILD / "og" / "touch.html").write_text(f'<!doctype html><html><body style="margin:0">{FAVICON.replace("<svg ", "<svg width=180 height=180 ")}</body></html>')
    chrome("--window-size=180,180", f"--screenshot={OUT / 'apple-touch-icon.png'}", f"{base_url}/og/touch.html")
    srv.shutdown()

    # ---- arquivos estáticos
    (OUT / "favicon.svg").write_text(FAVICON)
    (OUT / "dados").mkdir(); shutil.copy(R / "relatorio" / "relatorio.json", OUT / "dados" / "relatorio.json")
    (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\n# Buscadores e assistentes de IA são bem-vindos\nUser-agent: GPTBot\nAllow: /\nUser-agent: OAI-SearchBot\nAllow: /\nUser-agent: ChatGPT-User\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\nUser-agent: Claude-User\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\nUser-agent: Google-Extended\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n")
    (OUT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
                                     "".join(f"  <url><loc>{BASE}{p}</loc><lastmod>{lm}</lastmod><priority>{pr}</priority></url>\n" for p, lm, pr in paginas) + "</urlset>\n")
    gl = "\n".join(f"- {g['uf']}: {g['a']['nome']} ({g['a']['sg']}) × {g['b']['nome']} ({g['b']['sg']})" for g in gov2 + govIn)
    (OUT / "llms.txt").write_text(f"""# Eleições 2026 · Resultado do 1º turno (Brasil, 04/10/2026)

> Análise independente de {AUTOR['nome']} com dados públicos do TSE ({fmt(N['pst'], 2)}% das seções apuradas, leitura de {N['dg']} {N['ht']}). {"Governadores e Senado: situação oficial do TSE." if GOV_OFICIAL and SEN_OFICIAL else "Os eleitos ainda não tinham sido proclamados oficialmente; governador e Senado foram calculados pelas regras eleitorais."}{" Deputados ainda em totalização em: " + ", ".join(DEP_PENDENTES) + "." if DEP_PENDENTES else ""}

## Presidente
- 2º turno em 25/10/2026: Flávio Bolsonaro (PL) {fmt(cF['p'], 2)}% × Lula (PT) {fmt(cL['p'], 2)}% dos votos válidos.
- Votos: Flávio {cF['votos']:,} · Lula {cL['votos']:,}.
- Flávio venceu em {len(ufF)} UFs, Lula em {len(ufL)}. Disputa mais apertada: {apertado['uf']} ({fmt(abs(apertado['saldo']), 0)} votos).
- Abstenção {fmt(N['pa'], 2)}% · brancos {fmt(N['pb'], 2)}% · nulos {fmt(N['pn'], 2)}%.
- Comparação com o 1º turno de 2022: Lula 48,43% × Jair Bolsonaro 43,20%.

## Governadores
- {len(govEl)} eleitos no 1º turno; 2º turno ou indefinido em:
{gl}

## Congresso
- Câmara (513): PL {plFed} cadeiras (99 em 2022). Distribuição de vagas publicada pelo TSE.
- Senado (54 vagas): PL {plSen}.

## Páginas
- [Resultado final completo]({BASE}/): mapa por estado, governadores, Senado, Câmara, Assembleias, perguntas frequentes
- [Apuração ao vivo]({BASE}/ao-vivo/): presidente e governadores, lidos do TSE a cada minuto
- [Apuração leitura a leitura]({BASE}/apuracao/)
""" + "".join(f"- [Apuração com {fmt(r['d']['pst'], 1)}% das urnas]({BASE}{r['url']})\n" for r in rodadas) +
f"- [Dados consolidados em JSON]({BASE}/dados/relatorio.json)\n", encoding="utf-8")
    (OUT / "vercel.json").write_text(json.dumps({
        "cleanUrls": True, "trailingSlash": True,
        "rewrites": [{"source": "/tse/:path*", "destination": "https://resultados.tse.jus.br/oficial/:path*"}],
        "headers": [{"source": "/(.*)", "headers": [{"key": "X-Content-Type-Options", "value": "nosniff"}, {"key": "Referrer-Policy", "value": "strict-origin-when-cross-origin"}]},
                    {"source": "/og/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=86400"}]},
                    {"source": "/tse/(.*)", "headers": [{"key": "Cache-Control", "value": "public, s-maxage=20, stale-while-revalidate=40"}]},
                    {"source": "/ao-vivo/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=0, must-revalidate"}]}]}, indent=1))
    shutil.rmtree(BUILD)
    tot = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"site/ ok · {len(list(OUT.rglob('*.html')))} páginas · {len(list((OUT / 'og').glob('*.png')))} imagens OG · {tot // 1024} KB")


if __name__ == "__main__":
    main()
