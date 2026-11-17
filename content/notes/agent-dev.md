---
id: agent-dev
index: N-01
title: Agent 开发工程手记：确定性契约、进程隔离与两节点状态机
date: 2026-11-17
category: Agent 架构
tags: LangGraph, Harness, Multi-Agent, Event Loop
summary: 一线 Agent 开发实战：Semantic Resolution 哲学、非 LLM 契约判定（Gaps / 可估计性）、Gateway 三级并发隔离、两节点 ReAct 状态机与四层运行时模型。
---

> 整理自日常开发实战（主要基于 LangGraph、DeerFlow 与多智能体运行时架构）。

## 1. 核心哲学与摘要

Agent 开发本身就是将 `LLM + 代码 = Agent` 这个过程不断收敛到目标业务场景的工程实践。开发过程中最需要的，反而是**大量真实环境下的端到端 Dogfooding 测试**——通过持续测试暴露搭建阶段未曾预料的问题，再以工程化手段将 LLM 的概率输出收敛到可控范围内。

**更好的切入思路**：先想清楚如何将一个业务目标工程化，再识别其中哪些环节适合由 LLM 接入，而不是反过来用大模型硬包一切。

> **核心架构哲学**：让 Agent 只做「语义消歧（Semantic Resolution）」，让 Harness 做「确定性编译（Deterministic Lowering）」，让下游执行层做「零猜测的纯函数消费（Zero-Guessing Pure Execution）」。只让大模型做它不可替代的事（理解模糊意图），绝不让大模型做传统代码能完美搞定的事（数据搬运、逻辑拼装与安全执行）。

## 2. 当前 Agent 开发的三个核心痛点

虽然主要实践基于 LangGraph 与上层的 DeerFlow，但大部分 Agent 系统面临的痛点高度相似：

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
- **Command（Human-in-the-Loop）**：需要人工介入（如调用 `ask_clarification` 工具）或推进阶段状态时，通过 LangGraph 的 `Command` 更新状态并控制跳转（如 `goto=END`），等待确认后恢复。

## 4. 上下文治理、数据搬运与多 Agent 边界

### 4.1 上下文生命周期与信噪比衰减

粗暴截断早期消息会破坏 JSON 与 `tool_use` / `tool_result` 配对；而步数增加会堆积大量原始工具返回，导致有效信息占比下降（信噪比降低）、稀释 LLM 注意力。因此需要一套完整的上下文压缩、摘要与生命周期管理。

### 4.2 消除「数据搬运」职责

步骤 A 的输出传给步骤 B 时，若依赖模型提取并重拼参数，易出现字符串截断、字段遗漏或 ID 混淆。核心原则是：**让 LLM 做它擅长的事（理解意图、规划、推理），让系统做它擅长的事（通过 `parameterBindings` 声明式绑定，或由执行器直接读取 `AnalysisScope` 完成精确传递）。**

### 4.3 Agent 边界的三条判据

拆分独立 Agent 边界，只有在换来以下至少一项收益时才成立，否则得不偿失：

1. **上下文隔离**：避免不同子任务的中间过程互相污染注意力。
2. **权限分域**：隔离不同的数据读写权限与工具集合。
3. **对抗独立**：校验者不能共享提供者的上下文。

### 4.4 为什么放弃「复刻人类岗位」的常驻 Subagent

早期尝试模仿人类社会分工设置常驻 Subagent（本质是「复刻人类研究所岗位」），结果把系统正确性押在了**有损、可伪造、姿势敏感的对话上下文与散文交接单**里，引发 seal 漏调、手抄数字矛盾、正则闸口死锁等一连串补丁。

应优先采用结构化契约与确定性路由，并遵循五层契约分工：

1. **Intent / Planning**：由 Agent 根据自然语言与 Tool Schema 自主决策。
2. **Action**：Agent 调用强类型的 Typed Tool（Tool 内部调用 Service 完成确定性计算并输出 JSON）。
3. **Tool Contract**：由代码执行确定性的前置与后置校验。
4. **Receipt**：Tool 成功后留下机器可读凭据。
5. **Publication Guard**：最终输出前核验 `claims` 与 `receipts` 一致性。

## 5. 实战案例：把确定性判断从 LLM 脑子里剥离

所有「可形式化定义、有明确标准答案」的判断都不应交由 LLM 猜测，而应写成纯 Python 的结构化契约：

### 5.1 不用 LLM 如何「对比 Gaps（语义缺口）」

Gaps 不是靠自然语言“看懂还缺什么”，而是**结构化清单的集合求差**：

1. **上游建档算差集（Stage 1）**：上传进入 `admit_analysis_scope` 时，Python 根据选定范式的 `catalog/<paradigm>.yaml` 必填槽位，拿解析元数据与已确认字典逐槽位求差集，缺项写入 `AnalysisScope.gaps`；用户提交卡片后由 `commit_scope_patch` 消去对应条目。
2. **Pipeline 入口有效语义过滤（Stage 2）**：`arun_analysis_pipeline` 读取 `scope` 后，通过纯 Python 规则函数过滤（如 `descriptive_only` / `group_design == "none"` 时退化 `subject_id` 与 `group` 槽位，或跳过已排除 trial）；若 `gaps` 仍非空，直接转为交互卡片终止管线等待填写。

