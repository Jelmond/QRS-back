import { getAlphaOrderId } from "./getAlphaOrderId";

interface Payment {
    description?: string;
}

interface Order {
    id: number;
    price: number;
}

// Alfa Bank's REST API takes form-encoded POST bodies. Credentials go in the
// body, never in the URL, so they don't end up in proxy or access logs.
async function alfaRequest(method: string, params: Record<string, string>): Promise<any> {
    const paymentUrl = process.env.PAYMENT_URL || '';
    const body = new URLSearchParams({
        userName: process.env.ALPHA_USERNAME || '',
        password: process.env.ALPHA_PASSWORD || '',
        ...params,
    });

    const response = await fetch(`${paymentUrl}${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    return response.json();
}

export async function getPaymentLink(payment: Payment, order: Order): Promise<any> {
    const shiftedOrderId = getAlphaOrderId(order.id);

    const paymentResult = await alfaRequest('register.do', {
        // Amount is in kopecks and must be an integer: 19.99 * 100 = 1998.9999…
        amount: String(Math.round(order.price * 100)),
        orderNumber: String(shiftedOrderId),
        returnUrl: process.env.RETURN_URL || '',
        failUrl: process.env.FAILURE_URL || '',
        description: payment.description || '',
        language: 'ru',
    });

    console.log('Payment register result:', { orderId: paymentResult?.orderId, errorCode: paymentResult?.errorCode });

    return paymentResult;
}

// orderStatus: 1 = amount on hold (two-stage payment), 2 = fully paid.
export async function isAlfaOrderPaid(alfaOrderId: string): Promise<boolean> {
    try {
        const status = await alfaRequest('getOrderStatusExtended.do', { orderId: alfaOrderId });
        return status?.orderStatus === 1 || status?.orderStatus === 2;
    } catch (error) {
        console.error('Alfa Bank status check failed:', error);
        return false;
    }
}
