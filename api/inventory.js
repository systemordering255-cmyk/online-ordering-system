const supabase = require('../lib/supabase');
const { validateAdminSession } = require('./admin-auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const session = await validateAdminSession(req.query.token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      const { data } = await supabase
        .from('inventory_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      return res.json(data || []);
    }

    if (req.method === 'POST') {
      const { token, productId, delta, reason } = req.body;
      const session = await validateAdminSession(token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      const { data: prod } = await supabase
        .from('products').select('stock, name').eq('id', productId).single();
      if (!prod) return res.json({ success: false, error: 'Product not found.' });

      const newStock = prod.stock + parseInt(delta);
      if (newStock < 0) return res.json({ success: false, error: 'Stock cannot go below 0.' });

      await supabase.from('products').update({ stock: newStock }).eq('id', productId);
      await supabase.from('inventory_log').insert({
        product_id: productId, product_name: prod.name,
        change_type: reason || 'Manual adjustment',
        qty_before: prod.stock, qty_after: newStock,
        changed_by: session.username
      });

      return res.json({ success: true, newStock });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
