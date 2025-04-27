"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAlphaOrderId = getAlphaOrderId;
function getAlphaOrderId(orderId) {
    return orderId + Number(process.env.SHIFT_ORDER_ID || 1000);
}
