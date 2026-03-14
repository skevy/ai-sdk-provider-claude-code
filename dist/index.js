// src/claude-code-provider.ts
import { NoSuchModelError as NoSuchModelError2 } from "@ai-sdk/provider";

// src/claude-code-language-model.ts
import { NoSuchModelError } from "@ai-sdk/provider";
import { generateId } from "@ai-sdk/provider-utils";

// src/convert-to-claude-code-messages.ts
var IMAGE_URL_WARNING = "Image URLs are not supported by this provider; supply base64/data URLs.";
var IMAGE_CONVERSION_WARNING = "Unable to convert image content; supply base64/data URLs.";
function normalizeBase64(base64) {
  return base64.replace(/\s+/g, "");
}
function isImageMimeType(mimeType) {
  return typeof mimeType === "string" && mimeType.trim().toLowerCase().startsWith("image/");
}
function createImageContent(mediaType, data) {
  const trimmedType = mediaType.trim();
  const trimmedData = normalizeBase64(data.trim());
  if (!trimmedType || !trimmedData) {
    return void 0;
  }
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: trimmedType,
      data: trimmedData
    }
  };
}
function extractMimeType(candidate) {
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate.trim();
  }
  return void 0;
}
function parseObjectImage(imageObj, fallbackMimeType) {
  const data = typeof imageObj.data === "string" ? imageObj.data : void 0;
  const mimeType = extractMimeType(
    imageObj.mimeType ?? imageObj.mediaType ?? imageObj.media_type ?? fallbackMimeType
  );
  if (!data || !mimeType) {
    return void 0;
  }
  return createImageContent(mimeType, data);
}
function parseStringImage(value, fallbackMimeType) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return { warning: IMAGE_URL_WARNING };
  }
  const dataUrlMatch = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    const [, mediaType, data] = dataUrlMatch;
    const content = createImageContent(mediaType, data);
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }
  const base64Match = trimmed.match(/^base64:([^,]+),(.+)$/i);
  if (base64Match) {
    const [, explicitMimeType, data] = base64Match;
    const content = createImageContent(explicitMimeType, data);
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }
  if (fallbackMimeType) {
    const content = createImageContent(fallbackMimeType, trimmed);
    if (content) {
      return { content };
    }
  }
  return { warning: IMAGE_CONVERSION_WARNING };
}
function parseImagePart(part) {
  if (!part || typeof part !== "object") {
    return { warning: IMAGE_CONVERSION_WARNING };
  }
  const imageValue = part.image;
  const mimeType = extractMimeType(part.mimeType);
  if (typeof imageValue === "string") {
    return parseStringImage(imageValue, mimeType);
  }
  if (imageValue && typeof imageValue === "object") {
    const content = parseObjectImage(imageValue, mimeType);
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }
  return { warning: IMAGE_CONVERSION_WARNING };
}
function convertBinaryToBase64(data) {
  if (typeof Buffer !== "undefined") {
    const buffer = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(new Uint8Array(data));
    return buffer.toString("base64");
  }
  if (typeof btoa === "function") {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let binary = "";
    const chunkSize = 32768;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }
  return void 0;
}
function parseFilePart(part) {
  const mimeType = extractMimeType(part.mediaType ?? part.mimeType);
  if (!mimeType || !isImageMimeType(mimeType)) {
    return {};
  }
  const data = part.data;
  if (typeof data === "string") {
    const content = createImageContent(mimeType, data);
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }
  if (data instanceof Uint8Array || typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
    const base64 = convertBinaryToBase64(data);
    if (!base64) {
      return { warning: IMAGE_CONVERSION_WARNING };
    }
    const content = createImageContent(mimeType, base64);
    return content ? { content } : { warning: IMAGE_CONVERSION_WARNING };
  }
  return { warning: IMAGE_CONVERSION_WARNING };
}
function convertToClaudeCodeMessages(prompt) {
  const messages = [];
  const warnings = [];
  let systemPrompt;
  const streamingSegments = [];
  const imageMap = /* @__PURE__ */ new Map();
  let hasImageParts = false;
  const addSegment = (formatted) => {
    streamingSegments.push({ formatted });
    return streamingSegments.length - 1;
  };
  const addImageForSegment = (segmentIndex, content) => {
    hasImageParts = true;
    if (!imageMap.has(segmentIndex)) {
      imageMap.set(segmentIndex, []);
    }
    imageMap.get(segmentIndex)?.push(content);
  };
  for (const message of prompt) {
    switch (message.role) {
      case "system":
        systemPrompt = message.content;
        if (typeof message.content === "string" && message.content.trim().length > 0) {
          addSegment(message.content);
        } else {
          addSegment("");
        }
        break;
      case "user":
        if (typeof message.content === "string") {
          messages.push(message.content);
          addSegment(`Human: ${message.content}`);
        } else {
          const textParts = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
          const segmentIndex = addSegment(textParts ? `Human: ${textParts}` : "");
          if (textParts) {
            messages.push(textParts);
          }
          for (const part of message.content) {
            if (part.type === "image") {
              const { content, warning } = parseImagePart(part);
              if (content) {
                addImageForSegment(segmentIndex, content);
              } else if (warning) {
                warnings.push(warning);
              }
            } else if (part.type === "file") {
              const { content, warning } = parseFilePart(part);
              if (content) {
                addImageForSegment(segmentIndex, content);
              } else if (warning) {
                warnings.push(warning);
              }
            }
          }
        }
        break;
      case "assistant": {
        let assistantContent = "";
        if (typeof message.content === "string") {
          assistantContent = message.content;
        } else {
          const textParts = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
          if (textParts) {
            assistantContent = textParts;
          }
          const toolCalls = message.content.filter((part) => part.type === "tool-call");
          if (toolCalls.length > 0) {
            assistantContent += `
[Tool calls made]`;
          }
        }
        const formattedAssistant = `Assistant: ${assistantContent}`;
        messages.push(formattedAssistant);
        addSegment(formattedAssistant);
        break;
      }
      case "tool":
        for (const tool3 of message.content) {
          if (tool3.type === "tool-approval-response") {
            continue;
          }
          let resultText;
          const output = tool3.output;
          if (output.type === "text" || output.type === "error-text") {
            resultText = output.value;
          } else if (output.type === "json" || output.type === "error-json") {
            resultText = JSON.stringify(output.value);
          } else if (output.type === "execution-denied") {
            resultText = `[Execution denied${output.reason ? `: ${output.reason}` : ""}]`;
          } else if (output.type === "content") {
            resultText = output.value.filter((part) => part.type === "text").map((part) => part.text).join("\n");
          } else {
            resultText = "[Unknown output type]";
          }
          const formattedToolResult = `Tool Result (${tool3.toolName}): ${resultText}`;
          messages.push(formattedToolResult);
          addSegment(formattedToolResult);
        }
        break;
    }
  }
  let finalPrompt = "";
  if (systemPrompt) {
    finalPrompt = systemPrompt;
  }
  if (messages.length > 0) {
    const formattedMessages = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.startsWith("Assistant:") || msg.startsWith("Tool Result")) {
        formattedMessages.push(msg);
      } else {
        formattedMessages.push(`Human: ${msg}`);
      }
    }
    if (finalPrompt) {
      const joinedMessages = formattedMessages.join("\n\n");
      finalPrompt = joinedMessages ? `${finalPrompt}

${joinedMessages}` : finalPrompt;
    } else {
      finalPrompt = formattedMessages.join("\n\n");
    }
  }
  const streamingParts = [];
  const imagePartsInOrder = [];
  const appendImagesForIndex = (index) => {
    const images = imageMap.get(index);
    if (!images) {
      return;
    }
    images.forEach((image) => {
      streamingParts.push(image);
      imagePartsInOrder.push(image);
    });
  };
  if (streamingSegments.length > 0) {
    let accumulatedText = "";
    let emittedText = false;
    const flushText = () => {
      if (!accumulatedText) {
        return;
      }
      streamingParts.push({ type: "text", text: accumulatedText });
      accumulatedText = "";
      emittedText = true;
    };
    streamingSegments.forEach((segment, index) => {
      const segmentText = segment.formatted;
      if (segmentText) {
        if (!accumulatedText) {
          accumulatedText = emittedText ? `

${segmentText}` : segmentText;
        } else {
          accumulatedText += `

${segmentText}`;
        }
      }
      if (imageMap.has(index)) {
        flushText();
        appendImagesForIndex(index);
      }
    });
    flushText();
  }
  return {
    messagesPrompt: finalPrompt,
    systemPrompt,
    ...warnings.length > 0 && { warnings },
    streamingContentParts: streamingParts.length > 0 ? streamingParts : [
      { type: "text", text: finalPrompt },
      ...imagePartsInOrder
    ],
    hasImageParts
  };
}

// src/errors.ts
import { APICallError, LoadAPIKeyError } from "@ai-sdk/provider";
function createAPICallError({
  message,
  code,
  exitCode,
  stderr,
  promptExcerpt,
  isRetryable = false
}) {
  const metadata = {
    code,
    exitCode,
    stderr,
    promptExcerpt
  };
  return new APICallError({
    message,
    isRetryable,
    url: "claude-code-cli://command",
    requestBodyValues: promptExcerpt ? { prompt: promptExcerpt } : void 0,
    data: metadata
  });
}
function createAuthenticationError({ message }) {
  return new LoadAPIKeyError({
    message: message || "Authentication failed. Please ensure Claude Code SDK is properly authenticated."
  });
}
function createTimeoutError({
  message,
  promptExcerpt,
  timeoutMs
}) {
  const metadata = {
    code: "TIMEOUT",
    promptExcerpt
  };
  return new APICallError({
    message,
    isRetryable: true,
    url: "claude-code-cli://command",
    requestBodyValues: promptExcerpt ? { prompt: promptExcerpt } : void 0,
    data: timeoutMs !== void 0 ? { ...metadata, timeoutMs } : metadata
  });
}
function isAuthenticationError(error) {
  if (error instanceof LoadAPIKeyError) return true;
  if (error instanceof APICallError && error.data?.exitCode === 401)
    return true;
  return false;
}
function isTimeoutError(error) {
  if (error instanceof APICallError && error.data?.code === "TIMEOUT")
    return true;
  return false;
}
function getErrorMetadata(error) {
  if (error instanceof APICallError && error.data) {
    return error.data;
  }
  return void 0;
}

// src/map-claude-code-finish-reason.ts
function mapClaudeCodeFinishReason(subtype, stopReason) {
  if (stopReason != null) {
    switch (stopReason) {
      case "end_turn":
        return { unified: "stop", raw: "end_turn" };
      case "max_tokens":
        return { unified: "length", raw: "max_tokens" };
      case "stop_sequence":
        return { unified: "stop", raw: "stop_sequence" };
      case "tool_use":
        return { unified: "tool-calls", raw: "tool_use" };
      default:
        break;
    }
  }
  const raw = stopReason ?? subtype;
  switch (subtype) {
    case "success":
      return { unified: "stop", raw };
    case "error_max_turns":
      return { unified: "length", raw };
    case "error_during_execution":
      return { unified: "error", raw };
    case void 0:
      return { unified: "stop", raw };
    default:
      return { unified: "other", raw };
  }
}

