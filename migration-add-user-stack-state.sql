-- Run this in the Supabase SQL editor for existing projects.

CREATE TABLE IF NOT EXISTS user_stack_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stacks JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE user_stack_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_stack_state'
      AND policyname = 'Users can read their own stack state'
  ) THEN
    CREATE POLICY "Users can read their own stack state"
      ON user_stack_state
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_stack_state'
      AND policyname = 'Users can insert their own stack state'
  ) THEN
    CREATE POLICY "Users can insert their own stack state"
      ON user_stack_state
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_stack_state'
      AND policyname = 'Users can update their own stack state'
  ) THEN
    CREATE POLICY "Users can update their own stack state"
      ON user_stack_state
      FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
