"""Dark-themed Swagger UI: injects a stylesheet after the default swagger-ui.css."""

from pathlib import Path

from fastapi.openapi.docs import get_swagger_ui_html, swagger_ui_default_parameters
from fastapi.responses import HTMLResponse

SWAGGER_UI_DARK_STYLESHEET_PATH = (
    Path(__file__).resolve().parent / "openapi" / "swagger_ui_dark.css"
)
SWAGGER_UI_DARK_ROUTE = "/docs-theme/swagger-ui-dark.css"


def swagger_ui_dark_html(*, openapi_url: str, title: str) -> HTMLResponse:
    merged_params = {
        **swagger_ui_default_parameters,
        "syntaxHighlight": {"activated": True, "theme": "agate"},
    }
    base = get_swagger_ui_html(
        openapi_url=openapi_url,
        title=title,
        swagger_ui_parameters=merged_params,
    )
    html = base.body.decode("utf-8")
    inject = f'    <link type="text/css" rel="stylesheet" href="{SWAGGER_UI_DARK_ROUTE}">\n'
    return HTMLResponse(html.replace("<head>", f"<head>\n{inject}", 1))
