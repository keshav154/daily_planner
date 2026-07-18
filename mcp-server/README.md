# Kortex MCP Server

Exposes your Kortex daily-planner to any MCP-capable coding agent (Claude Code, Cursor, Cline, Windsurf, …) so you can **add and track tasks, and recall past work, without leaving your editor.**

It's a thin stdio adapter over Kortex's existing API-key integration API — each tool just calls one endpoint with your personal API key.

## Tools

| Tool | What it does |
|------|--------------|
| `add_task` | Add a task — natural language (`text`) or structured (`title`, `priority`, `dueDate`, `estimatedTime`, `category`) |
| `list_today_tasks` | Get today's active tasks + goals (what's on your plate now) |
| `complete_task` | Mark a task done, with optional `resolution` and `actualTime` |
| `remember_note` | Save a durable note/fact to your second brain |
| `search_history` | Recall what you did before — "what did I do about the EPS deployment?" |
| `smart_capture` | Free-form request handled by the full Kortex agent (creates tasks / remembers / answers) |

## Prerequisite (check this first)

The server runs **locally inside your coding agent** and calls the hosted Kortex API over HTTPS. It only works if the machine can reach the public internet at your Kortex backend URL. On a locked-down corporate network that blocks outbound egress, it won't connect — confirm you can `curl https://daily-planner-00g2.onrender.com/health` from that machine.

> The `search_history` tool needs the backend that includes the `/api/integration/recall` endpoint deployed. `add_task`, `complete_task`, etc. work against the current production API today.

## Setup

```bash
cd mcp-server
npm install
npm run build
```

Get your API key from the Kortex app sidebar → **🔑 Copy API Key**.

## Configure your agent

Add this to your agent's MCP config (path is generic across Claude Code, Cursor, Cline, Windsurf):

```json
{
  "mcpServers": {
    "kortex": {
      "command": "node",
      "args": ["C:/Users/Keshav/Documents/daily-planner/mcp-server/dist/index.js"],
      "env": {
        "KORTEX_API_KEY": "<paste your key here>",
        "KORTEX_BASE_URL": "https://daily-planner-00g2.onrender.com/api"
      }
    }
  }
}
```

**Claude Code** one-liner (run from anywhere):

```bash
claude mcp add kortex \
  --env KORTEX_API_KEY=<your-key> \
  --env KORTEX_BASE_URL=https://daily-planner-00g2.onrender.com/api \
  -- node C:/Users/Keshav/Documents/daily-planner/mcp-server/dist/index.js
```

`KORTEX_BASE_URL` is optional (defaults to the hosted backend). Point it at `http://localhost:5000/api` to test against a local backend.

## Security

`KORTEX_API_KEY` is your account credential. It lives only in your local agent config — **never commit it**. Anyone with the key has full API access to your Kortex account; rotate it from the app if it leaks.

## Usage examples

Once configured, just talk to your agent:

- "Add a task to track the cusdemo ECM deploy, high priority."
- "What's on my plate today?"
- "Mark the EPS helm chart task done — resolved by merging ASCO-33874."
- "What did I do about IDcloud GIDV last week?"
