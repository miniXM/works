import { randomUUID } from "node:crypto";
import { platformReceiptText, type PlatformToolReceipt } from "./media-tool-receipts.js";

export type BufferedLlmResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

export type PlatformToolLineage = Readonly<{
  upstreamResponseId?: string;
}>;

export type PlatformToolRuntime = {
  responsesTools: ReadonlyArray<Record<string, unknown>>;
  chatTools: ReadonlyArray<Record<string, unknown>>;
  isPlatformToolName(name: string): boolean;
  execute(name: string, argumentsValue: unknown, callId: string, lineage?: PlatformToolLineage): Promise<unknown>;
};

export type LlmToolLoopOptions = {
  body: unknown;
  runtime: PlatformToolRuntime;
  callUpstream(body: Record<string, unknown>): Promise<BufferedLlmResponse>;
  maxToolRounds?: number;
  maxCallsPerRound?: number;
  beforeFollowup?(round: number): Promise<void>;
  upstreamStreaming?: boolean;
};

export type LlmToolLoopResult = BufferedLlmResponse & {
  response?: Record<string, unknown>;
  streamRequested: boolean;
  streamIncludeUsage: boolean;
  toolRounds: number;
};

export class LlmToolLoopError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly terminalToolError = false,
  ) {
    super(message);
  }
}

type ResponsesFunctionCall = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments?: unknown;
  [key: string]: unknown;
};

type ChatFunctionCall = {
  id: string;
  name: string;
  legacy: false;
  type?: string;
  function: { name: string; arguments?: unknown };
  [key: string]: unknown;
};

type ChatLegacyFunctionCall = {
  id: string;
  name: string;
  arguments?: unknown;
  legacy: true;
  [key: string]: unknown;
};

type FunctionDescriptor = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
};

function objectValue(value: unknown, code = "INVALID_LLM_REQUEST"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LlmToolLoopError(400, code, "语言模型请求必须是 JSON 对象。");
  }
  return value as Record<string, unknown>;
}

function parseUpstreamJson(response: BufferedLlmResponse): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body.toString("utf8")) as unknown;
  } catch {
    throw new LlmToolLoopError(502, "INVALID_LLM_RESPONSE", "语言模型返回了无法解析的 JSON。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LlmToolLoopError(502, "INVALID_LLM_RESPONSE", "语言模型返回格式无效。");
  }
  return parsed as Record<string, unknown>;
}

type LlmToolProtocol = "responses" | "chat_completions";

function functionToolName(tool: unknown): string | undefined {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return undefined;
  const record = tool as Record<string, unknown>;
  if (record.type !== "function") return undefined;
  if (typeof record.name === "string" && record.name.trim()) return record.name.trim();
  const fn = record.function;
  return fn && typeof fn === "object" && !Array.isArray(fn) && typeof (fn as Record<string, unknown>).name === "string"
    && ((fn as Record<string, unknown>).name as string).trim()
    ? ((fn as Record<string, unknown>).name as string).trim()
    : undefined;
}

function invalidToolDefinition(message = "tools 中包含无效的工具定义。", code = "INVALID_LLM_TOOLS"): never {
  throw new LlmToolLoopError(400, code, message);
}

function functionDescriptor(source: Record<string, unknown>, nested: Record<string, unknown> | undefined, preferNested: boolean): FunctionDescriptor {
  const read = (key: string): unknown => {
    if (preferNested && nested && Object.prototype.hasOwnProperty.call(nested, key)) return nested[key];
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    return nested?.[key];
  };
  const nameValue = read("name");
  if (typeof nameValue !== "string" || !nameValue.trim()) invalidToolDefinition();
  const descriptionValue = read("description");
  if (descriptionValue !== undefined && typeof descriptionValue !== "string") invalidToolDefinition("函数工具 description 必须是字符串。");
  const parametersValue = read("parameters");
  if (parametersValue !== undefined && (!parametersValue || typeof parametersValue !== "object" || Array.isArray(parametersValue))) {
    invalidToolDefinition("函数工具 parameters 必须是 JSON Schema 对象。");
  }
  const strictValue = read("strict");
  if (strictValue !== undefined && typeof strictValue !== "boolean") invalidToolDefinition("函数工具 strict 必须是布尔值。");
  return {
    name: nameValue.trim(),
    ...(descriptionValue === undefined ? {} : { description: descriptionValue }),
    ...(parametersValue === undefined ? {} : { parameters: parametersValue as Record<string, unknown> }),
    ...(strictValue === undefined ? {} : { strict: strictValue }),
  };
}

