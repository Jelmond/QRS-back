-- ═══════════════════════════════════════════════════════════════════════════
-- QRS CLEAN SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DROPPED (duplicates / broken):
--   reviews              → use restaurant_reviews
--   review_replies       → inline reply columns on restaurant_reviews
--   revenue              → no time dimension; replaced by revenue_monthly
--   restaurant_users     → duplicate of restaurant_auth
--
-- FIXED:
--   categories.slug           — was globally UNIQUE, now unique per restaurant
--   staff_schedule            — was missing restaurant_id (global date unique = bug)
--   order_payment_links       — was missing primary key
--   review_helpful_votes      — added UNIQUE(review_id, guest_profile_id)
--   restaurant_sessions       — now references restaurant_auth, not dropped restaurant_users
--   restaurant_pos            — added UNIQUE on restaurant_id (one config per restaurant)
--
-- EXTENDED for POS & booking:
--   restaurant_pos            — iiko_api_login, iiko_organization_id, iiko_terminal_group_id
--                               rkeeper_api_url, rkeeper_station_id (stubs)
--   restaurant_tables         — iiko_table_id, iiko_section_id
--   menu_items                — iiko_product_id, iiko_size_id; removed ARRAY columns
--   orders                    — iiko_order_id, pos_sync_status
--   restaurant_reservations   — full rebuild: customer info, status flow,
--                               arrival tracking, iiko sync columns
--
-- NEW tables:
--   menu_item_meal_periods        — replaces menu_items.meal_periods ARRAY
--   guest_profile_allergens       — replaces guest_profiles.allergens ARRAY
--   restaurant_reservation_tables — multi-table reservations junction
--   revenue_monthly               — replaces revenue (adds time dimension)
--
-- NOTE — gastro system:
--   restaurants_gastro, tables_gastro, reservations_gastro, users_gastro,
--   reservation_tables, tenants, admin_memberships, alert_channels
--   These are a separate Telegram-based booking system. Not touched here.
--   Decide whether to migrate that data into restaurant_reservations or keep separate.
--
-- ═══════════════════════════════════════════════════════════════════════════


-- ── ENUMS & SEQUENCES ───────────────────────────────────────────────────────

CREATE TYPE public.table_status AS ENUM ('inactive', 'active', 'occupied', 'reserved');
CREATE TYPE public.table_type   AS ENUM ('default', 'vip', 'outdoor', 'bar');
CREATE TYPE public.payment_status AS ENUM ('pending', 'success', 'failure');

CREATE SEQUENCE IF NOT EXISTS public.orders_incremented_id_seq
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;


-- ── RESTAURANTS ─────────────────────────────────────────────────────────────

CREATE TABLE public.restaurants (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  description         text,
  short_description   text,
  address             text,
  phone               text,
  image               text,
  working_hours       jsonb,
  price_category      integer,
  gmt_offset          integer     NOT NULL DEFAULT 0,
  service_active      boolean     NOT NULL DEFAULT false,
  telegram_bot_token  text,
  telegram_chat_id    text,
  is_deleted          boolean     NOT NULL DEFAULT false,
  created_at          timestamp   NOT NULL DEFAULT timezone('utc', now()),
  updated_at          timestamp   NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT restaurants_pkey PRIMARY KEY (id)
);


-- ── AUTH ────────────────────────────────────────────────────────────────────
-- Kept restaurant_auth (more complete role set). Dropped restaurant_users.

CREATE TABLE public.restaurant_auth (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid          NOT NULL,
  username      text          NOT NULL UNIQUE,
  password_hash text          NOT NULL,
  role          varchar       NOT NULL CHECK (role IN (
                  'superadmin', 'admin', 'manager',
                  'staff', 'finmanager', 'cook', 'bartender'
                )),
  is_active     boolean       NOT NULL DEFAULT true,
  last_login    timestamptz,
  created_at    timestamp     NOT NULL DEFAULT timezone('utc', now()),
  updated_at    timestamp     NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT restaurant_auth_pkey PRIMARY KEY (id),
  CONSTRAINT restaurant_auth_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);

