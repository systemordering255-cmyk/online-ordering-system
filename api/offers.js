const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { validateAdminSession } = require('./admin-auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    const now = new Date().toISOString();

    // GET /api/offers — active offers right now (public, used by cart)
    if (req.method === 'GET' && !req.query.admin) {
      const { data } = await supabase
        .from('offers')
        .select('id, name, description, discount_type, discount_value, apply_to, product_id, category, min_order, valid_from, valid_to, max_uses, uses_count')
        .eq('active', true)
        .lte('valid_from', now)
        .gte('valid_to', now)
        .order('discount_value', { ascending: false });

      const valid = (data || []).filter(o => o.max_uses === null || o.uses_count < o.max_uses);
      return res.json(valid);
    }

    // GET /api/offers?admin=true&token=xxx — all offers for admin panel
    if (req.method === 'GET' && req.query.admin) {
      const session = await validateAdminSession(req.query.token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });
      const { data } = await supabase.from('offers').select('*').order('created_at', { ascending: false });
      return res.json(data || []);
    }

    if (req.method === 'POST') {
      const { action, token } = req.body;
      const session = await validateAdminSession(token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      if (action === 'create') {
        const o = req.body.offer;
        if (!o.name || !o.discount_type || !o.discount_value || !o.valid_from || !o.valid_to)
          return res.json({ success: false, error: 'Missing required fields.' });
        if (new Date(o.valid_to) <= new Date(o.valid_from))
          return res.json({ success: false, error: 'End date must be after start date.' });

        const { error } = await supabase.from('offers').insert({
          name:           o.name.trim(),
          description:    o.description?.trim() || '',
          discount_type:  o.discount_type,
          discount_value: parseFloat(o.discount_value),
          apply_to:       o.apply_to || 'order',
          product_id:     o.product_id ? parseInt(o.product_id) : null,
          category:       o.category?.trim() || '',
          min_order:      parseFloat(o.min_order) || 0,
          valid_from:     new Date(o.valid_from).toISOString(),
          valid_to:       new Date(o.valid_to).toISOString(),
          active:         true,
          max_uses:       o.max_uses ? parseInt(o.max_uses) : null,
          uses_count:     0
        });
        if (error) throw error;
        return res.json({ success: true });
      }

      if (action === 'update') {
        const o = req.body.offer;
        if (new Date(o.valid_to) <= new Date(o.valid_from))
          return res.json({ success: false, error: 'End date must be after start date.' });

        const { error } = await supabase.from('offers').update({
          name:           o.name.trim(),
          description:    o.description?.trim() || '',
          discount_type:  o.discount_type,
          discount_value: parseFloat(o.discount_value),
          apply_to:       o.apply_to || 'order',
          product_id:     o.product_id ? parseInt(o.product_id) : null,
          category:       o.category?.trim() || '',
          min_order:      parseFloat(o.min_order) || 0,
          valid_from:     new Date(o.valid_from).toISOString(),
          valid_to:       new Date(o.valid_to).toISOString(),
          max_uses:       o.max_uses ? parseInt(o.max_uses) : null
        }).eq('id', req.body.offerId);
        if (error) throw error;
        return res.json({ success: true });
      }

      if (action === 'toggle') {
        const { error } = await supabase.from('offers').update({ active: req.body.active }).eq('id', req.body.offerId);
        if (error) throw error;
        return res.json({ success: true });
      }

      if (action === 'delete') {
        await supabase.from('offers').delete().eq('id', req.body.offerId);
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
