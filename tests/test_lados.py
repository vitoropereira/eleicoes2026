"""Testes da classificação dos partidos por lado (analise/lados-2026.json e lados-2022.json). Só lêem arquivos versionados."""
import json, re, unittest
from pathlib import Path

R = Path(__file__).resolve().parent.parent
T1 = R / "municipios" / "geo" / "t1"
AN = R / "analise"
UFS = {"AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
       "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"}
LADOS = {"L", "F", "C"}
DATA = re.compile(r"^\d{2}/\d{2}/\d{4}$")
TIPOS = {"nota", "coligacao", "imprensa", "declaracao"}


def siglas_e_federacoes():
    siglas, feds = set(), {}
    for f in sorted(T1.glob("partidos-*.json")):
        d = json.loads(f.read_text())
        siglas |= set(d["partidos"])
        feds.update(d.get("federacoes", {}))
    return siglas, feds


SIGLAS, FEDS = siglas_e_federacoes()
L26 = json.loads((AN / "lados-2026.json").read_text())
L22 = json.loads((AN / "lados-2022.json").read_text())


class Comum:
    doc = None

    def test_cabecalho(self):
        self.assertRegex(self.doc["posicao_em"], DATA)

    def test_lado_valido(self):
        for sg, p in self.doc["partidos"].items():
            self.assertIn(p["lado"], LADOS, sg)

    def test_L_F_tem_prova(self):
        for sg, p in self.doc["partidos"].items():
            if p["lado"] in ("L", "F"):
                self.assertTrue(p["provas"], f"{sg} é {p['lado']} sem prova")

    def test_provas_bem_formadas(self):
        for sg, p in self.doc["partidos"].items():
            for pr in p["provas"]:
                self.assertIn(pr["tipo"], TIPOS, sg)
                self.assertTrue(pr["url"].startswith("https://"), sg)
                self.assertRegex(pr["data"], DATA, sg)
                self.assertTrue(pr["titulo"].strip(), sg)
                self.assertLessEqual(len(pr["trecho"].split()), 15, f"{sg}: trecho longo")

    def test_override_uf(self):
        for sg, p in self.doc["partidos"].items():
            for uf, lado in p["uf"].items():
                self.assertIn(uf, UFS, f"{sg}: UF inválida {uf}")
                self.assertIn(lado, LADOS, f"{sg}/{uf}")
                self.assertNotEqual(lado, p["lado"], f"{sg}/{uf}: override igual ao lado nacional")
            if p["uf"]:  # override estadual precisa estar justificado
                self.assertTrue(p["provas"] or p["obs"], sg)


class Lados2026(Comum, unittest.TestCase):
    doc = L26

    def test_todo_partido_tem_entrada(self):
        self.assertEqual(SIGLAS - set(L26["partidos"]), set())

    def test_federacao_mesmo_lado(self):  # membros seguem a federação, salvo declaração própria com prova
        for fed, membros in FEDS.items():
            lados = {L26["partidos"][m]["lado"] for m in membros}
            if len(lados) > 1:
                for m in membros:
                    self.assertTrue(L26["partidos"][m]["provas"], f"{fed}: {m} diverge sem prova")


class Lados2022(Comum, unittest.TestCase):
    doc = L22

    def test_mapa_cobre_siglas_2026(self):
        mapa = L22["mapa_siglas_2026"]
        self.assertEqual(SIGLAS - set(mapa), set())
        for sg26, antigas in mapa.items():
            for sg22 in antigas:
                self.assertIn(sg22, L22["partidos"], f"{sg26} -> {sg22} sem entrada em 2022")

    def test_toda_sigla_2022_mapeada(self):
        usadas = {s for v in L22["mapa_siglas_2026"].values() for s in v}
        self.assertEqual(set(L22["partidos"]) - usadas, set())


if __name__ == "__main__":
    unittest.main()
