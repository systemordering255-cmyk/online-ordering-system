const supabase = require('../lib/supabase');
const crypto = require('crypto');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const OTP_EXPIRY_MS     = 15 * 60 * 1000;  // 15 minutes
const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, phone, email, otp, token } = req.body || {};

  try {
    if (action === 'send-otp') {
      const normalizedPhone = normalizePhone(phone);
      if (!email || !email.includes('@')) {
        return res.json({ success: false, error: 'Please enter a valid email address.' });
      }
      const normalizedEmail = email.trim().toLowerCase();

      const otpCode  = String(100000 + Math.floor(Math.random() * 900000));
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();

      // Delete any existing OTP for this phone
      await supabase.from('otp_sessions').delete().eq('phone', normalizedPhone);

      // Store new OTP
      await supabase.from('otp_sessions').insert({
        phone: normalizedPhone,
        email: normalizedEmail,
        otp: otpCode,
        expires_at: expiresAt
      });

      const bizName = await getBusinessName();

      await resend.emails.send({
        from:    `${bizName} <onboarding@resend.dev>`,
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
        .select('otp, expires_at, email')
        .eq('phone', normalizedPhone)
        .single();

      if (!otpRow) return res.json({ success: false, error: 'No OTP found. Please request a new one.' });
      if (new Date(otpRow.expires_at) < new Date()) {
        await supabase.from('otp_sessions').delete().eq('phone', normalizedPhone);
        return res.json({ success: false, error: 'OTP expired. Please request a new one.' });
      }
      if (String(otp).trim() !== String(otpRow.otp)) {
        return res.json({ success: false, error: 'Incorrect OTP. Please try again.' });
      }

      // OTP verified — delete it
      await supabase.from('otp_sessions').delete().eq('phone', normalizedPhone);

      const verifiedEmail = otpRow.email || normalizedEmail;

      // Look up customer name
      const { data: customer } = await supabase
        .from('customers')
        .select('name')
        .eq('phone', normalizedPhone)
        .single();
      const name = customer?.name || normalizedPhone;

      // Create session
      const sessionToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS).toISOString();

      await supabase.from('customer_sessions').insert({
        token: sessionToken,
        phone: normalizedPhone,
        email: verifiedEmail,
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
