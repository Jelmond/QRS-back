import { getAlphaOrderId } from "./getAlphaOrderId";
import { requestOptions } from "./getHeaders";

interface Payment {
    // Определите поля, которые есть в объекте payment
}

interface Order {
    id: number;
    price: number; // Добавьте поле для цены
}

export async function getPaymentLink(payment: Payment, order: Order): Promise<string> {
    const paymentUrl = process.env.PAYMENT_URL;
    const userName = process.env.ALPHA_USERNAME;
    const password = process.env.ALPHA_PASSWORD;
    const successUrl = process.env.RETURN_URL;
    const failureUrl = process.env.FAILURE_URL;

    const shiftedOrderId = getAlphaOrderId(order.id);

    const paymentInfo = await fetch(
        `${paymentUrl}register.do?amount=${order.price * 100}&userName=${userName}&password=${password}&orderNumber=${shiftedOrderId}&returnUrl=${encodeURIComponent(successUrl)}&failUrl=${encodeURIComponent(failureUrl)}&language=ru`,
        requestOptions
    );

    const paymentResult = await paymentInfo.text();

    console.log('результат оплаты', paymentResult);

    return paymentResult;
}