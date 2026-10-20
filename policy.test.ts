import { describe, it, expect } from "bun:test"
import {
  DEFAULT_POLICY,
  loadPolicy,
  resolveModel,
  toModelRef,
  getNextFallbackModel,
  validateDelegation,
  getShortAlias,
  parseSubagentTarget,
} from "./policy"

describe("Subagent Router Policy & Validation", () => {
  it("resolves model aliases cleanly to 9Router slugs", () => {
    expect(resolveModel("gemini", DEFAULT_POLICY)).toBe("9router/ag/gemini-3.8-flash-tiered")
    expect(resolveModel("sol", DEFAULT_POLICY)).toBe("9router/cx/gpt-6.1-sol")
    expect(resolveModel("luna", DEFAULT_POLICY)).toBe("9router/cx/gpt-6-luna")
    expect(resolveModel("opus", DEFAULT_POLICY)).toBe("9router/cc/claude-opus-5-5")
  })

  it("auto-routes from role defaults when model parameter is omitted", () => {
    const resTechLead = validateDelegation({ agent: "Tech Lead" }, DEFAULT_POLICY)
    expect(resTechLead.valid).toBe(true)
    expect(resTechLead.resolvedModel).toBe("9router/cx/gpt-6.1-sol")
    expect(resTechLead.tier).toBe("planning")

    const resBackend = validateDelegation({ agent: "Backend Guy" }, DEFAULT_POLICY)
    expect(resBackend.valid).toBe(true)
    expect(resBackend.resolvedModel).toBe("9router/cx/gpt-6-luna")
    expect(resBackend.tier).toBe("implementation")

    const resDesign = validateDelegation({ agent: "Design Lead" }, DEFAULT_POLICY)
    expect(resDesign.valid).toBe(true)
    expect(resDesign.resolvedModel).toBe("9router/cc/claude-opus-5-5")
    expect(resDesign.tier).toBe("taste")

    const resResearch = validateDelegation({ agent: "Researcher" }, DEFAULT_POLICY)
    expect(resResearch.valid).toBe(true)
    expect(resResearch.resolvedModel).toBe("9router/ag/gemini-3.8-flash-tiered")
    expect(resResearch.tier).toBe("research")
  })

  it("preserves explicit model selection over role defaults", () => {
    const res = validateDelegation({ agent: "Tech Lead", model: "luna" }, DEFAULT_POLICY)
    expect(res.valid).toBe(true)
    expect(res.resolvedModel).toBe("9router/cx/gpt-6-luna")
  })

  it("redirects blacklisted Fable model to fallback", () => {
    const res = validateDelegation({ model: "fable", agent: "Tech Lead" }, DEFAULT_POLICY)
    expect(res.valid).toBe(true)
    expect(res.resolvedModel).toBe("9router/cx/gpt-6.1-sol")
    expect(res.warning).toContain("blacklisted")
  })

  it("steps down fallback ladders accurately", () => {
    expect(getNextFallbackModel("9router/cx/gpt-6.1-sol", "planning", DEFAULT_POLICY)).toBe(
      "9router/ag/gemini-3.8-flash-tiered"
    )
    // Implementation tries gpt-reserve before burning a cross-pool hop. gpt-reserve is
    // OpenAI's "Luna Reserve": same Luna-class model, but a SEPARATE allowance, so it
    // survives ordinary Codex quota exhaustion (verified 2026-10-19 -- the two models
    // interleaved and every call succeeded). Coverage is narrow though: Reserve is
    // Plus/Pro personal only, so only some Codex accounts can serve it.
    expect(getNextFallbackModel("9router/cx/gpt-6-luna", "implementation", DEFAULT_POLICY)).toBe(
      "9router/cx/gpt-reserve"
    )
    expect(getNextFallbackModel("9router/cx/gpt-reserve", "implementation", DEFAULT_POLICY)).toBe(
      "9router/ag/gemini-3.8-flash-tiered"
    )
    expect(getNextFallbackModel("9router/cc/claude-opus-5-5", "taste", DEFAULT_POLICY)).toBe(
      "9router/ag/gemini-3.8-flash-tiered"
    )
  })

  it("falls through to default_fallback after the last rung", () => {
    // Every ladder ends at a rung whose next step is the global fallback, not a dead end.
    for (const [tier, ladder] of Object.entries(DEFAULT_POLICY.ladders)) {
      const last = ladder[ladder.length - 1]!;
      const next = getNextFallbackModel(last, tier, DEFAULT_POLICY);
      expect(next).toBe(DEFAULT_POLICY.default_fallback);
    }
  })

  it("resolves friendly short aliases", () => {
    expect(getShortAlias("9router/cx/gpt-6.1-sol", DEFAULT_POLICY)).toBe("sol")
    expect(getShortAlias("9router/cx/gpt-6-luna", DEFAULT_POLICY)).toBe("luna")
    expect(getShortAlias("9router/ag/gemini-3.8-flash-tiered", DEFAULT_POLICY)).toBe("gemini")
    expect(getShortAlias("9router/cc/claude-opus-5-5", DEFAULT_POLICY)).toBe("opus")
    expect(getShortAlias("9router/gcli/grok-4.7-high", DEFAULT_POLICY)).toBe("grok")
    expect(getShortAlias("9router/cx/gpt-reserve", DEFAULT_POLICY)).toBe("reserve")
  })

  it("parses center-dot separated subagent targets", () => {
    const res = parseSubagentTarget({
      subagent: "Researcher · gemini · End to end test",
      task: { instructions: "Check 10 models" },
    })
    expect(res.agent).toBe("Researcher")
    expect(res.model).toBe("gemini")
    expect(res.description).toBe("End to end test")
    expect(res.task).toBe("Check 10 models")
  })
})
