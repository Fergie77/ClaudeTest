import express from 'express';
import Database from 'better-sqlite3';
import QRCode from 'qrcode';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Use environment-specific database path
const dbPath = process.env.DATABASE_URL || 'qrcodes.db';
const db = new Database(dbPath);

// Use environment variable for BASE_URL or construct from request
const getBaseUrl = (req) => {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers.host;
  return `${protocol}://${host}`;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS qr_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_id TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

app.use(express.json());
app.use(express.static('public'));

app.post('/api/qr', async (req, res) => {
  const { type, data } = req.body;
  const shortId = nanoid(8);
  
  const stmt = db.prepare(
    'INSERT INTO qr_codes (short_id, type, data) VALUES (?, ?, ?)'
  );
  const result = stmt.run(shortId, type, JSON.stringify(data));
  
  const baseUrl = getBaseUrl(req);
  const qrUrl = `${baseUrl}/q/${shortId}`;
  const qrImage = await QRCode.toDataURL(qrUrl, { width: 512, margin: 2 });
  
  res.json({
    id: result.lastInsertRowid,
    shortId,
    qrUrl,
    qrImage,
    type,
    data
  });
});

app.get('/api/qr', async (req, res) => {
  const stmt = db.prepare('SELECT * FROM qr_codes ORDER BY created_at DESC');
  const codes = stmt.all();
  
  const baseUrl = getBaseUrl(req);
  const codesWithImages = await Promise.all(codes.map(async (code) => {
    const qrUrl = `${baseUrl}/q/${code.short_id}`;
    const qrImage = await QRCode.toDataURL(qrUrl, { width: 512, margin: 2 });
    
    return {
      ...code,
      data: JSON.parse(code.data),
      qrUrl,
      qrImage
    };
  }));
  
  res.json(codesWithImages);
});

app.get('/api/qr/:id', async (req, res) => {
  const stmt = db.prepare('SELECT * FROM qr_codes WHERE id = ?');
  const code = stmt.get(req.params.id);
  
  if (!code) {
    return res.status(404).json({ error: 'QR code not found' });
  }
  
  const baseUrl = getBaseUrl(req);
  const qrUrl = `${baseUrl}/q/${code.short_id}`;
  const qrImage = await QRCode.toDataURL(qrUrl, { width: 512, margin: 2 });
  
  res.json({
    ...code,
    data: JSON.parse(code.data),
    qrUrl,
    qrImage
  });
});

app.put('/api/qr/:id', (req, res) => {
  const { type, data } = req.body;
  
  const stmt = db.prepare(
    'UPDATE qr_codes SET type = ?, data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  );
  const result = stmt.run(type, JSON.stringify(data), req.params.id);
  
  if (result.changes === 0) {
    return res.status(404).json({ error: 'QR code not found' });
  }
  
  res.json({ success: true });
});

app.delete('/api/qr/:id', (req, res) => {
  const stmt = db.prepare('DELETE FROM qr_codes WHERE id = ?');
  const result = stmt.run(req.params.id);
  
  if (result.changes === 0) {
    return res.status(404).json({ error: 'QR code not found' });
  }
  
  res.json({ success: true });
});

app.get('/api/qr/:id/image', async (req, res) => {
  const stmt = db.prepare('SELECT short_id FROM qr_codes WHERE id = ?');
  const code = stmt.get(req.params.id);
  
  if (!code) {
    return res.status(404).send('Not found');
  }
  
  const baseUrl = getBaseUrl(req);
  const qrUrl = `${baseUrl}/q/${code.short_id}`;
  const buffer = await QRCode.toBuffer(qrUrl, { width: 512, margin: 2 });
  
  res.type('png').send(buffer);
});

app.get('/q/:shortId', (req, res) => {
  const stmt = db.prepare('SELECT type, data FROM qr_codes WHERE short_id = ?');
  const code = stmt.get(req.params.shortId);
  
  if (!code) {
    return res.status(404).send('QR code not found');
  }
  
  const data = JSON.parse(code.data);
  
  if (code.type === 'link') {
    res.redirect(data.url);
  } else if (code.type === 'vcard') {
    const vcard = generateVCard(data);
    res.type('text/vcard');
    res.header('Content-Disposition', `attachment; filename="${data.firstName}_${data.lastName}.vcf"`);
    res.send(vcard);
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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
