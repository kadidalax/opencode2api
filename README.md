# Muse Proxy

本地/VPS 代理，把 OpenCode Zen 的 `muse-spark-1.3-contributor-free` 免费模型接入 Codex 和 Claude Code。

## 本地使用

```powershell
.\start.ps1
```

启动后监听 `http://127.0.0.1:3456`。

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
curl http://localhost:3456/health
```

## 远程调用配置

在本地 cc-switch 中：

- **Codex** Base URL: `http://你的VPS_IP:3456/v1`
- **Claude Code** Base URL: `http://你的VPS_IP:3456`
- **API Key**: 填你 `.env` 里设置的值

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 监听端口 | `3456` |
| `HOST` | 监听地址 | `0.0.0.0` |
| `API_KEY` | 密码保护，留空则不验证 | 空 |
| `HTTP_PROXY` | 上游代理 | `http://127.0.0.1:10808`（VPS 设为空） |

## 注意事项

- **VPS 出口 IP** 必须不在受限地区（中国被拦）
- **免费模型会用你的对话训练模型**，不要发敏感代码
- **Claude Code 工具调用不可用**，只能当聊天窗口用
- **模型每次回复前有较长推理**，简单问题也需几秒

## API 端点

| 端点 | 用途 | 客户端 |
|------|------|--------|
| `GET /health` | 健康检查 | - |
| `GET /v1/models` | 模型列表 | - |
| `POST /v1/responses` | OpenAI Responses 格式 | Codex |
| `POST /v1/messages` | Anthropic Messages 格式 | Claude Code |