CREATE TABLE public.restaurant_sessions (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL,   -- references restaurant_auth
  token      text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamp   NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT restaurant_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT restaurant_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.restaurant_auth(id)
);


-- ── POS CONFIG ──────────────────────────────────────────────────────────────

CREATE TABLE public.restaurant_pos (
  id                        uuid  NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id             uuid  NOT NULL UNIQUE,
  pos_type                  text,             -- 'iiko' | 'rkeeper' | 'supabase'
  -- iiko
  iiko_api_login            text,
  iiko_organization_id      uuid,
  iiko_terminal_group_id    uuid,
  -- R-Keeper (stubs — fill when needed)
  rkeeper_api_url           text,
  rkeeper_station_id        text,
  CONSTRAINT restaurant_pos_pkey PRIMARY KEY (id),
  CONSTRAINT restaurant_pos_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);


-- ── MENU ────────────────────────────────────────────────────────────────────

CREATE TABLE public.categories (
  id              uuid    NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id   uuid    NOT NULL,
  name            text    NOT NULL,
  slug            text    NOT NULL,
  is_beverage     boolean          DEFAULT false,
  iiko_group_id   uuid,
  created_at      timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT categories_pkey PRIMARY KEY (id),
  CONSTRAINT categories_slug_restaurant_unique UNIQUE (restaurant_id, slug),
  CONSTRAINT fk_categories_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);

CREATE TABLE public.allergens (
  id          uuid  NOT NULL DEFAULT gen_random_uuid(),
  name        text  NOT NULL UNIQUE,
  icon        text  NOT NULL,
  description text,
  created_at  timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT allergens_pkey PRIMARY KEY (id)
);

CREATE TABLE public.dietary_preferences (
  id          uuid  NOT NULL DEFAULT gen_random_uuid(),
  name        text  NOT NULL UNIQUE,
  icon        text  NOT NULL,
  description text,
  created_at  timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT dietary_preferences_pkey PRIMARY KEY (id)
);

CREATE TABLE public.meal_periods (
  id            uuid  NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid  NOT NULL,
  name          varchar NOT NULL,
  start_time    time  NOT NULL,
  end_time      time  NOT NULL,
  created_at    timestamp DEFAULT now(),
  updated_at    timestamp DEFAULT now(),
  CONSTRAINT meal_periods_pkey PRIMARY KEY (id),
  CONSTRAINT meal_periods_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);

CREATE TABLE public.menu_items (
  id            uuid      NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid      NOT NULL,
  category_id   uuid      NOT NULL,
  name          text      NOT NULL,
  description   text      NOT NULL,
  price         numeric   NOT NULL,
  self_price    numeric            DEFAULT 0.00 CHECK (self_price >= 0),
  image         text      NOT NULL,
  index_number  integer   NOT NULL,
  is_available  boolean   NOT NULL DEFAULT true,
  is_popular    boolean            DEFAULT false,
  is_spicy      boolean   NOT NULL DEFAULT false,
  is_deleted    boolean   NOT NULL DEFAULT false,
  -- Nutrition
  calories      numeric   DEFAULT 0.00 CHECK (calories >= 0),
  protein       numeric   DEFAULT 0.00 CHECK (protein >= 0),
  fat           numeric   DEFAULT 0.00 CHECK (fat >= 0),
  carbohydrates numeric   DEFAULT 0.00 CHECK (carbohydrates >= 0),
  grams         numeric   DEFAULT 0.00 CHECK (grams >= 0),
  -- POS mapping
  iiko_product_id uuid,
  iiko_size_id    uuid,   -- for iiko products that have multiple sizes
  created_at    timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT menu_items_pkey PRIMARY KEY (id),
  CONSTRAINT menu_items_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES public.categories(id),
  CONSTRAINT menu_items_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);

CREATE TABLE public.menu_items_allergens (
  menu_item_id uuid      NOT NULL,
  allergen_id  uuid      NOT NULL,
  created_at   timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT menu_items_allergens_pkey PRIMARY KEY (menu_item_id, allergen_id),
  CONSTRAINT menu_items_allergens_menu_item_id_fkey
    FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id),
  CONSTRAINT menu_items_allergens_allergen_id_fkey
    FOREIGN KEY (allergen_id) REFERENCES public.allergens(id)
);

