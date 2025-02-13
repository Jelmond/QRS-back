import express from 'express';
import bodyParser from 'body-parser';
import { createClient } from '@supabase/supabase-js';
import { getPaymentLink } from './utils/processAlfaBankPayment';
import { getOrderPrice } from './utils/getOrderPrice';
import dotenv from 'dotenv';

dotenv.config(); // Загрузка переменных окружения

const app = express();
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(bodyParser.json());

app.post('/pay', async (req, res) => {
    const { payment, order, restaurantId } = req.body;

    try {
        // Расчет цены заказа
        const orderPrice = await getOrderPrice(order, restaurantId);

        const paymentResult = await getPaymentLink(payment, { ...order, price: orderPrice });

        // Сохранение информации о платеже в Supabase
        const { data, error } = await supabase
            .from('payments')
            .insert([
                { paymentId: paymentResult, orderId: order.id }
            ]);

        if (error) throw error;

        res.status(200).send({ success: true, paymentLink: paymentResult });
    } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
    }
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});