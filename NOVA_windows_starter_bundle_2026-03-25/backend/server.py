import logging
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

app = FastAPI(title="NOVA Backend")
api_router = APIRouter(prefix="/api")

PROXY_TARGETS = {
    "gamma": "https://gamma-api.polymarket.com",
    "clob": "https://clob.polymarket.com",
    "data": "https://data-api.polymarket.com",
    "polygon": "https://polygon-bor-rpc.publicnode.com",
}
UPSTREAM_TIMEOUT = 20
FORWARDED_HEADERS = ["content-type", "retry-after", "cache-control", "pragma", "expires"]


@api_router.get("/")
async def root():
    return {
        "name": "NOVA backend",
        "status": "ok",
        "proxy": "online",
        "services": list(PROXY_TARGETS.keys()),
    }


@api_router.get("/ping")
async def ping():
    return {"ok": True, "proxy": "online", "services": list(PROXY_TARGETS.keys())}


def _build_upstream_headers(request: Request) -> dict[str, str]:
    headers: dict[str, str] = {}
    for name, value in request.headers.items():
        lower = name.lower()
        if lower in {"host", "origin", "referer", "content-length", "connection", "accept-encoding"}:
            continue
        headers[name.upper() if lower.startswith("poly_") else name] = value
    headers["Accept-Encoding"] = "identity"
    return headers


async def _forward(service: str, proxy_path: str, request: Request) -> Response:
    target = PROXY_TARGETS.get(service)
    if not target:
        raise HTTPException(status_code=404, detail="Unknown proxy service")

    upstream_url = target if not proxy_path else f"{target}/{proxy_path}"
    if request.url.query:
        upstream_url = f"{upstream_url}?{request.url.query}"

    try:
        async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT, follow_redirects=True) as client:
            upstream_response = await client.request(
                method=request.method,
                url=upstream_url,
                content=await request.body() or None,
                headers=_build_upstream_headers(request),
            )
    except httpx.HTTPError as exc:
        logger.exception("Proxy request failed: %s %s", request.method, upstream_url)
        return JSONResponse(
            status_code=502,
            content={
                "error": "Upstream request failed",
                "detail": str(exc),
                "service": service,
            },
        )

    response_headers = {header: upstream_response.headers[header] for header in FORWARDED_HEADERS if header in upstream_response.headers}
    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=response_headers,
        media_type=upstream_response.headers.get("content-type"),
    )


@api_router.api_route("/{service}", methods=["GET", "POST", "DELETE", "OPTIONS"])
async def proxy_root(service: str, request: Request):
    if request.method == "OPTIONS":
        return Response(status_code=204)
    return await _forward(service, "", request)


@api_router.api_route("/{service}/{proxy_path:path}", methods=["GET", "POST", "DELETE", "OPTIONS"])
async def proxy_path(service: str, proxy_path: str, request: Request):
    if request.method == "OPTIONS":
        return Response(status_code=204)
    return await _forward(service, proxy_path, request)


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)