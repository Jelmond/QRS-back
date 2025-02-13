import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://your-supabase-url.supabase.co';
const supabaseKey = 'your-supabase-key';
const supabase = createClient(supabaseUrl, supabaseKey);

interface Product {
    id: string;
    price: number;
}

export async function getProductsByRestaurant(restaurantId: string): Promise<Product[]> {
    const { data, error } = await supabase
        .from('products')
        .select('id, price')
        .eq('restaurant_id', restaurantId);

    if (error) {
        throw new Error(`Error fetching products: ${error.message}`);
    }

    return data || [];
} 