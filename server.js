import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import QRCode from 'qrcode';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import validator from 'validator';
import { createClient } from '@supabase/supabase-js';
import { body, validationResult } from 'express-validator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set in environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();

// Enhanced security middleware with stricter CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Still needed for inline styles
      scriptSrc: ["'self'"], // Removed 'unsafe-inline' for better security
      scriptSrcAttr: ["'none'"], // Block inline event handlers
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Enhanced rate limiting with stricter production limits
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "production" ? 100 : 500, // Stricter limits
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "production" ? 20 : 100, // Much stricter API limits
  message: { error: 'Too many API requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);
app.use('/api', strictLimiter);

// Middleware
app.use(express.json({ limit: '1mb' })); // Limit request size
app.use(express.static(join(__dirname, 'public')));

// API Key Authentication Middleware
const authenticateAPIKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const validApiKey = process.env.API_KEY;
  
  if (!validApiKey) {
    return res.status(500).json({ error: 'API authentication not configured' });
  }
  
  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  
  next();
};

// Enhanced URL validation function
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
    /^blob:/i,
    /^ws:/i,
    /^wss:/i,
    /^gopher:/i,
    /^ldap:/i,
    /^ldaps:/i
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
    require_valid_protocol: true,
    allow_underscores: false,
    allow_trailing_dot: false,
    allow_protocol_relative_urls: false
  })) {
    throw new Error('Invalid URL format - only HTTP and HTTPS URLs are allowed');
  }
  
  // Additional security checks
  const parsed = new URL(url);
  
  // Block localhost/private IPs in production
  if (process.env.NODE_ENV === 'production') {
    if (parsed.hostname === 'localhost' || 
        parsed.hostname.startsWith('127.') ||
        parsed.hostname.startsWith('192.168.') ||
        parsed.hostname.startsWith('10.') ||
        parsed.hostname.startsWith('172.') ||
        parsed.hostname === '0.0.0.0') {
      throw new Error('Local/private URLs are not allowed in production');
    }
  }
  
  // Block suspicious patterns
  if (parsed.hostname.includes('..') || 
      parsed.hostname.includes('@') ||
      parsed.hostname.includes('#')) {
    throw new Error('Suspicious URL patterns detected');
  }
  
  return url.trim();
}

// Enhanced vCard validation
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
  
  // Validate phone if provided
  if (data.phone && !validator.isMobilePhone(data.phone)) {
    throw new Error('Invalid phone format');
  }
  
  // Validate website if provided
  if (data.website) {
    try {
      validateUrl(data.website);
    } catch (error) {
      throw new Error('Invalid website URL');
    }
  }
  
  // Sanitize and validate all string fields
  const sanitized = {};
  for (const field of allowed) {
    if (data[field]) {
      // Escape HTML and limit length
      const sanitizedValue = validator.escape(data[field].trim());
      if (sanitizedValue.length > 100) {
        throw new Error(`${field} is too long (max 100 characters)`);
      }
      sanitized[field] = sanitizedValue;
    }
  }
  
  return sanitized;
}

// Validation middleware
const validateQRCode = [
  body('type').isIn(['link', 'vcard']).withMessage('Type must be either link or vcard'),
  body('data').isObject().withMessage('Data must be an object'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }
    next();
  }
];

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    supabase: 'connected',
    version: '2.0.0-secure'
  });
});

