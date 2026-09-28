# LangChain Deep Agents Python Reference

> **Snapshot date:** 20 September 2026  
> **Primary source:** [Deep Agents overview](https://docs.langchain.com/oss/python/deepagents/overview)  
> **Documentation index:** [Deep Agents documentation index](https://docs.langchain.com/oss/python/deepagents/llms.txt)  
> **API reference:** [Deep Agents Python API reference](https://reference.langchain.com/python/deepagents/)  
>
> This is an implementation-oriented reference based on the official LangChain Deep Agents Python documentation. Deep Agents, LangChain, LangGraph, model providers, and protocol integrations change independently; use the linked source pages and current API reference as the authority before production deployment.

## Contents

1. [Quick start and architecture](#1-quick-start-and-architecture)
2. [Agent creation and configuration API](#2-agent-creation-and-configuration-api)
3. [Models and provider configuration](#3-models-and-provider-configuration)
4. [Prompts, profiles, and customization](#4-prompts-profiles-and-customization)
5. [Tools and MCP](#5-tools-and-mcp)
6. [Virtual filesystem and backends](#6-virtual-filesystem-and-backends)
7. [Permissions and security](#7-permissions-and-security)
8. [Subagents](#8-subagents)
9. [Async and dynamic subagents](#9-async-and-dynamic-subagents)
10. [Memory](#10-memory)
11. [Skills](#11-skills)
12. [Retrieval, RAG, and rubrics](#12-retrieval-rag-and-rubrics)
13. [Context engineering](#13-context-engineering)
14. [Streaming and events](#14-streaming-and-events)
15. [Human-in-the-loop](#15-human-in-the-loop)
16. [Fault tolerance and production](#16-fault-tolerance-and-production)
17. [Sandboxes and interpreters](#17-sandboxes-and-interpreters)
18. [Multimodal inputs and outputs](#18-multimodal-inputs-and-outputs)
19. [A2A and ACP](#19-a2a-and-acp)
20. [Application patterns and tutorials](#20-application-patterns-and-tutorials)
21. [dcode, OpenWiki, and ecosystem tools](#21-dcode-openwiki-and-ecosystem-tools)
22. [Versioning, changelog, and migration](#22-versioning-changelog-and-migration)
23. [API identifier index](#23-api-identifier-index)
24. [A-Z topic index](#24-a-z-topic-index)
25. [Official source map](#25-official-source-map)

---

## 1. Quick start and architecture

### 1.1 Install

```bash
pip install deepagents
```

With `uv`:

```bash
uv init
uv add deepagents
uv sync
```

Optional capabilities:

```bash
pip install "deepagents[quickjs]"  # QuickJS interpreter and dynamic subagents
pip install "langchain[mcp]"       # MCP adapter and FastMCP support
pip install tavily-python          # Tavily search when provider-native search is not used
```

Deep Agents requires a chat model that supports tool calling. The QuickJS interpreter requires Python 3.11 or later.

### 1.2 Minimal agent

```python
from deepagents import create_deep_agent


def get_weather(city: str) -> str:
    """Get weather for a given city."""
    return f"It is sunny in {city}."


agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    tools=[get_weather],
    system_prompt="You are a helpful assistant.",
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "What is the weather in San Francisco?"}]}
)
print(result["messages"][-1].content)
```

### 1.3 Provider-native search tools

Google, OpenAI, and Anthropic provide built-in web-search tools that run server-side and do not require a separate search package or search API key:

```python
google_search = {"google_search": {}}
openai_search = {"type": "web_search"}
anthropic_search = {
    "type": "web_search_20260209",
    "name": "web_search",
}
```

Tavily can be wrapped as a normal Python callable when using another provider:

```python
import os
from typing import Literal

from tavily import TavilyClient


tavily_client = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])


def internet_search(
    query: str,
    max_results: int = 5,
    topic: Literal["general", "news", "finance"] = "general",
    include_raw_content: bool = False,
):
    """Run a web search."""
    return tavily_client.search(
        query,
        max_results=max_results,
        include_raw_content=include_raw_content,
        topic=topic,
    )
```

### 1.4 Run with a persistent thread

```python
config = {"configurable": {"thread_id": "research-001"}}

result = agent.invoke(
    {"messages": [{"role": "user", "content": "Research LangGraph."}]},
    config=config,
)
```

A `thread_id` scopes checkpoints and conversation state. Use a new identifier for a new conversation and reuse it to resume or continue an existing one.

### 1.5 Architecture

Deep Agents is an opinionated agent harness built on LangChain agents and the LangGraph runtime. `create_deep_agent` returns a compiled LangGraph state graph and assembles a middleware stack around the model and tools.

The main capability layers are:

| Layer | Capability |
|---|---|
| Execution environment | Tools, virtual filesystem access, optional sandboxed shell execution, and interpreter execution |
| Context management | Memory, skills, prompt caching, tool-result offloading, and conversation summarization |
| Delegation | Synchronous, asynchronous, and interpreter-driven subagents with isolated context windows |
| Steering | Human approval, structured output, runtime context, and custom middleware |
| Improvement | Long-term memory, reusable skills, rubrics, and usage-informed prompt changes |

The harness automatically provides filesystem and delegation tools when their corresponding middleware is active. Structured task planning with `write_todo` is opt-in through `TodoListMiddleware` in current releases.

### 1.6 Built-in execution tools

| Tool | Purpose | Availability |
|---|---|---|
| `ls` | List files and directories | Filesystem backend |
| `read_file` | Read paginated text or supported media files | Filesystem backend |
| `write_file` | Create or overwrite a file | Filesystem backend |
| `edit_file` | Perform exact string replacement | Filesystem backend |
| `delete` | Delete a file or recursively delete a directory | `deepagents>=0.7`; backend support required |
| `glob` | Find paths matching a glob | Filesystem backend |
| `grep` | Search file contents | Filesystem backend |
| `execute` | Run shell commands | Sandbox or local-shell backend |
| `task` | Spawn a synchronous subagent | At least one synchronous subagent |
| `write_todo` | Maintain a structured task list | `TodoListMiddleware` opt-in |

### 1.7 Typical execution flow

1. The model receives the caller's system prompt, built-in instructions, memory, skills, tool descriptions, and runtime context.
2. The model calls a user tool, a built-in filesystem tool, or `task`.
3. The harness executes the tool through its backend and appends the result to graph state.
4. Large tool results can be offloaded to the filesystem; growing conversation history can be summarized.
5. A subagent receives an isolated task context, performs its work, and returns a final result to the coordinator.
6. The coordinator synthesizes the result and produces the final assistant message.
7. Checkpoints, memory updates, skill files, and durable filesystem writes persist according to the selected backend and checkpointer.

---

## 2. Agent creation and configuration API

### 2.1 `create_deep_agent` signature

```python
create_deep_agent(
    model: str | BaseChatModel | None = None,
    tools: Sequence[BaseTool | Callable | dict[str, Any]] | None = None,
    *,
    system_prompt: str | SystemMessage | None = None,
    middleware: Sequence[AgentMiddleware[StateT_co, ContextT]] = (),
    subagents: Sequence[SubAgent | CompiledSubAgent | AsyncSubAgent] | None = None,
    skills: list[str] | None = None,
    memory: list[str] | None = None,
    permissions: list[FilesystemPermission] | None = None,
    backend: BackendProtocol | None = None,
    interrupt_on: dict[str, bool | InterruptOnConfig] | None = None,
    response_format: ResponseFormat[ResponseT] | type[ResponseT] | dict[str, Any] | None = None,
    state_schema: type[DeepAgentState] | None = None,
    context_schema: type[ContextT] | None = None,
    checkpointer: Checkpointer | None = None,
    store: BaseStore | None = None,
    debug: bool = False,
    name: str | None = None,
    cache: BaseCache | None = None,
) -> CompiledStateGraph[
    AgentState[ResponseT],
    ContextT,
    InputAgentState,
    OutputAgentState[ResponseT],
]
```

The complete API reference is [create_deep_agent](https://reference.langchain.com/python/deepagents/graph/create_deep_agent).

### 2.2 Parameter reference

| Parameter | Purpose and behavior |
|---|---|
| `model` | A `provider:model` string or a configured LangChain chat model. The model must support tool calling. |
| `tools` | Plain callables, LangChain tools, provider-native tool dictionaries, or MCP-discovered tools. |
| `system_prompt` | Caller instructions for the coordinator. The main agent also accepts a `SystemMessage` with structured content blocks. |
| `middleware` | Custom middleware merged into the Deep Agents stack. A matching `.name` replaces a built-in instance; unmatched entries are inserted after `PatchToolCallsMiddleware`. |
| `subagents` | Declarative `SubAgent` dictionaries, compiled graphs wrapped as `CompiledSubAgent`, or remote/background `AsyncSubAgent` definitions. |
| `skills` | Directories containing Agent Skills. Skill metadata is disclosed at startup and full skill content is loaded on demand. |
| `memory` | Paths to `AGENTS.md` files or other memory sources loaded into the prompt. Memory is injected rather than progressively disclosed. |
| `permissions` | `FilesystemPermission` rules controlling read, write, and interrupt behavior by path. |
| `backend` | Filesystem backend. The default is `StateBackend()`. |
| `interrupt_on` | Tool-level human-in-the-loop configuration. A checkpointer is required for interrupts and resume. |
| `response_format` | Structured output schema, such as a Pydantic model, provider strategy, tool strategy, or raw schema. |
| `state_schema` | Custom graph state schema. Subclass `DeepAgentState` to preserve the message reducer and built-in channels. |
| `context_schema` | Per-run runtime context schema for user IDs, tenant IDs, feature flags, or model selections. |
| `checkpointer` | LangGraph checkpointer for durable state, interruption resume, and cross-turn recovery. |
| `store` | LangGraph `BaseStore` used by durable backends such as `StoreBackend`. LangSmith Deployment provisions one automatically. |
| `debug` | Enables additional debugging behavior for local development. |
| `name` | Agent name used for metadata and tracing. |
| `cache` | LangChain cache used for model calls. |

### 2.3 Invocation input and output

The standard input is an agent-state dictionary containing a `messages` list:

```python
input_state = {
    "messages": [
        {"role": "user", "content": "Analyze the attached report."}
    ]
}

result = agent.invoke(input_state)
```

Use `agent.ainvoke` for asynchronous execution. `result["messages"][-1]` is normally the final assistant message. Structured output is returned according to `response_format`.

### 2.4 Runtime context

Define a context schema and pass immutable per-run values through `context=`:

```python
from dataclasses import dataclass
from deepagents import create_deep_agent


@dataclass
class Context:
    user_id: str
    tenant_id: str
    model: str = "google_genai:gemini-3.6-flash"


agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    context_schema=Context,
)

result = agent.invoke(
    input_state,
    context=Context(user_id="user-123", tenant_id="tenant-a"),
)
```

Runtime context propagates to subagents and tools. Tools can access it through `ToolRuntime.context`. Use separate namespaced fields when different subagents need different values.

### 2.5 Custom state

For mutable state that must participate in checkpointing, subclass `DeepAgentState` and pass it as `state_schema=`. Preserve the built-in `messages` reducer and avoid replacing required channels. Custom state is useful for application-specific counters, workflow state, or task metadata that should survive interruptions.

Use runtime context for immutable request data and graph state for data that the run itself creates or mutates.

### 2.6 Checkpointing and stores

- A checkpointer persists graph state by `thread_id` and enables crash recovery, human-in-the-loop pauses, and time travel.
- `MemorySaver` is suitable for local development.
- Production deployments should use a durable checkpointer and a durable `BaseStore` where cross-thread persistence is required.
- LangSmith Deployment provisions a store automatically; self-hosted deployments must provide one.

---

## 3. Models and provider configuration

### 3.1 Model identifier format

Use `provider:model` strings:

```python
agent = create_deep_agent(model="openai:gpt-5.5")
```

The provider prefix selects the LangChain integration. The portion after the first colon is passed to that provider as the model identifier. Additional colons belong to the model identifier, for example `my_provider:my-model:tag`.

Common provider prefixes include:

| Provider | Example |
|---|---|
| Google GenAI | `google_genai:gemini-3.6-flash` |
| OpenAI | `openai:gpt-5.5` |
| Anthropic | `anthropic:claude-sonnet-4-6` |
| Azure OpenAI | `azure_openai:gpt-5.5` |
| AWS Bedrock | `bedrock_converse:anthropic.claude-sonnet-4-6` |
| OpenRouter | `openrouter:z-ai/glm-5.2` |
| Fireworks | `fireworks:accounts/fireworks/models/glm-5p2` |
| Baseten | `baseten:zai-org/GLM-5.2` |
| Ollama | `ollama:north-mini-code-1.0` |

Provider credentials are read by the corresponding LangChain integration, commonly through environment variables such as `GOOGLE_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`. Never hardcode credentials in source or commit them.

### 3.2 Suggested models

The official models page lists models evaluated by the Deep Agents eval suite. The suite tests basic agent operations, including file operations, retrieval, tool use, memory, conversation, and summarization. Passing the suite is necessary but not sufficient for strong performance on long, domain-specific tasks.

| Provider | Suggested models |
|---|---|
| Google | `gemini-3.1-pro-preview`, `gemini-3.6-flash` |
| OpenAI | `gpt-5.5`, `gpt-5.4` |
| Anthropic | `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6` |
| Open-weight | `GLM-5.2`, `Kimi-K2.7 Code`, `MiniMax-M3` |

Open-weight models are available through providers such as Baseten, Fireworks, OpenRouter, and Ollama. Model identifiers and availability change frequently; verify the provider catalog and integration documentation.

### 3.3 Configure model parameters

Use `init_chat_model` when provider-specific parameters are needed:

```python
from langchain.chat_models import init_chat_model
from deepagents import create_deep_agent

model = init_chat_model(
    model="google_genai:gemini-3.6-flash",
    thinking_level="medium",
)
agent = create_deep_agent(model=model)
```

Alternatively, instantiate a provider model class directly:

```python
from langchain_google_genai import ChatGoogleGenerativeAI
from deepagents import create_deep_agent

model = ChatGoogleGenerativeAI(
    model="gemini-3.6-flash",
    thinking_level="medium",
)
agent = create_deep_agent(model=model)
```

Available parameters vary by provider. Provider profiles can supply initialization defaults when a model string is used.

### 3.4 Provider profiles

A `ProviderProfile` affects model construction, not harness behavior:

```python
from deepagents import ProviderProfile, register_provider_profile

register_provider_profile(
    "openai",
    ProviderProfile(init_kwargs={"temperature": 0}),
)

register_provider_profile(
    "openai:gpt-5.5",
    ProviderProfile(init_kwargs={"reasoning_effort": "medium"}),
)
```

A provider-level key applies to all models from that provider. A model-level key applies to one model and merges over the provider-level profile. Provider profiles apply to `provider:model` strings; they do not change an already constructed model instance.

Fields include:

- `init_kwargs`: static arguments forwarded to `init_chat_model`.
- `pre_init`: side effects run before construction, such as credential validation.
- `init_kwargs_factory`: runtime-derived initialization arguments.

### 3.5 OpenAI Responses API

When an `openai:...` string is passed, Deep Agents uses the built-in OpenAI provider profile and the Responses API by default. To use Chat Completions instead, pass a configured model instance:

```python
from langchain.chat_models import init_chat_model
from deepagents import create_deep_agent

model = init_chat_model(
    "openai:gpt-5.5",
    use_responses_api=False,
)
agent = create_deep_agent(model=model)
```

To use the Responses API with retention disabled while retaining encrypted reasoning content:

```python
model = init_chat_model(
    "openai:gpt-5.5",
    use_responses_api=True,
    store=False,
    include=["reasoning.encrypted_content"],
)
```

### 3.6 Runtime model selection

Use runtime context and `@wrap_model_call` middleware to select a model per invocation without rebuilding the graph:

```python
from dataclasses import dataclass
from typing import Callable

from langchain.agents.middleware import ModelRequest, ModelResponse, wrap_model_call
from langchain.chat_models import init_chat_model
from deepagents import create_deep_agent


@dataclass
class Context:
    model: str


@wrap_model_call
def configurable_model(
    request: ModelRequest,
    handler: Callable[[ModelRequest], ModelResponse],
) -> ModelResponse:
    model = init_chat_model(request.runtime.context.model)
    return handler(request.override(model=model))


agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    middleware=[configurable_model],
    context_schema=Context,
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "Hello"}]},
    context=Context(model="openai:gpt-5.5"),
)
```

---

## 4. Prompts, profiles, and customization

### 4.1 System prompt

The caller's `system_prompt` is placed at the front of the assembled prompt. The harness then adds built-in instructions and prompts contributed by memory, skills, filesystem tools, subagents, middleware, and human-in-the-loop handling.

```python
research_instructions = """\
You are an expert researcher. Conduct thorough research,
verify important claims, and produce a polished report with citations.
"""

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    system_prompt=research_instructions,
)
```

The main agent accepts a string or a `SystemMessage`. Structured content blocks in a `SystemMessage` are preserved. Declarative subagent prompts are strings.

### 4.2 Prompt assembly order

The effective prompt is assembled from these layers:

1. Caller-supplied `system_prompt`.
2. Base agent instructions.
3. Memory prompt, including `AGENTS.md` content.
4. Skill metadata and invoked skill content.
5. Virtual filesystem instructions.
6. Subagent instructions.
7. Middleware-specific instructions.
8. Human-in-the-loop instructions.

Use concise memory and avoid placing large mutable policy documents directly in the base prompt. Use skills or retrieval for progressively disclosed knowledge.

### 4.3 Harness profiles

A `HarnessProfile` changes the assembled harness for a provider or model:

```python
from deepagents import (
    GeneralPurposeSubagentProfile,
    HarnessProfile,
    register_harness_profile,
)

register_harness_profile(
    "openai:gpt-5.5",
    HarnessProfile(
        base_system_prompt="You are a concise research coordinator.",
        system_prompt_suffix="Respond in under 500 words.",
        excluded_tools=frozenset({"execute"}),
        excluded_middleware=frozenset({"SummarizationMiddleware"}),
        general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
    ),
)
```

Fields:

| Field | Behavior |
|---|---|
| `base_system_prompt` | Replaces the base instructions for the applicable agent. For declarative subagents, it replaces the authored prompt. |
| `system_prompt_suffix` | Appends instructions after caller and base instructions. |
| `tool_description_overrides` | Per-tool description overrides. |
| `excluded_tools` | Removes named tools from the assembled tool set. |
| `excluded_middleware` | Removes matching middleware classes or names. Required scaffolding cannot be removed this way. |
| `extra_middleware` | Appends middleware to applicable stacks. |
| `general_purpose_subagent` | Disables, renames, or re-prompts the automatic general-purpose subagent. |

`FilesystemMiddleware`, `SubAgentMiddleware`, and internal permission middleware are required scaffolding. Listing them in `excluded_middleware` raises `ValueError`; use `excluded_tools` to hide their tools instead.

### 4.4 Profile lookup and merge rules

Profiles can be registered at two levels:

- Provider level: `"openai"` applies to every OpenAI model.
- Model level: `"openai:gpt-5.5"` applies only to that model.

When both exist, the model-level profile inherits unset fields from the provider-level profile and overrides explicitly set fields. Re-registering under the same key merges additively rather than replacing the prior profile.

| Field | Merge behavior |
|---|---|
| `base_system_prompt`, `system_prompt_suffix` | New value wins when set; otherwise inherit |
| `tool_description_overrides` | Per-key merge; new value wins |
| `excluded_tools`, `excluded_middleware` | Set union |
| `extra_middleware` | Merge by concrete type; replacement or append |
| `general_purpose_subagent` | Field-wise merge |
| Provider `init_kwargs` | Key-wise dictionary merge |
| Provider `pre_init` | Existing callable runs first, then new callable |
| Provider `init_kwargs_factory` | Factories chain and their outputs merge |

There is no wildcard profile key. Register global behavior at the `create_deep_agent` call site or register the same adjustment for each provider used.

### 4.5 Declarative profile configuration

`HarnessProfileConfig` provides a serializable subset for YAML or JSON configuration:

```yaml
base_system_prompt: You are helpful.
system_prompt_suffix: Respond briefly.
excluded_tools:
  - execute
  - grep
excluded_middleware:
  - SummarizationMiddleware
general_purpose_subagent:
  enabled: false
```

```python
import yaml
from deepagents import HarnessProfileConfig, register_harness_profile

with open("openai.yaml") as f:
    register_harness_profile(
        "openai",
        HarnessProfileConfig.from_dict(yaml.safe_load(f)),
    )
```

Runtime-only values such as middleware instances and initialization factories remain on `HarnessProfile`.

### 4.6 Profile plugins

Packages can register profiles through Python entry points:

```toml
[project.entry-points."deepagents.harness_profiles"]
my_provider = "my_pkg.profiles:register_harness"

[project.entry-points."deepagents.provider_profiles"]
my_provider = "my_pkg.profiles:register_provider"
```

Each entry point resolves to a zero-argument registration function. Load order is built-ins, entry-point plugins, then direct registration calls.

### 4.7 Deep Agents middleware stack

The main-agent stack is ordered as follows:

1. `SkillsMiddleware`, when skills are configured.
2. `FilesystemMiddleware`, including permission enforcement when configured.
3. `SubAgentMiddleware`, when at least one synchronous subagent exists.
4. `SummarizationMiddleware`.
5. `PatchToolCallsMiddleware`.
6. `AsyncSubAgentMiddleware`, when async subagents are configured.
7. Caller-supplied middleware, with matching instances replacing built-ins in place.
8. Harness-profile extras.
9. Excluded-tool filtering.
10. Anthropic and Bedrock prompt-caching middleware.
11. `MemoryMiddleware`, when memory is configured.
12. `HumanInTheLoopMiddleware`, when interrupts are configured.

Prompt-caching middleware is registered even for unsupported models and safely no-ops when the model does not support caching.

### 4.8 Synchronous subagent stack

A synchronous subagent uses a similar stack but:

- Runs `SkillsMiddleware` after `PatchToolCallsMiddleware`.
- Does not include `SubAgentMiddleware`, because only the parent exposes the `task` tool.
- Applies its own permissions, model, middleware, skills, and response format according to its subagent specification.

### 4.9 Custom middleware

Use `@wrap_tool_call`, `@tool`, or an `AgentMiddleware` implementation to add cross-cutting behavior such as logging, validation, rate limiting, or telemetry. Store cross-run or concurrent state in graph state or an external store rather than mutable fields on a shared middleware object.

```python
from langchain.agents.middleware import wrap_tool_call
from langchain.tools import tool
from deepagents import create_deep_agent


@tool
def get_weather(city: str) -> str:
    """Get the weather in a city."""
    return f"The weather in {city} is sunny."


@wrap_tool_call
def log_tool_calls(request, handler):
    result = handler(request)
    return result


agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    tools=[get_weather],
    middleware=[log_tool_calls],
)
```

---

## 5. Tools and MCP

### 5.1 Custom tools

Pass plain Python callables, LangChain `@tool` functions, `StructuredTool` objects, provider-native tool dictionaries, or MCP-discovered tools through `tools=`. Deep Agents normally infers a JSON schema from the function signature, type hints, and docstring.

```python
from deepagents import create_deep_agent
from langchain.tools import tool


@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    return f"The weather in {city} is sunny."


agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    tools=[get_weather],
)
```

Tool design guidelines:

- Keep each tool focused on one action and give it a precise name and docstring.
- Use typed parameters and return values so the model receives a useful schema.
- Validate untrusted arguments before calling external APIs or filesystem code.
- Keep secrets in server-side configuration; do not put credentials in tool descriptions or prompts.
- Return concise, structured results. Offload large results to the filesystem when appropriate.
- Use a tool dictionary only when the provider or integration explicitly documents that format.

Provider-native search dictionaries used by the quickstart include:

```python
google_search = {"google_search": {}}
openai_search = {"type": "web_search"}
anthropic_search = {"type": "web_search_20260209", "name": "web_search"}
```

### 5.2 Tool return values

A tool can return a string for a text-only result or an ordered list of standard content blocks for multimodal output. Supported block types include text, image, audio, video, and file content when the selected model supports them.

```python
def inspect_image(path: str) -> list[dict]:
    """Return an image content block for the model."""
    return [{"type": "image", "path": path}]
```

The exact block schema depends on the LangChain model integration. Prefer the model's documented content-block format and test both success and failure paths.

### 5.3 MCP tools

Install the MCP extra:

```bash
pip install "langchain[mcp]"
```

Discover tools through `MCPAdapter` and pass the resulting tools to `create_deep_agent`:

```python
import asyncio

from deepagents import create_deep_agent
from langchain.mcp import MCPAdapter


async def main():
    config = {
        "mcpServers": {
            "docs": {"url": "http://localhost:8000/mcp"},
        }
    }

    async with MCPAdapter(config) as adapter:
        tools = await adapter.list_tools()
        agent = create_deep_agent(
            model="google_genai:gemini-3.6-flash",
            tools=tools,
        )
        result = await agent.ainvoke(
            {
                "messages": [
                    {"role": "user", "content": "Use the MCP server to answer my question."}
                ]
            },
            config={"configurable": {"thread_id": "mcp-1"}},
        )
        print(result["messages"][-1].content)


asyncio.run(main())
```

`MCPAdapter` is an asynchronous context manager. `list_tools()` must run while the adapter context is open. The discovered tool objects retain the underlying client, so the agent can invoke them after the context exits.

#### Transport inference

| Adapter target | Transport |
|---|---|
| `str` containing an HTTP(S) URL | Streamable HTTP |
| `Path` to a script | stdio subprocess |
| `FastMCP` instance | In-process server |
| `StreamableTransport` | Preconfigured transport |
| `MCPConfig` dictionary | Multiple MCP servers |
| `fastmcp.Client` | Client with explicit configuration |

A string target must look like an HTTP or HTTPS URL. A string that resembles a filesystem script can be interpreted as a stdio target, so use an explicit `Path`, client, or transport object when ambiguity matters.

The `langchain.mcp` namespace is beta and requires the current LangChain MCP integration. Authentication, OAuth 2.1, Bearer tokens, tool filtering, and stateful sessions are configured through the broader LangChain MCP guide rather than the Deep Agents page.

### 5.4 Built-in harness tools

The harness adds file and delegation tools around the selected backend:

| Tool | Input/output notes |
|---|---|
| `ls` | Lists a directory and returns structured file information. |
| `read_file` | Supports offset/limit pagination and native image blocks for supported image files. |
| `write_file` | Creates or overwrites a file. Sensitive writes should use permissions or HITL. |
| `edit_file` | Performs exact replacement and can replace all occurrences. |
| `delete` | Removes a file or recursively removes a directory when supported by the backend. |
| `glob` | Finds paths matching a pattern. |
| `grep` | Searches file contents, optionally constrained by path or glob. |
| `execute` | Runs shell commands only when the backend implements sandbox execution. |
| `task` | Invokes a named synchronous subagent. |

Tool availability is dynamic: an unsupported backend operation is hidden or returns an error according to the backend protocol.

---

## 6. Virtual filesystem and backends

### 6.1 Backend selection

Pass a backend through `backend=`. If omitted, Deep Agents uses `StateBackend()`.

```python
from deepagents import create_deep_agent
from deepagents.backends import StateBackend

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    backend=StateBackend(),
)
```

| Backend | Persistence and use |
|---|---|
| `StateBackend` | Default; files live in LangGraph state for the current thread and persist across turns when checkpointed. |
| `FilesystemBackend` | Reads and writes real files under an absolute `root_dir`; use `virtual_mode=True` for path confinement. |
| `LocalShellBackend` | Adds host shell execution to filesystem access; no isolation, so use only in trusted development environments. |
| `StoreBackend` | Stores files in a LangGraph `BaseStore` for cross-thread durability. |
| `ContextHubBackend` | Stores files in a LangSmith Context Hub repository with commit history. |
| Sandbox backends | Add isolated filesystem access and an `execute` tool; providers include LangSmith, Daytona, E2B, Modal, Runloop, Vercel, AgentCore, and OpenShell integrations. |
| `CompositeBackend` | Routes path prefixes to different backends and aggregates listings/search results. |

### 6.2 StateBackend

`StateBackend` is appropriate for scratch files, offloaded tool results, and conversation artifacts that should remain scoped to one thread. Subagents share the state backend, so files written by a child remain available to the parent and later children.

Calls such as `state_backend.upload_files(...)` are graph-context dependent. Invoke them during a graph run or use the appropriate backend/file transfer path for application-side setup.

### 6.3 FilesystemBackend

```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    backend=FilesystemBackend(
        root_dir="C:\\work\\agent-root",
        virtual_mode=True,
    ),
)
```

`virtual_mode=True` normalizes paths and confines them under `root_dir`, blocking traversal such as `..`, home-directory shortcuts, and absolute paths outside the root. `virtual_mode=False` provides no meaningful path security even when `root_dir` is set.

Use a dedicated directory, remove secrets from the accessible tree, and combine path confinement with permissions and human approval for sensitive operations. A local filesystem backend is not appropriate for an internet-facing production API that processes untrusted input.

### 6.4 LocalShellBackend

`LocalShellBackend` extends filesystem access with host shell execution:

```python
from deepagents.backends import LocalShellBackend

backend = LocalShellBackend(
    root_dir="C:\\work\\agent-root",
    virtual_mode=True,
    env={"PATH": "C:\\Windows\\System32"},
    timeout=120,
    max_output_bytes=100_000,
)
```

Commands run through the host process with the configured environment and working directory. `virtual_mode` does not isolate shell commands from the rest of the host. Use a remote or isolated sandbox for production code execution.

### 6.5 StoreBackend and namespace factories

`StoreBackend` provides durable cross-thread storage through a LangGraph `BaseStore`:

```python
from deepagents import create_deep_agent
from deepagents.backends import StoreBackend
from langgraph.store.memory import InMemoryStore

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    backend=StoreBackend(
        namespace=lambda rt: (rt.server_info.user.identity,),
    ),
    store=InMemoryStore(),
)
```

Use an explicit namespace factory in multi-user deployments. Common scopes are:

```python
# Per user
namespace=lambda rt: (rt.server_info.user.identity,)

# Per assistant
namespace=lambda rt: (rt.server_info.assistant_id,)

# Per thread
namespace=lambda rt: (rt.execution_info.thread_id,)

# Per tenant or organization
namespace=lambda rt: (rt.context.org_id,)
```

The runtime exposes `rt.context`, `rt.server_info`, and `rt.execution_info`. Namespace components must use the characters allowed by the store implementation; avoid wildcard characters that could be interpreted as globs.

When deploying through LangSmith, omit the local `store=` argument if the platform provisions the store automatically.

### 6.6 ContextHubBackend

`ContextHubBackend("owner/repo")` mounts a LangSmith Context Hub repository at the agent filesystem root. Linked skill repositories appear under `/skills/`. It lazily loads the repository, caches reads, and writes changes as commits using optimistic parent-commit updates.

Set `LANGSMITH_API_KEY` before use. A concurrent writer can advance the repository between reads; on a parent-commit conflict, re-pull and retry. `upload_files()` accepts UTF-8 text; non-UTF-8 files are rejected per path.

### 6.7 CompositeBackend

Use `CompositeBackend` to combine thread-scoped and durable storage:

```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend
from langgraph.store.memory import InMemoryStore

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    backend=CompositeBackend(
        default=StateBackend(),
        routes={
            "/memories/": StoreBackend(
                namespace=lambda rt: (rt.server_info.user.identity,),
            ),
            "/workspace/": FilesystemBackend(
                root_dir="C:\\work\\agent-workspace",
                virtual_mode=True,
            ),
        },
    ),
    store=InMemoryStore(),
)
```

Longer prefixes win. `ls`, `glob`, and `grep` preserve original path prefixes while aggregating results. Keep internal paths such as `/large_tool_results/` and `/conversation_history/` on the default `StateBackend` unless persistent artifacts are explicitly required.

### 6.8 Custom backend protocol

A custom backend implements `BackendProtocol`:

| Method | Purpose |
|---|---|
| `ls(path) -> LsResult` | List files and directories. |
| `read(file_path, offset=0, limit=2000) -> ReadResult` | Read paginated content. |
| `write(file_path, content) -> WriteResult` | Create or overwrite content. |
| `edit(file_path, old_string, new_string, replace_all=False) -> EditResult` | Perform exact replacement. |
| `glob(pattern, path=None) -> GlobResult` | Find matching paths. |
| `grep(pattern, path=None, glob=None) -> GrepResult` | Search contents. |
| `delete(file_path) -> DeleteResult` | Optional recursive deletion. |

Return structured result objects with an `error` field for expected failures instead of raising for ordinary backend errors. To expose `execute`, implement `SandboxBackendProtocol`, which extends the filesystem protocol.

### 6.9 File transfer APIs

Sandbox and backend integrations may expose:

```python
upload_files(files: list[tuple[str, bytes]]) -> list[FileUploadResponse]
download_files(paths: list[str]) -> list[FileDownloadResponse]
aupload_files(...)
adownload_files(...)
```

Responses are per-item and include an `error` field. Downloads return file bytes. Application code and agent tools operate on different file planes: use backend transfer methods for host-to-sandbox setup and built-in filesystem tools for agent-side reads and writes.

---

## 7. Permissions and security

### 7.1 FilesystemPermission

`FilesystemPermission` controls filesystem operations by path:

```python
from deepagents import FilesystemPermission, create_deep_agent

permissions = [
    FilesystemPermission(
        operations=["read"],
        paths=["/workspace/**"],
        mode="allow",
    ),
    FilesystemPermission(
        operations=["write"],
        paths=["/workspace/tmp/**"],
        mode="allow",
    ),
    FilesystemPermission(
        operations=["write"],
        paths=["/workspace/protected/**"],
        mode="deny",
    ),
]

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    permissions=permissions,
)
```

Fields:

| Field | Values and meaning |
|---|---|
| `operations` | `read`, `write`, or both. Read covers `ls`, `read_file`, `glob`, and `grep`; write covers `write_file`, `edit_file`, and `delete`. |
| `paths` | Path patterns evaluated by the permission middleware. |
| `mode` | `allow`, `deny`, or `interrupt`. |

Rules are evaluated in order and the first matching rule wins. If no rule matches, the default behavior is permissive unless the backend or surrounding deployment imposes stricter controls.

### 7.2 Interrupting filesystem operations

```python
FilesystemPermission(
    operations=["write"],
    paths=["/secrets/**"],
    mode="interrupt",
)
```

`mode="interrupt"` requires a checkpointer and integrates with the human-in-the-loop middleware. It lets a reviewer approve, edit, reject, or respond before the operation executes.

### 7.3 Subagent permissions

A subagent inherits the parent permissions by default. Supplying a `permissions` list on the subagent replaces the parent rules entirely. Use explicit, narrow rules for children that handle untrusted data or external systems.

### 7.4 Composite-backend considerations

Permission paths must be scoped under route prefixes when using composite backends. Unscoped paths can be unsupported by the permission middleware. Test each route and operation independently, especially when a deny rule overlaps a more specific allow rule.

### 7.5 Sandbox security boundaries

A sandbox backend isolates code execution from the host, but it does not automatically prevent context injection, network exfiltration, or malicious tool use. Recommended controls include:

- Keep provider and application secrets outside the sandbox.
- Use host-side tools or a credential-injecting proxy rather than copying secrets into agent-visible files.
- Disable or restrict network access where the sandbox provider supports it.
- Use narrow filesystem permissions and human approval for writes.
- Treat retrieved documents and user-provided files as untrusted data.
- Run multi-tenant workloads in separate sandboxes or isolated threads.
- Prefer thread-scoped sandboxes for untrusted work; assistant-scoped sandboxes require careful snapshot and cleanup policies.

### 7.6 Local backend warning

`FilesystemBackend` and `LocalShellBackend` can expose host files and commands. `LocalShellBackend` is especially dangerous with untrusted prompts because shell commands run with host permissions. Use it only for trusted local development or tightly controlled CI environments.

---

## 8. Subagents

### 8.1 Why delegate

Subagents quarantine detailed tool work in a separate context window. The coordinator receives the final result rather than every intermediate search, file read, or tool call. Delegation is useful for specialized domains, multi-step work, different models, and context-heavy investigations. It adds overhead and is not appropriate for every simple task.

### 8.2 Automatic general-purpose subagent

Deep Agents automatically adds a synchronous `general-purpose` subagent unless a caller-provided synchronous subagent already has that name. It has filesystem tools by default and inherits the main model and skills.

To replace it, provide a subagent named `general-purpose`. To rename or re-prompt it, configure `GeneralPurposeSubagentProfile` on the active harness profile. To disable it:

```python
from deepagents import (
    GeneralPurposeSubagentProfile,
    HarnessProfile,
    register_harness_profile,
)

register_harness_profile(
    "google_genai:gemini-3.6-flash",
    HarnessProfile(
        general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
    ),
)
```

Also pass no synchronous subagents through `subagents=`. `SubAgentMiddleware` and the `task` tool are attached only when at least one synchronous subagent exists. Do not attempt to remove `SubAgentMiddleware` with `excluded_middleware`; that raises `ValueError`.

### 8.3 Declarative subagent specification

```python
research_subagent = {
    "name": "research-agent",
    "description": "Researches a question deeply and returns cited findings.",
    "system_prompt": "You are a careful researcher. Cite sources and distinguish facts from inference.",
    "tools": [internet_search],
    "model": "openai:gpt-5.5",
}

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    subagents=[research_subagent],
)
```

| Field | Behavior |
|---|---|
| `name` | Required, unique identifier used by the parent `task` tool and in metadata/streaming. |
| `description` | Required, action-oriented text used by the coordinator to select the subagent. |
| `system_prompt` | Required for isolated subagents; it does not inherit the parent prompt. |
| `mode` | `isolated` by default; `fork` inherits parent conversation context. |
| `tools` | Replaces inherited tools entirely when supplied. Keep the set minimal. |
| `model` | Optional string or chat-model instance overriding the parent model. |
| `middleware` | Additional middleware; it does not inherit the parent middleware stack. |
| `interrupt_on` | Human approval configuration; inherits from parent unless overridden. |
| `skills` | Skill source paths; custom subagents do not inherit parent skills. |
| `response_format` | Structured output schema for the child result. |
| `permissions` | Replaces parent filesystem permissions when supplied. |

### 8.4 CompiledSubAgent

Use `CompiledSubAgent` when the child is a complex prebuilt LangGraph graph:

```python
from deepagents import CompiledSubAgent, create_deep_agent
from langchain.agents import create_agent

custom_graph = create_agent(
    model="openai:gpt-5.5",
    tools=[],
    system_prompt="You analyze structured data.",
)

custom_subagent = CompiledSubAgent(
    name="data-analyzer",
    description="Analyzes complex structured data.",
    runnable=custom_graph,
)

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    subagents=[custom_subagent],
)
```

The runnable must be compiled and its state must include a `messages` key. `CompiledSubAgent` supports `name`, `description`, `runnable`, and `mode`.

### 8.5 Isolated versus forked mode

| Dimension | Isolated | Forked |
|---|---|---|
| Context | Only delegated task description | Parent conversation history and system prompt |
| Skills | Explicit or inherited only for general-purpose | Not configurable; `skills` is rejected |
| `task` tool | Available | Not available |
| Best use | Focused independent work | Continuing an investigation already started |

Forked subagents require `deepagents>=0.7.13` and are beta. The parent delegation call is removed and replaced with a continuation preamble. A forked subagent's `system_prompt`, if supplied, is appended as an addendum and can reduce prompt-cache reuse.

```python
comment_writer = {
    "name": "comment-writer",
    "description": "Continues a PR review and drafts review comments.",
    "mode": "fork",
    "tools": [read_diff],
}
```

### 8.6 Structured subagent output

Set `response_format` on a declarative subagent to receive a structured result instead of free-form text. The parent can then validate the result before synthesis. Use a schema that contains the evidence and citations needed for downstream decisions.

### 8.7 Context propagation

Runtime context passed to the parent `invoke` propagates to subagents and their tools. Define `context_schema` on the parent and pass a context instance. Use namespaced fields when children need separate tenant, user, or model values.

Inside a tool, read `ToolRuntime.context`. Tool metadata can expose the active agent name through the LangChain config metadata, which is useful for scoped logging and audit trails.

---

## 9. Async and dynamic subagents

### 9.1 Async subagents

Async subagents are background tasks. The supervisor can start a task, continue interacting with the user, and later check, update, cancel, or list tasks.

```python
from deepagents import AsyncSubAgent, create_deep_agent

researcher = AsyncSubAgent(
    name="researcher",
    description="Researches a topic in the background.",
    graph_id="researcher",
    url="https://example-langgraph-server.invalid/researcher",
)

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    subagents=[researcher],
)
```

`graph_id` identifies the subagent graph in the LangGraph deployment. Omit `url` for an ASGI co-deployed graph; provide a URL for HTTP transport.

The async middleware exposes:

| Tool | Purpose |
|---|---|
| `start_async_task` | Start a background task and return a task ID immediately. |
| `check_async_task` | Read status and result. |
| `update_async_task` | Send follow-up instructions and restart or steer the task. |
| `cancel_async_task` | Stop a running task. |
| `list_async_tasks` | List tasks and live statuses. |

Task metadata is stored in a dedicated `async_tasks` state channel so it survives context compaction. Fields include `task_id`, `agent_name`, `thread_id`, `run_id`, `status`, and timestamps.

Deployment topologies:

- **Single:** supervisor and subagents are in one `langgraph.json` deployment and use ASGI transport.
- **Split:** supervisor and subagents run on separate servers and use HTTP transport.
- **Hybrid:** combine ASGI and HTTP subagents.

For local development, allocate enough worker slots for the supervisor and every concurrent child; the documentation example uses `langgraph dev --n-jobs-per-worker 10` for a supervisor plus several subagents.

### 9.2 Dynamic subagents

Dynamic subagents dispatch children from interpreter code instead of relying only on individual model-selected `task` calls. This enables loops, branches, parallel batches, tournaments, and programmatic fan-out/synthesis.

Install and enable the QuickJS interpreter:

```bash
pip install -U "deepagents[quickjs]"
```

```python
from deepagents import create_deep_agent
from langchain_quickjs import CodeInterpreterMiddleware

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    subagents=[
        {
            "name": "reviewer",
            "description": "Reviews one file for security risks.",
            "system_prompt": "Return findings with file and line references.",
        }
    ],
    middleware=[CodeInterpreterMiddleware()],
)
```

Dynamic dispatch requires both configured subagents and `CodeInterpreterMiddleware`. It is beta, requires `langchain-quickjs>=0.2.0`, and requires Python 3.11 or later. Pass `CodeInterpreterMiddleware(subagents=False)` to force normal `task` tool dispatch.

The interpreter system prompt treats the word **workflow** as a useful signal for programmatic orchestration:

```python
result = agent.invoke(
    {
        "messages": [
            {
                "role": "user",
                "content": "Run a workflow that reviews every file in src/routes/ and summarizes the top risks.",
            }
        ]
    }
)
```

In interpreter code, use the built-in `task()` global:

```javascript
const result = await task({
  description: "Review this file for security issues.",
  subagentType: "reviewer",
  responseSchema: {
    type: "object",
    properties: {
      findings: { type: "array", items: { type: "string" } }
    }
  }
});
```

Programmatic tool calling (PTC) is opt-in. For example, `CodeInterpreterMiddleware(ptc=["glob"])` exposes a `tools.glob` bridge to interpreter code. PTC calls bypass the normal `interrupt_on` approval path, so do not grant PTC access to destructive or sensitive tools without an external guard.

### 9.3 Dynamic orchestration patterns

- **Classify and act:** classify items, then dispatch each class to a specialist.
- **Fan-out and synthesize:** process independent items in parallel and merge results.
- **Adversarial verification:** generate findings, then ask independent reviewers to verify them.
- **Generate and filter:** produce multiple proposals and retain only those passing a rubric.
- **Tournament:** compare candidates pairwise until one remains.
- **Loop until done:** repeat a bounded deduplication or review loop until no new findings appear.

Always set explicit iteration, concurrency, token, and time limits. Dynamic code can otherwise create unbounded delegation or excessive model cost.

---

## 10. Memory

### 10.1 Memory dimensions

Deep Agents distinguishes several forms of memory:

| Dimension | Options | Typical implementation |
|---|---|---|
| Duration | Short-term or long-term | Checkpointed conversation state versus durable store/files |
| Information type | Episodic, procedural, semantic | Run history, skills, facts, policies, or files |
| Scope | User, assistant, organization, thread | Namespace and context fields |
| Update timing | Hot path or background consolidation | Prompt/store writes during a run or a scheduled consolidation agent |
| Retrieval | Prompt injection or on demand | Memory prompt versus skill/retrieval lookup |
| Permissions | Read-write or read-only | Backend and permission rules |

Short-term memory is the current conversation state managed by LangGraph checkpoints. Long-term memory is cross-conversation knowledge stored in a durable backend.

### 10.2 Memory files and `AGENTS.md`

Pass memory paths through `memory=`. The harness loads `AGENTS.md` content into the prompt. Unlike skills, memory is injected at startup and is not progressively disclosed, so keep it small and stable.

```python
agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    memory=["./AGENTS.md"],
)
```

Use memory for concise identity, durable preferences, policies, and facts that should be available on every run. Put large or conditional knowledge in skills, retrieval, or a filesystem-backed knowledge source.

### 10.3 Long-term storage

A common durable layout routes `/memories/` to `StoreBackend` through `CompositeBackend`:

```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend
from langgraph.store.memory import InMemoryStore

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    backend=CompositeBackend(
        default=StateBackend(),
        routes={
            "/memories/": StoreBackend(
                namespace=lambda rt: (rt.server_info.user.identity,),
            ),
        },
    ),
    store=InMemoryStore(),
)
```

For local development, `InMemoryStore` is convenient. Production should use a durable `BaseStore` implementation and an explicit namespace factory.

### 10.4 Runtime identity fields

The memory documentation uses these runtime fields:

| Field | Meaning |
|---|---|
| `rt.server_info.assistant_id` | Current assistant or agent identifier. |
| `rt.server_info.user.identity` | Authenticated user identity when provided by the server. |
| `rt.context.org_id` | Application-provided organization or tenant identifier. |
| `rt.execution_info.thread_id` | Current LangGraph execution thread. |

`rt.server_info` and `rt.execution_info` require the corresponding Deep Agents runtime version. Older 0.5.x releases used a different backend context shape; check the migration note for the installed version.

### 10.5 Background consolidation

A production pattern separates conversational hot-path writes from background consolidation:

1. Store episodic run data in checkpoints or a dedicated event store.
2. Run a consolidation agent on a schedule.
3. Summarize useful facts and procedures.
4. Write validated updates to a user-, assistant-, or organization-scoped memory namespace.
5. Keep a human approval or review step for sensitive or shared memory.

Cron schedules are UTC. Match the cron interval to the consolidation lookback window, for example a six-hour lookback with `0 */6 * * *`.

### 10.6 Memory safety

- Shared memory can carry prompt injection from another user or source.
- Default to the narrowest useful scope, usually user or thread.
- Use read-only memory for shared policies and untrusted knowledge.
- Treat memory content as data, not instructions.
- Validate writes before committing them.
- Avoid concurrent writes to the same file when last-write-wins behavior would lose information; use per-topic files or background consolidation.
- Do not store secrets, credentials, or raw sensitive records in memory.

---

## 11. Skills

### 11.1 What a skill is

A Deep Agents skill is a reusable Agent Skills directory containing a `SKILL.md` and optional supporting files. Skills use progressive disclosure:

1. The harness reads lightweight frontmatter metadata and exposes the skill name and description.
2. When the model invokes the skill, the harness loads the full `SKILL.md`.
3. Supporting files under directories such as `scripts/`, `references/`, and `assets/` become available as needed.

This keeps startup context small while making detailed procedures available on demand.

### 11.2 Skill directory layout

```text
skills/
  research/
    SKILL.md
    references/
      style-guide.md
    scripts/
      fetch_sources.js
  code-review/
    SKILL.md
    scripts/
      run-tests.js
```

Configure the parent directory:

```python
agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    skills=["./skills/"],
)
```

A skill source can be a local filesystem directory, a virtual filesystem, or a store-backed source. The same-named skill from the last loaded source wins.

### 11.3 `SKILL.md` frontmatter

The frontmatter follows the Agent Skills specification:

| Field | Requirement |
|---|---|
| `name` | Required; lowercase hyphenated name matching the directory, 1–64 characters. |
| `description` | Required; concise statement of what the skill does and when to use it, up to 1024 characters. |
| `license` | Optional. |
| `compatibility` | Optional; maximum 500 characters. |
| `metadata` | Optional structured metadata. |
| `allowed-tools` | Experimental; declares permitted tools. |

Keep `SKILL.md` below 10 MB, keep the body below roughly 5000 tokens, and aim for fewer than 500 lines. The description should be specific enough for the model to select the skill correctly.

### 11.4 Skill inheritance and isolation

The automatic general-purpose subagent inherits the main agent's skills. Custom declarative subagents do not inherit them; pass an explicit `skills=` list when needed.

Each subagent with skills runs an independent `SkillsMiddleware` instance. Loaded skill state is isolated: a child cannot see the parent's skill state, and the parent cannot see the child's state.

### 11.5 Skill permissions

Treat skills as potentially executable or writable content:

- Use a read-only backend or deny write operations for untrusted skill repositories.
- Use `mode="interrupt"` for writes to sensitive paths.
- Keep scripts out of the prompt and execute them only in an appropriate sandbox.
- Validate skill frontmatter and file paths before loading.
- Version and review skills like code.

### 11.6 Skills and code execution

Scripts under `scripts/` require a backend that supports execution. A sandbox backend can run them, but a local filesystem backend does not provide isolation. For custom synchronization of skill files into a remote sandbox, use middleware hooks such as `before_agent` and `after_agent` or an application-side transfer step.

### 11.7 Skill validation

Follow the [Agent Skills specification](https://agentskills.io/specification) and the `skills-ref` validator from the official Agent Skills repository. Validate names, frontmatter, file boundaries, and supported tool declarations before deploying a skill collection.

---

## 12. Retrieval, RAG, and rubrics

### 12.1 Retrieval pipeline

A conventional retrieval pipeline contains:

1. Document sources.
2. Document loaders.
3. Text splitters.
4. Embedding models.
5. Vector stores.
6. Retrievers.
7. Generation or agent orchestration.

Deep Agents can use retrieval as a tool, as injected context, or as a delegated research workflow. Existing SQL databases, CRMs, document stores, and knowledge bases can be connected without rebuilding them.

### 12.2 Retrieval architectures

| Architecture | Behavior | Trade-off |
|---|---|---|
| Two-step RAG | Retrieve first, then generate with fixed context. | Predictable latency and simpler validation; less flexible. |
| Agentic RAG | The agent decides when, what, and how to retrieve. | Adapts to complex questions; latency and tool cost vary. |
| Hybrid | Combines retrieval, validation, iteration, and agent planning. | More control; requires explicit stopping and quality gates. |

### 12.3 Deep Agents RAG patterns

The RAG guide describes four patterns:

1. **Skills-guided retrieval:** a skill describes the corpus, index, and query formulation.
2. **Rubric-checked grounding:** a grader checks the answer against source evidence.
3. **Todo-driven investigation:** structured planning drives searches, evidence collection, and synthesis.
4. **Retrieve, offload, delegate:** retrieve chunks, write them to the filesystem, delegate chunk analysis, then synthesize.

RAG support in the Deep Agents documentation is beta and requires the corresponding current Deep Agents release.

### 12.4 Retrieve, offload, and delegate

A typical implementation:

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    tools=[search_documents, write_retrieved_chunks],
    subagents=[chunk_analyst],
    system_prompt=(
        "Retrieve evidence, save source chunks under /retrieved/, "
        "delegate analysis, and synthesize with citations."
    ),
)
```

The tutorial pattern uses an in-memory vector store, embeddings, a recursive text splitter, a search tool, and a backend `upload_files()` call. The child reads the saved chunks and returns a bounded summary; the coordinator cites the original source locations.

### 12.5 Indirect prompt injection

Retrieved documents, web pages, emails, and user files may contain instructions intended to override the agent's system prompt. Mitigations include:

- Treat retrieved content as data, not trusted instructions.
- Prefix chunks with a source header such as `# Source: ...`.
- Keep source content separate from system instructions.
- Use a grader or rubric to verify claims against evidence.
- Validate output before showing it to a user.
- Restrict tools that can act on retrieved instructions.

No prompt wording completely eliminates indirect prompt injection.

### 12.6 Rubric middleware

`RubricMiddleware` adds an LLM-as-judge pass after the agent produces an answer:

```python
from deepagents import RubricMiddleware, create_deep_agent

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    middleware=[
        RubricMiddleware(
            model="openai:gpt-5.5",
            max_iterations=3,
        )
    ],
)
```

Pass a newline-delimited checklist through the `rubric` state field:

```python
result = agent.invoke(
    {
        "messages": [{"role": "user", "content": "Write a cited report."}],
        "rubric": "Every factual claim has a citation.\nThe report is under 1000 words.",
    }
)
```

Possible verdicts include:

- `satisfied`
- `needs_revision`
- `max_iterations_reached`
- `failed`
- `grader_error`

A `RubricEvaluation` contains the grading run ID, zero-based iteration, result, explanation, and per-criterion pass/gap data. The middleware can emit `rubric_evaluation_start` and `rubric_evaluation_end` events through typed event streaming.

The `on_evaluation` callback receives each evaluation, but exceptions from the callback are logged and suppressed; do not use it as the sole control-flow mechanism. Rubric state persists across invocations only when a checkpointer and the same `thread_id` are used.

### 12.7 Rubric safety and cost

- Keep criteria observable and testable.
- Set a low iteration cap.
- Separate evidence gathering from final grading when needed.
- Do not let an untrusted document define the rubric.
- Trace grader calls and record the source evidence used for each verdict.
- Treat `max_iterations_reached` as a failure requiring application handling, not as a successful answer.

---

## 13. Context engineering

### 13.1 Context layers

Deep Agents separates static input context from per-run runtime context.

**Static input context** includes:

- The caller's `system_prompt`.
- Built-in agent instructions.
- Memory files such as `AGENTS.md`.
- Skill metadata and invoked skill content.
- Tool descriptions and schemas.
- Virtual filesystem and subagent instructions.
- Middleware and human-in-the-loop instructions.

**Runtime context** is defined by `context_schema` and passed with `context=` on each invocation. It is intended for immutable request data such as user ID, tenant ID, feature flags, locale, or a selected model.

### 13.2 Dynamic prompts

Use LangChain dynamic-prompt middleware when a prompt must depend on runtime context or store data. A dynamic prompt can read `request.runtime.context` and `request.runtime.store`, then return text or structured content. Keep dynamic content bounded and validate any user-controlled values before inserting them into instructions.

### 13.3 Custom state schema

Subclass `DeepAgentState` when the run needs custom checkpointed fields:

```python
from deepagents import DeepAgentState, create_deep_agent


class AppState(DeepAgentState):
    request_id: str
    attempts: int


agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    state_schema=AppState,
)
```

Preserve the built-in message reducer and required channels. Use runtime context for immutable inputs and custom state for values created or changed during execution. Subagents inherit the parent state schema for declarative subagents; compiled and async subagent graphs manage their own state.

### 13.4 Built-in context compression

Deep Agents includes context management without requiring a custom middleware:

| Mechanism | Trigger and behavior |
|---|---|
| Tool-result offloading | Large tool inputs/results are written to the filesystem and replaced with a path plus a short preview. The documented default threshold is approximately 20,000 tokens. |
| Summarization | When the input approaches the model's configured limit, older messages are summarized and the original history is preserved in the filesystem. |
| On-demand compaction | A summarization tool can be added for explicit conversation compaction between tasks. |

The summarization middleware uses the model profile's `max_input_tokens` when available. The documented default behavior starts around 85% of that limit, retains recent messages, and writes the older conversation to the backend. If no model profile is available, the fallback uses a large token trigger and keeps a small recent-message window.

### 13.5 Offloading and summarization details

- Offloading measures text tokens; media-only content is not reduced by text-token accounting.
- Summarizing older turns produces a text-only summary. Media blocks in summarized turns are dropped from the active context and may remain only in the filesystem record.
- Filter or label summarization-generated content using metadata such as `lc_source == "summarization"` when building custom middleware.
- Keep subagent summaries short, ideally a few hundred words, and write large evidence to the filesystem.
- Do not rely on a summary as an audit record; retain the original checkpointed or filesystem-backed history when traceability matters.

### 13.6 On-demand summarization tool

```python
from deepagents import create_deep_agent
from deepagents.middleware.summarization import (
    create_summarization_tool_middleware,
)

model = init_chat_model("google_genai:gemini-3.6-flash")

agent = create_deep_agent(
    model=model,
    middleware=[
        create_summarization_tool_middleware(
            model=model,
            backend=StateBackend(),
        )
    ],
)
```

Use explicit compaction between large independent tasks or before a long multi-step workflow. Do not expose an unrestricted compaction tool to untrusted callers without limits.

### 13.7 Context isolation

A synchronous subagent starts with an isolated context containing the delegated task rather than the parent's full tool history. This is useful for context quarantine. A forked subagent is the exception: it receives the parent's conversation and system prompt.

Application pattern:

1. Put large evidence, retrieved chunks, or generated artifacts in the filesystem.
2. Give the subagent a concise task and the relevant paths.
3. Require a bounded summary with citations or structured fields.
4. Let the coordinator decide whether more evidence is needed.

---

## 14. Streaming and events

### 14.1 Streaming layers

Deep Agents supports two related streaming styles:

| Style | API | Use |
|---|---|---|
| LangGraph stream chunks | `agent.stream(..., stream_mode=..., subgraphs=True, version="v2")` | Node updates, messages, custom events, and low-level namespace handling. |
| Typed event projection | `agent.stream_events(..., version="v3")` | Ergonomic iterators for messages, tool calls, values, output, and subagents. |

Use `version="v3"` for the typed projection API. The v2 chunk format is a `StreamPart` dictionary with `type`, `ns`, and `data` fields.

### 14.2 Stream modes

```python
stream = agent.stream(
    input_state,
    stream_mode=["updates", "messages", "custom"],
    subgraphs=True,
)
```

| Mode | Emits |
|---|---|
| `updates` | Node-level state updates and lifecycle progress. |
| `messages` | Token-by-token or message-level model output. |
| `custom` | Custom events emitted by tools with a stream writer. |
| `subgraphs=True` | Includes subagent graph events in the low-level stream. |

### 14.3 Typed subagent streaming

```python
stream = agent.stream_events(
    {
        "messages": [
            {"role": "user", "content": "Research one recent advance in quantum computing."}
        ]
    },
    version="v3",
)

for name, item in stream.interleave("messages", "subagents"):
    if name == "messages":
        print("[coordinator]", item.text)
    else:
        print(f"[{item.name}] started")
        for message in item.messages:
            print(f"[{item.name}]", message.text)
        print(f"[{item.name}] status: {item.status}")
```

A v3 subagent handle exposes fields such as:

- `.name`
- `.messages`
- `.tool_calls`
- `.values`
- `.subagents`
- `.output`
- `.path`
- `.status`

Statuses include `started`, `completed`, `failed`, and `interrupted`.

### 14.4 Subagent namespaces in v2

Low-level v2 stream namespaces identify graph scope:

| Namespace | Meaning |
|---|---|
| `()` | Main coordinator agent. |
| `("tools:<tool_call_id>",)` | Subagent spawned by a `task` tool call. |
| `("tools:<tool_call_id>", "model_request:<id>")` | A node inside that subagent. |

Use typed v3 projections for new application code when possible; retain v2 handling only when integrating with an existing LangGraph consumer.

### 14.5 Custom events

Tools can emit custom events through the LangChain stream writer available in tool runtime. Custom events are useful for progress, phase changes, citations, or application-specific telemetry. Keep event payloads small, stable, and safe to expose to the client.

### 14.6 Streaming and checkpoints

Streaming does not replace checkpointing. Use a checkpointer when a client may disconnect, when human approval can pause execution, or when a run must resume later. A client should retain the `thread_id` and resume with the same configuration.

---

## 15. Human-in-the-loop

### 15.1 Configure tool interrupts

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    interrupt_on={
        "write_file": True,
        "delete": True,
        "send_payment": {
            "allowed_decisions": ["approve", "edit", "reject"],
        },
    },
    checkpointer=MemorySaver(),
)
```

`interrupt_on` maps tool names to:

- `True`: use the default review decisions.
- `False`: do not interrupt for that tool.
- `InterruptOnConfig`: customize allowed decisions and add a `when` predicate.

The `when` predicate receives a `ToolCallRequest` and returns a boolean. Conditional interrupts require the corresponding current LangChain version.

### 15.2 Decisions

| Decision | Effect |
|---|---|
| `approve` | Execute the original action arguments. |
| `edit` | Execute with edited arguments supplied by the reviewer. |
| `reject` | Skip the action and return rejection feedback to the model. |
| `respond` | Return a human message as a synthetic tool result; use only for conversational tools, not side-effecting actions. |

Multiple tool calls in one model step are batched into one interrupt. The application must return decisions in the same order as `action_requests`.

### 15.3 Resume an interrupted run

```python
from langchain_core.runnables import Command

first = agent.invoke(input_state, config=config)

if first.interrupts:
    value = first.interrupts[0].value
    decisions = [
        {"decision": "approve"},
    ]
    result = agent.invoke(
        Command(resume={"decisions": decisions}),
        config=config,
    )
```

The exact decision object shape depends on the installed LangChain/LangGraph version; inspect the interrupt value and use the documented `Command(resume=...)` path. Always reuse the same `thread_id` and checkpointer.

### 15.4 Filesystem permission interrupts

A permission rule can request review before a filesystem operation:

```python
from deepagents import FilesystemPermission

FilesystemPermission(
    operations=["write"],
    paths=["/secrets/**"],
    mode="interrupt",
)
```

Permission interrupts merge with `interrupt_on` so one review step can cover tool and filesystem policy. A checkpointer is mandatory.

### 15.5 Subagent interrupts

Each subagent can override `interrupt_on`. A tool inside a subagent can call the LangGraph interrupt mechanism directly, returning a value that the parent application can resume with `Command(resume=...)`. Keep interrupt payloads small and serializable.

### 15.6 HITL design rules

- Require a checkpointer and stable `thread_id`.
- Show the reviewer the tool name, arguments, expected side effect, and relevant file paths.
- Separate approval for destructive actions from ordinary reads.
- Do not use `respond` for payments, deletes, deployments, or other side effects.
- Record reviewer identity, decision, timestamp, and edited arguments in an audit store.
- Set timeouts and expiration policies for pending approvals.
- Treat a resumed run as untrusted input; revalidate edited arguments before execution.

---

## 16. Fault tolerance and production

### 16.1 Checkpointing

LangGraph checkpoints state at execution steps and keys it by `thread_id`. Checkpointing enables:

- Crash recovery.
- Human-in-the-loop pauses.
- Cross-turn conversation continuity.
- Time travel and state inspection.
- Auditable execution history.

Use `MemorySaver` for local development. Use a durable checkpointer for production and configure it explicitly in self-hosted deployments.

### 16.2 Retry and fallback middleware

LangChain prebuilt middleware can add resilience:

| Middleware | Purpose |
|---|---|
| `ModelRetryMiddleware` | Retry rate limits, timeouts, and transient model failures. |
| `ToolRetryMiddleware` | Retry selected tools on configured transient exceptions. |
| `ModelFallbackMiddleware` | Switch to a fallback model after a model failure. |
| `ToolErrorMiddleware` | Convert a tool exception into a `ToolMessage` so the model can recover. |
| `InMemoryRateLimiter` | Limit request rate for a model or tool. |
| `ModelCallLimitMiddleware` / `ToolCallLimitMiddleware` | Cap model or tool calls per run or thread. |
| `PIIMiddleware` | Redact, mask, hash, or block sensitive values. |

Configure retry limits, backoff, timeouts, and call caps explicitly. A retry policy should not silently repeat a non-idempotent side effect.

### 16.3 Error handling

A tool error middleware callback can return a string to expose a safe error message to the model or return `None` to propagate and halt the run. Do not include secrets, stack traces, raw credentials, or internal URLs in model-visible errors.

Application code should distinguish:

- Retryable provider failures.
- Validation or permission errors.
- Human rejection.
- Rubric failure.
- Unrecoverable application errors.

### 16.4 Production invocation contract

A production request should provide:

```python
config = {
    "configurable": {
        "thread_id": "a-stable-uuid",
    }
}

result = agent.invoke(
    input_state,
    config=config,
    context=Context(user_id="user-123", tenant_id="tenant-a"),
)
```

Use a new UUID for a new conversation. Reuse the same ID only for continuation or resume. Pass user and tenant identity through authenticated server context or a validated runtime context, never from an untrusted prompt.

### 16.5 Production memory and storage

- Use a durable checkpointer.
- Use a durable `BaseStore` with an explicit namespace factory.
- Isolate users and tenants at the namespace and sandbox level.
- Keep internal offload paths on a thread-scoped backend.
- Use a remote sandbox for untrusted code or filesystem work.
- Keep secrets outside agent-visible files and sandboxes.
- Configure retention, deletion, and export policies for checkpoints, stores, traces, and uploaded files.

### 16.6 Deployment topologies

Deep Agents can run as a local graph, a self-hosted LangGraph server, or a managed LangSmith deployment. Async subagents may be co-deployed with the supervisor or split across services. Use ASGI transport for co-deployed graphs and HTTP transport for remote graphs.

For async development, provision enough worker slots for the supervisor and concurrent subagents. For production, configure concurrency, queue limits, timeouts, health checks, and graceful shutdown at the deployment layer.

### 16.7 Observability

Enable LangSmith tracing with the user's own credentials:

```bash
export LANGSMITH_TRACING=true
export LANGSMITH_API_KEY="..."
```

Trace model calls, tool calls, subagent boundaries, interrupts, rubric evaluations, and backend errors. Add correlation IDs for request, thread, run, user, and tenant. Redact sensitive tool arguments and responses before exporting traces.

### 16.8 Frontend streaming

For a streaming frontend, use the appropriate LangGraph client hook or SDK and enable subgraph streaming for subagent-heavy workflows. Configure a high enough recursion limit, reconnect behavior, and state-history retrieval. Do not assume that a disconnected browser means the server-side run stopped; use explicit cancellation or timeout policies.

### 16.9 Production security checklist

- Authenticate callers before creating or resuming a thread.
- Authorize access to the requested thread and tenant.
- Use per-user or per-tenant namespaces.
- Use isolated sandboxes for untrusted execution.
- Keep provider keys and application secrets outside the agent context.
- Restrict network egress where possible.
- Require approval for destructive or high-impact tools.
- Validate structured outputs and rubric results.
- Set model, tool, token, time, and concurrency budgets.
- Test recovery from disconnects, crashes, rate limits, and provider failover.

---

## 17. Sandboxes and interpreters

### 17.1 Sandbox backend model

A sandbox backend combines a filesystem backend with an `execute` operation. It can run code in a separate environment while exposing files through the same Deep Agents filesystem tools.

The sandbox abstraction defines a `BaseSandbox`-style interface and a `SandboxBackendProtocol`. A provider implementation must support filesystem operations and shell execution through its `execute` method. Deep Agents filters the `execute` tool when the selected backend does not implement it.

Official integrations and provider families include:

- LangSmith Sandbox.
- Daytona.
- E2B.
- Modal.
- Runloop.
- Vercel.
- AgentCore.
- OpenShell / NVIDIA OpenShell.
- Local shell, which is not isolated and is not a production sandbox.

### 17.2 Sandbox lifecycle

| Scope | Behavior | Use |
|---|---|---|
| Thread-scoped | A fresh sandbox is associated with one conversation thread and can be cleaned up after an idle TTL. | Untrusted or user-specific work. |
| Assistant-scoped | A sandbox is shared across conversations for one assistant, often with a repository snapshot reset. | Expensive setup or shared dependencies, with stronger isolation and cleanup controls. |

Thread-scoped sandboxes are the safer default for multi-tenant or untrusted workloads. Assistant-scoped sandboxes require explicit policies for snapshot reset, dependency installation, concurrent users, resource limits, and deletion.

### 17.3 Agent-in-sandbox versus sandbox-as-tool

**Agent in sandbox** puts the model-facing agent and its credentials inside the sandbox. This can simplify deployment but exposes provider keys and application secrets to the execution environment.

**Sandbox as tool** keeps the coordinator and secrets on the host or server and exposes the sandbox as a controlled execution backend. This is the preferred production pattern. Use a credential-injecting proxy or host-side tools when the agent needs authenticated upstream access.

### 17.4 Two file planes

Sandbox integrations distinguish:

- **Agent file plane:** `read_file`, `write_file`, `edit_file`, and other filesystem tools used by the agent inside the sandbox.
- **Application file plane:** host-side `upload_files()` and `download_files()` operations used to initialize or retrieve sandbox artifacts.

Do not assume that a file uploaded by application code is immediately visible to an already-running graph without the backend's transfer and graph-state semantics.

### 17.5 Sandbox security

Sandboxes reduce host exposure but do not solve prompt injection or malicious network behavior. Apply these controls:

- Do not inject provider keys, database passwords, or application secrets into the sandbox.
- Use an outbound proxy that injects credentials after the sandbox request is authorized.
- Disable network access where the provider supports it, or allow only approved destinations.
- Set CPU, memory, disk, process, timeout, and concurrency limits.
- Use a fresh workspace for untrusted input.
- Keep filesystem permissions narrow even inside the sandbox.
- Review shell commands and destructive operations with HITL.
- Delete or reset sandboxes according to a documented retention policy.

### 17.6 QuickJS interpreter

`CodeInterpreterMiddleware` runs JavaScript in a QuickJS runtime. The interpreter is beta and is not a full operating-system sandbox. It runs in-process and has no filesystem, network, shell, or clock access by default.

```python
from deepagents import create_deep_agent
from langchain_quickjs import CodeInterpreterMiddleware

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    middleware=[
        CodeInterpreterMiddleware(
            memory_limit=64,
            timeout=5.0,
            tool_name="eval",
            capture_console=True,
            max_result_chars=4000,
            max_ptc_calls=256,
            mode="thread",
        )
    ],
)
```

Configuration fields include:

| Field | Purpose |
|---|---|
| `memory_limit` | Maximum interpreter memory, commonly expressed in MB. |
| `timeout` | Maximum execution time in seconds. |
| `tool_name` | Name of the interpreter tool exposed to the model. |
| `capture_console` | Capture console output for diagnostics. |
| `max_result_chars` | Maximum returned result length. |
| `max_ptc_calls` | Maximum programmatic tool-call count. |
| `mode` | Interpreter state mode, such as thread-scoped state. |
| `max_snapshot_bytes` | Maximum persisted interpreter snapshot size. |

The interpreter requires `langchain-quickjs>=0.2.0` and Python 3.11 or later. It is intended for bounded orchestration and computation, not for executing arbitrary trusted or untrusted native code.

### 17.7 Programmatic tool calling

Programmatic tool calling (PTC) bridges selected Deep Agents tools into interpreter code:

```python
CodeInterpreterMiddleware(ptc=["glob", "read_file"])
```

The interpreter can then call tool bridges such as `tools.glob` or `tools.read_file`. PTC is off by default. Calls made through PTC bypass the normal `interrupt_on` path, so only expose safe, idempotent, narrowly scoped tools.

### 17.8 Interpreter state and snapshots

In thread mode, interpreter state can persist across turns for a conversation. Snapshots increase continuity but also increase storage and restore cost. Set a maximum snapshot size, clear state when tenant or user identity changes, and avoid storing secrets in interpreter state.

---

## 18. Multimodal inputs and outputs

### 18.1 Multimodal user input

Pass standard content blocks in a user message when the selected model supports them:

```python
input_state = {
    "messages": [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Describe this image."},
                {"type": "image", "url": "https://example.invalid/image.png"},
            ],
        }
    ]
}
```

Use the content-block schema supported by the selected LangChain model integration. Do not place arbitrary URLs or local paths in a message unless the model integration can access them safely.

### 18.2 `read_file` media support

The built-in `read_file` tool returns native multimodal content blocks for supported non-text file types when the model supports them:

| Type | Examples |
|---|---|
| Image | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.heic`, `.heif` |
| Video | `.mp4`, `.mpeg`, `.mov`, `.avi`, `.flv`, `.mpg`, `.webm`, `.wmv`, `.3gpp` |
| Audio | `.wav`, `.mp3`, `.aiff`, `.aac`, `.ogg`, `.flac` |
| File/document | `.pdf`, `.ppt`, `.pptx` |

The exact supported set depends on the model and backend. Test each media type and size before relying on it in production.

### 18.3 Multimodal tool outputs

A custom tool can return an ordered list of standard content blocks:

```python
def make_visualization(path: str) -> list[dict]:
    """Return a file content block for a generated chart."""
    return [{"type": "file", "path": path}]
```

The tool result is converted into a `ToolMessage`. Consumers can inspect structured content blocks rather than assuming every tool result is plain text.

### 18.4 Context compression caveats

- Text offloading counts text tokens, not the visual or storage size of an image, audio, or video.
- Summarization converts older turns to text and drops media blocks from the active context.
- The original media may remain in a filesystem record, but it is not reconstructed automatically in the summarized prompt.
- For media-heavy workflows, store media in a backend, pass stable references, and use subagents or a specialized model for analysis.
- Set size, count, and duration limits for user-uploaded media.

### 18.5 Multimodal safety

Validate file type, size, and provenance before passing media to the model. Treat image, audio, video, and document content as untrusted data. Do not execute embedded macros or follow instructions found inside a document unless an explicit, policy-approved tool performs that action.

---

## 19. A2A and ACP

### 19.1 Agent2Agent (A2A)

A2A exposes a Deep Agents deployment as an agent-to-agent JSON-RPC service. A LangSmith deployment acts as the A2A server and exposes endpoints under `/a2a/{assistant_id}`.

Install the required server dependency:

```bash
pip install "langgraph-api>=0.13.0"
```

The agent graph must include a `messages` state key. A2A can be disabled in `langgraph.json` with `disable_a2a: true` under the HTTP configuration.

### 19.2 A2A identifiers

| Identifier | Meaning |
|---|---|
| `contextId` | Conversation/thread identifier. Reuse it for subsequent turns. |
| `taskId` | One individual request or task. Do not reuse a completed task ID for a new turn. |

The server maps `contextId` to LangGraph `thread_id`, which keeps traces for agents in the same conversation connected.

### 19.3 A2A protocol methods

The documented server supports these JSON-RPC methods:

| v1.0 method | v0.3 method | Purpose |
|---|---|---|
| `SendMessage` | `message/send` | Send a non-streaming message. |
| `SendStreamingMessage` | `message/stream` | Send a message and receive SSE updates. |
| `GetTask` | `tasks/get` | Retrieve task state. |
| `CancelTask` | `tasks/cancel` | Cancel a task. |
| `ListTasks` | — | List tasks. |
| `GetExtendedAgentCard` | — | Retrieve the extended agent card. |

`SubscribeToTask` and task push-notification configuration methods are not supported and return a method-not-found error.

The server speaks A2A v1.0 and accepts some v0.3 method names for compatibility. v1.0 enum values use uppercase names such as `TASK_STATE_WORKING`; v0.3 names use lowercase values such as `working`. A client should consistently use one method/version family.

### 19.4 A2A agent card and I/O modes

Discover the agent card at:

```text
/.well-known/agent-card.json?assistant_id={assistant_id}
```

The card advertises the agent name, description, skills, input/output modes, protocol binding, protocol version, and capabilities. Per-assistant A2A metadata can be configured through the Assistants API, for example:

```json
{
  "metadata": {
    "a2a": {
      "input_modes": ["text/plain"],
      "output_modes": ["text/plain"],
      "a2ui": true
    }
  }
}
```

Undeclared modes may still be accepted, but an empty mode list is rejected. A2UI and `historyScope` support depend on newer, potentially prerelease `langgraph-api` versions; inspect server capabilities before relying on them.

### 19.5 A2A limitations

- Transport is JSON-RPC; gRPC and HTTP+JSON bindings are not implemented on this page.
- `contextId` must be a UUID.
- `historyLength` is capped at 10.
- Streaming currently returns flat v0.3-style objects and does not honor all v1.0 history fields.
- Response wire shapes and error envelopes may lag the latest A2A specification.
- Non-LangGraph agents must propagate `contextId` into their own trace metadata.

### 19.6 Agent Client Protocol (ACP)

ACP is an agent-to-editor protocol. It is intended for coding assistants and IDEs, not for exposing external tools. Use MCP when an editor or agent needs to call a tool server.

Install the Python package:

```bash
pip install deepagents-acp
```

Minimal server:

```python
import asyncio

from acp import run_agent
from deepagents import create_deep_agent
from deepagents_acp.server import AgentServerACP
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    model="google_genai:gemini-3.6-flash",
    system_prompt="You are a helpful coding assistant.",
    checkpointer=MemorySaver(),
)
server = AgentServerACP(agent)


async def main():
    await run_agent(server)


asyncio.run(main())
```

The ACP server reads requests from stdin and writes responses to stdout. The editor launches the server as a subprocess. ACP sessions contain tasks and messages, and the LangGraph checkpointer determines whether session state survives process restarts.

Supported editor integrations documented by the ecosystem include Zed, JetBrains IDEs, VS Code through an ACP extension, Neovim through compatible plugins, and local development managers such as Toad.

### 19.7 Choosing A2A, ACP, or MCP

| Need | Protocol |
|---|---|
| Agent-to-agent conversation over JSON-RPC | A2A |
| Editor-hosted coding agent communication over stdio | ACP |
| Agent access to external tools or services | MCP |
| Direct Python application invocation | `create_deep_agent` and LangGraph APIs |

---

## 20. Application patterns and tutorials

### 20.1 Content builder

The content-builder tutorial composes a writing agent from memory, skills, subagents, filesystem tools, and image-generation tools.

Typical structure:

```text
content-builder/
  AGENTS.md
  subagents.yaml
  skills/
    blog-post/
      SKILL.md
    social-media/
      SKILL.md
  main.py
```

- `AGENTS.md` stores concise brand voice and editorial rules.
- A researcher subagent uses web search and writes evidence or outlines to the filesystem.
- Skill directories provide progressive, task-specific writing procedures.
- Image tools generate cover and social images when the selected provider supports them.
- A `FilesystemBackend` or composite backend isolates generated artifacts.

Use a narrow system prompt that separates research, drafting, editing, and publication. Require citations or source notes before the final draft is accepted.

### 20.2 Data analysis agent

The data-analysis tutorial combines a sandbox, CSV/file tools, task planning, visualization, and an external notification tool.

Core pieces:

- A sandbox backend executes analysis code and creates charts.
- `TodoListMiddleware` tracks analysis phases when structured planning is useful.
- A visualization subagent receives a bounded task and returns chart paths or summaries.
- Summarization middleware keeps long multi-plot conversations manageable.
- A custom notification tool downloads the generated artifact from the backend and sends it through an external service.

The application-side tool should validate file paths, file types, destination permissions, and message content. Never let a retrieved or generated file path escape the sandbox or backend root.

### 20.3 Deep research agent

The deep-research tutorial uses a planning and evidence workflow:

1. Plan the research question and subquestions.
2. Save the research request to the filesystem.
3. Search the web with a custom search tool.
4. Fetch and normalize source pages.
5. Delegate focused research units through subagents.
6. Consolidate findings and citations.
7. Write the report.
8. Verify citations and claims.

Useful configuration knobs include maximum concurrent research units and maximum iterations per researcher. Bias toward one subagent for ordinary questions and fan out only when the task explicitly benefits from parallel research.

A robust report schema includes:

- Claim.
- Source URL or document identifier.
- Quoted or paraphrased evidence.
- Confidence or verification status.
- Contradictions and unresolved questions.

### 20.4 Retrieve, offload, and delegate

This pattern is appropriate when search results or documents are too large for the coordinator:

1. Retrieve candidate documents.
2. Split and rank them.
3. Write source chunks under a bounded path such as `/retrieved/{batch_id}/`.
4. Delegate chunk analysis to one or more subagents.
5. Require each child to return a short summary and source references.
6. Synthesize the final answer from the child summaries and original citations.

Keep the number of chunks, child agents, and total tokens bounded. Store raw evidence separately from the final answer so a grader can inspect it.

### 20.5 Skill-guided retrieval

A skill can describe a corpus and query procedure without injecting the entire corpus into the prompt:

```markdown
---
name: company-docs
description: Search the company documentation corpus for policies and product facts.
---

# Company documentation

Use the `search_company_docs` tool...
```

The model sees the skill description first, invokes the skill when appropriate, and then receives the detailed procedure. This is useful for large or frequently changing knowledge bases.

### 20.6 Rubric-checked generation

Combine generation and grading for high-stakes output:

1. Generate a draft with source references.
2. Run a rubric that checks completeness, citation coverage, tone, and safety.
3. Feed criterion-level gaps back to the agent.
4. Repeat up to a fixed iteration cap.
5. Return the draft only if the final verdict is satisfied.

Use a separate model or subagent for grading when the primary model may be biased toward accepting its own answer.

### 20.7 Multi-agent review tournament

A dynamic-subagent pattern can generate several candidate solutions, ask independent reviewers to score them, and select the best candidate. Keep the tournament bounded:

```text
candidates <= N
reviewers per candidate <= M
rounds <= R
```

Use deterministic tie-breaking or a final judge. Do not allow a candidate or reviewer to modify the shared workspace unless that side effect is explicitly authorized.

### 20.8 Human-approved publishing

For publishing, deployment, payment, or data deletion:

1. Generate a preview and a structured action plan.
2. Pause with `interrupt_on`.
3. Show the exact destination, payload, and side effects.
4. Require an explicit approve or edited-action decision.
5. Execute once with an idempotency key.
6. Record the result and reviewer identity.

Do not use a conversational `respond` decision as authorization for a side effect.

---

## 21. dcode, OpenWiki, and ecosystem tools

### 21.1 Deep Agents Code (`dcode`)

`dcode` is LangChain's terminal coding agent built on the Deep Agents SDK. It provides a ready-made environment for trying filesystem tools, subagents, skills, memory, context compaction, human-in-the-loop, MCP, and tracing.

Install:

```bash
curl -LsSf https://langch.in/dcode | bash
```

Run:

```bash
dcode
```

`dcode` includes the code interpreter, so a request phrased as a **workflow** can trigger dynamic subagent orchestration. The terminal UI can show dynamically spawned subagents grouped by dispatch phase.

Use `dcode` for exploration and local development, not as a substitute for application-level authorization, tenant isolation, or production sandbox policy.

### 21.2 OpenWiki

OpenWiki is a CLI that creates and maintains a Markdown wiki for a codebase or personal knowledge base. It is built on Deep Agents and writes an `openwiki/` directory that agents can read through filesystem tools.

Install and initialize:

```bash
npm install -g openwiki
openwiki --init
```

Modes include:

- Code/wiki mode for a repository.
- Personal mode for a local knowledge base.

The generated wiki can be referenced from repository files such as `AGENTS.md` or `CLAUDE.md`. OpenWiki supports multiple model providers and can emit LangSmith traces when the user configures LangSmith credentials. It does not replace a formal connector to another editor or agent; it relies on shared Markdown conventions and filesystem access.

### 21.3 Agent Skills and reusable context

Use the Agent Skills specification for reusable procedures. Deep Agents skills and OpenWiki pages solve different problems:

| Artifact | Best for |
|---|---|
| Skill `SKILL.md` | Procedural capability with progressive disclosure and optional scripts/assets. |
| `AGENTS.md` | Always-available identity, policy, and project instructions. |
| OpenWiki Markdown | Human-readable, versioned knowledge base generated from a repository. |
| Memory store | Cross-conversation facts and preferences with scoped persistence. |

### 21.4 LangSmith tracing

LangSmith can trace coordinator model calls, tool calls, subagent runs, interrupts, rubric evaluations, and backend operations. Configure tracing explicitly in development and production. Redact secrets and sensitive user data before traces leave the deployment boundary.

### 21.5 Ecosystem boundaries

- Deep Agents is the Python agent harness.
- LangGraph provides durable execution and state.
- LangChain provides models, tools, middleware, and integrations.
- MCP connects agents to external tools.
- A2A connects agent servers to other agents.
- ACP connects coding agents to editors.
- dcode and OpenWiki are applications built around the ecosystem.

---

## 22. Versioning, changelog, and migration

### 22.1 Snapshot versions

The official changelog snapshot consulted for this reference reports:

| Package | Reported version |
|---|---:|
| `langchain` | `1.4.0` |
| `deepagents` | `0.7.0` |
| `langgraph` | `1.2.0` |

The Deep Agents documentation pages also describe APIs requiring later patch releases, including subagent forking at `deepagents>=0.7.13`. Treat the installed package version, not this table, as the runtime authority.

### 22.2 Python breaking and migration notes

| Release/topic | Change |
|---|---|
| `deepagents` 0.7 | `TodoListMiddleware` is opt-in rather than enabled by default. |
| `deepagents` 0.7 | Legacy backend factory shims such as `BackendFactory`, `BACKEND_TYPES`, `FileFormat`, and `Unset` are removed; pass concrete backend instances and explicit `StoreBackend` namespaces. |
| `deepagents` 0.7 | Backend results use structured result objects; empty `ls`/`glob` output and `read_file` formatting changed. |
| `deepagents` 0.6 | `DeltaChannel` introduced for message history/files; persisted threads may not be roll-back compatible with the prior checkpoint format. |
| LangChain 1.0 | `create_agent` replaces the legacy `langgraph.prebuilt.create_react_agent` path; legacy APIs moved to `langchain-classic`. |

### 22.3 Feature version thresholds

| Feature | Minimum or status note |
|---|---|
| Filesystem permissions | `deepagents>=0.5.2` |
| Permission interrupt mode | `deepagents>=0.6.8` |
| Custom state schema | `deepagents>=0.6.6` |
| RAG patterns | `deepagents>=0.6.5`; beta |
| Rubric middleware | `deepagents>=0.6.5`; beta |
| Event streaming v3 projections | `deepagents>=0.6`; beta/content-block oriented |
| `delete` filesystem tool | `deepagents>=0.7` |
| Filesystem tool allowlist | `deepagents>=0.7` |
| Exact-match file deletion behavior | `deepagents>=0.7.3` |
| Forked subagents | `deepagents>=0.7.13`; beta |
| QuickJS interpreter | `langchain-quickjs>=0.2.0`, Python 3.11+; beta/experimental |
| `ToolErrorMiddleware` | `langchain>=1.3.14` |
| Conditional `when` interrupts | `langchain>=1.3.3` |
| MCP namespace | `langchain[mcp]>=1.4.0`; beta |
| A2A endpoint | `langgraph-api>=0.4.21`; newer file and A2UI features require later releases |

### 22.4 Backend migration

Replace factory-style construction with explicit instances:

```python
from deepagents.backends import StateBackend, StoreBackend

backend = StateBackend()
store_backend = StoreBackend(
    namespace=lambda rt: (rt.server_info.user.identity,),
)
```

Pass the store to `create_deep_agent(store=...)` or rely on a managed deployment to provision it. Update code that expected raw strings or legacy backend result shapes.

### 22.5 Checkpoint migration

Before upgrading across a checkpoint-format boundary:

1. Read the Deep Agents and LangGraph changelog for the exact target version.
2. Back up or export important thread state.
3. Run the documented migration tool or compatibility path.
4. Test resume, interrupt, and time-travel behavior in a staging environment.
5. Do not assume a thread created under an older format can be rolled back after migration.

### 22.6 JavaScript/TypeScript ecosystem

The JavaScript changelog reports a separate package line. The documented `deepagents` JavaScript package was alpha at the snapshot, and `BackendProtocolV2` returns structured result objects. JavaScript LangGraph packages require the documented Node version and use `createAgent` rather than the legacy React-agent prebuilt. Do not copy Python identifiers directly into TypeScript code without checking the JavaScript API reference.

### 22.7 Stability policy

LangChain uses semantic versioning for stable major releases. Beta and experimental features can change before becoming stable. Pin package versions for reproducible deployments, record the versions of `deepagents`, `langchain`, `langgraph`, provider integrations, and protocol packages, and review changelogs before upgrades.

---
