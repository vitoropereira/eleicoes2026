"""Brand do vitorpereira.ia.br: injeta brand.css no lugar do marcador /*__BRAND__*/ dos templates."""
from pathlib import Path

MARCADOR = "/*__BRAND__*/"
CSS = (Path(__file__).resolve().parent / "brand.css").read_text()


def aplicar(html: str) -> str:
    if MARCADOR not in html:
        raise ValueError("template sem o marcador /*__BRAND__*/")
    return html.replace(MARCADOR, CSS, 1)
