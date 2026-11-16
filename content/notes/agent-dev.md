---
id: agent-dev
index: N-01
title: Agent 开发工程手记：LangGraph、Harness 与四层心智模型
date: 2026-11-16
category: Agent 架构
tags: LangGraph, Harness, Multi-Agent, Runtime
summary: 整理自一线 Agent 开发实战：工程化收敛哲学、三大痛点、LangGraph 机制、GIL 进程隔离、上下文治理与四层运行时模型。
---

> 整理自日常开发实战（主要基于 LangGraph、DeerFlow 与多智能体运行时架构）。

## 1. 核心哲学与摘要

Agent 开发本身就是将 `LLM + 代码 = Agent` 这个过程不断收敛到目标业务场景的工程实践。开发过程中最需要的，反而是**大量真实环境下的端到端 Dogfooding 测试**——通过持续测试暴露搭建阶段未曾预料的问题，再以工程化手段将 LLM 的概率输出收敛到可控范围内。

**更好的切入思路**：先想清楚如何将一个业务目标工程化，再识别其中哪些环节适合由 LLM 接入，而不是反过来用大模型硬包一切。

> **核心架构哲学**：让 Agent 只做「语义消歧（Semantic Resolution）」，让 Harness 做「确定性编译（Deterministic Lowering）」，让下游执行层做「零猜测的纯函数消费（Zero-Guessing Pure Execution）」。只让大模型做它不可替代的事（理解模糊意图），绝不让大模型做传统代码能完美搞定的事（数据搬运、逻辑拼装与安全执行）。

## 2. 当前 Agent 开发的三个核心痛点

虽然我的主要实践基于 LangGraph 与上层的 DeerFlow，但大部分 Agent 系统面临的痛点高度相似：

1. **框架耦合重、手搓成本高**：缺少合理的抽象框架，每次切换模型、更换 Tool Use 范式或迁移 Domain 都需要大量重写（其中垂直 Domain 的重写尚可接受，但底层重复劳动过多）。
2. **缺乏可追溯的迭代地图**：架构、Prompt、Tool、Skill、策略与 Memory 之间缺少可视化、按图索骥的关联方式。每次迭代更新或线上排障时，难以快速定位并联动修改（例如切换底层 LLM API 或业务域时）。
3. **Agentic RL 的真实诉求**：在落地深水区，最终往往需要一个经过微调的模型来驱动这套 Agent；而 **Agentic RL 的核心目的是教会模型「如何使用这个 Agent」，而不是一股脑地把领域知识塞给模型**。

## 3. Harness 与 LangGraph 实战机制

### 3.1 Harness 生命周期

Harness 负责围绕模型和工具执行建立可观测、可拦截的反馈回路，典型生命周期钩子包括：

`task_start` → `step_start` → `before_model` → `after_model` → `before_tool` → `after_tool` → `step_end` → `task_end`

### 3.2 LangGraph 核心三件套

1. **State（状态）**：通常是一个自定义的 `TypedDict`，在节点与 Middleware 之间通过 Reducer 进行增量更新（`update`），而不是每次构造全新 State 传递。

```python
class ThreadState(AgentState):
    sandbox: NotRequired[SandboxState | None]
    thread_data: NotRequired[ThreadDataState | None]
    title: NotRequired[str | None]
    artifacts: Annotated[list[str], merge_artifacts]          # 带自定义 reducer
    todos: NotRequired[list | None]
    viewed_images: Annotated[dict[str, ViewedImageData], merge_viewed_images]
```

2. **Node（节点）**：读取当前 `State`，执行模型调用或业务逻辑，并返回需要更新的字段字典。
3. **Edge（边）**：分为固定边（Node A 完成后直接流向 Node B）和条件边（根据 `State` 状态路由到不同分支）。

```text
        ┌──────────────┐
        │   model      │  ← 调用 LLM，决定是否使用工具
        └──────┬───────┘
     有工具调用 │         无工具调用
        ↓      │            ↓
   ┌──────────┐│           END
   │ tool_node││
   └─────┬────┘│
         │ 结果写回 messages
         └─────→ 回到 model
```

### 3.3 Middleware、Reducer、Checkpointer 与 Command

- **Middleware**：本质是一组生命周期 Hook，在不改变 Graph 拓扑的前提下，在固定时机（`before_agent` / `after_agent` / `before_model` / `after_model`）执行横切逻辑。Node 是洋葱核，Middleware 是包裹它的外层；**负责收口修改完整 State 的 Middleware 必须位于出口最外层**。
- **Reducer**：当多个节点同时写入同一个字段（如 `artifacts` 或 `messages`）时，定义合并策略而非默认后写覆盖。
- **Checkpointer**：状态持久化层，在每一步执行后保存当前 `State` 快照、执行进度与 `pending writes`，用于断点续跑与历史回放。
- **Command（Human-in-the-Loop）**：需要人工介入（如调用 `ask_clarification` 工具）时，通过 LangGraph 的 `Command` 带着当前 `State` 中断并跳转（如 `goto=END`），等待确认后恢复。

## 4. 工程经验：进程隔离、上下文治理与数据搬运

