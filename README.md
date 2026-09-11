# miniXMapi

独立的 miniXM 多模态 API 融合中转服务。

独立的 OpenAI 兼容融合层。客户只需要把 `base_url` 改到网关，并使用网关签发的 API Key；请求中的 `model` 会被覆盖为服务端配置的默认 LLM 模型。上游 LLM、图片和视频密钥只存在服务端环境变量中，不会转发或返回给客户。

入口：`POST /v1/responses`、`POST /v1/chat/completions`、`GET /v1/models`。平台工具为 `minixm_image_generate` 和 `minixm_video_generate`。图片结果与 MiniMax H3 视频结果先归档到网关自己的媒体目录，再返回 `/v1/media/...` 稳定地址；视频提交超时保持 `submission_unknown`，不会自动重提。

启动前配置 `GATEWAY_ADMIN_TOKEN`、`GATEWAY_LLM_BASE_URL`、`GATEWAY_LLM_API_KEY`、`GATEWAY_LLM_DEFAULT_MODEL`、`GATEWAY_IMAGE_BASE_URL`、`GATEWAY_IMAGE_API_KEY`、`GATEWAY_VIDEO_BASE_URL`、`GATEWAY_VIDEO_API_KEY`。管理员先调用 `POST /admin/accounts`，再调用 `POST /admin/accounts/:id/keys` 创建客户凭据；密钥只在创建响应中出现一次。

当前流式响应是内部工具循环完成后生成的兼容 SSE，不代表上游事件逐字节透传。服务仍是候选版，未切生产。
