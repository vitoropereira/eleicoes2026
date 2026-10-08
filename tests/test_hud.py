"""HUD da apuração (/ao-vivo/): regras de brand, cor de partido, scripts locais e cache na Vercel."""
import colorsys, hashlib, re, sys, unittest
from pathlib import Path

R = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(R))
import build_site as B

TEMPLATE = R / "template_hud.html"
HUD = R / "hud"
PARTIDOS = HUD / "partidos.js"
HEX = re.compile(r"(?<![\w&])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")


def matiz(h):
    h = h.lstrip("#")
    if len(h) == 3: h = "".join(c * 2 for c in h)
    return colorsys.rgb_to_hsv(*(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)))[0] * 360


class Template(unittest.TestCase):
    def test_um_marcador_da_brand(self):
        self.assertEqual(TEMPLATE.read_text().count("/*__BRAND__*/"), 1)

    def test_so_scripts_locais(self):
        h = TEMPLATE.read_text()
        srcs = re.findall(r"<script[^>]*\bsrc=\"([^\"]+)\"", h)
        self.assertTrue(srcs, "o template precisa carregar o app")
        for s in srcs:
            self.assertTrue(s.startswith("/"), s)
            self.assertNotIn("//", s)
        self.assertNotRegex(h, r"<script[^>]*src=\"https?://")
        for js in HUD.glob("*.js"):
            for imp in re.findall(r"\bfrom\s+\"([^\"]+)\"|import\(\s*\"([^\"]+)\"", js.read_text()):
                alvo = imp[0] or imp[1]
                self.assertTrue(alvo.startswith(("/", "./")), f"{js.name}: import externo {alvo}")
                self.assertNotIn("://", alvo, js.name)

    def test_vendor_presente_e_conferido(self):
        v = R / "assets" / "vendor" / "preact-htm.module.js"
        self.assertTrue(v.exists())
        leia = (R / "assets" / "vendor" / "README.md").read_text()
        self.assertIn(hashlib.sha256(v.read_bytes()).hexdigest(), leia, "SHA-256 do vendor diverge do README")
        self.assertIn("htm@3/preact/standalone.module.js", leia)
        for lic in ("LICENSE-htm.txt", "LICENSE-preact.txt"):
            self.assertTrue((R / "assets" / "vendor" / lic).exists(), lic)

    def test_template_antigo_arquivado(self):
        self.assertFalse((R / "template_aovivo.html").exists())
        self.assertTrue((R / "docs" / "old" / "template_aovivo.html").exists())


class CoresDePartido(unittest.TestCase):
    def test_hex_so_em_partidos_js(self):
        fontes = [TEMPLATE] + [p for p in HUD.glob("*.js") if p != PARTIDOS]
        for p in fontes:
            self.assertEqual(HEX.findall(p.read_text()), [], f"{p.name}: cor literal fora de hud/partidos.js")

    def test_partidos_longe_do_ciano(self):
        ciano = matiz("#24C8FF")
        cores = HEX.findall(PARTIDOS.read_text())
        self.assertGreater(len(cores), 15)
        for c in cores:
            d = abs(matiz(c) - ciano); d = min(d, 360 - d)
            self.assertGreaterEqual(d, 25, f"{c} está a {d:.1f}° do ciano da brand")

    def test_pl_e_pt_usam_tokens_da_brand(self):
        js = PARTIDOS.read_text()
        self.assertIn('PL: "--flavio"', js)
        self.assertIn('PT: "--lula"', js)
        self.assertIn("--outros", js)


class Build(unittest.TestCase):
    def test_cache_de_geo_e_hud(self):
        hs = {h["source"]: h["headers"] for h in B.VERCEL["headers"]}
        for src in ("/geo/(.*)", "/hud/(.*)"):
            self.assertIn(src, hs)
            self.assertIn({"key": "Cache-Control", "value": "public, max-age=3600"}, hs[src])

    def test_resumo_para_buscadores(self):
        r = B.resumo_hud()
        self.assertIn("Mapa da apuração por município", r)
        self.assertIn("<table", r)
        self.assertIn("Flávio", r)

    def test_pagina_sem_moldura_nao_ganha_sitebar(self):
        raw = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>x</title></head><body><div id="hud"></div></body></html>'
        h = B.montar_pagina(raw, "t", "d", "/ao-vivo/", "/og/x.png", [], "a", "b", "/ao-vivo/", moldura=False)
        self.assertNotIn('class="sitebar"', h)
        self.assertIn('<link rel="canonical" href="https://eleicoes2026.vitorpereira.ia.br/ao-vivo/">', h)

    @unittest.skipUnless((R / "site" / "ao-vivo" / "index.html").exists(), "rode python3 build_site.py antes")
    def test_ao_vivo_publicado(self):
        h = (R / "site" / "ao-vivo" / "index.html").read_text()
        if 'src="/hud/app.js"' not in h:
            self.skipTest("site/ gerado antes do HUD: rode python3 build_site.py")
        self.assertIn("<title>Mapa da apuração por município", h)
        self.assertIn('src="/hud/app.js"', h)


if __name__ == "__main__":
    unittest.main()
