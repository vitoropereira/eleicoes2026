import subprocess, unittest
from pathlib import Path

R = Path(__file__).resolve().parent.parent


class Repo(unittest.TestCase):
    def ignorado(self, nome):
        return subprocess.run(["git", "-C", str(R), "check-ignore", "-q", nome]).returncode == 0

    def test_env_ignorado(self):
        for nome in (".env", ".env.local", ".env.development.local"):
            self.assertTrue(self.ignorado(nome), f"{nome} precisa estar no .gitignore")

    def test_env_example_versionado_e_sem_valores(self):
        self.assertFalse(self.ignorado(".env.example"))
        for linha in (R / ".env.example").read_text().splitlines():
            if linha and not linha.startswith("#"):
                nome, _, valor = linha.partition("=")
                self.assertEqual(valor, "", f"{nome} não pode ter valor no .env.example")

    def test_agents_md_sem_segredo(self):
        texto = (R / "AGENTS.md").read_text()
        self.assertNotIn("sbp_", texto)
        self.assertNotIn("service_role\":", texto)
        self.assertIn("qzczyicspbizosjogmlq", texto)


if __name__ == "__main__":
    unittest.main()
