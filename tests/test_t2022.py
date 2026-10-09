"""Testes do dataset de 2022 (municipios/geo/t2022/). Só lêem arquivos versionados."""
import json, unittest
from pathlib import Path

R = Path(__file__).resolve().parent.parent
T22 = R / "municipios" / "geo" / "t2022"
_c = {}


def t22(nome):
    if nome not in _c: _c[nome] = json.loads((T22 / f"{nome}.json").read_text())
    return _c[nome]


def cand_votos(turno, nome):
    ordem = [c["nome"] for c in t22("meta")["cand"][f"presidente-{turno}t"]]
    return ordem.index(nome)


class TestPresidente2022(unittest.TestCase):
    def test_totais_oficiais_1t(self):
        d, i = t22("presidente-1t"), cand_votos(1, "Lula")
        self.assertEqual(d["br"][5][i], 57_259_504)
        self.assertEqual(d["br"][5][cand_votos(1, "Jair Bolsonaro")], 51_072_345)

    def test_totais_oficiais_2t(self):
        d = t22("presidente-2t")
        self.assertEqual(d["br"][5][cand_votos(2, "Lula")], 60_345_999)
        self.assertEqual(d["br"][5][cand_votos(2, "Jair Bolsonaro")], 58_206_354)

    def test_municipios_somam_uf_e_uf_soma_br(self):
        meta = t22("meta")
        for t in ("1t", "2t"):
            d = t22(f"presidente-{t}")
            for uf in {u for _, u in meta["mun"].values()}:
                soma = [0] * 7; soma[5] = [0] * len(d["br"][5])
                for cdi, (_, u) in meta["mun"].items():
                    if u != uf: continue
                    r = d["mu"][cdi]
                    for i in (0, 1, 2, 3, 4, 6): soma[i] += r[i]
                    soma[5] = [a + b for a, b in zip(soma[5], r[5])]
                self.assertEqual(soma, d["uf"][uf], f"{t} {uf}")
            ex = [0] * len(d["br"][5])
            for r in d["ex"].values(): ex = [a + b for a, b in zip(ex, r[5])]
            self.assertEqual(ex, d["uf"]["ZZ"][5])
            self.assertEqual([sum(d["uf"][u][i] for u in d["uf"]) for i in (0, 1, 2, 3, 4, 6)],
                             [d["br"][i] for i in (0, 1, 2, 3, 4, 6)])

    def test_linha_fecha_comparecimento(self):
        for t in ("1t", "2t"):
            for r in t22(f"presidente-{t}")["mu"].values():
                self.assertEqual(r[2] + r[3] + r[4] + r[6], r[1])
                self.assertEqual(sum(r[5]), r[2])

    def test_chave_ibge_7_digitos(self):
        meta = t22("meta")
        self.assertEqual(len(meta["mun"]), 5570)
        for k in meta["mun"]: self.assertRegex(k, r"^\d{7}$")
        self.assertEqual(set(meta["mun"]), set(t22("presidente-1t")["mu"]))


class TestCadeiras2022(unittest.TestCase):
    def test_depfed_513(self):
        self.assertEqual(sum(t22("cadeiras")["depfed"]["br"].values()), 513)

    def test_pl_depfed(self):
        # 98 = resultado vigente no TSE (CSV de dados abertos). A noite da eleição deu PL 99; a recontagem das
        # sobras (decisão do STF, ADI 7228/7263; TSE refez 7 cadeiras em 2024) tirou 1 do PL (AP: Paulo Lemos, PSOL).
        self.assertEqual(t22("cadeiras")["depfed"]["br"]["PL"], 98)

    def test_demais_cargos(self):
        c = t22("cadeiras")
        self.assertEqual(sum(c["senador"]["br"].values()), 27)
        self.assertEqual(sum(c["depest"]["br"].values()), 1059)


class TestPartidos2022(unittest.TestCase):
    def test_nominal_mais_legenda_fecha_validos(self):
        for c in ("presidente", "governador", "senador", "depfed", "depest"):
            d = t22(f"partidos-{c}")
            for uf, (v, nom, leg, sj) in d["uf"].items():
                self.assertEqual(sum(nom) + sum(leg), v, f"{c} {uf}")

    def test_municipios_somam_uf(self):
        meta = t22("meta")["mun"]
        d = t22("partidos-depfed")
        acc = {}
        for cdi, (v, nom, leg, sj) in d["mu"].items():
            a = acc.setdefault(meta[cdi][1], [0, 0])
            a[0] += v; a[1] += sum(nom["v"]) + sum(leg["v"])
        for uf, (v, _, _, _) in d["uf"].items():
            self.assertEqual(acc[uf], [v, v], uf)

    def test_arquivos_abaixo_de_2_5_mb(self):
        for p in T22.glob("*.json"): self.assertLessEqual(p.stat().st_size, int(2.5 * 1024 * 1024), p.name)


if __name__ == "__main__":
    unittest.main()
