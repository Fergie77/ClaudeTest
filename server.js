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

// Security middleware with adjusted CSP for inline scripts
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "production" ? 200 : 1000, // Environment-aware rate limiting
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "production" ? 50 : 200, // Environment-aware API rate limiting
  message: 'Too many API requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);
app.use('/api', strictLimiter);

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    supabase: 'connected'
  });
});

// Get all QR codes
app.get('/api/qr', async (req, res) => {
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

// Get specific QR code
app.get('/api/qr/:id', async (req, res) => {
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

// Create new QR code
app.post('/api/qr', async (req, res) => {
  try {
    const { type, data } = req.body;

    if (!type || !data) {
      return res.status(400).json({ error: 'Type and data are required' });
    }

    // Validate based on type
    if (type === 'link' && !validator.isURL(data.url)) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    if (type === 'vcard' && (!data.firstName || !data.lastName)) {
      return res.status(400).json({ error: 'First name and last name are required for contact cards' });
    }

    const shortId = nanoid(8);

    // Insert into Supabase
    const { data: newQRCode, error } = await supabase
      .from('qr_codes')
      .insert({
        short_id: shortId,
        type,
        data
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

// Update QR code
app.put('/api/qr/:id', async (req, res) => {
  try {
    const { type, data } = req.body;

    if (!type || !data) {
      return res.status(400).json({ error: 'Type and data are required' });
    }

    // Validate based on type
    if (type === 'link' && !validator.isURL(data.url)) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    if (type === 'vcard' && (!data.firstName || !data.lastName)) {
      return res.status(400).json({ error: 'First name and last name are required for contact cards' });
    }

    // Update in Supabase
    const { data: updatedQRCode, error } = await supabase
      .from('qr_codes')
      .update({
        type,
        data,
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

// Delete QR code
app.delete('/api/qr/:id', async (req, res) => {
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

// Clear all QR codes
app.delete('/api/qr/clear-all', async (req, res) => {
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

// Get QR code image for download
app.get('/api/qr/:id/image', async (req, res) => {
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

// QR code redirect endpoint
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
      // Generate vCard content
      const vcard = `BEGIN:VCARD
VERSION:3.0
FN:${data.data.firstName} ${data.data.lastName}
N:${data.data.lastName};${data.data.firstName};;;
${data.data.email ? `EMAIL:${data.data.email}` : ''}
${data.data.phone ? `TEL:${data.data.phone}` : ''}
${data.data.organization ? `ORG:${data.data.organization}` : ''}
${data.data.title ? `TITLE:${data.data.title}` : ''}
${data.data.website ? `URL:${data.data.website}` : ''}
END:VCARD`;

      res.set({
        'Content-Type': 'text/vcard',
        'Content-Disposition': `attachment; filename="${data.data.firstName}-${data.data.lastName}.vcf"`
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
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`BASE_URL: ${process.env.BASE_URL || 'not set'}`);
  console.log(`CUSTOM_SHORT_DOMAIN: ${process.env.CUSTOM_SHORT_DOMAIN || 'not set'}`);
});
