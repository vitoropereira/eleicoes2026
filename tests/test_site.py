import sys, unittest
from pathlib import Path

R = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(R))
import brand
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
            self.assertIn(brand.CSS, h, p)
            self.assertNotIn("eyJhbGci", h, p)
            self.assertNotIn("sbp_", h, p)
        self.assertFalse(any(self.SITE.rglob(".env*")))


if __name__ == "__main__":
    unittest.main()
