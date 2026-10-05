#!/bin/bash
# Vigia o % apurado no TSE; ao cruzar cada marco gera o painel, salva em marcos/<N>pct/ e abre no browser.
# Estado em .marcos_feitos (um marco por linha) — re-armar não refaz marco já salvo.
cd "$(dirname "$0")"
MARCOS="50 75"
touch .marcos_feitos
fails=0
while true; do
  # % nacional = soma das seções das UFs (o arquivo "br" do TSE congelou em 04/10 19:14)
  pst=$(python3 - <<'PY' 2>/dev/null
import json,urllib.request,time,concurrent.futures as cf
U="ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to zz".split()
f=lambda u:json.load(urllib.request.urlopen(f"https://resultados.tse.jus.br/oficial/ele2026/6257/dados/{u}/{u}-c0001-e006257-u.json?t={int(time.time())}",timeout=20))["s"]
r=list(cf.ThreadPoolExecutor(10).map(f,U))
print(round(100*sum(int(x["st"]) for x in r)/sum(int(x["ts"]) for x in r),2))
PY
)
  if [ -z "$pst" ]; then
    fails=$((fails+1)); [ $fails -eq 5 ] && echo "ERRO: TSE sem resposta há 5 tentativas"
    sleep 60; continue
  fi
  fails=0
  pend=0
  for m in $MARCOS; do
    grep -qx "$m" .marcos_feitos && continue
    pend=1
    if python3 -c "import sys;sys.exit(0 if $pst>=$m else 1)"; then
      if out=$(python3 gerar.py 2>&1); then
        snap=$(ls -td snapshots/*/ | head -1)
        mkdir -p "marcos/${m}pct" && cp "$snap"painel.html "$snap"dados.json "marcos/${m}pct/"
        echo "$m" >> .marcos_feitos
        open "marcos/${m}pct/painel.html"
        echo "MARCO ${m}% atingido (apurado ${pst}%) → marcos/${m}pct/ | $(echo "$out" | tail -1)"
      else
        echo "ERRO ao gerar no marco ${m}%: $(echo "$out" | tail -3 | tr '\n' ' ')"
      fi
    fi
  done
  [ $pend -eq 0 ] && { echo "FIM: todos os marcos ($MARCOS) salvos"; exit 0; }
  sleep 60
done
