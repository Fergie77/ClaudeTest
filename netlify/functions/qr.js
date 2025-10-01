import { Handler } from '@netlify/functions';
import Database from 'better-sqlite3';
import QRCode from 'qrcode';
import { nanoid } from 'nanoid';

// Note: In production, you'd use a proper database like PostgreSQL
// For demo purposes, we'll use a simple in-memory store
let qrCodes = [];

const handler = async (event, context) => {
  const { httpMethod, path, body, queryStringParameters } = event;
  const pathSegments = path.split('/').filter(Boolean);
  
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    // Handle different API endpoints
    if (pathSegments[1] === 'qr') {
      if (httpMethod === 'GET') {
        if (pathSegments[2]) {
          // Get specific QR code
          const id = parseInt(pathSegments[2]);
          const code = qrCodes.find(c => c.id === id);
          if (!code) {
            return { statusCode: 404, headers, body: JSON.stringify({ error: 'QR code not found' }) };
          }
          
          const qrUrl = `${event.headers.host ? 'https://' + event.headers.host : 'https://yourdomain.netlify.app'}/q/${code.shortId}`;
          const qrImage = await QRCode.toDataURL(qrUrl, { width: 512, margin: 2 });
          
          return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...code,
              qrUrl,
              qrImage
            })
          };
        } else {
          // List all QR codes
          const codesWithImages = await Promise.all(qrCodes.map(async (code) => {
            const qrUrl = `${event.headers.host ? 'https://' + event.headers.host : 'https://yourdomain.netlify.app'}/q/${code.shortId}`;
            const qrImage = await QRCode.toDataURL(qrUrl, { width: 512, margin: 2 });
            
            return {
              ...code,
              qrUrl,
              qrImage
            };
          }));
          
          return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(codesWithImages)
          };
        }
      } else if (httpMethod === 'POST') {
        // Create new QR code
        const { type, data } = JSON.parse(body);
        const shortId = nanoid(8);
        const newCode = {
          id: qrCodes.length + 1,
          shortId,
          type,
          data,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        qrCodes.push(newCode);
        
        const qrUrl = `${event.headers.host ? 'https://' + event.headers.host : 'https://yourdomain.netlify.app'}/q/${shortId}`;
        const qrImage = await QRCode.toDataURL(qrUrl, { width: 512, margin: 2 });
        
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...newCode,
            qrUrl,
            qrImage
          })
        };
      } else if (httpMethod === 'PUT') {
        // Update QR code
        const id = parseInt(pathSegments[2]);
        const { type, data } = JSON.parse(body);
        const codeIndex = qrCodes.findIndex(c => c.id === id);
        
        if (codeIndex === -1) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'QR code not found' }) };
        }
        
        qrCodes[codeIndex] = {
          ...qrCodes[codeIndex],
          type,
          data,
          updatedAt: new Date().toISOString()
        };
        
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true })
        };
      } else if (httpMethod === 'DELETE') {
        // Delete QR code
        const id = parseInt(pathSegments[2]);
        const codeIndex = qrCodes.findIndex(c => c.id === id);
        
        if (codeIndex === -1) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'QR code not found' }) };
        }
        
        qrCodes.splice(codeIndex, 1);
        
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true })
        };
      }
    }
    
    return { statusCode: 404, headers, body: 'Not found' };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

export { handler };
