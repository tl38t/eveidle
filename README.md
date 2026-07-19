# EVE Idle modular version

本目录是从项目根目录现有 `index.html` 拆分出的独立版本。根目录原文件不会被生成脚本修改。

## 本地运行

请通过 HTTP 服务访问，不要直接双击 HTML：

在 `eveidle-modular` 目录中运行：

```powershell
node ./tools/serve.mjs 8000
```

然后访问 `http://localhost:8000/`。

## Netlify

- 手动部署：上传整个 `eveidle-modular` 文件夹，而不是只上传 `index.html`。
- Git 部署：将 Publish directory 指向 `eveidle-modular`，Build command 留空。

## 目录职责

- `css/`：按原始加载顺序拆分的样式。
- `js/data/`：配置表与静态数据。
- `js/core/`：状态、队列、tick、离线和存档。
- `js/systems/`：生产、制造、行星与战斗系统。
- `js/ui/`：弹窗、渲染和事件绑定。
- `images/`：本版本独立使用的图片副本。

当前采用按顺序加载的原生 JavaScript 文件，不需要 npm 或构建命令。这样可以先确保拆分前后行为一致，再逐步收紧模块边界。

详细的分层规则、View State约束与迁移状态见 [ARCHITECTURE.md](./ARCHITECTURE.md)。
