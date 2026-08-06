# Piton

Piton is the local-first Mechanical CAD MVI.

Current repository state: foundation scaffold only. It is not a production CAD system and it does not authorize fabrication.

```text
review_state = needs_human_review
fabrication_release = false
machine_actuation = false
```

## First product slice

One source-native Python/build123d Part, one bounded parameter mutation, one pinned exact-geometry worker, three to five predeclared checks, revision-pinned review artifacts, human review, and an optional visibly unreleased draft export.

## Repository verification

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
python3 scripts/verify_repo.py
```

The GitHub remote is attached as `origin` at `https://github.com/berryhill/piton.git`. This repository remains review-only: no deployment, production approval, fabrication release, or machine actuation is authorized.
