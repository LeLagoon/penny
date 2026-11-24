// Sample ("filler") expenses and savings goals for every supported country.
// Amounts are built from one USD baseline, scaled by each region's purchasing-power factor and
// rounded to prices that look natural, so a lunch is roughly a lunch's price everywhere.
// Dates are spread over roughly the last 12 weeks, ending today, so the charts, the month-end
// forecast and the recurring-bill detection all have something to work with.

// kind 'var'  : bought several times a month at random days; n = purchases per 30 days
// kind 'month': one fixed payment each month
const SLOTS = [
  { key: 'lunch',     category: 'food',          usd: 12,  kind: 'var',   n: 9 },
  { key: 'dinner',    category: 'food',          usd: 26,  kind: 'var',   n: 2 },
  { key: 'groceries', category: 'food',          usd: 58,  kind: 'var',   n: 3 },
  { key: 'transit',   category: 'travel',        usd: 65,  kind: 'month' },
  { key: 'ride',      category: 'travel',        usd: 14,  kind: 'var',   n: 2 },
  { key: 'internet',  category: 'utilities',     usd: 45,  kind: 'month' },
  { key: 'streaming', category: 'entertainment', usd: 11,  kind: 'month' },
  { key: 'night_out', category: 'entertainment', usd: 30,  kind: 'var',   n: 2 },
  { key: 'textbook',  category: 'education',     usd: 70,  kind: 'var',   n: 0.7 },
  { key: 'supplies',  category: 'education',     usd: 22,  kind: 'var',   n: 1 },
  { key: 'pharmacy',  category: 'healthcare',    usd: 22,  kind: 'var',   n: 1 },
  { key: 'gadget',    category: 'technology',    usd: 45,  kind: 'var',   n: 0.5 },
  { key: 'clothes',   category: 'shopping',      usd: 55,  kind: 'var',   n: 0.8 },
  { key: 'emi',       category: 'emi',           usd: 110, kind: 'month' },
  { key: 'invest',    category: 'investment',    usd: 100, kind: 'month' }
];

const NAMES = {
  US: {
    lunch: 'Campus Dining Hall Lunch', dinner: 'Chipotle Dinner with Roommates', groceries: "Trader Joe's Grocery Run",
    transit: 'Metro Student Monthly Pass', ride: 'Uber to Downtown', internet: 'Dorm Fiber Internet',
    streaming: 'Spotify Student Plan', night_out: 'Movie Night & Popcorn', textbook: 'Biology Textbook (3rd Ed)',
    supplies: 'Lab Notebook & Printing', pharmacy: 'CVS Pharmacy Vitamins', gadget: 'Anker USB-C Hub',
    clothes: 'Target Hoodie & Socks', emi: 'Laptop Equipment Installment / EMI', invest: 'Vanguard S&P 500 Auto-Invest'
  },
  IN: {
    lunch: 'Canteen Thali Lunch', dinner: 'Swiggy Dinner Order', groceries: 'BigBasket Groceries',
    transit: 'Metro Smart Card Recharge', ride: 'Ola Auto Ride', internet: 'Jio Fiber Broadband',
    streaming: 'Spotify Student Plan', night_out: 'Movie Tickets at PVR', textbook: 'Engineering Mathematics Textbook',
    supplies: 'Xerox & Printing Notes', pharmacy: 'Apollo Pharmacy Medicines', gadget: 'boAt Earphones',
    clothes: 'Myntra Kurta & Jeans', emi: 'Laptop No-Cost EMI', invest: 'Mutual Fund SIP'
  },
  GB: {
    lunch: 'Uni Refectory Lunch', dinner: "Nando's with Flatmates", groceries: 'Tesco Weekly Shop',
    transit: 'Stagecoach Student Bus Pass', ride: 'Uber to Town', internet: 'Virgin Media Broadband',
    streaming: 'Spotify Student Plan', night_out: 'Cinema Night at Odeon', textbook: 'Economics Textbook (4th Ed)',
    supplies: 'Stationery & Printing', pharmacy: 'Boots Pharmacy', gadget: 'Logitech Wireless Mouse',
    clothes: 'Primark Winter Jacket', emi: 'Laptop Instalment Plan', invest: 'Trading 212 ISA Top-up'
  },
  CA: {
    lunch: 'Tim Hortons & Campus Lunch', dinner: 'Pizza Pizza Dinner', groceries: 'Loblaws Grocery Run',
    transit: 'TTC Monthly Student Pass', ride: 'Uber to Union Station', internet: 'Rogers Residence Internet',
    streaming: 'Spotify Student Plan', night_out: 'Cineplex Movie Night', textbook: 'Algorithms Textbook (2nd Ed)',
    supplies: 'Campus Print & Supplies', pharmacy: 'Shoppers Drug Mart', gadget: 'Logitech MX Master Mouse',
    clothes: 'Roots Toque & Gloves', emi: 'Laptop Financing Instalment', invest: 'TFSA Index Fund Auto-Invest'
  },
  EU: {
    lunch: 'Mensa Lunch', dinner: 'Pizzeria Dinner with Friends', groceries: 'Lidl Weekly Groceries',
    transit: 'Semester Ticket Public Transport', ride: 'Bolt Ride Home', internet: 'Residence Wi-Fi & Mobile Plan',
    streaming: 'Spotify Student Plan', night_out: 'Cinema & Drinks Night', textbook: 'Statistics Textbook',
    supplies: 'Printing & Stationery', pharmacy: 'Pharmacy Vitamins', gadget: 'USB-C Charger & Cable',
    clothes: 'Zara Jacket', emi: 'Laptop Instalment', invest: 'ETF Savings Plan'
  },
  AU: {
    lunch: 'Uni Café Lunch', dinner: 'Guzman y Gomez Dinner', groceries: 'Woolworths Grocery Run',
    transit: 'Student Concession Travel Pass', ride: 'Uber to the CBD', internet: 'Telstra Mobile & Internet',
    streaming: 'Spotify Student Plan', night_out: 'Cinema Night Out', textbook: 'Law Textbook (5th Ed)',
    supplies: 'Print & Study Supplies', pharmacy: 'Chemist Warehouse', gadget: 'JB Hi-Fi Headphones',
    clothes: 'Cotton On Clothes', emi: 'Laptop Payment Plan (Afterpay)', invest: 'Super & ETF Auto-Invest'
  },
  SG: {
    lunch: 'Canteen Chicken Rice Lunch', dinner: 'Hawker Centre Dinner', groceries: 'FairPrice Groceries',
    transit: 'EZ-Link Student Concession Top-up', ride: 'Grab Ride Home', internet: 'Singtel Mobile & Fibre',
    streaming: 'Spotify Student Plan', night_out: 'Movie at Golden Village', textbook: 'Calculus Textbook',
    supplies: 'Print & Stationery', pharmacy: 'Guardian Pharmacy', gadget: 'Logitech Keyboard',
    clothes: 'Uniqlo Jacket', emi: 'Laptop Instalment (0% Plan)', invest: 'ETF Regular Savings Plan'
  }
};

