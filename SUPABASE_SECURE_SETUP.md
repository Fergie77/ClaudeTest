# 🔒 Secure Supabase Setup Guide

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

-- SECURE: Create restrictive policy (requires API key authentication)
-- This policy blocks direct database access and requires server-side authentication
CREATE POLICY "Block all direct access" ON qr_codes
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Note: The server uses the service role key for authenticated operations
-- Direct client access is blocked for security
```

## Step 3: Set Environment Variables

Create a `.env` file in your project root:

```env
SUPABASE_URL=your_project_url_here
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
BASE_URL=http://localhost:3000
NODE_ENV=development
API_KEY=your-secure-api-key-here
```

## Step 4: Generate a Secure API Key

Generate a strong API key for authentication:

```bash
# Generate a secure random API key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Security Features Implemented

✅ **API Key Authentication** - All API endpoints require valid API key
✅ **Enhanced URL Validation** - Blocks dangerous URL schemes
✅ **Input Sanitization** - All user inputs are sanitized
✅ **Rate Limiting** - Stricter limits in production
✅ **Secure Headers** - Helmet.js with enhanced CSP
✅ **Restrictive RLS** - Blocks direct database access
✅ **Error Handling** - No information disclosure
✅ **Request Size Limits** - Prevents large payload attacks

## Production Deployment

Make sure to set these environment variables in your deployment platform:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
API_KEY=your-secure-api-key-here
BASE_URL=https://your-domain.com
NODE_ENV=production
```

## API Usage

All API requests now require the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key" https://your-domain.com/api/qr
```

## Security Notes

- The API key should be kept secret and rotated regularly
- Use HTTPS in production
- Monitor API usage for suspicious activity
- Consider implementing additional authentication methods for production use
