# 会话花费（dsh-session-cost）

DeepSeek Harness 的客户端插件：在输入框下面那一行（和 `7 轮 317 步 · tok/s · 缓存命中` 同一行）显示 **`本会话已花 / 账户余额`**，点开是明细。

设计前提是用户提的两条：**花费完全本地计算，不打官方接口**；**余额尽量少打接口**。

## 显示

- 胶囊：`3.31 / 86.30`——左边本会话花费（人民币），右边账户余额。没有单位、没有前缀，因为只有一个账户和一种币种。
- 点开明细：四类 token 用量、高峰/空闲金额拆分、余额里充值/赠金各多少、余额读数的新鲜度、一个手动刷新按钮，以及计价口径说明。
- 子智能体算在内：显示的是**本会话 + 它的全部子会话**的合计，不分开列（明细里只给会话数）。

## 钱怎么算

**数据来源**：会话的持久日志（`ctx.sessionQuery.readSession`）。不需要任何网络请求。

折叠逻辑与 DSH 自带的 `dsh-token-meter` 的 `tokenUsage` 投影**逐条对齐**：

- 认 `assistant/message` 的 `data.usage`（缺失时回退到 `assistant/attempt` 最后一条 `usage` 流块）；
- 用量字段：`inputTokens`（未命中输入）、`cacheReadTokens`（缓存命中）、`cacheWriteTokens`（缓存写）、`outputTokens`；
- **同一次尝试（turn/step 相同）的重复上报互相替换**，所以流式重述不会重复计费；**不同步骤累加**；
- `llm/retry-started` 关掉替换槽位，所以重试的那次也计费。

**与参考实现的唯一差别**：每个存活样本保留自己的**时间戳**，据此判定高峰/空闲，而不是拿会话总量乘一个价格。

**价格**（元/百万 tokens，[官方价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，核对日期 2026-10-04）：

| | deepseek-flash 空闲 | deepseek-flash 高峰 | deepseek-v4-pro 空闲 | deepseek-v4-pro 高峰 |
| --- | --- | --- | --- | --- |
| 输入（缓存命中） | 0.02 | 0.04 | 0.15 | 0.30 |
| 输入（缓存未命中） | 1 | 2 | 4.5 | 9.0 |
| 输出 | 4 | 8 | 13.5 | 27.0 |

缓存写按缓存未命中的单价计。

**高峰时段**：北京时间周一至周五 09:00–12:00、14:00–18:00；其余为空闲。模型取自日志里的 `request/header`（`header.config.model`），表里没有的模型按 Flash 计价并在返回里标 `unpriced`。

**这是估算，不是账单**，界面里也这么写。已知会造成偏差的地方：

- **中国法定节假日未建模**：节假日实际是空闲价，这里会按高峰价算，**偏高**，最多一倍。
- **标题生成、网页搜索等侧路请求**的用量不在 `assistant/message` 里，**没有计入**——偏低，量很小。
- 官方调价后需要更新价格表。

## 余额

- 接口：`GET https://api.deepseek.com/user/balance`，Bearer key。
- key 通过 `ctx.credentials.resolve('DEEPSEEK_API_KEY')` 读取，**不落盘、不回传浏览器**，只在 host 进程内用于这一次请求。
- **少请求策略**：读数缓存到 `$DSH_HOME/storages/dsh-session-cost/balance.json`（600 权限），进程重启也复用；默认 **15 分钟 TTL**；`?refresh=1` 强制读取。客户端每 60 秒问一次本地缓存，因此正常使用时**每 15 分钟最多 1 次真实请求**，多数轮询都不会触发。
- 余额不会因为本地花费而自动扣减（别的设备/工具也在花），所以明细里标明"余额取自 X 分钟前"，不假装是实时值。

## 接口

`GET`，JSON，`cache-control: no-store`：

| 路由 | 内容 |
| --- | --- |
| `/cost-api/session?sessionId=<id>` | 本会话 + 全部子会话：`cost`、四类 token 合计、`byTier`、计费次数、涉及的模型、`sessions` 数 |
| `/cost-api/balance[?refresh=1]` | 缓存的余额（含 `fetchedAt`/`ageMs`/`cached`/`keyState`；失败时带 `error` 与上一次读数） |
| `/cost-api/prices` | 实际使用的价格表 + 来源与核对日期 |
| `/cost-api/health` | `{ok, keyState, balanceAgeMs, cachedSessions}` |

## 安装

与知识板相同：客户端侧栏 **插件 → Add plugin**，填绝对路径 `/Users/zeyuan/wawa/tooling/dsh-session-cost`，安装后 Enable now。

**改动 `lib/index.js`（host 半）后必须完全退出客户端再打开**；`lib/client.js` 会热重载。客户端对两者版本不一致是容忍的（接口 404 时胶囊显示 `— / …`，不会报错刷屏）。

可选配置（写在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 里针对 `id: session-cost` 的覆盖条目）：

```yaml
- id: session-cost
  config:
    balanceTtlMs: 900000                      # 余额读数复用时长，默认 15 分钟
    model: deepseek-flash                     # 日志没给模型时的计价表
    balanceUrl: https://api.deepseek.com/user/balance
    balancePath: /absolute/path/balance.json
    prices:                                   # 覆盖内置价目表
      deepseek-flash:
        peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 }
        offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 }
```

## 验证（2026-10-05）

**折叠逻辑**（`lib/index.js` 导出了 `isPeak` / `foldEvents` / `priceSample` 等，可直接跑）：

| 用例 | 期望 | 实测 |
| --- | --- | --- |
| 高峰/空闲判定（周一 10:00 / 周一 20:00 / 周六 10:00 / 周一 12:00 午休） | true/false/false/false | ✅ |
| 单次 1M 未命中输入 + 1M 输出（高峰） | ¥10.0000 | ✅ |
| 同上（空闲） | ¥5.0000 | ✅ |
| 同一步骤内重述两次 | 只计一次 ¥10.0000 | ✅ |
| 重试（`llm/retry-started`）后再次上报 | 两次都计 ¥20.0000 | ✅ |
| **不同步骤连续上报** | 累加 ¥30.0000（3 次） | ✅（这条曾在真实数据上暴露过一个 bug） |
| 1M 缓存命中 + 1M 输出（高峰） | ¥8.0400 | ✅ |
| 未知模型 | 按 Flash 计并标记 | ✅ |

**真实日志**：拿本会话 2478 个事件的日志解压后跑折叠——374 条 `assistant/message` **全部**带 `data.usage`，字段名与耗时戳（毫秒）都符合预期；折叠出的 token 合计与日志里 provider 自报的 `usage.totalTokens` 之和**完全相等**（97,354,497）。会话里确实存在 4 次 `llm/retry-started`，重试计费那条路径是必要的。

**接口与缓存**（隔离实例 + 本地 mock 顶替官方余额接口）：余额首次读取命中 mock、第二次读缓存不打 mock、`?refresh=1` 再打一次；缓存文件权限 600；进程重启后仍复用缓存读数。

**未验证**：真实 DeepSeek 余额接口的成功解析（用 mock 验证了同样的 JSON 形状与错误分支），以及客户端半在真机上的视觉效果。

## 已知限制

- 见上文「这是估算，不是账单」下的三条偏差来源。
- 子会话的归属靠 `SessionHeader.parentSession` 逐层展开；子会话若被删除，其花费就不再计入。
- 冷会话需要先把日志读出来折叠一次（有按日志长度做的内存缓存）；单个会话读一次约几十毫秒。
- 余额是账户级数字，不做"本地花费扣减"，因为别的工具/设备也在用同一个 key。
