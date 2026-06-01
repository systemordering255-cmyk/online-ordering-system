const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});

const OTP_EXPIRY_MS      = 15 * 60 * 1000;
const SESSION_EXPIRY_MS  = 30 * 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;  // 60s between OTP sends
const MAX_ATTEMPTS       = 5;

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

function normalizePhone(phone) {
  phone = String(phone || '').trim().replace(/[\s\-\(\)]/g, '');
  if (phone.startsWith('+91')) phone = phone.slice(3);
  else if (phone.startsWith('91') && phone.length === 12) phone = phone.slice(2);
  if (!/^\d{10}$/.test(phone)) throw new Error('Please enter a valid 10-digit mobile number.');
  return phone;
}

async function getBusinessName() {
  const { data } = await supabase.from('settings').select('value').eq('key', 'business_name').single();
  return data?.value || 'Online Ordering System';
}

async function validateCustomerSession(token) {
  if (!token) return null;
  const { data } = await supabase
    .from('customer_sessions')
    .select('phone, email, name, expires_at')
    .eq('token', token)
    .single();
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, phone, email, otp, token } = req.body || {};

  try {
    if (action === 'send-otp') {
      const normalizedPhone = normalizePhone(phone);
      if (!email || !email.includes('@')) {
        return res.json({ success: false, error: 'Please enter a valid email address.' });
      }
      const normalizedEmail = email.trim().toLowerCase();

      // Rate limit: enforce 60s cooldown between OTP requests
      const { data: existing } = await supabase
        .from('otp_sessions')
        .select('expires_at')
        .eq('phone', normalizedPhone)
        .single();

      if (existing) {
        const sentAt  = new Date(existing.expires_at).getTime() - OTP_EXPIRY_MS;
        const elapsed = Date.now() - sentAt;
        if (elapsed < RESEND_COOLDOWN_MS) {
          const wait = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
          return res.json({ success: false, error: `Please wait ${wait} seconds before requesting a new OTP.` });
        }
      }

      const otpCode  = String(100000 + Math.floor(Math.random() * 900000));
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();

      await supabase.from('otp_sessions').delete().eq('phone', normalizedPhone);
      await supabase.from('otp_sessions').insert({
        phone:      normalizedPhone,
        email:      normalizedEmail,
        otp:        hashOtp(otpCode),   // store hash, never plaintext
        expires_at: expiresAt,
        attempts:   0
      });

      const bizName = await getBusinessName();

      await transporter.sendMail({
        from:    `"${bizName}" <${process.env.GMAIL_USER}>`,
        to:      normalizedEmail,
        subject: `${bizName} - Your Login OTP`,
        html:    `<p>Hello,</p>
                  <p>Your OTP for <b>${bizName}</b> is: <b style="font-size:24px">${otpCode}</b></p>
                  <p>This OTP is valid for 15 minutes. Do not share it with anyone.</p>
                  <p>If you did not request this, please ignore this email.</p>`
      });

      return res.json({ success: true });
    }

    if (action === 'verify-otp') {
      const normalizedPhone = normalizePhone(phone);
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!otp) return res.json({ success: false, error: 'Please enter the OTP.' });

      const { data: otpRow } = await supabase
        .from('otp_sessions')
        .select('otp, expires_at, email, attempts')
        .eq('phone', normalizedPhone)
        .single();

      if (!otpRow) return res.json({ success: false, error: 'No OTP found. Please request a new one.' });

      if (new Date(otpRow.expires_at) < new Date()) {
        await supabase.from('otp_sessions').delete().eq('phone', normalizedPhone);
        return res.json({ success: false, error: 'OTP expired. Please request a new one.' });
      }

      // Brute-force lockout
      if ((otpRow.attempts || 0) >= MAX_ATTEMPTS) {
        await supabase.from('otp_sessions').delete().eq('phone', normalizedPhone);
        return res.json({ success: false, error: 'Too many failed attempts. Please request a new OTP.' });
      }

      if (hashOtp(String(otp).trim()) !== otpRow.otp) {
        const newAttempts = (otpRow.attempts || 0) + 1;
        await supabase.from('otp_sessions').update({ attempts: newAttempts }).eq('phone', normalizedPhone);
        const left = MAX_ATTEMPTS - newAttempts;
        return res.json({ success: false, error: left > 0
          ? `Incorrect OTP. ${left} attempt${left === 1 ? '' : 's'} remaining.`
          : 'Too many failed attempts. Please request a new OTP.'
        });
      }

      // OTP verified — delete it
      await supabase.from('otp_sessions').delete().eq('phone', normalizedPhone);

      const verifiedEmail = otpRow.email || normalizedEmail;

      const { data: customer } = await supabase
        .from('customers')
        .select('name')
        .eq('phone', normalizedPhone)
        .single();
      const name = customer?.name || normalizedPhone;

      const sessionToken = crypto.randomUUID();
      const expiresAt    = new Date(Date.now() + SESSION_EXPIRY_MS).toISOString();

      await supabase.from('customer_sessions').insert({
        token:      sessionToken,
        phone:      normalizedPhone,
        email:      verifiedEmail,
        name,
        expires_at: expiresAt
      });

      return res.json({ success: true, token: sessionToken, phone: normalizedPhone, email: verifiedEmail, name });
    }

    if (action === 'logout') {
      if (token) await supabase.from('customer_sessions').delete().eq('token', token);
      return res.json({ success: true });
    }

    if (action === 'validate') {
      const session = await validateCustomerSession(token);
      return res.json({ valid: !!session, ...(session || {}) });
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

module.exports.validateCustomerSession = validateCustomerSession;
