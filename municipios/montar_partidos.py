#!/usr/bin/env python3
"""Monta os dados por PARTIDO do 1º turno (página Análise) em municipios/geo/t1/.
Lê relatorio/dados/ (UF e BR) e municipios/brutos/ (baixar.py). Saída:
  partidos-<cargo>.json (um por cargo: {partidos, cargo, br, uf, mu, federacoes}; um único partidos.json
  {partidos, cargos:{cargo:{br,uf,mu}}, federacoes} só se coubesse em 2,5 MB) e cadeiras.json
Formato (arrays alinhados a "partidos"; zeros À DIREITA são cortados, então um array pode ser mais curto):
  linha = [validos, [nominal_p0, ...], [legenda_p0, ...], vansj]
  nominal = soma de vap dos candidatos "Válido" do partido; legenda = par[].tvtl (só depfed/depest; senador,
  governador e presidente trazem [] na legenda); vansj = v.vansj (anulado sub judice, fora de validos).
  Reconciliação: sum(nominal)+sum(legenda) == validos (e validos+vansj é o denominador do TSE).
  Municípios: mesma linha, porém nominal/legenda esparsos {"i":[índices],"v":[votos]} (só partidos com voto).
Uso: python3 municipios/montar_partidos.py"""
import json, sys
from pathlib import Path

H = Path(__file__).resolve().parent
R = H.parent
BR = H / "brutos"
UFD = R / "relatorio" / "dados"
T1 = H / "geo" / "t1"
UFS = "ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to".split()
CARGOS = dict(presidente=1, governador=3, senador=5, depfed=6, depest=7)  # depest do DF = c0008
PROP = ("depfed", "depest")
LIMITE_JUNTO = int(2.5 * 1024 * 1024)  # teto por arquivo do repo (tests/test_municipios.py); acima disso, um arquivo por cargo
LIMITE_CARGO = 3 * 1024 * 1024


def ld(p):
    with open(p) as f: return json.load(f)


def cod(cargo, uf): return 8 if (cargo == "depest" and uf == "df") else CARGOS[cargo]


def extrai(d, prop):
    """(validos, {sg: nominal}, {sg: legenda}, vansj, {sg: cadeiras}, federações[(nm, [sg])])"""
    nom, leg, cad = {}, {}, {}
    car = d["carg"][0]
    for a in car["agr"]:
        for p in a["par"]:
            sg = p["sg"]
            cs = p.get("cand", [])
            n = sum(int(x["vap"]) for x in cs if x["dvt"] == "Válido")
            if n or sg not in nom: nom[sg] = nom.get(sg, 0) + n
            if prop and int(p.get("tvtl") or 0): leg[sg] = leg.get(sg, 0) + int(p["tvtl"])
            e = sum(1 for x in cs if x["e"] == "s" and x["st"].startswith("Eleito"))
            if e: cad[sg] = cad.get(sg, 0) + e
    feds = {}
    for f in car.get("fed", []):
        nm = f["nm"].split(" - ")[-1] if " - " in f["nm"] else f["nm"].replace("FEDERAÇÃO ", "")
        feds[f["n"]] = (nm, [])
    for a in car["agr"]:
        for p in a["par"]:
            if p.get("nfed") in feds and p["sg"] not in feds[p["nfed"]][1]: feds[p["nfed"]][1].append(p["sg"])
    v = d["v"]
    return int(v["vv"]), nom, leg, int(v.get("vansj") or 0), cad, list(feds.values())


def soma(a, b):
    for k, x in b.items(): a[k] = a.get(k, 0) + x


def denso(m, idx):
    arr = [0] * len(idx)
    for k, x in m.items(): arr[idx[k]] = x
    while arr and arr[-1] == 0: arr.pop()
    return arr


def esparso(m, idx):
    ks = sorted((idx[k], x) for k, x in m.items() if x)
    return {"i": [i for i, _ in ks], "v": [x for _, x in ks]}


