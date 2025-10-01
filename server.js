import express from 'express';
import QRCode from 'qrcode';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// In-memory storage for free tier (replaces SQLite)
let qrCodes = [];
let nextId = 1;

// Use environment variable for BASE_URL or construct from request
const getBaseUrl = (req) => {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers.host;
  return `${protocol}://${host}`;
};

app.use(express.json());
app.use(express.static('public'));

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    qrCodesCount: qrCodes.length 
  });
});

app.post('/api/qr', async (req, res) => {
  try {
    const { type, data } = req.body;
    const shortId = nanoid(8);
    
    const newCode = {
      id: nextId++,
      shortId,
      type,
      data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    qrCodes.push(newCode);
    
    const baseUrl = getBaseUrl(req);
    const qrUrl = `${baseUrl}/q/${shortId}`;
    const qrImage = await QRCode.toDataURL(qrUrl, { width: 512, margin: 2 });
    
    res.json({
      ...newCode,
      qrUrl,
      qrImage
    });
  } catch (error) {
    console.error('Error creating QR code:', error);
    res.status(500).json({ error: 'Failed to create QR code' });
  }
});

app.get('/api/qr', async (req, res) => {
  try {
    const baseUrl = getBaseUrl(req);
    const codesWithImages = await Promise.all(qrCodes.map(async (code) => {
      const qrUrl = `${baseUrl}/q/${code.shortId}`;
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
    const code = qrCodes.find(c => c.id === id);
    
    if (!code) {
      return res.status(404).json({ error: 'QR code not found' });
    }
    
    const baseUrl = getBaseUrl(req);
    const qrUrl = `${baseUrl}/q/${code.shortId}`;
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
    const { type, data } = req.body;
    
    const codeIndex = qrCodes.findIndex(c => c.id === id);
    
    if (codeIndex === -1) {
      return res.status(404).json({ error: 'QR code not found' });
    }
    
    qrCodes[codeIndex] = {
      ...qrCodes[codeIndex],
      type,
      data,
      updatedAt: new Date().toISOString()
    };
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating QR code:', error);
    res.status(500).json({ error: 'Failed to update QR code' });
  }
});

app.delete('/api/qr/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
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
    const code = qrCodes.find(c => c.id === id);
    
    if (!code) {
      return res.status(404).send('Not found');
    }
    
    const baseUrl = getBaseUrl(req);
    const qrUrl = `${baseUrl}/q/${code.shortId}`;
    const buffer = await QRCode.toBuffer(qrUrl, { width: 512, margin: 2 });
    
    res.type('png').send(buffer);
  } catch (error) {
    console.error('Error generating QR image:', error);
    res.status(500).send('Failed to generate QR image');
  }
});

app.get('/q/:shortId', (req, res) => {
  try {
    const shortId = req.params.shortId;
    const code = qrCodes.find(c => c.shortId === shortId);
    
    if (!code) {
      return res.status(404).send('QR code not found');
    }
    
    if (code.type === 'link') {
      res.redirect(code.data.url);
    } else if (code.type === 'vcard') {
      const vcard = generateVCard(code.data);
      res.type('text/vcard');
      res.header('Content-Disposition', `attachment; filename="${code.data.firstName}_${code.data.lastName}.vcf"`);
      res.send(vcard);
    }
  } catch (error) {
    console.error('Error processing QR redirect:', error);
    res.status(500).send('Error processing QR code');
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`BASE_URL: ${process.env.BASE_URL || 'not set'}`);
});
