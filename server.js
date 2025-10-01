import express from 'express';
import QRCode from 'qrcode';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import validator from 'validator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// In-memory storage for free tier (replaces SQLite)
let qrCodes = [];
let nextId = 1;

// Security middleware with adjusted CSP for inline scripts
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts for our landing pages
      scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs for API
  message: 'Too many API requests from this IP, please try again later.',
});

app.use(limiter);
app.use('/api', strictLimiter);

// Request size limit
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// Use environment variable for BASE_URL or construct from request
const getBaseUrl = (req) => {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers.host;
  return `${protocol}://${host}`;
};

// Input validation functions
function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('URL is required and must be a string');
  }
  
  // Block dangerous protocols and schemes
  const dangerousPatterns = [
    /^javascript:/i,
    /^data:/i,
    /^vbscript:/i,
    /^file:/i,
    /^ftp:/i,
    /^mailto:/i,
    /^tel:/i,
    /^sms:/i,
    /^chrome:/i,
    /^chrome-extension:/i,
    /^moz-extension:/i,
    /^about:/i,
    /^blob:/i
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(url.trim())) {
      throw new Error('Dangerous URL scheme not allowed');
    }
  }
  
  // Check if it's a valid HTTP/HTTPS URL
  if (!validator.isURL(url, { 
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true
  })) {
    throw new Error('Invalid URL format - only HTTP and HTTPS URLs are allowed');
  }
  
  // Additional security checks
  const parsed = new URL(url);
  
  // Block localhost/private IPs (optional - remove if you want to allow them)
  if (parsed.hostname === 'localhost' || 
      parsed.hostname.startsWith('127.') ||
      parsed.hostname.startsWith('192.168.') ||
      parsed.hostname.startsWith('10.') ||
      parsed.hostname.startsWith('172.')) {
    throw new Error('Local/private URLs are not allowed');
  }
  
  return url.trim();
}

function validateVCardData(data) {
  const required = ['firstName', 'lastName'];
  const allowed = ['firstName', 'lastName', 'email', 'phone', 'organization', 'title', 'website'];
  
  // Check required fields
  for (const field of required) {
    if (!data[field] || typeof data[field] !== 'string' || data[field].trim().length === 0) {
      throw new Error(`${field} is required`);
    }
  }
  
  // Validate email if provided
  if (data.email && !validator.isEmail(data.email)) {
    throw new Error('Invalid email format');
  }
  
  // Validate website if provided
  if (data.website) {
    try {
      validateUrl(data.website);
    } catch (error) {
      throw new Error('Invalid website URL');
    }
  }
  
  // Sanitize all string fields
  const sanitized = {};
  for (const field of allowed) {
    if (data[field]) {
      sanitized[field] = validator.escape(data[field].trim());
    }
  }
  
  return sanitized;
}

function validateQRType(type) {
  if (!type || typeof type !== 'string') {
    throw new Error('Type is required');
  }
  
  if (!['link', 'vcard'].includes(type)) {
    throw new Error('Invalid QR code type');
  }
  
  return type;
}

// HTML escaping function
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Health check endpoint for Render (no sensitive info)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString()
  });
});

app.post('/api/qr', async (req, res) => {
  try {
    const { type, data } = req.body;
    
    // Validate input
    const validatedType = validateQRType(type);
    let validatedData;
    
    if (validatedType === 'link') {
      validatedData = { url: validateUrl(data.url) };
    } else if (validatedType === 'vcard') {
      validatedData = validateVCardData(data);
    }
    
    const shortId = nanoid(8);
    
    const newCode = {
      id: nextId++,
      shortId,
      type: validatedType,
      data: validatedData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    qrCodes.push(newCode);
    
    // Use custom short domain if set, otherwise use current domain
    let qrUrl;
    if (process.env.CUSTOM_SHORT_DOMAIN) {
      qrUrl = `${process.env.CUSTOM_SHORT_DOMAIN}/${shortId}`;
    } else {
      const baseUrl = getBaseUrl(req);
      qrUrl = `${baseUrl}/q/${shortId}`;
    }
    
    const qrImage = await QRCode.toDataURL(qrUrl, { width: 512, margin: 2 });
    
    res.json({
      ...newCode,
      qrUrl,
      qrImage
    });
  } catch (error) {
    console.error('Error creating QR code:', error);
    res.status(400).json({ error: error.message || 'Failed to create QR code' });
  }
});

app.get('/api/qr', async (req, res) => {
  try {
    const codesWithImages = await Promise.all(qrCodes.map(async (code) => {
      let qrUrl;
      if (process.env.CUSTOM_SHORT_DOMAIN) {
        qrUrl = `${process.env.CUSTOM_SHORT_DOMAIN}/${code.shortId}`;
      } else {
        const baseUrl = getBaseUrl(req);
        qrUrl = `${baseUrl}/q/${code.shortId}`;
      }
      
      const qrImage = await QRCode.toDataURL(qrUrl, { width: 512, margin: 2 });
      
      return {
        ...code,
        qrUrl,
        qrImage
      };
    }));
    
    res.json(codesWithImages);
  } catch (error) {
    console.error('Error fetching QR codes:', error);
    res.status(500).json({ error: 'Failed to fetch QR codes' });
  }
});

app.get('/api/qr/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid QR code ID' });
    }
    
    const code = qrCodes.find(c => c.id === id);
    
    if (!code) {
      return res.status(404).json({ error: 'QR code not found' });
    }
    
    let qrUrl;
    if (process.env.CUSTOM_SHORT_DOMAIN) {
      qrUrl = `${process.env.CUSTOM_SHORT_DOMAIN}/${code.shortId}`;
    } else {
      const baseUrl = getBaseUrl(req);
      qrUrl = `${baseUrl}/q/${code.shortId}`;
    }
    
    const qrImage = await QRCode.toDataURL(qrUrl, { width: 512, margin: 2 });
    
    res.json({
      ...code,
      qrUrl,
      qrImage
    });
  } catch (error) {
    console.error('Error fetching QR code:', error);
    res.status(500).json({ error: 'Failed to fetch QR code' });
  }
});

