# Agent 开发工程手记

> 整理自日常开发实战（主要基于 LangGraph、DeerFlow 与多智能体运行时架构）。

## 1. 核心哲学与摘要

Agent 开发本身就是将 `LLM + 代码 = Agent` 这个过程不断收敛到目标业务场景的工程实践。开发过程中最需要的，反而是**大量真实环境下的端到端 Dogfooding 测试**——通过持续测试暴露搭建阶段未曾预料的问题，再以工程化手段将 LLM 的概率输出收敛到可控范围内。

**更好的切入思路**：先想清楚如何将一个业务目标工程化，再识别其中哪些环节适合由 LLM 接入，而不是反过来用大模型硬包一切。

> **核心架构哲学**：让 Agent 只做「语义消歧（Semantic Resolution）」，让 Harness 做「确定性编译（Deterministic Lowering）」，让下游执行层做「零猜测的纯函数消费（Zero-Guessing Pure Execution）」。只让大模型做它不可替代的事（理解模糊意图），绝不让大模型做传统代码能完美搞定的事（数据搬运、逻辑拼装与安全执行）。

---

## 2. 当前 Agent 开发的三个核心痛点

虽然主要实践基于 LangGraph 与上层的 DeerFlow，但大部分 Agent 系统面临的痛点高度相似：

1. **框架耦合重、手搓成本高**：缺少合理的抽象框架，每次切换模型、更换 Tool Use 范式或迁移 Domain 都需要大量重写（其中垂直 Domain 的重写尚可接受，但底层重复劳动过多）。
2. **缺乏可追溯的迭代地图**：架构、Prompt、Tool、Skill、策略与 Memory 之间缺少可视化、按图索骥的关联方式。每次迭代更新或线上排障时，难以快速定位并联动修改（例如切换底层 LLM API 或业务域时）。
3. **Agentic RL 的真实诉求**：在落地深水区，最终往往需要一个经过微调的模型来驱动这套 Agent；而 **Agentic RL 的核心目的是教会模型「如何使用这个 Agent」，而不是一股脑地把领域知识塞给模型**。

---

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

- **Middleware**：本质是一组生命周期 Hook，在不改变 Graph 拓扑的前提下，在固定时机（`before_agent` / `after_agent` / `before_model` / `after_model`）执行横切逻辑。Node 是洋葱核，Middleware 是包裹它的外层；**注意出口顺序与注册优先级，负责收口修改完整 State 的 Middleware 必须位于出口最外层**。
- **Reducer**：当多个节点同时写入同一个字段（如 `artifacts` 或 `messages`）时，默认策略是后写覆盖先写；Reducer 用于定义自定义合并策略（如追加、去重合并、防伪校验）。
- **Checkpointer**：状态持久化层，在每一步执行后保存当前 `State` 快照、执行进度与 `pending writes`，用于断点续跑、多轮历史恢复与回放。
- **Command（Human-in-the-Loop）**：常规 Node 只返回 `{字段: 更新}`；当需要人工介入（如调用 `ask_clarification` 工具）或推进阶段状态时，通过 LangGraph 的 `Command` 更新状态并控制跳转（如 `goto=END`），等待用户确认后恢复。

---

## 4. 上下文治理、数据搬运与多 Agent 边界

### 4.1 上下文生命周期与信噪比衰减

上下文窗口受限时，若粗暴截断早期消息，会导致 JSON 残缺或 `tool_use` / `tool_result` 配对破坏从而引发 API 报错。同时随着步数增加，上下文堆积大量工具原始返回值，真正有效的信息占比下降（**信噪比降低**），直接稀释 LLM 注意力，导致长程任务质量下滑。因此必须设计完整的上下文压缩、摘要与生命周期管理机制。

### 4.2 消除「数据搬运」职责

当步骤 A 的输出需要作为步骤 B 的输入时，若依赖模型从工具返回中提取并重新拼接参数，极易出现长字符串截断、嵌套字段遗漏、相似 ID 混淆或上下文压缩后丢失关键值等问题。

