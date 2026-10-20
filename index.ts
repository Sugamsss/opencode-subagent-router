import { loadPolicy } from "./policy"
import { setupRouter } from "./router"

export default {
  id: "opencode.subagent-router",
  setup: async (ctx: any) => {
    const policy = loadPolicy()
    setupRouter(ctx, policy)
  },
}
