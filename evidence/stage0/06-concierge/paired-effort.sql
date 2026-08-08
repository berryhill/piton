WITH paired AS (
  SELECT org_id, trial_pair_id,
    MAX(CASE WHEN phase='before' THEN reviewer_minutes+release_coordination_minutes END) AS before_effort,
    MAX(CASE WHEN phase='after' THEN reviewer_minutes+release_coordination_minutes END) AS after_effort,
    MAX(CASE WHEN phase='after' THEN piton_authoring_overhead_minutes END) AS after_overhead
  FROM trial_jobs
  WHERE confidence IN ('observed','artifact_reconstructed')
  GROUP BY org_id, trial_pair_id
), scored AS (
  SELECT *, 100.0*(before_effort-after_effort)/NULLIF(before_effort,0) AS reduction_pct,
    CASE WHEN after_overhead >= before_effort-after_effort THEN 1 ELSE 0 END AS erased_gain
  FROM paired WHERE before_effort IS NOT NULL AND after_effort IS NOT NULL
)
SELECT COUNT(*) AS paired_jobs, MEDIAN(reduction_pct) AS median_effort_reduction_pct,
       SUM(erased_gain) AS jobs_with_erased_gain
FROM scored;