CREATE TABLE public.menu_items_dietary_preferences (
  menu_item_id  uuid      NOT NULL,
  preference_id uuid      NOT NULL,
  created_at    timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT menu_items_dietary_preferences_pkey PRIMARY KEY (menu_item_id, preference_id),
  CONSTRAINT menu_items_dietary_preferences_menu_item_id_fkey
    FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id),
  CONSTRAINT menu_items_dietary_preferences_preference_id_fkey
    FOREIGN KEY (preference_id) REFERENCES public.dietary_preferences(id)
);

-- Replaces menu_items.meal_periods ARRAY
CREATE TABLE public.menu_item_meal_periods (
  menu_item_id   uuid NOT NULL,
  meal_period_id uuid NOT NULL,
  CONSTRAINT menu_item_meal_periods_pkey PRIMARY KEY (menu_item_id, meal_period_id),
  CONSTRAINT fk_mimp_menu_item
    FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id),
  CONSTRAINT fk_mimp_meal_period
    FOREIGN KEY (meal_period_id) REFERENCES public.meal_periods(id)
);


-- ── STATS ───────────────────────────────────────────────────────────────────

CREATE TABLE public.menu_items_stats (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  menu_item_id        uuid    NOT NULL UNIQUE,
  restaurant_id       uuid    NOT NULL,
  total_quantity_sold integer          DEFAULT 0 CHECK (total_quantity_sold >= 0),
  total_revenue       numeric          DEFAULT 0.00 CHECK (total_revenue >= 0),
  total_cost          numeric          DEFAULT 0.00 CHECK (total_cost >= 0),
  gross_profit        numeric          DEFAULT 0,
  markup_rate         numeric          DEFAULT 0,
  last_sold_at        timestamptz,
  created_at          timestamp NOT NULL DEFAULT timezone('utc', now()),
  updated_at          timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT menu_items_stats_pkey PRIMARY KEY (id),
  CONSTRAINT menu_items_stats_menu_item_id_fkey
    FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id),
  CONSTRAINT menu_items_stats_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);

CREATE TABLE public.menu_items_monthly_stats (
  id           uuid    NOT NULL DEFAULT gen_random_uuid(),
  menu_item_id uuid    NOT NULL,
  restaurant_id uuid   NOT NULL,
  year         integer NOT NULL,
  month        integer NOT NULL CHECK (month >= 1 AND month <= 12),
  quantity_sold integer          DEFAULT 0 CHECK (quantity_sold >= 0),
  revenue      numeric          DEFAULT 0.00 CHECK (revenue >= 0),
  cost         numeric          DEFAULT 0.00 CHECK (cost >= 0),
  gross_profit numeric          DEFAULT 0,
  markup_rate  numeric          DEFAULT 0,
  created_at   timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT menu_items_monthly_stats_pkey PRIMARY KEY (id),
  CONSTRAINT menu_items_monthly_stats_unique UNIQUE (menu_item_id, year, month),
  CONSTRAINT menu_items_monthly_stats_menu_item_id_fkey
    FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id),
  CONSTRAINT menu_items_monthly_stats_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);

-- Replaces revenue table (which had no time dimension)
CREATE TABLE public.revenue_monthly (
  id                   uuid    NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id        uuid    NOT NULL,
  year                 integer NOT NULL,
  month                integer NOT NULL CHECK (month >= 1 AND month <= 12),
  total_revenue        numeric DEFAULT 0,
  revenue_without_tips numeric DEFAULT 0,
  total_tips           numeric DEFAULT 0,
  total_cost           numeric DEFAULT 0,
  net_profit           numeric DEFAULT 0,
  created_at           timestamp DEFAULT timezone('utc', now()),
  updated_at           timestamp DEFAULT timezone('utc', now()),
  CONSTRAINT revenue_monthly_pkey PRIMARY KEY (id),
  CONSTRAINT revenue_monthly_unique UNIQUE (restaurant_id, year, month),
  CONSTRAINT revenue_monthly_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);


-- ── TABLES ──────────────────────────────────────────────────────────────────