- **核心原则**：**让 LLM 做它擅长的事（理解意图、规划、推理），让系统做它擅长的事（数据搬运、格式转换、精确传递）。**
- 例如通过 `parameterBindings` 声明式绑定，或让执行器直接从 Workspace / DB 读取上游产出的 `AnalysisScope`，把确定性的数据搬运从 LLM 职责中彻底移除。

### 4.3 Agent 边界的三条判据

拆分出独立 Agent 边界，只有在换来以下至少一项收益时才成立，否则只会引入额外序列化与沟通损耗：

1. **上下文隔离**：避免不同子任务的中间过程互相污染注意力。
2. **权限分域**：隔离不同的数据读写权限与工具集合。
3. **对抗独立**：校验者（Verifier）不能共享提供者（Provider）的上下文，保证独立评审。

### 4.4 为什么放弃「复刻人类岗位」的常驻 Subagent

早期开发容易试图模仿人类社会分工，设置多个常驻 Subagent 并赋予对应角色。这种方式本质是「复刻人类研究所岗位」：把系统正确性押在了**有损、可伪造、姿势敏感的对话上下文与散文交接单**里，极易引发 seal 漏调、手抄数字矛盾、正则闸口死锁等一连串补丁。

应优先采用**结构化契约、Typed State 与确定性路由**，并遵循意图与契约五层分工：

1. **Intent / Planning**：由 Agent 根据自然语言与 Tool Schema 自主决策。
2. **Action**：Agent 调用强类型的 Typed Tool（Tool 内部再调用后端 Service 完成确定性计算并输出 JSON）。
3. **Tool Contract**：由代码执行确定性的前置条件与后置条件校验。
4. **Receipt**：Tool 执行成功后留下机器可读的凭据。
5. **Publication Guard**：最终输出前核验输出 `claims` 与 `receipts` 是否一致，杜绝幻觉结论。

---

## 5. 实战案例：把确定性判断从 LLM 脑子里剥离

所有「可形式化定义、有明确标准答案」的判断都不应交由 LLM 猜测，而应写成纯 Python 的结构化契约。例如在数据分析流水线中，调用执行工具后直接读取 Workspace 中的 `AnalysisScope`，完全由确定性函数完成以下两步校验：

### 5.1 不用 LLM 如何「对比 Gaps（语义缺口）」

Gaps 不是靠自然语言去“看懂还缺什么”，而是**结构化清单的集合求差**：

1. **上游建档算差集（Stage 1）**：文件上传进入 `admit_analysis_scope` 时，Python 根据选定范式 `catalog/<paradigm>.yaml` 声明的必填槽位（如区域角色 `open_arm` / `closed_arm`、试次 `subject_id` 与 `group`、标定单位等），直接拿解析元数据与已确认字典逐槽位求差集（`project_scope_unit_gaps` / `raw_semantic_gaps`）。缺哪一项就往 `AnalysisScope.gaps` 写入结构化记录；用户提交交互卡片后，`commit_scope_patch` 按提交答案消除对应条目。
2. **Pipeline 入口有效语义过滤（Stage 2）**：`arun_analysis_pipeline` 从数据库读取 `scope` 后，调用纯 Python 函数 `project_effective_analysis_semantics` 与 `filter_effective_scope_gaps`：
   - 若选择了 `descriptive_only` 或 `group_design == "none"`，将 `subject_id` / `group` 放入 `retired_trial_fields`；
   - 若某些 trial 被排除（`excluded == True`），过滤对应单元的缺口；
   - 若过滤后 `gaps` 仍非空，直接通过 `scope_gap_card_fields(...)` 转为交互卡片、终止管线并弹出让用户填写。

### 5.2 不用 LLM 如何判断「设计可估计性（Design Estimability）」

在 `build_execution_contract → _design_estimability → _phase_capabilities` 中，Python 对活跃实验单元列表 `analysis_units`（按 `phase` 分桶）做纯数学统计计数：

