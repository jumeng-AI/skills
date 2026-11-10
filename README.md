# jumeng-skills

聚梦 jumengai.com 与 Jumai jumai.ai 的 Agent 技能。两份技能正文相同，站点写在正文里。

| 目录 | 作用 |
| --- | --- |
| `skills/connect` | 连接、授权、断开、额度、花费、任务 |
| `skills/media` | 选模型、读说明、上传、生图、生视频、跟进结果 |

MCP 地址：国内 `https://www.jumengai.com/mcp`，国际 `https://www.jumai.ai/mcp`。技能不保存密钥，也不调用 `/v1`。

```bash
npm test
```

发布后的安装命令：

```bash
npx skills add jumengai/skills -g --agent claude-code -y
npx skills add jumengai/skills -g --agent codex -y
```

WorkBuddy 不读这条安装命令，技能市场上架后装到 `~/.workbuddy/skills/`。仓库里不提交 `_skillhub_meta.json`。
