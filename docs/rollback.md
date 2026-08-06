# Piton rollback and restore-forward policy

Accepted design history is immutable. Product revisions use restore-forward: create a new revision reproducing prior intent and bind the reason/evidence. Git rollback follows repository policy and must not rewrite protected history. Failed builds and candidates never replace last-good. Release is not implemented in Stage 1.
