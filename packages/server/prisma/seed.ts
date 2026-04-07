import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // ── Canteens ──────────────────────────────────────────────
  const canteensData = [
    {
      name: 'Mingoes',
      description: 'Popular canteen known for South Indian breakfast and quick bites',
      campus: 'Bannerghatta Road',
      location: 'Block A, Ground Floor',
      openingTime: '07:30',
      closingTime: '20:00',
      avgPrepTime: 10,
      contactPhone: '080-12345001',
    },
    {
      name: 'Christ Bakery',
      description: 'Fresh baked goods, sandwiches, pastries and coffee',
      campus: 'Bannerghatta Road',
      location: 'Block B, Near Auditorium',
      openingTime: '08:00',
      closingTime: '19:00',
      avgPrepTime: 8,
      contactPhone: '080-12345002',
    },
    {
      name: 'Punjabi Bites',
      description: 'North Indian cuisine — parathas, sabzi, dal makhani and more',
      campus: 'Bannerghatta Road',
      location: 'Block C, First Floor',
      openingTime: '07:30',
      closingTime: '20:00',
      avgPrepTime: 15,
      contactPhone: '080-12345003',
    },
    {
      name: 'Michael',
      description: 'Multi-cuisine food court with burgers, wraps, pasta and rice meals',
      campus: 'Bannerghatta Road',
      location: 'New Block, Ground Floor',
      openingTime: '08:00',
      closingTime: '19:30',
      avgPrepTime: 12,
      contactPhone: '080-12345004',
    },
    {
      name: 'Freshetaria',
      description: 'Fresh juices, smoothies, salads and healthy snacks',
      campus: 'Bannerghatta Road',
      location: 'Near Library, Outdoor Stall',
      openingTime: '08:00',
      closingTime: '18:00',
      avgPrepTime: 5,
      contactPhone: '080-12345005',
    },
  ];

  const canteens = await Promise.all(
    canteensData.map((c) =>
      prisma.canteen.upsert({
        where: { name: c.name } as any,
        update: {},
        create: c,
      }).catch(() => prisma.canteen.create({ data: c }))
    )
  );

  console.log(`Created ${canteens.length} canteens`);

  // ── Mingoes Menu ─────────────────────────────────────────
  const mingoes = canteens[0];

  const mingoesCats = await Promise.all([
    prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Breakfast', sortOrder: 1, availableFrom: '07:30', availableTo: '10:30' } }),
    prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'South Indian Special', sortOrder: 2, availableFrom: '07:30', availableTo: '11:00' } }),
    prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Lunch', sortOrder: 3, availableFrom: '12:00', availableTo: '14:30' } }),
    prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Snacks', sortOrder: 4, availableFrom: '15:00', availableTo: '18:00' } }),
    prisma.menuCategory.create({ data: { canteenId: mingoes.id, name: 'Beverages', sortOrder: 5 } }),
  ]);

  await prisma.menuItem.createMany({
    data: [
      { canteenId: mingoes.id, categoryId: mingoesCats[0].id, name: 'Masala Dosa', description: 'Crispy dosa with potato filling, chutney & sambar', price: 50, isVeg: true, prepTimeMinutes: 8, isPopular: true },
      { canteenId: mingoes.id, categoryId: mingoesCats[0].id, name: 'Plain Dosa', price: 35, isVeg: true, prepTimeMinutes: 6 },
      { canteenId: mingoes.id, categoryId: mingoesCats[0].id, name: 'Idli Sambar (2 pcs)', price: 30, isVeg: true, prepTimeMinutes: 5, isPopular: true },
      { canteenId: mingoes.id, categoryId: mingoesCats[0].id, name: 'Vada (2 pcs)', price: 30, isVeg: true, prepTimeMinutes: 5 },
      { canteenId: mingoes.id, categoryId: mingoesCats[0].id, name: 'Poha', price: 25, isVeg: true, prepTimeMinutes: 5 },
      { canteenId: mingoes.id, categoryId: mingoesCats[0].id, name: 'Upma', price: 25, isVeg: true, prepTimeMinutes: 5 },
      { canteenId: mingoes.id, categoryId: mingoesCats[0].id, name: 'Bread Omelette', price: 40, isVeg: false, containsEgg: true, prepTimeMinutes: 7 },
      { canteenId: mingoes.id, categoryId: mingoesCats[0].id, name: 'Aloo Paratha', price: 45, isVeg: true, prepTimeMinutes: 10 },
      { canteenId: mingoes.id, categoryId: mingoesCats[1].id, name: 'Set Dosa (3 pcs)', price: 45, isVeg: true, prepTimeMinutes: 8 },
      { canteenId: mingoes.id, categoryId: mingoesCats[1].id, name: 'Rava Dosa', description: 'Crispy rava dosa with chutney', price: 55, isVeg: true, prepTimeMinutes: 8, isNew: true },
      { canteenId: mingoes.id, categoryId: mingoesCats[2].id, name: 'Veg Meals', description: 'Rice, 2 Sabzi, Dal, Roti & Curd', price: 80, isVeg: true, prepTimeMinutes: 5, isPopular: true },
      { canteenId: mingoes.id, categoryId: mingoesCats[2].id, name: 'Non-Veg Meals', description: 'Rice, Chicken Curry, Dal, Roti & Curd', price: 100, isVeg: false, prepTimeMinutes: 5 },
      { canteenId: mingoes.id, categoryId: mingoesCats[2].id, name: 'Chicken Biryani', price: 120, isVeg: false, prepTimeMinutes: 12, isPopular: true },
      { canteenId: mingoes.id, categoryId: mingoesCats[2].id, name: 'Veg Biryani', price: 80, isVeg: true, prepTimeMinutes: 10 },
      { canteenId: mingoes.id, categoryId: mingoesCats[2].id, name: 'Curd Rice', price: 40, isVeg: true, prepTimeMinutes: 3 },
      { canteenId: mingoes.id, categoryId: mingoesCats[3].id, name: 'Samosa (2 pcs)', price: 20, isVeg: true, prepTimeMinutes: 3 },
      { canteenId: mingoes.id, categoryId: mingoesCats[3].id, name: 'Pav Bhaji', price: 50, isVeg: true, prepTimeMinutes: 8 },
      { canteenId: mingoes.id, categoryId: mingoesCats[4].id, name: 'Filter Coffee', price: 20, isVeg: true, prepTimeMinutes: 3 },
      { canteenId: mingoes.id, categoryId: mingoesCats[4].id, name: 'Masala Chai', price: 15, isVeg: true, prepTimeMinutes: 3 },
      { canteenId: mingoes.id, categoryId: mingoesCats[4].id, name: 'Cold Coffee', price: 40, isVeg: true, prepTimeMinutes: 4 },
    ],
  });

  // ── Christ Bakery Menu ────────────────────────────────────
  const bakery = canteens[1];
  const bakeryCats = await Promise.all([
    prisma.menuCategory.create({ data: { canteenId: bakery.id, name: 'Baked Goods', sortOrder: 1 } }),
    prisma.menuCategory.create({ data: { canteenId: bakery.id, name: 'Sandwiches', sortOrder: 2 } }),
    prisma.menuCategory.create({ data: { canteenId: bakery.id, name: 'Beverages', sortOrder: 3 } }),
  ]);

  await prisma.menuItem.createMany({
    data: [
      { canteenId: bakery.id, categoryId: bakeryCats[0].id, name: 'Chocolate Croissant', price: 60, isVeg: true, prepTimeMinutes: 2, isPopular: true },
      { canteenId: bakery.id, categoryId: bakeryCats[0].id, name: 'Butter Toast', price: 25, isVeg: true, prepTimeMinutes: 2 },
      { canteenId: bakery.id, categoryId: bakeryCats[0].id, name: 'Banana Muffin', price: 40, isVeg: true, prepTimeMinutes: 2 },
      { canteenId: bakery.id, categoryId: bakeryCats[0].id, name: 'Chocolate Cake Slice', price: 55, isVeg: true, prepTimeMinutes: 2, isPopular: true },
      { canteenId: bakery.id, categoryId: bakeryCats[1].id, name: 'Veg Club Sandwich', price: 70, isVeg: true, prepTimeMinutes: 6 },
      { canteenId: bakery.id, categoryId: bakeryCats[1].id, name: 'Chicken Sandwich', price: 90, isVeg: false, prepTimeMinutes: 7 },
      { canteenId: bakery.id, categoryId: bakeryCats[1].id, name: 'Paneer Tikka Wrap', price: 80, isVeg: true, prepTimeMinutes: 8, isNew: true },
      { canteenId: bakery.id, categoryId: bakeryCats[2].id, name: 'Cappuccino', price: 60, isVeg: true, prepTimeMinutes: 4, isPopular: true },
      { canteenId: bakery.id, categoryId: bakeryCats[2].id, name: 'Iced Latte', price: 70, isVeg: true, prepTimeMinutes: 4 },
      { canteenId: bakery.id, categoryId: bakeryCats[2].id, name: 'Hot Chocolate', price: 65, isVeg: true, prepTimeMinutes: 4 },
    ],
  });

  // ── Punjabi Bites Menu ────────────────────────────────────
  const punjabi = canteens[2];
  const punjabiCats = await Promise.all([
    prisma.menuCategory.create({ data: { canteenId: punjabi.id, name: 'Parathas', sortOrder: 1, availableFrom: '07:30', availableTo: '11:00' } }),
    prisma.menuCategory.create({ data: { canteenId: punjabi.id, name: 'Main Course', sortOrder: 2, availableFrom: '12:00', availableTo: '15:00' } }),
    prisma.menuCategory.create({ data: { canteenId: punjabi.id, name: 'Beverages', sortOrder: 3 } }),
  ]);

  await prisma.menuItem.createMany({
    data: [
      { canteenId: punjabi.id, categoryId: punjabiCats[0].id, name: 'Aloo Paratha (2 pcs)', description: 'Served with butter & pickle', price: 55, isVeg: true, prepTimeMinutes: 10, isPopular: true },
      { canteenId: punjabi.id, categoryId: punjabiCats[0].id, name: 'Paneer Paratha (2 pcs)', price: 70, isVeg: true, prepTimeMinutes: 12 },
      { canteenId: punjabi.id, categoryId: punjabiCats[0].id, name: 'Plain Paratha (2 pcs)', price: 40, isVeg: true, prepTimeMinutes: 8 },
      { canteenId: punjabi.id, categoryId: punjabiCats[1].id, name: 'Dal Makhani + Roti', price: 80, isVeg: true, prepTimeMinutes: 10, isPopular: true },
      { canteenId: punjabi.id, categoryId: punjabiCats[1].id, name: 'Paneer Butter Masala + Roti', price: 100, isVeg: true, prepTimeMinutes: 12 },
      { canteenId: punjabi.id, categoryId: punjabiCats[1].id, name: 'Rajma Chawal', price: 70, isVeg: true, prepTimeMinutes: 8, isPopular: true },
      { canteenId: punjabi.id, categoryId: punjabiCats[1].id, name: 'Chicken Curry + Rice', price: 110, isVeg: false, prepTimeMinutes: 12 },
      { canteenId: punjabi.id, categoryId: punjabiCats[2].id, name: 'Lassi (Sweet)', price: 35, isVeg: true, prepTimeMinutes: 3 },
      { canteenId: punjabi.id, categoryId: punjabiCats[2].id, name: 'Masala Chai', price: 15, isVeg: true, prepTimeMinutes: 3 },
    ],
  });

  // ── Michael Menu ──────────────────────────────────────────
  const michael = canteens[3];
  const michaelCats = await Promise.all([
    prisma.menuCategory.create({ data: { canteenId: michael.id, name: 'Burgers & Wraps', sortOrder: 1 } }),
    prisma.menuCategory.create({ data: { canteenId: michael.id, name: 'Rice & Noodles', sortOrder: 2 } }),
    prisma.menuCategory.create({ data: { canteenId: michael.id, name: 'Pasta & Pizza', sortOrder: 3 } }),
    prisma.menuCategory.create({ data: { canteenId: michael.id, name: 'Beverages', sortOrder: 4 } }),
  ]);

  await prisma.menuItem.createMany({
    data: [
      { canteenId: michael.id, categoryId: michaelCats[0].id, name: 'Veg Burger', price: 60, isVeg: true, prepTimeMinutes: 8, isPopular: true },
      { canteenId: michael.id, categoryId: michaelCats[0].id, name: 'Chicken Burger', price: 85, isVeg: false, prepTimeMinutes: 10, isPopular: true },
      { canteenId: michael.id, categoryId: michaelCats[0].id, name: 'Paneer Wrap', price: 75, isVeg: true, prepTimeMinutes: 7 },
      { canteenId: michael.id, categoryId: michaelCats[0].id, name: 'Chicken Wrap', price: 90, isVeg: false, prepTimeMinutes: 8 },
      { canteenId: michael.id, categoryId: michaelCats[1].id, name: 'Veg Fried Rice', price: 70, isVeg: true, prepTimeMinutes: 10 },
      { canteenId: michael.id, categoryId: michaelCats[1].id, name: 'Egg Fried Rice', price: 75, isVeg: false, containsEgg: true, prepTimeMinutes: 10 },
      { canteenId: michael.id, categoryId: michaelCats[1].id, name: 'Hakka Noodles', price: 65, isVeg: true, prepTimeMinutes: 10, isPopular: true },
      { canteenId: michael.id, categoryId: michaelCats[2].id, name: 'Pasta Arrabiata', price: 90, isVeg: true, prepTimeMinutes: 12, isNew: true },
      { canteenId: michael.id, categoryId: michaelCats[2].id, name: 'Margherita Pizza (6")', price: 110, isVeg: true, prepTimeMinutes: 15, isPopular: true },
      { canteenId: michael.id, categoryId: michaelCats[3].id, name: 'Cold Coffee', price: 45, isVeg: true, prepTimeMinutes: 4 },
      { canteenId: michael.id, categoryId: michaelCats[3].id, name: 'Fresh Lime Soda', price: 30, isVeg: true, prepTimeMinutes: 3 },
    ],
  });

  // ── Freshetaria Menu ──────────────────────────────────────
  const freshetaria = canteens[4];
  const freshCats = await Promise.all([
    prisma.menuCategory.create({ data: { canteenId: freshetaria.id, name: 'Fresh Juices', sortOrder: 1 } }),
    prisma.menuCategory.create({ data: { canteenId: freshetaria.id, name: 'Smoothies & Shakes', sortOrder: 2 } }),
    prisma.menuCategory.create({ data: { canteenId: freshetaria.id, name: 'Salads & Snacks', sortOrder: 3 } }),
  ]);

  await prisma.menuItem.createMany({
    data: [
      { canteenId: freshetaria.id, categoryId: freshCats[0].id, name: 'Orange Juice (Fresh)', price: 50, isVeg: true, prepTimeMinutes: 4, isPopular: true },
      { canteenId: freshetaria.id, categoryId: freshCats[0].id, name: 'Watermelon Juice', price: 40, isVeg: true, prepTimeMinutes: 3 },
      { canteenId: freshetaria.id, categoryId: freshCats[0].id, name: 'Mixed Fruit Juice', price: 55, isVeg: true, prepTimeMinutes: 5 },
      { canteenId: freshetaria.id, categoryId: freshCats[0].id, name: 'Sugarcane Juice', price: 30, isVeg: true, prepTimeMinutes: 3 },
      { canteenId: freshetaria.id, categoryId: freshCats[1].id, name: 'Mango Smoothie', price: 70, isVeg: true, prepTimeMinutes: 5, isPopular: true },
      { canteenId: freshetaria.id, categoryId: freshCats[1].id, name: 'Banana Milkshake', price: 65, isVeg: true, prepTimeMinutes: 5 },
      { canteenId: freshetaria.id, categoryId: freshCats[1].id, name: 'Strawberry Shake', price: 75, isVeg: true, prepTimeMinutes: 5, isNew: true },
      { canteenId: freshetaria.id, categoryId: freshCats[2].id, name: 'Fruit Salad', price: 60, isVeg: true, prepTimeMinutes: 5, isPopular: true },
      { canteenId: freshetaria.id, categoryId: freshCats[2].id, name: 'Sprouts Salad', price: 50, isVeg: true, isJain: true, prepTimeMinutes: 5 },
      { canteenId: freshetaria.id, categoryId: freshCats[2].id, name: 'Roasted Makhana', price: 40, isVeg: true, isJain: true, prepTimeMinutes: 2 },
    ],
  });

  console.log('Menu items created for all 5 canteens');

  // ── Pickup Slots (today + next 3 days) ────────────────────
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { generateDefaultSlots } = require('../src/services/slot.service');
  for (const canteen of canteens) {
    for (let i = 0; i <= 3; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      date.setHours(0, 0, 0, 0);
      await generateDefaultSlots(canteen.id, date);
    }
  }
  console.log('Pickup slots generated');

  // ── Test Users ────────────────────────────────────────────
  const student = await prisma.user.upsert({
    where: { email: 'student@test.com' },
    update: {},
    create: {
      firebaseUid: 'test_student_uid',
      email: 'student@test.com',
      name: 'Test Student',
      role: UserRole.STUDENT,
      campus: 'Bannerghatta Road',
      wallet: { create: { balance: 500 } },
    },
  });

  await prisma.user.upsert({
    where: { email: 'vendor@test.com' },
    update: {},
    create: {
      firebaseUid: 'test_vendor_uid',
      email: 'vendor@test.com',
      name: 'Mingoes Vendor',
      role: UserRole.VENDOR,
      vendorCanteen: { connect: { id: mingoes.id } },
    },
  });

  await prisma.user.upsert({
    where: { email: 'admin@test.com' },
    update: {},
    create: {
      firebaseUid: 'test_admin_uid',
      email: 'admin@test.com',
      name: 'University Admin',
      role: UserRole.ADMIN,
    },
  });

  console.log('Test users created');
  console.log('Seed complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
