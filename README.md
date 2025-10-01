# QR Code Manager

A dynamic QR code management system that allows you to create QR codes and update their destinations without reprinting.

## Features

- ✅ Create QR codes for links and contact cards (vCards)
- ✅ Edit destinations after QR codes are created
- ✅ Download QR codes as PNG images
- ✅ Dynamic redirects - change content without reprinting
- ✅ Clean, responsive web interface
- ✅ SQLite database for persistence

## How It Works

QR codes contain short URLs like `https://yourdomain.com/q/abc123`. When scanned:
- **Links**: Backend redirects to the target URL
- **vCards**: Backend serves a downloadable `.vcf` file

The QR code image never changes, but you can update what `abc123` points to at any time.

## Deployment

This app is optimized for deployment on free hosting platforms like Render, Railway, or Fly.io.

### Environment Variables

- `BASE_URL`: Your app's public URL (e.g., `https://your-app.onrender.com`)
- `PORT`: Server port (automatically set by hosting platform)

## API Endpoints

- `POST /api/qr` - Create new QR code
- `GET /api/qr` - List all QR codes
- `GET /api/qr/:id` - Get specific QR code
- `PUT /api/qr/:id` - Update QR code
- `DELETE /api/qr/:id` - Delete QR code
- `GET /api/qr/:id/image` - Download QR code image
- `GET /q/:shortId` - Public redirect endpoint

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: SQLite
- **QR Generation**: qrcode library
- **Frontend**: Vanilla HTML/CSS/JavaScript
