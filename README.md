# Bullhorse

Agentic coder + deterministic linter pipeline with LangGraph. Deploy as a Telegram bot, HTTP API, or to LangGraph Cloud.

## Quick Start

```bash
# Install dependencies
bun install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
# TELEGRAM_BOT_TOKEN=your_token_here
# PORT=7860

# Start the server
bun run start
```

Server runs on `http://127.0.0.1:7860`

## Architecture

- Reference: [`docs/architecture-summary.md`](docs/architecture-summary.md)

## Project Structure

```text
src/
├── server.ts              # Agent graph entry point and runtime execution
├── webapp.ts              # Hono webhook server
├── index.ts               # Entry point
│
├── harness/               # Agent harness abstraction + provider adapters (OpenCode/DeepAgents)
├── tools/                 # Reusable model tools
│
├── middleware/            # LangGraph middleware (future)
│
├── nodes/                 # Graph nodes
│   ├── coder.ts           # Agentic LLM node
│   └── linter.ts          # Deterministic lint node
│
├── utils/                 # Utilities
│   ├── config.ts          # Environment config
│   └── state.ts           # Graph state definition
│
└── integrations/          # External integrations
    └── telegram/          # Telegram webhook handler

tests/                     # Test files
static/                    # Static assets

langgraph.json             # LangGraph config
package.json              # Dependencies
Dockerfile                # Docker image
Makefile                  # Common tasks
```

## API Endpoints

| Endpoint | Method | Description |
| :-------- | :----- | :---------- |
| `/health` | GET | Health check |
| `/info` | GET | Graph info |
| `/run` | POST | Run agent with `{ "input": "your text" }` |
| `/v1/chat/completions` | POST | OpenAI-compatible chat endpoint |
| `/webhook/telegram` | POST | Telegram webhook |
| `/webhook/github` | POST | GitHub webhook |

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
| :-------- | :------- | :------ | :---------- |
| `TELEGRAM_BOT_TOKEN` | Yes | - | Bot token from @BotFather |
| `PORT` | No | 7860 | Server port |
| `GITHUB_TOKEN` | No | - | GitHub token for repo operations |
| `GITHUB_DEFAULT_OWNER` | No | - | Default GitHub owner/org |
| `WEBHOOK_URL` | No | - | Public URL for webhooks |
| `GITHUB_WEBHOOK_SECRET` | No | - | GitHub webhook secret |

### Repo Memory (Supabase)

Bullhorse can persist repo-scoped “memories” after each agent turn (runs, deterministic results, and optional semantic chunks).

- **Schema**: apply `supabase/migrations/20260327000000_repo_memory.sql` to your Supabase Postgres project.
- **Docs**: see `docs/repo-memory.md` for implementation details and schema notes.
- **Env** (in `.env`):
  - `SUPABASE_REPO_MEMORY_ENABLED=true`
  - `SUPABASE_URL=...`
  - `SUPABASE_SERVICE_ROLE_KEY=...`
  - Optional: `SUPABASE_REPO_MEMORY_VECTOR_CHUNKS=true` (writes `repo_memory_chunks` rows; embeddings are not generated yet)

### LangGraph Deployment

```bash
langgraph dev
```

See [langgraph.json](langgraph.json) for configuration.

## Docker

```bash
# Build
make docker-build

# Run
make docker-run

# Or manually
docker run -p 7860:7860 --env-file .env bullhorse:latest
```

## Development

```bash
# Development with hot reload
bun run dev

# Run tests
bun test

# Clean
make clean
```

## Customization

- **Add nodes**: Create new files in `src/nodes/`
- **Add tools**: Create new files in `src/tools/`
- **Modify graph**: Edit `src/server.ts`
- **Add webhooks**: Add handlers in `src/webapp.ts`

## License

MIT
