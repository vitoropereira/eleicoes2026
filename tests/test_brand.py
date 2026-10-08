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
