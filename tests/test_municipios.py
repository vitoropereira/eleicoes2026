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
            s = soma.setdefault(uf, [0] * 5 + [[0] * len(linha[5]), 0])
            for i in range(5): s[i] += linha[i]
            s[5] = [a + b for a, b in zip(s[5], linha[5])]
            s[6] += linha[6]
        # exterior soma na UF "ZZ" (não tem código IBGE, vem em ex)
        s = [0] * 5 + [[0] * len(p["br"][5]), 0]
        for linha in p["ex"].values():
            for i in range(5): s[i] += linha[i]
            s[5] = [a + b for a, b in zip(s[5], linha[5])]
            s[6] += linha[6]
        soma["ZZ"] = s
        self.assertEqual(set(soma), set(p["uf"]))
        for uf, tot in p["uf"].items():
            s = soma[uf]
            self.assertEqual(s[:5], tot[:5], f"{uf}: eleitores/comparecimento/validos/brancos/nulos")
            self.assertEqual(s[5], tot[5], f"{uf}: votos por candidato")
            self.assertEqual(s[6], tot[6], f"{uf}: vansj")

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

    def test_presidente_identidades(self):
        p = t1("presidente")
        linhas = [p["br"]] + list(p["uf"].values()) + list(p["mu"].values()) + list(p["ex"].values())
        for l in linhas:
            self.assertEqual(len(l), 7)
            self.assertEqual(l[2] + l[3] + l[4] + l[6], l[1])  # validos + brancos + nulos (+ sub judice) = comparecimento
            self.assertEqual(sum(l[5]), l[2])

    def test_sub_judice_governador_senador(self):
        meta = t1("meta")["cand"]
        for cargo in ("governador", "senador"):
            d = t1(cargo)
            linhas = [(f"uf {u}", u, l) for u, l in d["uf"].items()] + [(f"mu {c}", t1("meta")["mun"][c][1], l) for c, l in d["mu"].items()]
            for rot, uf, l in linhas:
                sj = [c.get("sj", False) for c in meta[cargo][uf]]
                self.assertEqual(len(l), 7, rot)
                k = 2 if cargo == "senador" else 1  # 2 vagas em 2026: cada eleitor vota duas vezes
                self.assertEqual(l[2] + l[3] + l[4] + l[6], k * l[1], f"{cargo} {rot}: validos+brancos+nulos+vansj != {k} x comparecimento")
                if cargo == "governador":  # senador: o eleitor vota em 2, a soma dos candidatos passa dos válidos
                    self.assertEqual(sum(v for v, x in zip(l[5], sj) if not x), l[2], f"{rot}")
                    self.assertEqual(sum(v for v, x in zip(l[5], sj) if x), l[6], f"{rot}: votos sj != vansj")
        # casos conhecidos
        g = meta["governador"]
        self.assertTrue([c for c in g["RJ"] if c["nome"] == "Garotinho"][0].get("sj"))
        self.assertTrue(any(c.get("sj") for c in g["DF"]))
        self.assertFalse(any(c.get("sj") for c in meta["presidente"]))

    def test_uf_gov_sen_batem_com_relatorio(self):
        rel = json.loads((R / "relatorio" / "relatorio.json").read_text())
        for g in rel["gov"]:
            linha = t1("governador")["uf"][g["uf"]]
            self.assertIn(g["a"]["votos"], linha[5], g["uf"])
            self.assertIn(g["b"]["votos"], linha[5], g["uf"])
            self.assertEqual(linha[5].index(g["a"]["votos"]), 0, f"{g['uf']}: líder deve ser o 1º do meta")
        for s in rel["sen"]:
            linha = t1("senador")["uf"][s["uf"]]
            for e in s["eleitos"]:
                self.assertIn(e["votos"], linha[5], s["uf"])

    def test_municipio_sem_geometria_documentado(self):
        topo = carrega(GEO / "municipios.topo.json")
        cods = {g["properties"]["codarea"] for g in topo["objects"]["BRMU"]["geometries"]}
        extra = set(t1("presidente")["mu"]) - cods
        self.assertEqual(extra, {"5101837"}, "no TSE e sem geometria no IBGE (MT, município novo): fica em mu, não desenha")

    def test_serie_ordenada_e_termina_em_100(self):
        s = t1("serie")
        psts = [x["pst"] for x in s]
        self.assertEqual(psts, sorted(psts))
        self.assertEqual(psts[-1], 100)
        self.assertIsNotNone(s[-1]["uf"])
        self.assertTrue(all(x["d"] in ("04/10", "05/10") for x in s))
        self.assertEqual(s[-1]["d"], "05/10")

    def test_feed(self):
        f = t1("feed")
        self.assertTrue(0 < len(f) <= 60)
        for e in f: self.assertTrue({"h", "d", "t", "txt"} <= set(e))
        self.assertEqual((f[0]["h"], f[0]["d"], f[0]["t"]), ("12:51", "05/10", "apuracao"))
        noite = [e for e in f if e["t"] == "apuracao"][1:]
        self.assertEqual(len(noite), len(t1("serie")) - 1, "nenhuma leitura da apuração pode ser cortada")
        self.assertTrue(all(e["d"] == "04/10" for e in noite))
        bloco = [e for e in f[1:] if e["t"] != "apuracao"]
        self.assertTrue(all(e["h"] is None and e["d"] == "05/10" for e in bloco))
        self.assertEqual([e["t"] for e in f[1:1 + len(bloco)]].count("apuracao"), 0, "ordem: final, bloco eleito/2turno, noite")
        hs = [e["h"] for e in noite]; self.assertEqual(hs, sorted(hs, reverse=True))

    def test_tamanho_dos_arquivos(self):
        for p in sorted(T1.glob("*.json")):
            kb = p.stat().st_size / 1024
            print(f"  {p.name}: {kb:.0f} KB")
            self.assertLessEqual(p.stat().st_size, 2.5 * 1024 * 1024, f"{p.name} tem {kb:.0f} KB (> 2,5 MB)")


if __name__ == "__main__":
    unittest.main()
