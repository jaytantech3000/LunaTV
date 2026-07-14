ALTER TABLE profile_sync_state ADD COLUMN last_sync_at_ms INTEGER;
ALTER TABLE profile_sync_state ADD COLUMN last_sync_error TEXT;
ALTER TABLE profile_sync_state ADD COLUMN next_attempt_at_ms INTEGER;
ALTER TABLE profile_sync_state ADD COLUMN auth_blocked_at_ms INTEGER;
ALTER TABLE profile_sync_state ADD COLUMN auth_blocked_error TEXT;