1. `n_groups`：不同分组去重计数（`group_code`）；
2. `min_animals_per_group`：最少动物数量的组别个体数（`experimental_unit_id` 去重）；
3. `max_observations_per_animal`：单只动物最大观测次数；
4. `ungrouped_units`：是否存在未分组单元及重复测量身份安全性（`identity_repeat_safe`）。

随后直接套用统计学准入硬规则：

- **组间推断统计（p 值、效应量、核心对比图）**：`group_comparison = ready and not descriptive_enabled and n_groups >= 2 and min_animals >= 3`。若只有 1 组或某组少于 3 只样本，直接判定 `inferential_statistics = False`、`underpowered = True`（原因为 `"underpowered_n_per_group"`）、`effective_report_mode = "descriptive"`，后续统计和报告自动降级为描述性报告，不强算、不报错死循环。
- **重复测量模型（如 MixedLM）**：`repeated_measures = ready and max_obs >= 2`。若每只动物仅 1 次观测，直接关闭该能力以从源头拦截模型报错。

> **一句话总结**：`gaps = 必填槽位 - 已确认槽位 - 已豁免/排除槽位`；`design_estimability = 分组与样本计数 + 统计学准入门槛`。1 毫秒得出确定结论，杜绝大模型“觉得 2 只样本也能跑 t 检验试试”的幻觉。

---

## 6. 并发与进程隔离：保住 Gateway Event Loop 的呼吸权

Agent 运行时是一个较重的服务进程。把计算/重活卸载给独立 Worker，更精准的目的不是为了防“这一个 Agent 自己的 while loop”（当前会话无论如何都要等工具返回后才进下一轮推理），而是**为了不冻死整个 Gateway 进程的 `asyncio` 主事件循环（Event Loop）**。

### 6.1 单个 Agent 的等待 vs Gateway 事件循环

FastAPI / uvicorn 中的一个 Gateway worker 进程靠单线程的 `asyncio` 事件循环同时服务全站所有并发用户：其他人的对话、SSE 流式吐字、`/health`、鉴权接口、文件上传与进度推送。若把算指标、画图、解析轨迹等 CPU/I/O 重活同步跑在主事件循环上，会引发三类真实线上事故：

1. **一人算数据，全站 504 雪崩（ADR-0009）**：同步收尾逻辑曾阻塞事件循环 142–323 秒，导致全站 `/health`、`/api/v1/auth/me` 与页面渲染全部无响应，外层代理直接报 504。
2. **当前任务的 SSE 进度推送哑火**：计算几十项指标期间，SSE 进度队列无法调度发出，前端持续转圈卡死。
3. **心跳饿死，存活任务被同伴误杀（ADR-0034）**：生成 56 张图表的报告曾冻住主循环 74.2 秒；多 Worker 架构下心跳续租超时为 40s（30s + 10s），心跳协程恰巧也跑在主循环上导致停跳 74 秒，隔壁 Worker 误判其崩溃并当成孤儿任务强行 Cancel。

### 6.2 三级隔离方案

1. **I/O 与轻重活 → 线程池（`asyncio.to_thread`）**：事件循环只跑轻量异步调度与网络收发；遇磁盘读写、Markdown 编译、DuckDB 查询立即 `await asyncio.to_thread(...)` 让出控制权。
2. **纯计算多核并行 → 进程池（`ProcessPoolExecutor` / `spawn`）**：受 Python GIL 限制（同进程同一时刻仅单线程执行字节码），多样本轨迹等 CPU 密集型计算放入进程池实现真并行；同时注意在多线程父进程中应优先 `spawn` 轻子进程并在内部开进程池（避开 `fork` 继承锁导致 Deadlock 及 `matplotlib` 等 C 扩展全局状态污染），主进程用 `asyncio` 非阻塞等待。
3. **重型收尾与心跳 → 彻底出进程 / 出循环**：
   - 重型收尾（chart/report landing）拆入独立 `deerflow-landing-worker` 进程（ADR-0009）；
   - 存活探针心跳移入独立 `threading.Thread`（ADR-0034），即便主循环偶发抖动也不会误杀正在执行的任务。

---