CREATE TABLE public.restaurant_tables (
  id               uuid    NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id    uuid    NOT NULL,
  table_number     varchar NOT NULL,
  seats            integer NOT NULL DEFAULT 4,
  status           table_status NOT NULL DEFAULT 'inactive',
  type             table_type   NOT NULL DEFAULT 'default',
  socket           boolean NOT NULL DEFAULT false,
  waiter_accepted  boolean,
  position_x       integer,
  position_y       integer,
  -- POS mapping
  iiko_table_id    uuid,
  iiko_section_id  uuid,
  created_at       timestamp DEFAULT now(),
  updated_at       timestamp DEFAULT now(),
  CONSTRAINT restaurant_tables_pkey PRIMARY KEY (id),
  CONSTRAINT restaurant_tables_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);


-- ── GUESTS ──────────────────────────────────────────────────────────────────

CREATE TABLE public.guest_profiles (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  device_id    text        NOT NULL UNIQUE,
  name         text,
  surname      text,
  phone_number text,
  birth_date   timestamp,
  preferences  jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamp   NOT NULL DEFAULT timezone('utc', now()),
  last_seen_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT guest_profiles_pkey PRIMARY KEY (id)
);

-- Replaces guest_profiles.allergens ARRAY
CREATE TABLE public.guest_profile_allergens (
  guest_profile_id uuid NOT NULL,
  allergen_id      uuid NOT NULL,
  CONSTRAINT guest_profile_allergens_pkey PRIMARY KEY (guest_profile_id, allergen_id),
  CONSTRAINT fk_gpa_guest
    FOREIGN KEY (guest_profile_id) REFERENCES public.guest_profiles(id),
  CONSTRAINT fk_gpa_allergen
    FOREIGN KEY (allergen_id) REFERENCES public.allergens(id)
);

CREATE TABLE public.accounts (
  id               uuid      NOT NULL DEFAULT gen_random_uuid(),
  guest_profile_id uuid,
  email            text      NOT NULL UNIQUE,
  password_hash    text      NOT NULL,
  created_at       timestamp NOT NULL DEFAULT timezone('utc', now()),
  updated_at       timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT accounts_pkey PRIMARY KEY (id),
  CONSTRAINT accounts_guest_profile_id_fkey
    FOREIGN KEY (guest_profile_id) REFERENCES public.guest_profiles(id)
);


-- ── ORDERS ──────────────────────────────────────────────────────────────────

CREATE TABLE public.orders (
  id               uuid    NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id    uuid,
  guest_profile_id uuid,
  table_number     text    NOT NULL,
  status           text    NOT NULL DEFAULT 'pending' CHECK (status IN (
                     'pending', 'accepted', 'processing',
                     'completed', 'cancelled', 'confirmed'
                   )),
  total            numeric NOT NULL,
  total_self_price numeric          DEFAULT 0.00 CHECK (total_self_price >= 0),
  tip_amount       numeric          DEFAULT 0,
  is_togo          boolean          DEFAULT false,
  waiting_time     integer,
  incremented_id   integer NOT NULL DEFAULT nextval('orders_incremented_id_seq'),
  -- POS sync
  iiko_order_id    uuid,
  pos_sync_status  text    CHECK (pos_sync_status IN ('pending', 'synced', 'error')),
  created_at       timestamp NOT NULL DEFAULT timezone('utc', now()),
  updated_at       timestamp          DEFAULT timezone('utc', now()),
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id),
  CONSTRAINT orders_guest_profile_id_fkey
    FOREIGN KEY (guest_profile_id) REFERENCES public.guest_profiles(id)
);

CREATE TABLE public.order_items (
  id           uuid    NOT NULL DEFAULT gen_random_uuid(),
  order_id     uuid    NOT NULL,
  menu_item_id uuid    NOT NULL,
  quantity     integer NOT NULL CHECK (quantity > 0),
  price        numeric NOT NULL,
  self_price   numeric          DEFAULT 0.00 CHECK (self_price >= 0),
  created_at   timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT order_items_pkey PRIMARY KEY (id),
  CONSTRAINT order_items_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id),
  CONSTRAINT order_items_menu_item_id_fkey
    FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id)
);

