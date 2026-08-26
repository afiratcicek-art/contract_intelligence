"""AiChatRequest — live body sanitization and intent enum."""
import pytest
from pydantic import ValidationError

from backend.models.document_authoring import AiChatRequest


def _base(**kwargs):
    body = {
        "messages": [{"role": "user", "content": "soften the tone"}],
        "version": 1,
    }
    body.update(kwargs)
    return AiChatRequest.model_validate(body)


def test_default_intent_is_revise_for_api_clients():
    req = _base()
    assert req.intent == "revise"
    assert req.current_body is None


def test_comment_intent_accepted():
    req = _base(intent="comment")
    assert req.intent == "comment"


def test_rejects_unknown_intent():
    with pytest.raises(ValidationError):
        _base(intent="rewrite")


def test_live_body_strips_script():
    req = _base(current_body='<p>Hello</p><script>alert(1)</script>')
    assert req.current_body is not None
    assert "script" not in req.current_body.lower()
    assert "Hello" in req.current_body


def test_live_body_drops_unknown_class_without_breaking_tag():
    req = _base(current_body='<p class="MsoNormal">Hello</p>')
    assert "MsoNormal" not in (req.current_body or "")
    assert "Hello" in (req.current_body or "")
    assert "<pHello" not in (req.current_body or "")
