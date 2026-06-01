const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const email    = require('../lib/email');

async function verifyPin(pin) {
  const { data } = await supabase.from('settings').select('value').eq('key', 'kitchen_pin').single();
  return String(pin) === String(data?.value || '1234');
}

async function getSettings() {
  const { data } = await supabase.from('settings').select('key, value');
  const s = {};
  (data || []).forEach(r => { s[r.key] = r.value; });
  return s;
}

async function generateAndSendOtp(orderId) {
  const { data: ord } = await supabase.from('orders').select('email, customer_name, collection_method').eq('order_id', orderId).single();
  if (!ord) return;

  const otp      = String(100000 + Math.floor(Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await supabase.from('delivery_otps').upsert({ order_id: orderId, otp, expires_at: expiresAt });

  const settings = await getSettings();
  email.sendDeliveryOtp({
    email: ord.email, customerName: ord.customer_name,
    orderId, otp, collectionMethod: ord.collection_method || 'Delivery', settings
  }).catch(() => {});
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, pin, orderId, reason } = req.body || {};

  try {
    if (!(await verifyPin(pin))) return res.json({ error: 'Wrong PIN' });

    if (action === 'get-orders') {
      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: stale } = await supabase
        .from('orders').select('*')
        .in('order_status', ['Pending', 'Confirmed', 'Preparing', 'Out for Delivery', 'Ready for Pickup'])
        .lt('created_at', cutoff);
      for (const ord of stale || []) {
        const items = Array.isArray(ord.items_json) ? ord.items_json : [];
        for (const item of items) {
          const { data: prod } = await supabase.from('products').select('stock').eq('id', item.id).single();
          await supabase.from('products').update({ stock: (prod?.stock || 0) + item.qty }).eq('id', item.id);
        }
        const ts = new Date().toLocaleString('en-IN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12: false });
        const note = `[${ts}] Auto-cancelled: not fulfilled within 1 hour`;
        await supabase.from('orders').update({
          order_status: 'Cancelled',
          notes: ord.notes ? `${ord.notes}\n${note}` : note
        }).eq('order_id', ord.order_id);
        const settings = await getSettings();
        email.sendCancellationEmail(ord.email, ord.customer_name, ord.order_id, 'Not fulfilled within 1 hour', settings).catch(() => {});
      }
      const { data } = await supabase
        .from('orders').select('*')
        .in('order_status', ['Pending', 'Confirmed', 'Preparing', 'Out for Delivery', 'Ready for Pickup'])
        .order('created_at', { ascending: false });
      return res.json(data || []);
    }

    if (action === 'get-owner-orders') {
      const { data } = await supabase
        .from('orders').select('*')
        .in('order_status', ['Pending', 'Confirmed', 'Preparing'])
        .order('created_at', { ascending: false });
      return res.json(data || []);
    }

    if (action === 'advance-status') {
      const { data: ord } = await supabase.from('orders').select('order_status, payment_method, payment_status, collection_method').eq('order_id', orderId).single();
      if (!ord) return res.json({ error: 'Order not found' });

      const isPickup = ord.collection_method === 'Pickup';
      const nextMap  = isPickup
        ? { 'Pending': 'Confirmed', 'Confirmed': 'Preparing', 'Preparing': 'Ready for Pickup' }
        : { 'Pending': 'Confirmed', 'Confirmed': 'Preparing', 'Preparing': 'Out for Delivery' };

      if (isPickup  && ord.order_status === 'Ready for Pickup')  return res.json({ error: 'Already ready for pickup.' });
      if (!isPickup && ord.order_status === 'Out for Delivery')   return res.json({ error: 'OTP_REQUIRED' });

      const nextStatus = nextMap[ord.order_status];
      if (!nextStatus) return res.json({ error: 'Already at final status.' });

      if (nextStatus === 'Out for Delivery' && ord.payment_method !== 'COD' && ord.payment_status !== 'Verified') {
        return res.json({ error: 'PAYMENT_NOT_VERIFIED' });
      }

      await supabase.from('orders').update({ order_status: nextStatus }).eq('order_id', orderId);

      let otpSent = false;
      if (nextStatus === 'Out for Delivery') {
        await generateAndSendOtp(orderId);
        otpSent = true;
      }

      return res.json({ success: true, otpSent });
    }

    if (action === 'pickup-handover') {
      const { data: ord } = await supabase.from('orders').select('order_status, payment_method, payment_status, notes').eq('order_id', orderId).single();
      if (!ord) return res.json({ error: 'Order not found.' });
      if (ord.order_status !== 'Ready for Pickup') return res.json({ error: 'Order is not ready for pickup.' });
      if (ord.payment_method === 'COD' && ord.payment_status !== 'Collected')
        return res.json({ error: 'CASH_NOT_COLLECTED' });

      const ts = new Date().toLocaleString('en-IN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12: false });
      const note = `[${ts}] Picked up by customer`;
      await supabase.from('orders').update({
        order_status: 'Delivered',
        notes: ord.notes ? `${ord.notes}\n${note}` : note
      }).eq('order_id', orderId);

      const settings = await getSettings();
      const { data: o } = await supabase.from('orders').select('email, customer_name').eq('order_id', orderId).single();
      if (o) email.sendStatusUpdate(o.email, o.customer_name, orderId, 'Delivered', settings).catch(() => {});

      return res.json({ success: true });
    }

    if (action === 'cancel') {
      const { data: ord } = await supabase.from('orders').select('*').eq('order_id', orderId).single();
      if (!ord) return res.json({ error: 'Order not found.' });

      const cancellable = ['Pending', 'Confirmed', 'Preparing'];
      if (!cancellable.includes(ord.order_status)) {
        return res.json({ error: `Cannot cancel an order that is "${ord.order_status}".` });
      }

      // Restore stock
      const items = Array.isArray(ord.items_json) ? ord.items_json : [];
      for (const item of items) {
        const { data: prod } = await supabase.from('products').select('stock').eq('id', item.id).single();
        await supabase.from('products').update({ stock: (prod?.stock || 0) + item.qty }).eq('id', item.id);
      }

      const ts = new Date().toLocaleString('en-IN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12: false });
      const note = `[${ts}] Cancelled by kitchen${reason ? ': ' + reason : ''}`;
      await supabase.from('orders').update({
        order_status: 'Cancelled',
        notes: ord.notes ? `${ord.notes}\n${note}` : note
      }).eq('order_id', orderId);

      const settings = await getSettings();
      email.sendCancellationEmail(ord.email, ord.customer_name, orderId, reason || '', settings).catch(() => {});

      return res.json({ success: true });
    }

    if (action === 'mark-cash-collected') {
      const { data: ord } = await supabase.from('orders').select('payment_method').eq('order_id', orderId).single();
      if (!ord) return res.json({ error: 'Order not found.' });
      if (ord.payment_method !== 'COD') return res.json({ error: 'Not a COD order.' });
      await supabase.from('orders').update({ payment_status: 'Collected' }).eq('order_id', orderId);
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