def main():
    if not (BR / "mun-config.json").exists(): sys.exit("rode municipios/baixar.py antes")
    cfg = ld(BR / "mun-config.json")
    uf_l = {c: {} for c in CARGOS}   # cargo -> UF -> (v, nom, leg, sj)
    cad_uf = {c: {} for c in ("depfed", "depest", "senador")}
    feds = {}
    for c in CARGOS:
        for uf in UFS + (["zz"] if c == "presidente" else []):
            d = ld(UFD / f"{uf}-c{cod(c, uf):04d}.json")
            v, nom, leg, sj, cad, fl = extrai(d, c in PROP)
            uf_l[c][uf.upper()] = (v, nom, leg, sj)
            if c in cad_uf: cad_uf[c][uf.upper()] = cad
            if c in PROP:
                for nm, ms in fl: feds.setdefault(nm, ms)
    # BR: presidente = arquivo nacional; demais = soma das UFs
    br_l = {}
    v, nom, leg, sj, _, _ = extrai(ld(UFD / "br-c0001.json"), False)
    br_l["presidente"] = (v, nom, leg, sj)
    for c in CARGOS:
        if c == "presidente": continue
        t = [0, {}, {}, 0]
        for (v, nom, leg, sj) in uf_l[c].values():
            t[0] += v; soma(t[1], nom); soma(t[2], leg); t[3] += sj
        br_l[c] = tuple(t)

    # ordem estável: votos nacionais de depfed (nominal+legenda) desc, depois o resto por votos totais
    tot = {}
    _, n, l, _ = br_l["depfed"]
    for k in set(n) | set(l): tot[k] = n.get(k, 0) + l.get(k, 0)
    resto = {}
    for c in CARGOS:
        for k, x in br_l[c][1].items():
            if k not in tot: resto[k] = resto.get(k, 0) + x
    partidos = sorted(tot, key=lambda k: (-tot[k], k)) + sorted(resto, key=lambda k: (-resto[k], k))
    idx = {p: i for i, p in enumerate(partidos)}

    saida = {c: dict(br=None, uf={}, mu={}) for c in CARGOS}
    for c in CARGOS:
        v, nom, leg, sj = br_l[c]
        saida[c]["br"] = [v, denso(nom, idx), denso(leg, idx), sj]
        for uf, (v, nom, leg, sj) in uf_l[c].items():
            saida[c]["uf"][uf] = [v, denso(nom, idx), denso(leg, idx), sj]

    faltam = []
    for ab in cfg["abr"]:
        uf = ab["cd"]
        if uf == "zz": continue
        for m in ab["mu"]:
            for c in CARGOS:
                p = BR / f"{uf}{m['cd']}-c{cod(c, uf):04d}.json"
                if not p.exists(): faltam.append(p.name); continue
                v, nom, leg, sj, _, _ = extrai(ld(p), c in PROP)
                saida[c]["mu"][m["cdi"]] = [v, esparso(nom, idx), esparso(leg, idx), sj]
    if faltam: sys.exit(f"{len(faltam)} arquivos ausentes em brutos/ (rode baixar.py): {faltam[:10]}")

    dump = lambda o: json.dumps(o, separators=(",", ":"), ensure_ascii=False)
    for p in T1.glob("partidos*.json"): p.unlink()
    junto = dump(dict(partidos=partidos, cargos=saida, federacoes=feds))
    if len(junto.encode()) <= LIMITE_JUNTO:
        (T1 / "partidos.json").write_text(junto)
    else:
        for c in CARGOS:
            (T1 / f"partidos-{c}.json").write_text(dump(dict(partidos=partidos, cargo=c, **saida[c], federacoes=feds)))

    # cadeiras
    cad = {}
    for c, por_uf in cad_uf.items():
        br = {}
        for m in por_uf.values(): soma(br, m)
        cad[c] = dict(br=dict(sorted(br.items(), key=lambda kv: (-kv[1], kv[0]))), uf={u: dict(sorted(m.items(), key=lambda kv: (-kv[1], kv[0]))) for u, m in por_uf.items()})
    (T1 / "cadeiras.json").write_text(dump(cad))
    for p in sorted(T1.glob("partidos*.json")) + [T1 / "cadeiras.json"]: print(f"{p.name}: {p.stat().st_size / 1024:.0f} KB")
    print("partidos:", len(partidos), "| cadeiras", {c: sum(v["br"].values()) for c, v in cad.items()})


if __name__ == "__main__":
    main()
