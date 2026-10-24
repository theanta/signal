"""The Groq model comes from GROQ_MODEL; gpt-oss models get a reasoning budget
so their reasoning does not crowd out the JSON answer."""
import json
import types

from analyzers import pain_point_analyzer as ppa


def test_gpt_oss_gets_low_reasoning_and_headroom():
    args = ppa._model_args("openai/gpt-oss-120b", 700)
    assert args == {"max_tokens": 1700, "extra_body": {"reasoning_effort": "low"}}


def test_other_models_are_sent_as_before():
    assert ppa._model_args("qwen/qwen3.6-27b", 700) == {"max_tokens": 700}


def test_call_uses_the_configured_model(monkeypatch):
    sent = {}

    class _Completions:
        def create(self, **kw):
            sent.update(kw)
            body = {"pain_points": ["slow site"], "recommended_service": "Web", "outreach_angle": "speed"}
            msg = types.SimpleNamespace(content=json.dumps(body))
            return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)], usage=None)

    class _Groq:
        def __init__(self, **_k):
            self.chat = types.SimpleNamespace(completions=_Completions())

    import groq
    monkeypatch.setattr(groq, "Groq", _Groq)
    monkeypatch.setattr(ppa, "_MODEL", "openai/gpt-oss-20b")
    out = ppa._call_groq("prompt")
    assert out["pain_points"] == ["slow site"]
    assert sent["model"] == "openai/gpt-oss-20b"
    assert sent["extra_body"] == {"reasoning_effort": "low"}
