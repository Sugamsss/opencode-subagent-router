import fs from "node:fs"
import path from "node:path"
import os from "node:os"

export interface DelegationPolicy {
  default_fallback: string
  tiers: Record<string, string>
  ladders: Record<string, string[]>
  aliases: Record<string, string>
  role_defaults: Record<string, string>
  avoid: string[]
}

export const DEFAULT_POLICY: DelegationPolicy = {
  default_fallback: "9router/ag/gemini-3.8-flash-tiered",
  tiers: {
    writing: "9router/ag/gemini-3.8-flash-tiered",
    implementation: "9router/cx/gpt-6-luna",
    planning: "9router/cx/gpt-6.1-sol",
    taste: "9router/cc/claude-opus-5-5",
    research: "9router/ag/gemini-3.8-flash-tiered",
  },
  ladders: {
    writing: [
      "9router/ag/gemini-3.8-flash-tiered",
      "9router/cc/claude-opus-5-5",
      "9router/cx/gpt-6-luna",
      "9router/gcli/grok-4.7-high",
    ],
    implementation: [
      "9router/cx/gpt-6-luna",
      "9router/cx/gpt-reserve",
      "9router/ag/gemini-3.8-flash-tiered",
      "9router/gcli/grok-4.7-high",
    ],
    planning: [
      "9router/cx/gpt-6.1-sol",
      "9router/ag/gemini-3.8-flash-tiered",
      "9router/cx/gpt-6-luna",
      "9router/gcli/grok-4.7-high",
    ],
    taste: [
      "9router/cc/claude-opus-5-5",
      "9router/ag/gemini-3.8-flash-tiered",
      "9router/gcli/grok-4.7-high",
    ],
    research: [
      "9router/ag/gemini-3.8-flash-tiered",
      "9router/cx/gpt-6-luna",
      "9router/cx/gpt-reserve",
      "9router/gcli/grok-4.7-high",
    ],
  },
  aliases: {
    gemini: "9router/ag/gemini-3.8-flash-tiered",
    flash: "9router/ag/gemini-3.8-flash-tiered",
    opus: "9router/cc/claude-opus-5-5",
    sol: "9router/cx/gpt-6.1-sol",
    soul: "9router/cx/gpt-6.1-sol",
    luna: "9router/cx/gpt-6-luna",
    reserve: "9router/cx/gpt-reserve",
    grok: "9router/gcli/grok-4.7-high",
  },
  role_defaults: {
    "Product Manager": "planning",
    "Tech Lead": "planning",
    "Research Lead": "planning",
    "Design Lead": "taste",
    Designer: "taste",
    "Frontend Guy": "implementation",
    "Backend Guy": "implementation",
    Researcher: "research",
    general: "implementation",
  },
  avoid: ["fable", "claude-fable"],
}

/**
 * Loads policy from ~/.config/opencode/delegation-policy.json, falling back to DEFAULT_POLICY.
 */
export function loadPolicy(customPath?: string): DelegationPolicy {
  const policyPath = customPath || path.join(os.homedir(), ".config", "opencode", "delegation-policy.json")
  try {
    if (fs.existsSync(policyPath)) {
      const parsed = JSON.parse(fs.readFileSync(policyPath, "utf-8"))
      return {
        ...DEFAULT_POLICY,
        ...parsed,
        tiers: { ...DEFAULT_POLICY.tiers, ...(parsed.tiers || {}) },
        ladders: { ...DEFAULT_POLICY.ladders, ...(parsed.ladders || {}) },
        aliases: { ...DEFAULT_POLICY.aliases, ...(parsed.aliases || {}) },
        role_defaults: { ...DEFAULT_POLICY.role_defaults, ...(parsed.role_defaults || {}) },
        avoid: parsed.avoid || DEFAULT_POLICY.avoid,
      }
    }
  } catch (err) {
    console.error("[subagent-router] Failed to parse delegation policy, using defaults:", err)
  }
  return DEFAULT_POLICY
}

/**
 * Resolves an alias or tier name into a fully-qualified 9Router model slug.
 */
export function resolveModel(inputModel: string, policy: DelegationPolicy): string {
  const trimmed = inputModel.trim()
  const hashIdx = trimmed.indexOf("#")
  const base = (hashIdx !== -1 ? trimmed.slice(0, hashIdx) : trimmed).toLowerCase()
  const variant = hashIdx !== -1 ? trimmed.slice(hashIdx) : ""

  if (policy.aliases[base]) return policy.aliases[base] + variant
  if (policy.tiers[base]) return policy.tiers[base] + variant
  return trimmed
}

/**
 * Converts a provider/model#variant slug into a Model.Ref object for OpenCode session creation.
 */
