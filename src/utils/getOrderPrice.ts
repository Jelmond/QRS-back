import { getProductsByRestaurant } from './getProductsFromSupabase';

interface OrderItem {
    id: string;
    addons?: Array<{ id: string; price: number }>;
}

export async function getOrderPrice(orderItems: OrderItem[], restaurantId: string): Promise<number> {
    const products = await getProductsByRestaurant(restaurantId);

    return orderItems.reduce((total, item) => {
        const product = products.find(p => p.id === item.id);
        if (!product) {
            throw new Error(`Product with ID ${item.id} not found`);
        }

        const addonsPrice = item.addons ? item.addons.reduce((sum, addon) => sum + addon.price, 0) : 0;
        return total + product.price + addonsPrice;
    }, 0);
}
