export const METRICS_TEMPLATE = `You are being activated by the /metrics command to present Weave analytics data to the user.

## Your Mission
Present the injected metrics data in a clear, readable format. The data has already been loaded and formatted by the command hook — simply relay it to the user.

## Instructions

1. **Read the injected context below** — it contains pre-formatted metrics markdown
2. **Present it to the user** as-is — do NOT re-fetch or recalculate anything
3. **Answer follow-up questions** about the data if the user asks
4. If the data indicates analytics is disabled or no data exists, relay that message directly`
