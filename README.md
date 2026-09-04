# Muse Proxy

本地/VPS 代理，把 OpenCode Zen 的免费模型接入 Codex 和 Claude Code。

支持所有无需登录即可使用的 OpenCode Zen 免费模型，模型列表自动发现、自动更新，无需手动配置。

## 功能

- **动态模型发现**：启动时自动拉取可用模型列表，每 5 分钟刷新一次，新模型自动加入，失效模型自动移除
- **双格式兼容**：同时支持 OpenAI Responses（Codex）和 Anthropic Messages（Claude Code）格式
- **流式输出**：Codex 和 Claude Code 均支持流式（SSE）响应
- **密码保护**：API Key 校验，constant-time 比较，防止公网滥用
- **一键部署**：本地 PowerShell 脚本或 VPS Docker Compose
- **自动回退**：指定的模型不可用时自动回退到免费模型

## 本地使用

1. 复制 `.env.example` 为 `.env`，设置你的密码：

```powershell
Copy-Item .env.example .env
# 编辑 .env，修改 API_KEY
```

2. 启动：

```powershell
.\start.ps1
```

启动后监听 `http://0.0.0.0:3456`。

首次运行会自动 `npm ci` 安装依赖。

## VPS Docker 部署

```bash
# 1. 创建目录并写入配置
mkdir muse-proxy && cd muse-proxy
echo "API_KEY=你的密码" > .env

# 2. 下载 docker-compose.yml
curl -o docker-compose.yml https://raw.githubusercontent.com/kadidalax/opencode2api/main/docker-compose.yml

# 3. 一键启动（自动拉取镜像）
docker compose up -d

# 4. 验证
curl -H "Authorization: Bearer 你的密码" http://localhost:3456/health
```

每次推送到 `main` 分支，GitHub Actions 自动构建镜像并推送到 ghcr.io。

## 远程调用配置

在本地 cc-switch 中：

- **Codex** Base URL: `http://你的VPS_IP:3456/v1`
- **Claude Code** Base URL: `http://你的VPS_IP:3456`
- **API Key**: 填你 `.env` 里设置的值

本地运行则把 IP 换成 `127.0.0.1`。

## 环境变量

通过 `.env` 文件或环境变量设置：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 监听端口 | `3456` |
| `HOST` | 监听地址 | `0.0.0.0` |
| `API_KEY` | API 密码，留空则不验证（不推荐） | 空 |
| `HTTP_PROXY` | 上游 HTTP 代理，用于绕过地区限制 | 空 |
| `DEFAULT_MODEL` | 默认模型 ID | `muse-spark-1.3-contributor-free` |

### 代理说明

| 场景 | 是否需要 `HTTP_PROXY` |
|------|----------------------|
| 本地电脑（中国大陆） | ✅ 需要，设为你的科学上网代理地址 |
| VPS（美国/日本等不受限地区） | ❌ 不需要，Docker Compose 已强制为空 |
| VPS（中国大陆，不推荐） | 需要手动改 `docker-compose.yml` 里的 `HTTP_PROXY=` |

不设代理时，服务器直连 OpenCode Zen。如果你的 IP 在受限地区，所有请求会被 403 拦截。

### 模型选择

- 客户端 `model` 字段填什么就用什么（必须在可用列表里）
- 不填或填 `auto` → 使用 `DEFAULT_MODEL`
- `DEFAULT_MODEL` 不在可用列表 → 自动找含 `free` 的第一个模型
- 全部不可用 → 返回 503

查看当前可用模型：

```bash
curl -H "Authorization: Bearer 你的密码" http://localhost:3456/v1/models
```

## API 端点

| 端点 | 用途 | 客户端 |
|------|------|--------|
| `GET /health` | 健康检查 | Docker healthcheck |
| `GET /v1/models` | 当前可用模型列表 | - |
| `POST /v1/responses` | OpenAI Responses 格式（支持流式） | Codex |
| `POST /v1/messages` | Anthropic Messages 格式（支持流式） | Claude Code |

所有端点（除 `/health`）都需要 API Key 认证，通过 `Authorization: Bearer <key>` 或 `x-api-key` 头传入。

## 注意事项

- **VPS 出口 IP** 必须不在受限地区（中国被拦），否则需要代理
- **免费模型会用你的对话训练模型**，不要发敏感代码
- **Claude Code 工具调用不可用**，只能当聊天窗口用（代理只转换了普通对话，没转换工具调用格式）
- **模型响应偏慢**：免费模型每次回复前有较长推理，简单问题也需几秒
- **免费随时可能变**：OpenCode 没承诺永久免费，如果哪天加认证需要跟着改

## 许可

MIT
