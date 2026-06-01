const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const crypto = require('crypto');

const SESSION_HOURS = 8;

function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function generateToken() {
  return crypto.randomUUID();
}

async function validateAdminSession(token) {
  if (!token) return null;
  const { data } = await supabase
    .from('admin_sessions')
    .select('username, expires_at')
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

  const { action, token, username, password, oldPassword, newPassword } = req.body || {};

  try {
    if (action === 'login') {
      if (!username || !password) return res.json({ success: false, error: 'Missing credentials.' });

      const hash = sha256(password);
      const { data: user, error } = await supabase
        .from('admin_users')
        .select('username, password_hash, role')
        .ilike('username', username)
        .single();

      if (error || !user || user.password_hash !== hash) {
        return res.json({ success: false, error: 'Invalid username or password.' });
      }

      const newToken = generateToken();
      const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();

      await supabase.from('admin_sessions').insert({ token: newToken, username: user.username, expires_at: expiresAt });
      await supabase.from('admin_users').update({ last_login: new Date().toISOString() }).ilike('username', username);

      return res.json({ success: true, token: newToken, role: user.role, username: user.username });
    }

    if (action === 'logout') {
      if (token) await supabase.from('admin_sessions').delete().eq('token', token);
      return res.json({ success: true });
    }

    if (action === 'validate') {
      const session = await validateAdminSession(token);
      return res.json({ valid: !!session, username: session?.username, role: session?.role });
    }

    if (action === 'change-password') {
      const session = await validateAdminSession(token);
      if (!session) return res.json({ success: false, error: 'Unauthorized' });

      const { data: user } = await supabase
        .from('admin_users')
        .select('password_hash')
        .ilike('username', session.username)
        .single();

      if (!user || user.password_hash !== sha256(oldPassword)) {
        return res.json({ success: false, error: 'Current password is incorrect.' });
      }

      await supabase.from('admin_users')
        .update({ password_hash: sha256(newPassword) })
        .ilike('username', session.username);

      return res.json({ success: true });
    }

    if (action === 'hard-reset') {
      const session = await validateAdminSession(token);
      if (!session) return res.json({ success: false, error: 'Unauthorized' });

      const cutoff = new Date().toISOString();
      await supabase.from('delivery_otps').delete().lte('expires_at', cutoff);
      await supabase.from('otp_sessions').delete().lte('expires_at', new Date(Date.now() + 9999 * 86400000).toISOString());
      await supabase.from('customer_sessions').delete().lte('expires_at', new Date(Date.now() + 9999 * 86400000).toISOString());
      await supabase.from('inventory_log').delete().lte('created_at', cutoff);
      await supabase.from('order_items').delete().lte('created_at', cutoff);
      await supabase.from('customers').delete().lte('created_at', cutoff);
      await supabase.from('orders').delete().lte('created_at', cutoff);

      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

module.exports.validateAdminSession = validateAdminSession;
