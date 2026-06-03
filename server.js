// BioLearn Backend - Railway.app
// Handles: AI Tutor proxy + Paystack payment initialization
// Deploy to Railway: railway.app (free tier)

const express  = require('express');
const cors     = require('cors');
const https    = require('https');
const app      = express();

app.use(express.json());
app.use(cors({
  origin: [
    'https://learn-lifesciences.netlify.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500'
  ]
}));

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const NETLIFY_URL     = 'https://learn-lifesciences.netlify.app';

// ── HEALTH CHECK ──
app.get('/', (req, res) => {
  res.json({ status: 'BioLearn API running', version: '1.0' });
});

// ── PAYSTACK: Initialize Transaction ──
app.post('/api/pay/initialize', async (req, res) => {
  const { email, plan, userId, userName } = req.body;

  if (!email || !plan)
    return res.status(400).json({ error: 'Email and plan required' });

  const amounts = { pro: 4900, premium: 12900 };
  const amount  = amounts[plan];
  if (!amount)
    return res.status(400).json({ error: 'Invalid plan' });

  const reference = 'BL' + Date.now() + Math.random().toString(36).substring(2, 7);

  const payload = JSON.stringify({
    email,
    amount,
    currency:     'ZAR',
    reference,
    callback_url: `${NETLIFY_URL}?payment=success&plan=${plan}&ref=${reference}`,
    metadata: {
      user_id:   userId  || '',
      user_name: userName || '',
      plan,
      custom_fields: [
        { display_name: 'Plan',    variable_name: 'plan',    value: plan },
        { display_name: 'User ID', variable_name: 'user_id', value: userId || '' }
      ]
    }
  });

  const options = {
    hostname: 'api.paystack.co',
    path:     '/transaction/initialize',
    method:   'POST',
    headers: {
      'Authorization': `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type':  'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const paystackReq = https.request(options, (paystackRes) => {
    let data = '';
    paystackRes.on('data', chunk => data += chunk);
    paystackRes.on('end', () => {
      try {
        const result = JSON.parse(data);
        if (result.status && result.data?.authorization_url) {
          res.json({
            success:          true,
            authorization_url: result.data.authorization_url,
            reference:         result.data.reference
          });
        } else {
          res.status(400).json({ error: result.message || 'Paystack error' });
        }
      } catch (e) {
        res.status(500).json({ error: 'Parse error: ' + e.message });
      }
    });
  });

  paystackReq.on('error', err => {
    res.status(500).json({ error: 'Network error: ' + err.message });
  });

  paystackReq.write(payload);
  paystackReq.end();
});

// ── PAYSTACK: Verify Transaction ──
app.get('/api/pay/verify/:reference', (req, res) => {
  const { reference } = req.params;

  const options = {
    hostname: 'api.paystack.co',
    path:     `/transaction/verify/${reference}`,
    method:   'GET',
    headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET}` }
  };

  https.get(options, (paystackRes) => {
    let data = '';
    paystackRes.on('data', chunk => data += chunk);
    paystackRes.on('end', () => {
      try {
        const result = JSON.parse(data);
        res.json({
          success:  result.status,
          verified: result.data?.status === 'success',
          amount:   result.data?.amount,
          email:    result.data?.customer?.email,
          metadata: result.data?.metadata
        });
      } catch (e) {
        res.status(500).json({ error: 'Parse error' });
      }
    });
  }).on('error', err => {
    res.status(500).json({ error: err.message });
  });
});

// ── AI TUTOR PROXY ──
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  const payload = JSON.stringify({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: `You are an expert Life Sciences tutor for South African Grade 10-12 students following the CAPS curriculum.
Answer clearly and concisely in 3-5 sentences. Use South African examples where relevant.
Connect your answer to NSC exam requirements. Be encouraging and educational.`,
    messages: [{ role: 'user', content: message }]
  });

  const options = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers: {
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
      'Content-Length':    Buffer.byteLength(payload)
    }
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      try {
        const result = JSON.parse(data);
        const reply  = result.content?.[0]?.text || 'Please try again.';
        res.json({ reply });
      } catch (e) {
        res.status(500).json({ error: 'Parse error' });
      }
    });
  });

  apiReq.on('error', err => {
    res.status(500).json({ error: err.message });
  });

  apiReq.write(payload);
  apiReq.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`BioLearn API running on port ${PORT}`));