## 7. 两节点 ReAct 如何实现严格状态机

Agent 本质上带有状态推进约束，但**不应通过硬编码多节点状态机去规定 Agent 下一步的发挥**，而应让 Agent 基于当前上下文推导行动，再由状态栏与门卫提供刚性约束。

### 7.1 「过山车轨道」vs「两节点开放世界 + 状态栏 + 门卫」

- **传统 `StateGraph` 多节点写法（「过山车轨道」）**：手动画 `[接收] → [计算] → [判读] → [报告]` 与一堆 `add_conditional_edges`。缺点是车上了轨道只能顺着铁轨走，用户半路插问一句“为什么第 3 只鼠数据异常？”流程就会卡死。
- **当前架构（「两节点开放世界 + 玩家状态栏 + 门卫」）**：底层 `create_agent(..., state_schema=ThreadState)` 编译出的图永远只有 `model (LLM)` 和 `tools` 两个节点循环，而状态机由以下三部分承载：
  1. **`ThreadState` = 玩家身上的“状态栏”**（均配自定义 Reducer）：
     - `pipeline_control`（`merge_pipeline_control`）：记录当前关卡 `stage`（`intake → protocol_confirmed → metrics_computed → insight_deducted → delivered`）与 `budget` 重试次数；
     - `pending_ask`（`merge_pending_ask`）：记录屏幕上未填完的交互卡片（带 `request_id` 校验，旧请求清不掉新卡片）；
     - `analysis_lifecycle`（`merge_analysis_lifecycle`）：带 `_producer_proof` 防伪校验，普通工具或 LLM 乱写会被 Reducer 直接忽略；
     - `analysis_events`（`merge_analysis_events`）：记录最近发生的分析事件流水。
  2. **Tool 返回 `Command(update=...)` = “通关改状态栏”**：工具执行完业务后，返回 `Command(update={"pipeline_control": {"stage": "metrics_computed"}})` 推进关卡。
  3. **三道核心 Middleware 门卫**：
     - **动态给工具（`StageScopedToolMiddleware`）**：每次调用模型前（`awrap_model_call`）读取 `ThreadState.pipeline_control["stage"]` 并核对 DB 真实产物进度（`detect_analysis_stage`），取最高阶段动态改写 `request.tools`——前置未满足的工具对模型完全不可见，杜绝乱序调用；条件满足后放开同类合法工具由 LLM 自主推理选择。
     - **能直通就不让模型调（`ScopeCardCommitMiddleware`）**：当用户在前端提交语义确认卡片时，`abefore_agent` 读取 `ThreadState.pending_ask` 与表单答案直接落库，并在 `gaps == 0` 时直接跑完计算流水线，省去 1–2 轮无意义的 Function Calling。
     - **看预算与拦幻觉（`RunBudgetMiddleware` / `ExplanationVerificationGate`）**：读取 `budget`，同一组参数连续报错 2 次后第 3 次直接熔断；最终输出正文前对照权威账本数字做一次溯源校验。

### 7.2 为什么状态要拆分 `ThreadState` 与 Postgres DB 两半放？

| 存储载体 | 定位与职责 | 典型内容 | 原因 |
| --- | --- | --- | --- |
| `ThreadState`（Checkpointer） | 这一趟 Agent 对话的**控制态** | `pipeline_control`（stage / budget）、`pending_ask` | 随 LangGraph Checkpointer 在每轮 `model ↔ tools` 间高频读写与恢复 |
| `Postgres DB` | 科研/业务实体的**事实态** | `AnalysisScope`（gaps / revision）、`SqlLedger`（`FactStatus`） | 需跨会话复用、支撑前端 Canvas 工作台展示，并在进程重启后作为唯一权威数据源 |

> **一句话总结**：把状态机的数据（`stage` / `pending_ask` / `budget`）和转移约束（Reducer）写进 `ThreadState`，用 Middleware 读 State 动态开关工具，就能让一个标准的 `model ↔ tools` ReAct 循环既保留自由对话能力，又表现出严格的状态机行为。

---

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
