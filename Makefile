# VisionMitra developer shortcuts.
# Run `make` (or `make help`) to list available targets.

.DEFAULT_GOAL := help
.PHONY: help install install-backend install-frontend backend frontend \
        test lint lint-backend lint-frontend format smoke clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: install-backend install-frontend ## Install backend and frontend dependencies

install-backend: ## Install the backend Python dependencies
	cd backend && pip install -r requirements-dev.txt

install-frontend: ## Install the frontend Node dependencies
	cd frontend && yarn install

backend: ## Run the backend API with autoreload (port 8001)
	cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

frontend: ## Start the Expo dev server
	cd frontend && npx expo start

test: ## Run the backend test suite
	pytest

lint: lint-backend lint-frontend ## Lint backend and frontend

lint-backend: ## Lint and format-check the Python code
	ruff check backend tests
	ruff format --check backend tests

lint-frontend: ## Type-check and lint the frontend
	cd frontend && yarn typecheck && yarn lint

format: ## Auto-format the Python code
	ruff format backend tests
	ruff check --fix backend tests

smoke: ## Run the journey planner smoke script (needs network)
	cd frontend && npx tsx scripts/journeyPlanner.smoke.ts

clean: ## Remove local caches and build artifacts
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	rm -rf .pytest_cache .ruff_cache
