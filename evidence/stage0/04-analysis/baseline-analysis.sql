CREATE TABLE trial_jobs(
  job_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('baseline','before','after')),
  reviewer_minutes REAL NOT NULL CHECK(reviewer_minutes >= 0),
  release_coordination_minutes REAL NOT NULL CHECK(release_coordination_minutes >= 0),
  piton_authoring_overhead_minutes REAL NOT NULL CHECK(piton_authoring_overhead_minutes >= 0),
  clarification_loops INTEGER NOT NULL CHECK(clarification_loops >= 0),
  rebuild_count INTEGER NOT NULL CHECK(rebuild_count >= 0),
  handoff_failures INTEGER NOT NULL CHECK(handoff_failures >= 0),
  escaped_change INTEGER NOT NULL CHECK(escaped_change IN (0,1)),
  confidence TEXT NOT NULL CHECK(confidence IN ('observed','artifact_reconstructed','self_reported'))
);
SELECT confidence, COUNT(*) AS jobs,
       MEDIAN(reviewer_minutes + release_coordination_minutes) AS median_review_release_minutes
FROM trial_jobs
GROUP BY confidence
ORDER BY confidence;
