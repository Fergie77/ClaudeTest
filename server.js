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
import crypto from 'crypto';

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

// Generate nonce for CSP
const generateNonce = () => crypto.randomBytes(16).toString('base64');

// Enhanced security middleware with nonce-based CSP
app.use((req, res, next) => {
  const nonce = generateNonce();
  res.locals.nonce = nonce;
  
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Still needed for inline styles
        scriptSrc: ["'self'", `'nonce-${nonce}'`], // Allow scripts with nonce
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
  })(req, res, next);
});

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

// Serve the main page with nonce
app.get('/', (req, res) => {
  const nonce = res.locals.nonce;
  res.send(`
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>QR Code Manager</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
          Oxygen, Ubuntu, Cantarell, sans-serif;
        background: #f5f5f5;
        padding: 20px;
      }

      .container {
        max-width: 1200px;
        margin: 0 auto;
      }

      header {
        background: white;
        padding: 30px;
        border-radius: 8px;
        margin-bottom: 20px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      h1 {
        margin-bottom: 10px;
      }

      .subtitle {
        color: #666;
      }

      .api-key-section {
        background: #fff3cd;
        border: 1px solid #ffeaa7;
        border-radius: 6px;
        padding: 15px;
        margin-bottom: 20px;
      }

      .api-key-section h3 {
        color: #856404;
        margin-bottom: 10px;
      }

      .api-key-input {
        display: flex;
        gap: 10px;
        align-items: center;
      }

      .api-key-input input {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 14px;
      }

      .api-key-status {
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
      }

      .api-key-status.valid {
        background: #d4edda;
        color: #155724;
      }

      .api-key-status.invalid {
        background: #f8d7da;
        color: #721c24;
      }

      .actions {
        margin-bottom: 20px;
      }

      button {
        background: #007bff;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      }

      button:hover {
        background: #0056b3;
      }

      button:disabled {
        background: #6c757d;
        cursor: not-allowed;
      }

      button.secondary {
        background: #6c757d;
      }

      button.secondary:hover {
        background: #545b62;
      }

      button.danger {
        background: #dc3545;
      }

      button.danger:hover {
        background: #c82333;
      }

      .modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 1000;
      }

      .modal.active {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .modal-content {
        background: white;
        padding: 30px;
        border-radius: 8px;
        width: 90%;
        max-width: 500px;
        max-height: 90vh;
        overflow-y: auto;
      }

      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }

      .modal-header h2 {
        margin: 0;
      }

      .close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        color: #666;
      }

      .form-group {
        margin-bottom: 20px;
      }

      label {
        display: block;
        margin-bottom: 6px;
        font-weight: 500;
        color: #333;
      }

      input,
      select {
        width: 100%;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 14px;
      }

      .type-selector {
        display: flex;
        gap: 10px;
        margin-bottom: 20px;
      }

      .type-btn {
        flex: 1;
        padding: 12px;
        background: #f8f9fa;
        border: 2px solid #ddd;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 500;
      }

      .type-btn.active {
        background: #e7f3ff;
        border-color: #007bff;
        color: #007bff;
      }

      .qr-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 20px;
      }

      .qr-card {
        background: white;
        border-radius: 8px;
        padding: 20px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .qr-image {
        width: 100%;
        height: auto;
        border-radius: 4px;
        margin-bottom: 15px;
      }

      .qr-info {
        margin-bottom: 15px;
      }

      .qr-type {
        display: inline-block;
        padding: 4px 8px;
        background: #e7f3ff;
        color: #007bff;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        margin-bottom: 8px;
      }

      .qr-data {
        color: #666;
        font-size: 14px;
        word-break: break-word;
      }

      .qr-actions {
        display: flex;
        gap: 10px;
      }

      .qr-actions button {
        flex: 1;
        padding: 8px;
        font-size: 13px;
      }

      .empty-state {
        text-align: center;
        padding: 60px 20px;
        background: white;
        border-radius: 8px;
      }

      .empty-state h3 {
        margin-bottom: 10px;
        color: #333;
      }

      .empty-state p {
        color: #666;
        margin-bottom: 20px;
      }

      .dynamic-fields {
        display: none;
      }

      .dynamic-fields.active {
        display: block;
      }

      .qr-url {
        font-family: monospace;
        font-size: 12px;
        color: #666;
        margin-top: 8px;
        word-break: break-all;
      }

      .error-message {
        background: #f8d7da;
        color: #721c24;
        padding: 10px;
        border-radius: 4px;
        margin-bottom: 15px;
        display: none;
      }

      .error-message.show {
        display: block;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <h1>QR Code Manager</h1>
        <p class="subtitle">
          Create dynamic QR codes that you can update anytime
        </p>
      </header>

      <div class="api-key-section">
        <h3>🔑 API Authentication Required</h3>
        <div class="api-key-input">
          <input type="password" id="apiKeyInput" placeholder="Enter your API key..." />
          <button id="setApiKeyBtn">Set API Key</button>
          <span id="apiKeyStatus" class="api-key-status">Not Set</span>
        </div>
        <p style="margin-top: 10px; font-size: 12px; color: #856404;">
          Contact your administrator to get an API key for accessing this service.
        </p>
      </div>

      <div class="actions">
        <button id="createBtn" disabled>+ Create QR Code</button>
        <button class="danger" id="clearAllBtn" style="display: none;" disabled>🗑️ Clear All</button>
      </div>

      <div id="errorMessage" class="error-message"></div>

      <div id="qrGrid" class="qr-grid"></div>
    </div>

    <div id="createModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2 id="modalTitle">Create QR Code</h2>
          <button class="close" id="closeModalBtn">&times;</button>
        </div>

        <div class="type-selector">
          <button class="type-btn active" data-type="link" id="linkTypeBtn">
            Link
          </button>
          <button class="type-btn" data-type="vcard" id="vcardTypeBtn">
            Contact Card
          </button>
        </div>

        <form id="qrForm">
          <div id="linkFields" class="dynamic-fields active">
            <div class="form-group">
              <label>Destination URL</label>
              <input type="url" id="url" placeholder="https://example.com" required />
            </div>
          </div>

          <div id="vcardFields" class="dynamic-fields">
            <div class="form-group">
              <label>First Name</label>
              <input type="text" id="firstName" placeholder="John" required />
            </div>
            <div class="form-group">
              <label>Last Name</label>
              <input type="text" id="lastName" placeholder="Doe" required />
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="email" placeholder="john@example.com" />
            </div>
            <div class="form-group">
              <label>Phone</label>
              <input type="tel" id="phone" placeholder="+1234567890" />
            </div>
            <div class="form-group">
              <label>Organization</label>
              <input type="text" id="organization" placeholder="Company Inc." />
            </div>
            <div class="form-group">
              <label>Title</label>
              <input type="text" id="title" placeholder="Software Engineer" />
            </div>
            <div class="form-group">
              <label>Website</label>
              <input type="url" id="website" placeholder="https://example.com" />
            </div>
          </div>

          <button type="submit" id="submitBtn">Create QR Code</button>
        </form>
      </div>
    </div>

    <script nonce="${nonce}">
      let currentType = 'link'
      let editingId = null
      let apiKey = localStorage.getItem('qr_api_key') || ''

      // Initialize API key status
      if (apiKey) {
        document.getElementById('apiKeyInput').value = apiKey
        updateApiKeyStatus(true)
      }

      // Event listeners (CSP-compliant)
      document.addEventListener('DOMContentLoaded', function() {
        // API Key button
        document.getElementById('setApiKeyBtn').addEventListener('click', setApiKey)
        
        // Main action buttons
        document.getElementById('createBtn').addEventListener('click', openCreateModal)
        document.getElementById('clearAllBtn').addEventListener('click', clearAllQRCodes)
        
        // Modal controls
        document.getElementById('closeModalBtn').addEventListener('click', closeModal)
        
        // Type selector buttons
        document.getElementById('linkTypeBtn').addEventListener('click', () => selectType('link'))
        document.getElementById('vcardTypeBtn').addEventListener('click', () => selectType('vcard'))
        
        // Form submission
        document.getElementById('qrForm').addEventListener('submit', handleSubmit)
        
        // Load QR codes on page load if API key is available
        if (apiKey) {
          loadQRCodes()
        }
      })

      function setApiKey() {
        const input = document.getElementById('apiKeyInput')
        const key = input.value.trim()
        
        if (key) {
          apiKey = key
          localStorage.setItem('qr_api_key', key)
          updateApiKeyStatus(true)
          loadQRCodes() // Try to load QR codes with new key
        } else {
          updateApiKeyStatus(false)
        }
      }

      function updateApiKeyStatus(isValid) {
        const status = document.getElementById('apiKeyStatus')
        const createBtn = document.getElementById('createBtn')
        
        if (isValid) {
          status.textContent = 'Valid'
          status.className = 'api-key-status valid'
          createBtn.disabled = false
        } else {
          status.textContent = 'Invalid'
          status.className = 'api-key-status invalid'
          createBtn.disabled = true
        }
      }

      function showError(message) {
        const errorDiv = document.getElementById('errorMessage')
        errorDiv.textContent = message
        errorDiv.classList.add('show')
        setTimeout(() => {
          errorDiv.classList.remove('show')
        }, 5000)
      }

      async function makeAuthenticatedRequest(url, options = {}) {
        if (!apiKey) {
          showError('API key is required. Please set your API key first.')
          return null
        }

        const headers = {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          ...options.headers
        }

        try {
          const response = await fetch(url, {
            ...options,
            headers
          })

          if (response.status === 401) {
            showError('Invalid API key. Please check your API key and try again.')
            updateApiKeyStatus(false)
            return null
          }

          if (!response.ok) {
            const errorData = await response.json()
            showError(errorData.error || 'Request failed')
            return null
          }

          return response
        } catch (error) {
          showError('Network error: ' + error.message)
          return null
        }
      }

      async function loadQRCodes() {
        const response = await makeAuthenticatedRequest('/api/qr')
        if (!response) return

        const codes = await response.json()

        const grid = document.getElementById('qrGrid')
        const clearAllBtn = document.getElementById('clearAllBtn')

        if (codes.length === 0) {
          grid.innerHTML = \`
          <div class="empty-state">
            <h3>No QR codes yet</h3>
            <p>Create your first QR code to get started</p>
            <button id="emptyCreateBtn" \${!apiKey ? 'disabled' : ''}>+ Create QR Code</button>
          </div>
        \`
          // Add event listener to empty state button
          const emptyCreateBtn = document.getElementById('emptyCreateBtn')
          if (emptyCreateBtn) {
            emptyCreateBtn.addEventListener('click', openCreateModal)
          }
          clearAllBtn.style.display = 'none'
          return
        }

        // Show clear all button when there are QR codes
        clearAllBtn.style.display = 'inline-block'
        clearAllBtn.disabled = !apiKey

        grid.innerHTML = codes
          .map(
            (code) => \`
        <div class="qr-card">
          <img class="qr-image" src="\${code.qrImage}" alt="QR Code">
          <div class="qr-info">
            <div class="qr-type">\${
              code.type === 'link' ? 'Link' : 'Contact Card'
            }</div>
            <div class="qr-data">
              \${
                code.type === 'link'
                  ? \`→ \${code.data.url}\`
                  : \`\${code.data.firstName} \${code.data.lastName}\`
              }
            </div>
            <div class="qr-url">\${code.qrUrl}</div>
          </div>
          <div class="qr-actions">
            <button class="secondary edit-btn" data-id="\${code.id}" \${!apiKey ? 'disabled' : ''}>Edit</button>
            <button class="secondary download-btn" data-id="\${code.id}" \${!apiKey ? 'disabled' : ''}>Download</button>
            <button class="danger delete-btn" data-id="\${code.id}" \${!apiKey ? 'disabled' : ''}>Delete</button>
          </div>
        </div>
      \`
          )
          .join('')

        // Add event listeners to dynamically created buttons
        document.querySelectorAll('.edit-btn').forEach(btn => {
          btn.addEventListener('click', (e) => editQRCode(e.target.dataset.id))
        })
        document.querySelectorAll('.download-btn').forEach(btn => {
          btn.addEventListener('click', (e) => downloadQR(e.target.dataset.id))
        })
        document.querySelectorAll('.delete-btn').forEach(btn => {
          btn.addEventListener('click', (e) => deleteQRCode(e.target.dataset.id))
        })
      }

      function selectType(type) {
        currentType = type

        document.querySelectorAll('.type-btn').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.type === type)
        })

        document.querySelectorAll('.dynamic-fields').forEach((field) => {
          field.classList.remove('active')
        })

        document.getElementById(type + 'Fields').classList.add('active')
      }

      function openCreateModal() {
        if (!apiKey) {
          showError('Please set your API key first')
          return
        }
        
        editingId = null
        document.getElementById('modalTitle').textContent = 'Create QR Code'
        document.getElementById('submitBtn').textContent = 'Create QR Code'
        document.getElementById('qrForm').reset()
        document.getElementById('createModal').classList.add('active')
      }

      async function editQRCode(id) {
        if (!apiKey) {
          showError('Please set your API key first')
          return
        }

        const response = await makeAuthenticatedRequest(\`/api/qr/\${id}\`)
        if (!response) return

        const code = await response.json()

        editingId = id
        currentType = code.type

        selectType(code.type)

        if (code.type === 'link') {
          document.getElementById('url').value = code.data.url
        } else {
          document.getElementById('firstName').value = code.data.firstName
          document.getElementById('lastName').value = code.data.lastName
          document.getElementById('email').value = code.data.email || ''
          document.getElementById('phone').value = code.data.phone || ''
          document.getElementById('organization').value =
            code.data.organization || ''
          document.getElementById('title').value = code.data.title || ''
          document.getElementById('website').value = code.data.website || ''
        }

        document.getElementById('modalTitle').textContent = 'Edit QR Code'
        document.getElementById('submitBtn').textContent = 'Update QR Code'
        document.getElementById('createModal').classList.add('active')
      }

      function closeModal() {
        document.getElementById('createModal').classList.remove('active')
      }

      async function handleSubmit(e) {
        e.preventDefault()

        if (!apiKey) {
          showError('Please set your API key first')
          return
        }

        let data

        if (currentType === 'link') {
          data = { url: document.getElementById('url').value }
        } else {
          data = {
            firstName: document.getElementById('firstName').value,
            lastName: document.getElementById('lastName').value,
            email: document.getElementById('email').value,
            phone: document.getElementById('phone').value,
            organization: document.getElementById('organization').value,
            title: document.getElementById('title').value,
            website: document.getElementById('website').value,
          }
        }

        const url = editingId ? \`/api/qr/\${editingId}\` : '/api/qr'
        const method = editingId ? 'PUT' : 'POST'

        const response = await makeAuthenticatedRequest(url, {
          method,
          body: JSON.stringify({ type: currentType, data }),
        })

        if (response) {
          closeModal()
          loadQRCodes()
        }
      }

      async function deleteQRCode(id) {
        if (!apiKey) {
          showError('Please set your API key first')
          return
        }

        if (!confirm('Delete this QR code? This cannot be undone.')) return

        const response = await makeAuthenticatedRequest(\`/api/qr/\${id}\`, { method: 'DELETE' })
        if (response) {
          loadQRCodes()
        }
      }

      async function downloadQR(id) {
        if (!apiKey) {
          showError('Please set your API key first')
          return
        }

        const response = await makeAuthenticatedRequest(\`/api/qr/\${id}/image\`)
        if (!response) return

        const blob = await response.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = \`qr-code-\${id}.png\`
        a.click()
      }

      async function clearAllQRCodes() {
        if (!apiKey) {
          showError('Please set your API key first')
          return
        }

        if (!confirm("Are you sure you want to delete ALL QR codes? This cannot be undone.")) return
        
        const response = await makeAuthenticatedRequest("/api/qr/clear-all", { method: "DELETE" })
        if (response) {
          loadQRCodes()
        }
      }
    </script>
  </body>
</html>
  `);
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
