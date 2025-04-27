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
exports.getOrderPrice = getOrderPrice;
const getProductsFromSupabase_1 = require("./getProductsFromSupabase");
function getOrderPrice(orderItems, restaurantId) {
    return __awaiter(this, void 0, void 0, function* () {
        const products = yield (0, getProductsFromSupabase_1.getProductsByRestaurant)(restaurantId);
        return orderItems.reduce((total, item) => {
            const product = products.find(p => p.id === item.id);
            if (!product) {
                throw new Error(`Product with ID ${item.id} not found`);
            }
            const addonsPrice = item.addons ? item.addons.reduce((sum, addon) => sum + addon.price, 0) : 0;
            return total + product.price + addonsPrice;
        }, 0);
    });
}
