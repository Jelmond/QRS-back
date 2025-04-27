import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
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