// src/validation.ts
import { z } from "zod";
import { existsSync } from "fs";
var loggerFunctionSchema = z.object({
  debug: z.any().refine((val) => typeof val === "function", {
    message: "debug must be a function"
  }),
  info: z.any().refine((val) => typeof val === "function", {
    message: "info must be a function"
  }),
  warn: z.any().refine((val) => typeof val === "function", {
    message: "warn must be a function"
  }),
  error: z.any().refine((val) => typeof val === "function", {
    message: "error must be a function"
  })
});
var claudeCodeSettingsSchema = z.object({
  pathToClaudeCodeExecutable: z.string().optional(),
  customSystemPrompt: z.string().optional(),
  appendSystemPrompt: z.string().optional(),
  systemPrompt: z.union([
    z.string(),
    z.object({
      type: z.literal("preset"),
      preset: z.literal("claude_code"),
      append: z.string().optional()
    })
  ]).optional(),
  maxTurns: z.number().int().min(1).max(100).optional(),
  maxThinkingTokens: z.number().int().positive().max(1e5).optional(),
  thinking: z.union([
    z.object({ type: z.literal("adaptive") }).strict(),
    z.object({
      type: z.literal("enabled"),
      budgetTokens: z.number().int().positive().optional()
    }).strict(),
    z.object({ type: z.literal("disabled") }).strict()
  ]).optional(),
  effort: z.enum(["low", "medium", "high", "max"]).optional(),
  promptSuggestions: z.boolean().optional(),
  cwd: z.string().refine(
    (val) => {
      if (typeof process === "undefined" || !process.versions?.node) {
        return true;
      }
      return !val || existsSync(val);
    },
    { message: "Working directory must exist" }
  ).optional(),
  executable: z.enum(["bun", "deno", "node"]).optional(),
  executableArgs: z.array(z.string()).optional(),
  permissionMode: z.enum(["default", "acceptEdits", "bypassPermissions", "plan", "delegate", "dontAsk"]).optional(),
  permissionPromptToolName: z.string().optional(),
  continue: z.boolean().optional(),
  resume: z.string().optional(),
  sessionId: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  betas: z.array(z.string()).optional(),
  allowDangerouslySkipPermissions: z.boolean().optional(),
  enableFileCheckpointing: z.boolean().optional(),
  maxBudgetUsd: z.number().min(0).optional(),
  plugins: z.array(
    z.object({
      type: z.string(),
      path: z.string()
    }).passthrough()
  ).optional(),
  resumeSessionAt: z.string().optional(),
  sandbox: z.any().refine((val) => val === void 0 || typeof val === "object", {
    message: "sandbox must be an object"
  }).optional(),
  tools: z.union([
    z.array(z.string()),
    z.object({
      type: z.literal("preset"),
      preset: z.literal("claude_code")
    })
  ]).optional(),
  settingSources: z.array(z.enum(["user", "project", "local"])).optional(),
  streamingInput: z.enum(["auto", "always", "off"]).optional(),
  persistentSession: z.boolean().optional(),
  // Hooks and tool-permission callback (permissive validation of shapes)
  canUseTool: z.any().refine((v) => v === void 0 || typeof v === "function", {
    message: "canUseTool must be a function"
  }).optional(),
  hooks: z.record(
    z.string(),
    z.array(
      z.object({
        matcher: z.string().optional(),
        hooks: z.array(z.any()).nonempty()
      })
    )
  ).optional(),
  mcpServers: z.record(
    z.string(),
    z.union([
      // McpStdioServerConfig
      z.object({
        type: z.literal("stdio").optional(),
        command: z.string(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional()
      }),
      // McpSSEServerConfig
      z.object({
        type: z.literal("sse"),
        url: z.string(),
        headers: z.record(z.string(), z.string()).optional()
      }),
      // McpHttpServerConfig
      z.object({
        type: z.literal("http"),
        url: z.string(),
        headers: z.record(z.string(), z.string()).optional()
      }),
      // McpSdkServerConfig (in-process custom tools)
      z.object({
        type: z.literal("sdk"),
        name: z.string(),
        instance: z.any()
      })
    ])
  ).optional(),
  verbose: z.boolean().optional(),
  debug: z.boolean().optional(),
  debugFile: z.string().optional(),
  logger: z.union([z.literal(false), loggerFunctionSchema]).optional(),
  env: z.record(z.string(), z.string().optional()).optional(),
  additionalDirectories: z.array(z.string()).optional(),
  agents: z.record(
    z.string(),
    z.object({
      description: z.string(),
      tools: z.array(z.string()).optional(),
      disallowedTools: z.array(z.string()).optional(),
      prompt: z.string(),
      model: z.enum(["sonnet", "opus", "haiku", "inherit"]).optional(),
      mcpServers: z.array(
        z.union([
          z.string(),
          z.record(z.string(), z.any())
          // McpServerConfigForProcessTransport
        ])
      ).optional(),
      criticalSystemReminder_EXPERIMENTAL: z.string().optional()
    }).passthrough()
  ).optional(),
  includePartialMessages: z.boolean().optional(),
  fallbackModel: z.string().optional(),
  forkSession: z.boolean().optional(),
  stderr: z.any().refine((val) => val === void 0 || typeof val === "function", {
    message: "stderr must be a function"
  }).optional(),
  strictMcpConfig: z.boolean().optional(),
  extraArgs: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  persistSession: z.boolean().optional(),
  spawnClaudeCodeProcess: z.any().refine((val) => val === void 0 || typeof val === "function", {
    message: "spawnClaudeCodeProcess must be a function"
  }).optional(),
  sdkOptions: z.record(z.string(), z.any()).optional(),
  maxToolResultSize: z.number().int().min(100).max(1e6).optional(),
  // Callback invoked when Query object is created - for mid-stream injection via streamInput()
  onQueryCreated: z.any().refine((val) => val === void 0 || typeof val === "function", {
    message: "onQueryCreated must be a function"
  }).optional(),
  onStreamStart: z.any().refine((val) => val === void 0 || typeof val === "function", {
    message: "onStreamStart must be a function"
  }).optional()
}).strict();
function validateModelId(modelId) {
  const knownModels = ["opus", "sonnet", "haiku"];
  if (!modelId || modelId.trim() === "") {
    throw new Error("Model ID cannot be empty");
  }
  if (!knownModels.includes(modelId)) {
    return `Unknown model ID: '${modelId}'. Proceeding with custom model. Known models are: ${knownModels.join(", ")}`;
  }
  return void 0;
}
function validateSettings(settings) {
  const warnings = [];
  const errors = [];
  try {
    const result = claudeCodeSettingsSchema.safeParse(settings);
    if (!result.success) {
      const errorObject = result.error;
      const issues = errorObject.errors || errorObject.issues || [];
      issues.forEach((err) => {
        const path = err.path.join(".");
        errors.push(`${path ? `${path}: ` : ""}${err.message}`);
      });
      return { valid: false, warnings, errors };
    }
    const validSettings = result.data;
    if (validSettings.maxTurns && validSettings.maxTurns > 20) {
      warnings.push(
        `High maxTurns value (${validSettings.maxTurns}) may lead to long-running conversations`
      );
    }
    if (validSettings.maxThinkingTokens && validSettings.maxThinkingTokens > 5e4) {
      warnings.push(
        `Very high maxThinkingTokens (${validSettings.maxThinkingTokens}) may increase response time`
      );
    }
    if (validSettings.allowedTools && validSettings.disallowedTools) {
      warnings.push(
        "Both allowedTools and disallowedTools are specified. Only allowedTools will be used."
      );
    }
    const validateToolNames = (tools, type) => {
      tools.forEach((tool3) => {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\([^)]*\))?$/.test(tool3) && !tool3.startsWith("mcp__")) {
          warnings.push(`Unusual ${type} tool name format: '${tool3}'`);
        }
      });
    };
    if (validSettings.allowedTools) {
      validateToolNames(validSettings.allowedTools, "allowed");
    }
    if (validSettings.disallowedTools) {
      validateToolNames(validSettings.disallowedTools, "disallowed");
    }
    if (validSettings.allowedTools?.includes("Skill") && !validSettings.settingSources) {
      warnings.push(
        "allowedTools includes 'Skill' but settingSources is not set. Skills require settingSources (e.g., ['user', 'project']) to load skill definitions."
      );
    }
    return { valid: true, warnings, errors };
  } catch (error) {
    errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
    return { valid: false, warnings, errors };
  }
}
function validatePrompt(prompt) {
  const MAX_PROMPT_LENGTH = 1e5;
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return `Very long prompt (${prompt.length} characters) may cause performance issues or timeouts`;
  }
  return void 0;
}
function validateSessionId(sessionId) {
  if (sessionId && !/^[a-zA-Z0-9-_]+$/.test(sessionId)) {
    return `Unusual session ID format. This may cause issues with session resumption.`;
  }
  return void 0;
}

// src/logger.ts
var defaultLogger = {
  // eslint-disable-next-line no-console
  debug: (message) => console.debug(`[DEBUG] ${message}`),
  // eslint-disable-next-line no-console
  info: (message) => console.info(`[INFO] ${message}`),
  warn: (message) => console.warn(`[WARN] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`)
};
var noopLogger = {
  debug: () => {
  },
  info: () => {
  },
  warn: () => {
  },
  error: () => {
  }
};
function getLogger(logger) {
  if (logger === false) {
    return noopLogger;
  }
  if (logger === void 0) {
    return defaultLogger;
  }
  return logger;
}
function createVerboseLogger(logger, verbose = false) {
  if (verbose) {
    return logger;
  }
  return {
    debug: () => {
    },
    // No-op when not verbose
    info: () => {
    },
    // No-op when not verbose
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger)
  };
}

