.PHONY: dev start build test clean docker-build docker-run help prewarm

# Default target
help:
	@echo "Available targets:"
	@echo "  dev           - Start development server with hot reload"
	@echo "  start         - Start production server"
	@echo "  build         - Build TypeScript"
	@echo "  test          - Run tests"
	@echo "  clean         - Clean build artifacts"
	@echo "  docker-build  - Build Docker image"
	@echo "  docker-run    - Run Docker container"
	@echo "  langgraph     - Run LangGraph dev server"
	@echo "  prewarm       - Prewarm Daytona sandboxes (pool by labels)"

dev:
	bun run dev

start:
	bun run start

build:
	bun build src/index.ts

test:
	bun test

clean:
	rm -rf dist node_modules .turbo

docker-build:
	docker build -t bullhorse:latest .

docker-run:
	docker run -p 7860:7860 --env-file .env bullhorse:latest

langgraph:
	langgraph dev

prewarm:
	bun run prewarm