CREATE TABLE public.order_comments (
  id         uuid  NOT NULL DEFAULT gen_random_uuid(),
  order_id   uuid  NOT NULL,
  comment    text,
  created_at timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT order_comments_pkey PRIMARY KEY (id),
  CONSTRAINT order_comments_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id)
);

CREATE TABLE public.order_logs (
  id         uuid  NOT NULL DEFAULT gen_random_uuid(),
  order_id   uuid  NOT NULL,
  action     text  NOT NULL,
  details    jsonb,
  created_by uuid,
  created_at timestamp DEFAULT now(),
  CONSTRAINT order_logs_pkey PRIMARY KEY (id),
  CONSTRAINT order_logs_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id)
);


-- ── PAYMENTS ────────────────────────────────────────────────────────────────

CREATE TABLE public.payments (
  id               uuid           NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id    uuid           NOT NULL,
  guest_profile_id uuid           NOT NULL,
  amount           numeric        NOT NULL,
  status           payment_status NOT NULL DEFAULT 'pending',
  hash_id          text           NOT NULL UNIQUE,
  created_at       timestamp      NOT NULL DEFAULT now(),
  updated_at       timestamp      NOT NULL DEFAULT now(),
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id),
  CONSTRAINT payments_guest_profile_id_fkey
    FOREIGN KEY (guest_profile_id) REFERENCES public.guest_profiles(id)
);

CREATE TABLE public.order_payment_links (
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL,
  payment_id uuid NOT NULL,
  CONSTRAINT order_payment_links_pkey PRIMARY KEY (id),
  CONSTRAINT order_payment_links_unique UNIQUE (order_id, payment_id),
  CONSTRAINT order_payment_links_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id),
  CONSTRAINT order_payment_links_payment_id_fkey
    FOREIGN KEY (payment_id) REFERENCES public.payments(id)
);


-- ── BOOKINGS / RESERVATIONS ─────────────────────────────────────────────────

CREATE TABLE public.restaurant_reservations (
  id                    uuid    NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id         uuid    NOT NULL,
  -- Customer
  customer_name         text    NOT NULL,
  phone                 text,
  email                 text,
  guests                integer NOT NULL CHECK (guests >= 1),
  duration_minutes      integer NOT NULL DEFAULT 120,
  note                  text,
  -- Timing
  starts_at             timestamp NOT NULL,
  ends_at               timestamp NOT NULL,
  -- Status & flow
  status                text    NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending', 'confirmed', 'cancelled'
                        )),
  confirmation_code     text,
  created_by_admin      boolean NOT NULL DEFAULT false,
  admin_note            text,
  cancelled_at          timestamp,
  -- Arrival tracking
  arrival_status        text    CHECK (arrival_status IN ('arrived', 'no_show')),
  arrived_at            timestamp,
  -- POS sync
  iiko_reserve_id       uuid,
  iiko_creation_status  text,
  created_at            timestamp NOT NULL DEFAULT timezone('utc', now()),
  updated_at            timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT restaurant_reservations_pkey PRIMARY KEY (id),
  CONSTRAINT rr_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);

-- Multi-table reservations
CREATE TABLE public.restaurant_reservation_tables (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL,
  table_id       uuid NOT NULL,
  CONSTRAINT restaurant_reservation_tables_pkey PRIMARY KEY (id),
  CONSTRAINT rrt_unique UNIQUE (reservation_id, table_id),
  CONSTRAINT rrt_reservation_fkey
    FOREIGN KEY (reservation_id) REFERENCES public.restaurant_reservations(id),
  CONSTRAINT rrt_table_fkey
    FOREIGN KEY (table_id) REFERENCES public.restaurant_tables(id)
);


-- ── REVIEWS ─────────────────────────────────────────────────────────────────
-- Dropped: reviews, review_replies (replaced by restaurant_reviews with inline reply)