/**
 * Accept both common OpenAI function-tool spellings at the public boundary,
 * then emit the spelling required by the selected protocol. This keeps a
 * Chat-shaped tool from reaching Responses (and vice versa), where providers
 * commonly reject the request before a model call is made.
 */
function normalizeFunctionTool(tool: unknown, protocol: LlmToolProtocol): Record<string, unknown> {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) invalidToolDefinition();
  const source = tool as Record<string, unknown>;

  const hasNested = Object.prototype.hasOwnProperty.call(source, "function");
  const nested = source.function;
  if (hasNested && (!nested || typeof nested !== "object" || Array.isArray(nested))) {
    invalidToolDefinition("函数工具 function 必须是对象。");
  }
  const nestedObject = hasNested ? nested as Record<string, unknown> : undefined;
  const descriptor = functionDescriptor(source, nestedObject, protocol === "chat_completions");

  if (protocol === "responses") {
    const { function: _function, ...remaining } = source;
    return { ...remaining, type: "function", ...descriptor };
  }
  return { type: "function", function: descriptor };
}

function normalizeCallerTool(tool: unknown, protocol: LlmToolProtocol): Record<string, unknown> {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) invalidToolDefinition();
  const source = tool as Record<string, unknown>;
  if (source.type === "function") return normalizeFunctionTool(source, protocol);
  // Tool ecosystems evolve independently of miniXM. Anything not owned by
  // the platform is transported unchanged for the caller and upstream to
  // negotiate. Platform execution is selected separately by exact registry
  // membership, never by guessing a tool type or name prefix here.
  return { ...source };
}

function normalizeToolChoice(value: unknown, protocol: LlmToolProtocol): unknown {
  if (value === undefined || value === null || typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LlmToolLoopError(400, "INVALID_TOOL_CHOICE", "tool_choice 必须是字符串或函数选择对象。");
  }
  const source = value as Record<string, unknown>;
  if (source.type !== "function") return value;
  const hasNested = Object.prototype.hasOwnProperty.call(source, "function");
  const nested = source.function;
  if (hasNested && (!nested || typeof nested !== "object" || Array.isArray(nested))) {
    throw new LlmToolLoopError(400, "INVALID_TOOL_CHOICE", "tool_choice.function 必须是对象。");
  }
  const nestedObject = hasNested ? nested as Record<string, unknown> : undefined;
  const nameValue = nestedObject && Object.prototype.hasOwnProperty.call(nestedObject, "name") ? nestedObject.name : source.name;
  if (typeof nameValue !== "string" || !nameValue.trim()) throw new LlmToolLoopError(400, "INVALID_TOOL_CHOICE", "tool_choice.function.name 必须是非空字符串。");
  const name = nameValue.trim();
  return protocol === "responses"
    ? { type: "function", name }
    : { type: "function", function: { name } };
}

function mergeTools(
  supplied: unknown,
  platformTools: ReadonlyArray<Record<string, unknown>>,
  protocol: LlmToolProtocol,
  isPlatformToolName: (name: string) => boolean,
): Array<Record<string, unknown>> {
  if (supplied !== undefined && !Array.isArray(supplied)) {
    throw new LlmToolLoopError(400, "INVALID_LLM_TOOLS", "tools 必须是工具数组。");
  }
  const callerTools = (supplied ?? []).map((tool) => normalizeCallerTool(tool, protocol));
  return [
    ...callerTools.filter((tool) => {
      const name = functionToolName(tool);
      return !name || !isPlatformToolName(name);
    }),
    ...platformTools,
  ];
}

function responsesInputItems(input: unknown): unknown[] {
  if (Array.isArray(input)) return [...input];
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (input === undefined || input === null) return [];
  return [input];
}

