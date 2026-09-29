"""Data Collection Agent tests (no LLM invocation, no network)."""

from __future__ import annotations

import io
import json
import urllib.request


def test_prompt_hard_boundaries() -> None:
    from data_collection.prompt import SYSTEM_PROMPT

    lowered = SYSTEM_PROMPT.lower()
    for phrase in (
        "do not analyze",
        "refuse",
        "belongs to the research team",
        "never fabricate",
        "never invent",
        "read-only",
        "out of scope",
    ):
        assert phrase in lowered, phrase
    assert "<<" not in SYSTEM_PROMPT
    assert ">>" not in SYSTEM_PROMPT
    assert "tbt historical fetch does not exist" in lowered


def test_agent_builds_with_tools() -> None:
    import sys

    sys.path.insert(0, ".")
    from data_collection.agent import AGENT_NAME, build_data_collection_agent

    assert AGENT_NAME == "data_collection"
    build_data_collection_agent()


def test_prompt_synced_with_tools() -> None:
    import re
    import sys

    sys.path.insert(0, ".")
    from data_collection import (
        acquire_dataset,
        fetch_expired_future_contracts,
        fetch_expired_option_contracts,
        fetch_expiries,
        fetch_historical,
        fetch_option_contracts,
        get_change_oi,
        get_exchange_status,
        get_futures_smartlist,
        get_market_holidays,
        get_market_timings,
        get_max_pain,
        get_oi,
        get_options_smartlist,
        get_pcr,
        search_instruments,
        validate_dataset,
    )
    from data_collection import prompt as prompt_module
    from data_collection import subagents as subagents_module

    lowered = prompt_module.SYSTEM_PROMPT.lower()
    # Every tool the prompt tells the model to call must really exist.
    real_tools = {
        t.name
        for t in (
            acquire_dataset,
            fetch_expired_future_contracts,
            fetch_expired_option_contracts,
            fetch_expiries,
            fetch_historical,
            fetch_option_contracts,
            get_change_oi,
            get_exchange_status,
            get_futures_smartlist,
            get_market_holidays,
            get_market_timings,
            get_max_pain,
            get_oi,
            get_options_smartlist,
            get_pcr,
            search_instruments,
            validate_dataset,
        )
    }
    mentioned = set(
        re.findall(
            r"\b((?:search|fetch|get|acquire|validate)_[a-z_]+)\b", lowered
        )
    )
    assert mentioned, "prompt names no tools at all"
    assert mentioned <= real_tools, mentioned - real_tools
    # Subagent names match the built specs in both directions (no drift).
    spec_names = {
        subagents_module.MARKET_INFO_NAME,
        subagents_module.MARKET_STATUS_NAME,
    }
    for name in spec_names:
        assert name in lowered, name
    # Refusal contract: exact sentence with a dataset placeholder.
    assert "that's outside data collection scope" in lowered
    assert "<dataset_id>" in prompt_module.SYSTEM_PROMPT
    # Correct arg vocabulary.
    assert "from_date" in lowered and "to_date" in lowered
    # Expired candles route through acquire_dataset/fetch_historical,
    # not a separate tool.
    assert "fetch_expired_candles" not in lowered


def test_all_subagents_assigned() -> None:
    import sys

    sys.path.insert(0, ".")
    from data_collection.subagents import market_info_spec, market_status_spec

    market = market_info_spec()
    assert market["name"] == "market_information"
    assert market["mode"] == "isolated"
    assert {t.name for t in market["tools"]} == {
        "get_options_smartlist",
        "get_futures_smartlist",
        "get_oi",
        "get_change_oi",
        "get_max_pain",
        "get_pcr",
    }
    status = market_status_spec()
    assert status["name"] == "market_status"
    assert status["mode"] == "isolated"
    assert {t.name for t in status["tools"]} == {
        "get_exchange_status",
        "get_market_timings",
        "get_market_holidays",
    }


