# Cloud-first: use Docker when you do not have Python locally.
.PHONY: docker-build docker-up snapshot ci-local

docker-build:
	docker build -t cmi-notebooks-dashboard:latest .

docker-up:
	docker compose up --build

snapshot:
	mkdir -p artifacts
	python3 scripts/write_pipeline_snapshot.py -o artifacts/pipeline_snapshot.json

ci-local:
	python3 -m compileall -q src && python3 -m pytest -q tests/
