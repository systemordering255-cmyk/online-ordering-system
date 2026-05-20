const supabase = require('../lib/supabase');
const { validateAdminSession } = require('./admin-auth');
const { validateCustomerSession } = require('./customer-auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Customer profile
    if (req.query.profile) {
      const session = await validateCustomerSession(req.query.token);
      if (!session) return res.status(401).json({ error: 'Not logged in.' });

      const { data } = await supabase.from('customers').select('*').eq('phone', session.phone).single();
      return res.json(data || { phone: session.phone, email: session.email, name: session.name, total_orders: 0, total_spent: 0 });
    }

    // Admin: all customers
    const session = await validateAdminSession(req.query.token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });

    const { data } = await supabase.from('customers').select('*').order('last_order_date', { ascending: false });
    return res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
