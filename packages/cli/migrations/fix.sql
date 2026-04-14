-- Ensure schema usage
GRANT USAGE ON SCHEMA api TO anon, authenticated, authenticator;

-- Ensure table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA api TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA api TO authenticated;

-- Ensure sequence permissions (for IDs)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA api TO anon, authenticated;
