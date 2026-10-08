"""Testes dos dados por partido (municipios/geo/t1/partidos.json, cadeiras.json). Só lêem arquivos versionados."""
import json, unittest
from pathlib import Path

R = Path(__file__).resolve().parent.parent
T1 = R / "municipios" / "geo" / "t1"
_c = {}


def t1(nome):
    if nome not in _c: _c[nome] = json.loads((T1 / f"{nome}.json").read_text())
    return _c[nome]


def junta():  # um arquivo por cargo (partidos-<cargo>.json) ou o partidos.json único
    if (T1 / "partidos.json").exists(): return t1("partidos")
    out = {"cargos": {}}
    for c in ("presidente", "governador", "senador", "depfed", "depest"):
        d = t1(f"partidos-{c}")
        out["partidos"], out["federacoes"] = d["partidos"], d["federacoes"]
        out["cargos"][c] = {k: d[k] for k in ("br", "uf", "mu")}
    return out


P = junta()
IDX = {p: i for i, p in enumerate(P["partidos"])}
CARGOS = ("presidente", "governador", "senador", "depfed", "depest")


def pega(arr, sg):
    i = IDX[sg]
    return arr[i] if i < len(arr) else 0  # zeros à direita são cortados


def mu_pega(m, sg):  # municípios: esparso {"i":[...],"v":[...]}
    return dict(zip(m["i"], m["v"])).get(IDX[sg], 0)


class TestPartidos(unittest.TestCase):
    def test_soma_por_uf_fecha_com_validos_e_sj(self):
        for cargo in CARGOS:
            ref = t1(cargo)["uf"]
            for uf, (v, nom, leg, sj) in P["cargos"][cargo]["uf"].items():
                with self.subTest(cargo=cargo, uf=uf):
                    self.assertEqual(sum(nom) + sum(leg), v)
                    if cargo in ("depfed", "depest"):
                        self.assertEqual(v, ref[uf][0])
                    else:
                        self.assertEqual(v, ref[uf][2])
                        self.assertEqual(sj, ref[uf][6])
                        self.assertEqual(leg, [])
                    self.assertEqual(len(P["cargos"][cargo]["uf"]), 28 if cargo == "presidente" else 27)

    def test_br_e_soma_das_ufs(self):
        for cargo in CARGOS:
            c = P["cargos"][cargo]
            with self.subTest(cargo=cargo):
                self.assertEqual(c["br"][0], sum(r[0] for r in c["uf"].values()))
                self.assertEqual(sum(c["br"][1]) + sum(c["br"][2]), c["br"][0])

    def test_presidente_br_pl_e_pt(self):
        nom = P["cargos"]["presidente"]["br"][1]
        self.assertEqual(pega(nom, "PL"), 56104503)
        self.assertEqual(pega(nom, "PT"), 53879538)

    def test_municipios_somam_a_uf_pl_e_pt(self):
        for cargo in ("depfed", "depest"):
            c = P["cargos"][cargo]
            for sg in ("PL", "PT"):
                for k in (1, 2):  # 1 = nominal, 2 = legenda
                    por_uf = {}
                    for cd, row in c["mu"].items():
                        uf = t1("meta")["mun"][cd][1]
                        por_uf[uf] = por_uf.get(uf, 0) + mu_pega(row[k], sg)
                    for uf, row in c["uf"].items():
                        with self.subTest(cargo=cargo, sg=sg, k=k, uf=uf):
                            self.assertEqual(por_uf.get(uf, 0), pega(row[k], sg))

    def test_federacoes(self):
        self.assertEqual(sorted(P["federacoes"]["FE BRASIL"]), ["PCDOB", "PT", "PV"])
        for ms in P["federacoes"].values():
            for m in ms: self.assertIn(m, IDX)

    def test_tamanho_dos_arquivos(self):
        for p in T1.glob("partidos*.json"): self.assertLessEqual(p.stat().st_size, 3 * 1024 * 1024, p.name)


class TestCadeiras(unittest.TestCase):
    def test_totais(self):
        c = t1("cadeiras")
        self.assertEqual(sum(c["depfed"]["br"].values()), 513)
        self.assertEqual(sum(c["senador"]["br"].values()), 54)
        self.assertEqual(c["depfed"]["br"]["PL"], 121)
        for cargo in ("depfed", "depest", "senador"):
            self.assertEqual(sum(sum(m.values()) for m in c[cargo]["uf"].values()), sum(c[cargo]["br"].values()))

    def test_bate_com_relatorio(self):
        rel = json.loads((R / "relatorio" / "relatorio.json").read_text())
        c = t1("cadeiras")
        for cargo, rk in (("depfed", rel["depfed"]["por_partido"]), ("depest", rel["depest"]["por_partido"]), ("senador", rel["sen_part"])):
            with self.subTest(cargo=cargo):
                self.assertEqual(dict(rk), c[cargo]["br"])
