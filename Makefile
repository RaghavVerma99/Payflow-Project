.PHONY: install seed run worker test lint fmt clean

install:
	uv sync

seed:
	uv run python -m payflow.seed

run:
	uv run uvicorn payflow.main:create_app --factory --reload

worker:
	uv run python -m payflow.worker

test:
	uv run pytest -q

lint:
	uv run ruff check .

fmt:
	uv run ruff format .

clean:
	rm -f payflow.db payflow.db-shm payflow.db-wal
	rm -rf .pytest_cache .ruff_cache __pycache__
