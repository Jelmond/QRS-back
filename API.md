# QRS Backend — Public API

Base URL: `https://qrs-back.onrender.com`

---

## Меню

### GET `/menu/:restaurantId`

Возвращает все категории и блюда ресторана с аллергенами и диетическими предпочтениями.

**Пример ответа**
```json
{
  "categories": [
    {
      "id": "uuid",
      "name": "Горячее",
      "slug": "hot",
      "is_beverage": false,
      "iiko_group_id": "uuid"
    }
  ],
  "items": [
    {
      "id": "uuid",
      "name": "Паста карбонара",
      "description": "Классическая итальянская паста",
      "price": 18.50,
      "image": "https://...",
      "index_number": 1,
      "is_available": true,
      "is_popular": false,
      "is_spicy": false,
      "category_id": "uuid",
      "calories": 480,
      "protein": 22,
      "fat": 18,
      "carbohydrates": 55,
      "grams": 300,
      "allergens": [
        { "id": "uuid", "name": "Глютен", "icon": "🌾" }
      ],
      "dietary_preferences": [
        { "id": "uuid", "name": "Вегетарианское", "icon": "🥗" }
      ]
    }
  ]
}
```

---

### GET `/allergens`

Список всех аллергенов.

**Пример ответа**
```json
[
  { "id": "uuid", "name": "Глютен", "icon": "🌾", "description": null }
]
```

---

### GET `/dietary-preferences`

Список всех диетических предпочтений.

**Пример ответа**
```json
[
  { "id": "uuid", "name": "Вегетарианское", "icon": "🥗", "description": null }
]
```

---

## Ресторан

### GET `/restaurants/:restaurantId/availability`

Проверяет, принимает ли ресторан заказы прямо сейчас.

**Пример ответа**
```json
{ "available": true }
```

---

## Отзывы

### GET `/restaurants/:restaurantId/reviews`

Список отзывов с пагинацией.

**Query параметры**

| Параметр    | Тип    | По умолчанию | Описание                                    |
|-------------|--------|--------------|---------------------------------------------|
| `sort`      | string | `newest`     | `newest` / `highest` / `lowest` / `helpful` |
| `page`      | number | `1`          |                                             |
| `limit`     | number | `10`         | Максимум 50                                 |
| `profileId` | uuid   | —            | Если передан, в каждом отзыве будет `has_voted` |

**Пример ответа**
```json
{
  "reviews": [
    {
      "id": "uuid",
      "rating": 5,
      "comment": "Отличное место!",
      "helpful_count": 3,
      "reply_text": "Спасибо!",
      "reply_author": "Администратор",
      "reply_date": "2026-07-01T12:00:00Z",
      "created_at": "2026-06-28T18:00:00Z",
      "guest_name": "Иван",
      "has_voted": false
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 10
}
```

---

### POST `/restaurants/:restaurantId/reviews`

Оставить отзыв. Один профиль — один отзыв на ресторан.

**Body**
```json
{
  "rating": 5,
  "comment": "Всё понравилось",
  "profileId": "uuid"
}
```

**Пример ответа** `201`
```json
{
  "id": "uuid",
  "rating": 5,
  "comment": "Всё понравилось",
  "helpful_count": 0,
  "created_at": "2026-07-28T10:00:00Z"
}
```

**Ошибки**
- `409` — профиль уже оставлял отзыв на этот ресторан

---

### POST `/reviews/:reviewId/helpful`

Поставить / снять отметку «полезно» (тоггл).

**Query параметры**

| Параметр    | Тип  | Обязателен |
|-------------|------|------------|
| `profileId` | uuid | да         |

**Пример ответа**
```json
{ "voted": true, "helpful_count": 4 }
```

---

## Гостевой профиль

Профиль идентифицируется по `deviceId` — уникальной строке устройства (например UUID, сгенерированный на клиенте и сохранённый в localStorage).

### POST `/guest-profile`

Создать или обновить профиль. Если профиль с таким `deviceId` уже есть — обновляется `last_seen_at` и возвращается существующий.

**Body**
```json
{ "deviceId": "abc-123" }
```

**Пример ответа** `200` / `201`
```json
{
  "id": "uuid",
  "device_id": "abc-123",
  "name": "Иван",
  "surname": null,
  "phone_number": null,
  "birth_date": null,
  "preferences": {},
  "last_seen_at": "2026-07-28T10:00:00Z",
  "allergens": [
    { "id": "uuid", "name": "Глютен", "icon": "🌾" }
  ]
}
```

---

### PUT `/guest-profile/personal-info`

Обновить персональные данные.

**Body**
```json
{
  "deviceId": "abc-123",
  "name": "Иван",
  "birth_date": "1995-03-15T00:00:00Z",
  "phone_number": "+375291234567"
}
```

Все поля кроме `deviceId` опциональны — передавай только то, что меняется.

**Пример ответа** — обновлённый профиль.

---

### PUT `/guest-profile/allergens`

Полностью заменить список аллергенов гостя.

**Body**
```json
{
  "deviceId": "abc-123",
  "allergens": ["uuid-аллергена-1", "uuid-аллергена-2"]
}
```

