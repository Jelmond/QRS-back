import dotenv from 'dotenv';
// Load environment variables before any other imports
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import swaggerUi from 'swagger-ui-express';
import { getPaymentLink } from './utils/processAlfaBankPayment';
import { Payment, Order } from './types/schemaTypes';
import { getSupabaseClient } from './db/supabaseClient';
import { syncIikoMenuToDatabase } from './pos/iiko/iikoSyncService';
import { swaggerSpec } from './docs/swagger';
import adminPosRouter from './routes/adminPos';
import adminRestaurantsRouter from './routes/adminRestaurants';
import publicRouter from './routes/public';
import guestProfileRouter from './routes/guestProfile';
import ordersRouter from './routes/orders';
import { adminAuth } from './middleware/adminAuth';
//@ts-expect-error
import cors from 'cors';

const app = express();
const supabase = getSupabaseClient();

const allowedOrigins = [
    'https://qrsharatspub.vercel.app',
    'https://qrsinc.by',
    'http://localhost:3000',
    'http://localhost:5173', // Vite dev server
  ];
  
const corsOptions = {
origin: function (origin: any, callback: any) {
    if (!origin || allowedOrigins.includes(origin)) {
    callback(null, true);
    } else {
    callback(new Error('Not allowed by CORS'));
    }
},
credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(bodyParser.json());

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/admin/pos', adminAuth, adminPosRouter);
app.use('/admin/restaurants', adminAuth, adminRestaurantsRouter);
app.use('/', publicRouter);
app.use('/guest-profile', guestProfileRouter);
app.use('/orders', ordersRouter);


// Test Supabase connection
app.get('/test-connection', async (req: any, res: any) => {
  console.log('Testing Supabase connection...');
  try {
    const { data, error } = await supabase.from('orders').select('count').limit(1);
    
    if (error) {
      console.error('Supabase connection error:', error);
      return res.status(500).send({ success: false, error: error.message });
    }
    
    console.log('Supabase connection successful:', data);
    return res.status(200).send({ success: true, message: 'Connection successful' });
  } catch (error: any) {
    console.error('Unexpected error testing connection:', error);
    return res.status(500).send({ success: false, error: error.message });
  }
});

app.post('/pay', async (req: any, res: any) => {
    const { orderId } = req.body;

    if (!orderId) {
        return res.status(400).send({ 
            success: false, 
            error: 'Missing required parameter: orderId' 
        });
    }

    console.log('orderId', orderId);

    try {
        console.log('Fetching order from database...');
        // Fetch the order from the database
        const { data: orderData, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();

        console.log('Query completed. Error:', orderError ? orderError.message : 'None');
        console.log('Data received:', orderData ? 'Yes' : 'No');

        if (orderError || !orderData) {
            throw new Error(`Order not found: ${orderError?.message || 'No data returned'}`);
        }

        console.log('orderData', orderData);

        const order = orderData as Order;

        // Calculate order price (or use the total from the order)
        const orderPrice = order.total;

        console.log('orderPrice', order.total)

        // Create payment object
        const payment = {
            description: `Order #${order.incremented_id || orderId}`
        };

        // Get payment link from Alfa Bank
        const paymentResult = await getPaymentLink(payment, { 
            id: order.incremented_id || 0, 
            price: orderPrice 
        });

        console.log('paymentResult', paymentResult);

        // Parse the payment result (assuming it's JSON now)
        let parsedResult;
        try {
            parsedResult = typeof paymentResult === 'string' ? JSON.parse(paymentResult) : paymentResult;
        } catch (e) {
            console.error('Failed to parse payment result:', paymentResult);
            throw new Error('Invalid payment response from payment gateway');
        }

        // Extract payment ID and form URL
        const paymentId = parsedResult.orderId;
        const paymentLink = parsedResult.formUrl;

        if (!paymentId || !paymentLink) {
            throw new Error('Invalid payment response: missing orderId or formUrl');
        }

        // Save payment information to Supabase
        const paymentData: Partial<Payment> = {
            hash_id: paymentId,
            restaurant_id: order.restaurant_id,
            guest_profile_id: order.guest_profile_id,
            amount: orderPrice,
            status: 'pending',
            created_at: new Date(),
            updated_at: new Date()
        };

        const { data, error } = await supabase
            .from('payments')
            .insert([paymentData])
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to save payment: ${error.message}`);
        }

        // Create order-payment link record
        const { error: linkError } = await supabase
            .from('order_payment_links')
            .insert([{
                order_id: orderId,
                payment_id: data.id
            }]);

        if (linkError) {
            throw new Error(`Failed to create order-payment link: ${linkError.message}`);
        }

        // Log the payment attempt
        await supabase
            .from('order_logs')
            .insert([{
                order_id: orderId,
                action: 'payment_initiated',
                details: { 
                    payment_id: paymentId,
                    amount: orderPrice
                }
            }]);

        res.status(200).send({ 
            success: true, 
            paymentLink: paymentLink,
            paymentId: paymentId
        });
    } catch (error: any) {
        console.error('Payment error:', error);
        
        // Log the payment error if we have an order ID
        if (req.body.orderId) {
            await supabase
                .from('order_logs')
                .insert([{
                    order_id: req.body.orderId,
                    action: 'payment_error',
                    details: { error: error.message }
                }]);
        }
        
        res.status(500).send({ success: false, error: error.message });
    }
});

// Add success payment endpoint
app.get('/success-payment', async (req: any, res: any) => {
    const orderId = req.query.orderId;
    
    // Check if orderId was passed
    if (!orderId) {
        return res.status(400).send({ 
            success: false, 
            error: 'Missing required parameter: orderId' 
        });
    }
    
    try {
        // Find the payment by external orderId (hash_id)
        const { data: payments, error: findError } = await supabase
            .from('payments')
            .select('*')
            .eq('hash_id', orderId);
            
        if (findError || !payments || payments.length === 0) {
            throw new Error(`Payment not found for orderId: ${orderId}`);
        }
        
        const payment = payments[0];

        // Look up the order linked to this payment
        const { data: link } = await supabase
            .from('order_payment_links')
            .select('order_id')
            .eq('payment_id', payment.id)
            .maybeSingle();

        const linkedOrderId = link?.order_id ?? null;

        // Update payment status to success
        const { error: updateError } = await supabase
            .from('payments')
            .update({ status: 'success', updated_at: new Date() })
            .eq('hash_id', orderId);

        if (updateError) throw updateError;

        // Update order status to completed
        if (linkedOrderId) {
            await supabase
                .from('orders')
                .update({ status: 'completed', updated_at: new Date().toISOString() })
                .eq('id', linkedOrderId);

            await supabase
                .from('order_logs')
                .insert([{
                    order_id: linkedOrderId,
                    action: 'payment_success',
                    details: { payment_id: orderId, amount: payment.amount }
                }]);
        }

        const baseClientUrl = process.env.BASE_CLIENT_URL || 'http://localhost:3000';
        res.redirect(`${baseClientUrl}/payment-success?orderId=${linkedOrderId ?? ''}`);
    } catch (error: any) {
        console.error('Success payment error:', error);
        
        // Redirect to client URL with error
        const baseClientUrl = process.env.BASE_CLIENT_URL || 'http://localhost:3000';
        res.redirect(`${baseClientUrl}/payment-error?message=${encodeURIComponent(error.message)}`);
    }
});

// Add failure payment endpoint
app.get('/fail-payment', async (req: any, res: any) => {
    const orderId = req.query.orderId;
    
    // Check if orderId was passed
    if (!orderId) {
        return res.status(400).send({ 
            success: false, 
            error: 'Missing required parameter: orderId' 
        });
    }
    
    try {
        // Find the payment by external orderId (hash_id)
        const { data: payments, error: findError } = await supabase
            .from('payments')
            .select('*')
            .eq('hash_id', orderId);
            
        if (findError || !payments || payments.length === 0) {
            throw new Error(`Payment not found for orderId: ${orderId}`);
        }
        
        const payment = payments[0];

        const { data: link } = await supabase
            .from('order_payment_links')
            .select('order_id')
            .eq('payment_id', payment.id)
            .maybeSingle();

        const linkedOrderId = link?.order_id ?? null;

        const { error: updateError } = await supabase
            .from('payments')
            .update({ status: 'failure', updated_at: new Date() })
            .eq('hash_id', orderId);

        if (updateError) throw updateError;

        if (linkedOrderId) {
            await supabase
                .from('order_logs')
                .insert([{
                    order_id: linkedOrderId,
                    action: 'payment_failure',
                    details: { payment_id: orderId, amount: payment.amount }
                }]);
        }

        const baseClientUrl = process.env.BASE_CLIENT_URL || 'http://localhost:3000';
        res.redirect(`${baseClientUrl}/payment-failure?orderId=${linkedOrderId ?? ''}`);
    } catch (error: any) {
        console.error('Failure payment error:', error);
        
        // Redirect to client URL with error
        const baseClientUrl = process.env.BASE_CLIENT_URL || 'http://localhost:3000';
        res.redirect(`${baseClientUrl}/payment-error?message=${encodeURIComponent(error.message)}`);
    }
});

// ── iiko menu sync ────────────────────────────────────────────────────────────
// Triggered from admin panel to pull latest nomenclature from iiko into Supabase.
app.post('/sync/iiko', async (req: any, res: any) => {
    const { restaurantId } = req.body;

    if (!restaurantId) {
        return res.status(400).send({ success: false, error: 'Missing required parameter: restaurantId' });
    }

    try {
        const result = await syncIikoMenuToDatabase(restaurantId);
        res.status(200).send({ success: true, ...result });
    } catch (error: any) {
        console.error('iiko sync error:', error);
        res.status(500).send({ success: false, error: error.message });
    }
});

const PORT = parseInt(process.env.PORT ?? '3000', 10);
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});