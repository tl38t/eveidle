# 联盟每日任务云函数

这是每日任务接入的第一步：函数以服务器上海时间确定日期，对同一 `playerId + serverDate` 只创建一次任务（条数由任务大厅等级决定：L1–L5 = 5/6/7/8/10），并返回已经固化的任务。

## 部署前配置

本目录包含 `cloudbaserc.json`：使用 CloudBase CLI 从本目录部署时，会按声明自动配置 HTTP 函数、`/alliance-daily-tasks` 路径并允许匿名访问。控制台部署时请手动填写相同的 HTTP 访问配置。

在 HTTP 云函数中设置环境变量：

- `CLOUDBASE_API_BASE`：`https://deepspace-d4govx4ikc2e937c5.api.tcloudbasegateway.com`
- `CLOUDBASE_SERVER_API_KEY`：CloudBase「环境管理 → API Key 配置」里的服务端 API Key
- `ALLOWED_ORIGIN`：联盟静态页域名，测试阶段可填 `*`

CLI 部署示例（在本目录执行）：

```bash
tcb fn deploy --httpFn
```

函数必须能访问 PostgreSQL REST API，并且服务端 API Key 需要对 `alliance_daily_tasks` 有读写权限。不要把这个 Key 写进网页。

## 请求

网络诊断可发送以下请求确认函数已部署；该请求不会读写数据库：

```json
{
  "action": "health",
  "playerId": "player_xxx"
}
```

`POST` JSON：

```json
{
  "playerId": "player_xxx",
  "taskPreview": [/* 游戏侧生成的 5 条任务 */]
}
```

响应会包含 `serverDate`、`created`、`expectedCount`、`hallLevel` 和当天固化后的 `tasks`。

提交任务时使用同一个函数：

```json
{
  "action": "submit",
  "playerId": "player_xxx",
  "allianceId": 1,
  "taskId": 12,
  "amount": 100
}
```

云函数会调用 PostgreSQL 的 `submit_alliance_task` 原子函数，校验任务日期、玩家归属、联盟成员资格和数量，并一次性写入提交记录、完成任务、增加建设点和贡献日志。重复提交会被拒绝。

## 当前安全边界

服务器已经控制日期、**任务条数上界**、重复创建、提交原子性和奖励公式：

- **条数**（2026-09-20 起）：由服务端按任务大厅等级封顶（`hall.resolved` 时才封顶，解析不到大厅等级则保持旧行为）。旧行为是 `previewCount = preview.length`，等于把条数权威让给客户端 —— 客户端只送 5 条服务端就只建 5 行，且 `existing(5) !== expected(6)` 天天成立却一个槽位都不补，导致当天永久卡 5 条。现在只在**超出**授权条数时裁剪（封顶而非报错：报错会让客户端退回本地预览，玩家感知成「连不上」），并在响应里回报 `expectedCount` / `hallLevel`。
- **`required_level`**：`normalizeTasks` 一直校验该字段，但旧版拼 INSERT 行时不写、表里也没有该列 ⇒ 回传行必缺 ⇒ 客户端 `Number(undefined)=NaN` ⇒ JSON 变 `null` ⇒ 下次上行被判「技能门槛无效」（同步 400）。现已建列（迁移 `20260920064754_alliance_daily_tasks_required_level`）并由函数写入。

但任务目录仍然来自游戏侧预览，因此这仍是接入测试版；正式发布前要把目录快照随函数部署，并由函数按技能快照自行生成，不能长期信任客户端传入的材料价值 —— 注意服务端目前**没有玩家技能快照**（全库无 skill 列），所以「服务端自行生成任务」这一步还缺前置条件。