### 5.2 不用 LLM 如何判断「设计可估计性（Design Estimability）」

在 `build_execution_contract → _design_estimability → _phase_capabilities` 中，Python 对活跃实验单元按 `phase` 分桶直接数 4 个指标：`n_groups`、`min_animals_per_group`、`max_observations_per_animal`、`ungrouped_units`（及 `identity_repeat_safe`），然后套用硬规则：

- **组间推断统计**：`group_comparison = ready and not descriptive_enabled and n_groups >= 2 and min_animals >= 3`。不满足时直接置为 `inferential_statistics = False`、`underpowered = True`、`effective_report_mode = "descriptive"`，自动降级描述性报告。
- **重复测量模型**：`repeated_measures = ready and max_obs >= 2`。单只动物只有 1 次观测时直接拦截，避免送入 MixedLM 报错。

> **一句话总结**：`gaps = 必填槽位 - 已确认槽位 - 已豁免/排除槽位`；`design_estimability = 分组与样本计数 + 统计学准入门槛`。1 毫秒稳定出结论，彻底杜绝大模型“觉得 2 只样本也能试试 t 检验”的幻觉。

## 6. 并发与进程隔离：保住 Gateway Event Loop 的呼吸权

把重活卸载给独立 Worker，更精准的目的不是防“单个 Agent 自己的 while loop”，而是**为了不冻死整个 Gateway 进程的 `asyncio` 主事件循环（Event Loop）**——单线程事件循环同时服务全站所有用户的对话、SSE 吐字、`/health`、鉴权与进度推送。

### 6.1 同步阻塞事件循环的三类线上事故

1. **一人算数据，全站 504 雪崩（ADR-0009）**：同步收尾逻辑阻塞主循环 142–323 秒，全站接口无响应直接 504。
2. **SSE 进度推送哑火**：主循环被占死导致进度事件无法推向前端，页面持续转圈卡死。
3. **心跳饿死导致存活任务被同伴误杀（ADR-0034）**：生成 56 张图表阻塞主循环 74.2 秒，超过 40s（30s + 10s）心跳续租超时，隔壁 Worker 误判其崩溃并将其强行 Cancel。

### 6.2 三级隔离方案

1. **I/O 与轻重活 → `asyncio.to_thread` 线程池**：磁盘读写、Markdown 编译、DuckDB 查询立即让出事件循环。
2. **纯计算多核并行 → `ProcessPoolExecutor` / `spawn` 进程池**：绕开 Python GIL 限制实现真并行，并在多线程服务进程中优先使用 `spawn`（避开 `fork` 锁继承死锁及 `matplotlib` 等 C 扩展全局状态污染），主进程 `asyncio` 非阻塞等待。
3. **重型收尾与心跳 → 彻底出进程 / 出循环**：重型收尾拆至独立 `deerflow-landing-worker` 进程（ADR-0009）；存活探针心跳放进独立 `threading.Thread`（ADR-0034），不再受主循环抖动牵连。

## 7. 两节点 ReAct 如何实现严格状态机

传统 `StateGraph` 多节点连线像「过山车轨道」，用户半路追问细节就会卡死。现在采用**「两节点开放世界（`model ↔ tools`）+ `ThreadState` 状态栏 + Middleware 门卫」**：

1. **`ThreadState` = 玩家“状态栏”**：通过带 Reducer 的字段承载状态机进度，包括 `pipeline_control`（`stage` 关卡与 `budget` 重试预算）、`pending_ask`（带 `request_id` 防旧请求误清）、`analysis_lifecycle`（带 `_producer_proof` 防伪校验）与 `analysis_events`。
2. **Tool 返回 `Command(update=...)` = “通关改状态栏”**：工具执行完毕后返回 `Command` 更新 `pipeline_control.stage`。
3. **三道核心 Middleware 门卫**：
   - **`StageScopedToolMiddleware`**：在 `awrap_model_call` 读取 `ThreadState` 与 DB 进度取最高阶段，动态改写 `request.tools` 隐藏未解锁工具，条件满足则放开同类工具由 LLM 自由推导。
   - **`ScopeCardCommitMiddleware`**：前端提交交互卡片后，在 `abefore_agent` 直接落库并在 `gaps == 0` 时跑完计算流水线，省去 1–2 轮多余 Function Calling。
   - **`RunBudgetMiddleware` / `ExplanationVerificationGate`**：同参数连错 2 次后第 3 次直接熔断；最终正文输出前对照账本数字做溯源拦截。

### 7.1 为什么状态要拆分 `ThreadState` 与 Postgres DB 两半放？

| 存储载体 | 定位与职责 | 典型内容 | 原因 |
| --- | --- | --- | --- |
| `ThreadState`（Checkpointer） | 这一趟 Agent 对话的**控制态** | `pipeline_control`（stage / budget）、`pending_ask` | 随 LangGraph Checkpointer 在每轮 `model ↔ tools` 间高频读写与恢复 |
| `Postgres DB` | 科研/业务实体的**事实态** | `AnalysisScope`（gaps / revision）、`SqlLedger`（`FactStatus`） | 需跨会话复用、支撑前端 Canvas 展示，并在重启后作为唯一权威数据源 |

## 8. Agent 运行时四层心智模型

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
