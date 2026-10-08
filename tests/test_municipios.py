"""Testes dos dados por município (municipios/geo/, versionado). Não dependem do bruto de 1,5 GB."""
import json, unittest
from pathlib import Path

R = Path(__file__).resolve().parent.parent
GEO = R / "municipios" / "geo"
T1 = GEO / "t1"
_c = {}


def carrega(p):
    if p not in _c: _c[p] = json.loads(p.read_text())
    return _c[p]


def t1(nome): return carrega(T1 / f"{nome}.json")


class TestMunicipios(unittest.TestCase):
    def test_todo_codarea_da_malha_tem_presidente(self):
        topo = carrega(GEO / "municipios.topo.json")
        geoms = topo["objects"]["BRMU"]["geometries"]
        cods = [g["properties"]["codarea"] for g in geoms]
        self.assertEqual(len(cods), 5570)
        mu = t1("presidente")["mu"]
        ausentes = [c for c in cods if c not in mu]
        self.assertFalse(ausentes, f"{len(ausentes)} codarea sem entrada em presidente.mu: {ausentes}")

    def test_soma_dos_municipios_igual_ao_total_da_uf(self):
        p = t1("presidente")
        meta = t1("meta")["mun"]
        soma = {}
        for cod, linha in p["mu"].items():
            uf = meta[cod][1]
            s = soma.setdefault(uf, [0] * 4 + [[0] * len(linha[5])])
            for i in range(4): s[i] += linha[i]
            s[4] = [a + b for a, b in zip(s[4], linha[5])]
        # exterior soma na UF "ZZ" (não tem código IBGE, vem em ex)
        s = [0] * 4 + [[0] * len(p["br"][5])]
        for linha in p["ex"].values():
            for i in range(4): s[i] += linha[i]
            s[4] = [a + b for a, b in zip(s[4], linha[5])]
        soma["ZZ"] = s
        self.assertEqual(set(soma), set(p["uf"]))
        for uf, tot in p["uf"].items():
            s = soma[uf]
            self.assertEqual(s[:4], tot[:4], f"{uf}: eleitores/comparecimento/validos/brancos")
            self.assertEqual(s[4], tot[5], f"{uf}: votos por candidato")

    def test_votos_nacionais_batem_com_o_relatorio(self):
        rel = json.loads((R / "relatorio" / "relatorio.json").read_text())
        nac = {c["nome"]: c["votos"] for c in rel["nac"]["cand"]}
        self.assertEqual(nac["Flavio Bolsonaro"], 56104503)
        self.assertEqual(nac["Lula"], 53879538)
        p = t1("presidente")
        cand = t1("meta")["cand"]["presidente"]
        votos = {c["nome"]: v for c, v in zip(cand, p["br"][5])}
        self.assertEqual(votos["Flávio Bolsonaro"], nac["Flavio Bolsonaro"])
        self.assertEqual(votos["Lula"], nac["Lula"])
        # e a soma de todos os municípios + exterior fecha no Brasil
        tot = sum(l[5][0] for l in p["mu"].values()) + sum(l[5][0] for l in p["ex"].values())
        self.assertEqual(tot, p["br"][5][0])

    def test_ordem_dos_candidatos(self):
        p = t1("presidente")
        cand = t1("meta")["cand"]["presidente"]
        self.assertEqual(len(cand), len(p["br"][5]))
        for linha in list(p["uf"].values()) + [p["br"]]:
            self.assertEqual(len(linha[5]), len(cand))
        votos = p["br"][5]
        self.assertEqual(votos, sorted(votos, reverse=True), "meta.cand.presidente deve ser por votos nacionais desc")
        self.assertEqual([c["nome"] for c in cand[:2]], ["Flávio Bolsonaro", "Lula"])

    def test_governador_e_senador_seguem_a_ordem_do_meta(self):
        meta = t1("meta")["cand"]
        for cargo in ("governador", "senador"):
            d = t1(cargo)
            for uf, linha in d["uf"].items():
                self.assertEqual(len(linha[5]), len(meta[cargo][uf]), f"{cargo} {uf}")
            for cod, linha in d["mu"].items():
                uf = t1("meta")["mun"][cod][1]
                self.assertEqual(len(linha[5]), len(meta[cargo][uf]), f"{cargo} {cod}")

    def test_serie_ordenada_e_termina_em_100(self):
        s = t1("serie")
        psts = [x["pst"] for x in s]
        self.assertEqual(psts, sorted(psts))
        self.assertEqual(psts[-1], 100)
        self.assertIsNotNone(s[-1]["uf"])

    def test_feed(self):
        f = t1("feed")
        self.assertTrue(0 < len(f) <= 60)
        for e in f: self.assertTrue({"h", "t", "txt"} <= set(e))

    def test_tamanho_dos_arquivos(self):
        for p in sorted(T1.glob("*.json")):
            kb = p.stat().st_size / 1024
            print(f"  {p.name}: {kb:.0f} KB")
            self.assertLessEqual(p.stat().st_size, 2.5 * 1024 * 1024, f"{p.name} tem {kb:.0f} KB (> 2,5 MB)")


if __name__ == "__main__":
    unittest.main()
