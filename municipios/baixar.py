#!/usr/bin/env python3
"""Baixa do TSE/IBGE os arquivos por município do 1º turno 2026 para municipios/brutos/ (retomável).
Bruto ocupa ~1,5 GB e NUNCA é commitado (.gitignore). Depois: python3 municipios/montar.py
Uso: python3 municipios/baixar.py"""
import gzip, json, sys, time, threading, urllib.request, urllib.error, concurrent.futures as cf
from pathlib import Path

OUT = Path(__file__).parent / "brutos"
TSE = "https://resultados.tse.jus.br/oficial/ele2026"
UA = "eleicoes-2026-painel/1.0 (dados abertos; github.com/vitoropereira/eleicoes-2026)"
MALHA = ("https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=municipio"
         "&formato=application/json&qualidade=minima")
CONFIG = f"{TSE}/6257/config/mun-e006257-cm.json"
lock = threading.Lock()
stats = dict(ok=0, pulados=0, n404=0, retries=0, falhas=0)
log404, logfalha = [], []


def get(url, tentativas=3):  # 429 espera 10/20/30 s além do backoff
    """(bytes|None, status). 404 não é repetido; 429/5xx/erros de rede têm 3 tentativas com backoff."""
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                b = r.read()
            if b[:2] == b'\x1f\x8b': b = gzip.decompress(b)  # IBGE responde gzip mesmo sem pedir
            json.loads(b)
            return b, 200
        except urllib.error.HTTPError as e:
            if e.code == 404: return None, 404
            err = f"HTTP {e.code}"
            if e.code == 429 and i < tentativas - 1: time.sleep(10 * (i + 1))  # o TSE limita rajadas: espera extra
        except Exception as e:
            err = repr(e)[:120]
        if i < tentativas - 1:
            with lock: stats["retries"] += 1
            time.sleep(2 * 2 ** i)
    return None, err


def job(item):
    nome, url = item
    dest = OUT / nome
    if dest.exists() and dest.stat().st_size > 0:
        with lock: stats["pulados"] += 1
        return
    b, st = get(url)
    with lock:
        if b is not None:
            tmp = dest.with_suffix(".tmp"); tmp.write_bytes(b); tmp.replace(dest); stats["ok"] += 1
        elif st == 404: stats["n404"] += 1; log404.append(nome)
        else: stats["falhas"] += 1; logfalha.append(f"{nome}: {st}")


def main():
    OUT.mkdir(exist_ok=True)
    t0 = time.time()
    for nome, url in [("mun-config.json", CONFIG), ("malha-ibge.json", MALHA)]:
        if not (OUT / nome).exists():
            b, st = get(url)
            if b is None: sys.exit(f"falha em {url}: {st}")
            tmp = (OUT / nome).with_suffix(".tmp"); tmp.write_bytes(b); tmp.replace(OUT / nome)
    cfg = json.loads((OUT / "mun-config.json").read_text())
    itens = []
    for ab in cfg["abr"]:
        uf = ab["cd"]
        for m in ab["mu"]:
            cd = m["cd"]
            itens.append((f"{uf}{cd}-c0001.json", f"{TSE}/6257/dados/{uf}/{uf}{cd}-c0001-e006257-u.json"))
            if uf == "zz": continue  # exterior: só presidente
            for c in (3, 5, 6, 8 if uf == "df" else 7):  # DF: Câmara Legislativa = c0008
                itens.append((f"{uf}{cd}-c{c:04d}.json", f"{TSE}/6259/dados/{uf}/{uf}{cd}-c{c:04d}-e006259-u.json"))
    print(f"{len(itens)} arquivos na fila", flush=True)
    feitos = 0
    with cf.ThreadPoolExecutor(12) as ex:
        for _ in ex.map(job, itens):
            feitos += 1
            if feitos % 500 == 0:
                print(f"{feitos}/{len(itens)} {dict(stats)} {time.time() - t0:.0f}s", flush=True)
    (OUT / "_404.txt").write_text("\n".join(sorted(log404)))
    (OUT / "_falhas.txt").write_text("\n".join(sorted(logfalha)))
    print(f"FIM {len(itens)} arquivos {dict(stats)} em {time.time() - t0:.0f}s")
    if stats["falhas"]: sys.exit(f"{stats['falhas']} falhas (veja brutos/_falhas.txt); rode de novo para retomar")


if __name__ == "__main__":
    main()