// [name, USD-equivalent target, fraction already saved, days until deadline, priority]
const GOALS = {
  US: [['MacBook Pro M3', 1499, 0.6, 110, 'High'], ['Spring Break Road Trip', 750, 0.5, 25, 'Medium'], ['Emergency Fund', 1000, 0.35, 200, 'Low']],
  IN: [['Laptop Upgrade', 1200, 0.55, 120, 'High'], ['Goa Trip with Friends', 450, 0.6, 40, 'Medium'], ['Emergency Fund', 900, 0.3, 220, 'Low']],
  GB: [['New Laptop', 1300, 0.5, 110, 'High'], ['Interrailing Summer Trip', 900, 0.4, 170, 'Medium'], ['Emergency Fund', 1000, 0.3, 230, 'Low']],
  CA: [['MacBook Pro M3', 1400, 0.6, 110, 'High'], ['Whistler Ski Reading Week', 650, 0.55, 25, 'Medium'], ['Emergency Fund', 1000, 0.3, 220, 'Low']],
  EU: [['New Laptop', 1300, 0.5, 115, 'High'], ['Erasmus City Trip', 700, 0.5, 60, 'Medium'], ['Emergency Fund', 1000, 0.3, 220, 'Low']],
  AU: [['MacBook Air', 1400, 0.55, 105, 'High'], ['Byron Bay Weekend Trip', 600, 0.5, 35, 'Medium'], ['Emergency Fund', 1000, 0.3, 210, 'Low']],
  SG: [['New Laptop', 1300, 0.55, 105, 'High'], ['Bali Holiday', 800, 0.45, 80, 'Medium'], ['Emergency Fund', 1000, 0.3, 220, 'Low']]
};

function rng(seedText) {
  let a = 0;
  for (const ch of seedText) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function niceRound(x) {
  const step = x < 100 ? 1 : x < 1000 ? 5 : x < 10000 ? 10 : 50;
  return Math.max(step, Math.round(x / step) * step);
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

export function hasDemoData(regionCode) {
  return Boolean(NAMES[regionCode]);
}

export function buildDemoExpenses(region, today = new Date()) {
  const names = NAMES[region.code];
  if (!names) return [];
  const rand = rng(`${region.code}-expenses`);
  const ppp = region.pppFromUSD || region.exchangeFromUSD || 1;
  const base = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const dayAgo = n => isoDay(new Date(base.getTime() - n * 86400000));
  const rows = [];
  const WINDOW_DAYS = 84;

  for (const slot of SLOTS) {
    const price = slot.usd * ppp;
    if (slot.kind === 'month') {
      const amount = niceRound(price);
      const offset = 2 + Math.floor(rand() * 24);
      for (let i = 0; i < 3; i++) {
        rows.push({ date: dayAgo(offset + 30 * i), description: names[slot.key], category: slot.category, amount });
      }
    } else {
      const count = Math.max(slot.n >= 1 ? Math.round(slot.n * WINDOW_DAYS / 30) : (rand() < slot.n * WINDOW_DAYS / 30 ? 1 : 0), 0);
      for (let i = 0; i < count; i++) {
        const amount = niceRound(price * (0.78 + rand() * 0.5));
        rows.push({ date: dayAgo(Math.floor(rand() * WINDOW_DAYS)), description: names[slot.key], category: slot.category, amount });
      }
    }
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return rows.map((r, i) => ({ id: i + 1, ...r }));
}

export function buildDemoGoals(region, today = new Date()) {
  const list = GOALS[region.code];
  if (!list) return [];
  const ppp = region.pppFromUSD || region.exchangeFromUSD || 1;
  const base = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  return list.map(([name, usd, saved, days, priority], i) => {
    const target = niceRound(usd * ppp);
    return {
      id: i + 1,
      name,
      target_amount: target,
      saved_amount: Math.round(target * saved),
      deadline: isoDay(new Date(base.getTime() + days * 86400000)),
      priority
    };
  });
}