Передай пустой массив `[]`, чтобы снять все аллергены.

**Пример ответа**
```json
{ "allergens": ["uuid-аллергена-1", "uuid-аллергена-2"] }
```

---

### PUT `/guest-profile/preferences`

Обновить произвольные предпочтения (jsonb объект).

**Body**
```json
{
  "deviceId": "abc-123",
  "preferences": { "spicy": false, "diet": "vegetarian" }
}
```

**Пример ответа** — обновлённый профиль.

---

## Заказы

### POST `/orders`

Создать заказ. Цены берутся из базы данных — клиентским ценам бэкенд не доверяет.

Если ресторан использует iiko и стол замаплен на iiko, заказ автоматически пушится в POS. Ошибка синхронизации с POS **не блокирует** ответ — заказ в любом случае создаётся в нашей БД.

**Body**
```json
{
  "restaurantId": "uuid",
  "tableId": "uuid",
  "deviceId": "abc-123",
  "items": [
    { "menuItemId": "uuid", "quantity": 2 },
    { "menuItemId": "uuid", "quantity": 1 }
  ],
  "comment": "без лука",
  "isTogo": false
}
```

| Поле           | Тип      | Обязателен |
|----------------|----------|------------|
| `restaurantId` | uuid     | да         |
| `tableId`      | uuid     | да         |
| `deviceId`     | string   | да         |
| `items`        | array    | да, минимум 1 элемент |
| `comment`      | string   | нет        |
| `isTogo`       | boolean  | нет        |

**Пример ответа** `201`
```json
{
  "orderId": "uuid",
  "incrementedId": 1042,
  "total": 37.00,
  "status": "pending",
  "iikoOrderId": "uuid",
  "iikoPushError": null
}
```

> После получения `orderId` вызывай `POST /pay` с `{ "orderId": "uuid" }` чтобы получить ссылку на оплату.

**Ошибки**
- `400` — не передан обязательный параметр, блюдо недоступно или количество невалидно
- `404` — профиль гостя не найден (нужно сначала вызвать `POST /guest-profile`), стол не найден

---

### GET `/orders/:orderId`

Получить заказ со статусом и позициями.

**Пример ответа**
```json
{
  "id": "uuid",
  "incremented_id": 1042,
  "table_number": "5",
  "status": "pending",
  "total": 37.00,
  "tip_amount": 0,
  "is_togo": false,
  "waiting_time": null,
  "iiko_order_id": "uuid",
  "pos_sync_status": "synced",
  "created_at": "2026-07-28T10:00:00Z",
  "order_items": [
    {
      "id": "uuid",
      "quantity": 2,
      "price": 18.50,
      "menu_items": { "id": "uuid", "name": "Паста карбонара", "image": "https://..." }
    }
  ],
  "order_comments": [{ "comment": "без лука" }]
}
```

**Статусы заказа:** `pending` → `accepted` → `processing` → `completed` / `cancelled`

---

## Управление меню (admin)

> Все `/admin/*` маршруты требуют заголовок `Authorization: Bearer <ADMIN_SECRET>`

### GET `/admin/restaurants/:id/menu-items`

Список всех активных блюд ресторана.

---

### PATCH `/admin/restaurants/:id/menu-items/:itemId`

Обновить контент блюда вручную. Синхронизация с iiko эти поля **не перезаписывает**.

**Body** (все поля опциональны)
```json
{
  "description": "Нежная паста с беконом и пармезаном",
  "image": "https://...",
  "isAvailable": true,
  "isPopular": false,
  "isSpicy": false,
  "name": "Паста карбонара",
  "indexNumber": 5
}
```

---

### POST `/admin/restaurants/:id/menu-items/:itemId/image`

Загрузить картинку блюда в Supabase Storage. Возвращает публичный URL и сохраняет его в `image`.

**Требования:**
- Тип запроса: `multipart/form-data`
- Поле файла: `image`
- Максимальный размер: 5 МБ
- В Supabase Storage должен существовать bucket `menu-images` с публичным доступом на чтение

**Пример ответа**
```json
{ "image": "https://yypkvnotsnhdyikzjuzy.supabase.co/storage/v1/object/public/menu-images/restaurantId/itemId.jpg" }
```

---

## Оплата

### POST `/pay`

Запросить ссылку на оплату через Alfa Bank.

**Body**
```json
{ "orderId": "uuid" }
```

**Пример ответа**
```json
{
  "success": true,
  "paymentLink": "https://abby.rbsuat.com/payment/...",
  "paymentId": "alfa-internal-id"
}
```

После оплаты Alfa Bank редиректит пользователя на:
- `/success-payment?orderId=...` — статус заказа становится `completed`
- `/fail-payment?orderId=...` — статус платежа становится `failure`

---

## Типичный флоу заказа

```
1. GET  /menu/:restaurantId              — загрузить меню
2. POST /guest-profile                   — получить/создать профиль гостя
3. POST /orders                          — создать заказ → получить orderId
4. POST /pay  { orderId }                — получить ссылку на оплату
5. Редирект на paymentLink
6. Alfa Bank → GET /success-payment      — заказ завершён
```
