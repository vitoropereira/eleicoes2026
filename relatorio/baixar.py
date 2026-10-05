#!/usr/bin/env python3
"""Baixa do TSE os arquivos por UF de todos os cargos do 1º turno 2026 para relatorio/dados/."""
import json, time, urllib.request, concurrent.futures as cf
from pathlib import Path
UFS = "ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to".split()
OUT = Path(__file__).parent / "dados"
def job(ele, uf, c):
    url = f"https://resultados.tse.jus.br/oficial/ele2026/{ele}/dados/{uf}/{uf}-c{c:04d}-e00{ele}-u.json?t={int(time.time())}"
    for _ in range(3):
        try:
            b = urllib.request.urlopen(url, timeout=40).read(); json.loads(b)
            (OUT / f"{uf}-c{c:04d}.json").write_bytes(b); return None
        except Exception as e:
            err = e; time.sleep(2)
    return f"{uf} c{c}: {err}"
jobs = [("6257", u, 1) for u in UFS + ["zz", "br"]]
jobs += [("6259", u, c) for u in UFS for c in (3, 5, 6, 7 if u != "df" else 8)]
errs = [e for e in cf.ThreadPoolExecutor(12).map(lambda j: job(*j), jobs) if e]
print(f"{len(jobs) - len(errs)}/{len(jobs)} ok", errs)
