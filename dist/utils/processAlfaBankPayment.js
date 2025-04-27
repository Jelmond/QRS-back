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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymentLink = getPaymentLink;
const getAlphaOrderId_1 = require("./getAlphaOrderId");
const getHeaders_1 = require("./getHeaders");
function getPaymentLink(payment, order) {
    return __awaiter(this, void 0, void 0, function* () {
        const paymentUrl = process.env.PAYMENT_URL || '';
        const userName = process.env.ALPHA_USERNAME || '';
        const password = process.env.ALPHA_PASSWORD || '';
        const successUrl = process.env.RETURN_URL || '';
        const failureUrl = process.env.FAILURE_URL || '';
        const shiftedOrderId = (0, getAlphaOrderId_1.getAlphaOrderId)(order.id);
        const paymentInfo = yield fetch(`${paymentUrl}register.do?amount=${order.price * 100}&userName=${userName}&password=${password}&orderNumber=${shiftedOrderId}&returnUrl=${encodeURIComponent(successUrl)}&failUrl=${encodeURIComponent(failureUrl)}&language=ru`, getHeaders_1.requestOptions);
        const paymentResult = yield paymentInfo.json();
        console.log('Payment result:', paymentResult);
        return paymentResult;
    });
}