export function toModelRef(modelSlug: string): { providerID: string; id: string; variant?: string } {
  const hashIdx = modelSlug.indexOf("#")
  const base = hashIdx !== -1 ? modelSlug.slice(0, hashIdx) : modelSlug
  const variant = hashIdx !== -1 ? modelSlug.slice(hashIdx + 1) : undefined

  const slashIdx = base.indexOf("/")
  if (slashIdx === -1) {
    return { providerID: "9router", id: base, ...(variant ? { variant } : {}) }
  }
  return {
    providerID: base.slice(0, slashIdx),
    id: base.slice(slashIdx + 1),
    ...(variant ? { variant } : {}),
  }
}

/**
 * Parses subagent delegation target whether passed as center-dot string or structured keys.
 */
export function parseSubagentTarget(input: any): {
  agent: string
  model: string
  description: string
  task: string
} {
  let agent = input.agent || ""
  let model = input.model || ""
  let description = input.description || ""
  let task = typeof input.task === "string" ? input.task : input.task?.instructions || input.prompt || ""

  if (input.subagent && typeof input.subagent === "string") {
    const parts = input.subagent.split(/[·•|]/).map((s: string) => s.trim()).filter(Boolean)
    if (parts.length >= 1 && !agent) agent = parts[0]
    if (parts.length >= 2 && !model) model = parts[1]
    if (parts.length >= 3 && !description) description = parts.slice(2).join(" · ")
  }

  return {
    agent: agent || "general",
    model: model || "luna",
    description: description || "Task",
    task,
  }
}

/**
 * Validates delegation parameters and resolves optimal model and tier.
 * Never fails on omitted models; falls back gracefully to software factory defaults.
 */
export function validateDelegation(
  input: {
    model?: string
    use_case?: string
    agent?: string
  },
  policy: DelegationPolicy
): { valid: boolean; error?: string; resolvedModel: string; tier: string; warning?: string; notice?: string } {
  const rawModel = (input.model || "").trim()

  // 1. Check avoid/blacklist
  if (rawModel && policy.avoid.some((bad) => rawModel.toLowerCase().includes(bad.toLowerCase()))) {
    const fallbackTier = (input.agent && policy.role_defaults[input.agent]) || "planning"
    const fallbackModel = policy.tiers[fallbackTier] || policy.default_fallback
    return {
      valid: true,
      resolvedModel: fallbackModel,
      tier: fallbackTier,
      warning: `Model "${rawModel}" is blacklisted (expensive, poor cost-efficiency). Auto-redirected to ${fallbackTier} model: ${fallbackModel}.`,
    }
  }

  // 2. Explicit model provided
  if (rawModel) {
    const resolved = resolveModel(rawModel, policy)
    // Determine tier from model or agent
    let tier = "implementation"
    for (const [t, m] of Object.entries(policy.tiers)) {
      if (m.split("#")[0] === resolved.split("#")[0]) {
        tier = t
        break
      }
    }
    return {
      valid: true,
      resolvedModel: resolved,
      tier,
    }
  }

  // 3. Explicit use_case provided
  if (input.use_case && policy.tiers[input.use_case.toLowerCase()]) {
    const tier = input.use_case.toLowerCase()
    return {
      valid: true,
      resolvedModel: policy.tiers[tier],
      tier,
      notice: `Routed via use_case "${tier}".`,
    }
  }

  // 4. Fallback to role default
  if (input.agent && policy.role_defaults[input.agent]) {
    const tier = policy.role_defaults[input.agent]
    const resolved = policy.tiers[tier] || policy.tiers.implementation
    return {
      valid: true,
      resolvedModel: resolved,
      tier,
      notice: `Auto-routed to ${input.agent} role default (${tier}): ${resolved}.`,
    }
  }

  // 5. Default to implementation
  return {
    valid: true,
    resolvedModel: policy.tiers.implementation,
    tier: "implementation",
    notice: `Defaulted to implementation: ${policy.tiers.implementation}.`,
  }
}

/**
 * Gets the friendly short alias for a 9Router slug.
 */
export function getShortAlias(modelSlug: string, policy: DelegationPolicy): string {
  const clean = modelSlug.split("#")[0]
  for (const [alias, full] of Object.entries(policy.aliases)) {
    if (full.split("#")[0] === clean && alias.length <= 8) {
      return alias
    }
  }
  return clean
}

/**
 * Gets the next fallback model in the ladder when a model is rate-limited.
 */
export function getNextFallbackModel(
  currentModel: string,
  ladderKey: string | undefined,
  policy: DelegationPolicy
): string {
  const key = ladderKey ? ladderKey.toLowerCase() : undefined
  const ladder = (key && policy.ladders[key]) || undefined

  if (ladder && ladder.length > 0) {
    const cleanCurrent = currentModel.split("#")[0]
    const idx = ladder.findIndex((m) => m.split("#")[0] === cleanCurrent)
    if (idx !== -1 && idx + 1 < ladder.length) {
      return ladder[idx + 1]
    }
  }

  return policy.default_fallback
}