### 4.1 重进程内的 CPU 密集型任务并发（Python GIL 与 Fork/Spawn）

Agent 运行时是一个较重的服务进程。受 Python GIL 限制（线程池仅适合 I/O 密集型），CPU 密集型任务需独立进程池隔离执行：

- `fork` 若在多线程父进程中触发，子进程仅继承单线程却可能继承锁状态，极易引发 **Deadlock**，且对依赖 C 扩展全局状态（如 `matplotlib`）的任务不安全。
- **标准解法**：**`spawn` 轻子进程并在子进程内开进程池，主进程使用 `asyncio` 非阻塞等待**。

### 4.2 上下文生命周期与信噪比衰减

粗暴截断早期消息会破坏 JSON 与 `tool_use` / `tool_result` 配对；而步数增加会堆积大量原始工具返回，导致有效信息占比下降（信噪比降低）、稀释 LLM 注意力。因此需要一套完整的上下文压缩、摘要与生命周期管理。

### 4.3 消除「数据搬运」职责

步骤 A 的输出传给步骤 B 时，若依赖模型提取并重拼参数，易出现字符串截断、字段遗漏或 ID 混淆。核心原则是：**让 LLM 做它擅长的事（理解意图、规划、推理），让系统做它擅长的事（通过 `parameterBindings` 声明式绑定完成数据搬运与精确传递）。**

## 5. 多 Agent 编排与边界判据

### 5.1 Agent 边界的三条判据

拆分独立 Agent 边界，只有在换来以下至少一项收益时才成立，否则得不偿失：

1. **上下文隔离**：避免不同子任务的中间过程互相污染注意力。
2. **权限分域**：隔离不同的数据读写权限与工具集合。
3. **对抗独立**：校验者不能共享提供者的上下文。

### 5.2 多 Agent 编排误区与契约分层

切忌按人类组织角色让 Subagent 用自然语言互相对话，这会引入极高的不确定性成本；应优先采用结构化契约与确定性路由。Agent 负责理解意图并选择行动，Middleware 只基于 `action`、`state`、`receipt` 和最终输出 `claims` 执行确定性契约：

1. **Intent / Planning**：由 Agent 根据自然语言与 Tool Schema 自主决策。
2. **Action**：Agent 调用强类型的 Typed Tool。
3. **Tool Contract**：由代码执行确定性的前置与后置校验。
4. **Receipt**：Tool 成功后留下机器可读凭据。
5. **Publication Guard**：最终输出前核验 `claims` 与 `receipts` 一致性。

## 6. Agent 运行时四层心智模型

### 第 1 层：Run Envelope（执行环境边界）

定义单次运行的身份、Thread、Project、Workspace、Sandbox 与权限边界。Runtime Context 不是 Agent 所需的全部背景知识，而是本次执行的环境信封。

### 第 2 层：Graph（底层控制流与数据流）

- **控制流**：`Node` / `Edge` / `Conditional Edge`
- **数据流**：`State`（共享状态字段集合）、`Channel`（更新通道）、`Reducer`（合并规则，如 `add_messages`）
- **暂停与记忆**：`Interrupt` + `Checkpointer`（Thread 局部持久化）与 `Store`（跨 Thread 长期存储抽象）

### 第 3 层：Runtime Extension（执行生命周期层）

- **Hook（插入点）**：`before_agent`、`after_agent`、`before_model`、`after_model`、`wrap_model_call`、`wrap_tool_call`
- **Middleware（机制组件）**：组合多个 Hook 的可复用组件（如 `SandboxMiddleware`）
- **Cross-cutting Policies（治理策略分类）**：

| Policy | 核心目的 |
| --- | --- |
| Guardrail | 阻止危险、越权或不合规行为 |
| Retry | 处理临时性网络或接口错误 |
| Rate Limit | 控制 Token、Cost 与调用频率 |
| Tracing | 记录完整执行路径与耗时性能 |
| Loop Control | 检测重复无效调用与无进展空转 |
| Summarization | 长程任务上下文压缩与摘要 |
| Receipt / Audit | 记录关键工具动作的执行凭据 |
| Error Handling | 统一失败表达与降级提示 |
| Context Injection | 注入 Workspace、User、Project 元数据 |

### 第 4 层：Model Interface（模型可见与可控接口）

| 组件 | 类型 | 作用 |
| --- | --- | --- |
| Model | Runtime | LLM 推理本体 |
| Prompt | Context | 规定角色、行为规则与工作流程 |
| Skill | Context | 按需注入的方法论、范式知识与交互规则 |
| Tool | Callable | 模型可调用的强类型函数入口 |
| Toolset | Collection | 一组关联 Tools 的集合 |
| MCP Tool | Callable | 通过 MCP 协议暴露给模型的外部能力 |
| Structured Output | Schema | 约束模型输出结构与字段类型 |
| Subagent Dispatch | Callable | 通过 `task()` 派遣子 Agent |

> **关键区分**：**Tool 不是 Service**。Tool 是面向模型的能力入口与参数契约，Service 才是背后真正承担状态变更与计算的后端实现。
