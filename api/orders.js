const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const email    = require('../lib/email');
const { validateAdminSession } = require('./admin-auth');
const { validateCustomerSession } = require('./customer-auth');

function generateOrderId() {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `ORD-${ts}-${rand}`;
}

async function getSettings() {
  const { data } = await supabase.from('settings').select('key, value');
  const s = {};
  (data || []).forEach(r => { s[r.key] = r.value; });
  return s;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    // GET /api/orders?orderId=xxx  → track order
    if (req.method === 'GET' && req.query.orderId) {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('order_id', req.query.orderId)
        .single();
      if (error || !data) return res.json({ found: false });
      return res.json({ found: true, ...data });
    }

    // GET /api/orders?phone=xxx&token=xxx  → my orders (customer)
    if (req.method === 'GET' && req.query.phone) {
      const session = await validateCustomerSession(req.query.token);
      if (!session) return res.status(401).json({ error: 'Not logged in.' });
      const norm = String(req.query.phone).replace(/\D/g, '').slice(-10);
      const { data } = await supabase
        .from('orders')
        .select('order_id, created_at, total, order_status, payment_status')
        .ilike('phone', `%${norm}`)
        .order('created_at', { ascending: false });
      return res.json(data || []);
    }

    // GET /api/orders?myOrders=true&token=xxx  → my orders by session (no phone needed)
    if (req.method === 'GET' && req.query.myOrders) {
      const session = await validateCustomerSession(req.query.token);
      if (!session) return res.status(401).json({ error: 'Not logged in.' });
      const norm = String(session.phone).replace(/\D/g, '').slice(-10);
      const { data } = await supabase
        .from('orders')
        .select('order_id, created_at, total, order_status, payment_status')
        .ilike('phone', `%${norm}`)
        .order('created_at', { ascending: false });
      return res.json(data || []);
    }

    // GET /api/orders?deliveryOtp=orderId&token=xxx  → delivery OTP for tracking page
    if (req.method === 'GET' && req.query.deliveryOtp) {
      const orderId = req.query.deliveryOtp;
      const { data: ord } = await supabase
        .from('orders').select('order_id, order_status, email, collection_method')
        .eq('order_id', orderId).single();
      if (!ord || ord.order_status !== 'Out for Delivery') return res.json({ available: false });

      const custToken = req.query.token || '';
      if (!custToken) return res.json({ authRequired: true });

      const session = await validateCustomerSession(custToken);
      if (!session) return res.json({ authRequired: true });
      if (session.email !== ord.email) return res.json({ notOwner: true });

      const { data: otpRow } = await supabase
        .from('delivery_otps').select('otp, expires_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(1).single();
      if (!otpRow || new Date(otpRow.expires_at) < new Date()) return res.json({ available: false });
      return res.json({ available: true, otp: otpRow.otp });
    }

    // GET /api/orders?dashboard=true&token=xxx
    if (req.method === 'GET' && req.query.dashboard) {
      const session = await validateAdminSession(req.query.token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999);
      const [todayRes, pendingRes, lowStockRes, recentRes] = await Promise.all([
        supabase.from('orders').select('total').gte('created_at', todayStart.toISOString()).lte('created_at', todayEnd.toISOString()).neq('order_status','Cancelled'),
        supabase.from('orders').select('order_id', { count:'exact' }).eq('order_status','Pending'),
        supabase.from('products').select('name, stock').eq('active', true).lt('stock', 10),
        supabase.from('orders').select('*').order('created_at',{ ascending:false }).limit(10)
      ]);
      return res.json({
        todayOrders:   todayRes.data?.length || 0,
        todayRevenue:  (todayRes.data||[]).reduce((s,o) => s + (parseFloat(o.total)||0), 0),
        pendingOrders: pendingRes.count || 0,
        lowStock:      lowStockRes.data || [],
        recentOrders:  recentRes.data  || []
      });
    }

    // GET /api/orders?admin=true&token=xxx  → all orders (admin), with optional sub-queries
    if (req.method === 'GET' && req.query.admin) {
      const session = await validateAdminSession(req.query.token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      // Customer orders by email (for admin customer modal)
      if (req.query.email) {
        const { data } = await supabase
          .from('orders').select('order_id, created_at, total, order_status')
          .eq('email', req.query.email).order('created_at', { ascending: false });
        return res.json(data || []);
      }

      // Pending online payments
      if (req.query.pendingPayments) {
        const { data } = await supabase
          .from('orders').select('*')
          .eq('payment_status', 'Pending Verification')
          .neq('order_status', 'Cancelled')
          .order('created_at', { ascending: false });
        return res.json(data || []);
      }

      // Order report with optional date range
      if (req.query.report) {
        let query = supabase.from('orders').select('*').order('created_at', { ascending: false });
        if (req.query.from) query = query.gte('created_at', req.query.from + 'T00:00:00');
        if (req.query.to)   query = query.lte('created_at', req.query.to   + 'T23:59:59');
        const { data } = await query;
        const settings = await getSettings();
        return res.json({ orders: data || [], settings });
      }

      // All orders with filters
      let query = supabase.from('orders').select('*').order('created_at', { ascending: false });
      if (req.query.orderStatus)      query = query.eq('order_status', req.query.orderStatus);
      if (req.query.paymentStatus)    query = query.eq('payment_status', req.query.paymentStatus);
      if (req.query.collectionMethod) query = query.eq('collection_method', req.query.collectionMethod);
      if (req.query.date)             query = query.gte('created_at', req.query.date + 'T00:00:00').lte('created_at', req.query.date + 'T23:59:59');

      const { data } = await query;
      return res.json(data || []);
    }

    if (req.method === 'POST') {
      const { action, token } = req.body;

      // Place order
      if (action === 'place') {
        const d = req.body;
        if (!d.customerName || !d.phone || !d.email || !d.address || !d.items?.length) {
          return res.json({ success: false, error: 'Missing required fields.' });
        }

        const settings         = await getSettings();
        const collectionMethod = d.collectionMethod || 'Delivery';
        const deliveryFee      = collectionMethod === 'Pickup' ? 0 : (parseFloat(settings.delivery_fee) || 0);
        const minOrder         = parseFloat(settings.minimum_order) || 0;

        // Store open/closed check
        if (settings.store_open === 'false') {
          return res.json({ success: false, error: 'Store is currently closed. Please try again later.' });
        }
        if (settings.open_time && settings.close_time) {
          const now      = new Date();
          const openDays = (settings.open_days || '0,1,2,3,4,5,6').split(',').map(Number);
          if (!openDays.includes(now.getDay())) {
            return res.json({ success: false, error: 'Store is closed today. See you next time!' });
          }
          const [oh, om] = settings.open_time.split(':').map(Number);
          const [ch, cm] = settings.close_time.split(':').map(Number);
          const nowMins  = now.getHours() * 60 + now.getMinutes();
          if (nowMins < oh * 60 + om || nowMins >= ch * 60 + cm) {
            const fmt = t => { const [h,m]=t.split(':'); const hh=+h; return (hh%12||12)+':'+m+(hh<12?' AM':' PM'); };
            return res.json({ success: false, error: `Store is closed. We\'re open ${fmt(settings.open_time)} – ${fmt(settings.close_time)}.` });
          }
        }

        // Validate stock and build items
        let subtotal = 0;
        const validatedItems = [];
        for (const item of d.items) {
          const { data: product } = await supabase
            .from('products').select('*').eq('id', item.id).single();
          if (!product) return res.json({ success: false, error: `Product not found: ${item.id}` });
          if (product.stock < item.qty) {
            return res.json({ success: false, error: `"${product.name}" only has ${product.stock} left in stock.` });
          }
          const lineTotal = product.price * item.qty;
          subtotal += lineTotal;
          validatedItems.push({ id: product.id, name: product.name, qty: item.qty, price: product.price, lineTotal });
        }

        if (subtotal < minOrder) {
          return res.json({ success: false, error: `Minimum order amount is Rs.${minOrder}.` });
        }

        // Apply best valid offer (server-side, never trust client)
        let discountAmount = 0, appliedOfferId = null, appliedOfferName = '';
        const nowIso = new Date().toISOString();
        const { data: activeOffers } = await supabase.from('offers')
          .select('*').eq('active', true).lte('valid_from', nowIso).gte('valid_to', nowIso);
        for (const offer of (activeOffers || [])) {
          if (offer.max_uses !== null && offer.uses_count >= offer.max_uses) continue;
          if (subtotal < parseFloat(offer.min_order || 0)) continue;
          if (offer.apply_to === 'product') {
            if (!validatedItems.some(i => String(i.id) === String(offer.product_id))) continue;
          } else if (offer.apply_to === 'category') {
            const { data: catProds } = await supabase.from('products').select('id').eq('category', offer.category).in('id', validatedItems.map(i => i.id));
            if (!catProds || !catProds.length) continue;
          }
          let disc = offer.discount_type === 'percent'
            ? subtotal * (parseFloat(offer.discount_value) / 100)
            : parseFloat(offer.discount_value);
          disc = Math.min(Math.round(disc * 100) / 100, subtotal);
          if (disc > discountAmount) {
            discountAmount = disc; appliedOfferId = offer.id; appliedOfferName = offer.name;
          }
        }

        const total         = Math.max(0, subtotal + deliveryFee - discountAmount);
        const paymentStatus = d.paymentMethod === 'COD' ? 'Pending Collection' : 'Pending Verification';
        const orderId       = generateOrderId();

        // Insert order
        const { error: orderInsertError } = await supabase.from('orders').insert({
          order_id:          orderId,
          customer_name:     d.customerName,
          phone:             d.phone,
          email:             d.email,
          address:           d.address,
          items_json:        validatedItems,
          subtotal,
          delivery_fee:      deliveryFee,
          discount_amount:   discountAmount,
          offer_id:          appliedOfferId,
          offer_name:        appliedOfferName,
          total,
          payment_method:    d.paymentMethod,
          payment_status:    paymentStatus,
          order_status:      'Pending',
          notes:             d.notes || '',
          utr:               d.utr   || '',
          collection_method: collectionMethod
        });
        if (orderInsertError) throw orderInsertError;

        // Insert order items
        await supabase.from('order_items').insert(
          validatedItems.map(vi => ({
            order_id: orderId, product_id: vi.id, product_name: vi.name,
            qty: vi.qty, unit_price: vi.price, line_total: vi.lineTotal
          }))
        );

        // Deduct stock + log inventory
        for (const vi of validatedItems) {
          const { data: prod } = await supabase.from('products').select('stock').eq('id', vi.id).single();
          const newStock = (prod?.stock || 0) - vi.qty;
          await supabase.from('products').update({ stock: newStock }).eq('id', vi.id);
          await supabase.from('inventory_log').insert({
            product_id: vi.id, product_name: vi.name,
            change_type: `Order ${orderId}`,
            qty_before: prod?.stock || 0, qty_after: newStock,
            changed_by: 'system'
          });
        }

        // Upsert customer
        const { data: existing } = await supabase
          .from('customers').select('total_orders, total_spent').eq('email', d.email).single();
        if (existing) {
          await supabase.from('customers').update({
            total_orders:    (existing.total_orders || 0) + 1,
            total_spent:     (parseFloat(existing.total_spent) || 0) + total,
            last_order_date: new Date().toISOString()
          }).eq('email', d.email);
        } else {
          await supabase.from('customers').insert({
            email: d.email, name: d.customerName, phone: d.phone,
            total_orders: 1, total_spent: total, last_order_date: new Date().toISOString()
          });
        }

        // Increment offer uses count
        if (appliedOfferId) {
          const { data: offerRow } = await supabase.from('offers').select('uses_count').eq('id', appliedOfferId).single();
          if (offerRow) await supabase.from('offers').update({ uses_count: offerRow.uses_count + 1 }).eq('id', appliedOfferId);
        }

        // Send emails (non-blocking)
        const orderData = { orderId, customerName: d.customerName, email: d.email, phone: d.phone,
          address: d.address, items: validatedItems, subtotal, deliveryFee, discountAmount,
          appliedOfferName, total, paymentMethod: d.paymentMethod, utr: d.utr || '', collectionMethod, settings };
        email.sendOrderConfirmation(orderData).catch(() => {});
        email.sendOwnerAlert(orderData).catch(() => {});

        return res.json({ success: true, orderId, total, discountAmount, offerName: appliedOfferName });
      }

      // Update order status (admin)
      if (action === 'update-status') {
        const session = await validateAdminSession(token);
        if (!session) return res.status(401).json({ error: 'Unauthorized' });

        const { orderId, orderStatus, paymentStatus, note } = req.body;
        const updates = {};
        if (orderStatus)   updates.order_status   = orderStatus;
        if (paymentStatus) updates.payment_status = paymentStatus;
        if (note) {
          const { data: ord } = await supabase.from('orders').select('notes').eq('order_id', orderId).single();
          const ts = new Date().toLocaleString('en-IN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12: false });
          updates.notes = ord?.notes ? `${ord.notes}\n[${ts}] ${note}` : `[${ts}] ${note}`;
        }

        await supabase.from('orders').update(updates).eq('order_id', orderId);

        // Send status email for key milestones
        if (orderStatus === 'Confirmed' || orderStatus === 'Delivered') {
          const { data: ord } = await supabase.from('orders').select('email, customer_name').eq('order_id', orderId).single();
          const settings = await getSettings();
          if (ord) email.sendStatusUpdate(ord.email, ord.customer_name, orderId, orderStatus, settings).catch(() => {});
        }

        return res.json({ success: true });
      }

      // Cancel order (customer)
      if (action === 'cancel') {
        const session = await validateCustomerSession(token);
        if (!session) return res.status(401).json({ error: 'Not logged in.' });

        const { orderId } = req.body;
        const { data: ord } = await supabase.from('orders').select('*').eq('order_id', orderId).single();
        if (!ord) return res.json({ error: 'Order not found.' });

        const orderPhone = String(ord.phone).replace(/\D/g, '').slice(-10);
        const custPhone  = String(session.phone).replace(/\D/g, '').slice(-10);
        if (orderPhone !== custPhone) return res.json({ error: 'Order not found.' });
        if (ord.order_status !== 'Pending') return res.json({ error: `This order cannot be cancelled as it is already ${ord.order_status}.` });

        const elapsedMs = Date.now() - new Date(ord.created_at).getTime();
        if (elapsedMs > 10 * 60 * 1000) return res.json({ error: 'Cancellation window has closed. Orders can only be cancelled within 10 minutes of placing.' });

        // Restore stock
        const items = Array.isArray(ord.items_json) ? ord.items_json : [];
        for (const item of items) {
          const { data: prod } = await supabase.from('products').select('stock').eq('id', item.id).single();
          await supabase.from('products').update({ stock: (prod?.stock || 0) + item.qty }).eq('id', item.id);
        }

        const ts = new Date().toLocaleString('en-IN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12: false });
        await supabase.from('orders').update({
          order_status: 'Cancelled',
          notes: ord.notes ? `${ord.notes}\n[${ts}] Cancelled by customer` : `[${ts}] Cancelled by customer`
        }).eq('order_id', orderId);

        const settings = await getSettings();
        email.sendCancellationEmail(ord.email, ord.customer_name, orderId, '', settings, 'customer').catch(() => {});

        return res.json({ success: true });
      }

      // Confirm payment (admin)
      if (action === 'confirm-payment') {
        const session = await validateAdminSession(token);
        if (!session) return res.status(401).json({ error: 'Unauthorized' });

        const { orderId, transactionId } = req.body;
        const { data: ord } = await supabase.from('orders').select('*').eq('order_id', orderId).single();
        if (!ord) return res.json({ error: 'Order not found.' });
        if (ord.payment_method === 'COD') return res.json({ error: 'COD orders do not require payment confirmation.' });

        const updates = { payment_status: 'Verified' };
        if (transactionId) updates.utr = String(transactionId).trim();
        if (ord.order_status === 'Pending') {
          updates.order_status = 'Confirmed';
          const settings = await getSettings();
          email.sendStatusUpdate(ord.email, ord.customer_name, orderId, 'Confirmed', settings).catch(() => {});
        }

        await supabase.from('orders').update(updates).eq('order_id', orderId);
        return res.json({ success: true });
      }
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
