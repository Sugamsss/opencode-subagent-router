import { describe, it, expect } from "bun:test"
import { isRateLimitError } from "./router"
import { DEFAULT_POLICY, resolveModel } from "./policy"

describe("Subagent Router Unit Tests", () => {
  it("identifies rate limit errors accurately", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true)
    expect(isRateLimitError({ statusCode: 429 })).toBe(true)
    expect(isRateLimitError(new Error("HTTP 429: Too Many Requests"))).toBe(true)
    expect(isRateLimitError(new Error("rate limit reached for tier"))).toBe(true)
    expect(isRateLimitError(new Error("Resource has been exhausted (quota exceeded)"))).toBe(true)
    expect(
      isRateLimitError({ status: 503, message: "[codex/gpt-6-luna] [429]: The usage limit has been reached" })
    ).toBe(true)
  })

  it("does not flag non-rate-limit errors as rate limits", () => {
    expect(isRateLimitError(null)).toBe(false)
    expect(isRateLimitError(undefined)).toBe(false)
    expect(isRateLimitError({ status: 500 })).toBe(false)
    expect(isRateLimitError(new Error("SyntaxError in user code"))).toBe(false)
    expect(isRateLimitError(new Error("Unknown agent: Foo"))).toBe(false)
    expect(isRateLimitError(new Error("Permission denied: shell"))).toBe(false)
  })

  it("resolves model alias to full 9Router slugs", () => {
    expect(resolveModel("sol", DEFAULT_POLICY)).toBe("9router/cx/gpt-6.1-sol")
    expect(resolveModel("luna", DEFAULT_POLICY)).toBe("9router/cx/gpt-6-luna")
    expect(resolveModel("gemini", DEFAULT_POLICY)).toBe("9router/ag/gemini-3.8-flash-tiered")
    expect(resolveModel("opus", DEFAULT_POLICY)).toBe("9router/cc/claude-opus-5-5")
  })
})
