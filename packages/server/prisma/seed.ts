import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build a Classic + Cheese pair for burgers / rolls / sandwiches */
function withCheese(
  canteenId: string,
  categoryId: string,
  name: string,
  isVeg: boolean,
  classicPrice: number,
  cheesePrice: number,
  prepTimeMinutes = 10,
  containsEgg = false,
) {
  return [
    { canteenId, categoryId, name: `${name} (Classic)`, price: classicPrice, isVeg, containsEgg, prepTimeMinutes, isAvailable: true },
    { canteenId, categoryId, name: `${name} (with Cheese)`, price: cheesePrice, isVeg, containsEgg, prepTimeMinutes, isAvailable: true },
  ];
}

/** Single item shorthand */
function item(
  canteenId: string,
  categoryId: string,
  name: string,
  price: number,
  isVeg: boolean,
  prepTimeMinutes: number,
  opts: { description?: string; containsEgg?: boolean; isPopular?: boolean; isJain?: boolean; isAvailable?: boolean } = {},
) {
  return {
    canteenId,
    categoryId,
    name,
    price,
    isVeg,
    prepTimeMinutes,
    description: opts.description ?? '',
    containsEgg: opts.containsEgg ?? false,
    isPopular: opts.isPopular ?? false,
    isJain: opts.isJain ?? false,
    isAvailable: opts.isAvailable ?? true,
  };
}

// ─── inline slot helpers (avoids importing server services / Redis) ───────────

function makeTimeSlots(
  startH: number, startM: number,
  endH: number, endM: number,
  intervalMin: number,
  maxOrders: number,
): Array<{ startTime: string; endTime: string; maxOrders: number }> {
  const slots: Array<{ startTime: string; endTime: string; maxOrders: number }> = [];
  let h = startH, m = startM;
  const pad = (n: number) => String(n).padStart(2, '0');
  while (h < endH || (h === endH && m <= endM)) {
    const nextM = m + intervalMin;
    const nextH = nextM >= 60 ? h + 1 : h;
    const nm = nextM % 60;
    slots.push({ startTime: `${pad(h)}:${pad(m)}`, endTime: `${pad(nextH)}:${pad(nm)}`, maxOrders });
    h = nextH; m = nm;
  }
  return slots;
}