def test_subagents_hide_filesystem_tools() -> None:
    import sys

    sys.path.insert(0, ".")
    from data_collection.subagents import market_info_spec, market_status_spec

    for spec in (market_info_spec(), market_status_spec()):
        middlewares = spec.get("middleware", [])
        assert len(middlewares) == 1
        fs = middlewares[0]
        assert type(fs).__name__ == "FilesystemMiddleware"
        assert set(fs._enabled_tools) == {"read_file"}


def _fake_ok(payload: dict):  # type: ignore[no-untyped-def]
    class FakeResp:
        def __enter__(self):  # type: ignore[no-untyped-def]
            return self

        def __exit__(self, *args) -> bool:  # type: ignore[no-untyped-def]
            return False

        def read(self) -> bytes:
            return json.dumps(payload).encode()

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        return FakeResp()

    return fake_urlopen


def test_fetch_historical_forwards(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import sys

    sys.path.insert(0, ".")
    from data_collection.history_tools import fetch_historical

    seen: dict = {}

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        seen["url"] = request.full_url
        seen["body"] = json.loads(request.data.decode())
        return _fake_ok(
            {"dataset_id": "abc", "status": "COMPLETE", "record_count": 6}
        )(request)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = json.loads(
        fetch_historical.invoke(
            {
                "instrumentKey": "NSE_INDEX|Nifty 50",
                "from_date": "2026-09-01",
                "to_date": "2026-09-23",
                "interval": "1day",
            }
        )
    )
    assert seen["url"].endswith("/historical/datasets")
    assert seen["body"]["interval"] == "1day"
    assert out["dataset_id"] == "abc"
    assert out["status"] == "COMPLETE"


def test_search_tool_compacts(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import sys

    sys.path.insert(0, ".")
    from data_collection.search_tools import search_instruments

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        assert "query=NIFTY" in request.full_url
        return _fake_ok(
            {
                "data": [
                    {
                        "instrument_key": "NSE_FO|73985",
                        "trading_symbol": "NIFTY 23500 CE 29 SEP 26",
                        "extra_noise": True,
                    }
                ]
            }
        )(request)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = json.loads(search_instruments.invoke({"query": "NIFTY"}))
    assert out["count"] == 1
    assert out["instruments"][0]["instrument_key"] == "NSE_FO|73985"
    assert "extra_noise" not in out["instruments"][0]


def test_expiry_tools_forward(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import sys

    sys.path.insert(0, ".")
    from data_collection.expiry_tools import fetch_expiries

    seen: dict = {}

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        seen["url"] = request.full_url
        return _fake_ok({"data": ["2024-10-03"]})(request)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = json.loads(fetch_expiries.invoke({"instrument_key": "NSE_INDEX|Nifty 50"}))
    assert seen["url"].endswith(
        "/instruments/expiries?instrument_key=NSE_INDEX%7CNifty%2050"
    )
    assert out == {"data": ["2024-10-03"]}


def test_filesystem_denied_at_build() -> None:
    import sys

    sys.path.insert(0, ".")
    from data_collection.agent import FILESYSTEM_DENY_ALL

    assert FILESYSTEM_DENY_ALL.mode == "deny"
    assert FILESYSTEM_DENY_ALL.paths == ["/"]


def test_chain_caps_reported(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import sys

    sys.path.insert(0, ".")
    from data_collection.expiry_tools import fetch_expired_option_contracts

    rows = [{"instrument_key": f"K|{i}"} for i in range(150)]

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        return _fake_ok({"data": rows})(request)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = json.loads(
        fetch_expired_option_contracts.invoke(
            {"instrument_key": "NSE_INDEX|Nifty 50", "expiry_date": "2024-10-03"}
        )
    )
    assert out["total"] == 150
    assert out["truncated"] is True
    assert len(out["contracts"]) == 100


def test_market_tools_forward_and_error(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import sys
    import urllib.request

    sys.path.insert(0, ".")
    from data_collection.market_tools import get_max_pain, get_pcr

    seen: dict = {}

    class FakeResp:
        def __init__(self, payload: bytes):
            self._buf = io.BytesIO(payload)

        def __enter__(self):  # type: ignore[no-untyped-def]
            return self

        def __exit__(self, *args) -> bool:  # type: ignore[no-untyped-def]
            return False

        def read(self, *args) -> bytes:  # type: ignore[no-untyped-def]
            return self._buf.read(*args)

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        seen["url"] = request.full_url
        return FakeResp(b'{"data": {"pcr": 1.01}}')

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = json.loads(
        get_pcr.invoke(
            {
                "instrument_key": "NSE_INDEX|Nifty 50",
                "expiry": "2026-09-29",
                "date": "2026-09-23",
                "bucket_interval": "30",
            }
        )
    )
    assert seen["url"].startswith("http")
    assert "/market/pcr?" in seen["url"]
    assert "bucket_interval=30" in seen["url"]
    assert out == {"data": {"pcr": 1.01}}

    import urllib.error

    def failing(request, timeout=0):  # type: ignore[no-untyped-def]
        raise urllib.error.HTTPError(
            request.full_url, 400, "Bad Request", {}, io.BytesIO(b"no bucket")
        )

    monkeypatch.setattr(urllib.request, "urlopen", failing)
    err = json.loads(
        get_max_pain.invoke(
            {
                "instrument_key": "X",
                "expiry": "Y",
                "date": "2026-09-23",
                "bucket_interval": "30",
            }
        )
    )
    assert "error" in err and "hint" in err


def test_market_status_tools_forward(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import sys

    sys.path.insert(0, ".")
    from data_collection.market_tools import (
        get_exchange_status,
        get_market_holidays,
        get_market_timings,
    )

    seen: dict = {}

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        seen["url"] = request.full_url
        if "/market/holidays" in request.full_url:
            return _fake_ok(
                {"data": [{"date": "2026-10-02", "description": "Gandhi Jayanti"}]}
            )(request)
        return _fake_ok({"data": {"exchange": "NSE"}})(request)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = json.loads(get_exchange_status.invoke({"exchange": "NSE"}))
    assert "/market/status?exchange=NSE" in seen["url"]
    assert out == {"data": {"exchange": "NSE"}}

    out = json.loads(get_market_timings.invoke({"date": "2026-09-29"}))
    assert "/market/timings?date=2026-09-29" in seen["url"]

    out = json.loads(get_market_holidays.invoke({"date": "2026-10-02"}))
    assert "/market/holidays?date=2026-10-02" in seen["url"]
    assert out["total"] == 1
    assert out["truncated"] is False

    out = json.loads(get_market_holidays.invoke({}))
    assert seen["url"].endswith("/market/holidays")


def test_acquire_dataset_merges_fetch_and_validation(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import sys

    sys.path.insert(0, ".")
    from data_collection.history_tools import acquire_dataset

    seen: dict = {}

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        seen.setdefault("urls", []).append(request.full_url)
        if request.full_url.endswith("/historical/datasets"):
            return _fake_ok(
                {
                    "dataset_id": "abc",
                    "status": "COMPLETE",
                    "record_count": 375,
                    "reused": False,
                }
            )(request)
        return _fake_ok(
            {
                "verdict": "VALID",
                "completeness": 1.0,
                "gap_count": 0,
                "gaps": [],
                "notes": ["n1"],
            }
        )(request)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = json.loads(
        acquire_dataset.invoke(
            {
                "instrumentKey": "NSE_INDEX|Nifty 50",
                "from_date": "2026-09-28",
                "to_date": "2026-09-28",
                "interval": "1minute",
            }
        )
    )
    assert out["dataset_id"] == "abc"
    assert out["status"] == "COMPLETE"
    assert out["record_count"] == 375
    assert out["verdict"] == "VALID"
    assert out["completeness"] == 1.0
    assert out["first_gaps"] == []
    assert out["notes"] == ["n1"]
    assert len(seen["urls"]) == 2
    assert seen["urls"][1].endswith("/historical/datasets/abc/validation")


def test_main_agent_collects_in_bounded_calls_without_fs_tools(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Recording fake model: NIFTY 1-minute candles for one month.

    Asserts the whole job takes <= 4 LLM calls, uses direct collection
    tools (no `task` delegation), and never touches a filesystem tool.
    No network, no real model.
    """
    import asyncio
    import sys

    sys.path.insert(0, ".")
    from langchain_core.language_models.fake_chat_models import (
        GenericFakeChatModel,
    )
    from langchain_core.messages import AIMessage

    from data_collection.agent import build_data_collection_agent

    bound_names: list = []

    class RecordingFakeModel(GenericFakeChatModel):
        """Fake that tolerates bind_tools and records the bound schema."""

        def bind_tools(self, tools, **kwargs):  # type: ignore[no-untyped-def]
            bound_names.extend(
                getattr(t, "name", None) or t.get("name") for t in tools
            )
            return self

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        url = request.full_url
        if "/instruments/search" in url:
            return _fake_ok(
                {"data": [{"instrument_key": "NSE_INDEX|Nifty 50"}]}
            )(request)
        if url.endswith("/historical/datasets"):
            return _fake_ok(
                {
                    "dataset_id": "abc",
                    "status": "COMPLETE",
                    "record_count": 8000,
                    "reused": False,
                }
            )(request)
        return _fake_ok(
            {
                "verdict": "VALID",
                "completeness": 1.0,
                "gap_count": 0,
                "gaps": [],
                "notes": [],
            }
        )(request)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    script = [
        AIMessage(
            content="",
            tool_calls=[
                {
                    "name": "search_instruments",
                    "args": {"query": "NIFTY"},
                    "id": "call_1",
                    "type": "tool_call",
                }
            ],
        ),
        AIMessage(
            content="",
            tool_calls=[
                {
                    "name": "acquire_dataset",
                    "args": {
                        "instrumentKey": "NSE_INDEX|Nifty 50",
                        "from_date": "2026-09-01",
                        "to_date": "2026-09-30",
                        "interval": "1minute",
                    },
                    "id": "call_2",
                    "type": "tool_call",
                }
            ],
        ),
        AIMessage(content="Done: dataset abc is VALID with 8000 candles."),
    ]

    calls = {"n": 0}

    class CountingIterator:
        def __init__(self, items):  # type: ignore[no-untyped-def]
            self._it = iter(items)

        def __iter__(self):  # type: ignore[no-untyped-def]
            return self

        def __next__(self):  # type: ignore[no-untyped-def]
            calls["n"] += 1
            return next(self._it)

    agent = build_data_collection_agent(
        RecordingFakeModel(messages=CountingIterator(script))
    )
    result = asyncio.run(
        agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": "NIFTY 1-minute candles for September 2026.",
                    }
                ]
            }
        )
    )
    assert calls["n"] <= 4, f"took {calls['n']} LLM calls"

    invoked: list = []
    for msg in result.get("messages", []):
        for call in getattr(msg, "tool_calls", []) or []:
            invoked.append(call.get("name"))
    assert "search_instruments" in invoked
    assert "acquire_dataset" in invoked
    assert "task" not in invoked
    fs_tools = {
        "ls",
        "read_file",
        "write_file",
        "edit_file",
        "delete",
        "glob",
        "grep",
    }
    assert not (set(invoked) & fs_tools), invoked
    last = result["messages"][-1]
    assert "abc" in str(getattr(last, "content", ""))
    # Bound schema (Slice 7): only data tools + task + read_file (the one
    # fs tool the framework mandates; still denied at call time).
    assert "task" in set(bound_names)
    assert set(bound_names) == {
        "search_instruments",
        "fetch_option_contracts",
        "fetch_expiries",
        "fetch_expired_option_contracts",
        "fetch_expired_future_contracts",
        "acquire_dataset",
        "read_file",
        "task",
    }, bound_names

def test_tools_return_errors_not_raise(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import sys
    import urllib.error

    sys.path.insert(0, ".")
    from data_collection.history_tools import validate_dataset

    def fake_urlopen(request, timeout=0):  # type: ignore[no-untyped-def]
        raise urllib.error.HTTPError(
            request.full_url, 400, "Bad Request", {}, io.BytesIO(b"bad id")
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = json.loads(validate_dataset.invoke({"dataset_id": "BAD"}))
    assert "error" in out and "hint" in out