function chatMessages(messages: unknown): unknown[] {
  if (!Array.isArray(messages)) {
    throw new LlmToolLoopError(400, "INVALID_MESSAGES", "messages 必须是数组。");
  }
  return [...messages];
}

function includeUsageInStream(source: Record<string, unknown>): boolean {
  const options = source.stream_options;
  return Boolean(options && typeof options === "object" && !Array.isArray(options) && (options as Record<string, unknown>).include_usage === true);
}

function internalNonStreamingBody(source: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { ...source, stream: false };
  delete body.stream_options;
  return body;
}

function responsesCalls(response: Record<string, unknown>): ResponsesFunctionCall[] {
  if (!Array.isArray(response.output)) return [];
  const calls: ResponsesFunctionCall[] = [];
  for (const item of response.output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (record.type !== "function_call") continue;
    if (typeof record.call_id !== "string" || !record.call_id.trim() || typeof record.name !== "string" || !record.name.trim()) {
      throw new LlmToolLoopError(502, "INVALID_LLM_RESPONSE", "语言模型返回的 Responses 函数调用缺少有效的 call_id 或 name。");
    }
    calls.push({ ...record, call_id: record.call_id.trim(), name: record.name.trim() } as ResponsesFunctionCall);
  }
  return calls;
}

function hasCallerManagedResponsesCall(response: Record<string, unknown>): boolean {
  if (!Array.isArray(response.output)) return false;
  return response.output.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const type = (item as Record<string, unknown>).type;
    return type === "custom_tool_call" || type === "local_shell_call" || type === "shell_call";
  });
}

function chatChoiceMessage(response: Record<string, unknown>): Record<string, unknown> | undefined {
  const choice = Array.isArray(response.choices) ? response.choices[0] : undefined;
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return undefined;
  const message = (choice as Record<string, unknown>).message;
  return message && typeof message === "object" && !Array.isArray(message) ? message as Record<string, unknown> : undefined;
}

function chatCalls(message: Record<string, unknown> | undefined): Array<ChatFunctionCall | ChatLegacyFunctionCall> {
  if (!message) return [];
  const modern: ChatFunctionCall[] = [];
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls)) {
      throw new LlmToolLoopError(502, "INVALID_LLM_RESPONSE", "语言模型返回的 Chat tool_calls 格式无效。");
    }
    for (const item of message.tool_calls) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new LlmToolLoopError(502, "INVALID_LLM_RESPONSE", "语言模型返回的 Chat 工具调用格式无效。");
      }
      const record = item as Record<string, unknown>;
      const fn = record.function;
      if (typeof record.id !== "string" || !record.id.trim() || !fn || typeof fn !== "object" || Array.isArray(fn) || typeof (fn as Record<string, unknown>).name !== "string" || !((fn as Record<string, unknown>).name as string).trim()) {
        throw new LlmToolLoopError(502, "INVALID_LLM_RESPONSE", "语言模型返回的 Chat 工具调用缺少有效的 id 或 name。");
      }
      const name = ((fn as Record<string, unknown>).name as string).trim();
      modern.push({ ...record, id: record.id.trim(), name, legacy: false, function: { ...(fn as Record<string, unknown>), name } } as ChatFunctionCall);
    }
  }
  const legacyValue = message.function_call;
  const legacy: ChatLegacyFunctionCall[] = [];
  if (legacyValue !== undefined && legacyValue !== null) {
    if (typeof legacyValue !== "object" || Array.isArray(legacyValue) || typeof (legacyValue as Record<string, unknown>).name !== "string" || !((legacyValue as Record<string, unknown>).name as string).trim()) {
      throw new LlmToolLoopError(502, "INVALID_LLM_RESPONSE", "语言模型返回的旧版 Chat function_call 格式无效。");
    }
    const name = ((legacyValue as Record<string, unknown>).name as string).trim();
    legacy.push({
      id: `legacy-${name}`,
      name,
      arguments: (legacyValue as Record<string, unknown>).arguments,
      legacy: true,
    });
  }
  if (modern.length && legacy.length) {
    throw new LlmToolLoopError(502, "MIXED_TOOL_CALLS_UNSUPPORTED", "模型同时返回了新旧两种 Chat 工具调用格式。");
  }
  return [...modern, ...legacy];
}

