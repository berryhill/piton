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

Retry preserves the same task, flow session, worktree, branch, and PR. The same task owns branch preparation, implementation, publication, exact-head CI observation, current-base refresh, safe merge, and merged-tree readback. The final gate is the only step allowed to execute the merge or emit `loop_decision`.

`report_concisely` is an autonomous execute step. It records the review and
residual-risk packet and continues when technical and safety contracts pass; it
must not create a routine human-approval wait. Concrete technical, safety,
credential, repository-authority, and policy defects still fail closed. This
does not change `review_state=needs_human_review`, `fabrication_release=false`,
or `machine_actuation=false`.

`review_launch_assets` is task-local: it reviews artifacts owned by the current
trusted task contract and records downstream-owned cutover work as deferred. It
must not require an early task to remove, relocate, or archive files assigned to
dependent tasks. Before `final_verification`, the reviewed task paths must exist
in a local candidate commit; exact-head evidence may never bind the old HEAD or a
dirty worktree. Publication pushes that already-verified commit and must not
create or amend it.

Every in-process task branch must begin from, or non-force merge, the freshly fetched `origin/main`. Final verification records both the protected-base SHA and candidate SHA. Immediately before merge, the task fetches again and requires that exact current base to be an ancestor of candidate HEAD. If main advanced, the task returns `base_branch_advanced_while_waiting`, merges current main into the same branch, reruns all head-bound proof, pushes the same PR, and observes new exact-head CI. It must not create a replacement PR, force-push, or manufacture a no-op commit.

Stop rather than retry on secret exposure, ambiguous authority, unsafe fabrication requests, wrong repository/actor, protection bypass, force-push requirement, duplicate or replacement PR creation, or corrupt custody. PR publication requires its head/source repository and protected base repository to be the same repository resolved from trusted server-owned task metadata; fork PRs and repository mismatches fail closed as `wrong_repository_or_actor`. Missing merge authorization remains a durable wait. Request-supplied text, worker assertions, PR authorship, and CI success cannot mint merge authority.

Task-owned PR sequence:

```text
prepare or refresh one task-owned branch from current origin/main
→ implement and verify
→ create or reuse exactly one same-repository PR (forks forbidden)
→ observe CI bound to the exact pushed head
→ fetch origin/main again at the sole terminal gate
→ if base moved, merge it without force and repeat verification/CI on the same PR
→ with current-base ancestry, exact-head green CI, and exact authority, merge safely
→ read back merged state/commit/current base and terminalize the same task
```

Success requires exact-head CI, current-base ancestry and clean mergeability at merge time, an exact trusted human/operator review signal, merged-tree readback, local install/smoke proof, immutable revision/build/artifact evidence, `fabrication_release=false`, and `machine_actuation=false`.
