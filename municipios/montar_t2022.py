#!/usr/bin/env python3
"""Monta o dataset de 2022 (1º turno; presidente também 2º) por município e partido em municipios/geo/t2022/,
no mesmo formato de municipios/geo/t1/ (2026). Fonte: CSVs de dados abertos do TSE em municipios/brutos2022/
(baixar_t2022.py), zonas somadas por município. Chave de município = código IBGE (cdi, 7 dígitos), via mapa do TSE 2026.
Saída: meta.json, presidente-1t.json, presidente-2t.json, partidos-<cargo>.json, cadeiras.json
Uso: python3 municipios/montar_t2022.py"""
import csv, json, sys
from pathlib import Path

H = Path(__file__).resolve().parent
sys.path.insert(0, str(H))
from montar import nome, nome_mun, js  # mesmas regras de nome do 2026

BR = H / "brutos2022"
OUT = H / "geo" / "t2022"
UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split()
CARGO = {"Presidente": "presidente", "Governador": "governador", "Senador": "senador", "Deputado Federal": "depfed",
         "Deputado Estadual": "depest", "Deputado Distrital": "depest"}
CARGOS = ["presidente", "governador", "senador", "depfed", "depest"]
PROP = ("depfed", "depest")
NOME_EXIB = {"Felipe D Avila": "Felipe d'Avila"}  # o TSE publica "FELIPE D AVILA"
LIMITE = int(2.5 * 1024 * 1024)
csv.field_size_limit(1 << 24)


def linhas(p):
    with open(p, encoding="latin-1", newline="") as f:
        yield from csv.DictReader(f, delimiter=";")


def arquivos(pasta):
    """Arquivos por UF (+ ZZ dentro de BR) sem o BRASIL.csv (duplicata de tudo)."""
    return [p for p in sorted((BR / pasta).glob("*.csv")) if not p.name.endswith("_BRASIL.csv")]