// src/claude-code-language-model.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
var CLAUDE_CODE_TRUNCATION_WARNING = "Claude Code SDK output ended unexpectedly; returning truncated response from buffered text. Await upstream fix to avoid data loss.";
var MIN_TRUNCATION_LENGTH = 512;
function isClaudeCodeTruncationError(error, bufferedText) {
  const isSyntaxError = error instanceof SyntaxError || // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof error?.name === "string" && // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error.name.toLowerCase() === "syntaxerror";
  if (!isSyntaxError) {
    return false;
  }
  if (!bufferedText) {
    return false;
  }
  const rawMessage = typeof error?.message === "string" ? error.message : "";
  const message = rawMessage.toLowerCase();
  const truncationIndicators = [
    "unexpected end of json input",
    "unexpected end of input",
    "unexpected end of string",
    "unexpected eof",
    "end of file",
    "unterminated string",
    "unterminated string constant"
  ];
  if (!truncationIndicators.some((indicator) => message.includes(indicator))) {
    return false;
  }
  if (bufferedText.length < MIN_TRUNCATION_LENGTH) {
    return false;
  }
  return true;
}
function createDeferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function isAbortError(err) {
  if (err && typeof err === "object") {
    const e = err;
    if (typeof e.name === "string" && e.name === "AbortError") return true;
    if (typeof e.code === "string" && e.code.toUpperCase() === "ABORT_ERR") return true;
  }
  return false;
}
var DEFAULT_INHERITED_ENV_VARS = process.platform === "win32" ? [
  "APPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERNAME",
  "USERPROFILE",
  "WINDIR"
] : ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER", "LANG", "LC_ALL", "TMPDIR"];
var CLAUDE_ENV_VARS = ["CLAUDE_CONFIG_DIR"];
function getBaseProcessEnv() {
  const env = {};
  const allowedKeys = /* @__PURE__ */ new Set([...DEFAULT_INHERITED_ENV_VARS, ...CLAUDE_ENV_VARS]);
  for (const key of allowedKeys) {
    const value = process.env[key];
    if (typeof value !== "string") {
      continue;
    }
    if (value.startsWith("()")) {
      continue;
    }
    env[key] = value;
  }
  return env;
}
var STREAMING_FEATURE_WARNING = "Claude Agent SDK features (hooks/MCP/images) require streaming input. Set `streamingInput: 'always'` or provide `canUseTool` (auto streams only when canUseTool is set).";
var SDK_OPTIONS_BLOCKLIST = /* @__PURE__ */ new Set(["model", "abortController", "prompt", "outputFormat"]);
function isContentBlock(item) {
  return typeof item === "object" && item !== null && "type" in item;
}
function filterContentBlocks(content, type) {
  if (!Array.isArray(content)) return [];
  const blocks = content.filter(
    (item) => isContentBlock(item) && item.type === type
  );
  const mismatch = blocks.find((b) => b.type !== type);
  if (mismatch) {
    throw new Error(
      `filterContentBlocks: block type '${mismatch.type}' passed filter for '${type}'`
    );
  }
  return blocks;
}
function createEmptyUsage() {
  return {
    inputTokens: {
      total: 0,
      noCache: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    outputTokens: {
      total: 0,
      text: void 0,
      reasoning: void 0
    },
    raw: void 0
  };
}
function convertClaudeCodeUsage(usage) {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return {
    inputTokens: {
      total: inputTokens + cacheWrite + cacheRead,
      noCache: inputTokens,
      cacheRead,
      cacheWrite
    },
    outputTokens: {
      total: outputTokens,
      text: void 0,
      reasoning: void 0
    },
    raw: usage
  };
}
function createMessageInjector() {
  const queue = [];
  let closed = false;
  let resolver = null;
  const injector = {
    inject(content, onResult) {
      if (closed) {
        onResult?.(false);
        return;
      }
      const item = { content, onResult };
      if (resolver) {
        const r = resolver;
        resolver = null;
        r(item);
      } else {
        queue.push(item);
      }
    },
    close() {
      closed = true;
      if (resolver && queue.length === 0) {
        resolver(null);
        resolver = null;
      }
    }
  };
  const getNextItem = () => {
    if (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        return Promise.resolve(null);
      }
      return Promise.resolve(item);
    }
    if (closed) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      resolver = (item) => {
        resolve(item);
      };
    });
  };
  const notifySessionEnded = () => {
    for (const item of queue) {
      item.onResult?.(false);
    }
    queue.length = 0;
    closed = true;
    if (resolver) {
      resolver(null);
      resolver = null;
    }
  };
  return { injector, getNextItem, notifySessionEnded };
}
function toAsyncIterablePrompt(messagesPrompt, outputStreamEnded, sessionId, contentParts, onStreamStart) {
  const content = contentParts && contentParts.length > 0 ? contentParts : [{ type: "text", text: messagesPrompt }];
  const initialMsg = {
    type: "user",
    message: {
      role: "user",
      content
    },
    parent_tool_use_id: null,
    session_id: sessionId ?? ""
  };
  if (!onStreamStart) {
    return {
      async *[Symbol.asyncIterator]() {
        yield initialMsg;
        await outputStreamEnded;
      }
    };
  }
  const { injector, getNextItem, notifySessionEnded } = createMessageInjector();
  return {
    async *[Symbol.asyncIterator]() {
      yield initialMsg;
      onStreamStart(injector);
      let streamEnded = false;
      void outputStreamEnded.then(() => {
        streamEnded = true;
        notifySessionEnded();
      });
      while (!streamEnded) {
        const item = await Promise.race([getNextItem(), outputStreamEnded.then(() => null)]);
        if (item === null) {
          await outputStreamEnded;
          break;
        }
        const sdkMsg = {
          type: "user",
          message: {
            role: "user",
            content: [{ type: "text", text: item.content }]
          },
          parent_tool_use_id: null,
          session_id: sessionId ?? ""
        };
        yield sdkMsg;
        item.onResult?.(true);
      }
    }
  };
}
var modelMap = {
  opus: "opus",
  sonnet: "sonnet",
  haiku: "haiku"
};
var MAX_TOOL_RESULT_SIZE = 1e4;
function truncateToolResultForStream(result, maxSize = MAX_TOOL_RESULT_SIZE) {
  if (typeof result === "string") {
    if (result.length <= maxSize) return result;
    return result.slice(0, maxSize) + `
...[truncated ${result.length - maxSize} chars]`;
  }
  if (typeof result !== "object" || result === null) return result;
  if (Array.isArray(result)) {
    let largestIndex = -1;
    let largestSize2 = 0;
    for (let i = 0; i < result.length; i++) {
      const value = result[i];
      if (typeof value === "string" && value.length > largestSize2) {
        largestIndex = i;
        largestSize2 = value.length;
      }
    }
    if (largestIndex >= 0 && largestSize2 > maxSize) {
      const truncatedValue = result[largestIndex].slice(0, maxSize) + `
...[truncated ${largestSize2 - maxSize} chars]`;
      const cloned = [...result];
      cloned[largestIndex] = truncatedValue;
      return cloned;
    }
    return result;
  }
  const obj = result;
  let largestKey = null;
  let largestSize = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && value.length > largestSize) {
      largestKey = key;
      largestSize = value.length;
    }
  }
  if (largestKey && largestSize > maxSize) {
    const truncatedValue = obj[largestKey].slice(0, maxSize) + `
...[truncated ${largestSize - maxSize} chars]`;
    return { ...obj, [largestKey]: truncatedValue };
  }
  return result;
}
var ClaudeCodeLanguageModel = class _ClaudeCodeLanguageModel {
  specificationVersion = "v3";
  defaultObjectGenerationMode = "json";
  supportsImageUrls = false;
  supportedUrls = {};
  supportsStructuredOutputs = true;
  // Fallback/magic string constants
  static UNKNOWN_TOOL_NAME = "unknown-tool";
  // Tool input safety limits
  static MAX_TOOL_INPUT_SIZE = 1048576;
  // 1MB hard limit
  static MAX_TOOL_INPUT_WARN = 102400;
  // 100KB warning threshold
  static MAX_DELTA_CALC_SIZE = 1e4;
  // 10KB delta computation threshold
  modelId;
  settings;
  sessionId;
  modelValidationWarning;
  settingsValidationWarnings;
  logger;
  // Persistent session state for streamingInput: 'always' mode.
  // When active, the query() process stays alive across doStream() calls.
  persistentStream;
  constructor(options) {
    this.modelId = options.id;
    this.settings = options.settings ?? {};
    this.settingsValidationWarnings = options.settingsValidationWarnings ?? [];
    const baseLogger = getLogger(this.settings.logger);
    this.logger = createVerboseLogger(baseLogger, this.settings.verbose ?? false);
    if (!this.modelId || typeof this.modelId !== "string" || this.modelId.trim() === "") {
      throw new NoSuchModelError({
        modelId: this.modelId,
        modelType: "languageModel"
      });
    }
    this.modelValidationWarning = validateModelId(this.modelId);
    if (this.modelValidationWarning) {
      this.logger.warn(`Claude Code Model: ${this.modelValidationWarning}`);
    }
  }
  get provider() {
    return "claude-code";
  }
  /**
   * Interrupt the current turn in a persistent session.
   * The process stays alive but the current turn's stream is closed.
   * Call this after `query.interrupt()` to properly hand off the iterator.
   */
  interruptPersistentTurn() {
    if (this.persistentStream) {
      this.persistentStream.turnInterrupted.resolve();
    }
  }
  /**
   * Destroy the persistent session, allowing the process to exit.
   * Only relevant when streamingInput is 'always'.
   */
  destroyPersistentSession() {
    if (this.persistentStream) {
      try {
        this.persistentStream.currentController?.close();
      } catch {
      }
      this.persistentStream.currentController = null;
      this.persistentStream.doneFn();
      this.persistentStream.turnInterrupted.resolve();
      this.persistentStream.nextTurnReady.resolve();
      this.persistentStream = void 0;
    }
  }
  getModel() {
    const mapped = modelMap[this.modelId];
    return mapped ?? this.modelId;
  }
  getSanitizedSdkOptions() {
    if (!this.settings.sdkOptions || typeof this.settings.sdkOptions !== "object") {
      return void 0;
    }
    const sanitized = { ...this.settings.sdkOptions };
    const blockedKeys = Array.from(SDK_OPTIONS_BLOCKLIST).filter((key) => key in sanitized);
    if (blockedKeys.length > 0) {
      this.logger.warn(
        `[claude-code] sdkOptions includes provider-managed fields (${blockedKeys.join(
          ", "
        )}); these will be ignored.`
      );
      blockedKeys.forEach((key) => delete sanitized[key]);
    }
    return sanitized;
  }
  getEffectiveResume(sdkOptions) {
    return sdkOptions?.resume ?? this.settings.resume ?? this.sessionId;
  }
  extractTextAndThinking(content) {
    if (!Array.isArray(content)) return { text: "", thinking: [] };
    let text = "";
    const thinking = [];
    for (const part of content) {
      if (!isContentBlock(part)) continue;
      if (part.type === "text" && typeof part.text === "string") {
        text += part.text;
      } else if (part.type === "thinking" && typeof part.thinking === "string") {
        thinking.push(part.thinking);
      }
    }
    if (text.length > 0 && typeof text !== "string") {
      throw new Error("extractTextAndThinking: accumulated text must be a string");
    }
    if (thinking.some((t) => typeof t !== "string")) {
      throw new Error("extractTextAndThinking: all thinking entries must be strings");
    }
    return { text, thinking };
  }
  extractToolUses(content) {
    return filterContentBlocks(content, "tool_use").map((block) => {
      const { id, name, input, parent_tool_use_id } = block;
      return {
        id: typeof id === "string" && id.length > 0 ? id : generateId(),
        name: typeof name === "string" && name.length > 0 ? name : _ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME,
        input,
        parentToolUseId: typeof parent_tool_use_id === "string" ? parent_tool_use_id : null
      };
    });
  }
  extractToolResults(content) {
    return filterContentBlocks(content, "tool_result").map((block) => {
      const { tool_use_id, content: content2, is_error, name } = block;
      return {
        id: typeof tool_use_id === "string" && tool_use_id.length > 0 ? tool_use_id : generateId(),
        name: typeof name === "string" && name.length > 0 ? name : void 0,
        result: content2,
        isError: Boolean(is_error)
      };
    });
  }
  extractToolErrors(content) {
    return filterContentBlocks(content, "tool_error").map((block) => {
      const { tool_use_id, error, name } = block;
      return {
        id: typeof tool_use_id === "string" && tool_use_id.length > 0 ? tool_use_id : generateId(),
        name: typeof name === "string" && name.length > 0 ? name : void 0,
        error
      };
    });
  }
  serializeToolInput(input) {
    if (typeof input === "string") {
      return this.checkInputSize(input);
    }
    if (input === void 0) {
      return "";
    }
    try {
      const serialized = JSON.stringify(input);
      return this.checkInputSize(serialized);
    } catch {
      const fallback = String(input);
      return this.checkInputSize(fallback);
    }
  }
  checkInputSize(str) {
    const length = str.length;
    if (length > _ClaudeCodeLanguageModel.MAX_TOOL_INPUT_SIZE) {
      throw new Error(
        `Tool input exceeds maximum size of ${_ClaudeCodeLanguageModel.MAX_TOOL_INPUT_SIZE} bytes (got ${length} bytes). This may indicate a malformed request or an attempt to process excessively large data.`
      );
    }
    if (length > _ClaudeCodeLanguageModel.MAX_TOOL_INPUT_WARN) {
      this.logger.warn(
        `[claude-code] Large tool input detected: ${length} bytes. Performance may be impacted. Consider chunking or reducing input size.`
      );
    }
    return str;
  }
  normalizeToolResult(result) {
    if (typeof result === "string") {
      try {
        return JSON.parse(result);
      } catch {
        return result;
      }
    }
    if (Array.isArray(result) && result.length > 0) {
      const textBlocks = result.filter(
        (block) => block?.type === "text" && typeof block.text === "string"
      ).map((block) => block.text);
      if (textBlocks.length !== result.length) {
        return result;
      }
      if (textBlocks.length === 1) {
        try {
          return JSON.parse(textBlocks[0]);
        } catch {
          return textBlocks[0];
        }
      }
      const combined = textBlocks.join("\n");
      try {
        return JSON.parse(combined);
      } catch {
        return combined;
      }
    }
    return result;
  }
  generateAllWarnings(options, prompt) {
    const warnings = [];
    const unsupportedParams = [];
    if (options.temperature !== void 0) unsupportedParams.push("temperature");
    if (options.topP !== void 0) unsupportedParams.push("topP");
    if (options.topK !== void 0) unsupportedParams.push("topK");
    if (options.presencePenalty !== void 0) unsupportedParams.push("presencePenalty");
    if (options.frequencyPenalty !== void 0) unsupportedParams.push("frequencyPenalty");
    if (options.stopSequences !== void 0 && options.stopSequences.length > 0)
      unsupportedParams.push("stopSequences");
    if (options.seed !== void 0) unsupportedParams.push("seed");
    if (unsupportedParams.length > 0) {
      for (const param of unsupportedParams) {
        warnings.push({
          type: "unsupported",
          feature: param,
          details: `Claude Code SDK does not support the ${param} parameter. It will be ignored.`
        });
      }
    }
    if (this.modelValidationWarning) {
      warnings.push({
        type: "other",
        message: this.modelValidationWarning
      });
    }
    this.settingsValidationWarnings.forEach((warning) => {
      warnings.push({
        type: "other",
        message: warning
      });
    });
    if (options.responseFormat?.type === "json" && !options.responseFormat.schema) {
      warnings.push({
        type: "unsupported",
        feature: "responseFormat",
        details: "JSON response format requires a schema for the Claude Code provider. The JSON responseFormat is ignored and the call is treated as plain text."
      });
    }
    const promptWarning = validatePrompt(prompt);
    if (promptWarning) {
      warnings.push({
        type: "other",
        message: promptWarning
      });
    }
    return warnings;
  }
  createQueryOptions(abortController, responseFormat, stderrCollector, sdkOptions, effectiveResume) {
    const opts = {
      model: this.getModel(),
      abortController,
      resume: effectiveResume ?? this.settings.resume ?? this.sessionId,
      pathToClaudeCodeExecutable: this.settings.pathToClaudeCodeExecutable,
      maxTurns: this.settings.maxTurns,
      maxThinkingTokens: this.settings.maxThinkingTokens,
      thinking: this.settings.thinking,
      effort: this.settings.effort,
      promptSuggestions: this.settings.promptSuggestions,
      cwd: this.settings.cwd,
      executable: this.settings.executable,
      executableArgs: this.settings.executableArgs,
      permissionMode: this.settings.permissionMode,
      permissionPromptToolName: this.settings.permissionPromptToolName,
      continue: this.settings.continue,
      allowedTools: this.settings.allowedTools,
      disallowedTools: this.settings.disallowedTools,
      betas: this.settings.betas,
      allowDangerouslySkipPermissions: this.settings.allowDangerouslySkipPermissions,
      enableFileCheckpointing: this.settings.enableFileCheckpointing,
      maxBudgetUsd: this.settings.maxBudgetUsd,
      plugins: this.settings.plugins,
      resumeSessionAt: this.settings.resumeSessionAt,
      sandbox: this.settings.sandbox,
      tools: this.settings.tools,
      mcpServers: this.settings.mcpServers,
      canUseTool: this.settings.canUseTool
    };
    if (this.settings.systemPrompt !== void 0) {
      opts.systemPrompt = this.settings.systemPrompt;
    } else if (this.settings.customSystemPrompt !== void 0) {
      this.logger.warn(
        "[claude-code] 'customSystemPrompt' is deprecated and will be removed in a future major release. Please use 'systemPrompt' instead (string or { type: 'preset', preset: 'claude_code', append? })."
      );
      opts.systemPrompt = this.settings.customSystemPrompt;
    } else if (this.settings.appendSystemPrompt !== void 0) {
      this.logger.warn(
        "[claude-code] 'appendSystemPrompt' is deprecated and will be removed in a future major release. Please use 'systemPrompt: { type: 'preset', preset: 'claude_code', append: <text> }' instead."
      );
      opts.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        append: this.settings.appendSystemPrompt
      };
    }
    if (this.settings.settingSources !== void 0) {
      opts.settingSources = this.settings.settingSources;
    }
    if (this.settings.additionalDirectories !== void 0) {
      opts.additionalDirectories = this.settings.additionalDirectories;
    }
    if (this.settings.agents !== void 0) {
      opts.agents = this.settings.agents;
    }
    if (this.settings.includePartialMessages !== void 0) {
      opts.includePartialMessages = this.settings.includePartialMessages;
    }
    if (this.settings.fallbackModel !== void 0) {
      opts.fallbackModel = this.settings.fallbackModel;
    }
    if (this.settings.forkSession !== void 0) {
      opts.forkSession = this.settings.forkSession;
    }
    if (this.settings.strictMcpConfig !== void 0) {
      opts.strictMcpConfig = this.settings.strictMcpConfig;
    }
    if (this.settings.extraArgs !== void 0) {
      opts.extraArgs = this.settings.extraArgs;
    }
    if (this.settings.persistSession !== void 0) {
      opts.persistSession = this.settings.persistSession;
    }
    if (this.settings.spawnClaudeCodeProcess !== void 0) {
      opts.spawnClaudeCodeProcess = this.settings.spawnClaudeCodeProcess;
    }
    if (this.settings.hooks) {
      opts.hooks = this.settings.hooks;
    }
    if (this.settings.sessionId !== void 0) {
      opts.sessionId = this.settings.sessionId;
    }
    if (this.settings.debug !== void 0) {
      opts.debug = this.settings.debug;
    }
    if (this.settings.debugFile !== void 0) {
      opts.debugFile = this.settings.debugFile;
    }
    const sdkOverrides = sdkOptions ? sdkOptions : void 0;
    const sdkEnv = sdkOverrides && typeof sdkOverrides.env === "object" && sdkOverrides.env !== null ? sdkOverrides.env : void 0;
    const sdkStderr = sdkOverrides && typeof sdkOverrides.stderr === "function" ? sdkOverrides.stderr : void 0;
    if (sdkOverrides) {
      const rest = { ...sdkOverrides };
      delete rest.env;
      delete rest.stderr;
      Object.assign(opts, rest);
    }
    const userStderrCallback = sdkStderr ?? this.settings.stderr;
    if (stderrCollector || userStderrCallback) {
      opts.stderr = (data) => {
        if (stderrCollector) stderrCollector(data);
        if (userStderrCallback) userStderrCallback(data);
      };
    }
    if (this.settings.env !== void 0 || sdkEnv !== void 0) {
      const baseEnv = getBaseProcessEnv();
      opts.env = { ...baseEnv, ...this.settings.env, ...sdkEnv };
    }
    if (responseFormat?.type === "json" && responseFormat.schema) {
      opts.outputFormat = {
        type: "json_schema",
        schema: responseFormat.schema
      };
    }
    return opts;
  }
  handleClaudeCodeError(error, messagesPrompt, collectedStderr) {
    if (isAbortError(error)) {
      throw error;
    }
    const isErrorWithMessage = (err) => {
      return typeof err === "object" && err !== null && "message" in err;
    };
    const isErrorWithCode = (err) => {
      return typeof err === "object" && err !== null;
    };
    const authErrorPatterns = [
      "not logged in",
      "authentication",
      "unauthorized",
      "auth failed",
      "please login",
      "claude login",
      "claude auth login",
      "/login",
      // CLI returns "Please run /login"
      "invalid api key"
    ];
    const errorMessage = isErrorWithMessage(error) && error.message ? error.message.toLowerCase() : "";
    const exitCode = isErrorWithCode(error) && typeof error.exitCode === "number" ? error.exitCode : void 0;
    const isAuthError = authErrorPatterns.some((pattern) => errorMessage.includes(pattern)) || exitCode === 401;
    if (isAuthError) {
      return createAuthenticationError({
        message: isErrorWithMessage(error) && error.message ? error.message : "Authentication failed. Please ensure Claude Code SDK is properly authenticated."
      });
    }
    const errorCode = isErrorWithCode(error) && typeof error.code === "string" ? error.code : "";
    if (errorCode === "ETIMEDOUT" || errorMessage.includes("timeout")) {
      return createTimeoutError({
        message: isErrorWithMessage(error) && error.message ? error.message : "Request timed out",
        promptExcerpt: messagesPrompt.substring(0, 200)
        // Don't specify timeoutMs since we don't know the actual timeout value
        // It's controlled by the consumer via AbortSignal
      });
    }
    const isRetryable = errorCode === "ENOENT" || errorCode === "ECONNREFUSED" || errorCode === "ETIMEDOUT" || errorCode === "ECONNRESET";
    const stderrFromError = isErrorWithCode(error) && typeof error.stderr === "string" ? error.stderr : void 0;
    const stderr = stderrFromError || collectedStderr || void 0;
    return createAPICallError({
      message: isErrorWithMessage(error) && error.message ? error.message : "Claude Code SDK error",
      code: errorCode || void 0,
      exitCode,
      stderr,
      promptExcerpt: messagesPrompt.substring(0, 200),
      isRetryable
    });
  }
  setSessionId(sessionId) {
    this.sessionId = sessionId;
    const warning = validateSessionId(sessionId);
    if (warning) {
      this.logger.warn(`Claude Code Session: ${warning}`);
    }
  }
  logMcpConnectionIssues(mcpServers) {
    if (!Array.isArray(mcpServers) || mcpServers.length === 0) {
      return;
    }
    const serversNeedingAttention = mcpServers.filter((server) => {
      const status = typeof server.status === "string" ? server.status.toLowerCase() : "";
      return status === "failed" || status === "needs-auth";
    });
    if (serversNeedingAttention.length === 0) {
      return;
    }
    const details = serversNeedingAttention.map((server) => {
      const name = typeof server.name === "string" && server.name.trim().length > 0 ? server.name : "<unknown>";
      const status = typeof server.status === "string" && server.status.trim().length > 0 ? server.status : "unknown";
      const error = typeof server.error === "string" && server.error.trim().length > 0 ? ` (${server.error})` : "";
      return `${name}:${status}${error}`;
    }).join(", ");
    this.logger.warn(`[claude-code] MCP servers not connected: ${details}`);
  }
  async doGenerate(options) {
    this.logger.debug(`[claude-code] Starting doGenerate request with model: ${this.modelId}`);
    this.logger.debug(`[claude-code] Response format: ${options.responseFormat?.type ?? "none"}`);
    const {
      messagesPrompt,
      warnings: messageWarnings,
      streamingContentParts,
      hasImageParts
    } = convertToClaudeCodeMessages(options.prompt);
    this.logger.debug(
      `[claude-code] Converted ${options.prompt.length} messages, hasImageParts: ${hasImageParts}`
    );
    const abortController = new AbortController();
    let abortListener;
    if (options.abortSignal?.aborted) {
      abortController.abort(options.abortSignal.reason);
    } else if (options.abortSignal) {
      abortListener = () => abortController.abort(options.abortSignal?.reason);
      options.abortSignal.addEventListener("abort", abortListener, { once: true });
    }
    let collectedStderr = "";
    const stderrCollector = (data) => {
      collectedStderr += data;
    };
    const sdkOptions = this.getSanitizedSdkOptions();
    const effectiveResume = this.getEffectiveResume(sdkOptions);
    const queryOptions = this.createQueryOptions(
      abortController,
      options.responseFormat,
      stderrCollector,
      sdkOptions,
      effectiveResume
    );
    let text = "";
    const thinkingTraces = [];
    let structuredOutput;
    let usage = createEmptyUsage();
    let finishReason = { unified: "stop", raw: void 0 };
    let wasTruncated = false;
    let costUsd;
    let durationMs;
    let modelUsage;
    const warnings = this.generateAllWarnings(options, messagesPrompt);
    if (messageWarnings) {
      messageWarnings.forEach((warning) => {
        warnings.push({
          type: "other",
          message: warning
        });
      });
    }
    const modeSetting = this.settings.streamingInput ?? "auto";
    const effectiveCanUseTool = sdkOptions?.canUseTool ?? this.settings.canUseTool;
    const effectivePermissionPromptToolName = sdkOptions?.permissionPromptToolName ?? this.settings.permissionPromptToolName;
    const wantsStreamInput = modeSetting === "always" || modeSetting === "auto" && !!effectiveCanUseTool;
    if (!wantsStreamInput && hasImageParts) {
      warnings.push({
        type: "other",
        message: STREAMING_FEATURE_WARNING
      });
    }
    let done = () => {
    };
    const outputStreamEnded = new Promise((resolve) => {
      done = () => resolve(void 0);
    });
    try {
      if (effectiveCanUseTool && effectivePermissionPromptToolName) {
        throw new Error(
          "canUseTool requires streamingInput mode ('auto' or 'always') and cannot be used with permissionPromptToolName (SDK constraint). Set streamingInput: 'auto' (or 'always') and remove permissionPromptToolName, or remove canUseTool."
        );
      }
      const sdkPrompt = wantsStreamInput ? toAsyncIterablePrompt(
        messagesPrompt,
        outputStreamEnded,
        effectiveResume,
        streamingContentParts,
        this.settings.onStreamStart
      ) : messagesPrompt;
      this.logger.debug(
        `[claude-code] Executing query with streamingInput: ${wantsStreamInput}, session: ${effectiveResume ?? "new"}`
      );
      const response = query({
        prompt: sdkPrompt,
        options: queryOptions
      });
      this.settings.onQueryCreated?.(response);
      for await (const message of response) {
        this.logger.debug(`[claude-code] Received message type: ${message.type}`);
        if (message.type === "assistant") {
          const { text: messageText, thinking: messageThinking } = this.extractTextAndThinking(
            message.message.content
          );
          text += messageText;
          thinkingTraces.push(...messageThinking);
        } else if (message.type === "result") {
          done();
          this.setSessionId(message.session_id);
          costUsd = message.total_cost_usd;
          durationMs = message.duration_ms;
          modelUsage = message.modelUsage;
          if ("is_error" in message && message.is_error === true) {
            const errorMessage = "result" in message && typeof message.result === "string" ? message.result : "Claude Code CLI returned an error";
            throw Object.assign(new Error(errorMessage), { exitCode: 1 });
          }
          if (message.subtype === "error_max_structured_output_retries") {
            throw new Error(
              "Failed to generate valid structured output after maximum retries. The model could not produce a response matching the required schema."
            );
          }
          if ("structured_output" in message && message.structured_output !== void 0) {
            structuredOutput = message.structured_output;
            this.logger.debug("[claude-code] Received structured output from SDK");
          }
          this.logger.info(
            `[claude-code] Request completed - Session: ${message.session_id}, Cost: $${costUsd?.toFixed(4) ?? "N/A"}, Duration: ${durationMs ?? "N/A"}ms`
          );
          if ("usage" in message) {
            usage = convertClaudeCodeUsage(message.usage);
            this.logger.debug(
              `[claude-code] Token usage - Input: ${usage.inputTokens.total}, Output: ${usage.outputTokens.total}`
            );
          }
          const stopReason = "stop_reason" in message ? message.stop_reason : void 0;
          finishReason = mapClaudeCodeFinishReason(message.subtype, stopReason);
          this.logger.debug(`[claude-code] Finish reason: ${finishReason.unified}`);
        } else if (message.type === "system" && message.subtype === "init") {
          this.logMcpConnectionIssues(message.mcp_servers);
          this.setSessionId(message.session_id);
          this.logger.info(`[claude-code] Session initialized: ${message.session_id}`);
        }
      }
    } catch (error) {
      done();
      this.logger.debug(
        `[claude-code] Error during doGenerate: ${error instanceof Error ? error.message : String(error)}`
      );
      if (isAbortError(error)) {
        this.logger.debug("[claude-code] Request aborted by user");
        throw options.abortSignal?.aborted ? options.abortSignal.reason : error;
      }
      if (isClaudeCodeTruncationError(error, text)) {
        this.logger.warn(
          `[claude-code] Detected truncated response, returning ${text.length} characters of buffered text`
        );
        wasTruncated = true;
        finishReason = { unified: "length", raw: "truncation" };
        warnings.push({
          type: "other",
          message: CLAUDE_CODE_TRUNCATION_WARNING
        });
      } else {
        throw this.handleClaudeCodeError(error, messagesPrompt, collectedStderr);
      }
    } finally {
      if (options.abortSignal && abortListener) {
        options.abortSignal.removeEventListener("abort", abortListener);
      }
    }
    const finalText = structuredOutput !== void 0 ? JSON.stringify(structuredOutput) : text;
    return {
      content: [
        ...thinkingTraces.map((trace) => ({
          type: "reasoning",
          text: trace
        })),
        { type: "text", text: finalText }
      ],
      usage,
      finishReason,
      warnings,
      response: {
        id: generateId(),
        timestamp: /* @__PURE__ */ new Date(),
        modelId: this.modelId
      },
      request: {
        body: messagesPrompt
      },
      providerMetadata: {
        "claude-code": {
          ...this.sessionId !== void 0 && { sessionId: this.sessionId },
          ...costUsd !== void 0 && { costUsd },
          ...durationMs !== void 0 && { durationMs },
          ...modelUsage !== void 0 && { modelUsage },
          ...wasTruncated && { truncated: true },
          ...thinkingTraces.length > 0 && { thinkingTraces }
        }
      }
    };
  }
  async doStream(options) {
    this.logger.debug(`[claude-code] Starting doStream request with model: ${this.modelId}`);
    this.logger.debug(`[claude-code] Response format: ${options.responseFormat?.type ?? "none"}`);
    const {
      messagesPrompt,
      warnings: messageWarnings,
      streamingContentParts,
      hasImageParts
    } = convertToClaudeCodeMessages(options.prompt);
    this.logger.debug(
      `[claude-code] Converted ${options.prompt.length} messages for streaming, hasImageParts: ${hasImageParts}`
    );
    const abortController = new AbortController();
    let abortListener;
    if (options.abortSignal?.aborted) {
      abortController.abort(options.abortSignal.reason);
    } else if (options.abortSignal) {
      abortListener = () => abortController.abort(options.abortSignal?.reason);
      options.abortSignal.addEventListener("abort", abortListener, { once: true });
    }
    let collectedStderr = "";
    const stderrCollector = (data) => {
      collectedStderr += data;
    };
    const sdkOptions = this.getSanitizedSdkOptions();
    const effectiveResume = this.getEffectiveResume(sdkOptions);
    const queryOptions = this.createQueryOptions(
      abortController,
      options.responseFormat,
      stderrCollector,
      sdkOptions,
      effectiveResume
    );
    if (queryOptions.includePartialMessages === void 0) {
      queryOptions.includePartialMessages = true;
    }
    const warnings = this.generateAllWarnings(options, messagesPrompt);
    if (messageWarnings) {
      messageWarnings.forEach((warning) => {
        warnings.push({
          type: "other",
          message: warning
        });
      });
    }
    const modeSetting = this.settings.streamingInput ?? "auto";
    const effectiveCanUseTool = sdkOptions?.canUseTool ?? this.settings.canUseTool;
    const effectivePermissionPromptToolName = sdkOptions?.permissionPromptToolName ?? this.settings.permissionPromptToolName;
    const wantsStreamInput = modeSetting === "always" || modeSetting === "auto" && !!effectiveCanUseTool;
    if (!wantsStreamInput && hasImageParts) {
      warnings.push({
        type: "other",
        message: STREAMING_FEATURE_WARNING
      });
    }
    const isPersistentMode = !!this.settings.persistentSession && wantsStreamInput;
    if (isPersistentMode && this.persistentStream) {
      this.logger.debug(`[claude-code] Persistent session: subsequent doStream called, currentController=${!!this.persistentStream.currentController}`);
      const persistent = this.persistentStream;
      const turnStream = new ReadableStream({
        start: (controller) => {
          this.logger.debug("[claude-code] Persistent session: new turn stream started, setting controller");
          controller.enqueue({ type: "stream-start", warnings });
          persistent.currentController = controller;
          persistent.nextTurnReady.resolve();
          this.logger.debug("[claude-code] Persistent session: nextTurnReady resolved");
        },
        cancel: () => {
          this.logger.debug("[claude-code] Persistent session: turn stream cancelled");
          persistent.currentController = null;
        }
      });
      this.logger.debug(`[claude-code] Persistent session: injecting message (${messagesPrompt.length} chars)`);
      persistent.injector.inject(messagesPrompt);
      return {
        stream: turnStream,
        request: {},
        response: {}
      };
    }
    const stream = new ReadableStream({
      start: async (rawController) => {
        let activeController = rawController;
        const controller = isPersistentMode ? {
          enqueue: (chunk) => activeController.enqueue(chunk),
          close: () => activeController.close(),
          error: (e) => activeController.error(e),
          get desiredSize() {
            return activeController.desiredSize;
          }
        } : rawController;
        const { promise: outputStreamEnded, resolve: done } = createDeferred();
        const toolStates = /* @__PURE__ */ new Map();
        const activeTaskTools = /* @__PURE__ */ new Map();
        const getFallbackParentId = () => {
          if (activeTaskTools.size === 1) {
            return activeTaskTools.keys().next().value ?? null;
          }
          return null;
        };
        const streamWarnings = [];
        const closeToolInput = (toolId, state) => {
          if (!state.inputClosed && state.inputStarted) {
            controller.enqueue({
              type: "tool-input-end",
              id: toolId
            });
            state.inputClosed = true;
          }
        };
        const emitToolCall = (toolId, state) => {
          if (state.callEmitted) {
            return;
          }
          closeToolInput(toolId, state);
          controller.enqueue({
            type: "tool-call",
            toolCallId: toolId,
            toolName: state.name,
            input: state.lastSerializedInput ?? "",
            providerExecuted: true,
            dynamic: true,
            // V3 field: indicates tool is provider-defined (not in user's tools map)
            providerMetadata: {
              "claude-code": {
                // rawInput preserves the original serialized format before AI SDK normalization.
                // Use this if you need the exact string sent to the Claude CLI, which may differ
                // from the `input` field after AI SDK processing.
                rawInput: state.lastSerializedInput ?? "",
                parentToolCallId: state.parentToolCallId ?? null
              }
            }
          });
          state.callEmitted = true;
        };
        const finalizeToolCalls = () => {
          for (const [toolId, state] of toolStates) {
            emitToolCall(toolId, state);
          }
          toolStates.clear();
        };
        let usage = createEmptyUsage();
        let accumulatedText = "";
        let textPartId;
        let streamedTextLength = 0;
        let hasReceivedStreamEvents = false;
        let hasStreamedJson = false;
        const toolBlocksByIndex = /* @__PURE__ */ new Map();
        const toolInputAccumulators = /* @__PURE__ */ new Map();
        const textBlocksByIndex = /* @__PURE__ */ new Map();
        let textStreamedViaContentBlock = false;
        const reasoningBlocksByIndex = /* @__PURE__ */ new Map();
        let currentReasoningPartId;
        const resetTurnState = () => {
          textPartId = void 0;
          toolStates.clear();
          activeTaskTools.clear();
          accumulatedText = "";
          streamedTextLength = 0;
          hasReceivedStreamEvents = false;
          hasStreamedJson = false;
          toolBlocksByIndex.clear();
          toolInputAccumulators.clear();
          textBlocksByIndex.clear();
          textStreamedViaContentBlock = false;
          reasoningBlocksByIndex.clear();
          currentReasoningPartId = void 0;
          usage = createEmptyUsage();
          streamWarnings.length = 0;
        };
        const waitForNextTurn = async (reason) => {
          if (!this.persistentStream) return false;
          this.persistentStream.currentController = null;
          resetTurnState();
          this.persistentStream.nextTurnReady = createDeferred();
          this.persistentStream.turnInterrupted = createDeferred();
          this.logger.debug(`[claude-code] Persistent session: waiting for next turn (after ${reason})`);
          await this.persistentStream.nextTurnReady.promise;
          if (!this.persistentStream) {
            this.logger.debug("[claude-code] Persistent session: destroyed while waiting");
            return false;
          }
          activeController = this.persistentStream.currentController;
          this.logger.debug(`[claude-code] Persistent session: next turn started (after ${reason})`);
          return true;
        };
        try {
          controller.enqueue({ type: "stream-start", warnings });
          if (effectiveCanUseTool && effectivePermissionPromptToolName) {
            throw new Error(
              "canUseTool requires streamingInput mode ('auto' or 'always') and cannot be used with permissionPromptToolName (SDK constraint). Set streamingInput: 'auto' (or 'always') and remove permissionPromptToolName, or remove canUseTool."
            );
          }
          const onStreamStartWrapper = isPersistentMode ? (injector) => {
            this.persistentStream = {
              injector,
              nextTurnReady: createDeferred(),
              turnInterrupted: createDeferred(),
              currentController: controller,
              doneFn: done
            };
            this.settings.onStreamStart?.(injector);
          } : this.settings.onStreamStart;
          const sdkPrompt = wantsStreamInput ? toAsyncIterablePrompt(
            messagesPrompt,
            outputStreamEnded,
            effectiveResume,
            streamingContentParts,
            onStreamStartWrapper
          ) : messagesPrompt;
          this.logger.debug(
            `[claude-code] Starting stream query with streamingInput: ${wantsStreamInput}, session: ${effectiveResume ?? "new"}`
          );
          const response = query({
            prompt: sdkPrompt,
            options: queryOptions
          });
          this.settings.onQueryCreated?.(response);
          const responseIterator = response[Symbol.asyncIterator]();
          const TURN_INTERRUPTED = Symbol("turn-interrupted");
          while (true) {
            const iterResult = isPersistentMode && this.persistentStream ? await Promise.race([
              responseIterator.next(),
              this.persistentStream.turnInterrupted.promise.then(
                () => TURN_INTERRUPTED
              )
            ]) : await responseIterator.next();
            if (iterResult === TURN_INTERRUPTED) {
              this.logger.debug("[claude-code] Persistent session: turn interrupted externally");
              try {
                activeController.close();
              } catch {
              }
              const resumed = await waitForNextTurn("interrupt");
              if (!resumed) break;
              try {
                let iteratorEnded = false;
                for (; ; ) {
                  const drainResult = await responseIterator.next();
                  if (drainResult.done) {
                    this.logger.debug("[claude-code] Persistent session: iterator ended while draining");
                    iteratorEnded = true;
                    break;
                  }
                  this.logger.debug(`[claude-code] Persistent session: draining post-interrupt event: ${drainResult.value.type}`);
                  if (drainResult.value.type === "result") {
                    break;
                  }
                }
                if (iteratorEnded) break;
              } catch (drainErr) {
                this.logger.warn(`[claude-code] Persistent session: error draining post-interrupt events: ${drainErr}`);
                break;
              }
              continue;
            }
            const iterMsg = iterResult;
            if (iterMsg.done) {
              this.logger.debug("[claude-code] Persistent session: iterator done");
              break;
            }
            const message = iterMsg.value;
            if (isPersistentMode && this.persistentStream) {
              const ctrl = this.persistentStream.currentController;
              if (!ctrl) {
                this.logger.debug(`[claude-code] Persistent session: controller gone (nulled), skipping event: ${message.type}`);
                continue;
              }
              try {
                void ctrl.desiredSize;
              } catch {
                this.logger.debug(`[claude-code] Persistent session: controller closed, event: ${message.type}`);
                const resumed = await waitForNextTurn("controller-closed");
                if (!resumed) break;
                continue;
              }
            }
            this.logger.debug(`[claude-code] Stream received message type: ${message.type}`);
            if (message.type === "stream_event") {
              const streamEvent = message;
              const event = streamEvent.event;
              if (event.type === "content_block_delta" && event.delta.type === "text_delta" && "text" in event.delta && event.delta.text) {
                const deltaText = event.delta.text;
                hasReceivedStreamEvents = true;
                if (options.responseFormat?.type === "json") {
                  accumulatedText += deltaText;
                  streamedTextLength += deltaText.length;
                  continue;
                }
                if (!textPartId) {
                  textPartId = generateId();
                  controller.enqueue({
                    type: "text-start",
                    id: textPartId
                  });
                }
                controller.enqueue({
                  type: "text-delta",
                  id: textPartId,
                  delta: deltaText
                });
                accumulatedText += deltaText;
                streamedTextLength += deltaText.length;
              }
              if (event.type === "content_block_delta" && event.delta.type === "input_json_delta" && "partial_json" in event.delta && event.delta.partial_json) {
                const jsonDelta = event.delta.partial_json;
                hasReceivedStreamEvents = true;
                const blockIndex = "index" in event ? event.index : -1;
                if (options.responseFormat?.type === "json") {
                  if (!textPartId) {
                    textPartId = generateId();
                    controller.enqueue({
                      type: "text-start",
                      id: textPartId
                    });
                  }
                  controller.enqueue({
                    type: "text-delta",
                    id: textPartId,
                    delta: jsonDelta
                  });
                  accumulatedText += jsonDelta;
                  streamedTextLength += jsonDelta.length;
                  hasStreamedJson = true;
                  continue;
                }
                const toolId = toolBlocksByIndex.get(blockIndex);
                if (toolId) {
                  const accumulated = (toolInputAccumulators.get(toolId) ?? "") + jsonDelta;
                  toolInputAccumulators.set(toolId, accumulated);
                  controller.enqueue({
                    type: "tool-input-delta",
                    id: toolId,
                    delta: jsonDelta
                  });
                  continue;
                }
              }
              if (event.type === "content_block_start" && "content_block" in event && event.content_block?.type === "tool_use") {
                const blockIndex = "index" in event ? event.index : -1;
                const toolBlock = event.content_block;
                const toolId = typeof toolBlock.id === "string" && toolBlock.id.length > 0 ? toolBlock.id : generateId();
                const toolName = typeof toolBlock.name === "string" && toolBlock.name.length > 0 ? toolBlock.name : _ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME;
                hasReceivedStreamEvents = true;
                if (textPartId) {
                  const closedTextId = textPartId;
                  controller.enqueue({
                    type: "text-end",
                    id: closedTextId
                  });
                  textPartId = void 0;
                  for (const [idx, blockTextId] of textBlocksByIndex) {
                    if (blockTextId === closedTextId) {
                      textBlocksByIndex.delete(idx);
                      break;
                    }
                  }
                }
                toolBlocksByIndex.set(blockIndex, toolId);
                toolInputAccumulators.set(toolId, "");
                let state = toolStates.get(toolId);
                if (!state) {
                  const currentParentId = toolName === "Task" ? null : getFallbackParentId();
                  state = {
                    name: toolName,
                    inputStarted: false,
                    inputClosed: false,
                    callEmitted: false,
                    parentToolCallId: currentParentId
                  };
                  toolStates.set(toolId, state);
                }
                if (!state.inputStarted) {
                  this.logger.debug(
                    `[claude-code] Tool input started (content_block) - Tool: ${toolName}, ID: ${toolId}, parent: ${state.parentToolCallId}`
                  );
                  controller.enqueue({
                    type: "tool-input-start",
                    id: toolId,
                    toolName,
                    providerExecuted: true,
                    dynamic: true,
                    providerMetadata: {
                      "claude-code": {
                        parentToolCallId: state.parentToolCallId ?? null
                      }
                    }
                  });
                  if (toolName === "Task") {
                    activeTaskTools.set(toolId, { startTime: Date.now() });
                  }
                  state.inputStarted = true;
                }
                continue;
              }
              if (event.type === "content_block_start" && "content_block" in event && event.content_block?.type === "text") {
                const blockIndex = "index" in event ? event.index : -1;
                hasReceivedStreamEvents = true;
                const partId = generateId();
                textBlocksByIndex.set(blockIndex, partId);
                textPartId = partId;
                this.logger.debug(
                  `[claude-code] Text content block started - Index: ${blockIndex}, ID: ${partId}`
                );
                controller.enqueue({
                  type: "text-start",
                  id: partId
                });
                textStreamedViaContentBlock = true;
                continue;
              }
              if (event.type === "content_block_start" && "content_block" in event && event.content_block?.type === "thinking") {
                const blockIndex = "index" in event ? event.index : -1;
                hasReceivedStreamEvents = true;
                if (textPartId) {
                  const closedTextId = textPartId;
                  controller.enqueue({
                    type: "text-end",
                    id: closedTextId
                  });
                  textPartId = void 0;
                  for (const [idx, blockTextId] of textBlocksByIndex) {
                    if (blockTextId === closedTextId) {
                      textBlocksByIndex.delete(idx);
                      break;
                    }
                  }
                }
                const reasoningPartId = generateId();
                reasoningBlocksByIndex.set(blockIndex, reasoningPartId);
                currentReasoningPartId = reasoningPartId;
                this.logger.debug(
                  `[claude-code] Reasoning started (content_block) - ID: ${reasoningPartId}`
                );
                controller.enqueue({
                  type: "reasoning-start",
                  id: reasoningPartId
                });
                continue;
              }
              if (event.type === "content_block_delta" && event.delta.type === "thinking_delta" && "thinking" in event.delta && event.delta.thinking) {
                const blockIndex = "index" in event ? event.index : -1;
                const reasoningPartId = reasoningBlocksByIndex.get(blockIndex) ?? currentReasoningPartId;
                hasReceivedStreamEvents = true;
                if (reasoningPartId) {
                  controller.enqueue({
                    type: "reasoning-delta",
                    id: reasoningPartId,
                    delta: event.delta.thinking
                  });
                }
                continue;
              }
              if (event.type === "content_block_stop") {
                const blockIndex = "index" in event ? event.index : -1;
                hasReceivedStreamEvents = true;
                const toolId = toolBlocksByIndex.get(blockIndex);
                if (toolId) {
                  const state = toolStates.get(toolId);
                  if (state && !state.inputClosed) {
                    const accumulatedInput = toolInputAccumulators.get(toolId) ?? "";
                    this.logger.debug(
                      `[claude-code] Tool content block stopped - Index: ${blockIndex}, Tool: ${state.name}, ID: ${toolId}`
                    );
                    controller.enqueue({
                      type: "tool-input-end",
                      id: toolId
                    });
                    state.inputClosed = true;
                    const effectiveInput = accumulatedInput || state.lastSerializedInput || "";
                    state.lastSerializedInput = effectiveInput;
                    if (!state.callEmitted) {
                      controller.enqueue({
                        type: "tool-call",
                        toolCallId: toolId,
                        toolName: state.name,
                        input: effectiveInput,
                        providerExecuted: true,
                        dynamic: true,
                        providerMetadata: {
                          "claude-code": {
                            rawInput: effectiveInput,
                            parentToolCallId: state.parentToolCallId ?? null
                          }
                        }
                      });
                      state.callEmitted = true;
                    }
                  }
                  toolBlocksByIndex.delete(blockIndex);
                  toolInputAccumulators.delete(toolId);
                  continue;
                }
                const textId = textBlocksByIndex.get(blockIndex);
                if (textId) {
                  this.logger.debug(
                    `[claude-code] Text content block stopped - Index: ${blockIndex}, ID: ${textId}`
                  );
                  controller.enqueue({
                    type: "text-end",
                    id: textId
                  });
                  textBlocksByIndex.delete(blockIndex);
                  if (textPartId === textId) {
                    textPartId = void 0;
                  }
                  continue;
                }
                const reasoningPartId = reasoningBlocksByIndex.get(blockIndex);
                if (reasoningPartId) {
                  this.logger.debug(
                    `[claude-code] Reasoning ended (content_block) - ID: ${reasoningPartId}`
                  );
                  controller.enqueue({
                    type: "reasoning-end",
                    id: reasoningPartId
                  });
                  reasoningBlocksByIndex.delete(blockIndex);
                  if (currentReasoningPartId === reasoningPartId) {
                    currentReasoningPartId = void 0;
                  }
                  continue;
                }
              }
              continue;
            }
            if (message.type === "assistant") {
              if (!message.message?.content) {
                this.logger.warn(
                  `[claude-code] Unexpected assistant message structure: missing content field. Message type: ${message.type}. This may indicate an SDK protocol violation.`
                );
                continue;
              }
              const sdkParentToolUseId = message.parent_tool_use_id;
              const content = message.message.content;
              const tools = this.extractToolUses(content);
              if (textPartId && tools.length > 0) {
                const closedTextId = textPartId;
                controller.enqueue({
                  type: "text-end",
                  id: closedTextId
                });
                textPartId = void 0;
                for (const [idx, blockTextId] of textBlocksByIndex) {
                  if (blockTextId === closedTextId) {
                    textBlocksByIndex.delete(idx);
                    break;
                  }
                }
              }
              for (const tool3 of tools) {
                const toolId = tool3.id;
                let state = toolStates.get(toolId);
                if (!state) {
                  const currentParentId = tool3.name === "Task" ? null : sdkParentToolUseId ?? tool3.parentToolUseId ?? getFallbackParentId();
                  state = {
                    name: tool3.name,
                    inputStarted: false,
                    inputClosed: false,
                    callEmitted: false,
                    parentToolCallId: currentParentId
                  };
                  toolStates.set(toolId, state);
                  this.logger.debug(
                    `[claude-code] New tool use detected - Tool: ${tool3.name}, ID: ${toolId}, SDK parent: ${sdkParentToolUseId}, resolved parent: ${currentParentId}`
                  );
                } else if (!state.parentToolCallId && sdkParentToolUseId && tool3.name !== "Task") {
                  state.parentToolCallId = sdkParentToolUseId;
                  this.logger.debug(
                    `[claude-code] Retroactive parent context - Tool: ${tool3.name}, ID: ${toolId}, parent: ${sdkParentToolUseId}`
                  );
                }
                state.name = tool3.name;
                if (!state.inputStarted) {
                  this.logger.debug(
                    `[claude-code] Tool input started - Tool: ${tool3.name}, ID: ${toolId}`
                  );
                  controller.enqueue({
                    type: "tool-input-start",
                    id: toolId,
                    toolName: tool3.name,
                    providerExecuted: true,
                    dynamic: true,
                    // V3 field: indicates tool is provider-defined
                    providerMetadata: {
                      "claude-code": {
                        parentToolCallId: state.parentToolCallId ?? null
                      }
                    }
                  });
                  if (tool3.name === "Task") {
                    activeTaskTools.set(toolId, { startTime: Date.now() });
                  }
                  state.inputStarted = true;
                }
                const serializedInput = this.serializeToolInput(tool3.input);
                if (serializedInput) {
                  let deltaPayload = "";
                  if (state.lastSerializedInput === void 0) {
                    if (serializedInput.length <= _ClaudeCodeLanguageModel.MAX_DELTA_CALC_SIZE) {
                      deltaPayload = serializedInput;
                    }
                  } else if (serializedInput.length <= _ClaudeCodeLanguageModel.MAX_DELTA_CALC_SIZE && state.lastSerializedInput.length <= _ClaudeCodeLanguageModel.MAX_DELTA_CALC_SIZE && serializedInput.startsWith(state.lastSerializedInput)) {
                    deltaPayload = serializedInput.slice(state.lastSerializedInput.length);
                  } else if (serializedInput !== state.lastSerializedInput) {
                    deltaPayload = "";
                  }
                  if (deltaPayload) {
                    controller.enqueue({
                      type: "tool-input-delta",
                      id: toolId,
                      delta: deltaPayload
                    });
                  }
                  state.lastSerializedInput = serializedInput;
                }
              }
              const text = content.map((c) => c.type === "text" ? c.text : "").join("");
              if (text) {
                if (hasReceivedStreamEvents) {
                  const newTextStart = streamedTextLength;
                  const deltaText = text.length > newTextStart ? text.slice(newTextStart) : "";
                  accumulatedText = text;
                  if (options.responseFormat?.type !== "json" && deltaText) {
                    if (!textPartId) {
                      textPartId = generateId();
                      controller.enqueue({
                        type: "text-start",
                        id: textPartId
                      });
                    }
                    controller.enqueue({
                      type: "text-delta",
                      id: textPartId,
                      delta: deltaText
                    });
                  }
                  streamedTextLength = text.length;
                } else {
                  accumulatedText += text;
                  if (options.responseFormat?.type !== "json") {
                    if (!textPartId) {
                      textPartId = generateId();
                      controller.enqueue({
                        type: "text-start",
                        id: textPartId
                      });
                    }
                    controller.enqueue({
                      type: "text-delta",
                      id: textPartId,
                      delta: text
                    });
                  }
                }
              }
            } else if (message.type === "user") {
              if (!message.message?.content) {
                this.logger.warn(
                  `[claude-code] Unexpected user message structure: missing content field. Message type: ${message.type}. This may indicate an SDK protocol violation.`
                );
                continue;
              }
              if (textPartId) {
                const closedTextId = textPartId;
                controller.enqueue({
                  type: "text-end",
                  id: closedTextId
                });
                textPartId = void 0;
                for (const [blockIndex, blockTextId] of textBlocksByIndex) {
                  if (blockTextId === closedTextId) {
                    textBlocksByIndex.delete(blockIndex);
                    break;
                  }
                }
                accumulatedText = "";
                streamedTextLength = 0;
                this.logger.debug("[claude-code] Closed text part due to user message");
              }
              const sdkParentToolUseIdForResults = message.parent_tool_use_id;
              const content = message.message.content;
              for (const result of this.extractToolResults(content)) {
                let state = toolStates.get(result.id);
                const toolName = result.name ?? state?.name ?? _ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME;
                this.logger.debug(
                  `[claude-code] Tool result received - Tool: ${toolName}, ID: ${result.id}`
                );
                if (!state) {
                  this.logger.warn(
                    `[claude-code] Received tool result for unknown tool ID: ${result.id}`
                  );
                  const resolvedParentId = toolName === "Task" ? null : sdkParentToolUseIdForResults ?? getFallbackParentId();
                  state = {
                    name: toolName,
                    inputStarted: false,
                    inputClosed: false,
                    callEmitted: false,
                    parentToolCallId: resolvedParentId
                  };
                  toolStates.set(result.id, state);
                  if (!state.inputStarted) {
                    controller.enqueue({
                      type: "tool-input-start",
                      id: result.id,
                      toolName,
                      providerExecuted: true,
                      dynamic: true,
                      // V3 field: indicates tool is provider-defined
                      providerMetadata: {
                        "claude-code": {
                          parentToolCallId: state.parentToolCallId ?? null
                        }
                      }
                    });
                    state.inputStarted = true;
                  }
                  if (!state.inputClosed) {
                    controller.enqueue({
                      type: "tool-input-end",
                      id: result.id
                    });
                    state.inputClosed = true;
                  }
                }
                state.name = toolName;
                const normalizedResult = this.normalizeToolResult(result.result);
                const rawResult = typeof result.result === "string" ? result.result : (() => {
                  try {
                    return JSON.stringify(result.result);
                  } catch {
                    return String(result.result);
                  }
                })();
                const maxToolResultSize = this.settings.maxToolResultSize;
                const truncatedResult = truncateToolResultForStream(
                  normalizedResult,
                  maxToolResultSize
                );
                const truncatedRawResult = truncateToolResultForStream(
                  rawResult,
                  maxToolResultSize
                );
                const rawResultTruncated = truncatedRawResult !== rawResult;
                emitToolCall(result.id, state);
                if (toolName === "Task") {
                  activeTaskTools.delete(result.id);
                }
                controller.enqueue({
                  type: "tool-result",
                  toolCallId: result.id,
                  toolName,
                  result: truncatedResult,
                  isError: result.isError,
                  providerExecuted: true,
                  dynamic: true,
                  // V3 field: indicates tool is provider-defined
                  providerMetadata: {
                    "claude-code": {
                      // rawResult preserves the original CLI output string before JSON parsing.
                      // Use this when you need the exact string returned by the tool, especially
                      // if the `result` field has been parsed/normalized and you need the original format.
                      rawResult: truncatedRawResult,
                      rawResultTruncated,
                      parentToolCallId: state.parentToolCallId ?? null
                    }
                  }
                });
              }
              for (const error of this.extractToolErrors(content)) {
                let state = toolStates.get(error.id);
                const toolName = error.name ?? state?.name ?? _ClaudeCodeLanguageModel.UNKNOWN_TOOL_NAME;
                this.logger.debug(
                  `[claude-code] Tool error received - Tool: ${toolName}, ID: ${error.id}`
                );
                if (!state) {
                  this.logger.warn(
                    `[claude-code] Received tool error for unknown tool ID: ${error.id}`
                  );
                  const errorResolvedParentId = toolName === "Task" ? null : sdkParentToolUseIdForResults ?? getFallbackParentId();
                  state = {
                    name: toolName,
                    inputStarted: true,
                    inputClosed: true,
                    callEmitted: false,
                    parentToolCallId: errorResolvedParentId
                  };
                  toolStates.set(error.id, state);
                }
                emitToolCall(error.id, state);
                if (toolName === "Task") {
                  activeTaskTools.delete(error.id);
                }
                const rawError = typeof error.error === "string" ? error.error : typeof error.error === "object" && error.error !== null ? (() => {
                  try {
                    return JSON.stringify(error.error);
                  } catch {
                    return String(error.error);
                  }
                })() : String(error.error);
                controller.enqueue({
                  type: "tool-error",
                  toolCallId: error.id,
                  toolName,
                  error: rawError,
                  providerExecuted: true,
                  dynamic: true,
                  // V3 field: indicates tool is provider-defined
                  providerMetadata: {
                    "claude-code": {
                      rawError,
                      parentToolCallId: state.parentToolCallId ?? null
                    }
                  }
                });
              }
            } else if (message.type === "result") {
              if (!isPersistentMode) {
                done();
              }
              if ("is_error" in message && message.is_error === true) {
                const errorMessage = "result" in message && typeof message.result === "string" ? message.result : "Claude Code CLI returned an error";
                throw Object.assign(new Error(errorMessage), { exitCode: 1 });
              }
              if (message.subtype === "error_max_structured_output_retries") {
                throw new Error(
                  "Failed to generate valid structured output after maximum retries. The model could not produce a response matching the required schema."
                );
              }
              this.logger.info(
                `[claude-code] Stream completed - Session: ${message.session_id}, Cost: $${message.total_cost_usd?.toFixed(4) ?? "N/A"}, Duration: ${message.duration_ms ?? "N/A"}ms`
              );
              if ("usage" in message) {
                usage = convertClaudeCodeUsage(message.usage);
                this.logger.debug(
                  `[claude-code] Stream token usage - Input: ${usage.inputTokens.total}, Output: ${usage.outputTokens.total}`
                );
              }
              const stopReason = "stop_reason" in message ? message.stop_reason : void 0;
              const finishReason = mapClaudeCodeFinishReason(
                message.subtype,
                stopReason
              );
              this.logger.debug(`[claude-code] Stream finish reason: ${finishReason.unified}`);
              this.setSessionId(message.session_id);
              const structuredOutput = "structured_output" in message ? message.structured_output : void 0;
              const alreadyStreamedJson = hasStreamedJson && options.responseFormat?.type === "json" && hasReceivedStreamEvents;
              if (alreadyStreamedJson) {
                if (textPartId) {
                  controller.enqueue({
                    type: "text-end",
                    id: textPartId
                  });
                }
              } else if (structuredOutput !== void 0) {
                const jsonTextId = generateId();
                const jsonText = JSON.stringify(structuredOutput);
                controller.enqueue({
                  type: "text-start",
                  id: jsonTextId
                });
                controller.enqueue({
                  type: "text-delta",
                  id: jsonTextId,
                  delta: jsonText
                });
                controller.enqueue({
                  type: "text-end",
                  id: jsonTextId
                });
              } else if (textPartId) {
                controller.enqueue({
                  type: "text-end",
                  id: textPartId
                });
              } else if (accumulatedText && !textStreamedViaContentBlock) {
                const fallbackTextId = generateId();
                controller.enqueue({
                  type: "text-start",
                  id: fallbackTextId
                });
                controller.enqueue({
                  type: "text-delta",
                  id: fallbackTextId,
                  delta: accumulatedText
                });
                controller.enqueue({
                  type: "text-end",
                  id: fallbackTextId
                });
              }
              finalizeToolCalls();
              const warningsJson = this.serializeWarningsForMetadata(streamWarnings);
              controller.enqueue({
                type: "finish",
                finishReason,
                usage,
                providerMetadata: {
                  "claude-code": {
                    sessionId: message.session_id,
                    ...message.total_cost_usd !== void 0 && {
                      costUsd: message.total_cost_usd
                    },
                    ...message.duration_ms !== void 0 && { durationMs: message.duration_ms },
                    ...message.modelUsage !== void 0 && {
                      modelUsage: message.modelUsage
                    },
                    ...streamWarnings.length > 0 && {
                      warnings: warningsJson
                    }
                  }
                }
              });
              if (isPersistentMode && this.persistentStream) {
                this.logger.debug("[claude-code] Persistent session: result received, closing per-turn stream");
                activeController.close();
                const resumed = await waitForNextTurn("result");
                if (!resumed) break;
                continue;
              } else {
                controller.close();
                return;
              }
            } else if (message.type === "system" && message.subtype === "init") {
              this.logMcpConnectionIssues(message.mcp_servers);
              this.setSessionId(message.session_id);
              this.logger.info(`[claude-code] Stream session initialized: ${message.session_id}`);
              if (!isPersistentMode || !this.persistentStream) {
                controller.enqueue({
                  type: "response-metadata",
                  id: message.session_id,
                  timestamp: /* @__PURE__ */ new Date(),
                  modelId: this.modelId
                });
              }
            }
          }
          finalizeToolCalls();
          this.logger.debug("[claude-code] Stream finalized, closing stream");
          if (this.persistentStream) {
            this.logger.info("[claude-code] Persistent session ended (process exited)");
            this.persistentStream = void 0;
          }
          controller.close();
        } catch (error) {
          if (this.persistentStream) {
            this.persistentStream = void 0;
          }
          done();
          this.logger.debug(
            `[claude-code] Error during doStream: ${error instanceof Error ? error.message : String(error)}`
          );
          if (isClaudeCodeTruncationError(error, accumulatedText)) {
            this.logger.warn(
              `[claude-code] Detected truncated stream response, returning ${accumulatedText.length} characters of buffered text`
            );
            const truncationWarning = {
              type: "other",
              message: CLAUDE_CODE_TRUNCATION_WARNING
            };
            streamWarnings.push(truncationWarning);
            if (textPartId) {
              controller.enqueue({
                type: "text-end",
                id: textPartId
              });
            } else if (accumulatedText && !textStreamedViaContentBlock) {
              const fallbackTextId = generateId();
              controller.enqueue({
                type: "text-start",
                id: fallbackTextId
              });
              controller.enqueue({
                type: "text-delta",
                id: fallbackTextId,
                delta: accumulatedText
              });
              controller.enqueue({
                type: "text-end",
                id: fallbackTextId
              });
            }
            finalizeToolCalls();
            const warningsJson = this.serializeWarningsForMetadata(streamWarnings);
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "length", raw: "truncation" },
              usage,
              providerMetadata: {
                "claude-code": {
                  ...this.sessionId !== void 0 && { sessionId: this.sessionId },
                  truncated: true,
                  ...streamWarnings.length > 0 && {
                    warnings: warningsJson
                  }
                }
              }
            });
            controller.close();
            return;
          }
          finalizeToolCalls();
          let errorToEmit;
          if (isAbortError(error)) {
            errorToEmit = options.abortSignal?.aborted ? options.abortSignal.reason : error;
          } else {
            errorToEmit = this.handleClaudeCodeError(error, messagesPrompt, collectedStderr);
          }
          controller.enqueue({
            type: "error",
            error: errorToEmit
          });
          controller.close();
        } finally {
          if (options.abortSignal && abortListener) {
            options.abortSignal.removeEventListener("abort", abortListener);
          }
        }
      },
      cancel: () => {
        if (options.abortSignal && abortListener) {
          options.abortSignal.removeEventListener("abort", abortListener);
        }
      }
    });
    return {
      stream,
      request: {
        body: messagesPrompt
      }
    };
  }
  serializeWarningsForMetadata(warnings) {
    const result = warnings.map((w) => {
      const base = { type: w.type };
      if ("message" in w) {
        const m = w.message;
        if (m !== void 0) base.message = String(m);
      }
      if (w.type === "unsupported" || w.type === "compatibility") {
        const feature = w.feature;
        if (feature !== void 0) base.feature = String(feature);
        if ("details" in w) {
          const d = w.details;
          if (d !== void 0) base.details = String(d);
        }
      }
      return base;
    });
    return result;
  }
};

