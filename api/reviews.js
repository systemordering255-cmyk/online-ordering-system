const supabase = require('../lib/supabase');
const { validateAdminSession } = require('./admin-auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Public: get approved reviews
    if (req.method === 'GET' && !req.query.admin) {
      const { data } = await supabase
        .from('reviews')
        .select('customer_name, rating, comment, created_at')
        .eq('approved', true)
        .order('created_at', { ascending: false })
        .limit(20);
      return res.json(data || []);
    }

    // Admin: get all reviews
    if (req.method === 'GET' && req.query.admin) {
      const session = await validateAdminSession(req.query.token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });
      const { data, error } = await supabase.from('reviews').select('*').order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (req.method === 'POST') {
      const { action, token, orderId, rating, comment, reviewId, approved } = req.body || {};

      if (action === 'submit') {
        const { data: ord } = await supabase
          .from('orders').select('order_status, customer_name').eq('order_id', orderId).single();
        if (!ord) return res.json({ success: false, error: 'Order not found.' });
        if (ord.order_status !== 'Delivered') return res.json({ success: false, error: 'Reviews can only be left for delivered orders.' });

        const r = parseInt(rating);
        if (!r || r < 1 || r > 5) return res.json({ success: false, error: 'Please select a star rating.' });

        const { data: existing } = await supabase.from('reviews').select('id').eq('order_id', orderId).single();
        if (existing) return res.json({ success: false, error: 'A review has already been submitted for this order.' });

        await supabase.from('reviews').insert({
          order_id: orderId, customer_name: ord.customer_name,
          rating: r, comment: (comment || '').trim(), approved: false
        });
        return res.json({ success: true });
      }

      if (action === 'check-exists') {
        const { data } = await supabase.from('reviews').select('id').eq('order_id', orderId).single();
        return res.json({ exists: !!data });
      }

      if (action === 'set-approval') {
        const session = await validateAdminSession(token);
        if (!session) return res.status(401).json({ error: 'Unauthorized' });
        await supabase.from('reviews').update({ approved }).eq('id', reviewId);
        return res.json({ success: true });
      }

      if (action === 'delete') {
        const session = await validateAdminSession(token);
        if (!session) return res.status(401).json({ error: 'Unauthorized' });
        await supabase.from('reviews').delete().eq('id', reviewId);
        return res.json({ success: true });
      }
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
