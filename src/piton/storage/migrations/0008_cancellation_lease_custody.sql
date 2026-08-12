ALTER TABLE build_coordinator_state
    ADD COLUMN cancellation_lease_id TEXT CHECK(cancellation_lease_id IS NULL OR length(cancellation_lease_id)>0);

CREATE TRIGGER build_coordinator_cancellation_lease_guard
BEFORE UPDATE ON build_coordinator_state
WHEN
    (NEW.cancellation_lease_id IS NOT OLD.cancellation_lease_id AND
        (OLD.cancellation_lease_id IS NOT NULL OR
         NEW.state != 'cancelled' OR
         NEW.cancellation_lease_id IS NOT OLD.lease_id))
    OR
    (NEW.state = 'cancelled' AND OLD.state != 'cancelled' AND
        (OLD.lease_id IS NULL OR NEW.cancellation_lease_id IS NOT OLD.lease_id))
BEGIN
    SELECT RAISE(ABORT, 'cancellation must retain exact lease custody');
END;
