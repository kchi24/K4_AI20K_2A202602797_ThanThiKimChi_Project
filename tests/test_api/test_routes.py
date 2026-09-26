import pytest


@pytest.mark.asyncio
async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


@pytest.mark.asyncio
async def test_chat_empty_message(client):
    response = await client.post("/api/v1/chat", json={"message": ""})
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_agent_status(client):
    response = await client.get("/api/v1/status")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_chat_returns_session_id(client, mock_llm):
    response = await client.post(
        "/api/v1/chat",
        json={"message": "Hello", "session_id": "api-test-session"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["session_id"] == "api-test-session"
    assert data["response"] == "Mocked study-support response"
