#!/usr/bin/env python3
"""Baixa os CSVs de dados abertos do TSE (2022) para municipios/brutos2022/ (retomável; NUNCA commitado).
Por que CSV: o arquivo oficial de apuração de 2022 (resultados.tse.jus.br/oficial/ele2022/...) não existe mais
no bucket do TSE (NoSuchKey para todas as eleições 544-547), então a fonte é dadosabertos.tse.jus.br,
agregando zonas -> município em montar_t2022.py.
Mapa código TSE -> IBGE (cdi): vem do config de municípios do TSE 2026 (os códigos TSE dos municípios não mudam).
Uso: python3 municipios/baixar_t2022.py"""
import sys, time, urllib.request, zipfile
from pathlib import Path

OUT = Path(__file__).parent / "brutos2022"
CDN = "https://cdn.tse.jus.br/estatistica/sead/odsele"
UA = "eleicoes-2026-painel/1.0 (dados abertos; github.com/vitoropereira/vitorpereira.ia.br-eleicoes)"
CONFIG_MUN = "https://resultados.tse.jus.br/oficial/ele2026/6257/config/mun-e006257-cm.json"
ZIPS = ["votacao_candidato_munzona", "votacao_partido_munzona", "detalhe_votacao_munzona"]


def baixa(url, dest):
    if dest.exists() and dest.stat().st_size > 0: return
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=300) as r, open(dest.with_suffix(".tmp"), "wb") as f:
                while chunk := r.read(1 << 20): f.write(chunk)
            dest.with_suffix(".tmp").replace(dest)
            return
        except Exception as e:
            print("erro", url, repr(e)[:100], flush=True)
            time.sleep(10 * (i + 1))  # 429/5xx: espera e tenta de novo
    sys.exit(f"falha em {url}")


def main():
    OUT.mkdir(exist_ok=True)
    for n in ZIPS:  # 3 downloads, sequenciais: bem abaixo de qualquer limite de concorrência
        z = OUT / f"{n}.zip"
        baixa(f"{CDN}/{n}/{n}_2022.zip", z)
        d = OUT / n
        if not d.exists():
            with zipfile.ZipFile(z) as zf: zf.extractall(d)
    baixa(CONFIG_MUN, OUT / "mun-config-2026.json")
    print("ok", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    main()
