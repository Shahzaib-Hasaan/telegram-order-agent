-- Tandoor & Bun — Gulberg III, Lahore
-- Demo menu. Prices in whole PKR, anchored to real 2026 Lahore market rates
-- (KFC Zinger Rs 600 / Mighty Zinger Rs 770; independents run ~10-20% under).
-- `aliases` carry Roman Urdu + common misspellings so check_item resolves
-- "aik zingr", "adha karahi", "thanda" without the LLM inventing items.
-- Idempotent: re-running replaces the menu cleanly.

BEGIN;

TRUNCATE products RESTART IDENTITY CASCADE;

INSERT INTO products (name, aliases, description, price, category, sort_order) VALUES

-- ===================== BURGERS =====================
('Zinger Burger',
 ARRAY['zinger','zingr','zingar','zinger burgr','singer burger','zinger brgr'],
 'Crispy fried chicken fillet, lettuce, mayo, toasted sesame bun.',
 550, 'Burgers', 10),

('Mighty Zinger',
 ARRAY['mighty','mighty zinger','bara zinger','double zinger','mighty zingr'],
 'Double chicken fillet, cheese, lettuce, spicy mayo.',
 720, 'Burgers', 20),

('Beef Tandoori Burger',
 ARRAY['beef burger','tandoori burger','beef tandoori','tandori burger'],
 'Char-grilled beef patty with tandoori masala and mint raita.',
 680, 'Burgers', 30),

('Chicken Cheese Burger',
 ARRAY['cheese burger','chicken burger','cheez burger','chicken cheese'],
 'Grilled chicken patty, melted cheddar, house sauce.',
 480, 'Burgers', 40),

-- ===================== DESI =====================
('Chicken Karahi (Half)',
 ARRAY['karahi','chicken karahi','adha karahi','half karahi','karhai','kadhai'],
 'Half kg boneless chicken karahi, tomato and green chilli.',
 1450, 'Desi', 50),

('Chicken Karahi (Full)',
 ARRAY['full karahi','poori karahi','bari karahi','full chicken karahi'],
 'Full kg boneless chicken karahi, serves 3-4.',
 2700, 'Desi', 60),

('Chicken Biryani',
 ARRAY['biryani','chicken biryani','biriyani','briyani','chicken briyani'],
 'Sindhi-style chicken biryani with aloo and raita.',
 420, 'Desi', 70),

('Beef Biryani',
 ARRAY['beef biryani','beef briyani','beef biriyani'],
 'Slow-cooked beef biryani with saffron rice.',
 480, 'Desi', 80),

('Daal Makhani',
 ARRAY['daal','dal','daal makhani','dal makhani','maash ki daal'],
 'Black lentils simmered overnight with butter and cream.',
 380, 'Desi', 90),

-- ===================== BBQ =====================
('Seekh Kabab (4 pc)',
 ARRAY['seekh','kabab','kebab','seekh kabab','sikh kabab','seekh kebab'],
 'Four minced beef seekh kababs off the charcoal tandoor.',
 560, 'BBQ', 100),

('Chicken Tikka',
 ARRAY['tikka','chicken tikka','tika','chiken tikka'],
 'Quarter chicken marinated overnight, tandoor-fired.',
 450, 'BBQ', 110),

('Malai Boti',
 ARRAY['malai boti','boti','malai','malaai boti'],
 'Creamy cheese-marinated boneless chicken boti.',
 620, 'BBQ', 120),

('BBQ Platter',
 ARRAY['platter','bbq platter','mixed platter','barbeque platter','bar b q platter'],
 'Seekh kabab, malai boti, chicken tikka, naan and raita. Serves 2.',
 1850, 'BBQ', 130),

-- ===================== SIDES =====================
('Loaded Fries',
 ARRAY['loaded fries','loded fries','cheese fries','fully loaded fries'],
 'Fries under cheese sauce, jalapenos and shredded chicken.',
 480, 'Sides', 140),

('Regular Fries',
 ARRAY['fries','chips','french fries','frys','simple fries'],
 'Salted crinkle-cut fries.',
 250, 'Sides', 150),

('Coleslaw',
 ARRAY['coleslaw','cole slaw','salad'],
 'Creamy cabbage and carrot slaw.',
 140, 'Sides', 160),

('Raita',
 ARRAY['raita','raita','yogurt','dahi'],
 'Mint and cucumber yoghurt.',
 80, 'Sides', 170),

-- ===================== BREADS =====================
('Garlic Naan',
 ARRAY['naan','garlic naan','garlic nan','lehsan naan'],
 'Tandoor naan brushed with garlic butter.',
 90, 'Breads', 180),

('Roghni Naan',
 ARRAY['roghni','roghni naan','rogni naan'],
 'Sesame-topped enriched naan.',
 110, 'Breads', 190),

('Plain Roti',
 ARRAY['roti','tandoori roti','chapati','rooti'],
 'Plain tandoori roti.',
 40, 'Breads', 200),

-- ===================== DRINKS =====================
('Soft Drink 345ml',
 ARRAY['coke','pepsi','sprite','7up','drink','cold drink','thanda','soft drink','can'],
 'Chilled can. Coke, Pepsi, Sprite or 7Up.',
 120, 'Drinks', 210),

('Soft Drink 1.5L',
 ARRAY['bara coke','1.5 litre','bottle','bari bottle','family bottle','dairh litre'],
 'Family-size 1.5 litre bottle.',
 280, 'Drinks', 220),

('Sweet Lassi',
 ARRAY['lassi','sweet lassi','meethi lassi','lassy'],
 'Chilled sweet yoghurt lassi.',
 220, 'Drinks', 230),

('Mineral Water',
 ARRAY['water','pani','mineral water','bottle water','paani'],
 '500ml mineral water.',
 80, 'Drinks', 240),

-- ===================== DESSERTS =====================
('Kheer',
 ARRAY['kheer','rice pudding','kheer bowl'],
 'Slow-cooked rice pudding with pistachio.',
 180, 'Desserts', 250),

('Gulab Jamun (2 pc)',
 ARRAY['gulab jamun','gulab','jamun','gulab jaman'],
 'Two warm gulab jamun in syrup.',
 160, 'Desserts', 260);

COMMIT;
