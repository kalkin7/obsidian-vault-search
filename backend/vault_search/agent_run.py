"""Structured agent run: native tool-calling loop with an approval boundary
(plan §5.3, §11).

A run owns its conversation state and budgets. It executes synchronously on
the backend worker thread; ``answer_continue`` re-enters the loop after user
decisions. External MCP tools never execute before an explicit approval, and
every provider call id runs at most once even across duplicate continues.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .agent_prompt import build_agent_system_prompt, wrap_skill_instructions
from .agent_tools import (
    BUILTIN_GREP_NAME,
    BUILTIN_READ_NAME,
    BUILTIN_SEARCH_NAME,
    BUILTIN_SKILL_LOAD_NAME,
    BUILTIN_SKILL_RESOURCE_NAME,
    BUILTIN_TOOL_NAMES_SET,
    MAX_RUN_CONTEXT_BUDGET_BYTES,
    NormalizedToolResult,
    ToolAliasMap,
    ToolDefinition,
    tool_error_result,
)
from .llm import ProviderToolCall, ProviderTurn
from .skills import RunResourceBudget, SkillError, SkillRegistry

MAX_TURNS = 10
MAX_TOTAL_TOOL_CALLS = 30
MAX_TOOL_CALLS_PER_TURN = 6
MAX_ACTIVE_RUNS = 4
APPROVAL_TTL_SECONDS = 600.0


class AgentRunError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


class _ContextBudgetExhausted(Exception):
    """Internal signal: the shared per-run context budget is spent."""


@dataclass(slots=True)
class PendingCall:
    call_id: str
    alias: str
    server_id: str
    server_name: str
    display_name: str
    arguments: dict[str, Any]
    annotations: dict[str, Any]
    description: str | None = None


@dataclass(slots=True)
class ActivityEntry:
    tool_name: str
    server_name: str | None
    status: str  # success | error | rejected | cancelled
    duration_ms: int
    truncated: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "toolName": self.tool_name,
            **({"serverName": self.server_name} if self.server_name else {}),
            "status": self.status,
            "durationMs": self.duration_ms,
            **({"truncated": True} if self.truncated else {}),
        }


@dataclass
class RunState:
    run_id: str
    query: str
    created_at: float = field(default_factory=time.monotonic)
    messages: list[dict[str, Any]] = field(default_factory=list)
    pending: dict[str, PendingCall] = field(default_factory=dict)
    executed_call_ids: set[str] = field(default_factory=set)
    activity: list[ActivityEntry] = field(default_factory=list)
    loaded_skills: dict[str, str] = field(default_factory=dict)
    resource_budget: RunResourceBudget = field(default_factory=RunResourceBudget)
    # Shared per-run budget across vault sources, MCP results, and skill
    # bodies/resources (fix §6). Exhaustion yields coded tool errors.
    context_budget: RunResourceBudget = field(
        default_factory=lambda: RunResourceBudget(MAX_RUN_CONTEXT_BUDGET_BYTES)
    )
    active_calls: dict[str, Any] = field(default_factory=dict)
    turns: int = 0
    tool_call_count: int = 0
    cancelled: bool = False
    lock: threading.RLock = field(default_factory=threading.RLock)
    # Provider that drives this run. answer_continue needs it after an
    # approval boundary so completed results keep real provider/model fields.
    provider: Any | None = None


class StructuredAgentRun:
    """One agentic answer execution driven through native tool calling."""

    def __init__(
        self,
        *,
        state: RunState,
        system_prompt: str,
        tools: list[ToolDefinition],
        aliases: ToolAliasMap,
        complete_turn: Callable[..., ProviderTurn],
        search_fn: Callable[[str], list[dict[str, Any]]],
        read_file_fn: Callable[[str], str],
        grep_fn: Callable[[str, str], list[dict[str, Any]]],
        skills: SkillRegistry | None,
        mcp_host: Any | None,
        max_context_chars: int,
        max_output_tokens: int,
        timeout_seconds: float,
    ) -> None:
        self.state = state
        self.system_prompt = system_prompt
        self.tools = tools
        self.aliases = aliases
        self._complete_turn = complete_turn
        self._search = search_fn
        self._read_file = read_file_fn
        self._grep = grep_fn
        self._skills = skills
        self._mcp_host = mcp_host
        self.max_context_chars = min(32000, max(8000, max_context_chars))
        self.max_output_tokens = max_output_tokens
        self.timeout_seconds = timeout_seconds
        # Vault evidence accumulated during this run ([S#]-addressable).
        self.sources: list[dict[str, Any]] = []
        self.source_chars = 0
        self.session_allowed: set[str] = set()

    # ------------------------------------------------------------------
    # Source bookkeeping (mirrors DeepAnswerEngine behavior)
    # ------------------------------------------------------------------

    def _add_source(
        self,
        *,
        file_path: str,
        start_line: int,
        heading_path: list[str],
        content: str,
        rank: int,
        score: float,
        max_chars: int,
    ) -> int | None:
        content = content[:max_chars].strip()
        if not content or self.source_chars + len(content) > self.max_context_chars:
            return None
        if not self.state.context_budget.try_consume(len(content)):
            raise _ContextBudgetExhausted(
                f"run context budget exhausted at {len(content)} bytes"
            )
        index = len(self.sources) + 1
        self.sources.append(
            {
                "id": f"S{index}",
                "file_path": file_path.replace("\\", "/"),
                "start_line": max(1, start_line),
                "heading_path": [h for h in heading_path if h],
                "content": content,
                "rank": rank,
                "score": score,
            }
        )
        self.source_chars += len(content)
        return index

    def _render_source(self, source: dict[str, Any]) -> str:
        heading = " > ".join(source["heading_path"]) or "(no heading)"
        return (
            f'<source id="{source["id"]}">\n'
            f"path: {source['file_path']}\n"
            f"line: {source['start_line']}\n"
            f"heading: {heading}\n"
            f"snippet:\n{source['content']}\n"
            "</source>"
        )

    # ------------------------------------------------------------------
    # Built-in execution
    # ------------------------------------------------------------------

    def _execute_builtin(self, name: str, arguments: dict[str, Any]) -> NormalizedToolResult:
        try:
            if name == BUILTIN_SEARCH_NAME:
                query = str(arguments.get("query") or "").strip()
                if not query:
                    return tool_error_result("TOOL_INVALID_ARGUMENTS", "query required")
                results = self._search(query)[:12]
                texts: list[str] = []
                for item in results:
                    index = self._add_source(
                        file_path=str(item.get("file_path", "")),
                        start_line=int(item.get("start_line") or 1),
                        heading_path=[
                            str(x) for x in (item.get("heading_path") or [])
                        ],
                        content=str(item.get("content") or ""),
                        rank=int(item.get("rank") or len(results)),
                        score=float(item.get("score") or 0.0),
                        max_chars=3000,
                    )
                    if index is not None:
                        texts.append(self._render_source(self.sources[-1]))
                if not texts:
                    return NormalizedToolResult(ok=True, text="search returned no results.")
                return NormalizedToolResult(
                    ok=True, text="검색 결과:\n" + "\n\n".join(texts)
                )
            if name == BUILTIN_READ_NAME:
                rel = str(arguments.get("file") or "").strip()
                if not rel:
                    return tool_error_result("TOOL_INVALID_ARGUMENTS", "file required")
                text = self._read_file(rel)
                heading = ""
                for line in text.splitlines():
                    if line.strip().startswith("#"):
                        heading = line.strip().lstrip("#").strip()
                        break
                index = self._add_source(
                    file_path=rel,
                    start_line=1,
                    heading_path=[heading] if heading else [],
                    content=text,
                    rank=0,
                    score=0.0,
                    max_chars=40000,
                )
                if index is None:
                    return NormalizedToolResult(
                        ok=True, text="tool result omitted: evidence budget reached"
                    )
                return NormalizedToolResult(
                    ok=True, text="파일 내용:\n" + self._render_source(self.sources[-1])
                )
            if name == BUILTIN_GREP_NAME:
                pattern = str(arguments.get("pattern") or "").strip()
                glob_pattern = str(arguments.get("glob") or "**/*.md").strip()
                if not pattern:
                    return tool_error_result("TOOL_INVALID_ARGUMENTS", "pattern required")
                matches = self._grep(pattern, glob_pattern)
                texts = []
                for match in matches[:100]:
                    index = self._add_source(
                        file_path=str(match.get("file_path", "")),
                        start_line=int(match.get("start_line") or 1),
                        heading_path=[],
                        content=str(match.get("content") or ""),
                        rank=0,
                        score=0.0,
                        max_chars=300,
                    )
                    if index is not None:
                        texts.append(self._render_source(self.sources[-1]))
                if not texts:
                    return NormalizedToolResult(ok=True, text="grep found no matches.")
                return NormalizedToolResult(
                    ok=True, text="grep 결과:\n" + "\n\n".join(texts)
                )
            if name == BUILTIN_SKILL_LOAD_NAME:
                if self._skills is None:
                    return tool_error_result("SKILLS_DISABLED", "skills are not enabled")
                skill_id = str(arguments.get("skill_id") or "").strip()
                if skill_id in self.state.loaded_skills:
                    return NormalizedToolResult(
                        ok=True,
                        text=self.state.loaded_skills[skill_id],
                    )
                body = wrap_skill_instructions(skill_id, self._skills.load_body(skill_id))
                if not self.state.context_budget.try_consume(len(body)):
                    return tool_error_result(
                        "CONTEXT_BUDGET_EXHAUSTED",
                        f"body of skill '{skill_id}' ({len(body)} bytes) "
                        "withheld: run context budget exhausted",
                    )
                self.state.loaded_skills[skill_id] = body
                return NormalizedToolResult(ok=True, text=body)
            if name == BUILTIN_SKILL_RESOURCE_NAME:
                if self._skills is None:
                    return tool_error_result("SKILLS_DISABLED", "skills are not enabled")
                skill_id = str(arguments.get("skill_id") or "").strip()
                relative = str(arguments.get("relative_path") or "").strip()
                if skill_id not in self.state.loaded_skills:
                    raise SkillError("load the skill before reading its resources")
                text = self._skills.read_resource(skill_id, relative, self.state.resource_budget)
                return NormalizedToolResult(ok=True, text=text)
            return tool_error_result("UNKNOWN_TOOL", f"unknown tool '{name}'")
        except SkillError as exc:
            return tool_error_result("SKILL_ERROR", str(exc))
        except _ContextBudgetExhausted as exc:
            return tool_error_result(
                "CONTEXT_BUDGET_EXHAUSTED",
                f"{exc}. No further large tool output fits this run.",
            )
        except Exception as exc:  # tool failure becomes a note; loop continues
            return tool_error_result("TOOL_FAILED", f"{type(exc).__name__}: {exc}")

    # ------------------------------------------------------------------
    # Classification / execution of provider calls
    # ------------------------------------------------------------------

    def _classify_call(self, call: ProviderToolCall) -> tuple[str, PendingCall | None]:
        """Return (kind, pending); kind ∈ builtin|mcp_ask|mcp_auto|unknown."""
        if call.name in BUILTIN_TOOL_NAMES_SET:
            return ("builtin", None)
        resolved = self.aliases.resolve(call.name)
        if resolved is None:
            return ("unknown", None)
        host = self._mcp_host
        assert host is not None
        server_id, original_name = resolved
        summary = host.server_summary(server_id)
        if summary is None:
            return ("unknown", None)
        policy = summary["tool_policies"].get(original_name, "ask")
        pending = PendingCall(
            call_id=call.id,
            alias=call.name,
            server_id=server_id,
            server_name=summary["name"],
            display_name=original_name,
            arguments=dict(call.arguments),
            annotations={},
        )
        description = (summary.get("tool_descriptions") or {}).get(original_name)
        if description:
            pending.description = description
        if policy == "allow" or call.name in self.session_allowed:
            return ("mcp_auto", pending)
        return ("mcp_ask", pending)

    def _execute_mcp(self, pending: PendingCall) -> NormalizedToolResult:
        assert self._mcp_host is not None
        started = time.monotonic()
        result = self._mcp_host.call_tool_sync(
            server_id=pending.server_id,
            tool_name=pending.display_name,
            arguments=pending.arguments,
            timeout_seconds=self.timeout_seconds,
            cancel_registry=self.state.active_calls,
            cancel_key=f"{self.state.run_id}:{pending.call_id}",
        )
        duration_ms = int((time.monotonic() - started) * 1000)
        if result.ok:
            status = "success"
            # The side effect already happened, so the result is never
            # silently dropped: over budget it is replaced by a coded error
            # that says exactly what was withheld (fix §6). The activity
            # entry still reports success — the call itself succeeded.
            payload = result.to_model_text()
            if not self.state.context_budget.try_consume(len(payload)):
                result = tool_error_result(
                    "CONTEXT_BUDGET_EXHAUSTED",
                    f"result of '{pending.display_name}' ({len(payload)} "
                    "bytes) withheld: run context budget exhausted",
                )
        elif result.error_code == "MCP_CALL_CANCELLED":
            status = "cancelled"
        else:
            status = "error"
        self.state.activity.append(
            ActivityEntry(
                tool_name=pending.alias,
                server_name=pending.server_name,
                status=status,
                duration_ms=duration_ms,
                truncated=result.truncated,
            )
        )
        return result

    @staticmethod
    def _result_message(call: ProviderToolCall, result: NormalizedToolResult) -> dict[str, Any]:
        prefix = "" if result.ok else f"[{result.error_code}] "
        return {
            "role": "tool",
            "tool_call_id": call.id,
            "content": (prefix + result.to_model_text())[:32000],
        }

    def _append_assistant_and_results(
        self, turn: ProviderTurn, results: list[tuple[ProviderToolCall, NormalizedToolResult]]
    ) -> None:
        self.state.messages.append(
            {
                "role": "assistant",
                "content": turn.text or "",
                "tool_calls": list(turn.tool_calls),
            }
        )
        for call, result in results:
            self.state.messages.append(self._result_message(call, result))

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    def seed(self, conversation: list[dict[str, str]]) -> None:
        initial = self._execute_builtin(
            BUILTIN_SEARCH_NAME, {"query": self.state.query}
        )
        self.state.tool_call_count += 1
        context = initial.to_model_text() if initial.ok else ""
        self.state.messages = [
            *[{"role": m["role"], "content": m["content"]} for m in conversation],
            {"role": "user", "content": f"질문:\n{self.state.query}\n\n{context}"},
        ]

    def advance(self) -> dict[str, Any]:
        """Drive the loop until final text, an approval boundary, or failure."""
        while True:
            if self.state.cancelled:
                raise AgentRunError("ANSWER_CANCELLED", "run was cancelled")
            if self.state.turns >= MAX_TURNS:
                return self._finalize_forced()
            try:
                turn = self._complete_turn(
                    system=self.system_prompt,
                    messages=self.state.messages,
                    tools=self.tools,
                    max_output_tokens=self.max_output_tokens,
                    timeout_seconds=self.timeout_seconds,
                )
            except Exception as exc:
                code = getattr(exc, "code", None)
                message = getattr(exc, "message", str(exc))
                raise AgentRunError(code or "LLM_BAD_RESPONSE", message) from exc
            if self.state.cancelled:
                # The cancel landed while the provider call was in flight:
                # never spend the returned turn (its text or tool calls must
                # not drive further execution).
                raise AgentRunError("ANSWER_CANCELLED", "run was cancelled")
            self.state.turns += 1
            if not turn.tool_calls:
                return self._complete_with_text(turn.text)
            # Calls beyond the per-turn cap must never dangle: the assistant
            # transcript keeps every provider call, so each one needs exactly
            # one tool result (fix §7).
            batch = turn.tool_calls[:MAX_TOOL_CALLS_PER_TURN]
            overflow_results: list[tuple[ProviderToolCall, NormalizedToolResult]] = [
                (
                    call,
                    tool_error_result(
                        "TOOL_BUDGET_EXHAUSTED",
                        f"more than {MAX_TOOL_CALLS_PER_TURN} tool calls "
                        "in one turn were not executed",
                    ),
                )
                for call in turn.tool_calls[MAX_TOOL_CALLS_PER_TURN:]
            ]
            asks: list[PendingCall] = []
            auto: list[tuple[ProviderToolCall, NormalizedToolResult]] = []
            for call in batch:
                kind, pending = self._classify_call(call)
                if self.state.cancelled:
                    raise AgentRunError("ANSWER_CANCELLED", "run was cancelled")
                if kind == "unknown":
                    auto.append(
                        (
                            call,
                            tool_error_result(
                                "UNKNOWN_TOOL",
                                f"unknown tool '{call.name}'. Registered tools only.",
                            ),
                        )
                    )
                elif call.malformed_arguments:
                    auto.append(
                        (
                            call,
                            tool_error_result(
                                "MALFORMED_TOOL_ARGUMENTS",
                                "arguments were not valid JSON",
                            ),
                        )
                    )
                elif kind == "builtin":
                    if self.state.tool_call_count >= MAX_TOTAL_TOOL_CALLS:
                        auto.append(
                            (call, tool_error_result("TOOL_BUDGET_EXHAUSTED", "tool budget reached"))
                        )
                    else:
                        self.state.tool_call_count += 1
                        auto.append((call, self._execute_builtin(call.name, call.arguments)))
                elif kind == "mcp_auto":
                    if self.state.tool_call_count >= MAX_TOTAL_TOOL_CALLS:
                        auto.append(
                            (call, tool_error_result("TOOL_BUDGET_EXHAUSTED", "tool budget reached"))
                        )
                    else:
                        self.state.tool_call_count += 1
                        assert pending is not None
                        auto.append((call, self._execute_mcp(pending)))
                else:
                    asks.append(pending)  # type: ignore[arg-type]
            if asks:
                # Hold every already-executed auto result plus the pending
                # approvals; nothing ask-classified has run yet.
                self._append_assistant_and_results(turn, [*auto, *overflow_results])
                for pending in asks:
                    self.state.pending[pending.call_id] = pending
                return {
                    "status": "approval_required",
                    "calls": [self._call_descriptor(p) for p in asks],
                }
            self._append_assistant_and_results(turn, [*auto, *overflow_results])

    def resume(self, decisions: list[dict[str, Any]]) -> dict[str, Any]:
        """Apply approval decisions then continue the loop."""
        with self.state.lock:
            if self.state.cancelled:
                raise AgentRunError("RUN_CANCELLED", "run is cancelled")
            if not self.state.pending:
                raise AgentRunError("RUN_NOT_WAITING", "run has no pending approvals")
            provided_ids = [str(d.get("call_id")) for d in decisions]
            if len(provided_ids) != len(set(provided_ids)):
                raise AgentRunError("DUPLICATE_DECISION", "duplicate call_id in decisions")
            pending_ids = set(self.state.pending.keys())
            if set(provided_ids) != pending_ids:
                raise AgentRunError(
                    "DECISION_MISMATCH",
                    "decisions must cover exactly the pending calls",
                )
            results: list[tuple[ProviderToolCall, NormalizedToolResult]] = []
            session_grants: list[str] = []
            for decision in decisions:
                call_id = str(decision["call_id"])
                choice = str(decision.get("decision"))
                pending = self.state.pending[call_id]
                if pending.call_id in self.state.executed_call_ids:
                    # Idempotency guard: never double-execute a side effect.
                    results.append(
                        (
                            ProviderToolCall(id=call_id, name=pending.alias),
                            tool_error_result(
                                "CALL_ALREADY_EXECUTED",
                                "this call was already processed",
                            ),
                        )
                    )
                    continue
                self.state.executed_call_ids.add(call_id)
                call = ProviderToolCall(
                    id=call_id,
                    name=pending.alias,
                    arguments=pending.arguments,
                )
                if choice == "reject":
                    self.state.activity.append(
                        ActivityEntry(
                            tool_name=pending.alias,
                            server_name=pending.server_name,
                            status="rejected",
                            duration_ms=0,
                        )
                    )
                    results.append(
                        (
                            call,
                            tool_error_result(
                                "USER_REJECTED_TOOL_CALL",
                                "the user declined this tool call",
                            ),
                        )
                    )
                elif choice in {"allow_once", "allow_session"}:
                    if choice == "allow_session":
                        session_grants.append(pending.alias)
                    if self.state.tool_call_count >= MAX_TOTAL_TOOL_CALLS:
                        results.append(
                            (
                                call,
                                tool_error_result(
                                    "TOOL_BUDGET_EXHAUSTED",
                                    "tool budget reached",
                                ),
                            )
                        )
                        continue
                    self.state.tool_call_count += 1
                    results.append((call, self._execute_mcp(pending)))
                else:
                    raise AgentRunError(
                        "INVALID_DECISION",
                        "decision must be allow_once, allow_session, or reject",
                    )
            # The assistant message holding these tool_calls was appended when
            # the boundary was hit; attach only the new tool results.
            for call, result in results:
                self.state.messages.append(self._result_message(call, result))
            self.state.pending.clear()
            for grant in session_grants:
                self.session_allowed.add(grant)
        return self.advance()

    # ------------------------------------------------------------------
    # Finalization
    # ------------------------------------------------------------------

    def _complete_with_text(self, text: str) -> dict[str, Any]:
        stripped = (text or "").strip()
        if not stripped:
            raise AgentRunError("LLM_BAD_RESPONSE", "Provider returned an empty answer")
        return {
            "status": "complete",
            "text": stripped,
            "sources": list(self.sources),
            "turns": self.state.turns,
            "tool_calls": self.state.tool_call_count,
            "activity": [entry.to_dict() for entry in self.state.activity],
        }

    def _finalize_forced(self) -> dict[str, Any]:
        self.state.messages.append(
            {
                "role": "user",
                "content": (
                    "No more tool calls are allowed. Write the final answer "
                    "now, citing [S#] sources you were given."
                ),
            }
        )
        try:
            turn = self._complete_turn(
                system=self.system_prompt,
                messages=self.state.messages,
                tools=[],
                max_output_tokens=self.max_output_tokens,
                timeout_seconds=self.timeout_seconds,
            )
        except Exception as exc:
            raise AgentRunError(
                getattr(exc, "code", "LLM_BAD_RESPONSE"),
                getattr(exc, "message", str(exc)),
            ) from exc
        return self._complete_with_text(turn.text)

    def _call_descriptor(self, pending: PendingCall) -> dict[str, Any]:
        return {
            "call_id": pending.call_id,
            "tool_name": pending.alias,
            "server_name": pending.server_name,
            "display_name": pending.display_name,
            "description": pending.description or "",
            "arguments": pending.arguments,
            "annotations": pending.annotations,
        }


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


class AgentRunRegistry:
    """Bounded registry of live runs with approval-TTL cleanup."""

    def __init__(self, max_active: int = MAX_ACTIVE_RUNS) -> None:
        self._runs: dict[str, tuple[StructuredAgentRun, float]] = {}
        self._max_active = max_active
        self._lock = threading.Lock()

    def add(self, run: StructuredAgentRun) -> None:
        with self._lock:
            self.sweep_expired_locked()
            if len(self._runs) >= self._max_active:
                raise AgentRunError(
                    "TOO_MANY_RUNS", "too many concurrent answers are waiting"
                )
            self._runs[run.state.run_id] = (run, time.monotonic())

    def get(self, run_id: str) -> StructuredAgentRun:
        with self._lock:
            entry = self._runs.get(run_id)
            if entry is not None and time.monotonic() - entry[1] > APPROVAL_TTL_SECONDS:
                del self._runs[run_id]
                entry[0].state.cancelled = True
                raise AgentRunError("RUN_EXPIRED", "approval window elapsed")
            self.sweep_expired_locked()
            entry = self._runs.get(run_id)
            if entry is None:
                raise AgentRunError(
                    "RUN_NOT_FOUND", f"unknown or expired run '{run_id}'"
                )
            return entry[0]

    def touch(self, run_id: str) -> None:
        with self._lock:
            entry = self._runs.get(run_id)
            if entry is not None:
                self._runs[run_id] = (entry[0], time.monotonic())

    def remove(self, run_id: str) -> StructuredAgentRun | None:
        with self._lock:
            entry = self._runs.pop(run_id, None)
            return entry[0] if entry else None

    def sweep_expired_locked(self) -> None:
        now = time.monotonic()
        expired = [
            rid
            for rid, (_run, created) in self._runs.items()
            if now - created > APPROVAL_TTL_SECONDS
        ]
        for rid in expired:
            run, _created = self._runs.pop(rid)
            run.state.cancelled = True

    def count(self) -> int:
        with self._lock:
            return len(self._runs)

    def close_all(self) -> None:
        with self._lock:
            for run, _ in self._runs.values():
                run.state.cancelled = True
            self._runs.clear()


def build_system_prompt(
    *,
    project_rules: str,
    skills: SkillRegistry | None,
    has_mcp_tools: bool,
) -> str:
    catalog_lines = skills.catalog_lines() if skills is not None else []
    return build_agent_system_prompt(
        project_rules=project_rules,
        skill_catalog_lines=catalog_lines,
        has_mcp_tools=has_mcp_tools,
        has_skills=bool(catalog_lines),
    )


def new_run_state(query: str) -> RunState:
    return RunState(run_id=str(uuid.uuid4()), query=query)
