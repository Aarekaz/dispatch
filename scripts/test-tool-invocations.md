# Tool Invocation Testing Checklist

Per Composio's field guide: "Add automated tests & evals before every
change — know if you helped or hurt."

Run these tests after any change to:
- Agent system prompt (AGENTS.md template)
- Composio toolkit configuration
- Tool descriptions or examples
- OpenCode config (buildOpenCodeConfig)

## Manual test suite

### Setup
1. Have an agent (e.g., Alex) with these toolkits enabled:
   hackernews, linear, slack, composio_search
2. Open the agent's web chat

### Test 1: Tool discovery
**Prompt**: "What tools do you have access to?"
**Expected**: Agent lists its toolkits with descriptions, NOT raw slugs.
**Fail if**: Agent says "I don't have any tools" or lists wrong toolkits.

### Test 2: HackerNews search
**Prompt**: "Search Hacker News for the top AI stories today"
**Expected**: Agent calls HACKERNEWS_GET_TOP_STORIES, returns real results.
**Fail if**: Agent says it can't access HN, or returns hallucinated results.

### Test 3: Linear issue search
**Prompt**: "Search for open issues in Linear about billing"
**Expected**: Agent calls LINEAR_SEARCH_ISSUES, returns real results.
**Fail if**: Agent tries to use a non-existent tool, or errors out.

### Test 4: Slack — NOT calling tools to reply
**Prompt** (via Slack @mention): "What's the latest in #general?"
**Expected**: Agent uses SLACK_FETCH_CONVERSATION_HISTORY to READ, then
writes its answer as plain text (auto-delivered by Chat SDK).
**Fail if**: Agent tries to call SLACK_SEND_MESSAGE to "reply".

### Test 5: Tool narrowing
1. Create an automation with only `hackernews` in allowedToolkits
2. Run with prompt: "Search Linear for billing issues"
**Expected**: Agent says it can't access Linear (not in its toolkit list).
**Fail if**: Agent somehow uses Linear tools despite narrowing.

### Test 6: Automation with Slack delivery
1. Create automation with delivery = "Also post to Slack"
2. Instructions: "Summarize the top 3 HN stories about AI"
3. Run it
**Expected**: Agent produces content, it appears both as a web session
AND as a Slack message. Agent does NOT try to call Slack posting tools.
**Fail if**: Agent tries to use Slack tools, or Slack delivery doesn't fire.

### Test 7: Memory persistence
1. Chat: "My favorite language is Rust. Remember that."
2. Start a NEW session
3. Chat: "What's my favorite programming language?"
**Expected**: Agent reads ~/agent/memories/MEMORY.md and knows it's Rust.
**Fail if**: Agent doesn't remember, or says it doesn't have memory.

## Monitoring verification

After running the tests, check terminal logs for:
```
[tool-metric] tool=composio_HACKERNEWS_GET_TOP_STORIES status=ok agent=Alex
[tool-metric] tool=composio_LINEAR_SEARCH_ISSUES status=ok agent=Alex
```

If you see `status=fail` or `status=error`, investigate:
1. Is the toolkit connected? (check Composio connection status)
2. Is the tool name correct? (check COMPOSIO_SEARCH_TOOLS output)
3. Are parameters valid? (check COMPOSIO_GET_TOOL_SCHEMAS output)

## Automated test (future)

TODO: Create a script that:
1. Creates a test automation
2. Runs it with each test prompt
3. Checks the session output for expected patterns
4. Reports pass/fail per test
5. Runs in CI before deploys
