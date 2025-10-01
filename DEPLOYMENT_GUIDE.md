# 🚀 QR Code Manager - Deployment Guide

## ✅ Rate Limiting Fixed!

Your server now has **environment-aware rate limiting**:

### Development (Local)
- **General requests**: 1000 per 15 minutes
- **API requests**: 200 per 15 minutes

### Production (Deployed)
- **General requests**: 200 per 15 minutes  
- **API requests**: 50 per 15 minutes

## 🎯 Deployment Options

### Option 1: Render (Recommended)
Your `render.yaml` is already configured! Just deploy:

1. **Push to GitHub** (if not already done)
2. **Connect to Render**:
   - Go to [render.com](https://render.com)
   - Connect your GitHub repo
   - Render will auto-detect the `render.yaml` config

3. **Set Environment Variables** in Render dashboard:
   ```
   SUPABASE_URL=your-supabase-url
   SUPABASE_ANON_KEY=your-supabase-anon-key
   NODE_ENV=production
   BASE_URL=https://your-app-name.onrender.com
   ```

### Option 2: Fly.io
1. **Install Fly CLI**: `curl -L https://fly.io/install.sh | sh`
2. **Login**: `fly auth login`
3. **Deploy**: `fly deploy`
4. **Set secrets**:
   ```bash
   fly secrets set SUPABASE_URL=your-supabase-url
   fly secrets set SUPABASE_ANON_KEY=your-supabase-anon-key
   fly secrets set NODE_ENV=production
   ```

### Option 3: Railway
1. **Connect GitHub** to Railway
2. **Set environment variables** in Railway dashboard
3. **Deploy automatically**

### Option 4: Netlify Functions
Your `netlify.toml` is configured for serverless functions.

## 🔧 Environment Variables Required

Make sure these are set in your deployment platform:

```bash
# Required
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# Optional (auto-detected)
NODE_ENV=production
BASE_URL=https://your-domain.com
PORT=3000
```

## 🎉 What's Fixed

✅ **Environment-aware rate limiting** - Stricter limits in production  
✅ **Health check endpoint** - Shows environment status  
✅ **Proper error handling** - Better user experience  
✅ **Security headers** - Helmet.js protection  
✅ **Clean HTML structure** - No more linter errors  

## 🧪 Testing Your Deployment

1. **Health Check**: `GET /health`
   ```json
   {
     "status": "ok",
     "timestamp": "2025-10-01T15:34:28.532Z",
     "environment": "production"
   }
   ```

2. **API Test**: `GET /api/qr`
3. **QR Redirect**: `GET /q/{shortId}`

## 🚨 If You Still Get 429 Errors

The new rate limits should be much more reasonable:
- **200 requests per 15 minutes** (general)
- **50 API requests per 15 minutes**

If you still hit limits, you can temporarily increase them by modifying the server.js file:

```javascript
// For testing, you can increase these values
max: process.env.NODE_ENV === "production" ? 500 : 1000, // General
max: process.env.NODE_ENV === "production" ? 100 : 200,  // API
```

## 📝 Next Steps

1. **Deploy to your chosen platform**
2. **Test the health endpoint** to confirm environment
3. **Test QR code creation and management**
4. **Monitor for any remaining rate limit issues**

Your QR Code Manager is now production-ready! 🎉
