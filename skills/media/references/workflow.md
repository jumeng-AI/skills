# 生成顺序

`list_models` 的 `type` 只能是 `image` 或 `video`。它只返回控制台打开了「MCP 生图」或「MCP 生视频」、并且这把密钥能用的模型。返回里的名字就是显示名。读说明和生成都只传这个显示名。`docs_available` 固定是 `true`，不能用来判断文档能不能读。`recommended: true` 最多一个，由服务端按固定顺序标出。技能不写模型名表。

`get_model_docs` 的 `model` 只传这次 `list_models` 里的显示名。成功时用返回的 `markdown`。说明读不到时，这个工具以及 `generate_image`、`generate_video` 都返回 `docs_unavailable`。参数只使用这次 `markdown` 里的字段和取值。说明里让传什么比例或 `size`，就传什么。

## 提交

`generate_image` 与 `generate_video` 的参数都是 `model`、`params`、`client_request_id`。

`client_request_id` 为 8–64 位字母、数字、`_`、`-`。

| 情况 | 做法 |
| --- | --- |
| 同 ID、同参数再次提交 | 返回原结果，`reused: true`，不另扣 |
| 同 ID、参数不同 | `client_request_id_conflict`，不新建任务 |
| 调用超时或响应丢失 | 用原 ID 再查 `get_generation`，或用原 ID 再提交 |
| 图片 `state` 为 `failed`，或视频 `status` 为 `FAILURE`、`ABNORMAL`，用户要重做 | 换新 ID |
| 图片 `unknown`，或视频 `UNKNOWN` | 不自动重做，让用户到控制台任务列表核对 |
| `generation_not_found` | 记录超过约 24 小时或 ID 不对。告诉用户，不据此重新生成 |

返回后立即结束本次调用。

图片看 `state` 和 `results`。`pending` 或 `processing` 时，等待 `poll_after_seconds` 再查，间隔是 20 秒。`completed`、`failed`、`unknown` 时，`poll_after_seconds` 为 0。`completed` 的地址在 `results[].url`。

| `state` | 含义 |
| --- | --- |
| `pending` | 已接受，尚未处理 |
| `processing` | 处理中 |
| `completed` | 完成，`results` 里有 URL |
| `failed` | 失败 |
| `unknown` | 结果未能确认 |

视频提交成功时返回 `task_id`、`client_request_id`、`status`、`poll_after_seconds`。任务还在排队或处理中，`poll_after_seconds` 是 60。这时没有成片地址，也没有 `credits`。之后按 `poll_after_seconds` 再调 `get_generation` 或 `get_task`。

| `status` | 做法 |
| --- | --- |
| `NOT_START`、`SUBMITTED`、`QUEUED`、`IN_PROGRESS` | `poll_after_seconds` 为 60，到时再查 |
| `SUCCESS` | 停止。成片地址是 `result_url`，本次消耗是 `credits` |
| `FAILURE`、`ABNORMAL` | 停止。原因在 `fail_reason`。用户要求重做才换新的 `client_request_id` |
| `UNKNOWN` | 停止，不换 ID，不自动重做 |

`get_usage` 只合计扣费，失败后退回的金额不从合计里减去。

## 上传

`create_upload` 返回 `upload_url`、`expires_at`、`field_name`。`field_name` 固定是 `file`。地址 15 分钟内有效，只能 POST 一次，不带 Authorization。

成功响应里的 `url` 才能放进 `params`。再次使用同一票据会得到 `upload_token_used`，过期是 `upload_token_expired`。国内未实名时，创建票据返回 `realname_required`。

## 交付

图片用 `results[].url`，视频用查询返回的 `result_url`，都用普通链接给用户。用户要求保存时，只下载这一次返回的地址。路径用绝对路径，斜杠用 `/`，并且必须在 `--root`（默认当前目录）里面。