// Get all QR codes (requires API key)
app.get('/api/qr', authenticateAPIKey, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('qr_codes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Failed to fetch QR codes' });
    }

    // Generate QR images and URLs for each code
    const codesWithImages = await Promise.all((data || []).map(async (code) => {
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const qrUrl = `${baseUrl}/q/${code.short_id}`;
      
      const qrImage = await QRCode.toDataURL(qrUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

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

// Get specific QR code (requires API key)
app.get('/api/qr/:id', authenticateAPIKey, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('qr_codes')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(404).json({ error: 'QR code not found' });
    }

    // Generate QR image and URL
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const qrUrl = `${baseUrl}/q/${data.short_id}`;
    
    const qrImage = await QRCode.toDataURL(qrUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    res.json({
      ...data,
      qrUrl,
      qrImage
    });
  } catch (error) {
    console.error('Error fetching QR code:', error);
    res.status(500).json({ error: 'Failed to fetch QR code' });
  }
});

// Create new QR code (requires API key + validation)
app.post('/api/qr', authenticateAPIKey, validateQRCode, async (req, res) => {
  try {
    const { type, data } = req.body;

    // Enhanced validation based on type
    if (type === 'link') {
      if (!data.url) {
        return res.status(400).json({ error: 'URL is required for link type' });
      }
      try {
        validateUrl(data.url);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    } else if (type === 'vcard') {
      try {
        const sanitizedData = validateVCardData(data);
        req.body.data = sanitizedData; // Update with sanitized data
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }

    const shortId = nanoid(8);

    // Insert into Supabase
    const { data: newQRCode, error } = await supabase
      .from('qr_codes')
      .insert({
        short_id: shortId,
        type,
        data: req.body.data
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Failed to create QR code' });
    }

    // Generate QR image and URL for response
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const qrUrl = `${baseUrl}/q/${shortId}`;
    
    const qrImage = await QRCode.toDataURL(qrUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    res.json({
      ...newQRCode,
      qrUrl,
      qrImage
    });
  } catch (error) {
    console.error('Error creating QR code:', error);
    res.status(500).json({ error: 'Failed to create QR code' });
  }
});

// Update QR code (requires API key + validation)
app.put('/api/qr/:id', authenticateAPIKey, validateQRCode, async (req, res) => {
  try {
    const { type, data } = req.body;

    // Enhanced validation based on type
    if (type === 'link') {
      if (!data.url) {
        return res.status(400).json({ error: 'URL is required for link type' });
      }
      try {
        validateUrl(data.url);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    } else if (type === 'vcard') {
      try {
        const sanitizedData = validateVCardData(data);
        req.body.data = sanitizedData; // Update with sanitized data
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }

    // Update in Supabase
    const { data: updatedQRCode, error } = await supabase
      .from('qr_codes')
      .update({
        type,
        data: req.body.data,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Failed to update QR code' });
    }

    // Generate QR image and URL for response
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const qrUrl = `${baseUrl}/q/${updatedQRCode.short_id}`;
    
    const qrImage = await QRCode.toDataURL(qrUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    res.json({
      ...updatedQRCode,
      qrUrl,
      qrImage
    });
  } catch (error) {
    console.error('Error updating QR code:', error);
    res.status(500).json({ error: 'Failed to update QR code' });
  }
});

// Delete QR code (requires API key)
app.delete('/api/qr/:id', authenticateAPIKey, async (req, res) => {
  try {
    const { error } = await supabase
      .from('qr_codes')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Failed to delete QR code' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting QR code:', error);
    res.status(500).json({ error: 'Failed to delete QR code' });
  }
});

// Clear all QR codes (requires API key)
app.delete('/api/qr/clear-all', authenticateAPIKey, async (req, res) => {
  try {
    const { error } = await supabase
      .from('qr_codes')
      .delete()
      .neq('id', 0); // Delete all records (id is never 0)

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Failed to clear QR codes' });
    }

    res.json({ success: true, message: 'All QR codes cleared successfully' });
  } catch (error) {
    console.error('Error clearing QR codes:', error);
    res.status(500).json({ error: 'Failed to clear QR codes' });
  }
});

// Get QR code image for download (requires API key)
app.get('/api/qr/:id/image', authenticateAPIKey, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('qr_codes')
      .select('short_id')
      .eq('id', req.params.id)
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(404).json({ error: 'QR code not found' });
    }

    // Generate QR code image
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const qrUrl = `${baseUrl}/q/${data.short_id}`;
    
    const qrImageBuffer = await QRCode.toBuffer(qrUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="qr-code-${req.params.id}.png"`
    });

    res.send(qrImageBuffer);
  } catch (error) {
    console.error('Error fetching QR code image:', error);
    res.status(500).json({ error: 'Failed to fetch QR code image' });
  }
});

// QR code redirect endpoint (public - no auth required)
app.get('/q/:shortId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('qr_codes')
      .select('*')
      .eq('short_id', req.params.shortId)
      .single();

    if (error || !data) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>QR Code Not Found</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .error { color: #dc3545; }
          </style>
        </head>
        <body>
          <h1 class="error">QR Code Not Found</h1>
          <p>The QR code you scanned is no longer valid.</p>
        </body>
        </html>
      `);
    }

    if (data.type === 'link') {
      res.redirect(data.data.url);
    } else if (data.type === 'vcard') {
      // Generate vCard content with sanitized data
      const sanitizedData = data.data;
      const vcard = `BEGIN:VCARD
VERSION:3.0
FN:${sanitizedData.firstName} ${sanitizedData.lastName}
N:${sanitizedData.lastName};${sanitizedData.firstName};;;
${sanitizedData.email ? `EMAIL:${sanitizedData.email}` : ''}
${sanitizedData.phone ? `TEL:${sanitizedData.phone}` : ''}
${sanitizedData.organization ? `ORG:${sanitizedData.organization}` : ''}
${sanitizedData.title ? `TITLE:${sanitizedData.title}` : ''}
${sanitizedData.website ? `URL:${sanitizedData.website}` : ''}
END:VCARD`;

      res.set({
        'Content-Type': 'text/vcard',
        'Content-Disposition': `attachment; filename="${sanitizedData.firstName}-${sanitizedData.lastName}.vcf"`
      });

      res.send(vcard);
    }
  } catch (error) {
    console.error('Error processing QR code redirect:', error);
    res.status(500).send('Internal server error');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Rate limits: ${process.env.NODE_ENV === 'production' ? 'Production (strict)' : 'Development (lenient)'}`);
  console.log(`API Authentication: ${process.env.API_KEY ? 'Enabled' : 'Disabled'}`);
  console.log(`BASE_URL: ${process.env.BASE_URL || 'not set'}`);
  console.log(`CUSTOM_SHORT_DOMAIN: ${process.env.CUSTOM_SHORT_DOMAIN || 'not set'}`);
});