CREATE TABLE public.restaurant_reviews (
  id               uuid    NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id    uuid    NOT NULL,
  guest_profile_id uuid    NOT NULL,
  rating           integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment          text    NOT NULL,
  helpful_count    integer NOT NULL DEFAULT 0,
  is_approved      boolean NOT NULL DEFAULT true,
  reply_text       text,
  reply_author     text,
  reply_date       timestamptz,
  created_at       timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT restaurant_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT restaurant_reviews_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id),
  CONSTRAINT restaurant_reviews_guest_profile_id_fkey
    FOREIGN KEY (guest_profile_id) REFERENCES public.guest_profiles(id)
);

CREATE TABLE public.review_helpful_votes (
  id               uuid      NOT NULL DEFAULT gen_random_uuid(),
  review_id        uuid      NOT NULL,
  guest_profile_id uuid      NOT NULL,
  created_at       timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT review_helpful_votes_pkey PRIMARY KEY (id),
  CONSTRAINT review_helpful_votes_unique UNIQUE (review_id, guest_profile_id),
  CONSTRAINT review_helpful_votes_review_id_fkey
    FOREIGN KEY (review_id) REFERENCES public.restaurant_reviews(id),
  CONSTRAINT review_helpful_votes_guest_profile_id_fkey
    FOREIGN KEY (guest_profile_id) REFERENCES public.guest_profiles(id)
);


-- ── STAFF ───────────────────────────────────────────────────────────────────

CREATE TABLE public.staff (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id  uuid    NOT NULL,
  name           varchar NOT NULL,
  second_name    varchar,
  third_name     varchar,
  contact_number varchar,
  role           varchar NOT NULL,
  created_at     timestamp DEFAULT now(),
  updated_at     timestamp DEFAULT now(),
  CONSTRAINT staff_pkey PRIMARY KEY (id),
  CONSTRAINT staff_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);

-- Fixed: added restaurant_id + changed UNIQUE from (date) to (restaurant_id, date)
CREATE TABLE public.staff_schedule (
  id            uuid  NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid  NOT NULL,
  date          date  NOT NULL,
  created_at    timestamp DEFAULT now(),
  updated_at    timestamp DEFAULT now(),
  CONSTRAINT staff_schedule_pkey PRIMARY KEY (id),
  CONSTRAINT staff_schedule_restaurant_date_unique UNIQUE (restaurant_id, date),
  CONSTRAINT staff_schedule_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);

CREATE TABLE public.staff_schedule_link (
  id                uuid  NOT NULL DEFAULT gen_random_uuid(),
  staff_id          uuid  NOT NULL,
  staff_schedule_id uuid  NOT NULL,
  shift_start       time  NOT NULL,
  shift_end         time  NOT NULL,
  created_at        timestamp DEFAULT now(),
  updated_at        timestamp DEFAULT now(),
  CONSTRAINT staff_schedule_link_pkey PRIMARY KEY (id),
  CONSTRAINT staff_schedule_link_staff_id_fkey
    FOREIGN KEY (staff_id) REFERENCES public.staff(id),
  CONSTRAINT staff_schedule_link_staff_schedule_id_fkey
    FOREIGN KEY (staff_schedule_id) REFERENCES public.staff_schedule(id)
);


-- ── RESTAURANT INFO & STATUS ─────────────────────────────────────────────────

CREATE TABLE public.restaurant_info (
  id            uuid    NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid    NOT NULL,
  category      varchar NOT NULL,
  question      text    NOT NULL,
  answer        text    NOT NULL,
  created_at    timestamp NOT NULL DEFAULT timezone('utc', now()),
  updated_at    timestamp NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT restaurant_info_pkey PRIMARY KEY (id),
  CONSTRAINT restaurant_info_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);

-- Defined after staff_schedule so the FK resolves
CREATE TABLE public.restaurant_status (
  id                uuid    NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id     uuid    NOT NULL,
  status            varchar NOT NULL,
  staff_schedule_id uuid,
  created_at        timestamp DEFAULT now(),
  updated_at        timestamp DEFAULT now(),
  CONSTRAINT restaurant_status_pkey PRIMARY KEY (id),
  CONSTRAINT restaurant_status_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id),
  CONSTRAINT restaurant_status_staff_schedule_id_fkey
    FOREIGN KEY (staff_schedule_id) REFERENCES public.staff_schedule(id)
);
