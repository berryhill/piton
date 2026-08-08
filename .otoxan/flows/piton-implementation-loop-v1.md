# Piton implementation loop v1

Consulted live source loops:

- Xander: `aegis_implementation_loop` v5, active.
- Valeria: `azueroland_implementation_loop` v1, active.
- A2A consultation: `ags_a6eda0d79de7`.

Piton copies their generic engineering continuity, not their product policy.

```text
one TaskQueue task
one task-flow session
one registered task-owned worktree
one deterministic feature branch
one pull request
bounded retries
one merge-or-retry gate
```

Ordered steps:

```text
prepare_feature_worktree → understand → inspect → trace → implement_minimally → test_the_behavior → diagnose_and_repeat → review_security_boundaries → review_launch_assets → final_verification → report_concisely → push_feature_branch → watch_cicd → merge_on_success_or_loop
```

Loop contract:

```yaml
loop_kind: bounded_training_attempts
max_attempts: 10
restart_step: implement_minimally
gate_step: merge_on_success_or_loop
inject_previous_errors: true
error_packet_required_for_retry: true
clean_reset_required_between_attempts: false
```

Retry preserves the same task, flow session, worktree, branch, and PR. The final gate is the only step allowed to emit `loop_decision`, but queue workers do not execute merge commands. Once one exact-head PR is open, non-draft, green, and otherwise reviewable, the task blocks with `pull_request_ready_for_operator`. Pull requests are merged by the interactive operator PR manager, serialized by `(repository, base_branch)` so only one PR can refresh against and merge into a base branch at a time.

Base movement while a PR waits is `base_branch_advanced_while_waiting`, not a product-code failure. Preserve the same branch and PR, do not generate no-op commits, and do not restart implementation merely to chase a moving base. The interactive PR manager refreshes, verifies, pushes, observes exact-head CI, and merges one PR before advancing to the next. A task reaches terminal success only after trusted remote readback proves its PR merged and the merged tree contains the reviewed candidate.

Stop rather than retry on secret exposure, ambiguous authority, unsafe fabrication requests, wrong repository/actor, protection bypass, force-push requirement, duplicate or replacement PR creation, or corrupt custody. Missing merge authorization remains a durable wait. Request-supplied text, worker assertions, PR authorship, and CI success cannot mint merge authority.

Interactive PR-manager sequence:

```text
inventory open PRs and task/dependency ownership
→ select exactly one PR for repository/base branch
→ refresh that same branch from current origin/main without force
→ resolve only owned conflicts and rerun full verification
→ push the same branch and require PR head == remote head == local head
→ observe exact-head CI and review/ruleset state
→ merge without bypass and read back merged state/commit/base
→ reconcile the owning task/flow
→ repeat for the next PR
```

Success requires exact-head CI, clean mergeability at merge time, an exact trusted human/operator review signal, merged-tree readback, local install/smoke proof, immutable revision/build/artifact evidence, `fabrication_release=false`, and `machine_actuation=false`.