async function createSlotsForCanteen(canteenId: string, date: Date, maxOrders = 25) {
  const slotDefs = [
    ...makeTimeSlots(7, 45, 10, 30, 15, maxOrders),
    ...makeTimeSlots(12, 0, 14, 30, 15, maxOrders),
  ];
  await prisma.pickupSlot.createMany({
    data: slotDefs.map(s => ({
      canteenId,
      date,
      startTime: s.startTime,
      endTime: s.endTime,
      maxOrders,
    })),
    skipDuplicates: true,
  });
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  Seeding database…');

  // ── 0. Wipe old menu data (safe — preserves orders / wallets / users) ────────
 // ── 0. Wipe ALL data in correct order ────────
await prisma.wallet.deleteMany({});
await prisma.user.deleteMany({});
 await prisma.walletTransaction.deleteMany({});
await prisma.notification.deleteMany({});
await prisma.rating.deleteMany({});
await prisma.favorite.deleteMany({});
await prisma.orderItem.deleteMany({});
await prisma.order.deleteMany({});
await prisma.announcement.deleteMany({});
await prisma.dailySettlement.deleteMany({});
await prisma.menuItem.deleteMany({});
await prisma.menuCategory.deleteMany({});
await prisma.pickupSlot.deleteMany({});
await prisma.canteen.deleteMany({});
  console.log('Old canteen / menu data cleared.');

  // ── 1. Canteens ───────────────────────────────────────────────────────────────
  const canteensData = [
    // ① Mingoes
    {
      name: 'Mingoes',
      description: 'Popular multi-cuisine canteen with burgers, rolls, momos, pasta and beverages.',
      campus: 'Central Campus',
      location: 'Main Block, Ground Floor',
      openingTime: '08:00',
      closingTime: '21:00',
      avgPrepTime: 10,
      isActive: true,
      contactPhone: '080-12345001',
    },
    // ② Christ Bakery
    {
      name: 'Christ Bakery',
      description: 'South Indian breakfast canteen — dosas, idli, poori and rice meals.',
      campus: 'Central Campus',
      location: 'Main Block, Near Auditorium',
      openingTime: '08:00',
      closingTime: '20:00',
      avgPrepTime: 8,
      isActive: true,
      contactPhone: '080-12345002',
    },
    // ③ Eleven
    {
      name: 'Eleven',
      description: 'All-day canteen serving breakfast, lunch, burgers, rolls, sandwiches and puffs.',
      campus: 'Central Campus',
      location: 'Main Block, Block C',
      openingTime: '08:00',
      closingTime: '20:00',
      avgPrepTime: 10,
      isActive: true,
      contactPhone: '080-12345003',
    },
    // ④ Michael's Corner
    {
      name: "Michael's Corner",
      description: 'Diverse menu with dosas, sandwiches, subs, burgers, biryani, fried rice and bakery.',
      campus: 'Central Campus',
      location: 'Main Block, First Floor',
      openingTime: '08:00',
      closingTime: '20:00',
      avgPrepTime: 12,
      isActive: true,
      contactPhone: '080-12345004',
    },
    // ⑤ Punjabi Bites
    {
      name: 'Punjabi Bites',
      description: 'North & South Indian cuisine, Chinese, tandoor, meals, thalis and combos.',
      campus: 'Central Campus',
      location: 'Main Block, Ground Floor',
      openingTime: '08:00',
      closingTime: '20:00',
      avgPrepTime: 15,
      isActive: true,
      contactPhone: '080-12345005',
    },
    // ⑥ Mariyan Cafe
    {
      name: 'Mariyan Cafe',
      description: 'Kerala-style lunch canteen with biryani, meals, kappa and fresh juices.',
      campus: 'Central Campus',
      location: 'R&D Block',
      openingTime: '11:00',
      closingTime: '15:00',
      avgPrepTime: 10,
      isActive: true,
      contactPhone: '080-12345006',
    },
    // ⑦ Bhavani Foods
    {
      name: 'Bhavani Foods',
      description: 'Wholesome vegetarian food — breakfast, chaat, sandwiches, meals and sweets.',
      campus: 'Central Campus',
      location: 'R&D Block',
      openingTime: '08:00',
      closingTime: '18:00',
      avgPrepTime: 8,
      isActive: true,
      contactPhone: '080-12345007',
    },
    // ⑧ Hari Super Sandwich
    {
      name: 'Hari Super Sandwich',
      description: 'Sandwich specialist with milkshakes, chaats, pav bhaji and burgers.',
      campus: 'Central Campus',
      location: 'R&D Block',
      openingTime: '08:30',
      closingTime: '18:00',
      avgPrepTime: 7,
      isActive: true,
      contactPhone: '080-12345008',
    },
    // ⑨ Kiosk Canteen
    {
      name: 'Kiosk Canteen',
      description: 'Quick breakfast and lunch canteen with South Indian staples.',
      campus: 'Central Campus',
      location: 'Main Block, Kiosk',
      openingTime: '08:00',
      closingTime: '15:00',
      avgPrepTime: 8,
      isActive: true,
      contactPhone: '080-12345009',
    },
    // ⑩ Birds Park (menu pending)
    {
      name: 'Birds Park',
      description: 'Coming soon — menu being updated.',
      campus: 'Central Campus',
      location: 'Main Block',
      openingTime: '09:00',
      closingTime: '19:00',
      avgPrepTime: 10,
      isActive: true,
      contactPhone: '080-12345010',
    },
    // ⑪ Freshetaria (menu pending)
    {
      name: 'Freshetaria',
      description: 'Fresh juices, smoothies and healthy snacks — menu coming soon.',
      campus: 'Central Campus',
      location: 'Main Block, Near Library',
      openingTime: '08:00',
      closingTime: '18:00',
      avgPrepTime: 5,
      isActive: true,
      contactPhone: '080-12345011',
    },
  ];

  const canteens = await Promise.all(
    canteensData.map((c) => prisma.canteen.create({ data: c })),
  );

  const [
    mingoes, bakery, eleven, michaels, punjabi,
    mariyan, bhavani, hari, kiosk, birdsPark, freshetaria,
  ] = canteens;

  console.log(`✅  ${canteens.length} canteens created.`);

  // ════════════════════════════════════════════════════════════════════════════
  // ① MINGOES
  // ════════════════════════════════════════════════════════════════════════════
  const [mHotBev, mColdBev, mMaggi, mBurger, mRolls, mSandwich, mRiceNoodles, mPasta, mMomos, mSnacks, mCombos] =
    await Promise.all([
      prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Hot Beverages',    sortOrder: 1 } }),
      prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Cold Beverages',   sortOrder: 2 } }),
      prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Maggi',            sortOrder: 3 } }),
      prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Burgers & Vada Pav', sortOrder: 4 } }),
      prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Rolls',            sortOrder: 5 } }),
      prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Sandwiches',       sortOrder: 6 } }),
      prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Rice & Noodles',   sortOrder: 7 } }),
      prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Pasta',            sortOrder: 8 } }),
      prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Momos',            sortOrder: 9 } }),
      prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Snacks',           sortOrder: 10 } }),
      prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Combos',           sortOrder: 11 } }),
    ]);

  await prisma.menuItem.createMany({
    data: [
      // HOT BEVERAGES
      item(mingoes.id, mHotBev.id, 'Coffee',           12, true,  3, { description: 'Hot freshly brewed coffee' }),
      item(mingoes.id, mHotBev.id, 'Tea',              12, true,  3, { description: 'Hot masala chai' }),
      item(mingoes.id, mHotBev.id, 'Lemon Tea',        12, true,  3, { description: 'Refreshing hot lemon tea' }),
      item(mingoes.id, mHotBev.id, 'Green Tea',        12, true,  3, { description: 'Healthy hot green tea' }),
      item(mingoes.id, mHotBev.id, 'Hot Chocolate',    25, true,  4, { description: 'Rich creamy hot chocolate' }),
      // COLD BEVERAGES
      item(mingoes.id, mColdBev.id, 'Lemon Ice Tea',   30, true,  3, { description: 'Chilled lemon iced tea', isPopular: true }),
      item(mingoes.id, mColdBev.id, 'Cold Orange',     30, true,  3, { description: 'Chilled orange drink' }),
      item(mingoes.id, mColdBev.id, 'Cold Coffee',     40, true,  4, { description: 'Chilled cold coffee', isPopular: true }),
      item(mingoes.id, mColdBev.id, 'Cold Chocolate',  40, true,  4, { description: 'Chilled chocolate drink' }),
      item(mingoes.id, mColdBev.id, 'Cold Mochaccino', 40, true,  4, { description: 'Chilled mocha coffee blend' }),
      // MAGGI
      item(mingoes.id, mMaggi.id, 'Maggi (Masala)',          35, true,  7, { description: 'Classic masala Maggi noodles' }),
      item(mingoes.id, mMaggi.id, 'Maggi (Extra Masala)',     45, true,  7, { description: 'Maggi loaded with extra masala' }),
      item(mingoes.id, mMaggi.id, 'Maggi (Corn)',             45, true,  7, { description: 'Maggi with sweet corn' }),
      item(mingoes.id, mMaggi.id, 'Maggi (Peri Peri)',        45, true,  7, { description: 'Spicy peri peri Maggi' }),
      item(mingoes.id, mMaggi.id, 'Cheese Maggi',             45, true,  8, { description: 'Maggi topped with melted cheese' }),
      item(mingoes.id, mMaggi.id, 'Egg Bhurji Maggi',         50, false, 9, { description: 'Maggi tossed with spiced egg bhurji', containsEgg: true }),
      // BURGERS & VADA PAV
      ...withCheese(mingoes.id, mBurger.id, 'Veg Burger',              true,  50, 60),
      ...withCheese(mingoes.id, mBurger.id, 'Chicken Burger',          false, 60, 70),
      ...withCheese(mingoes.id, mBurger.id, 'Peri Peri Chicken Burger',false, 80, 90),
      ...withCheese(mingoes.id, mBurger.id, 'Barbeque Chicken Burger', false, 80, 90),
      ...withCheese(mingoes.id, mBurger.id, 'Vada Pav',               true,  30, 40, 5),
      ...withCheese(mingoes.id, mBurger.id, 'Bun Samosa',             true,  40, 50, 5),
      // ROLLS
      ...withCheese(mingoes.id, mRolls.id, 'Veg Roll',                true,  50, 60),
      ...withCheese(mingoes.id, mRolls.id, 'Gobi Roll',               true,  70, 80),
      ...withCheese(mingoes.id, mRolls.id, 'Paneer Roll',             true,  80, 90),
      ...withCheese(mingoes.id, mRolls.id, 'Chicken Roll',            false, 70, 80),
      ...withCheese(mingoes.id, mRolls.id, 'Peri Peri Chicken Roll',  false, 80, 90),
      ...withCheese(mingoes.id, mRolls.id, 'Barbeque Chicken Roll',   false, 80, 90),
      // SANDWICHES
      item(mingoes.id, mSandwich.id, 'Veg Mayo Sandwich',                  50, true,  8, { description: 'Fresh veg sandwich with mayo' }),
      item(mingoes.id, mSandwich.id, 'Corn Mayo Sandwich',                 50, true,  8, { description: 'Sweet corn sandwich with mayo' }),
      item(mingoes.id, mSandwich.id, 'Corn Cheese Sandwich',               60, true,  8, { description: 'Grilled corn and cheese sandwich' }),
      ...withCheese(mingoes.id, mSandwich.id, 'Paneer Sandwich',            true,  80, 90),
      ...withCheese(mingoes.id, mSandwich.id, 'Chicken Sandwich',           false, 70, 80),
      ...withCheese(mingoes.id, mSandwich.id, 'Peri Peri Chicken Sandwich', false, 80, 90),
      ...withCheese(mingoes.id, mSandwich.id, 'Barbeque Chicken Sandwich',  false, 80, 90),
      // RICE & NOODLES
      item(mingoes.id, mRiceNoodles.id, 'Veg Fried Rice / Noodles',     70, true,  10, { description: 'Veg stir-fried rice or noodles' }),
      item(mingoes.id, mRiceNoodles.id, 'Egg Fried Rice / Noodles',     80, false, 10, { description: 'Egg stir-fried rice or noodles', containsEgg: true }),
      item(mingoes.id, mRiceNoodles.id, 'Chicken Fried Rice / Noodles', 90, false, 10, { description: 'Chicken stir-fried rice or noodles' }),
      // PASTA
      item(mingoes.id, mPasta.id, 'Pasta Alfredo — Veg (White Sauce)',           70,  true,  12, { description: 'Creamy white sauce pasta with veggies' }),
      item(mingoes.id, mPasta.id, 'Pasta Alfredo — Chicken (White Sauce)',       90,  false, 12, { description: 'Creamy white sauce pasta with chicken' }),
      item(mingoes.id, mPasta.id, 'Pasta Alfredo with Cheese — Veg',             80,  true,  12, { description: 'White sauce pasta loaded with cheese' }),
      item(mingoes.id, mPasta.id, 'Pasta Alfredo with Cheese — Chicken',         100, false, 12, { description: 'White sauce pasta with chicken and cheese' }),
      item(mingoes.id, mPasta.id, 'Peri Peri Mac N Cheese — Veg',                90,  true,  12, { description: 'Spicy peri peri mac and cheese' }),
      item(mingoes.id, mPasta.id, 'Peri Peri Mac N Cheese — Chicken',            110, false, 12, { description: 'Spicy peri peri mac and cheese with chicken' }),
      // MOMOS
      item(mingoes.id, mMomos.id, 'Veg Momo',              50, true,  10, { description: 'Steamed vegetable dumplings with chutney' }),
      item(mingoes.id, mMomos.id, 'Chicken Momo',          50, false, 10, { description: 'Steamed chicken dumplings with chutney' }),
      item(mingoes.id, mMomos.id, 'Veg Momo Chaat',        60, true,  10, { description: 'Fried veg momos tossed in spicy chaat masala' }),
      item(mingoes.id, mMomos.id, 'Chicken Momo Chaat',    60, false, 10, { description: 'Fried chicken momos tossed in spicy chaat masala' }),
      item(mingoes.id, mMomos.id, 'Veg Manchurian',        70, true,  10, { description: 'Crispy veg balls in Manchurian sauce' }),
      item(mingoes.id, mMomos.id, 'Chicken Manchurian',    70, false, 10, { description: 'Crispy chicken in Manchurian sauce' }),
      // SNACKS
      item(mingoes.id, mSnacks.id, 'Potato Pop',              60, true,  8,  { description: 'Crispy seasoned potato pops' }),
      item(mingoes.id, mSnacks.id, 'French Fries (Salted)',    60, true,  7,  { description: 'Golden salted french fries' }),
      item(mingoes.id, mSnacks.id, 'French Fries (Peri Peri)', 60, true,  7,  { description: 'Spicy peri peri french fries', isPopular: true }),
      item(mingoes.id, mSnacks.id, 'Jungli Fungli',            70, true,  8,  { description: 'Spicy mushroom snack' }),
      item(mingoes.id, mSnacks.id, 'Non Veg Jungli Fungli',    90, false, 8,  { description: 'Spicy non-veg mushroom and chicken snack' }),
      item(mingoes.id, mSnacks.id, 'Chicken Popcorn',          70, false, 8,  { description: 'Crispy seasoned chicken popcorn bites' }),
      // COMBOS
      item(mingoes.id, mCombos.id, 'Veg Chinese Combo',     90,  true,  12, { description: 'Veg fried rice + veg Manchurian' }),
      item(mingoes.id, mCombos.id, 'Non Veg Chinese Combo', 110, false, 12, { description: 'Chicken fried rice + chicken Manchurian' }),
    ],
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ② CHRIST BAKERY
  // ════════════════════════════════════════════════════════════════════════════
  const [cbSouthIndian, cbRice, cbBreads] = await Promise.all([
    prisma.menuCategory.create({ data: { canteenId: bakery.id, name: 'South Indian',   sortOrder: 1, availableFrom: '08:00', availableTo: '11:00' } }),
    prisma.menuCategory.create({ data: { canteenId: bakery.id, name: 'Rice & Meals',   sortOrder: 2 } }),
    prisma.menuCategory.create({ data: { canteenId: bakery.id, name: 'Indian Breads',  sortOrder: 3 } }),
  ]);

  await prisma.menuItem.createMany({
    data: [
      item(bakery.id, cbSouthIndian.id, 'Idli Vada',      50, true,  8,  { description: 'Soft idlis with crispy vada, chutney & sambar', isPopular: true }),
      item(bakery.id, cbSouthIndian.id, 'Vada (2 pcs)',   40, true,  6,  { description: 'Crispy medu vada with chutney & sambar' }),
      item(bakery.id, cbSouthIndian.id, 'Masala Dosa',    60, true,  10, { description: 'Crispy dosa with spiced potato filling', isPopular: true }),
      item(bakery.id, cbSouthIndian.id, 'Plain Dosa',     40, true,  8,  { description: 'Crispy plain dosa with chutney & sambar' }),
      item(bakery.id, cbSouthIndian.id, 'Onion Dosa',     50, true,  9,  { description: 'Crispy dosa loaded with onions' }),
      item(bakery.id, cbSouthIndian.id, 'Set Dosa',       50, true,  9,  { description: 'Soft set dosa (3 pcs) with chutney & sambar' }),
      item(bakery.id, cbRice.id, 'Veg Pulav',         50, true,  8,  { description: 'Fragrant vegetable pulav with raita' }),
      item(bakery.id, cbRice.id, 'Bisibelebath',      50, true,  5,  { description: 'Karnataka-style spiced rice and lentil dish' }),
      item(bakery.id, cbRice.id, 'Lemon Rice',        50, true,  5,  { description: 'Tangy lemon-flavoured rice with peanuts' }),
      item(bakery.id, cbRice.id, 'Poori',             50, true,  8,  { description: 'Fluffy deep-fried puris with potato sabzi' }),
      item(bakery.id, cbBreads.id, 'Porotta with Veg Curry',  60, true,  8,  { description: 'Flaky Kerala porotta with vegetable curry' }),
      item(bakery.id, cbBreads.id, 'Porotta with Egg Curry',  70, false, 9,  { description: 'Flaky Kerala porotta with egg curry', containsEgg: true }),
      item(bakery.id, cbBreads.id, 'Chapathi with Veg Curry', 50, true,  8,  { description: 'Soft chapathi with vegetable curry' }),
      item(bakery.id, cbBreads.id, 'Chapathi with Egg Curry', 60, false, 9,  { description: 'Soft chapathi with egg curry', containsEgg: true }),
    ],
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ③ ELEVEN
  // ════════════════════════════════════════════════════════════════════════════
  const [elHotBev, elColdBev, elBreakfast, elLunch, elBurger, elSandwich, elRolls, elPuffs] =
    await Promise.all([
      prisma.menuCategory.create({ data: { canteenId: eleven.id, name: 'Hot Beverages',    sortOrder: 1 } }),
      prisma.menuCategory.create({ data: { canteenId: eleven.id, name: 'Cold Beverages',   sortOrder: 2 } }),
      prisma.menuCategory.create({ data: { canteenId: eleven.id, name: 'Breakfast',        sortOrder: 3, availableFrom: '08:00', availableTo: '11:00' } }),
      prisma.menuCategory.create({ data: { canteenId: eleven.id, name: 'Lunch & Meals',    sortOrder: 4, availableFrom: '11:00', availableTo: '15:00' } }),
      prisma.menuCategory.create({ data: { canteenId: eleven.id, name: 'Burgers & Vada Pav', sortOrder: 5 } }),
      prisma.menuCategory.create({ data: { canteenId: eleven.id, name: 'Sandwiches',       sortOrder: 6 } }),
      prisma.menuCategory.create({ data: { canteenId: eleven.id, name: 'Rolls',            sortOrder: 7 } }),
      prisma.menuCategory.create({ data: { canteenId: eleven.id, name: 'Puffs',            sortOrder: 8 } }),
    ]);

  await prisma.menuItem.createMany({
    data: [
      // HOT BEVERAGES
      item(eleven.id, elHotBev.id, 'Coffee',      12, true, 3),
      item(eleven.id, elHotBev.id, 'Tea',         12, true, 3),
      item(eleven.id, elHotBev.id, 'Lemon Tea',   12, true, 3),
      // COLD BEVERAGES
      item(eleven.id, elColdBev.id, 'Lemon Ice Tea', 30, true, 3),
      item(eleven.id, elColdBev.id, 'Cold Coffee',   40, true, 4, { isPopular: true }),
      // BREAKFAST
      item(eleven.id, elBreakfast.id, 'Idly (2 pcs)',    30, true, 6, { description: 'Soft steamed idlis with chutney & sambar' }),
      item(eleven.id, elBreakfast.id, 'Tatte Idly',      25, true, 6, { description: 'Large flat Bangalore-style tatte idli' }),
      item(eleven.id, elBreakfast.id, 'Medu Vada (2 pcs)', 30, true, 6, { description: 'Crispy medu vadas with chutney & sambar' }),
      item(eleven.id, elBreakfast.id, 'Veg Pulav',       50, true, 8, { description: 'Fragrant vegetable pulav' }),
      item(eleven.id, elBreakfast.id, 'Puri Chole',      60, true, 8, { description: 'Fluffy puris with spiced chole' }),
      // LUNCH
      item(eleven.id, elLunch.id, 'Rajma Rice Combo',          70,  true,  10, { description: 'Rajma curry with steamed rice' }),
      item(eleven.id, elLunch.id, 'Chole Rice Combo',          70,  true,  10, { description: 'Chole curry with steamed rice' }),
      item(eleven.id, elLunch.id, 'Chicken Curry Combo',       100, false, 10, { description: 'Chicken curry with steamed rice' }),
      item(eleven.id, elLunch.id, 'Veg Fried Rice',            70,  true,  10),
      item(eleven.id, elLunch.id, 'Veg Noodles',               70,  true,  10),
      item(eleven.id, elLunch.id, 'Egg Fried Rice',            80,  false, 10, { containsEgg: true }),
      item(eleven.id, elLunch.id, 'Egg Noodles',               80,  false, 10, { containsEgg: true }),
      item(eleven.id, elLunch.id, 'Chicken Fried Rice',        100, false, 10),
      item(eleven.id, elLunch.id, 'Chicken Noodles',           100, false, 10),
      item(eleven.id, elLunch.id, 'Veg Chinese Combo',         90,  true,  12, { description: 'Veg fried rice + veg Manchurian', isPopular: true }),
      item(eleven.id, elLunch.id, 'Non Veg Chinese Combo',     120, false, 12, { description: 'Chicken fried rice + chicken Manchurian' }),
      item(eleven.id, elLunch.id, 'Chicken Biryani',           100, false, 12, { isPopular: true }),
      item(eleven.id, elLunch.id, 'Chicken Kabab Biryani',     100, false, 12, { description: 'Biryani with tender chicken kabab' }),
      // BURGERS
      ...withCheese(eleven.id, elBurger.id, 'Veg Burger',              true,  50, 60),
      ...withCheese(eleven.id, elBurger.id, 'Chicken Burger',          false, 60, 70),
      ...withCheese(eleven.id, elBurger.id, 'Peri Peri Chicken Burger',false, 80, 90),
      ...withCheese(eleven.id, elBurger.id, 'Barbeque Chicken Burger', false, 80, 90),
      ...withCheese(eleven.id, elBurger.id, 'Vada Pav',               true,  30, 40, 5),
      // SANDWICHES
      ...withCheese(eleven.id, elSandwich.id, 'Paneer Sandwich',             true,  80, 90),
      ...withCheese(eleven.id, elSandwich.id, 'Chicken Sandwich',            false, 70, 80),
      ...withCheese(eleven.id, elSandwich.id, 'Peri Peri Chicken Sandwich',  false, 80, 90),
      ...withCheese(eleven.id, elSandwich.id, 'Barbeque Chicken Sandwich',   false, 80, 90),
      // ROLLS
      ...withCheese(eleven.id, elRolls.id, 'Paneer Roll',            true,  80, 90),
      ...withCheese(eleven.id, elRolls.id, 'Chicken Roll',           false, 70, 80),
      ...withCheese(eleven.id, elRolls.id, 'Peri Peri Chicken Roll', false, 80, 90),
      ...withCheese(eleven.id, elRolls.id, 'Barbeque Chicken Roll',  false, 80, 90),
      // PUFFS
      item(eleven.id, elPuffs.id, 'Veg Puff',     20, true,  3, { description: 'Flaky pastry puff with spiced veg filling' }),
      item(eleven.id, elPuffs.id, 'Egg Puff',     20, false, 3, { description: 'Flaky pastry puff with egg filling', containsEgg: true }),
      item(eleven.id, elPuffs.id, 'Chicken Puff', 30, false, 3, { description: 'Flaky pastry puff with spiced chicken filling' }),
    ],
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ④ MICHAEL'S CORNER
  // ════════════════════════════════════════════════════════════════════════════
  const [mcSnacks, mcDosa, mcSubs, mcSandwich, mcBurger, mcBakery, mcBiryani, mcStemRice, mcFriedRice, mcHotBev, mcColdBev] =
    await Promise.all([
      prisma.menuCategory.create({ data: { canteenId: michaels.id, name: 'Snacks',            sortOrder: 1 } }),
      prisma.menuCategory.create({ data: { canteenId: michaels.id, name: 'Dosa / Dose',       sortOrder: 2 } }),
      prisma.menuCategory.create({ data: { canteenId: michaels.id, name: 'Subs (Grilled)',    sortOrder: 3 } }),
      prisma.menuCategory.create({ data: { canteenId: michaels.id, name: 'Sandwiches',        sortOrder: 4 } }),
      prisma.menuCategory.create({ data: { canteenId: michaels.id, name: 'Burgers',           sortOrder: 5 } }),
      prisma.menuCategory.create({ data: { canteenId: michaels.id, name: 'Bakery Items',      sortOrder: 6 } }),
      prisma.menuCategory.create({ data: { canteenId: michaels.id, name: 'Biryani & Rice Meals', sortOrder: 7 } }),
      prisma.menuCategory.create({ data: { canteenId: michaels.id, name: 'Steam Rice',        sortOrder: 8 } }),
      prisma.menuCategory.create({ data: { canteenId: michaels.id, name: 'Fried Rice & Noodles', sortOrder: 9 } }),
      prisma.menuCategory.create({ data: { canteenId: michaels.id, name: 'Hot Beverages',     sortOrder: 10 } }),
      prisma.menuCategory.create({ data: { canteenId: michaels.id, name: 'Cold Beverages',    sortOrder: 11 } }),
    ]);

  await prisma.menuItem.createMany({
    data: [
      // SNACKS
      item(michaels.id, mcSnacks.id, 'Samosa',              15, true, 3,  { description: 'Crispy fried samosa with chutney' }),
      item(michaels.id, mcSnacks.id, 'Bread Pakoda',        30, true, 5,  { description: 'Spiced bread fritters' }),
      item(michaels.id, mcSnacks.id, 'Vada Pav',            30, true, 4,  { description: 'Mumbai-style vada pav' }),
      item(michaels.id, mcSnacks.id, 'Cheese Vada Pav',     50, true, 4,  { description: 'Vada pav loaded with cheese' }),
      item(michaels.id, mcSnacks.id, 'Bun Samosa',          50, true, 4,  { description: 'Samosa tucked in a soft bun' }),
      item(michaels.id, mcSnacks.id, 'Cheese Bun Samosa',   65, true, 4,  { description: 'Cheese-loaded bun samosa' }),
      item(michaels.id, mcSnacks.id, 'Peri Peri Bun Samosa',60, true, 4,  { description: 'Spicy peri peri bun samosa' }),
      item(michaels.id, mcSnacks.id, 'Chipotle Bun Samosa', 60, true, 4,  { description: 'Smoky chipotle bun samosa' }),
      item(michaels.id, mcSnacks.id, 'Chinese Bhel',        50, true, 5,  { description: 'Crispy noodle bhel with tangy sauce' }),
      item(michaels.id, mcSnacks.id, 'Pav Bhaji',           80, true, 10, { description: 'Buttery spiced bhaji with pav', isPopular: true }),
      item(michaels.id, mcSnacks.id, 'Cheese Pav Bhaji',    110,true, 10, { description: 'Pav bhaji topped generously with cheese' }),
      // DOSA / DOSE
      item(michaels.id, mcDosa.id, 'Plain Dosa',                50,  true, 9,  { description: 'Crispy plain dosa with chutney & sambar' }),
      item(michaels.id, mcDosa.id, 'Cheese Dosa',               70,  true, 9,  { description: 'Dosa loaded with melted cheese' }),
      item(michaels.id, mcDosa.id, 'Paneer Dosa',               70,  true, 10, { description: 'Dosa stuffed with spiced paneer' }),
      item(michaels.id, mcDosa.id, 'Schezwan Dosa',             60,  true, 9,  { description: 'Dosa with spicy schezwan chutney' }),
      item(michaels.id, mcDosa.id, 'Cheese Schezwan Dosa',      80,  true, 10, { description: 'Schezwan dosa with melted cheese' }),
      item(michaels.id, mcDosa.id, 'Paneer Schezwan Dosa',      80,  true, 10, { description: 'Paneer and schezwan dosa' }),
      item(michaels.id, mcDosa.id, 'Cheese Paneer Schezwan Dosa',90, true, 11, { description: 'Ultimate cheese paneer schezwan dosa' }),
      item(michaels.id, mcDosa.id, 'Masala Dosa',               60,  true, 10, { description: 'Classic dosa with spiced potato masala', isPopular: true }),
      item(michaels.id, mcDosa.id, 'Cheese Masala Dosa',        90,  true, 11, { description: 'Masala dosa with cheese' }),
      item(michaels.id, mcDosa.id, 'Paneer Masala Dosa',        90,  true, 11, { description: 'Masala dosa with paneer filling' }),
      item(michaels.id, mcDosa.id, 'Schezwan Masala Dosa',      80,  true, 11, { description: 'Spicy schezwan masala dosa' }),
      item(michaels.id, mcDosa.id, "Michael's Special Dosa",    100, true, 12, { description: 'Chef\'s signature loaded dosa', isPopular: true }),
      // SUBS (GRILLED)
      item(michaels.id, mcSubs.id, 'Potato Sub',          70,  true,  8,  { description: 'Grilled sub with spiced potato filling' }),
      item(michaels.id, mcSubs.id, 'Paneer Sub',          80,  true,  8,  { description: 'Grilled sub with paneer filling' }),
      item(michaels.id, mcSubs.id, 'Chicken Sub',         80,  false, 8,  { description: 'Grilled sub with chicken filling' }),
      item(michaels.id, mcSubs.id, 'Chicken BBQ Sub',     90,  false, 8,  { description: 'Grilled sub with BBQ chicken' }),
      item(michaels.id, mcSubs.id, 'Egg & Sausage Sub',   110, false, 9,  { description: 'Grilled sub with egg and sausage', containsEgg: true }),
      // SANDWICHES
      item(michaels.id, mcSandwich.id, 'Veg Sandwich (Non-Grilled)',  40,  true,  5,  { description: 'Fresh non-grilled veg sandwich' }),
      item(michaels.id, mcSandwich.id, 'Veg Sandwich (Grilled)',      50,  true,  7,  { description: 'Toasted grilled veg sandwich' }),
      item(michaels.id, mcSandwich.id, 'Potato Herb Chilli Sandwich', 70,  true,  8,  { description: 'Grilled sandwich with herb chilli potato' }),
      item(michaels.id, mcSandwich.id, 'Paneer Sandwich',             80,  true,  8,  { description: 'Grilled paneer sandwich' }),
      item(michaels.id, mcSandwich.id, 'Chicken Sandwich',            80,  false, 8,  { description: 'Grilled chicken sandwich' }),
      item(michaels.id, mcSandwich.id, 'Chicken BBQ Sandwich',        90,  false, 8,  { description: 'Grilled BBQ chicken sandwich' }),
      item(michaels.id, mcSandwich.id, 'Pork Sandwich',               120, false, 9,  { description: 'Grilled pork sandwich' }),
      item(michaels.id, mcSandwich.id, 'Egg & Sausage Sandwich',      110, false, 8,  { description: 'Grilled egg and sausage sandwich', containsEgg: true }),
      item(michaels.id, mcSandwich.id, 'Egg Sandwich',                65,  false, 7,  { description: 'Grilled egg sandwich', containsEgg: true }),
      item(michaels.id, mcSandwich.id, 'Bread Omelette',              65,  false, 7,  { description: 'Fluffy omelette in toasted bread', containsEgg: true }),
      // BURGERS
      item(michaels.id, mcBurger.id, 'Veg Burger',            50,  true,  8,  { description: 'Classic veg burger' }),
      item(michaels.id, mcBurger.id, 'Chicken Burger',         60,  false, 8,  { description: 'Juicy chicken burger' }),
      item(michaels.id, mcBurger.id, 'Chicken BBQ Burger',     70,  false, 9,  { description: 'Smoky BBQ chicken burger' }),
      item(michaels.id, mcBurger.id, 'Pork Burger',            120, false, 10, { description: 'Pork burger' }),
      item(michaels.id, mcBurger.id, 'Egg & Sausage Burger',   110, false, 9,  { description: 'Egg and sausage burger', containsEgg: true }),
      // BAKERY ITEMS
      item(michaels.id, mcBakery.id, 'Blueberry Muffin',   50, true, 2, { description: 'Moist muffin bursting with blueberries' }),
      item(michaels.id, mcBakery.id, 'Chocolate Muffin',   50, true, 2, { description: 'Rich chocolate muffin' }),
      item(michaels.id, mcBakery.id, 'Cinnamon Roll',      45, true, 2, { description: 'Soft baked cinnamon roll' }),
      item(michaels.id, mcBakery.id, 'Marble Cake',        60, true, 2, { description: 'Classic marble cake slice' }),
      item(michaels.id, mcBakery.id, 'Chocolate Brownie',  70, true, 2, { description: 'Fudgy chocolate brownie', isPopular: true }),
      item(michaels.id, mcBakery.id, 'Almond Honey Tart',  80, true, 2, { description: 'Buttery tart with almond and honey' }),
      item(michaels.id, mcBakery.id, 'Choco Lava',         50, true, 5, { description: 'Warm chocolate lava cake' }),
      // BIRYANI & RICE MEALS
      item(michaels.id, mcBiryani.id, 'Veg Biryani',               60,  true,  12, { description: 'Fragrant vegetable biryani' }),
      item(michaels.id, mcBiryani.id, 'Egg Biryani',               70,  false, 12, { description: 'Fragrant biryani with boiled egg', containsEgg: true }),
      item(michaels.id, mcBiryani.id, 'Chicken Biryani',           100, false, 12, { description: 'Aromatic chicken biryani', isPopular: true }),
      item(michaels.id, mcBiryani.id, 'Lemon Rice',                60,  true,  5,  { description: 'Tangy lemon rice with peanuts' }),
      item(michaels.id, mcBiryani.id, 'Chole Masala with Paratha', 70,  true,  10, { description: 'Spiced chole with flaky paratha' }),
      item(michaels.id, mcBiryani.id, 'Chole Masala with Poori',   70,  true,  10, { description: 'Spiced chole with deep-fried poori' }),
      item(michaels.id, mcBiryani.id, 'Chole Masala with Chapati', 70,  true,  9,  { description: 'Spiced chole with soft chapati' }),
      item(michaels.id, mcBiryani.id, 'Chole Masala with Rice',    70,  true,  8,  { description: 'Spiced chole with steamed rice' }),
      item(michaels.id, mcBiryani.id, 'Egg Gravy with Rice / Parota / Chapathi', 70, false, 10, { description: 'Spiced egg gravy served with rice, parota or chapathi', containsEgg: true }),
      // STEAM RICE
      item(michaels.id, mcStemRice.id, 'Chicken Steam Rice',              120, false, 12, { description: 'Steamed rice with chicken curry' }),
      item(michaels.id, mcStemRice.id, 'Chicken Chilli Steam Rice',       170, false, 13, { description: 'Steamed rice with spicy chicken chilli' }),
      item(michaels.id, mcStemRice.id, 'Pork Steam Rice',                 180, false, 13, { description: 'Steamed rice with pork curry' }),
      // FRIED RICE & NOODLES
      item(michaels.id, mcFriedRice.id, 'Veg Fried Rice / Noodles',           70,  true,  10),
      item(michaels.id, mcFriedRice.id, 'Egg Fried Rice / Noodles',           80,  false, 10, { containsEgg: true }),
      item(michaels.id, mcFriedRice.id, 'Chicken Fried Rice / Noodles',       100, false, 10),
      item(michaels.id, mcFriedRice.id, 'Chicken Chilli Fried Rice / Noodles',170, false, 12, { description: 'Spicy chicken chilli fried rice or noodles' }),
      item(michaels.id, mcFriedRice.id, 'Pork Fried Rice / Noodles',          180, false, 12),
      // HOT BEVERAGES (Small / Large)
      item(michaels.id, mcHotBev.id, 'Filter Coffee (Small)', 15, true, 3),
      item(michaels.id, mcHotBev.id, 'Filter Coffee (Large)', 30, true, 3),
      item(michaels.id, mcHotBev.id, 'Nescafe (Small)',        12, true, 3),
      item(michaels.id, mcHotBev.id, 'Nescafe (Large)',        24, true, 3),
      item(michaels.id, mcHotBev.id, 'Tea (Small)',            12, true, 3),
      item(michaels.id, mcHotBev.id, 'Tea (Large)',            24, true, 3),
      item(michaels.id, mcHotBev.id, 'Lemon Tea (Small)',      12, true, 3),
      item(michaels.id, mcHotBev.id, 'Lemon Tea (Large)',      24, true, 3),
      item(michaels.id, mcHotBev.id, 'Cardamom Tea',           12, true, 3, { description: 'Aromatic elaichi chai' }),
      item(michaels.id, mcHotBev.id, 'Hot Chocolate (Small)',  20, true, 4),
      item(michaels.id, mcHotBev.id, 'Hot Chocolate (Large)',  40, true, 4),
      item(michaels.id, mcHotBev.id, 'Black Coffee (Small)',   10, true, 3),
      item(michaels.id, mcHotBev.id, 'Black Coffee (Large)',   20, true, 3),
      // COLD BEVERAGES
      item(michaels.id, mcColdBev.id, 'Cold Coffee',    40, true, 4),
      item(michaels.id, mcColdBev.id, 'Ice Lemon Tea',  30, true, 3),
      item(michaels.id, mcColdBev.id, 'Orange Juice',   30, true, 4),
    ],
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ⑤ PUNJABI BITES
  // ════════════════════════════════════════════════════════════════════════════
  const [pbSnacks, pbPasta, pbChinese, pbTandoor, pbSouthIndian, pbMeals, pbCombos, pbBeverages, pbAddOns] =
    await Promise.all([
      prisma.menuCategory.create({ data: { canteenId: punjabi.id, name: 'Snacks',            sortOrder: 1 } }),
      prisma.menuCategory.create({ data: { canteenId: punjabi.id, name: 'Continental / Pasta', sortOrder: 2 } }),
      prisma.menuCategory.create({ data: { canteenId: punjabi.id, name: 'Chinese',           sortOrder: 3 } }),
      prisma.menuCategory.create({ data: { canteenId: punjabi.id, name: 'Tandoor & Breads',  sortOrder: 4 } }),
      prisma.menuCategory.create({ data: { canteenId: punjabi.id, name: 'South Indian',      sortOrder: 5, availableFrom: '08:00', availableTo: '11:00' } }),
      prisma.menuCategory.create({ data: { canteenId: punjabi.id, name: 'Meals & Thali',     sortOrder: 6 } }),
      prisma.menuCategory.create({ data: { canteenId: punjabi.id, name: 'Combos',            sortOrder: 7 } }),
      prisma.menuCategory.create({ data: { canteenId: punjabi.id, name: 'Beverages',         sortOrder: 8 } }),
      prisma.menuCategory.create({ data: { canteenId: punjabi.id, name: 'Add-Ons',           sortOrder: 9 } }),
    ]);

  await prisma.menuItem.createMany({
    data: [
      // SNACKS
      item(punjabi.id, pbSnacks.id, 'Bread Pakoda',                   25,  true,  5,  { description: 'Spiced bread fritters' }),
      item(punjabi.id, pbSnacks.id, 'Maggi (Plain)',                   40,  true,  7,  { description: 'Classic plain Maggi noodles' }),
      item(punjabi.id, pbSnacks.id, 'Maggi (Veg)',                     60,  true,  8,  { description: 'Maggi tossed with vegetables' }),
      item(punjabi.id, pbSnacks.id, 'Maggi (Egg)',                     60,  false, 8,  { description: 'Maggi with egg bhurji', containsEgg: true }),
      item(punjabi.id, pbSnacks.id, 'Maggi (Cheese)',                  60,  true,  8,  { description: 'Maggi with melted cheese' }),
      item(punjabi.id, pbSnacks.id, 'Maggi (Chicken)',                 70,  false, 8,  { description: 'Maggi with chicken' }),
      item(punjabi.id, pbSnacks.id, 'French Fries (Plain)',            60,  true,  7,  { description: 'Crispy golden french fries' }),
      item(punjabi.id, pbSnacks.id, 'French Fries (Cajun)',            70,  true,  7,  { description: 'French fries with cajun seasoning' }),
      item(punjabi.id, pbSnacks.id, 'French Fries (Peri Peri)',        70,  true,  7,  { description: 'French fries with spicy peri peri', isPopular: true }),
      item(punjabi.id, pbSnacks.id, 'Potato Wedges (Plain)',           60,  true,  8),
      item(punjabi.id, pbSnacks.id, 'Potato Wedges (Kaju)',            70,  true,  8),
      item(punjabi.id, pbSnacks.id, 'Potato Wedges (Peri Peri)',       70,  true,  8),
      item(punjabi.id, pbSnacks.id, 'Samosa',                          25,  true,  3,  { description: 'Crispy fried samosa' }),
      item(punjabi.id, pbSnacks.id, 'Samosa Chaat',                    50,  true,  5,  { description: 'Samosa topped with chutneys and chaat masala' }),
      item(punjabi.id, pbSnacks.id, 'Grilled Sandwich (Coleslaw)',     50,  true,  8),
      item(punjabi.id, pbSnacks.id, 'Grilled Sandwich (Veg)',          70,  true,  8),
      item(punjabi.id, pbSnacks.id, 'Grilled Sandwich (Cheese Corn)',  80,  true,  8),
      item(punjabi.id, pbSnacks.id, 'Grilled Sandwich (Cheese)',       80,  true,  8),
      item(punjabi.id, pbSnacks.id, 'Grilled Sandwich (Paneer)',       100, true,  9),
      item(punjabi.id, pbSnacks.id, 'Grilled Sandwich (Chicken)',      120, false, 9),
      item(punjabi.id, pbSnacks.id, 'Chole Bhature',                   80,  true,  10, { description: 'Fluffy bhature with spiced chole', isPopular: true }),
      item(punjabi.id, pbSnacks.id, 'Chicken Nuggets',                 100, false, 8,  { description: 'Crispy golden chicken nuggets' }),
      // PASTA
      item(punjabi.id, pbPasta.id, 'White Sauce Pasta — Veg',         80,  true,  12),
      item(punjabi.id, pbPasta.id, 'White Sauce Pasta — Chicken',      90,  false, 12),
      item(punjabi.id, pbPasta.id, 'Red Sauce Pasta — Veg',           80,  true,  12),
      item(punjabi.id, pbPasta.id, 'Red Sauce Pasta — Chicken',        90,  false, 12),
      item(punjabi.id, pbPasta.id, 'Red Spicy Pasta — Veg',           80,  true,  12),
      item(punjabi.id, pbPasta.id, 'Red Spicy Pasta — Chicken',        100, false, 12),
      item(punjabi.id, pbPasta.id, 'Pink Sauce Pasta — Veg',          80,  true,  12),
      item(punjabi.id, pbPasta.id, 'Pink Sauce Pasta — Chicken',       100, false, 12),
      item(punjabi.id, pbPasta.id, 'Pesto Pasta — Veg',               80,  true,  12),
      item(punjabi.id, pbPasta.id, 'Pesto Pasta — Chicken',            100, false, 12),
      // CHINESE
      item(punjabi.id, pbChinese.id, 'Spring Roll — Veg',               50,  true,  8),
      item(punjabi.id, pbChinese.id, 'Spring Roll — Chicken',            70,  false, 8),
      item(punjabi.id, pbChinese.id, 'Chilli Potato',                    90,  true,  8,  { isPopular: true }),
      item(punjabi.id, pbChinese.id, 'Chilli Gobi',                      90,  true,  8),
      item(punjabi.id, pbChinese.id, 'Chilli Paneer',                    150, true,  10),
      item(punjabi.id, pbChinese.id, 'Chilli Chicken',                   150, false, 10),
      item(punjabi.id, pbChinese.id, 'Honey Chilli Potato',              120, true,  8),
      item(punjabi.id, pbChinese.id, 'Chicken Kabab',                    120, false, 10),
      item(punjabi.id, pbChinese.id, 'Manchurian — Veg',                 90,  true,  10),
      item(punjabi.id, pbChinese.id, 'Manchurian — Gobi',                90,  true,  10),
      item(punjabi.id, pbChinese.id, 'Manchurian — Mushroom',            120, true,  10),
      item(punjabi.id, pbChinese.id, 'Manchurian — Baby Corn',           120, true,  10),
      item(punjabi.id, pbChinese.id, 'Manchurian — Paneer',              150, true,  10),
      item(punjabi.id, pbChinese.id, 'Manchurian — Chicken',             150, false, 10),
      item(punjabi.id, pbChinese.id, 'Fried Rice — Veg',                 80,  true,  10),
      item(punjabi.id, pbChinese.id, 'Fried Rice — Egg',                 120, false, 10, { containsEgg: true }),
      item(punjabi.id, pbChinese.id, 'Fried Rice — Paneer',              140, true,  10),
      item(punjabi.id, pbChinese.id, 'Fried Rice — Chicken',             140, false, 10),
      item(punjabi.id, pbChinese.id, 'Noodles — Veg',                    80,  true,  10),
      item(punjabi.id, pbChinese.id, 'Noodles — Egg',                    120, false, 10, { containsEgg: true }),
      item(punjabi.id, pbChinese.id, 'Noodles — Paneer',                 140, true,  10),
      item(punjabi.id, pbChinese.id, 'Noodles — Chicken',                140, false, 10),
      // TANDOOR & BREADS
      item(punjabi.id, pbTandoor.id, 'Tandoori Naan (Plain)',            30,  true, 8),
      item(punjabi.id, pbTandoor.id, 'Tandoori Naan (Butter)',           40,  true, 8),
      item(punjabi.id, pbTandoor.id, 'Tandoori Naan (Garlic)',           50,  true, 8),
      item(punjabi.id, pbTandoor.id, 'Tandoori Naan (Amritsari)',        60,  true, 8),
      item(punjabi.id, pbTandoor.id, 'Tandoori Roti (Plain)',            20,  true, 6),
      item(punjabi.id, pbTandoor.id, 'Tandoori Roti (Butter)',           30,  true, 6),
      item(punjabi.id, pbTandoor.id, 'Ajwain Paratha',                   30,  true, 8),
      item(punjabi.id, pbTandoor.id, 'Lachha Paratha',                   50,  true, 8),
      item(punjabi.id, pbTandoor.id, 'Tawa Roti (Plain)',                10,  true, 5),
      item(punjabi.id, pbTandoor.id, 'Tawa Roti (Ghee)',                 15,  true, 5),
      item(punjabi.id, pbTandoor.id, 'Malai Tikka Chaap',                140, true,  12),
      item(punjabi.id, pbTandoor.id, 'Malai Tikka Paneer',               150, true,  12),
      item(punjabi.id, pbTandoor.id, 'Malai Tikka Chicken',              150, false, 12),
      item(punjabi.id, pbTandoor.id, 'Tandoori Tikka Chaap',             120, true,  12),
      item(punjabi.id, pbTandoor.id, 'Tandoori Tikka Paneer',            140, true,  12),
      item(punjabi.id, pbTandoor.id, 'Tandoori Tikka Chicken',           140, false, 12),
      // SOUTH INDIAN (ALL DAY MEAL section from menu)
      item(punjabi.id, pbSouthIndian.id, 'Veg Paratha — Plain',          20,  true,  8),
      item(punjabi.id, pbSouthIndian.id, 'Veg Paratha — Aloo',           30,  true,  9),
      item(punjabi.id, pbSouthIndian.id, 'Veg Paratha — Onion',          40,  true,  9),
      item(punjabi.id, pbSouthIndian.id, 'Veg Paratha — Gobi',           40,  true,  9),
      item(punjabi.id, pbSouthIndian.id, 'Veg Paratha — Cheese',         60,  true,  9),
      item(punjabi.id, pbSouthIndian.id, 'Veg Paratha — Paneer',         60,  true,  9),
      item(punjabi.id, pbSouthIndian.id, 'Non-Veg Paratha — Egg',        50,  false, 9,  { containsEgg: true }),
      item(punjabi.id, pbSouthIndian.id, 'Non-Veg Paratha — Chicken',    70,  false, 10),
      item(punjabi.id, pbSouthIndian.id, 'Puri Bhaji',                   60,  true,  8),
      item(punjabi.id, pbSouthIndian.id, 'Puri Chole',                   70,  true,  8),
      item(punjabi.id, pbSouthIndian.id, 'Plain Dosa',                   50,  true,  9),
      item(punjabi.id, pbSouthIndian.id, 'Podi Dosa',                    60,  true,  9),
      item(punjabi.id, pbSouthIndian.id, 'Butter Dosa',                  70,  true,  9),
      item(punjabi.id, pbSouthIndian.id, 'Set Dosa',                     80,  true,  9),
      item(punjabi.id, pbSouthIndian.id, 'Onion Dosa',                   80,  true,  9),
      item(punjabi.id, pbSouthIndian.id, 'Plain Masala Dosa',            60,  true,  10),
      item(punjabi.id, pbSouthIndian.id, 'Podi Masala Dosa',             80,  true,  10),
      item(punjabi.id, pbSouthIndian.id, 'Cheese Masala Dosa',           80,  true,  10),
      item(punjabi.id, pbSouthIndian.id, 'Paneer Masala Dosa',           80,  true,  10),
      item(punjabi.id, pbSouthIndian.id, 'Ghee Roast Dosa',              80,  true,  10, { isPopular: true }),
      item(punjabi.id, pbSouthIndian.id, 'Idli Sambar (Half)',           30,  true,  5),
      item(punjabi.id, pbSouthIndian.id, 'Idli Sambar (Full)',           50,  true,  5),
      item(punjabi.id, pbSouthIndian.id, 'Idli Vada',                    50,  true,  7),
      item(punjabi.id, pbSouthIndian.id, 'Vada Sambar (2 pcs)',          50,  true,  6),
      item(punjabi.id, pbSouthIndian.id, 'Single Vada with Sambar',      30,  true,  5),
      item(punjabi.id, pbSouthIndian.id, 'Uttapam — Mix Veg',            80,  true,  10),
      item(punjabi.id, pbSouthIndian.id, 'Uttapam — Onion',              80,  true,  10),
      item(punjabi.id, pbSouthIndian.id, 'Uttapam — Tomato',             100, true,  10),
      item(punjabi.id, pbSouthIndian.id, 'Bread Butter Jam',             40,  true,  3),
      item(punjabi.id, pbSouthIndian.id, 'Bread Omelette',               50,  false, 7,  { containsEgg: true }),
      item(punjabi.id, pbSouthIndian.id, 'Masala Omelette',              40,  false, 6,  { containsEgg: true }),
      item(punjabi.id, pbSouthIndian.id, 'Boiled Eggs (2 pcs)',          30,  false, 5,  { containsEgg: true }),
      // MEALS & THALI
      item(punjabi.id, pbMeals.id, 'Veg Thali',                         100, true,  10, { description: 'Rice, roti, dal, sabzi, salad & papad' }),
      item(punjabi.id, pbMeals.id, 'Veg Thali (Mini)',                   70,  true,  8),
      item(punjabi.id, pbMeals.id, 'Paneer Thali',                       120, true,  12),
      item(punjabi.id, pbMeals.id, 'Paneer Thali (Mini)',                80,  true,  10),
      item(punjabi.id, pbMeals.id, 'Egg Thali',                          120, false, 12, { containsEgg: true }),
      item(punjabi.id, pbMeals.id, 'Egg Thali (Mini)',                   80,  false, 10, { containsEgg: true }),
      item(punjabi.id, pbMeals.id, 'Chicken Thali',                      140, false, 12, { isPopular: true }),
      item(punjabi.id, pbMeals.id, 'Chicken Thali (Mini)',               90,  false, 10),
      item(punjabi.id, pbMeals.id, 'Basic Veg Thali (Dal/Sambar)',       70,  true,  8),
      item(punjabi.id, pbMeals.id, 'Rice with Chole / Rajma',           80,  true,  8),
      item(punjabi.id, pbMeals.id, 'Chicken Dum Biryani (Half)',         80,  false, 12),
      item(punjabi.id, pbMeals.id, 'Chicken Dum Biryani (Full)',         120, false, 15, { isPopular: true }),
      // COMBOS
      item(punjabi.id, pbCombos.id, 'Chicken Curry Combo',                160, false, 12, { description: 'Chicken curry with choice of roti/naan' }),
      item(punjabi.id, pbCombos.id, 'Paneer Curry Combo',                 150, true,  12, { description: 'Paneer curry with choice of roti/naan' }),
      item(punjabi.id, pbCombos.id, 'Egg Curry Combo',                    120, false, 10, { description: 'Egg curry with choice of roti/naan', containsEgg: true }),
      item(punjabi.id, pbCombos.id, 'Fried Rice Veg Combo',               120, true,  12, { description: 'Veg fried rice + veg Manchurian' }),
      item(punjabi.id, pbCombos.id, 'Fried Rice Paneer Combo',            150, true,  12),
      item(punjabi.id, pbCombos.id, 'Fried Rice Chicken Combo',           160, false, 12),
      item(punjabi.id, pbCombos.id, 'Noodles Veg Combo',                  120, true,  12),
      item(punjabi.id, pbCombos.id, 'Noodles Paneer Combo',               150, true,  12),
      item(punjabi.id, pbCombos.id, 'Noodles Chicken Combo',              160, false, 12),
      item(punjabi.id, pbCombos.id, 'Amritsari Naan Combo (Chole)',        80,  true,  10),
      item(punjabi.id, pbCombos.id, 'Amritsari Naan Combo (Paneer Butter Masala)', 150, true, 12),
      item(punjabi.id, pbCombos.id, 'Amritsari Naan Combo (Butter Chicken)',       160, false,12),
      // BEVERAGES
      item(punjabi.id, pbBeverages.id, 'Black Coffee (Full)',  20,  true, 3),
      item(punjabi.id, pbBeverages.id, 'Lemon Tea (Full)',     30,  true, 3),
      item(punjabi.id, pbBeverages.id, 'Black Tea (Full)',     20,  true, 3),
      item(punjabi.id, pbBeverages.id, 'Butter Milk',          40,  true, 3),
      item(punjabi.id, pbBeverages.id, 'Filter Coffee (Half)', 30,  true, 3),
      item(punjabi.id, pbBeverages.id, 'Filter Coffee (Full)', 40,  true, 3),
      item(punjabi.id, pbBeverages.id, 'Coffee (Half)',        10,  true, 3),
      item(punjabi.id, pbBeverages.id, 'Coffee (Full)',        20,  true, 3),
      item(punjabi.id, pbBeverages.id, 'Cold Coffee',          60,  true, 4, { isPopular: true }),
      item(punjabi.id, pbBeverages.id, 'Hot Milk',             30,  true, 3),
      item(punjabi.id, pbBeverages.id, 'Tea (Half)',           10,  true, 3),
      item(punjabi.id, pbBeverages.id, 'Tea (Full)',           20,  true, 3),
      item(punjabi.id, pbBeverages.id, 'Lime Juice',           30,  true, 3),
      item(punjabi.id, pbBeverages.id, 'Lime Soda',            40,  true, 3),
      // ADD-ONS
      item(punjabi.id, pbAddOns.id, 'Chapati (1 pc)',          10, true, 3),
      item(punjabi.id, pbAddOns.id, 'Puri (1 pc)',             10, true, 3),
      item(punjabi.id, pbAddOns.id, 'Single Vada (1 pc)',      25, true, 4),
      item(punjabi.id, pbAddOns.id, 'Single Idli (1 pc)',      15, true, 3),
      item(punjabi.id, pbAddOns.id, 'Curd (with Paratha)',     10, true, 1),
      item(punjabi.id, pbAddOns.id, 'Curd (1 Bowl)',           20, true, 1),
      item(punjabi.id, pbAddOns.id, 'Chicken Piece (Extra)',   50, false, 5),
    ],
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ⑥ MARIYAN CAFE (R&D Block)
  // ════════════════════════════════════════════════════════════════════════════
  const [marBiryani, marBreads, marStarters, marFriedRice, marChinese, marJuices] = await Promise.all([
    prisma.menuCategory.create({ data: { canteenId: mariyan.id, name: 'Biryani & Rice Meals', sortOrder: 1 } }),
    prisma.menuCategory.create({ data: { canteenId: mariyan.id, name: 'Indian Breads',        sortOrder: 2 } }),
    prisma.menuCategory.create({ data: { canteenId: mariyan.id, name: 'Starters',             sortOrder: 3 } }),
    prisma.menuCategory.create({ data: { canteenId: mariyan.id, name: 'Fried Rice & Noodles', sortOrder: 4 } }),
    prisma.menuCategory.create({ data: { canteenId: mariyan.id, name: 'Chinese',              sortOrder: 5 } }),
    prisma.menuCategory.create({ data: { canteenId: mariyan.id, name: 'Juices',               sortOrder: 6 } }),
  ]);

  await prisma.menuItem.createMany({
    data: [
      // BIRYANI & RICE MEALS
      item(mariyan.id, marBiryani.id, 'Prawns Biryani',                150, false, 15, { description: 'Fragrant biryani with fresh prawns', isPopular: true }),
      item(mariyan.id, marBiryani.id, 'Chicken Biryani (Full)',         140, false, 14, { isPopular: true }),
      item(mariyan.id, marBiryani.id, 'Chicken Biryani (Half)',         100, false, 12),
      item(mariyan.id, marBiryani.id, 'Egg Biryani',                   100, false, 12, { containsEgg: true }),
      item(mariyan.id, marBiryani.id, 'Veg Meals',                     90,  true,  5,  { description: 'Rice, dal, sambar, rasam & sides' }),
      item(mariyan.id, marBiryani.id, 'Curd Rice',                     60,  true,  3,  { description: 'Cooling curd rice with pickle' }),
      item(mariyan.id, marBiryani.id, 'Chicken Meals',                 140, false, 5,  { description: 'Rice with chicken curry, dal, sambar & sides' }),
      item(mariyan.id, marBiryani.id, 'Fish Meals',                    130, false, 5,  { description: 'Rice with fish curry, dal, sambar & sides' }),
      item(mariyan.id, marBiryani.id, 'Podi Choru',                    130, false, 8,  { description: 'Spiced rice with podi and non-veg sides' }),
      item(mariyan.id, marBiryani.id, 'Chatti Choru',                  130, false, 8,  { description: 'Clay pot cooked spiced rice' }),
      item(mariyan.id, marBiryani.id, 'Ghee Rice with Chicken Curry',  120, false, 8),
      item(mariyan.id, marBiryani.id, 'Kappa with Fish Curry',         110, false, 8,  { description: 'Kerala tapioca with spiced fish curry' }),
      item(mariyan.id, marBiryani.id, 'Kappa with Chicken Curry',      100, false, 8,  { description: 'Kerala tapioca with spiced chicken curry' }),
      // INDIAN BREADS
      item(mariyan.id, marBreads.id, 'Chappati with Egg Burji',       80,  false, 8,  { containsEgg: true }),
      item(mariyan.id, marBreads.id, 'Chappati with Chicken Curry',   100, false, 8),
      item(mariyan.id, marBreads.id, 'Chappati with Veg Curry',       80,  true,  8),
      item(mariyan.id, marBreads.id, 'Chappati Egg Roast',            100, false, 9,  { containsEgg: true }),
      item(mariyan.id, marBreads.id, 'Chappati Chicken Roast',        110, false, 9),
      item(mariyan.id, marBreads.id, 'Parota with Egg Burji',         80,  false, 8,  { containsEgg: true }),
      item(mariyan.id, marBreads.id, 'Parota with Chicken Curry',     100, false, 8,  { isPopular: true }),
      item(mariyan.id, marBreads.id, 'Parota with Veg Curry',         80,  true,  8),
      item(mariyan.id, marBreads.id, 'Parota Egg Roast',              100, false, 9,  { containsEgg: true }),
      item(mariyan.id, marBreads.id, 'Parota Chicken Roast',          110, false, 9),
      // STARTERS
      item(mariyan.id, marStarters.id, 'Chicken Kebab', 100, false, 10, { description: 'Tender grilled chicken kebab' }),
      item(mariyan.id, marStarters.id, 'Fish Fry',      80,  false, 10, { description: 'Crispy spiced fish fry' }),
      // FRIED RICE & NOODLES
      item(mariyan.id, marFriedRice.id, 'Veg Fried Rice',       70,  true,  10),
      item(mariyan.id, marFriedRice.id, 'Egg Fried Rice',       90,  false, 10, { containsEgg: true }),
      item(mariyan.id, marFriedRice.id, 'Chicken Fried Rice',   110, false, 10),
      item(mariyan.id, marFriedRice.id, 'Mushroom Fried Rice',  110, true,  10),
      item(mariyan.id, marFriedRice.id, 'Paneer Fried Rice',    110, true,  10),
      item(mariyan.id, marFriedRice.id, 'Veg Noodles',          70,  true,  10),
      item(mariyan.id, marFriedRice.id, 'Egg Noodles',          90,  false, 10, { containsEgg: true }),
      item(mariyan.id, marFriedRice.id, 'Chicken Noodles',      110, false, 10),
      item(mariyan.id, marFriedRice.id, 'Mushroom Noodles',     110, true,  10),
      item(mariyan.id, marFriedRice.id, 'Paneer Noodles',       110, true,  10),
      // CHINESE
      item(mariyan.id, marChinese.id, 'Mushroom Pepper Dry', 110, true,  10),
      item(mariyan.id, marChinese.id, 'Gobi Pepper Dry',     100, true,  10),
      item(mariyan.id, marChinese.id, 'Gobi Manchurian',     90,  true,  10),
      item(mariyan.id, marChinese.id, 'Egg Manchurian',      100, false, 10, { containsEgg: true }),
      item(mariyan.id, marChinese.id, 'Baby Corn Manchurian',100, true,  10),
      // JUICES
      item(mariyan.id, marJuices.id, 'Lime Juice',       30, true, 3),
      item(mariyan.id, marJuices.id, 'Watermelon Juice', 40, true, 3),
      item(mariyan.id, marJuices.id, 'Pineapple Juice',  50, true, 3),
      item(mariyan.id, marJuices.id, 'Kannur Cocktail',  70, true, 5, { description: 'Special Kerala fruit cocktail mocktail' }),
    ],
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ⑦ BHAVANI FOODS
  // ════════════════════════════════════════════════════════════════════════════
  const [bhHotBev, bhColdBev, bhBreakfast, bhChaat, bhSandwich, bhMeals, bhSweets] = await Promise.all([
    prisma.menuCategory.create({ data: { canteenId: bhavani.id, name: 'Hot Beverages',       sortOrder: 1 } }),
    prisma.menuCategory.create({ data: { canteenId: bhavani.id, name: 'Cold Beverages',      sortOrder: 2 } }),
    prisma.menuCategory.create({ data: { canteenId: bhavani.id, name: 'Breakfast',           sortOrder: 3, availableFrom: '08:00', availableTo: '11:00' } }),
    prisma.menuCategory.create({ data: { canteenId: bhavani.id, name: 'Snacks & Chaat',      sortOrder: 4 } }),
    prisma.menuCategory.create({ data: { canteenId: bhavani.id, name: 'Sandwiches & Burger', sortOrder: 5 } }),
    prisma.menuCategory.create({ data: { canteenId: bhavani.id, name: 'Meals & Rice',        sortOrder: 6 } }),
    prisma.menuCategory.create({ data: { canteenId: bhavani.id, name: 'Sweets',              sortOrder: 7 } }),
  ]);

  await prisma.menuItem.createMany({
    data: [
      // HOT BEVERAGES
      item(bhavani.id, bhHotBev.id, 'Tea',            10, true, 3),
      item(bhavani.id, bhHotBev.id, 'Coffee',         10, true, 3),
      item(bhavani.id, bhHotBev.id, 'Green Tea',      10, true, 3),
      item(bhavani.id, bhHotBev.id, 'Lemon Tea',      10, true, 3),
      item(bhavani.id, bhHotBev.id, 'Hot Chocolate',  15, true, 4),
      // COLD BEVERAGES
      item(bhavani.id, bhColdBev.id, 'Ice Lemon Tea (250ml)',   30, true, 3),
      item(bhavani.id, bhColdBev.id, 'Cold Coffee (250ml)',     35, true, 4),
      item(bhavani.id, bhColdBev.id, 'Mint Lime Cooler (250ml)',30, true, 3, { description: 'Refreshing mint and lime cooler' }),
      // BREAKFAST
      item(bhavani.id, bhBreakfast.id, 'Poha',           30, true, 5,  { description: 'Flattened rice with onion, peanuts and spices' }),
      item(bhavani.id, bhBreakfast.id, 'Upma',           20, true, 5,  { description: 'Savory semolina upma' }),
      item(bhavani.id, bhBreakfast.id, 'Idly (2 pcs)',   30, true, 5,  { description: 'Soft steamed idlis with sambar' }),
      item(bhavani.id, bhBreakfast.id, 'Paddu (5 pcs)',  30, true, 8,  { description: 'Soft crispy rice and lentil paddu' }),
      item(bhavani.id, bhBreakfast.id, 'Alu Paratha',    40, true, 10, { description: 'Stuffed potato paratha' }),
      item(bhavani.id, bhBreakfast.id, 'Paneer Paratha', 50, true, 10, { description: 'Stuffed paneer paratha' }),
      // SNACKS & CHAAT
      item(bhavani.id, bhChaat.id, 'Samosa',          15, true, 3, { description: 'Crispy samosa' }),
      item(bhavani.id, bhChaat.id, 'Kachori',         15, true, 3, { description: 'Flaky kachori with filling' }),
      item(bhavani.id, bhChaat.id, 'Samosa Chaat',    30, true, 5, { description: 'Samosa topped with chutneys' }),
      item(bhavani.id, bhChaat.id, 'Kachori Chaat',   30, true, 5, { description: 'Kachori topped with chutneys' }),
      item(bhavani.id, bhChaat.id, 'Dhokla (2 pcs)',  40, true, 3, { description: 'Soft steamed Gujarat-style dhokla', isJain: true }),
      item(bhavani.id, bhChaat.id, 'Dahi Papdi Chaat',40, true, 5, { description: 'Crispy papdi with yogurt and chutneys' }),
      // SANDWICHES & BURGER
      item(bhavani.id, bhSandwich.id, 'Peppy Paneer Sandwich',   60, true, 8, { description: 'Grilled paneer sandwich with peppy sauce' }),
      item(bhavani.id, bhSandwich.id, 'Cheese Corn Sandwich',    50, true, 8, { description: 'Grilled cheese and corn sandwich' }),
      item(bhavani.id, bhSandwich.id, 'Cheese Pizza Sandwich',   60, true, 8, { description: 'Grilled pizza-style cheese sandwich' }),
      item(bhavani.id, bhSandwich.id, 'Veg Club Sandwich',       50, true, 8, { description: 'Classic multi-layered veg club sandwich' }),
      item(bhavani.id, bhSandwich.id, 'Veg Cheese Burger',       60, true, 8, { description: 'Crispy veg patty burger with cheese' }),
      item(bhavani.id, bhSandwich.id, 'Tandoori Paneer Sandwich',80, true, 9, { description: 'Grilled sandwich with tandoori paneer', isPopular: true }),
      // MEALS & RICE
      item(bhavani.id, bhMeals.id, 'Roti with Veg Sabzi',    60, true, 8),
      item(bhavani.id, bhMeals.id, 'Mini Meals',              80, true, 5, { description: 'Rice, dal, sabzi, roti & salad' }),
      item(bhavani.id, bhMeals.id, 'Paneer Sabzi with Paratha',80, true,10),
      item(bhavani.id, bhMeals.id, 'Veg Pulao with Raita',   60, true, 8),
      item(bhavani.id, bhMeals.id, 'Veg Biryani with Raita', 80, true, 10, { isPopular: true }),
      item(bhavani.id, bhMeals.id, 'Rajma Rice',              60, true, 8),
      item(bhavani.id, bhMeals.id, 'Dal Rice',                60, true, 8),
      item(bhavani.id, bhMeals.id, 'Chole Bhature',           80, true, 10),
      // SWEETS
      item(bhavani.id, bhSweets.id, 'Gulab Jamun (1 pc)', 15, true, 1, { description: 'Soft gulab jamun in sugar syrup' }),
    ],
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ⑧ HARI SUPER SANDWICH (R&D Block)
  // ════════════════════════════════════════════════════════════════════════════
  const [haSandwich, haBurger, haVadaPav, haPavBhaji, haTwister, haChaat, haShakes] = await Promise.all([
    prisma.menuCategory.create({ data: { canteenId: hari.id, name: 'Sandwiches',              sortOrder: 1 } }),
    prisma.menuCategory.create({ data: { canteenId: hari.id, name: 'Burgers',                 sortOrder: 2 } }),
    prisma.menuCategory.create({ data: { canteenId: hari.id, name: 'Vada Pav',                sortOrder: 3 } }),
    prisma.menuCategory.create({ data: { canteenId: hari.id, name: 'Pav Bhaji',               sortOrder: 4 } }),
    prisma.menuCategory.create({ data: { canteenId: hari.id, name: 'Twister Items',           sortOrder: 5 } }),
    prisma.menuCategory.create({ data: { canteenId: hari.id, name: 'Masala Chaat',            sortOrder: 6 } }),
    prisma.menuCategory.create({ data: { canteenId: hari.id, name: 'Milkshakes & Cold Coffee',sortOrder: 7 } }),
  ]);

  await prisma.menuItem.createMany({
    data: [
      // SANDWICHES
      item(hari.id, haSandwich.id, 'American Sweet Corn Sandwich', 50, true, 7),
      item(hari.id, haSandwich.id, 'Veg Cheese Sandwich',          50, true, 7),
      item(hari.id, haSandwich.id, 'Aloo Cheese Chilli Sandwich',  50, true, 7),
      item(hari.id, haSandwich.id, 'Cheese Chilly Sandwich',       50, true, 7),
      item(hari.id, haSandwich.id, 'Hari Special Sandwich',        50, true, 7, { description: "Hari's signature special sandwich", isPopular: true }),
      item(hari.id, haSandwich.id, 'Spl. Veg Sandwich Toast',      50, true, 7),
      item(hari.id, haSandwich.id, 'Sandwich Toast',               45, true, 6),
      item(hari.id, haSandwich.id, 'Capsicum Cheese Sandwich',     50, true, 7),
      item(hari.id, haSandwich.id, 'Cheese Corn Dahi Toast',       60, true, 7),
      item(hari.id, haSandwich.id, 'Dahi Toast',                   55, true, 6),
      item(hari.id, haSandwich.id, 'Cheese Sandwich Dahi',         60, true, 7),
      item(hari.id, haSandwich.id, 'Cheese Chilly Dahi',           60, true, 7),
      item(hari.id, haSandwich.id, 'Chocolate Sandwich',           50, true, 6, { description: 'Sweet chocolate spread sandwich' }),
      item(hari.id, haSandwich.id, 'Cheese Gulkand Sandwich',      50, true, 6, { description: 'Sandwich with sweet gulkand and cheese' }),
      item(hari.id, haSandwich.id, 'Peanut Butter Sandwich',       60, true, 5),
      item(hari.id, haSandwich.id, 'Paneer Capsicum Sandwich',     70, true, 7),
      item(hari.id, haSandwich.id, 'Jam Toast',                    45, true, 4),
      item(hari.id, haSandwich.id, 'Gulkand Toast',                45, true, 4, { description: 'Toast spread with rose petal gulkand' }),
      item(hari.id, haSandwich.id, 'Peanut Butter Chocolate',      60, true, 5, { description: 'Sandwich with peanut butter and chocolate' }),
      item(hari.id, haSandwich.id, 'Special American Corn Toast',  60, true, 7),
      // BURGERS
      item(hari.id, haBurger.id, 'Veg Burger',    70, true, 8),
      item(hari.id, haBurger.id, 'Cheese Burger', 80, true, 8),
      item(hari.id, haBurger.id, 'Paneer Burger', 70, true, 8),
      // VADA PAV
      item(hari.id, haVadaPav.id, 'Vada Pav',        40, true, 4),
      item(hari.id, haVadaPav.id, 'Paneer Vada Pav', 50, true, 5),
      // PAV BHAJI
      item(hari.id, haPavBhaji.id, 'Pav Bhaji',        70, true, 10, { isPopular: true }),
      item(hari.id, haPavBhaji.id, 'Cheese Pav Bhaji', 80, true, 10),
      item(hari.id, haPavBhaji.id, 'Paneer Pav Bhaji', 80, true, 10),
      // TWISTER ITEMS
      item(hari.id, haTwister.id, 'Twister',       60, true, 6),
      item(hari.id, haTwister.id, 'Moyas Twister', 70, true, 6),
      item(hari.id, haTwister.id, 'Fries',         80, true, 7),
      // MASALA CHAAT
      item(hari.id, haChaat.id, 'Masala Puri',            40, true, 5),
      item(hari.id, haChaat.id, 'Pani Puri',              40, true, 5, { isPopular: true }),
      item(hari.id, haChaat.id, 'Masala Bhel Puri',       40, true, 5),
      item(hari.id, haChaat.id, 'Sev Puri',               45, true, 5),
      item(hari.id, haChaat.id, 'Aloo Puri',              45, true, 5),
      item(hari.id, haChaat.id, 'Samosa Masala',          50, true, 5),
      item(hari.id, haChaat.id, 'Cheese Masala Puri',     55, true, 5),
      item(hari.id, haChaat.id, 'Samosa Cheese Masala',   60, true, 5),
      item(hari.id, haChaat.id, 'Dahi Puri',              45, true, 5),
      item(hari.id, haChaat.id, 'Korean Cheese Classic Bun', 80, true, 8),
      // MILKSHAKES & COLD COFFEE
      item(hari.id, haShakes.id, 'Tender Coconut Milkshake', 80, true, 5),
      item(hari.id, haShakes.id, 'Mango Milkshake',          80, true, 5, { isPopular: true }),
      item(hari.id, haShakes.id, 'Sitaphal Milkshake',       80, true, 5, { description: 'Creamy custard apple milkshake' }),
      item(hari.id, haShakes.id, 'Jackfruit Milkshake',      80, true, 5),
      item(hari.id, haShakes.id, 'Sapota Milkshake',         80, true, 5, { description: 'Chikoo (sapota) milkshake' }),
      item(hari.id, haShakes.id, 'Guava Milkshake',          80, true, 5),
      item(hari.id, haShakes.id, 'Banana Milkshake',         80, true, 5),
      item(hari.id, haShakes.id, 'Pineapple Milkshake',      80, true, 5),
      item(hari.id, haShakes.id, 'Strawberry Milkshake',     80, true, 5),
      item(hari.id, haShakes.id, 'Avocado Milkshake',        80, true, 5),
      item(hari.id, haShakes.id, 'Dates Milkshake',          80, true, 5),
      item(hari.id, haShakes.id, 'Fig Milkshake',            80, true, 5),
      item(hari.id, haShakes.id, 'Vanilla Milkshake',        80, true, 5),
      item(hari.id, haShakes.id, 'Chocolate Milkshake',      80, true, 5),
      item(hari.id, haShakes.id, 'Blackcurrant Milkshake',   80, true, 5),
      item(hari.id, haShakes.id, 'Pista Milkshake',          80, true, 5),
      item(hari.id, haShakes.id, 'Choco Milkshake',          80, true, 5),
      item(hari.id, haShakes.id, 'Cold Coffee',              80, true, 5, { isPopular: true }),
    ],
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ⑨ KIOSK CANTEEN
  // ════════════════════════════════════════════════════════════════════════════
  const [kioBreakfast, kioLunch] = await Promise.all([
    prisma.menuCategory.create({ data: { canteenId: kiosk.id, name: 'Breakfast', sortOrder: 1, availableFrom: '08:00', availableTo: '11:00' } }),
    prisma.menuCategory.create({ data: { canteenId: kiosk.id, name: 'Lunch',     sortOrder: 2, availableFrom: '11:00', availableTo: '15:00' } }),
  ]);

  await prisma.menuItem.createMany({
    data: [
      // BREAKFAST
      item(kiosk.id, kioBreakfast.id, 'Idli & Vada',     50, true, 8, { description: 'Soft idlis and crispy vada with chutney & sambar' }),
      item(kiosk.id, kioBreakfast.id, 'Thatte Idli',      50, true, 6, { description: 'Large flat Bangalore-style tatte idli' }),
      item(kiosk.id, kioBreakfast.id, 'Set Dosa',          50, true, 8, { description: 'Soft set dosa with chutney & sambar' }),
      item(kiosk.id, kioBreakfast.id, 'Rice Bath',         50, true, 5, { description: 'Spiced tomato or veg rice bath' }),
      item(kiosk.id, kioBreakfast.id, 'Bisibele Bath',     50, true, 5, { description: 'Karnataka-style hot lentil rice' }),
      item(kiosk.id, kioBreakfast.id, 'Poori',             50, true, 8, { description: 'Fluffy deep-fried puris with potato sabzi' }),
      item(kiosk.id, kioBreakfast.id, 'Tomato Rice Bath',  50, true, 5, { description: 'Tangy tomato-flavoured rice bath' }),
      item(kiosk.id, kioBreakfast.id, 'Veg Pulao',         50, true, 8, { description: 'Fragrant vegetable pulao' }),
      // LUNCH
      item(kiosk.id, kioLunch.id, 'Veg Meals',     70, true, 5, { description: 'Rice, sambar, rasam, dal, sabzi & papad', isPopular: true }),
      item(kiosk.id, kioLunch.id, 'Curd Rice',     50, true, 3, { description: 'Cooling curd rice with pickle' }),
      item(kiosk.id, kioLunch.id, 'Fried Rice',    60, true, 8, { description: 'Stir-fried veg rice' }),
      item(kiosk.id, kioLunch.id, 'Noodles',       60, true, 8, { description: 'Stir-fried veg noodles' }),
      item(kiosk.id, kioLunch.id, 'Chapati Gravy', 50, true, 8, { description: 'Soft chapati with vegetable gravy' }),
    ],
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ⑩ BIRDS PARK — menu pending placeholder
  // ════════════════════════════════════════════════════════════════════════════
  const bpPlaceholderCat = await prisma.menuCategory.create({
    data: { canteenId: birdsPark.id, name: 'Full Menu', sortOrder: 1, isActive: false },
  });
  await prisma.menuItem.create({
    data: {
      canteenId: birdsPark.id,
      categoryId: bpPlaceholderCat.id,
      name: 'Menu Coming Soon',
      price: 0,
      isVeg: true,
      isAvailable: false,
      prepTimeMinutes: 0,
      description: 'Full menu will be updated shortly.',
    },
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ⑪ FRESHETARIA — menu pending placeholder
  // ════════════════════════════════════════════════════════════════════════════
  const freshPlaceholderCat = await prisma.menuCategory.create({
    data: { canteenId: freshetaria.id, name: 'Full Menu', sortOrder: 1, isActive: false },
  });
  await prisma.menuItem.create({
    data: {
      canteenId: freshetaria.id,
      categoryId: freshPlaceholderCat.id,
      name: 'Menu Coming Soon',
      price: 0,
      isVeg: true,
      isAvailable: false,
      prepTimeMinutes: 0,
      description: 'Full menu will be updated shortly.',
    },
  });

  console.log('✅  All canteen menus seeded.');

  // ════════════════════════════════════════════════════════════════════════════
  // PICKUP SLOTS (today + next 3 days)
  // ════════════════════════════════════════════════════════════════════════════
  const smallCanteens = new Set([kiosk.id, hari.id]);
  for (const canteen of canteens) {
    for (let i = 0; i <= 3; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      date.setHours(0, 0, 0, 0);
      await createSlotsForCanteen(canteen.id, date, smallCanteens.has(canteen.id) ? 12 : 25);
    }
  }
  console.log('✅  Pickup slots generated for all 11 canteens.');

  // ════════════════════════════════════════════════════════════════════════════
  // TEST USERS
  // ════════════════════════════════════════════════════════════════════════════
  // UIDs match the dev-login format: `dev_${email.replace(/[^a-z0-9]/gi,'_')}`
  const student = await prisma.user.upsert({
    where: { firebaseUid: 'dev_student_christuniversity_in' },
    update: { email: 'student@christuniversity.in', name: 'Test Student', role: UserRole.STUDENT },
    create: {
      firebaseUid: 'dev_student_christuniversity_in',
      email: 'student@christuniversity.in',
      name: 'Test Student',
      role: UserRole.STUDENT,
      campus: 'Central Campus',
      wallet: { create: { balance: 500 } },
    },
  });

  await prisma.user.upsert({
    where: { firebaseUid: 'dev_admin_christuniversity_in' },
    update: { email: 'admin@christuniversity.in', name: 'University Admin', role: UserRole.ADMIN },
    create: {
      firebaseUid: 'dev_admin_christuniversity_in',
      email: 'admin@christuniversity.in',
      name: 'University Admin',
      role: UserRole.ADMIN,
      campus: 'Central Campus',
    },
  });

  // ── Vendor accounts for every canteen ────────────────────────────────────────
  const vendorMappings = [
    { canteen: mingoes,      email: 'vendor@christuniversity.in',              name: 'Mingoes Vendor',            firebaseUid: 'dev_vendor_christuniversity_in' },
    { canteen: bakery,       email: 'vendor.bakery@christuniversity.in',        name: 'Christ Bakery Vendor',      firebaseUid: 'dev_vendor_bakery_christuniversity_in' },
    { canteen: eleven,       email: 'vendor.eleven@christuniversity.in',        name: 'Eleven Vendor',             firebaseUid: 'dev_vendor_eleven_christuniversity_in' },
    { canteen: michaels,     email: 'vendor.michaels@christuniversity.in',      name: "Michael's Corner Vendor",   firebaseUid: 'dev_vendor_michaels_christuniversity_in' },
    { canteen: punjabi,      email: 'vendor.punjabi@christuniversity.in',       name: 'Punjabi Bites Vendor',      firebaseUid: 'dev_vendor_punjabi_christuniversity_in' },
    { canteen: mariyan,      email: 'vendor.mariyan@christuniversity.in',       name: 'Mariyan Cafe Vendor',       firebaseUid: 'dev_vendor_mariyan_christuniversity_in' },
    { canteen: bhavani,      email: 'vendor.bhavani@christuniversity.in',       name: 'Bhavani Foods Vendor',      firebaseUid: 'dev_vendor_bhavani_christuniversity_in' },
    { canteen: hari,         email: 'vendor.hari@christuniversity.in',          name: 'Hari Sandwich Vendor',      firebaseUid: 'dev_vendor_hari_christuniversity_in' },
    { canteen: kiosk,        email: 'vendor.kiosk@christuniversity.in',         name: 'Kiosk Canteen Vendor',      firebaseUid: 'dev_vendor_kiosk_christuniversity_in' },
    { canteen: birdsPark,    email: 'vendor.birdspark@christuniversity.in',     name: 'Birds Park Vendor',         firebaseUid: 'dev_vendor_birdspark_christuniversity_in' },
    { canteen: freshetaria,  email: 'vendor.freshetaria@christuniversity.in',   name: 'Freshetaria Vendor',        firebaseUid: 'dev_vendor_freshetaria_christuniversity_in' },
  ];

  for (const v of vendorMappings) {
    const vendorUser = await prisma.user.upsert({
      where: { firebaseUid: v.firebaseUid },
      update: { email: v.email, name: v.name, role: UserRole.VENDOR },
      create: {
        firebaseUid: v.firebaseUid,
        email: v.email,
        name: v.name,
        role: UserRole.VENDOR,
        campus: 'Central Campus',
      },
    });
    // Assign to canteen (canteen was just recreated so must update vendorId directly)
    await prisma.canteen.update({
      where: { id: v.canteen.id },
      data: { vendorId: vendorUser.id },
    });
  }

  console.log('✅  Test users created (student + admin + 11 vendor accounts).');
  console.log(`\n🎉  Seed complete! ${canteens.length} canteens, 11 pickup slot sets, 13 users.`);
  console.log('   student@christuniversity.in  /  admin@christuniversity.in');
  console.log('   vendor@christuniversity.in  (Mingoes)');
  console.log('   vendor.bakery@christuniversity.in  (Christ Bakery)');
  console.log('   vendor.eleven@christuniversity.in  (Eleven)');
  console.log('   vendor.michaels@christuniversity.in  (Michael\'s Corner)');
  console.log('   vendor.punjabi@christuniversity.in  (Punjabi Bites)');
  console.log('   vendor.mariyan@christuniversity.in  (Mariyan Cafe)');
  console.log('   vendor.bhavani@christuniversity.in  (Bhavani Foods)');
  console.log('   vendor.hari@christuniversity.in  (Hari Super Sandwich)');
  console.log('   vendor.kiosk@christuniversity.in  (Kiosk Canteen)');
  console.log('   vendor.birdspark@christuniversity.in  (Birds Park)');
  console.log('   vendor.freshetaria@christuniversity.in  (Freshetaria)');
  void student;
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
