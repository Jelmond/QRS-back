import dotenv from 'dotenv';
// Load environment variables before any other imports
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import { createClient } from '@supabase/supabase-js';
import { getPaymentLink } from './utils/processAlfaBankPayment';
import { getOrderPrice } from './utils/getOrderPrice';
import { Payment, Order } from './types/schemaTypes';
//@ts-expect-error
import cors from 'cors';


const app = express();
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors({
    origin: 'https://qrsharatspub.vercel.app', // <-- твой фронтенд-домен
    credentials: true
  }));

app.use(bodyParser.json());

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
    console.log('Supabase URL:', supabaseUrl ? 'Set' : 'Not set');
    console.log('Supabase Key:', supabaseKey ? 'Set (length: ' + supabaseKey.length + ')' : 'Not set');

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
            order_id: orderId,
            hash_id: paymentId,
            restaurant_id: order.restaurant_id,
            guest_profile_id: order.guest_profile_id,
            amount: orderPrice,
            status: 'pending',
            created_at: new Date()
        };

        const { data, error } = await supabase
            .from('payments')
            .insert([paymentData]);

        if (error) {
            throw new Error(`Failed to save payment: ${error.message}`);
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
        
        // Update payment status to success
        const { error: updateError } = await supabase
            .from('payments')
            .update({ 
                status: 'success',
                updated_at: new Date()
            })
            .eq('hash_id', orderId);
            
        if (updateError) throw updateError;
        
        // Log the successful payment
        await supabase
            .from('order_logs')
            .insert([{
                order_id: payment.order_id,
                action: 'payment_success',
                details: { 
                    payment_id: orderId,
                    amount: payment.amount
                }
            }]);
        
        // Redirect to client URL
        const baseClientUrl = process.env.BASE_CLIENT_URL || 'http://localhost:3000';
        res.redirect(`${baseClientUrl}/payment-success?orderId=${payment.order_id}`);
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
        
        // Update payment status to failure
        const { error: updateError } = await supabase
            .from('payments')
            .update({ 
                status: 'failure',
                updated_at: new Date()
            })
            .eq('hash_id', orderId);
            
        if (updateError) throw updateError;
        
        // Log the failed payment
        await supabase
            .from('order_logs')
            .insert([{
                order_id: payment.order_id,
                action: 'payment_failure',
                details: { 
                    payment_id: orderId,
                    amount: payment.amount
                }
            }]);
        
        // Redirect to client URL
        const baseClientUrl = process.env.BASE_CLIENT_URL || 'http://localhost:3000';
        res.redirect(`${baseClientUrl}/payment-failure?orderId=${payment.order_id}`);
    } catch (error: any) {
        console.error('Failure payment error:', error);
        
        // Redirect to client URL with error
        const baseClientUrl = process.env.BASE_CLIENT_URL || 'http://localhost:3000';
        res.redirect(`${baseClientUrl}/payment-error?message=${encodeURIComponent(error.message)}`);
    }
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});