function toolOutput(value: unknown): string {
  // Keep the result member present even when an executor intentionally returns
  // undefined; JSON.stringify would otherwise omit it and break consumers that
  // validate tool output against a stable envelope.
  return JSON.stringify({ ok: true, result: value === undefined ? null : value });
}

function codedToolError(error: unknown): { code: string; message: string } {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    if (typeof candidate.code === "string" && /^[A-Z][A-Z0-9_]+$/.test(candidate.code)) {
      return {
        code: candidate.code,
        message: typeof candidate.message === "string" && candidate.message !== candidate.code
          ? candidate.message
          : "miniXM 工具执行失败。",
      };
    }
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) {
    return { code: error.message, message: "miniXM 工具执行失败。" };
  }
  return {
    code: "TOOL_EXECUTION_FAILED",
    message: error instanceof Error ? error.message : "miniXM 工具执行失败。",
  };
}

function toolFailure(error: unknown): string {
  const { code, message } = codedToolError(error);
  return JSON.stringify({ ok: false, error: { code, message } });
}

function isTerminalToolError(error: unknown): boolean {
  return error instanceof LlmToolLoopError && (
    error.statusCode === 402
    || error.terminalToolError
    || error.code === "OPERATION_IDEMPOTENCY_CONFLICT"
    || error.code === "OPERATION_JOB_CONFLICT"
    || error.code === "GENERATION_TIMEOUT"
    || error.code === "GENERATION_SUBMISSION_UNKNOWN"
    || error.code === "GENERATION_SUBMIT_FAILED"
    || error.code === "GENERATION_FAILED"
    || error.code === "GENERATION_NOT_CONFIGURED"
    || error.code === "PROVIDER_STATUS_FAILED"
    || error.code === "VIDEO_GENERATION_NOT_CONFIGURED"
  );
}

function isUnknownPlatformToolError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "PLATFORM_TOOL_NOT_FOUND");
}

function assertCallableRound(callCount: number, round: number, maxRounds: number, maxCalls: number): void {
  if (round >= maxRounds) throw new LlmToolLoopError(502, "TOOL_LOOP_LIMIT_EXCEEDED", `语言模型工具调用超过 ${maxRounds} 轮限制。`);
  if (callCount > maxCalls) throw new LlmToolLoopError(400, "TOO_MANY_TOOL_CALLS", `单轮最多执行 ${maxCalls} 个 miniXM 工具。`);
}

