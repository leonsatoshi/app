"""Regression tests for NOVA backend proxy endpoints and upstream connectivity."""

import os

import pytest
import requests


# Module: backend proxy health + Polymarket upstream passthrough
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    pytest.skip("REACT_APP_BACKEND_URL is required for proxy endpoint tests", allow_module_level=True)

BASE_URL = BASE_URL.rstrip("/")


@pytest.fixture
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


def test_ping(api_client):
    response = api_client.get(f"{BASE_URL}/api/ping", timeout=20)
    assert response.status_code == 200

    data = response.json()
    assert data["ok"] is True
    assert data["proxy"] == "online"
    assert isinstance(data.get("services"), list)
    assert "gamma" in data["services"]


def test_api_root(api_client):
    response = api_client.get(f"{BASE_URL}/api/", timeout=20)
    assert response.status_code == 200

    data = response.json()
    assert data["name"] == "NOVA backend"
    assert data["status"] == "ok"
    assert data["proxy"] == "online"
    assert "clob" in data.get("services", [])


def test_gamma_markets(api_client):
    response = api_client.get(
        f"{BASE_URL}/api/gamma/markets?active=true&closed=false&limit=5",
        timeout=25,
    )
    assert response.status_code == 200

    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0

    first = data[0]
    assert isinstance(first, dict)
    assert any(k in first for k in ["id", "conditionId"])
    assert any(k in first for k in ["question", "title"])


def test_clob_time(api_client):
    response = api_client.get(f"{BASE_URL}/api/clob/time", timeout=20)
    assert response.status_code == 200

    data = response.json()
    if isinstance(data, dict):
        assert "time" in data
        assert str(data["time"]).isdigit()
    else:
        assert str(data).isdigit()


def test_polygon_rpc(api_client):
    payload = {"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []}
    response = api_client.post(f"{BASE_URL}/api/polygon", json=payload, timeout=20)
    assert response.status_code == 200

    data = response.json()
    assert data.get("jsonrpc") == "2.0"
    assert data.get("id") == 1
    assert isinstance(data.get("result"), str)
    assert data["result"].startswith("0x")


def test_unknown_proxy_service(api_client):
    response = api_client.get(f"{BASE_URL}/api/not-a-service", timeout=20)
    assert response.status_code == 404

    data = response.json()
    assert data.get("detail") == "Unknown proxy service"


def test_proxy_options_preflight(api_client):
    response = api_client.options(f"{BASE_URL}/api/gamma/markets", timeout=20)
    assert response.status_code == 204
