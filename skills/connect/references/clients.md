# 客户端怎么接

国内 `https://www.jumengai.com/mcp`，服务名 `jumeng`。国际 `https://www.jumai.ai/mcp`，服务名 `jumai`。下面写国内。国际把主机换成 `www.jumai.ai`，名称换成 `jumai`。

技能仓库发布后，需要技能的客户端再用：

```bash
npx skills add jumengai/skills -g --agent <客户端> -y
```

不写 `toapis/skills`，地址不写 `api.toapis.com`。

## Claude Code

```bash
npx skills add jumengai/skills -g --agent claude-code -y
claude mcp add --transport http --scope user jumeng https://www.jumengai.com/mcp --header "X-Locale: zh"
```

`zh` 可换成 `zh-TW` 或 `en`。已有 `jumeng` 时先 `claude mcp get jumeng`，给用户看过再 `claude mcp remove jumeng --scope user`。

对话里由用户执行 `/mcp`，选 `jumeng`，浏览器允许。列表没有时先重启。Agent 不能代发这条斜杠命令。

## Codex

CLI 和桌面版共用 `~/.codex/config.toml`。

```bash
npx skills add jumengai/skills -g --agent codex -y
codex mcp add jumeng --url https://www.jumengai.com/mcp
```

这条命令不加 `X-Locale`，文案跟账号语言。添加时或执行 `codex mcp login jumeng` 打开浏览器。删掉用 `codex mcp remove jumeng`。

## Cursor

`~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "jumeng": {
      "url": "https://www.jumengai.com/mcp",
      "headers": { "X-Locale": "zh" }
    }
  }
}
```

MCP 设置里点 Connect，浏览器允许。技能可选：`npx skills add jumengai/skills -g --agent cursor -y`。

## Claude 桌面版、claude.ai

自定义连接器，URL 填 MCP 地址，Client ID 和 Secret 留空。Add 之后 Connect，浏览器允许。没有本机技能目录。不要选带 IP 白名单的密钥，这些客户端从对方服务器访问本站。

## Devin

```bash
devin mcp add -s user jumeng https://www.jumengai.com/mcp
devin mcp login jumeng
```

## Antigravity

`~/.gemini/config/mcp_config.json` 写 `serverUrl` 为 MCP 地址，并带 `X-Locale`。Authenticate 后，授权页显示授权码，用户粘贴回设置再 Submit。

## Qwen Code

```bash
npx skills add jumengai/skills -g --agent qwen-code -y
qwen mcp add --scope user --transport http jumeng https://www.jumengai.com/mcp --header "X-Locale: zh"
```

浏览器授权失败时，改成 Header `Authorization: Bearer` 加用户自己的专用密钥。密钥不进入对话。

## 豆包

自定义插件，传输类型 HTTP，URL 为 MCP 地址。Header `Authorization: Bearer` 加专用密钥。没有浏览器授权，也没有技能。提醒设置额度上限。

## 千问办公

粘贴 JSON，`type` 为 `streamable-http`，URL 为 MCP 地址，Header 带 `Authorization: Bearer` 和 `X-Locale`。导入后打开连接器，新对话才生效。没有技能。

## Trae

设置里手动添加 JSON，Header 带 `Authorization: Bearer` 和 `X-Locale`。只有密钥。技能可选：`npx skills add jumengai/skills -g --agent trae-cn -y`。

## WorkBuddy

自定义连接器只写这两项，不写 Header，不写密钥：

```json
{
  "mcpServers": {
    "jumeng": {
      "type": "http",
      "url": "https://www.jumengai.com/mcp"
    }
  }
}
```

让用户自己点信任，再点连接，在浏览器登录并允许。回到客户端后新开对话。技能从技能市场安装，不走 `npx skills add`。装好后在 `~/.workbuddy/skills/<目录名>/`。

## 其他远程客户端

Streamable HTTP。OAuth 的 Client ID 和 Secret 留空。浏览器走不通时，Header 用 `Authorization: Bearer` 加专用密钥。
