import json, unittest
from pathlib import Path

R = Path(__file__).resolve().parent.parent / "relatorio"


class SenadoPct(unittest.TestCase):
    """Senado: % = votos / (válidos + anulados sub judice), como o TSE (e como o governador oficial)."""

    @classmethod
    def setUpClass(cls):
        cls.rel = json.load(open(R / "relatorio.json"))

    def bruto(self, uf):
        d = json.load(open(R / "dados" / f"{uf.lower()}-c0005.json"))
        return int(d["v"]["vv"]) + int(d["v"]["vansj"])

    def test_p_dos_eleitos_e_do_proximo_sobre_validos_mais_sj(self):
        for s in self.rel["sen"]:
            den = self.bruto(s["uf"])
            for e in s["eleitos"] + [s["proximo"]]:
                self.assertEqual(e["p"], round(100 * e["votos"] / den, 2), f'{s["uf"]} {e["nome"]}')

    def test_ac_bittar_25_59(self):
        ac = next(s for s in self.rel["sen"] if s["uf"] == "AC")
        bittar = next(e for e in ac["eleitos"] if "Bittar" in e["nome"])
        self.assertEqual(bittar["p"], 25.59)


if __name__ == "__main__":
    unittest.main()
