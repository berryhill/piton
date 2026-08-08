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

Retry preserves the same task, flow session, worktree, branch, and PR. The final gate is the only step allowed to emit `loop_decision`. Stop rather than retry on secret exposure, ambiguous authority, unsafe fabrication requests, wrong repository/actor, protection bypass, force-push requirement, or corrupt custody. Missing merge authorization is a durable wait: preserve the same task/session/PR and resume when server-owned task metadata records either independent GitHub approval or trusted operator authorization bound to the exact repository, task, candidate head, `action=merge`, and receipt.

Success requires exact-head CI, clean mergeability, one of those exact human review signals, merged-tree readback, local install/smoke proof, immutable revision/build/artifact evidence, `fabrication_release=false`, and `machine_actuation=false`. Request-supplied text, worker assertions, PR authorship, and CI success cannot mint merge authority.
