type Value = Record<string, unknown>;
export type PlatformToolReceipt = { tool: string; call_id: string; output: unknown };
const object = (value: unknown): value is Value => Boolean(value && typeof value === "object" && !Array.isArray(value));
const safeId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9_-]{1,100}$/i.test(value);

function mediaReceipt(receipt: PlatformToolReceipt): string | undefined {
  const label = receipt.tool === "minixm_image_generate" ? "图片" : receipt.tool === "minixm_video_generate" ? "视频" : undefined;
  if (!label) return;
  const output = object(receipt.output) ? receipt.output : {};
  const result = object(output.result) ? output.result : {};
  const job = safeId(result.job_id) ? `任务：${result.job_id}。` : "";
  if (output.ok !== true || result.status === "failed" || result.status === "cancelled") {
    const error = object(output.error) ? output.error : {};
    const code = typeof error.code === "string" && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.code) ? `错误：${error.code}。` : "";
    return `${label}生成未完成。${job}${code}`;
  }
  if (typeof result.status === "string" && !["complete", "completed"].includes(result.status)) {
    const status = result.status === "submission_unknown" ? "提交结果待确认" : "仍在处理中";
    return `${label}${status}。${job}请查询原任务，不要重复生成。`;
  }
  let url: URL | undefined;
  try {
    if (typeof result.url === "string" && !/[\s<>"\u0000-\u001f\u007f]/.test(result.url)) url = new URL(result.url);
  } catch { /* Unusable links must not become a success claim. */ }
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    return `${label}结果暂不可下载。${job}请查询原任务，不要重复生成。`;
  }
  const parts = [`${label}已生成。`];
  if (Number.isSafeInteger(result.width) && Number(result.width) > 0 && Number.isSafeInteger(result.height) && Number(result.height) > 0) {
    parts.push(`尺寸：${result.width} × ${result.height}`);
  }
  if (receipt.tool === "minixm_video_generate" && typeof result.seconds === "number" && Number.isFinite(result.seconds) && result.seconds > 0) {
    parts.push(`时长：${result.seconds} 秒`);
  }
  parts.push(`下载地址：<${result.url}>`);
  if (typeof result.prompt === "string" && result.prompt.trim()) {
    // Keep prompt Markdown literal, including any code fences inside the prompt.
    let fenceLength = 3;
    for (const match of result.prompt.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
    const fence = "`".repeat(fenceLength);
    parts.push(`提示词：\n\n${fence}text\n${result.prompt}\n${fence}`);
  }
  return parts.join("\n\n");
}

export function platformReceiptText(receipts: readonly PlatformToolReceipt[]): string {
  const media = receipts.map(mediaReceipt);
  if (media.every(text => text === undefined)) return JSON.stringify({ platform_tool_results: receipts });
  // Keep unrelated tool contracts intact; only generation receipts are display summaries.
  return receipts.map((receipt, index) => media[index] ?? JSON.stringify({ platform_tool_results: [receipt] })).join("\n\n");
}

export function readableMediaReceipts(response: Value): Value {
  if (!Array.isArray(response.output)) return response;
  const replacements = new Map<string, string>();
  const output = response.output.map(item => {
    if (!object(item) || item.type !== "message" || item.role !== "assistant" || typeof item.id !== "string"
      || !/^msg_minixm_[a-f0-9]{32}$/i.test(item.id) || !Array.isArray(item.content)) return item;
    let changed = false;
    const content = item.content.map(part => {
      if (!object(part) || part.type !== "output_text" || typeof part.text !== "string") return part;
      let parsed: unknown;
      try { parsed = JSON.parse(part.text); } catch { return part; }
      if (!object(parsed) || Object.keys(parsed).length !== 1 || !Array.isArray(parsed.platform_tool_results)
        || !parsed.platform_tool_results.every(receipt => object(receipt) && typeof receipt.tool === "string" && typeof receipt.call_id === "string" && object(receipt.output))) return part;
      const receipts = parsed.platform_tool_results as PlatformToolReceipt[];
      if (!receipts.some(receipt => receipt.tool === "minixm_image_generate" || receipt.tool === "minixm_video_generate")) return part;
      const text = platformReceiptText(receipts);
      changed = true;
      replacements.set(part.text, text);
      return { ...part, text };
    });
    return changed ? { ...item, content } : item;
  });
  if (!replacements.size) return response;
  let outputText = typeof response.output_text === "string" ? response.output_text : undefined;
  if (typeof outputText === "string") for (const [before, after] of replacements) outputText = outputText.replaceAll(before, after);
  return { ...response, output, ...(typeof outputText === "string" ? { output_text: outputText } : {}) };
}
