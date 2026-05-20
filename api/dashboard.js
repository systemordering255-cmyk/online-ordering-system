const supabase = require('../lib/supabase');
const { validateAdminSession } = require('./admin-auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const session = await validateAdminSession(req.query.token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [todayRes, pendingRes, lowStockRes, recentRes] = await Promise.all([
      supabase.from('orders').select('total')
        .gte('created_at', todayStart.toISOString())
        .lte('created_at', todayEnd.toISOString())
        .neq('order_status', 'Cancelled'),

      supabase.from('orders').select('order_id', { count: 'exact' })
        .eq('order_status', 'Pending'),

      supabase.from('products').select('name, stock')
        .eq('active', true).lt('stock', 10),

      supabase.from('orders').select('*')
        .order('created_at', { ascending: false }).limit(10)
    ]);

    const todayOrders  = todayRes.data?.length || 0;
    const todayRevenue = (todayRes.data || []).reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
    const pendingOrders = pendingRes.count || 0;

    return res.json({
      todayOrders,
      todayRevenue,
      pendingOrders,
      lowStock:     lowStockRes.data || [],
      recentOrders: recentRes.data  || []
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
