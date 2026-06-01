const guard = require('../lib/guard');
const supabase = require('../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    if (req.method === 'GET') {
      const { admin, token } = req.query;

      if (admin) {
        // Admin: return all products including inactive
        const session = await validateAdminSession(token);
        if (!session) return res.status(401).json({ error: 'Unauthorized' });

        const { data, error } = await supabase
          .from('products')
          .select('*')
          .order('id');
        if (error) throw error;
        return res.json(data);
      }

      // Public: active products only
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('active', true)
        .order('category')
        .order('name');
      if (error) throw error;
      return res.json(data);
    }

    if (req.method === 'POST') {
      const { token, product } = req.body;
      const session = await validateAdminSession(token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      const p = {
        name:        product.name,
        category:    product.category || '',
        description: product.description || '',
        unit:        product.unit || '',
        price:       parseFloat(product.price) || 0,
        stock:       parseInt(product.stock) || 0,
        image_url:   product.imageUrl || product.image_url || '',
        active:      product.active !== false
      };

      if (product.id) {
        const { error } = await supabase
          .from('products')
          .update(p)
          .eq('id', product.id);
        if (error) throw error;
        return res.json({ success: true, id: product.id });
      }

      const { data, error } = await supabase
        .from('products')
        .insert(p)
        .select('id')
        .single();
      if (error) throw error;
      return res.json({ success: true, id: data.id });
    }

    if (req.method === 'DELETE') {
      const { token, productId } = req.body;
      const session = await validateAdminSession(token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', productId);
      if (error) throw error;
      return res.json({ success: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

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
