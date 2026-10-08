"""Servidor local do ensaio: `site/` como na Vercel e `/vivo/*` lido de `.build/vivo/` (o que o agregador gravou).

    python3 supabase/ensaio_site.py [--porta 8790] [--site site] [--vivo .build/vivo]

`/hud/*.js` vem de `hud/` do repo (não de `site/hud/`), para ensaiar mudanças no HUD sem rodar o build.
Objeto ausente em /vivo/ responde como o Storage do Supabase responde hoje em produção (HTTP 400 + NoSuchKey),
para o ensaio passar pelo mesmo caminho do "ainda não há dado" do HUD.
"""
import argparse
import functools
import http.server
import socketserver
from pathlib import Path

R = Path(__file__).resolve().parent.parent
NAO_ACHADO = b'{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}'


class Handler(http.server.SimpleHTTPRequestHandler):
    vivo: Path = R / ".build" / "vivo"

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        caminho = self.path.split("?", 1)[0]
        if caminho.startswith("/vivo/"):
            alvo = (self.vivo / caminho[len("/vivo/"):]).resolve()
            if self.vivo.resolve() in alvo.parents and alvo.is_file():
                corpo, codigo = alvo.read_bytes(), 200
            else:
                corpo, codigo = NAO_ACHADO, 400
            self.send_response(codigo)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
            return
        if caminho.startswith("/hud/") and caminho.endswith(".js") and (R / caminho.lstrip("/")).is_file():
            corpo = (R / caminho.lstrip("/")).read_bytes()  # o JS do HUD vem do repo: testa a mudança sem rebuild
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
            return
        return super().do_GET()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--porta", type=int, default=8790)
    ap.add_argument("--site", default=str(R / "site"))
    ap.add_argument("--vivo", default=str(R / ".build" / "vivo"))
    a = ap.parse_args()
    Handler.vivo = Path(a.vivo)

    class Srv(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    with Srv(("127.0.0.1", a.porta), functools.partial(Handler, directory=a.site)) as s:
        print(f"site em http://127.0.0.1:{a.porta}/ao-vivo/ · /vivo/ de {a.vivo}")
        s.serve_forever()


if __name__ == "__main__":
    main()
