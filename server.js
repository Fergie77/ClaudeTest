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
    res.status(500).json({ error: 'Failed to create QR code' });
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
app.get('/:shortId', handleQRRedirect);

function handleQRRedirect(req, res) {
  try {
    const shortId = req.params.shortId;
    const code = qrCodes.find(c => c.shortId === shortId);
    
    if (!code) {
      return res.status(404).send('QR code not found');
    }
    
    if (code.type === 'link') {
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
        <a href="${code.data.url}" id="manualLink" class="manual-link" style="display: none;">Click here if not redirected</a>
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
                window.location.href = '${code.data.url}';
            }
        }, 1000);
        
        // Show manual link after 1 second
        setTimeout(() => {
            manualLinkElement.style.display = 'inline-block';
        }, 1000);
        
        // Auto-redirect after 5 seconds regardless
        setTimeout(() => {
            window.location.href = '${code.data.url}';
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
        <a href="/download/${shortId}" id="manualLink" class="manual-link" style="display: none;">Click here to download contact card</a>
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
                window.location.href = '/download/${shortId}';
            }
        }, 1000);
        
        // Show manual link after 1 second
        setTimeout(() => {
            manualLinkElement.style.display = 'inline-block';
        }, 1000);
        
        // Auto-redirect after 5 seconds regardless
        setTimeout(() => {
            window.location.href = '/download/${shortId}';
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
    const code = qrCodes.find(c => c.shortId === shortId);
    
    if (!code || code.type !== 'vcard') {
      return res.status(404).send('Contact card not found');
    }
    
    const vcard = generateVCard(code.data);
    res.type('text/vcard');
    res.header('Content-Disposition', `attachment; filename="${code.data.firstName}_${code.data.lastName}.vcf"`);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`BASE_URL: ${process.env.BASE_URL || 'not set'}`);
  console.log(`CUSTOM_SHORT_DOMAIN: ${process.env.CUSTOM_SHORT_DOMAIN || 'not set'}`);
});
