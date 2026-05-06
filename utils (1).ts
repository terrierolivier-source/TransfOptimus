-- SUPABASE SCHEMA FOR PILOTAGE APP

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT,
  grade TEXT,
  country TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  cjm NUMERIC DEFAULT 0,
  joining_date DATE,
  leaving_date DATE,
  permissions JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Missions Table
CREATE TABLE IF NOT EXISTS missions (
  id UUID PRIMARY KEY,
  client_id TEXT,
  client_name TEXT,
  name TEXT NOT NULL,
  manager_id TEXT,
  billing_mode TEXT,
  type TEXT,
  typology TEXT,
  country TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT,
  forfait_amount_current_fy NUMERIC DEFAULT 0,
  forfait_amount_next_fy NUMERIC DEFAULT 0,
  success_fees_current_fy NUMERIC DEFAULT 0,
  success_fees_next_fy NUMERIC DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  billing_overrides JSONB DEFAULT '{}'::jsonb,
  internal_staffing JSONB DEFAULT '[]'::jsonb,
  freelance_staffing JSONB DEFAULT '[]'::jsonb,
  subcontractor_staffing JSONB DEFAULT '[]'::jsonb,
  customer_po TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Planning Table
CREATE TABLE IF NOT EXISTS planning (
  id UUID PRIMARY KEY,
  mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  external_name TEXT,
  external_type TEXT,
  week_start DATE NOT NULL,
  percentage NUMERIC DEFAULT 0,
  tjm NUMERIC,
  cost_day NUMERIC,
  sentiment TEXT,
  weather TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Timesheets Table
CREATE TABLE IF NOT EXISTS timesheets (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  day_index INTEGER NOT NULL,
  percentage NUMERIC NOT NULL,
  status TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Config Table (KeyValue store)
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Budget Data Table
CREATE TABLE IF NOT EXISTS budget_data (
  fy TEXT PRIMARY KEY,
  manual_expenses JSONB DEFAULT '{}'::jsonb,
  budget_families JSONB DEFAULT '{}'::jsonb,
  budget_values JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (Row Level Security) - Simplified for Open Mode
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_data ENABLE ROW LEVEL SECURITY;

-- Create Policies for Anonymous Access (Open Mode)
-- In a real production app, we would restrict this by auth.uid()
CREATE POLICY "Allow all select" ON users FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON users FOR UPDATE USING (true);

CREATE POLICY "Allow all select" ON missions FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON missions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON missions FOR UPDATE USING (true);
CREATE POLICY "Allow all delete" ON missions FOR DELETE USING (true);

CREATE POLICY "Allow all select" ON planning FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON planning FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON planning FOR UPDATE USING (true);
CREATE POLICY "Allow all delete" ON planning FOR DELETE USING (true);

CREATE POLICY "Allow all select" ON timesheets FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON timesheets FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON timesheets FOR UPDATE USING (true);
CREATE POLICY "Allow all delete" ON timesheets FOR DELETE USING (true);

CREATE POLICY "Allow all select" ON config FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON config FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON config FOR UPDATE USING (true);

CREATE POLICY "Allow all select" ON budget_data FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON budget_data FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON budget_data FOR UPDATE USING (true);
