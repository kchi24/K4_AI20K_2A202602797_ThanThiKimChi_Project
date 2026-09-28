import pytest

from src.agents.session_tokens import InvalidSessionTokenError, create_session_token, verify_session_token


def test_session_token_round_trip():
    token, thread_id = create_session_token("secret")
    assert verify_session_token(token, "secret") == thread_id


def test_forged_session_token_is_rejected():
    token, _ = create_session_token("secret")
    with pytest.raises(InvalidSessionTokenError):
        verify_session_token(token + "x", "secret")


def test_wrong_secret_is_rejected():
    token, _ = create_session_token("secret")
    with pytest.raises(InvalidSessionTokenError):
        verify_session_token(token, "different-secret")
