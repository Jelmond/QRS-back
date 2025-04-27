"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables before any other imports
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const supabase_js_1 = require("@supabase/supabase-js");
const processAlfaBankPayment_1 = require("./utils/processAlfaBankPayment");
//@ts-expect-error
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
app.use((0, cors_1.default)());
app.use(body_parser_1.default.json());
// Test Supabase connection
app.get('/test-connection', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Testing Supabase connection...');
    try {
        const { data, error } = yield supabase.from('orders').select('count').limit(1);
        if (error) {
            console.error('Supabase connection error:', error);
            return res.status(500).send({ success: false, error: error.message });
        }
        console.log('Supabase connection successful:', data);
        return res.status(200).send({ success: true, message: 'Connection successful' });
    }
    catch (error) {
        console.error('Unexpected error testing connection:', error);
        return res.status(500).send({ success: false, error: error.message });
    }
}));
app.post('/pay', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const { data: orderData, error: orderError } = yield supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();
        console.log('Query completed. Error:', orderError ? orderError.message : 'None');
        console.log('Data received:', orderData ? 'Yes' : 'No');
        if (orderError || !orderData) {
            throw new Error(`Order not found: ${(orderError === null || orderError === void 0 ? void 0 : orderError.message) || 'No data returned'}`);
        }
        console.log('orderData', orderData);
        const order = orderData;
        // Calculate order price (or use the total from the order)
        const orderPrice = order.total;
        // Create payment object
        const payment = {
            description: `Order #${order.incremented_id || orderId}`
        };
        // Get payment link from Alfa Bank
        const paymentResult = yield (0, processAlfaBankPayment_1.getPaymentLink)(payment, {
            id: order.incremented_id || 0,
            price: orderPrice
        });
        console.log('paymentResult', paymentResult);
        // Parse the payment result (assuming it's JSON now)
        let parsedResult;
        try {
            parsedResult = typeof paymentResult === 'string' ? JSON.parse(paymentResult) : paymentResult;
        }
        catch (e) {
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
        const paymentData = {
            order_id: orderId,
            hash_id: paymentId,
            restaurant_id: order.restaurant_id,
            guest_profile_id: order.guest_profile_id,
            amount: orderPrice,
            status: 'pending',
            created_at: new Date()
        };
        const { data, error } = yield supabase
            .from('payments')
            .insert([paymentData]);
        if (error) {
            throw new Error(`Failed to save payment: ${error.message}`);
        }
        // Log the payment attempt
        yield supabase
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
    }
    catch (error) {
        console.error('Payment error:', error);
        // Log the payment error if we have an order ID
        if (req.body.orderId) {
            yield supabase
                .from('order_logs')
                .insert([{
                    order_id: req.body.orderId,
                    action: 'payment_error',
                    details: { error: error.message }
                }]);
        }
        res.status(500).send({ success: false, error: error.message });
    }
}));
// Add success payment endpoint
app.get('/success-payment', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const { data: payments, error: findError } = yield supabase
            .from('payments')
            .select('*')
            .eq('hash_id', orderId);
        if (findError || !payments || payments.length === 0) {
            throw new Error(`Payment not found for orderId: ${orderId}`);
        }
        const payment = payments[0];
        // Update payment status to success
        const { error: updateError } = yield supabase
            .from('payments')
            .update({
            status: 'success',
            updated_at: new Date()
        })
            .eq('hash_id', orderId);
        if (updateError)
            throw updateError;
        // Log the successful payment
        yield supabase
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
    }
    catch (error) {
        console.error('Success payment error:', error);
        // Redirect to client URL with error
        const baseClientUrl = process.env.BASE_CLIENT_URL || 'http://localhost:3000';
        res.redirect(`${baseClientUrl}/payment-error?message=${encodeURIComponent(error.message)}`);
    }
}));
// Add failure payment endpoint
app.get('/fail-payment', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const { data: payments, error: findError } = yield supabase
            .from('payments')
            .select('*')
            .eq('hash_id', orderId);
        if (findError || !payments || payments.length === 0) {
            throw new Error(`Payment not found for orderId: ${orderId}`);
        }
        const payment = payments[0];
        // Update payment status to failure
        const { error: updateError } = yield supabase
            .from('payments')
            .update({
            status: 'failure',
            updated_at: new Date()
        })
            .eq('hash_id', orderId);
        if (updateError)
            throw updateError;
        // Log the failed payment
        yield supabase
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
    }
    catch (error) {
        console.error('Failure payment error:', error);
        // Redirect to client URL with error
        const baseClientUrl = process.env.BASE_CLIENT_URL || 'http://localhost:3000';
        res.redirect(`${baseClientUrl}/payment-error?message=${encodeURIComponent(error.message)}`);
    }
}));
app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
