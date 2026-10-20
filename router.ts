import {
  type DelegationPolicy,
  getNextFallbackModel,
  validateDelegation,
  getShortAlias,
  parseSubagentTarget,
} from "./policy"

/**
 * Checks if an error represents an upstream rate limit (HTTP 429) or proxy usage limit (503 wrapping 429).
 */
export function isRateLimitError(err: unknown): boolean {
  if (!err) return false
  const obj = err as any
  if (obj.status === 429 || obj.statusCode === 429) return true
  const msg = String(obj.message || obj.error || err || "").toLowerCase()
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("usage limit") ||
    msg.includes("quota exceeded") ||
    msg.includes("resource has been exhausted")
  )
}

export function setupRouter(ctx: any, policy: DelegationPolicy) {
  // 1. Tool execution hook for native 'subagent' and 'task' tools
  // Normalizes model aliases, enforces background mode, and formats clean TUI description with center dots.
  ctx.tool.hook("execute.before", async (event: any) => {
    if (event.tool !== "subagent" && event.tool !== "task") return
    if (!event.input || typeof event.input !== "object") return

    const parsed = parseSubagentTarget(event.input)
    const validation = validateDelegation(
      { model: parsed.model, use_case: event.input.use_case, agent: parsed.agent },
      policy
    )
    const alias = getShortAlias(validation.resolvedModel, policy)

    const rawDesc = parsed.description || parsed.agent || "Task"
    const desc = rawDesc.includes(`· ${alias}`) ? rawDesc : `${rawDesc} · ${alias}`

    event.input = {
      ...event.input,
      background: true,
      model: validation.resolvedModel,
      description: desc,
    }
  })

  // 2. Enhance native 'subagent' tool directly:
  // - Wraps native execution with automatic ladder fallback on rate limits
  // - Preserves 100% of OpenCode TUI subagent features: click-to-view, down-arrow list, subagent tabs!
  ctx.tool.transform((editor: any) => {
    try {
      editor.update("subagent", (subTool: any) => {
        subTool.description = [
          subTool.description,
          "",
          "CRITICAL REQUIREMENT: The `model` parameter is MANDATORY. Never omit it.",
          "Background mode (`background: true`) is COMPULSORY to keep the lead agent unblocked.",
          "Pass 'luna' (execution), 'sol' (planning/architecture), 'opus' (design/taste), 'gemini' (writing/research/responses), " +
          "or 'grok' (quota relief only — an independent xAI pool, unbenchmarked for planning or taste).",
        ].join("\n")

        const originalExecute = subTool.execute
        if (typeof originalExecute === "function") {
          subTool.execute = async (input: any, toolContext: any) => {
            const validation = validateDelegation(input, policy)
            const primaryModel = validation.resolvedModel
            const tier = validation.tier
            const alias = getShortAlias(primaryModel, policy)

            const rawDesc = input.description || input.agent || "Task"
            const desc = rawDesc.includes(`· ${alias}`) ? rawDesc : `${rawDesc} · ${alias}`

            const normalizedInput = {
              ...input,
              model: primaryModel,
              background: true,
              description: desc,
            }

            try {
              return await originalExecute(normalizedInput, toolContext)
            } catch (err: any) {
              // Safety net: if subagent session is not found or not a child, strip sessionID and retry as fresh
              if (
                err?.message?.includes("Subagent session not found") ||
                err?.message?.includes("is not a child of the current session")
              ) {
                console.warn(
                  `[subagent-router] Caught ghost sessionID error ("${err.message}"). Retrying as a fresh subagent...`
                )
                const { sessionID: _ghost, ...freshInput } = normalizedInput
                return await originalExecute(freshInput, toolContext)
              }

              if (isRateLimitError(err)) {
                const nextModel = getNextFallbackModel(primaryModel, tier, policy)
                if (nextModel && nextModel !== primaryModel) {
                  const fallbackAlias = getShortAlias(nextModel, policy)
                  console.warn(
                    `[subagent-router] Primary model ${primaryModel} rate-limited. Retrying with fallback ${nextModel}...`
                  )
                  const fallbackInput = {
                    ...input,
                    model: nextModel,
                    background: true,
                    description: `${input.description || input.agent} · ${fallbackAlias} (Fallback)`,
                  }
                  return await originalExecute(fallbackInput, toolContext)
                }
              }
              throw err
            }
          }
        }
      })
    } catch (err) {
      console.error("[subagent-router] Failed to wrap native subagent tool:", err)
    }
  })
}
