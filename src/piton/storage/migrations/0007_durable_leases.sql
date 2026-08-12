CREATE TRIGGER build_coordinator_fence_monotonic
BEFORE UPDATE ON build_coordinator_state
WHEN NEW.fence < OLD.fence OR NEW.generation < OLD.generation
BEGIN
    SELECT RAISE(ABORT, 'coordinator generation and fence are monotonic');
END;

CREATE TRIGGER build_coordinator_lease_transition_guard
BEFORE UPDATE ON build_coordinator_state
WHEN
    (NEW.lease_id IS OLD.lease_id AND
        (NEW.generation != OLD.generation OR NEW.fence != OLD.fence))
    OR
    (NEW.lease_id IS NOT NULL AND NEW.lease_id IS NOT OLD.lease_id AND
        (NEW.generation != OLD.generation + 1 OR NEW.fence != OLD.fence + 1))
    OR
    (NEW.lease_id IS NULL AND OLD.lease_id IS NOT NULL AND
        (NEW.generation != OLD.generation OR NEW.fence != OLD.fence))
BEGIN
    SELECT RAISE(ABORT, 'lease replacement must advance generation and fence exactly once');
END;