app.put('/api/qr/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid QR code ID' });
    }
    
    const { type, data } = req.body;
    
    // Validate input
    const validatedType = validateQRType(type);
    let validatedData;
    
    if (validatedType === 'link') {
      validatedData = { url: validateUrl(data.url) };
    } else if (validatedType === 'vcard') {
      validatedData = validateVCardData(data);
    }
    
    const codeIndex = qrCodes.findIndex(c => c.id === id);
    
    if (codeIndex === -1) {
      return res.status(404).json({ error: 'QR code not found' });
    }
    
    qrCodes[codeIndex] = {
      ...qrCodes[codeIndex],
      type: validatedType,
      data: validatedData,
      updatedAt: new Date().toISOString()
    };
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating QR code:', error);
    res.status(400).json({ error: error.message || 'Failed to update QR code' });
  }
});

app.delete('/api/qr/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid QR code ID' });
    }
    
    const codeIndex = qrCodes.findIndex(c => c.id === id);
    
    if (codeIndex === -1) {
      return res.status(404).json({ error: 'QR code not found' });
    }
    
    qrCodes.splice(codeIndex, 1);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting QR code:', error);
    res.status(500).json({ error: 'Failed to delete QR code' });
  }
});

app.get('/api/qr/:id/image', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid QR code ID' });
    }
    
    const code = qrCodes.find(c => c.id === id);
    
    if (!code) {
      return res.status(404).send('Not found');
    }
    
    let qrUrl;
    if (process.env.CUSTOM_SHORT_DOMAIN) {
      qrUrl = `${process.env.CUSTOM_SHORT_DOMAIN}/${code.shortId}`;
    } else {
      const baseUrl = getBaseUrl(req);
      qrUrl = `${baseUrl}/q/${code.shortId}`;
    }
    
    const buffer = await QRCode.toBuffer(qrUrl, { width: 512, margin: 2 });
    
    res.type('png').send(buffer);
  } catch (error) {
    console.error('Error generating QR image:', error);
    res.status(500).send('Failed to generate QR image');
  }
});

// Handle QR redirects - support both /q/:shortId and direct /:shortId for custom domains
app.get('/q/:shortId', handleQRRedirect);

// Handle direct shortId paths (for custom domains) - but only if it's not an API route
app.get('/:shortId', (req, res, next) => {
  // Skip if it's an API route or static file
  if (req.params.shortId.startsWith('api') || 
      req.params.shortId.includes('.') ||
      req.params.shortId === 'health') {
    return next();
  }
  handleQRRedirect(req, res);
});