// src/claude-code-provider.ts
function createClaudeCode(options = {}) {
  const logger = getLogger(options.defaultSettings?.logger);
  if (options.defaultSettings) {
    const validation = validateSettings(options.defaultSettings);
    if (!validation.valid) {
      throw new Error(`Invalid default settings: ${validation.errors.join(", ")}`);
    }
    if (validation.warnings.length > 0) {
      validation.warnings.forEach((warning) => logger.warn(`Claude Code Provider: ${warning}`));
    }
  }
  const createModel = (modelId, settings = {}) => {
    const mergedSettings = {
      ...options.defaultSettings,
      ...settings
    };
    const validation = validateSettings(mergedSettings);
    if (!validation.valid) {
      throw new Error(`Invalid settings: ${validation.errors.join(", ")}`);
    }
    return new ClaudeCodeLanguageModel({
      id: modelId,
      settings: mergedSettings,
      settingsValidationWarnings: validation.warnings
    });
  };
  const provider = function(modelId, settings) {
    if (new.target) {
      throw new Error("The Claude Code model function cannot be called with the new keyword.");
    }
    return createModel(modelId, settings);
  };
  provider.languageModel = createModel;
  provider.chat = createModel;
  provider.specificationVersion = "v3";
  provider.embeddingModel = (modelId) => {
    throw new NoSuchModelError2({
      modelId,
      modelType: "embeddingModel"
    });
  };
  provider.imageModel = (modelId) => {
    throw new NoSuchModelError2({
      modelId,
      modelType: "imageModel"
    });
  };
  return provider;
}
var claudeCode = createClaudeCode();

// src/index.ts
import { createSdkMcpServer as createSdkMcpServer2, tool as tool2 } from "@anthropic-ai/claude-agent-sdk";

// src/mcp-helpers.ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import "zod";
function createCustomMcpServer(config) {
  const defs = Object.entries(config.tools).map(
    ([name, def]) => tool(
      name,
      def.description,
      def.inputSchema.shape,
      (args, extra) => def.handler(args, extra),
      def.annotations ? { annotations: def.annotations } : void 0
    )
  );
  return createSdkMcpServer({ name: config.name, version: config.version, tools: defs });
}
export {
  ClaudeCodeLanguageModel,
  claudeCode,
  createAPICallError,
  createAuthenticationError,
  createClaudeCode,
  createCustomMcpServer,
  createSdkMcpServer2 as createSdkMcpServer,
  createTimeoutError,
  getErrorMetadata,
  isAuthenticationError,
  isTimeoutError,
  tool2 as tool
};
//# sourceMappingURL=index.js.map