# eleicoes-2026: o específico deste repo

Pilha **pessoal** do Vitor (conta GitHub `vitoropereira`). Não é Pixel.
Repo **público**: nada de segredo em commit.

## Stack
- Python 3 só com a biblioteca padrão; Chrome headless para pré-render e imagens OG.
- Site estático em `site/`, publicado na Vercel (`build_site.py` gera tudo).
- Visual: `brand.css` é a única fonte de cores e fontes (brand do vitorpereira.ia.br).

## Supabase (painel ao vivo)
- Projeto `qzczyicspbizosjogmlq` (us-east-1), conta pessoal do Vitor.
  É o mesmo projeto do vitorpereira.ia.br: crie recursos **novos**, não mexa nos existentes.
- Credenciais só no `.env` deste repo (`SUPABASE_PROJECT_REF`, `SUPABASE_TOKEN`, que é um PAT da conta inteira).
- O MCP do Supabase desta máquina está logado na org PIXEL: **não usar** para este repo.
- Sem tabelas: o estado do ao vivo é JSON no Storage (bucket `vivo`). O público lê via rewrite
  da Vercel com cache, nunca direto no Storage.
- Toda escrita/DDL e criação de recurso: mostrar o SQL/comando ao Vitor e esperar o OK.

## Comandos
- Testes: `python3 -m unittest discover -s tests -v`
- Testes do HUD (JS): `deno test hud/`
- Relatório: `cd relatorio && python3 montar.py && cd ..`
- Site: `python3 build_site.py`
- PR: `/ship`

## Regras
- `relatorio/relatorio.json` e `historico.json` são dados publicados: mudança visual não pode alterá-los.
- Dados usam só cores de partido; o ciano da brand é só para a moldura.
