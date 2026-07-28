/**
 * OpenAPI 3.0 specification for QRS Backend API.
 *
 * KEEP THIS IN SYNC WITH server.ts.
 * When adding / removing / changing a route in server.ts, update this file too.
 * The Claude Code PostToolUse hook runs `npm run docs:validate` automatically.
 */

export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'QRS Backend API',
    version: '1.0.0',
    description: 'Restaurant QR ordering system — payments, POS sync, bookings.',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  tags: [
    { name: 'Health',               description: 'Connection and health checks' },
    { name: 'Payments',             description: 'Alfa Bank payment flow' },
    { name: 'POS Sync',             description: 'iiko menu sync to database' },
    { name: 'Admin — POS',          description: 'POS configuration and reservation sync management' },
    { name: 'Admin — Restaurants',  description: 'Restaurant CRUD' },
    { name: 'Admin — Tables',       description: 'Restaurant table management' },
    { name: 'Admin — Meal Periods', description: 'Meal period management (breakfast / lunch / dinner)' },
    { name: 'Admin — Categories',   description: 'Category management (manual; iiko restaurants use /sync/iiko)' },
  ],
  paths: {

    // ── Health ──────────────────────────────────────────────────────────────

    '/test-connection': {
      get: {
        tags: ['Health'],
        summary: 'Test Supabase connection',
        description: 'Pings the orders table to verify the Supabase connection is alive.',
        responses: {
          200: {
            description: 'Connection successful',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SuccessMessage' },
                example: { success: true, message: 'Connection successful' },
              },
            },
          },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
    },

    // ── Payments ─────────────────────────────────────────────────────────────

    '/pay': {
      post: {
        tags: ['Payments'],
        summary: 'Initiate payment for an order',
        description: [
          'Fetches the order from Supabase, creates an Alfa Bank payment link,',
          'saves a payment record, links it to the order, and returns the payment URL.',
        ].join(' '),
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PayRequest' },
              example: { orderId: 'a1b2c3d4-0000-0000-0000-000000000001' },
            },
          },
        },
        responses: {
          200: {
            description: 'Payment link created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PayResponse' },
                example: {
                  success: true,
                  paymentLink: 'https://abby.rbsuat.com/payment/merchants/...',
                  paymentId: 'ext-abc123',
                },
              },
            },
          },
          400: { $ref: '#/components/responses/Error400' },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
    },

    '/success-payment': {
      get: {
        tags: ['Payments'],
        summary: 'Alfa Bank success callback',
        description: [
          'Called by Alfa Bank after a successful payment.',
          'Marks the payment as `success` in Supabase and redirects the user to',
          '`BASE_CLIENT_URL/payment-success?orderId=<id>`.',
        ].join(' '),
        parameters: [
          {
            name: 'orderId',
            in: 'query',
            required: true,
            description: 'External Alfa Bank order ID (stored as hash_id in payments table)',
            schema: { type: 'string' },
            example: 'ext-abc123',
          },
        ],
        responses: {
          302: { description: 'Redirect to client success page' },
          400: { $ref: '#/components/responses/Error400' },
        },
      },
    },

    '/fail-payment': {
      get: {
        tags: ['Payments'],
        summary: 'Alfa Bank failure callback',
        description: [
          'Called by Alfa Bank after a failed or cancelled payment.',
          'Marks the payment as `failure` in Supabase and redirects the user to',
          '`BASE_CLIENT_URL/payment-failure?orderId=<id>`.',
        ].join(' '),
        parameters: [
          {
            name: 'orderId',
            in: 'query',
            required: true,
            description: 'External Alfa Bank order ID (stored as hash_id in payments table)',
            schema: { type: 'string' },
            example: 'ext-abc123',
          },
        ],
        responses: {
          302: { description: 'Redirect to client failure page' },
          400: { $ref: '#/components/responses/Error400' },
        },
      },
    },

    // ── POS Sync ─────────────────────────────────────────────────────────────

    '/sync/iiko': {
      post: {
        tags: ['POS Sync'],
        summary: 'Sync iiko menu to database',
        description: [
          'Pulls the latest nomenclature from iiko Cloud and upserts it into Supabase.',
          '',
          '**What it syncs:**',
          '- iiko product groups → `categories` (matched by `iiko_group_id`)',
          '- iiko products       → `menu_items`  (matched by `iiko_product_id` + `iiko_size_id`)',
          '- Items removed from iiko → soft-deleted (`is_deleted = true`)',
          '- Stop list applied   → `is_available` updated in real time',
          '',
          'Requires the restaurant to have a configured row in `restaurant_pos`',
          'with `iiko_api_login`, `iiko_organization_id`, and `iiko_terminal_group_id`.',
        ].join('\n'),
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SyncIikoRequest' },
              example: { restaurantId: 'a1b2c3d4-0000-0000-0000-000000000001' },
            },
          },
        },
        responses: {
          200: {
            description: 'Sync completed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SyncIikoResponse' },
                example: {
                  success: true,
                  categoriesAdded: 3,
                  categoriesUpdated: 1,
                  itemsAdded: 47,
                  itemsUpdated: 5,
                  itemsDeleted: 2,
                },
              },
            },
          },
          400: { $ref: '#/components/responses/Error400' },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
    },

    // ── Admin — POS ──────────────────────────────────────────────────────────

    '/admin/pos/status': {
      get: {
        tags: ['Admin — POS'],
        summary: 'POS status for a restaurant',
        description: 'Returns whether POS is configured, whether the terminal is alive, and the count of reservations that failed to sync.',
        parameters: [
          { name: 'restaurantId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'POS status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PosStatusResponse' },
                example: { configured: true, terminalAlive: true, failedSyncCount: 2 },
              },
            },
          },
          400: { $ref: '#/components/responses/Error400' },
        },
      },
    },

    '/admin/pos/retry-failed': {
      post: {
        tags: ['Admin — POS'],
        summary: 'Retry failed reservation syncs',
        description: 'Re-pushes confirmed future reservations that have `iiko_creation_status = Error` or were never synced.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RestaurantIdBody' },
            },
          },
        },
        responses: {
          200: {
            description: 'Retry result',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { retried: { type: 'integer' } } },
                example: { retried: 3 },
              },
            },
          },
          400: { $ref: '#/components/responses/Error400' },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
    },

    '/admin/pos/sync': {
      post: {
        tags: ['Admin — POS'],
        summary: 'Full reservation sync to POS',
        description: 'Pushes ALL confirmed future reservations with no `iiko_reserve_id` to iiko. Checks terminal is alive first.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RestaurantIdBody' },
            },
          },
        },
        responses: {
          200: {
            description: 'Bidirectional sync result',
            content: {
              'application/json': {
                example: { ok: true, pushed: 2, created: 3, linked: 1, cancelledLocal: 0, cancelledIiko: 0 },
              },
            },
          },
          400: { $ref: '#/components/responses/Error400' },
          503: { description: 'POS not configured or terminal offline' },
        },
      },
    },

    '/admin/pos/config': {
      get: {
        tags: ['Admin — POS'],
        summary: 'Get POS config for a restaurant',
        parameters: [
          { name: 'restaurantId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'POS config',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PosConfig' },
              },
            },
          },
          400: { $ref: '#/components/responses/Error400' },
        },
      },
      put: {
        tags: ['Admin — POS'],
        summary: 'Create or update POS config for a restaurant',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PosConfigBody' },
              example: {
                restaurantId: 'a1b2c3d4-0000-0000-0000-000000000001',
                posType: 'iiko',
                iikoApiLogin: 'your-api-login',
                iikoOrganizationId: 'org-uuid',
                iikoTerminalGroupId: 'terminal-uuid',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Saved config',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PosConfig' } } },
          },
          400: { $ref: '#/components/responses/Error400' },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
    },

    '/admin/pos/sections': {
      get: {
        tags: ['Admin — POS'],
        summary: 'Get iiko hall sections with tables',
        description: 'Fetches sections and their tables directly from iiko. Use this to map local `restaurant_tables` to iiko UUIDs (`iiko_table_id`, `iiko_section_id`).',
        parameters: [
          { name: 'restaurantId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'List of sections',
            content: {
              'application/json': {
                example: {
                  sections: [
                    { id: 'section-uuid', name: 'Main hall', tables: [{ id: 'table-uuid', name: 'T1', seatsCount: 4 }] },
                  ],
                },
              },
            },
          },
          400: { $ref: '#/components/responses/Error400' },
          404: { description: 'POS not configured' },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
    },

    // ── Admin — Restaurants ───────────────────────────────────────────────────

    '/admin/restaurants': {
      get: {
        tags: ['Admin — Restaurants'],
        summary: 'List all restaurants',
        responses: { 200: { description: 'Array of restaurants' } },
      },
      post: {
        tags: ['Admin — Restaurants'],
        summary: 'Create a restaurant',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RestaurantBody' },
              example: {
                name: 'My Restaurant', address: 'ul. Lenina 1', phone: '+375291234567', gmtOffset: 3, serviceActive: true,
                pos: { posType: 'iiko', iikoApiLogin: 'your-login', iikoOrganizationId: 'org-uuid', iikoTerminalGroupId: 'terminal-uuid' },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created restaurant' },
          400: { $ref: '#/components/responses/Error400' },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
    },

    '/admin/restaurants/{id}': {
      get: {
        tags: ['Admin — Restaurants'],
        summary: 'Get a restaurant by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Restaurant object' },
          404: { description: 'Not found' },
        },
      },
      patch: {
        tags: ['Admin — Restaurants'],
        summary: 'Update a restaurant',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RestaurantBody' } } },
        },
        responses: {
          200: { description: 'Updated restaurant' },
          404: { description: 'Not found' },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
      delete: {
        tags: ['Admin — Restaurants'],
        summary: 'Soft-delete a restaurant',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Deleted' },
          404: { description: 'Not found' },
        },
      },
    },

    // ── Admin — Tables ────────────────────────────────────────────────────────

    '/admin/restaurants/{id}/tables': {
      get: {
        tags: ['Admin — Tables'],
        summary: 'List tables for a restaurant',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Array of tables' } },
      },
      post: {
        tags: ['Admin — Tables'],
        summary: 'Create a table',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TableBody' },
              example: { tableNumber: 'T1', seats: 4, status: 'active', type: 'default' },
            },
          },
        },
        responses: {
          201: { description: 'Created table' },
          400: { $ref: '#/components/responses/Error400' },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
    },

    '/admin/restaurants/{id}/tables/{tableId}': {
      patch: {
        tags: ['Admin — Tables'],
        summary: 'Update a table',
        parameters: [
          { name: 'id',      in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'tableId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TableBody' },
              example: { iikoTableId: 'iiko-uuid', iikoSectionId: 'section-uuid' },
            },
          },
        },
        responses: {
          200: { description: 'Updated table' },
          404: { description: 'Not found' },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
      delete: {
        tags: ['Admin — Tables'],
        summary: 'Delete a table',
        parameters: [
          { name: 'id',      in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'tableId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Deleted' },
          404: { description: 'Not found' },
        },
      },
    },

    // ── Admin — Meal Periods ──────────────────────────────────────────────────

    '/admin/restaurants/{id}/meal-periods': {
      get: {
        tags: ['Admin — Meal Periods'],
        summary: 'List meal periods for a restaurant',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Array of meal periods' } },
      },
      post: {
        tags: ['Admin — Meal Periods'],
        summary: 'Create a meal period',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: { name: 'Lunch', startTime: '12:00', endTime: '16:00' },
            },
          },
        },
        responses: {
          201: { description: 'Created meal period' },
          400: { $ref: '#/components/responses/Error400' },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
    },

    '/admin/restaurants/{id}/meal-periods/{periodId}': {
      patch: {
        tags: ['Admin — Meal Periods'],
        summary: 'Update a meal period',
        parameters: [
          { name: 'id',       in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'periodId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { example: { name: 'Dinner', startTime: '18:00', endTime: '23:00' } } },
        },
        responses: {
          200: { description: 'Updated meal period' },
          404: { description: 'Not found' },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
      delete: {
        tags: ['Admin — Meal Periods'],
        summary: 'Delete a meal period',
        parameters: [
          { name: 'id',       in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'periodId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 200: { description: 'Deleted' }, 404: { description: 'Not found' } },
      },
    },

    // ── Admin — Categories ────────────────────────────────────────────────────

    '/admin/restaurants/{id}/categories': {
      get: {
        tags: ['Admin — Categories'],
        summary: 'List categories for a restaurant',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Array of categories' } },
      },
      post: {
        tags: ['Admin — Categories'],
        summary: 'Create a category (manual — iiko restaurants use /sync/iiko)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: { name: 'Hot drinks', slug: 'hot-drinks', isBeverage: true },
            },
          },
        },
        responses: {
          201: { description: 'Created category' },
          400: { $ref: '#/components/responses/Error400' },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
    },

    '/admin/restaurants/{id}/categories/{categoryId}': {
      patch: {
        tags: ['Admin — Categories'],
        summary: 'Update a category',
        parameters: [
          { name: 'id',         in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'categoryId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { example: { name: 'Cold drinks', isBeverage: true } } },
        },
        responses: {
          200: { description: 'Updated category' },
          404: { description: 'Not found' },
          500: { $ref: '#/components/responses/Error500' },
        },
      },
      delete: {
        tags: ['Admin — Categories'],
        summary: 'Delete a category',
        parameters: [
          { name: 'id',         in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'categoryId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 200: { description: 'Deleted' }, 404: { description: 'Not found' } },
      },
    },
  },

  components: {
    schemas: {
      SuccessMessage: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
      ErrorMessage: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error:   { type: 'string' },
        },
      },
      PayRequest: {
        type: 'object',
        required: ['orderId'],
        properties: {
          orderId: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the order in Supabase `orders` table',
          },
        },
      },
      PayResponse: {
        type: 'object',
        properties: {
          success:     { type: 'boolean' },
          paymentLink: { type: 'string', description: 'Alfa Bank hosted payment page URL' },
          paymentId:   { type: 'string', description: 'External payment ID from Alfa Bank' },
        },
      },
      SyncIikoRequest: {
        type: 'object',
        required: ['restaurantId'],
        properties: {
          restaurantId: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the restaurant in Supabase `restaurants` table',
          },
        },
      },
      RestaurantBody: {
        type: 'object',
        properties: {
          name:             { type: 'string' },
          description:      { type: 'string' },
          shortDescription: { type: 'string' },
          address:          { type: 'string' },
          phone:            { type: 'string' },
          image:            { type: 'string' },
          workingHours:     { type: 'object' },
          priceCategory:    { type: 'integer' },
          gmtOffset:        { type: 'integer' },
          serviceActive:    { type: 'boolean' },
          telegramBotToken: { type: 'string' },
          telegramChatId:   { type: 'string' },
          pos: {
            type: 'object',
            description: 'Optional POS config — creates restaurant_pos record in the same request',
            properties: {
              posType:              { type: 'string', enum: ['iiko', 'rkeeper', 'supabase'] },
              iikoApiLogin:         { type: 'string' },
              iikoOrganizationId:   { type: 'string', format: 'uuid' },
              iikoTerminalGroupId:  { type: 'string', format: 'uuid' },
              rkeeperApiUrl:        { type: 'string' },
              rkeeperStationId:     { type: 'string' },
            },
          },
        },
      },
      TableBody: {
        type: 'object',
        properties: {
          tableNumber:    { type: 'string' },
          seats:          { type: 'integer' },
          status:         { type: 'string', enum: ['inactive', 'active', 'occupied', 'reserved'] },
          type:           { type: 'string', enum: ['default', 'vip', 'outdoor', 'bar'] },
          socket:         { type: 'boolean' },
          positionX:      { type: 'integer' },
          positionY:      { type: 'integer' },
          iikoTableId:    { type: 'string', format: 'uuid' },
          iikoSectionId:  { type: 'string', format: 'uuid' },
        },
      },
      RestaurantIdBody: {
        type: 'object',
        required: ['restaurantId'],
        properties: {
          restaurantId: { type: 'string', format: 'uuid' },
        },
      },
      PosStatusResponse: {
        type: 'object',
        properties: {
          configured:      { type: 'boolean' },
          terminalAlive:   { type: 'boolean' },
          failedSyncCount: { type: 'integer' },
        },
      },
      PosConfig: {
        type: 'object',
        properties: {
          configured:            { type: 'boolean' },
          id:                    { type: 'string', format: 'uuid' },
          pos_type:              { type: 'string', enum: ['iiko', 'rkeeper', 'supabase'] },
          iiko_api_login:        { type: 'string' },
          iiko_organization_id:  { type: 'string', format: 'uuid' },
          iiko_terminal_group_id:{ type: 'string', format: 'uuid' },
          rkeeper_api_url:       { type: 'string' },
          rkeeper_station_id:    { type: 'string' },
        },
      },
      PosConfigBody: {
        type: 'object',
        required: ['restaurantId'],
        properties: {
          restaurantId:          { type: 'string', format: 'uuid' },
          posType:               { type: 'string', enum: ['iiko', 'rkeeper', 'supabase'] },
          iikoApiLogin:          { type: 'string' },
          iikoOrganizationId:    { type: 'string', format: 'uuid' },
          iikoTerminalGroupId:   { type: 'string', format: 'uuid' },
          rkeeperApiUrl:         { type: 'string' },
          rkeeperStationId:      { type: 'string' },
        },
      },
      SyncIikoResponse: {
        type: 'object',
        properties: {
          success:            { type: 'boolean' },
          categoriesAdded:    { type: 'integer' },
          categoriesUpdated:  { type: 'integer' },
          itemsAdded:         { type: 'integer' },
          itemsUpdated:       { type: 'integer' },
          itemsDeleted:       { type: 'integer' },
        },
      },
    },
    responses: {
      Error400: {
        description: 'Bad request — missing or invalid parameters',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorMessage' },
          },
        },
      },
      Error500: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorMessage' },
          },
        },
      },
    },
  },
};