export async function runResponsesToolLoop(options: LlmToolLoopOptions): Promise<LlmToolLoopResult> {
  const source = objectValue(options.body);
  const streamRequested = source.stream === true;
  const streamIncludeUsage = includeUsageInStream(source);
  const maxRounds = options.maxToolRounds ?? 4;
  const maxCalls = options.maxCallsPerRound ?? 8;
  const tools = mergeTools(source.tools, options.runtime.responsesTools, "responses", options.runtime.isPlatformToolName);
  const hasCallerTools = Array.isArray(source.tools) && source.tools.length > 0;
  const receipts: PlatformToolReceipt[] = [];
  const handoff = (upstream: BufferedLlmResponse, response: Record<string, unknown>, round: number, visibleReceipts = receipts): LlmToolLoopResult => {
    if (!visibleReceipts.length) return { ...upstream, response, streamRequested, streamIncludeUsage, toolRounds: round };
    // Clients must replay completed platform results, not execute the hidden
    // function calls again. A normal assistant message also works statelessly.
    const receipt = {
      id: `msg_minixm_${randomUUID().replaceAll("-", "")}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", annotations: [], text: platformReceiptText(visibleReceipts) }],
    };
    const output = Array.isArray(response.output) ? response.output : [];
    const text = receipt.content[0]!.text;
    const next = {
      ...response,
      output: options.upstreamStreaming ? [...output, receipt] : [receipt, ...output],
      ...(typeof response.output_text === "string" ? {
        output_text: (options.upstreamStreaming ? [response.output_text, text] : [text, response.output_text]).filter(Boolean).join("\n\n"),
      } : {}),
    };
    const headers = { ...upstream.headers };
    delete headers["content-length"];
    return { ...upstream, headers, body: Buffer.from(JSON.stringify(next)), response: next, streamRequested, streamIncludeUsage, toolRounds: round };
  };
  let input = responsesInputItems(source.input);
  let body: Record<string, unknown> = { ...internalNonStreamingBody(source), input: source.input };
  if (tools.length || Array.isArray(source.tools)) body.tools = tools;
  else delete body.tools;
  if (hasCallerTools && options.runtime.responsesTools.length) body.parallel_tool_calls = false;
  if (Object.prototype.hasOwnProperty.call(source, "tool_choice")) body.tool_choice = normalizeToolChoice(source.tool_choice, "responses");

  for (let round = 0; ; round += 1) {
    const upstream = await options.callUpstream(options.upstreamStreaming ? { ...body, stream: true } : body);
    if (upstream.status < 200 || upstream.status >= 300) return { ...upstream, streamRequested, streamIncludeUsage, toolRounds: round };
    const response = parseUpstreamJson(upstream);
    if (options.upstreamStreaming && response.status !== "completed") {
      throw new LlmToolLoopError(502, "INVALID_LLM_STREAM", "Streaming requests require an explicitly completed upstream response.");
    }
    const calls = responsesCalls(response);
    const hasCallerManagedCall = hasCallerManagedResponsesCall(response);
    if (!calls.length) return hasCallerManagedCall
      ? handoff(upstream, response, round)
      : handoff(upstream, response, round, receipts.filter(receipt => receipt.tool === "minixm_video_generate"));
    const platformCallCount = calls.filter((call) => options.runtime.isPlatformToolName(call.name)).length;
    if (platformCallCount > 0 && hasCallerManagedCall) {
      throw new LlmToolLoopError(502, "MIXED_TOOL_CALLS_UNSUPPORTED", "模型在同一轮混合调用平台工具和调用方工具，当前请求未执行任何工具。");
    }
    if (platformCallCount === 0) {
      return handoff(upstream, response, round);
    }
    if (platformCallCount !== calls.length) throw new LlmToolLoopError(502, "MIXED_TOOL_CALLS_UNSUPPORTED", "模型在同一轮混合调用平台工具和调用方工具，当前请求未执行任何工具。");
    assertCallableRound(calls.length, round, maxRounds, maxCalls);
    await options.beforeFollowup?.(round + 1);
    const outputs: Record<string, unknown>[] = [];
    for (const call of calls) {
      try {
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: toolOutput(await options.runtime.execute(call.name, call.arguments, call.call_id, {
            upstreamResponseId: typeof response.id === "string" ? response.id : undefined,
          })),
        });
      } catch (error) {
        if (isTerminalToolError(error)) throw error;
        if (isUnknownPlatformToolError(error)) throw new LlmToolLoopError(400, "PLATFORM_TOOL_NOT_FOUND", "模型请求了未注册的 miniXM 工具。");
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: toolFailure(error) });
      }
    }
    for (const [index, output] of outputs.entries()) {
      receipts.push({ tool: calls[index]!.name, call_id: calls[index]!.call_id, output: JSON.parse(output.output as string) });
    }
    if (typeof body.previous_response_id === "string") {
      if (typeof response.id !== "string" || !response.id) {
        throw new LlmToolLoopError(502, "INVALID_LLM_RESPONSE", "语言模型没有返回可用于续接工具结果的 response id。");
      }
      input = outputs;
      body = { ...body, input, tools, previous_response_id: response.id, tool_choice: "auto", stream: false };
    } else {
      input = [...input, ...(Array.isArray(response.output) ? response.output : []), ...outputs];
      body = { ...body, input, tools, tool_choice: "auto", stream: false };
    }
  }
}

export async function runChatCompletionsToolLoop(options: LlmToolLoopOptions): Promise<LlmToolLoopResult> {
  const source = objectValue(options.body);
  const streamRequested = source.stream === true;
  const streamIncludeUsage = includeUsageInStream(source);
  const maxRounds = options.maxToolRounds ?? 4;
  const maxCalls = options.maxCallsPerRound ?? 8;
  const tools = mergeTools(source.tools, options.runtime.chatTools, "chat_completions", options.runtime.isPlatformToolName);
  const hasCallerTools = Array.isArray(source.tools) && source.tools.length > 0;
  const receipts: PlatformToolReceipt[] = [];
  let messages = chatMessages(source.messages);
  let body: Record<string, unknown> = { ...internalNonStreamingBody(source), messages };
  if (tools.length || Array.isArray(source.tools)) body.tools = tools;
  else delete body.tools;
  if (hasCallerTools && options.runtime.chatTools.length) body.parallel_tool_calls = false;
  if (Object.prototype.hasOwnProperty.call(source, "tool_choice")) body.tool_choice = normalizeToolChoice(source.tool_choice, "chat_completions");

  // A tool loop must append one assistant message and its tool results to a
  // single conversation. Multiple choices have independent histories, so
  // accepting them would risk executing only one choice and returning a
  // misleading answer. Requests without platform tools remain fully
  // pass-through compatible and may still use n > 1.
  if (options.runtime.chatTools.length && source.n !== undefined) {
    if (typeof source.n !== "number" || !Number.isInteger(source.n) || source.n < 1) {
      throw new LlmToolLoopError(400, "INVALID_N", "n 必须是正整数。");
    }
    if (source.n !== 1) {
      throw new LlmToolLoopError(400, "MULTIPLE_CHOICES_WITH_TOOLS_UNSUPPORTED", "启用 miniXM 工具时，Chat Completions 仅支持 n=1。");
    }
  }

  for (let round = 0; ; round += 1) {
    const upstream = await options.callUpstream(body);
    if (upstream.status < 200 || upstream.status >= 300) return { ...upstream, streamRequested, streamIncludeUsage, toolRounds: round };
    const response = parseUpstreamJson(upstream);
    if (options.runtime.chatTools.length && Array.isArray(response.choices) && response.choices.length > 1) {
      throw new LlmToolLoopError(502, "MULTIPLE_CHOICES_WITH_TOOLS_UNSUPPORTED", "上游在启用 miniXM 工具时返回了多个 choice，当前请求无法安全续接。");
    }
    const message = chatChoiceMessage(response);
    const calls = chatCalls(message);
    if (!calls.length) {
      if (!receipts.length || !message) return { ...upstream, response, streamRequested, streamIncludeUsage, toolRounds: round };
      const text = platformReceiptText(receipts);
      const content = Array.isArray(message.content)
        ? [...message.content, { type: "text", text }]
        : [typeof message.content === "string" ? message.content : "", text].filter(Boolean).join("\n\n");
      const choices = response.choices as Record<string, unknown>[];
      const next = { ...response, choices: choices.map((choice, index) => index === 0 ? { ...choice, message: { ...message, content } } : choice) };
      const headers = { ...upstream.headers };
      delete headers["content-length"];
      return { ...upstream, headers, body: Buffer.from(JSON.stringify(next)), response: next, streamRequested, streamIncludeUsage, toolRounds: round };
    }
    const platformCallCount = calls.filter((call) => options.runtime.isPlatformToolName(call.name)).length;
    if (platformCallCount === 0) {
      if (round > 0) throw new LlmToolLoopError(502, "CLIENT_TOOL_AFTER_PLATFORM_ROUND", "模型在平台工具执行后继续请求调用方工具，当前请求无法安全续接。");
      return { ...upstream, response, streamRequested, streamIncludeUsage, toolRounds: round };
    }
    if (platformCallCount !== calls.length) throw new LlmToolLoopError(502, "MIXED_TOOL_CALLS_UNSUPPORTED", "模型在同一轮混合调用平台工具和调用方工具，当前请求未执行任何工具。");
    assertCallableRound(calls.length, round, maxRounds, maxCalls);
    await options.beforeFollowup?.(round + 1);
    const outputs: Record<string, unknown>[] = [];
    for (const call of calls) {
      try {
        const argumentsValue = call.legacy ? call.arguments : call.function.arguments;
        const result = toolOutput(await options.runtime.execute(call.name, argumentsValue, call.id, {
          upstreamResponseId: typeof response.id === "string" ? response.id : undefined,
        }));
        outputs.push(call.legacy
          ? { role: "function", name: call.name, content: result }
          : { role: "tool", tool_call_id: call.id, content: result });
      } catch (error) {
        if (isTerminalToolError(error)) throw error;
        if (isUnknownPlatformToolError(error)) throw new LlmToolLoopError(400, "PLATFORM_TOOL_NOT_FOUND", "模型请求了未注册的 miniXM 工具。");
        outputs.push(call.legacy
          ? { role: "function", name: call.name, content: toolFailure(error) }
          : { role: "tool", tool_call_id: call.id, content: toolFailure(error) });
      }
    }
    for (const [index, output] of outputs.entries()) {
      const call = calls[index]!;
      if (call.name === "minixm_video_generate") receipts.push({ tool: call.name, call_id: call.id, output: JSON.parse(output.content as string) });
    }
    messages = [...messages, message, ...outputs];
    body = { ...body, messages, tools: [...options.runtime.chatTools], tool_choice: "auto", stream: false };
  }
}

function sseEvent(name: string, value: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`;
}

function responseStreamEvent(type: string, sequenceNumber: number, fields: Record<string, unknown>): string {
  return sseEvent(type, { type, sequence_number: sequenceNumber, ...fields });
}

function streamRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function bufferedResponsesSse(response: Record<string, unknown>): Buffer {
  const {
    usage: _usage,
    completed_at: _completedAt,
    error: _error,
    incomplete_details: _incompleteDetails,
    output_text: _outputText,
    ...responseAtCreation
  } = response;
  const created = {
    ...responseAtCreation,
    status: "in_progress",
    output: [],
    usage: null,
    completed_at: null,
    error: null,
    incomplete_details: null,
  };
  const status = typeof response.status === "string" ? response.status : "completed";
  const terminalEvent = status === "completed" || status === "failed" || status === "incomplete"
    ? `response.${status}`
    : status === "queued"
      ? "response.queued"
      : "response.in_progress";
  const events: string[] = [];
  let sequenceNumber = 0;
  events.push(responseStreamEvent("response.created", sequenceNumber++, { response: created }));
  events.push(responseStreamEvent("response.in_progress", sequenceNumber++, { response: created }));

  let outputItems = Array.isArray(response.output)
    ? response.output.map(streamRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  // A few compatible relays only expose the convenience output_text field.
  // Synthesize a message item so SDKs listening for typed text deltas still
  // receive a usable stream while the final response remains untouched.
  if (!outputItems.length && typeof response.output_text === "string") {
    outputItems = [{
      id: `${typeof response.id === "string" ? response.id : "response"}-output-0`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: response.output_text, annotations: [] }],
    }];
  }

  for (const [outputIndex, item] of outputItems.entries()) {
    const itemId = typeof item.id === "string" && item.id ? item.id : `${typeof response.id === "string" ? response.id : "response"}-output-${outputIndex}`;
    const addedItem = { ...item, id: itemId, status: "in_progress" };
    events.push(responseStreamEvent("response.output_item.added", sequenceNumber++, { output_index: outputIndex, item: addedItem }));

    if (item.type === "message") {
      const content = Array.isArray(item.content)
        ? item.content.map(streamRecord).filter((part): part is Record<string, unknown> => Boolean(part))
        : [];
      for (const [contentIndex, part] of content.entries()) {
        const partType = typeof part.type === "string" ? part.type : "output_text";
        if (partType === "output_text") {
          const text = typeof part.text === "string" ? part.text : "";
          const addedPart = { ...part, type: "output_text", text };
          events.push(responseStreamEvent("response.content_part.added", sequenceNumber++, {
            item_id: itemId,
            output_index: outputIndex,
            content_index: contentIndex,
            part: { ...addedPart, text: "" },
          }));
          if (text) events.push(responseStreamEvent("response.output_text.delta", sequenceNumber++, {
            item_id: itemId,
            output_index: outputIndex,
            content_index: contentIndex,
            delta: text,
          }));
          events.push(responseStreamEvent("response.output_text.done", sequenceNumber++, {
            item_id: itemId,
            output_index: outputIndex,
            content_index: contentIndex,
            text,
            ...(Array.isArray(part.logprobs) ? { logprobs: part.logprobs } : {}),
          }));
          events.push(responseStreamEvent("response.content_part.done", sequenceNumber++, {
            item_id: itemId,
            output_index: outputIndex,
            content_index: contentIndex,
            part: addedPart,
          }));
        } else {
          events.push(responseStreamEvent("response.content_part.added", sequenceNumber++, {
            item_id: itemId,
            output_index: outputIndex,
            content_index: contentIndex,
            part,
          }));
          events.push(responseStreamEvent("response.content_part.done", sequenceNumber++, {
            item_id: itemId,
            output_index: outputIndex,
            content_index: contentIndex,
            part,
          }));
        }
      }
    } else if (item.type === "function_call") {
      const argumentsText = typeof item.arguments === "string"
        ? item.arguments
        : item.arguments === undefined
          ? ""
          : JSON.stringify(item.arguments);
      if (argumentsText) events.push(responseStreamEvent("response.function_call_arguments.delta", sequenceNumber++, {
        item_id: itemId,
        output_index: outputIndex,
        delta: argumentsText,
      }));
      events.push(responseStreamEvent("response.function_call_arguments.done", sequenceNumber++, {
        item_id: itemId,
        output_index: outputIndex,
        arguments: argumentsText,
      }));
    } else if (item.type === "custom_tool_call") {
      const input = typeof item.input === "string"
        ? item.input
        : item.input === undefined
          ? ""
          : JSON.stringify(item.input);
      if (input) events.push(responseStreamEvent("response.custom_tool_call_input.delta", sequenceNumber++, {
        item_id: itemId,
        output_index: outputIndex,
        delta: input,
      }));
      events.push(responseStreamEvent("response.custom_tool_call_input.done", sequenceNumber++, {
        item_id: itemId,
        output_index: outputIndex,
        input,
      }));
    }

    events.push(responseStreamEvent("response.output_item.done", sequenceNumber++, {
      output_index: outputIndex,
      item: { ...item, id: itemId },
    }));
  }

  events.push(responseStreamEvent(terminalEvent, sequenceNumber++, { response }));
  return Buffer.from(events.join(""));
}

export function bufferedChatSse(response: Record<string, unknown>, includeUsage = false): Buffer {
  const choices = Array.isArray(response.choices)
    ? response.choices.filter((choice): choice is Record<string, unknown> => Boolean(choice) && typeof choice === "object" && !Array.isArray(choice))
    : [];
  const { choices: _choices, usage: _usage, object: _object, ...metadata } = response;
  const base = { ...metadata, object: "chat.completion.chunk" };
  const deltas = choices.map((choice, choiceIndex) => {
    const sourceMessage = choice.message && typeof choice.message === "object" && !Array.isArray(choice.message)
      ? choice.message as Record<string, unknown>
      : { role: "assistant", content: "" };
    const message = { ...sourceMessage };
    if (Array.isArray(sourceMessage.tool_calls)) {
      message.tool_calls = sourceMessage.tool_calls.map((call, toolIndex) => call && typeof call === "object" && !Array.isArray(call)
        ? { ...(call as Record<string, unknown>), index: toolIndex }
        : call);
    }
    return { index: choice.index ?? choiceIndex, delta: message, finish_reason: null };
  });
  const finishes = choices.map((choice, choiceIndex) => ({
    index: choice.index ?? choiceIndex,
    delta: {},
    finish_reason: choice.finish_reason ?? "stop",
  }));
  const chunks = [
    `data: ${JSON.stringify({ ...base, choices: deltas })}\n\n`,
    `data: ${JSON.stringify({ ...base, choices: finishes })}\n\n`,
  ];
  if (includeUsage && response.usage) chunks.push(`data: ${JSON.stringify({ ...base, choices: [], usage: response.usage })}\n\n`);
  chunks.push("data: [DONE]\n\n");
  return Buffer.from(chunks.join(""));
}
