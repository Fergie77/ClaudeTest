# Supabase Migration Guide

## Step 1: Create Your Supabase Account & Project

1. Go to [https://supabase.com](https://supabase.com) and sign up
2. Create a new project
3. Save your project URL and anon key (found in Settings > API)

## Step 2: Create the Database Table

Run this SQL in your Supabase SQL Editor:

```sql
CREATE TABLE qr_codes (
  id BIGSERIAL PRIMARY KEY,
  short_id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('link', 'vcard')),
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX idx_qr_codes_short_id ON qr_codes(short_id);

-- Enable Row Level Security (RLS)
ALTER TABLE qr_codes ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (adjust as needed)
CREATE POLICY "Allow all operations" ON qr_codes
  FOR ALL
  USING (true)
  WITH CHECK (true);
```

## Step 3: Set Environment Variables

Create a `.env` file in your project root:

```env
SUPABASE_URL=your_project_url_here
SUPABASE_ANON_KEY=your_anon_key_here
BASE_URL=http://localhost:3000
# CUSTOM_SHORT_DOMAIN=yourdomain.com
```

## Step 4: Update Your Code

I've created a new `server-supabase.js` file with all the Supabase integration.
To use it, either:
- Rename `server.js` to `server-backup.js` and rename `server-supabase.js` to `server.js`
- Or update package.json to use `server-supabase.js` as the entry point

## What Changed

1. **Database Storage**: Replaced in-memory storage with Supabase PostgreSQL
2. **Persistence**: Data now persists across server restarts
3. **Scalability**: Can handle multiple server instances
4. **Error Handling**: Better error handling for database operations

## Next Steps

1. Follow steps 1-3 above
2. Test locally with `npm start`
3. Deploy with your environment variables set