function handleQRRedirect(req, res) {
  try {
    const shortId = req.params.shortId;
    
    // Validate shortId format
    if (!shortId || typeof shortId !== 'string' || shortId.length !== 8) {
      return res.status(400).send('Invalid QR code');
    }
    
    const code = qrCodes.find(c => c.shortId === shortId);
    
    if (!code) {
      return res.status(404).send('QR code not found');
    }
    
    if (code.type === 'link') {
      // URL is already validated at creation time, but double-check
      const safeUrl = code.data.url; // Already validated and stored safely
      
      // Show custom HTML page with redirect
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome!</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            color: white;
        }
        .container {
            text-align: center;
            padding: 2rem;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            max-width: 400px;
            width: 90%;
        }
        .logo {
            font-size: 2rem;
            font-weight: bold;
            margin-bottom: 1rem;
        }
        .message {
            font-size: 1.1rem;
            margin-bottom: 1.5rem;
            opacity: 0.9;
        }
        .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-top: 4px solid white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .countdown {
            margin-top: 1rem;
            font-size: 0.9rem;
            opacity: 0.8;
        }
        .manual-link {
            margin-top: 1.5rem;
            padding: 0.8rem 1.5rem;
            background: rgba(255, 255, 255, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 10px;
            color: white;
            text-decoration: none;
            display: inline-block;
            transition: all 0.3s ease;
        }
        .manual-link:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🎯 Too Gallus</div>
        <div class="message">Welcome! Taking you to your destination...</div>
        <div class="spinner"></div>
        <div class="countdown">Redirecting in <span id="timer">3</span> seconds</div>
        <a href="${escapeHtml(safeUrl)}" id="manualLink" class="manual-link" style="display: none;">Click here if not redirected</a>
    </div>

    <script>
        let countdown = 3;
        const timerElement = document.getElementById('timer');
        const manualLinkElement = document.getElementById('manualLink');
        const safeUrl = '${escapeHtml(safeUrl)}';
        
        const countdownInterval = setInterval(() => {
            countdown--;
            timerElement.textContent = countdown;
            
            if (countdown <= 0) {
                clearInterval(countdownInterval);
                window.location.href = safeUrl;
            }
        }, 1000);
        
        // Show manual link after 1 second
        setTimeout(() => {
            manualLinkElement.style.display = 'inline-block';
        }, 1000);
        
        // Auto-redirect after 5 seconds regardless
        setTimeout(() => {
            window.location.href = safeUrl;
        }, 5000);
    </script>
</body>
</html>`;
      
      res.send(html);
    } else if (code.type === 'vcard') {
      // For vCards, show landing page then download
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contact Card</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            color: white;
        }
        .container {
            text-align: center;
            padding: 2rem;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            max-width: 400px;
            width: 90%;
        }
        .logo {
            font-size: 2rem;
            font-weight: bold;
            margin-bottom: 1rem;
        }
        .message {
            font-size: 1.1rem;
            margin-bottom: 1.5rem;
            opacity: 0.9;
        }
        .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-top: 4px solid white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .countdown {
            margin-top: 1rem;
            font-size: 0.9rem;
            opacity: 0.8;
        }
        .manual-link {
            margin-top: 1.5rem;
            padding: 0.8rem 1.5rem;
            background: rgba(255, 255, 255, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 10px;
            color: white;
            text-decoration: none;
            display: inline-block;
            transition: all 0.3s ease;
        }
        .manual-link:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🎯 Too Gallus</div>
        <div class="message">Preparing your contact card...</div>
        <div class="spinner"></div>
        <div class="countdown">Download starting in <span id="timer">3</span> seconds</div>
        <a href="/download/${escapeHtml(shortId)}" id="manualLink" class="manual-link" style="display: none;">Click here to download contact card</a>
    </div>

    <script>
        let countdown = 3;
        const timerElement = document.getElementById('timer');
        const manualLinkElement = document.getElementById('manualLink');
        
        const countdownInterval = setInterval(() => {
            countdown--;
            timerElement.textContent = countdown;
            
            if (countdown <= 0) {
                clearInterval(countdownInterval);
                window.location.href = '/download/${escapeHtml(shortId)}';
            }
        }, 1000);
        
        // Show manual link after 1 second
        setTimeout(() => {
            manualLinkElement.style.display = 'inline-block';
        }, 1000);
        
        // Auto-redirect after 5 seconds regardless
        setTimeout(() => {
            window.location.href = '/download/${escapeHtml(shortId)}';
        }, 5000);
    </script>
</body>
</html>`;
      
      res.send(html);
    }
  } catch (error) {
    console.error('Error processing QR redirect:', error);
    res.status(500).send('Error processing QR code');
  }
}

// Handle vCard downloads
app.get('/download/:shortId', (req, res) => {
  try {
    const shortId = req.params.shortId;
    
    // Validate shortId format
    if (!shortId || typeof shortId !== 'string' || shortId.length !== 8) {
      return res.status(400).send('Invalid QR code');
    }
    
    const code = qrCodes.find(c => c.shortId === shortId);
    
    if (!code || code.type !== 'vcard') {
      return res.status(404).send('Contact card not found');
    }
    
    const vcard = generateVCard(code.data);
    res.type('text/vcard');
    res.header('Content-Disposition', `attachment; filename="${escapeHtml(code.data.firstName)}_${escapeHtml(code.data.lastName)}.vcf"`);
    res.send(vcard);
  } catch (error) {
    console.error('Error downloading vCard:', error);
    res.status(500).send('Error downloading contact card');
  }
});

function generateVCard(data) {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${data.firstName} ${data.lastName}`,
    `N:${data.lastName};${data.firstName};;;`
  ];
  
  if (data.email) lines.push(`EMAIL:${data.email}`);
  if (data.phone) lines.push(`TEL:${data.phone}`);
  if (data.organization) lines.push(`ORG:${data.organization}`);
  if (data.title) lines.push(`TITLE:${data.title}`);
  if (data.website) lines.push(`URL:${data.website}`);
  
  lines.push('END:VCARD');
  
  return lines.join('\r\n');
}

// HTTPS redirect middleware (for production)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`BASE_URL: ${process.env.BASE_URL || 'not set'}`);
  console.log(`CUSTOM_SHORT_DOMAIN: ${process.env.CUSTOM_SHORT_DOMAIN || 'not set'}`);
});
