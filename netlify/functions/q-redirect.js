import { Handler } from '@netlify/functions';

// In-memory store for demo - replace with proper database
let qrCodes = [];

const handler = async (event, context) => {
  const { httpMethod, path } = event;
  const pathSegments = path.split('/').filter(Boolean);
  
  if (httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  
  const shortId = pathSegments[1];
  const code = qrCodes.find(c => c.shortId === shortId);
  
  if (!code) {
    return { statusCode: 404, body: 'QR code not found' };
  }
  
  if (code.type === 'link') {
    return {
      statusCode: 302,
      headers: {
        'Location': code.data.url
      },
      body: ''
    };
  } else if (code.type === 'vcard') {
    const vcard = generateVCard(code.data);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/vcard',
        'Content-Disposition': `attachment; filename="${code.data.firstName}_${code.data.lastName}.vcf"`
      },
      body: vcard
    };
  }
  
  return { statusCode: 404, body: 'Invalid QR code type' };
};

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

export { handler };