def sg(s): return s.replace(" ", "").upper()  # "PC do B" -> "PCDOB" (mesma grafia do 2026)


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
    if not (BR / "mun-config-2026.json").exists(): sys.exit("rode municipios/baixar_t2022.py antes")
    cfg = json.load(open(BR / "mun-config-2026.json"))
    tse2ibge, nm_mun = {}, {}
    for ab in cfg["abr"]:
        for m in ab["mu"]:
            tse2ibge[(ab["cd"].upper(), m["cd"])] = m["cdi"]
            nm_mun[(ab["cd"].upper(), m["cd"])] = m["nm"]

    # ---- detalhe: eleitores, comparecimento, válidos, brancos, nulos, sub judice por (cargo, turno, uf, mun)
    det = {}
    for p in arquivos("detalhe_votacao_munzona"):
        for r in linhas(p):
            c = CARGO.get(r["DS_CARGO"])
            if not c or (c != "presidente" and r["NR_TURNO"] != "1"): continue
            k = (c, r["NR_TURNO"], r["SG_UF"], r["CD_MUNICIPIO"].zfill(5))
            a = det.setdefault(k, [0] * 6)
            for i, col in enumerate(("QT_APTOS", "QT_COMPARECIMENTO", "QT_TOTAL_VOTOS_VALIDOS", "QT_VOTOS_BRANCOS",
                                     "QT_TOTAL_VOTOS_NULOS", "QT_TOTAL_VOTOS_ANUL_SUBJUD")):
                a[i] += int(r[col])

    # ---- candidatos: presidente (votos por candidato) e eleitos (cadeiras)
    pres = {}      # (turno, uf, mun) -> {sq: votos}
    cinfo = {"1": {}, "2": {}}  # turno -> sq -> (nr, nome urna, sg)
    eleitos = {}   # (cargo, uf, sq) -> sigla
    for p in arquivos("votacao_candidato_munzona"):
        for r in linhas(p):
            c = CARGO.get(r["DS_CARGO"])
            if not c: continue
            t = r["NR_TURNO"]
            if c == "presidente":
                k = (t, r["SG_UF"], r["CD_MUNICIPIO"].zfill(5))
                d = pres.setdefault(k, {})
                d[r["SQ_CANDIDATO"]] = d.get(r["SQ_CANDIDATO"], 0) + int(r["QT_VOTOS_NOMINAIS_VALIDOS"])
                cinfo[t][r["SQ_CANDIDATO"]] = (r["NR_CANDIDATO"], r["NM_URNA_CANDIDATO"], sg(r["SG_PARTIDO"]))
            elif c in ("depfed", "depest", "senador") and t == "1" and r["DS_SIT_TOT_TURNO"].startswith("ELEITO"):
                eleitos[(c, r["SG_UF"], r["SQ_CANDIDATO"])] = sg(r["SG_PARTIDO"])

    # ---- partidos: nominal e legenda por (cargo, uf, mun)
    par = {}
    feds = {}
    for p in arquivos("votacao_partido_munzona"):
        for r in linhas(p):
            c = CARGO.get(r["DS_CARGO"])
            if not c or r["NR_TURNO"] != "1": continue
            s = sg(r["SG_PARTIDO"])
            k = (c, r["SG_UF"], r["CD_MUNICIPIO"].zfill(5))
            n, l = par.setdefault(k, ({}, {}))
            n[s] = n.get(s, 0) + int(r["QT_VOTOS_NOMINAIS_VALIDOS"])
            if c in PROP: l[s] = l.get(s, 0) + int(r["QT_TOTAL_VOTOS_LEG_VALIDOS"])
            if c in PROP and r["NM_FEDERACAO"] != "#NULO":
                nm = r["NM_FEDERACAO"].replace("Federação ", "")
                nm = (nm.split(" - ")[-1] if " - " in nm else nm).upper()
                f = feds.setdefault(nm, [])
                if s not in f: f.append(s)

    # ---- municípios: mapa TSE -> IBGE
    mun, ext, sem_mapa = {}, {}, []
    for (c, t, uf, m) in det:
        if c != "presidente" or t != "1": continue
        if uf == "ZZ":
            continue
        if (uf, m) not in tse2ibge: sem_mapa.append((uf, m)); continue
        mun[(uf, m)] = tse2ibge[(uf, m)]
    # nomes do exterior: do CSV de detalhe/partido não vêm; usa o config 2026 (mesmos códigos TSE)
    ext_nm = {m["cd"]: m["nm"] for ab in cfg["abr"] if ab["cd"] == "zz" for m in ab["mu"]}

    # ---- presidente
    def lin_pres(t, uf, m, ordem):
        d = det.get(("presidente", t, uf, m), [0] * 6)
        v = pres.get((t, uf, m), {})
        return [d[0], d[1], d[2], d[3], d[4], [v.get(s, 0) for s in ordem], d[5]]

    saidas = {}
    meta = dict(fonte="TSE dados abertos (votacao_candidato/partido/detalhe_votacao_munzona 2022)", mun={}, exterior=[], cand={})
    for t, nmeta in (("1", "presidente-1t"), ("2", "presidente-2t")):
        tot = {}
        for (tt, uf, m), v in pres.items():
            if tt == t: soma(tot, v)
        ordem = sorted(tot, key=lambda s: (-tot[s], cinfo[t][s][1]))
        meta["cand"][nmeta] = [dict(n=cinfo[t][s][0], nome=NOME_EXIB.get(nome(cinfo[t][s][1]), nome(cinfo[t][s][1])), sg=cinfo[t][s][2]) for s in ordem]
        s_ = dict(br=None, uf={}, mu={}, ex={})
        brl = [0] * 7; brl[5] = [0] * len(ordem)
        for u in UFS + ["ZZ"]:
            ul = [0] * 7; ul[5] = [0] * len(ordem)
            for (c, tt, uf, m) in det:
                if c != "presidente" or tt != t or uf != u: continue
                ln = lin_pres(t, uf, m, ordem)
                for i in (0, 1, 2, 3, 4, 6): ul[i] += ln[i]
                ul[5] = [a + b for a, b in zip(ul[5], ln[5])]
                if u == "ZZ": s_["ex"][m] = ln
                else: s_["mu"][mun[(uf, m)]] = ln
            s_["uf"][u] = ul
            for i in (0, 1, 2, 3, 4, 6): brl[i] += ul[i]
            brl[5] = [a + b for a, b in zip(brl[5], ul[5])]
        s_["br"] = brl
        s_["mu"] = dict(sorted(s_["mu"].items()))
        saidas[nmeta] = s_
    for (uf, m), cdi in sorted(mun.items(), key=lambda kv: kv[1]):
        meta["mun"][cdi] = [nome_mun(nm_mun[(uf, m)]), uf]
    meta["exterior"] = [[ext_nm.get(m, m), m] for (c, t, uf, m) in sorted(det) if c == "presidente" and t == "1" and uf == "ZZ"]

    # ---- partidos
    uf_l = {c: {} for c in CARGOS}
    mu_l = {c: {} for c in CARGOS}
    for (c, uf, m), (n, l) in par.items():
        v = det[(c, "1", uf, m)][2]
        sj = det[(c, "1", uf, m)][5]
        if uf == "ZZ":
            continue
        mu_l[c][(uf, m)] = (v, n, l, sj)
        U = uf_l[c].setdefault(uf, [0, {}, {}, 0])
        U[0] += v; soma(U[1], n); soma(U[2], l); U[3] += sj
    uf_zz = {}
    for (c, uf, m), (n, l) in par.items():
        if uf == "ZZ" and c == "presidente":
            U = uf_zz.setdefault("ZZ", [0, {}, {}, 0])
            U[0] += det[(c, "1", uf, m)][2]; soma(U[1], n); U[3] += det[(c, "1", uf, m)][5]
    uf_l["presidente"].update(uf_zz)
    br_l = {}
    for c in CARGOS:
        t = [0, {}, {}, 0]
        for (v, n, l, sj) in uf_l[c].values():
            t[0] += v; soma(t[1], n); soma(t[2], l); t[3] += sj
        br_l[c] = t
    # reconciliação nominal+legenda == válidos
    bad = []
    for c in CARGOS:
        for u, (v, n, l, sj) in uf_l[c].items():
            if sum(n.values()) + sum(l.values()) != v: bad.append((c, u, v, sum(n.values()) + sum(l.values())))
    tot = {}
    n_, l_ = br_l["depfed"][1], br_l["depfed"][2]
    for k in set(n_) | set(l_): tot[k] = n_.get(k, 0) + l_.get(k, 0)
    resto = {}
    for c in CARGOS:
        for k, x in br_l[c][1].items():
            if k not in tot: resto[k] = resto.get(k, 0) + x
    partidos = sorted(tot, key=lambda k: (-tot[k], k)) + sorted(resto, key=lambda k: (-resto[k], k))
    idx = {p: i for i, p in enumerate(partidos)}
    dump = lambda o: json.dumps(o, separators=(",", ":"), ensure_ascii=False)
    for c in CARGOS:
        s_ = dict(partidos=partidos, cargo=c, br=[br_l[c][0], denso(br_l[c][1], idx), denso(br_l[c][2], idx), br_l[c][3]], uf={}, mu={})
        for u, (v, n, l, sj) in uf_l[c].items(): s_["uf"][u] = [v, denso(n, idx), denso(l, idx), sj]
        for (uf, m), (v, n, l, sj) in mu_l[c].items():
            if (uf, m) in mun: s_["mu"][mun[(uf, m)]] = [v, esparso(n, idx), esparso(l, idx), sj]
        s_["mu"] = dict(sorted(s_["mu"].items()))
        s_["federacoes"] = feds
        saidas[f"partidos-{c}"] = s_

    # ---- cadeiras
    cad = {c: dict(br={}, uf={}) for c in ("depfed", "depest", "senador")}
    for (c, uf, sq), s in eleitos.items():
        u = cad[c]["uf"].setdefault(uf, {}); u[s] = u.get(s, 0) + 1
        cad[c]["br"][s] = cad[c]["br"].get(s, 0) + 1
    ordena = lambda m: dict(sorted(m.items(), key=lambda kv: (-kv[1], kv[0])))
    for c in cad:
        cad[c] = dict(br=ordena(cad[c]["br"]), uf={u: ordena(m) for u, m in sorted(cad[c]["uf"].items())})
    saidas["cadeiras"] = cad

    OUT.mkdir(parents=True, exist_ok=True)
    for p in OUT.glob("*.json"): p.unlink()
    js(OUT / "meta.json", meta)
    for nm, o in saidas.items(): js(OUT / f"{nm}.json", o)

    # ---- relatório
    ks26 = set(json.load(open(H / "geo" / "t1" / "meta.json"))["mun"])
    k22 = set(meta["mun"])
    print("municípios 2022:", len(k22), "| 2026:", len(ks26), "| só 2022:", sorted(k22 - ks26), "| só 2026:", sorted(ks26 - k22),
          "| sem mapa IBGE:", sorted(set(sem_mapa)), "| exterior:", len(meta["exterior"]))
    print("reconciliação nominal+legenda != válidos:", bad[:10], len(bad))
    for t in ("presidente-1t", "presidente-2t"):
        print(t, "BR", saidas[t]["br"], [c["nome"] for c in meta["cand"][t]])
    print("cadeiras", {c: sum(v["br"].values()) for c, v in cad.items()}, "PL depfed", cad["depfed"]["br"].get("PL"))
    for p in sorted(OUT.glob("*.json")): print(f"{p.name}: {p.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
