import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDENT_LEXICON } from './lib/lexicon.js';
import { predictByRules, normalizeText } from './lib/rules.js';
import { createMlClient } from './lib/ml-client.js';
import { buildDemoExpenses, buildDemoGoals, hasDemoData } from './lib/demo-data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, 'public');

const USER_PROFILE_FILE = path.join(BASE_DIR, 'user_profile.json');
const USER_LEDGER_FILE = path.join(BASE_DIR, 'user_ledger.json');
const CUSTOM_CATEGORIES_FILE = path.join(BASE_DIR, 'custom_categories.json');
const GOALS_CSV = path.join(BASE_DIR, 'goals.csv');
const SEEDED_FILE = path.join(BASE_DIR, 'seeded_regions.json');
const LEARNED_CSV = path.join(BASE_DIR, 'learned_rules.csv');
const FEEDBACK_CSV = path.join(BASE_DIR, 'transaction_feedback.csv');
const STUDENT_CSV = path.join(BASE_DIR, 'student.csv');
const TRANSACTIONS_CSV = path.join(BASE_DIR, 'transactions.csv');

// pppFromUSD = local units that buy what 1 USD buys in the US. Rounded World Bank ICP numbers,
// worth double checking. Market rates would make India look ~90x too expensive.
const REGIONS = {
  US: {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    symbol: '$',
    flag: '🇺🇸',
    locale: 'en-US',
    exchangeFromUSD: 1.0,
    pppFromUSD: 1.0,
    baseSubsistence: 1350,
    techSurcharge: 150,
    businessSurcharge: 100,
    upperclassSurcharge: 90,
    ageSlope: 15,
    minFloor: 250,
    sampleTuition: 36000,
    sampleIncome: 2200,
    sampleAid: 800,
    mae: 42,
    quickDeposits: [25, 50, 100],
    stepAmt: 5,
    demoExpenses: [
      { id: 1, date: '2026-11-11', description: 'Campus Dining Hall Lunch Meal', category: 'food', amount: 14 },
      { id: 2, date: '2026-11-10', description: 'Subway & Transit Monthly Pass', category: 'travel', amount: 65 },
      { id: 3, date: '2026-11-08', description: 'Biology Reference Textbook (3rd Ed)', category: 'education', amount: 95 },
      { id: 4, date: '2026-11-06', description: 'Dorm Gigabit Fiber High-Speed Internet', category: 'utilities', amount: 55 },
      { id: 5, date: '2026-11-04', description: 'Logitech MX Master Optical Mouse', category: 'technology', amount: 89 },
      { id: 6, date: '2026-11-02', description: 'CVS Pharmacy Flu & Vitamin Supplies', category: 'healthcare', amount: 28 },
      { id: 7, date: '2026-10-30', description: 'Chipotle Burrito & Roommates Dinner', category: 'food', amount: 38 },
      { id: 8, date: '2026-10-27', description: 'Vanguard S&P 500 Index Fund Auto-Invest', category: 'investment', amount: 150 },
      { id: 9, date: '2026-10-24', description: 'Laptop Equipment Installment / EMI', category: 'emi', amount: 120 },
      { id: 10, date: '2026-10-21', description: 'Trader Joe’s Weekly Grocery Provisions', category: 'food', amount: 85 }
    ],
    demoGoals: [
      { id: 1, name: 'MacBook Pro M3 Apparatus', target_amount: 1499, saved_amount: 950, deadline: '2027-02-15', priority: 'High' },
      { id: 2, name: 'Spring Break Road Trip', target_amount: 750, saved_amount: 480, deadline: '2026-12-20', priority: 'Medium' }
    ]
  },
  IN: {
    code: 'IN',
    name: 'India',
    currency: 'INR',
    symbol: '₹',
    flag: '🇮🇳',
    locale: 'en-IN',
    exchangeFromUSD: 90.0,
    pppFromUSD: 23.0,
    baseSubsistence: 16000,
    techSurcharge: 1800,
    businessSurcharge: 1200,
    upperclassSurcharge: 1100,
    ageSlope: 200,
    minFloor: 2500,
    sampleTuition: 200000,
    sampleIncome: 45000,
    sampleAid: 15000,
    mae: 2180,
    quickDeposits: [500, 1000, 2500],
    stepAmt: 50,
    demoExpenses: [
      { id: 1, date: '2026-11-11', description: 'Campus Canteen Lunch Meal', category: 'food', amount: 240 },
      { id: 2, date: '2026-11-10', description: 'Metro Rail Monthly Pass Recharge', category: 'travel', amount: 600 },
      { id: 3, date: '2026-11-08', description: 'Algorithms Reference Textbook (2nd Ed)', category: 'education', amount: 1350 },
      { id: 4, date: '2026-11-06', description: 'Hostel Dedicated Fiber Internet', category: 'utilities', amount: 799 },
      { id: 5, date: '2026-11-04', description: 'Logitech MX Master Optical Peripheral', category: 'technology', amount: 1850 },
      { id: 6, date: '2026-11-02', description: 'Prescription Flu & Vitamin Medications', category: 'healthcare', amount: 420 },
      { id: 7, date: '2026-10-30', description: 'Weekend Roommates Dinner Outing', category: 'food', amount: 780 },
      { id: 8, date: '2026-10-27', description: 'Index Fund Monthly SIP', category: 'investment', amount: 2000 },
      { id: 9, date: '2026-10-24', description: 'Laptop Equipment EMI Payment', category: 'emi', amount: 3200 },
      { id: 10, date: '2026-10-21', description: 'Weekly Grocery Mart Provisions', category: 'food', amount: 1420 }
    ],
    demoGoals: [
      { id: 1, name: 'MacBook M3 Apparatus', target_amount: 110000, saved_amount: 68000, deadline: '2027-02-15', priority: 'High' },
      { id: 2, name: 'Semester Break Goa Trip', target_amount: 22000, saved_amount: 14500, deadline: '2026-12-20', priority: 'Medium' }
    ]
  },
  GB: {
    code: 'GB',
    name: 'United Kingdom',
    currency: 'GBP',
    symbol: '£',
    flag: '🇬🇧',
    locale: 'en-GB',
    exchangeFromUSD: 0.79,
    pppFromUSD: 0.69,
    baseSubsistence: 1050,
    techSurcharge: 120,
    businessSurcharge: 80,
    upperclassSurcharge: 75,
    ageSlope: 12,
    minFloor: 200,
    sampleTuition: 22000,
    sampleIncome: 1600,
    sampleAid: 500,
    mae: 34,
    quickDeposits: [20, 50, 100],
    stepAmt: 5,
    demoExpenses: [
      { id: 1, date: '2026-11-11', description: 'Pret a Manger Campus Lunch Meal', category: 'food', amount: 11 },
      { id: 2, date: '2026-11-10', description: 'TfL Student Oyster Monthly Travel Card', category: 'travel', amount: 55 },
      { id: 3, date: '2026-11-08', description: 'Algorithms Reference Textbook (2nd Ed)', category: 'education', amount: 75 },
      { id: 4, date: '2026-11-06', description: 'Student Hall Fiber Broadband Internet', category: 'utilities', amount: 35 },
      { id: 5, date: '2026-11-04', description: 'Logitech MX Master Optical Peripheral', category: 'technology', amount: 69 },
      { id: 6, date: '2026-11-02', description: 'Boots Pharmacy Cold & Flu Medication', category: 'healthcare', amount: 18 },
      { id: 7, date: '2026-10-30', description: 'Weekend Flatmates Dinner Outing', category: 'food', amount: 34 },
      { id: 8, date: '2026-10-27', description: 'Vanguard FTSE All-World Monthly ISA', category: 'investment', amount: 100 },
      { id: 9, date: '2026-10-24', description: 'Laptop Monthly Installment Payment', category: 'emi', amount: 85 },
      { id: 10, date: '2026-10-21', description: 'Tesco Weekly Grocery Provisions', category: 'food', amount: 65 }
    ],
    demoGoals: [
      { id: 1, name: 'MacBook Pro M3 Apparatus', target_amount: 1299, saved_amount: 820, deadline: '2027-02-15', priority: 'High' },
      { id: 2, name: 'Reading Week Eurostar Trip', target_amount: 450, saved_amount: 310, deadline: '2026-12-20', priority: 'Medium' }
    ]
  },
  CA: {
    code: 'CA',
    name: 'Canada',
    currency: 'CAD',
    symbol: 'CA$',
    flag: '🇨🇦',
    locale: 'en-CA',
    exchangeFromUSD: 1.38,
    pppFromUSD: 1.23,
    baseSubsistence: 1450,
    techSurcharge: 160,
    businessSurcharge: 110,
    upperclassSurcharge: 100,
    ageSlope: 16,
    minFloor: 275,
    sampleTuition: 28000,
    sampleIncome: 2100,
    sampleAid: 750,
    mae: 48,
    quickDeposits: [25, 50, 100],
    stepAmt: 5,
    demoExpenses: [
      { id: 1, date: '2026-11-11', description: 'Tim Hortons & Campus Lunch Meal', category: 'food', amount: 16 },
      { id: 2, date: '2026-11-10', description: 'TTC / Transit Monthly Student Pass', category: 'travel', amount: 75 },
      { id: 3, date: '2026-11-08', description: 'Algorithms Reference Textbook (2nd Ed)', category: 'education', amount: 125 },
      { id: 4, date: '2026-11-06', description: 'Residence Fiber Broadband Internet', category: 'utilities', amount: 65 },
      { id: 5, date: '2026-11-04', description: 'Logitech MX Master Optical Peripheral', category: 'technology', amount: 115 },
      { id: 6, date: '2026-11-02', description: 'Shoppers Drug Mart Vitamins & Medicine', category: 'healthcare', amount: 32 },
      { id: 7, date: '2026-10-30', description: 'Weekend Roommates Dinner Outing', category: 'food', amount: 48 },
      { id: 8, date: '2026-10-27', description: 'Wealthsimple Index ETF Contribution', category: 'investment', amount: 150 },
      { id: 9, date: '2026-10-24', description: 'Laptop Equipment Monthly Payment', category: 'emi', amount: 130 },
      { id: 10, date: '2026-10-21', description: 'Metro Mart Weekly Grocery Provisions', category: 'food', amount: 95 }
    ],
    demoGoals: [
      { id: 1, name: 'MacBook Pro M3 Apparatus', target_amount: 1899, saved_amount: 1150, deadline: '2027-02-15', priority: 'High' },
      { id: 2, name: 'Whistler Ski Reading Week', target_amount: 750, saved_amount: 420, deadline: '2026-12-20', priority: 'Medium' }
    ]
  },
  EU: {
    code: 'EU',
    name: 'European Union',
    currency: 'EUR',
    symbol: '€',
    flag: '🇪🇺',
    locale: 'de-DE',
    exchangeFromUSD: 0.92,
    pppFromUSD: 0.77,
    baseSubsistence: 1150,
    techSurcharge: 130,
    businessSurcharge: 90,
    upperclassSurcharge: 80,
    ageSlope: 14,
    minFloor: 220,
    sampleTuition: 8500,
    sampleIncome: 1400,
    sampleAid: 450,
    mae: 36,
    quickDeposits: [20, 50, 100],
    stepAmt: 5,
    demoExpenses: [
      { id: 1, date: '2026-11-11', description: 'Mensa Campus Lunch Meal', category: 'food', amount: 12 },
      { id: 2, date: '2026-11-10', description: 'Semesterticket / Transit Monthly Pass', category: 'travel', amount: 49 },
      { id: 3, date: '2026-11-08', description: 'Algorithms Reference Textbook (2nd Ed)', category: 'education', amount: 80 },
      { id: 4, date: '2026-11-06', description: 'Student Dorm Fiber Internet', category: 'utilities', amount: 39 },
      { id: 5, date: '2026-11-04', description: 'Logitech MX Master Optical Peripheral', category: 'technology', amount: 79 },
      { id: 6, date: '2026-11-02', description: 'Apotheke Flu & Vitamin Medications', category: 'healthcare', amount: 22 },
      { id: 7, date: '2026-10-30', description: 'Weekend Flatmates Dinner Outing', category: 'food', amount: 38 },
      { id: 8, date: '2026-10-27', description: 'Trade Republic MSCI World ETF Savings', category: 'investment', amount: 120 },
      { id: 9, date: '2026-10-24', description: 'Laptop Monthly Installment', category: 'emi', amount: 95 },
      { id: 10, date: '2026-10-21', description: 'Lidl / Aldi Weekly Grocery Provisions', category: 'food', amount: 70 }
    ],
    demoGoals: [
      { id: 1, name: 'MacBook Pro M3 Apparatus', target_amount: 1399, saved_amount: 880, deadline: '2027-02-15', priority: 'High' },
      { id: 2, name: 'Erasmus Weekend Exploration', target_amount: 400, saved_amount: 270, deadline: '2026-12-20', priority: 'Medium' }
    ]
  },
  AU: {
    code: 'AU',
    name: 'Australia',
    currency: 'AUD',
    symbol: 'A$',
    flag: '🇦🇺',
    locale: 'en-AU',
    exchangeFromUSD: 1.52,
    pppFromUSD: 1.46,
    baseSubsistence: 1650,
    techSurcharge: 180,
    businessSurcharge: 120,
    upperclassSurcharge: 110,
    ageSlope: 18,
    minFloor: 300,
    sampleTuition: 32000,
    sampleIncome: 2200,
    sampleAid: 750,
    mae: 54,
    quickDeposits: [25, 50, 100],
    stepAmt: 5,
    demoExpenses: [
      { id: 1, date: '2026-11-11', description: 'Campus Hub Lunch Meal', category: 'food', amount: 18 },
      { id: 2, date: '2026-11-10', description: 'Opal / Myki Student Transit Pass', category: 'travel', amount: 80 },
      { id: 3, date: '2026-11-08', description: 'Algorithms Reference Textbook (2nd Ed)', category: 'education', amount: 135 },
      { id: 4, date: '2026-11-06', description: 'UniLodge Fiber High-Speed Internet', category: 'utilities', amount: 70 },
      { id: 5, date: '2026-11-04', description: 'Logitech MX Master Optical Peripheral', category: 'technology', amount: 129 },
      { id: 6, date: '2026-11-02', description: 'Chemist Warehouse Flu & Vitamins', category: 'healthcare', amount: 35 },
      { id: 7, date: '2026-10-30', description: 'Weekend Flatmates Dinner Outing', category: 'food', amount: 52 },
      { id: 8, date: '2026-10-27', description: 'Vanguard Australian Shares ETF Investment', category: 'investment', amount: 160 },
      { id: 9, date: '2026-10-24', description: 'Laptop Equipment Monthly Payment', category: 'emi', amount: 140 },
      { id: 10, date: '2026-10-21', description: 'Woolworths Weekly Grocery Provisions', category: 'food', amount: 105 }
    ],
    demoGoals: [
      { id: 1, name: 'MacBook Pro M3 Apparatus', target_amount: 2199, saved_amount: 1350, deadline: '2027-02-15', priority: 'High' },
      { id: 2, name: 'Gold Coast Mid-Sem Trip', target_amount: 800, saved_amount: 520, deadline: '2026-12-20', priority: 'Medium' }
    ]
  },
  SG: {
    code: 'SG',
    name: 'Singapore',
    currency: 'SGD',
    symbol: 'S$',
    flag: '🇸🇬',
    locale: 'en-SG',
    exchangeFromUSD: 1.34,
    pppFromUSD: 0.83,
    baseSubsistence: 1300,
    techSurcharge: 150,
    businessSurcharge: 100,
    upperclassSurcharge: 90,
    ageSlope: 15,
    minFloor: 250,
    sampleTuition: 24000,
    sampleIncome: 1800,
    sampleAid: 700,
    mae: 45,
    quickDeposits: [25, 50, 100],
    stepAmt: 5,
    demoExpenses: [
      { id: 1, date: '2026-11-11', description: 'Campus Canteen / Hawker Meal', category: 'food', amount: 12 },
      { id: 2, date: '2026-11-10', description: 'MRT / Bus Monthly Concession Pass', category: 'travel', amount: 52 },
      { id: 3, date: '2026-11-08', description: 'Algorithms Reference Textbook (2nd Ed)', category: 'education', amount: 98 },
      { id: 4, date: '2026-11-06', description: 'Hall Dedicated Fiber Internet', category: 'utilities', amount: 48 },
      { id: 5, date: '2026-11-04', description: 'Logitech MX Master Optical Peripheral', category: 'technology', amount: 110 },
      { id: 6, date: '2026-11-02', description: 'Guardian Pharmacy Flu & Vitamins', category: 'healthcare', amount: 26 },
      { id: 7, date: '2026-10-30', description: 'Weekend Roommates Dinner Outing', category: 'food', amount: 40 },
      { id: 8, date: '2026-10-27', description: 'STI ETF Monthly Regular Savings Plan', category: 'investment', amount: 150 },
      { id: 9, date: '2026-10-24', description: 'Laptop Equipment Monthly Payment', category: 'emi', amount: 115 },
      { id: 10, date: '2026-10-21', description: 'FairPrice Weekly Grocery Provisions', category: 'food', amount: 80 }
    ],
    demoGoals: [
      { id: 1, name: 'MacBook Pro M3 Apparatus', target_amount: 1999, saved_amount: 1200, deadline: '2027-02-15', priority: 'High' },
      { id: 2, name: 'Bali Recess Week Trip', target_amount: 600, saved_amount: 380, deadline: '2026-12-20', priority: 'Medium' }
    ]
  }
};

const DEFAULT_CUSTOM_CATEGORIES = [
  {
    id: 'fitness',
    name: 'Fitness & Gym',
    color: '#059669',
    keywords: ['gym', 'cultfit', 'gold gym', 'planet fitness', 'equinox', 'protein', 'whey', 'creatine', 'preworkout', 'dumbbells', 'yoga']
  },
  {
    id: 'gaming',
    name: 'Gaming & Digital',
    color: '#8B5CF6',
    keywords: ['steam', 'valorant', 'riot', 'discord', 'playstation', 'xbox', 'nintendo', 'epic games', 'twitch']
  }
];

const COLLEGES = [
  { name: 'Carnegie Mellon University', city: 'Pittsburgh', country: 'US', tier: 'University Hub', coli: 1.12 },
  { name: 'Stanford University', city: 'SF Bay Area / Palo Alto', country: 'US', tier: 'Global Tech Metro', coli: 1.45 },
  { name: 'UC Berkeley', city: 'Berkeley / SF', country: 'US', tier: 'Global Tech Metro', coli: 1.40 },
  { name: 'MIT (Massachusetts Institute of Technology)', city: 'Boston / Cambridge', country: 'US', tier: 'Elite Academic Metro', coli: 1.42 },
  { name: 'Harvard University', city: 'Boston / Cambridge', country: 'US', tier: 'Elite Academic Metro', coli: 1.42 },
  { name: 'Columbia University', city: 'New York City', country: 'US', tier: 'Global Financial Capital', coli: 1.50 },
  { name: 'New York University (NYU)', city: 'New York City', country: 'US', tier: 'Global Financial Capital', coli: 1.50 },
  { name: 'University of Washington', city: 'Seattle', country: 'US', tier: 'Pacific Tech Hub', coli: 1.35 },

  { name: 'IIT Bombay', city: 'Mumbai', country: 'IN', tier: 'Tier 1 Metro', coli: 1.35 },
  { name: 'IIT Delhi', city: 'Delhi NCR', country: 'IN', tier: 'Tier 1 Metro', coli: 1.30 },
  { name: 'IIT Madras', city: 'Chennai', country: 'IN', tier: 'Tier 1 Metro', coli: 1.20 },
  { name: 'IIT Kharagpur', city: 'Kharagpur', country: 'IN', tier: 'College Town', coli: 0.85 },
  { name: 'IIT Roorkee', city: 'Roorkee', country: 'IN', tier: 'College Town', coli: 0.85 },
  { name: 'BITS Pilani (Pilani Campus)', city: 'Pilani', country: 'IN', tier: 'College Town', coli: 0.88 },
  { name: 'BITS Pilani (Goa Campus)', city: 'Goa', country: 'IN', tier: 'Coastal Hub', coli: 1.05 },
  { name: 'BITS Pilani (Hyderabad Campus)', city: 'Hyderabad', country: 'IN', tier: 'Tech Capital', coli: 1.15 },
  { name: 'Manipal Institute of Technology (MAHE)', city: 'Manipal', country: 'IN', tier: 'University Town', coli: 0.90 },
  { name: 'VIT Vellore', city: 'Vellore', country: 'IN', tier: 'College Town', coli: 0.82 },
  { name: 'SRM Institute of Science & Technology', city: 'Chennai', country: 'IN', tier: 'Tier 1 Metro', coli: 1.18 },
  { name: 'Delhi University (DU)', city: 'Delhi NCR', country: 'IN', tier: 'Tier 1 Metro', coli: 1.25 },
  { name: 'Ashoka University', city: 'Sonipat / Delhi NCR', country: 'IN', tier: 'University Suburb', coli: 1.15 },
  { name: 'IIM Ahmedabad', city: 'Ahmedabad', country: 'IN', tier: 'Urban Commercial Hub', coli: 1.05 },
  { name: 'IIM Bangalore', city: 'Bengaluru', country: 'IN', tier: 'Tech Capital', coli: 1.28 },
  { name: 'IISc Bangalore', city: 'Bengaluru', country: 'IN', tier: 'Tech Capital', coli: 1.28 },
  { name: 'Symbiosis International University', city: 'Pune', country: 'IN', tier: 'Educational Hub', coli: 1.15 },

  { name: 'University of Oxford', city: 'Oxford', country: 'GB', tier: 'Historic University City', coli: 1.25 },
  { name: 'University of Cambridge', city: 'Cambridge', country: 'GB', tier: 'Silicon Fen Tech Hub', coli: 1.25 },
  { name: 'Imperial College London', city: 'London', country: 'GB', tier: 'Global Metro Capital', coli: 1.45 },
  { name: 'University College London (UCL)', city: 'London', country: 'GB', tier: 'Global Metro Capital', coli: 1.45 },
  { name: 'University of Edinburgh', city: 'Edinburgh', country: 'GB', tier: 'Scottish Cultural Capital', coli: 1.15 },

  { name: 'University of Toronto', city: 'Toronto', country: 'CA', tier: 'Global Metro Hub', coli: 1.35 },
  { name: 'University of British Columbia (UBC)', city: 'Vancouver', country: 'CA', tier: 'Pacific Coastal Hub', coli: 1.40 },
  { name: 'University of Waterloo', city: 'Waterloo', country: 'CA', tier: 'Canadian Tech Triangle', coli: 1.10 },
  { name: 'McGill University', city: 'Montreal', country: 'CA', tier: 'Cultural Metro', coli: 1.18 },

  { name: 'ETH Zurich', city: 'Zurich', country: 'EU', tier: 'Swiss Innovation Center', coli: 1.55 },
  { name: 'Technical University of Munich (TUM)', city: 'Munich', country: 'EU', tier: 'Bavarian Tech Hub', coli: 1.30 },
  { name: 'University of Amsterdam', city: 'Amsterdam', country: 'EU', tier: 'European Digital Capital', coli: 1.35 },

  { name: 'University of Melbourne', city: 'Melbourne', country: 'AU', tier: 'Australian Cultural Hub', coli: 1.32 },
  { name: 'University of Sydney', city: 'Sydney', country: 'AU', tier: 'Pacific Financial Center', coli: 1.40 },

  { name: 'National University of Singapore (NUS)', city: 'Singapore', country: 'SG', tier: 'Pan-Asian Global Hub', coli: 1.38 },
  { name: 'Nanyang Technological University (NTU)', city: 'Singapore', country: 'SG', tier: 'Pan-Asian Tech Hub', coli: 1.38 },

  { name: 'Other / Independent Institution', city: 'Other', country: 'US', tier: 'Standard Baseline', coli: 1.00 }
];

const CITY_COLI = {
  'Mumbai': { factor: 1.35, housing: 1.45, food: 1.25, transit: 1.22, tech: 1.05, lifestyle: 1.30, country: 'IN' },
  'Delhi NCR': { factor: 1.28, housing: 1.32, food: 1.20, transit: 1.25, tech: 1.02, lifestyle: 1.25, country: 'IN' },
  'Bengaluru': { factor: 1.28, housing: 1.38, food: 1.20, transit: 1.22, tech: 1.08, lifestyle: 1.26, country: 'IN' },
  'Hyderabad': { factor: 1.15, housing: 1.18, food: 1.10, transit: 1.12, tech: 1.02, lifestyle: 1.15, country: 'IN' },
  'Pune': { factor: 1.15, housing: 1.20, food: 1.12, transit: 1.10, tech: 1.02, lifestyle: 1.16, country: 'IN' },
  'Chennai': { factor: 1.18, housing: 1.22, food: 1.14, transit: 1.15, tech: 1.02, lifestyle: 1.15, country: 'IN' },
  'Ahmedabad': { factor: 1.05, housing: 1.05, food: 1.02, transit: 1.00, tech: 1.00, lifestyle: 1.05, country: 'IN' },
  'Kolkata': { factor: 1.05, housing: 1.02, food: 1.00, transit: 0.95, tech: 1.00, lifestyle: 1.02, country: 'IN' },
  'Goa': { factor: 1.05, housing: 1.10, food: 1.05, transit: 1.02, tech: 1.00, lifestyle: 1.08, country: 'IN' },
  'Sonipat / Delhi NCR': { factor: 1.15, housing: 1.18, food: 1.12, transit: 1.10, tech: 1.02, lifestyle: 1.15, country: 'IN' },
  'Manipal': { factor: 0.90, housing: 0.88, food: 0.92, transit: 0.78, tech: 1.00, lifestyle: 0.90, country: 'IN' },
  'Pilani': { factor: 0.88, housing: 0.82, food: 0.90, transit: 0.70, tech: 1.00, lifestyle: 0.85, country: 'IN' },
  'Vellore': { factor: 0.82, housing: 0.80, food: 0.85, transit: 0.72, tech: 1.00, lifestyle: 0.82, country: 'IN' },
  'Kharagpur': { factor: 0.85, housing: 0.82, food: 0.86, transit: 0.72, tech: 1.00, lifestyle: 0.84, country: 'IN' },
  'Roorkee': { factor: 0.85, housing: 0.82, food: 0.86, transit: 0.72, tech: 1.00, lifestyle: 0.84, country: 'IN' },

  'Pittsburgh': { factor: 1.12, housing: 1.15, food: 1.10, transit: 1.08, tech: 1.02, lifestyle: 1.10, country: 'US' },
  'SF Bay Area / Palo Alto': { factor: 1.45, housing: 1.60, food: 1.35, transit: 1.30, tech: 1.10, lifestyle: 1.40, country: 'US' },
  'Berkeley / SF': { factor: 1.40, housing: 1.55, food: 1.32, transit: 1.28, tech: 1.10, lifestyle: 1.38, country: 'US' },
  'Boston / Cambridge': { factor: 1.42, housing: 1.55, food: 1.32, transit: 1.25, tech: 1.05, lifestyle: 1.35, country: 'US' },
  'New York City': { factor: 1.50, housing: 1.70, food: 1.40, transit: 1.35, tech: 1.05, lifestyle: 1.45, country: 'US' },
  'Seattle': { factor: 1.35, housing: 1.45, food: 1.28, transit: 1.25, tech: 1.08, lifestyle: 1.30, country: 'US' },

  'Oxford': { factor: 1.25, housing: 1.32, food: 1.20, transit: 1.15, tech: 1.02, lifestyle: 1.22, country: 'GB' },
  'Cambridge': { factor: 1.25, housing: 1.30, food: 1.20, transit: 1.15, tech: 1.02, lifestyle: 1.22, country: 'GB' },
  'London': { factor: 1.45, housing: 1.60, food: 1.35, transit: 1.40, tech: 1.05, lifestyle: 1.38, country: 'GB' },
  'Edinburgh': { factor: 1.15, housing: 1.20, food: 1.12, transit: 1.10, tech: 1.02, lifestyle: 1.15, country: 'GB' },

  'Toronto': { factor: 1.35, housing: 1.45, food: 1.30, transit: 1.25, tech: 1.08, lifestyle: 1.32, country: 'CA' },
  'Vancouver': { factor: 1.40, housing: 1.55, food: 1.32, transit: 1.25, tech: 1.05, lifestyle: 1.35, country: 'CA' },
  'Waterloo': { factor: 1.10, housing: 1.12, food: 1.08, transit: 1.05, tech: 1.02, lifestyle: 1.10, country: 'CA' },
  'Montreal': { factor: 1.18, housing: 1.22, food: 1.15, transit: 1.12, tech: 1.02, lifestyle: 1.16, country: 'CA' },

  'Zurich': { factor: 1.55, housing: 1.65, food: 1.50, transit: 1.35, tech: 1.08, lifestyle: 1.45, country: 'EU' },
  'Munich': { factor: 1.30, housing: 1.40, food: 1.22, transit: 1.20, tech: 1.05, lifestyle: 1.25, country: 'EU' },
  'Amsterdam': { factor: 1.35, housing: 1.45, food: 1.25, transit: 1.22, tech: 1.05, lifestyle: 1.30, country: 'EU' },

  'Melbourne': { factor: 1.32, housing: 1.40, food: 1.25, transit: 1.25, tech: 1.05, lifestyle: 1.28, country: 'AU' },
  'Sydney': { factor: 1.40, housing: 1.52, food: 1.32, transit: 1.30, tech: 1.05, lifestyle: 1.35, country: 'AU' },

  'Singapore': { factor: 1.38, housing: 1.50, food: 1.18, transit: 1.20, tech: 1.05, lifestyle: 1.32, country: 'SG' },

  'Other': { factor: 1.00, housing: 1.00, food: 1.00, transit: 1.00, tech: 1.00, lifestyle: 1.00, country: 'US' }
};

function getRegionForProfile(profile) {
  if (!profile) return REGIONS.US;
  
  if (profile.country && REGIONS[profile.country]) {
    return REGIONS[profile.country];
  }
  if (profile.region && REGIONS[profile.region]) {
    return REGIONS[profile.region];
  }

  if (profile.college) {
    const matched = COLLEGES.find(c => c.name.toLowerCase() === profile.college.toLowerCase());
    if (matched && matched.country && REGIONS[matched.country]) {
      return REGIONS[matched.country];
    }
  }

  if (profile.campus_city && CITY_COLI[profile.campus_city] && CITY_COLI[profile.campus_city].country) {
    const cCode = CITY_COLI[profile.campus_city].country;
    if (REGIONS[cCode]) return REGIONS[cCode];
  }

  return REGIONS.US;
}

function readJson(filePath, fallback = null) {
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

// temp file + rename so a crash can't leave a half-written file
function writeFileAtomic(filePath, text) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
}

function writeJson(filePath, data) {
  writeFileAtomic(filePath, JSON.stringify(data, null, 2));
}

// like readJson but a broken file throws instead of returning nothing, so we never overwrite it
function readJsonStrict(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new HttpError(500, `${path.basename(filePath)} is unreadable; refusing to overwrite it. Fix or remove the file.`);
  }
}

// csv parser, quoted fields can have commas, "" and newlines
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvEscape(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) return [];
  const parsed = parseCsv(content).filter(r => !(r.length === 1 && r[0].trim() === ''));
  if (!parsed.length) return [];
  const headers = parsed[0].map(h => h.trim());
  return parsed.slice(1).map(values => {
    const row = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
    return row;
  });
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push(headers.map(h => csvEscape(r[h])).join(','));
  }
  writeFileAtomic(filePath, lines.join('\n') + '\n');
}

function getLearnedRules() {
  const rules = {};
  if (fs.existsSync(LEARNED_CSV)) {
    const rows = readCsv(LEARNED_CSV);
    for (const r of rows) {
      if (r.transaction_text && r.category) {
        rules[r.transaction_text.toLowerCase().trim()] = r.category.toLowerCase().trim();
      }
    }
  }
  return rules;
}

function getCustomCategories() {
  const data = readJson(CUSTOM_CATEGORIES_FILE, null);
  if (Array.isArray(data)) return data;
  writeJson(CUSTOM_CATEGORIES_FILE, DEFAULT_CUSTOM_CATEGORIES);
  return DEFAULT_CUSTOM_CATEGORIES;
}

// wrapper around lib/rules.js with the user's rules and custom categories
function predictCategory(text) {
  return predictByRules(text, { learned: getLearnedRules(), custom: getCustomCategories() });
}

const ml = createMlClient({ rootDir: BASE_DIR });
const ML_FEEDBACK_CSV = path.join(BASE_DIR, 'ml', 'data', 'user_feedback.csv');

// these come from the user so they always win, otherwise ML (rules as fallback)
const USER_DECIDED_SOURCES = new Set(['user_rule_exact', 'user_rule_partial', 'custom_category']);

async function classify(text) {
  const rules = predictCategory(text);
  if (USER_DECIDED_SOURCES.has(rules.source)) return { ...rules, engine: 'rules', needs_review: false };
  if (ml.isReady()) {
    try {
      const p = await ml.predict(text);
      return {
        category: p.category, confidence: p.confidence, source: 'ml', engine: 'ml',
        needs_review: !!p.needs_review, alternatives: p.alternatives || []
      };
    } catch (err) {
      console.warn('[Penny] ML prediction failed, using rules:', err.message);
    }
  }
  return { ...rules, engine: 'rules', needs_review: rules.confidence < 0.6 };
}

async function classifyMany(texts) {
  const results = new Array(texts.length);
  const needMl = [];
  texts.forEach((t, i) => {
    const rules = predictCategory(t);
    if (USER_DECIDED_SOURCES.has(rules.source)) results[i] = { ...rules, engine: 'rules', needs_review: false };
    else needMl.push(i);
  });
  if (needMl.length && ml.isReady()) {
    try {
      const preds = await ml.predictMany(needMl.map(i => texts[i]));
      needMl.forEach((i, k) => {
        const p = preds[k];
        results[i] = { category: p.category, confidence: p.confidence, source: 'ml', engine: 'ml', needs_review: !!p.needs_review, alternatives: p.alternatives || [] };
      });
    } catch (err) {
      console.warn('[Penny] ML batch prediction failed, using rules:', err.message);
    }
  }
  texts.forEach((t, i) => {
    if (!results[i]) {
      const r = predictCategory(t);
      results[i] = { ...r, engine: 'rules', needs_review: r.confidence < 0.6 };
    }
  });
  return results;
}

function upsertCsvRow(file, headers, keyField, row) {
  const rows = readCsv(file).filter(r => String(r[keyField]).toLowerCase() !== String(row[keyField]).toLowerCase());
  rows.push(row);
  writeCsv(file, headers, rows);
}

// old/sample entries have no model confidence, so score them now (null if the model disagrees)
async function annotateLedger(txns) {
  const stale = txns.filter(t => !t.confidence_source || (t.confidence_source === 'rules' && ml.isReady()));
  if (!stale.length) return txns;
  const preds = await classifyMany(stale.map(t => t.description || ''));
  stale.forEach((t, i) => {
    const p = preds[i];
    t.confidence = p.category === t.category ? p.confidence : null;
    t.confidence_source = p.engine === 'ml' ? 'ml' : 'rules';
    t.needs_review = p.category !== t.category || !!p.needs_review;
  });
  saveLedger(txns);
  return txns;
}

function calculatePredictedBudget(profile) {
  const region = getRegionForProfile(profile);

  const income = parseFloat(profile.monthly_income || 0);
  const aid = parseFloat(profile.financial_aid || 0);
  const age = parseFloat(profile.age || 20);
  const tuitionAmt = parseFloat(profile.tuition_amount || 0);
  const period = profile.tuition_period || 'annual';

  const monthlyTuition = period === 'semester' ? (tuitionAmt / 6) : (tuitionAmt / 12);
  const grossInflow = income + aid;
  const netInflow = Math.max(grossInflow - monthlyTuition, 0);

  const city = profile.campus_city || 'Other';
  const coli = (CITY_COLI[city] && CITY_COLI[city].factor) || 1.0;

  let baseEstimate = region.baseSubsistence * coli;
  baseEstimate += (netInflow * 0.12);
  if (profile.major === 'Computer Science' || profile.major === 'Engineering') baseEstimate += (region.techSurcharge * coli);
  if (profile.major === 'Economics' || profile.major === 'Business') baseEstimate += (region.businessSurcharge * coli);
  if (profile.year_in_school === 'Junior' || profile.year_in_school === 'Senior') baseEstimate += (region.upperclassSurcharge * coli);
  baseEstimate += Math.max((age - 18) * region.ageSlope, 0);

  let maxAffordable = netInflow > 0 ? (netInflow * 0.85) : (grossInflow * 0.50);
  if (maxAffordable < region.minFloor) maxAffordable = region.minFloor;

  const predictedBudget = Math.round(Math.min(baseEstimate, maxAffordable));

  return {
    predicted_budget: predictedBudget,
    monthly_tuition_amortized: Math.round(monthlyTuition),
    gross_inflow: Math.round(grossInflow),
    net_inflow: Math.round(netInflow),
    affordability_cap: Math.round(maxAffordable),
    coli_factor: coli,
    campus_city: city,
    college: profile.college || 'Unspecified Campus',
    region: {
      code: region.code,
      name: region.name,
      currency: region.currency,
      symbol: region.symbol,
      flag: region.flag,
      locale: region.locale
    }
  };
}

function getPeerBenchmarks(profile) {
  const region = getRegionForProfile(profile);
  if (!fs.existsSync(STUDENT_CSV)) return { scope: 'N/A', cohort_size: 0, benchmarks: [], region };
  const rows = readCsv(STUDENT_CSV);

  let cohort = rows.filter(r => r.major === profile.major && r.year_in_school === profile.year_in_school);
  let scope = `${profile.year_in_school || 'Student'} ${profile.major || 'Undergrad'} peers`;
  if (cohort.length < 5 && profile.major) {
    cohort = rows.filter(r => r.major === profile.major);
    scope = `${profile.major} peers`;
  }
  if (cohort.length < 5) {
    cohort = rows;
    scope = 'all university students';
  }

  const city = profile.campus_city || 'Other';
  const cityMeta = CITY_COLI[city] || CITY_COLI['Other'];

  const peerAlias = {
    food: { col: 'food', factor: cityMeta.food },
    entertainment: { col: 'entertainment', factor: cityMeta.lifestyle },
    technology: { col: 'technology', factor: cityMeta.tech },
    travel: { col: 'transportation', factor: cityMeta.transit },
    healthcare: { col: 'health_wellness', factor: 1.0 },
    education: { col: 'books_supplies', factor: 1.0 },
    utilities: { col: 'housing', factor: cityMeta.housing },
    shopping: { col: 'personal_care', factor: cityMeta.lifestyle }
  };

  const rate = region.pppFromUSD || region.exchangeFromUSD;
  const benchmarks = [];
  let peerTuitionSum = 0;
  let peerTuitionCount = 0;

  for (const r of cohort) {
    const tVal = parseFloat(r.tuition || 0) * 2 * rate;
    if (!isNaN(tVal) && tVal > 0) {
      peerTuitionSum += tVal;
      peerTuitionCount++;
    }
  }

  for (const [txnCat, config] of Object.entries(peerAlias)) {
    let sum = 0;
    let count = 0;
    for (const r of cohort) {
      const val = parseFloat(r[config.col] || 0) * rate;
      if (!isNaN(val)) {
        sum += (val * config.factor);
        count++;
      }
    }
    benchmarks.push({
      category: txnCat,
      peer_avg: Math.round(count > 0 ? sum / count : 0),
      raw_avg: Math.round(count > 0 ? (sum / config.factor) / count : 0),
      location_multiplier: config.factor
    });
  }

  const defaultTuition = region.sampleTuition;
  const peerTuitionAvg = Math.round(peerTuitionCount > 0 ? peerTuitionSum / peerTuitionCount : defaultTuition);

  return {
    illustrative: true,
    conversion: 'purchasing-power parity (approximate)',
    scope,
    cohort_size: cohort.length,
    college: profile.college || 'Unspecified Campus',
    campus_city: city,
    coli_factor: cityMeta.factor,
    benchmarks,
    peer_tuition_annual_avg: peerTuitionAvg,
    user_tuition_annual: profile.tuition_period === 'semester'
      ? Math.round(parseFloat(profile.tuition_amount || 0) * 2)
      : Math.round(parseFloat(profile.tuition_amount || 0)),
    region: {
      code: region.code,
      name: region.name,
      currency: region.currency,
      symbol: region.symbol,
      flag: region.flag,
      locale: region.locale
    }
  };
}


const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY_BYTES = 100 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const declared = parseInt(req.headers['content-length'] || '0', 10);
    if (declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, 'Request body too large'));
      return;
    }
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { tooBig = true; return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) return reject(new HttpError(413, 'Request body too large'));
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        const value = JSON.parse(raw);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          return reject(new HttpError(400, 'Request body must be a JSON object'));
        }
        resolve(value);
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}


function vString(value, name, { max = 200, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return '';
  }
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be text`);
  const s = value.trim();
  if (required && !s) throw new HttpError(400, `${name} is required`);
  if (s.length > max) throw new HttpError(400, `${name} must be at most ${max} characters`);
  return s;
}

function vNumber(value, name, { min = 0, max = 1e9, required = true, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return fallback;
  }
  const n = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value) : NaN);
  if (!Number.isFinite(n)) throw new HttpError(400, `${name} must be a number`);
  if (n < min || n > max) throw new HttpError(400, `${name} must be between ${min} and ${max}`);
  return n;
}

function vDate(value, name, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return '';
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${name} must be a date in YYYY-MM-DD format`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${name} is not a valid date`);
  }
  return value;
}

function vId(raw, name = 'id') {
  if (!/^\d{1,16}$/.test(String(raw))) throw new HttpError(400, `Invalid ${name}`);
  return parseInt(raw, 10);
}

function knownCategoryIds() {
  return new Set([...Object.keys(STUDENT_LEXICON), ...getCustomCategories().map(c => c.id)]);
}

function vCategory(value, name = 'category', { required = true } = {}) {
  const s = vString(value, name, { max: 60, required }).toLowerCase();
  if (!s) return '';
  if (!knownCategoryIds().has(s) && s !== 'miscellaneous') {
    throw new HttpError(400, `Unknown ${name}: ${s}`);
  }
  return s;
}

function vRegionCode(value, name = 'country') {
  const s = vString(value, name, { max: 4 }).toUpperCase();
  if (!s) return '';
  if (!REGIONS[s]) throw new HttpError(400, `Unknown ${name}: ${s}`);
  return s;
}


const GOAL_HEADERS = ['id', 'name', 'target_amount', 'saved_amount', 'deadline', 'priority', 'currency'];

function currentRegion() {
  return getRegionForProfile(readJson(USER_PROFILE_FILE, null));
}

// demo data is added once per country; seeded_regions.json remembers which are done so an
// emptied country doesn't get refilled
function demoFor(kind, region) {
  if (hasDemoData(region.code)) return kind === 'expenses' ? buildDemoExpenses(region) : buildDemoGoals(region);
  return kind === 'expenses' ? region.demoExpenses : region.demoGoals;
}

function seedMissingRegions(kind, items) {
  const stored = readJson(SEEDED_FILE, {}) || {};
  const done = new Set(Array.isArray(stored[kind]) ? stored[kind] : []);
  const out = [...items];
  let added = false;
  for (const reg of Object.values(REGIONS)) {
    if (done.has(reg.code)) continue;
    done.add(reg.code);
    if (out.some(x => x && x.currency === reg.currency)) continue;
    let nextId = out.reduce((m, x) => Math.max(m, (x && x.id) || 0), 0) + 1;
    for (const d of demoFor(kind, reg)) out.push({ ...d, id: nextId++, currency: reg.currency });
    added = true;
  }
  if (done.size !== (Array.isArray(stored[kind]) ? stored[kind].length : 0)) {
    writeJson(SEEDED_FILE, { ...stored, [kind]: [...done] });
  }
  return { items: out, added };
}

// tag each row with its currency so switching region doesn't reinterpret old amounts
function loadLedger() {
  const region = currentRegion();
  const stored = readJsonStrict(USER_LEDGER_FILE);
  let changed = false;
  const tagged = Array.isArray(stored)
    ? stored.map(t => {
        if (t && !t.currency) { changed = true; return { ...t, currency: region.currency }; }
        return t;
      })
    : [];
  const seeded = seedMissingRegions('expenses', tagged);
  if (!Array.isArray(stored) || changed || seeded.added) writeJson(USER_LEDGER_FILE, seeded.items);
  return seeded.items;
}

function saveLedger(txns) {
  writeJson(USER_LEDGER_FILE, txns);
}

function loadGoals() {
  const region = currentRegion();
  let changed = false;
  const goals = fs.existsSync(GOALS_CSV)
    ? readCsv(GOALS_CSV).map(r => {
        if (!r.currency) changed = true;
        return {
          id: parseInt(r.id, 10),
          name: r.name,
          target_amount: parseFloat(r.target_amount || 0),
          saved_amount: parseFloat(r.saved_amount || 0),
          deadline: r.deadline,
          priority: r.priority,
          currency: r.currency || region.currency
        };
      })
    : [];
  const seeded = seedMissingRegions('goals', goals);
  if (!fs.existsSync(GOALS_CSV) || changed || seeded.added) saveGoals(seeded.items);
  return seeded.items;
}

function saveGoals(goals) {
  writeCsv(GOALS_CSV, GOAL_HEADERS, goals);
}

function buildProfile(body) {
  const region = vRegionCode(body.country) || getRegionForProfile(body).code;
  const period = body.tuition_period === 'semester' ? 'semester' : 'annual';
  const college = vString(body.college, 'college', { max: 120, required: true });
  // known college fixes the city
  const knownCollege = COLLEGES.find(c => c.name === college && !c.name.startsWith('Other'));
  const campusCity = knownCollege ? knownCollege.city : vString(body.campus_city, 'campus_city', { max: 80 });
  return {
    name: vString(body.name, 'name', { max: 80 }) || 'Student Scholar',
    college,
    campus_city: campusCity,
    country: region,
    major: vString(body.major, 'major', { max: 60 }),
    year_in_school: vString(body.year_in_school, 'year_in_school', { max: 30 }),
    tuition_amount: vNumber(body.tuition_amount, 'tuition_amount', { min: 0, max: 1e9 }),
    tuition_period: period,
    monthly_income: vNumber(body.monthly_income, 'monthly_income', { min: 0, max: 1e9 }),
    financial_aid: vNumber(body.financial_aid, 'financial_aid', { min: 0, max: 1e9 }),
    age: vNumber(body.age, 'age', { min: 14, max: 100, required: false, fallback: 20 }),
    gender: vString(body.gender, 'gender', { max: 30 }),
    preferred_payment_method: vString(body.preferred_payment_method, 'preferred_payment_method', { max: 40 })
  };
}


async function handleApi(req, res, pathname, method) {
  let m;

  if (pathname === '/api/profile' && method === 'GET') {
    const profile = readJson(USER_PROFILE_FILE, null);
    if (profile && profile.college) {
      return sendJson(res, 200, { exists: true, profile, ...calculatePredictedBudget(profile) });
    }
    return sendJson(res, 200, { exists: false });
  }

  if (pathname === '/api/profile' && method === 'POST') {
    const profile = buildProfile(await readJsonBody(req));
    writeJson(USER_PROFILE_FILE, profile);
    return sendJson(res, 200, { success: true, profile, ...calculatePredictedBudget(profile) });
  }

  if (pathname === '/api/transactions' && method === 'GET') {
    return sendJson(res, 200, await annotateLedger(loadLedger()));
  }

  if (pathname === '/api/transactions' && method === 'POST') {
    const body = await readJsonBody(req);
    const description = vString(body.description, 'description', { max: 200, required: true });
    const amount = vNumber(body.amount, 'amount', { min: 0.01, max: 1e9 });
    const date = vDate(body.date || new Date().toISOString().slice(0, 10), 'date');
    const pred = await classify(description);
    const chosen = vCategory(body.category, 'category', { required: false });
    // category/confidence come from the server, unless the user overrode it (confidence 1)
    let category = pred.category || 'miscellaneous';
    let confidence = pred.confidence;
    let confidenceSource = pred.engine === 'ml' ? 'ml' : 'rules';
    let needsReview = !!pred.needs_review;
    if (chosen && chosen !== pred.category) {
      category = chosen; confidence = 1; confidenceSource = 'user'; needsReview = false;
    }

    const txns = loadLedger();
    let id = Date.now() + Math.floor(Math.random() * 1000);
    const used = new Set(txns.map(t => t.id));
    while (used.has(id)) id++;

    const newTxn = { id, date, description, category, amount, confidence, confidence_source: confidenceSource, needs_review: needsReview, currency: currentRegion().currency };
    txns.unshift(newTxn);
    saveLedger(txns);
    return sendJson(res, 200, { success: true, transaction: newTxn, all: txns });
  }

  if (pathname === '/api/transactions/reset' && method === 'POST') {
    // only resets the current currency
    const body = await readJsonBody(req);
    const reg = REGIONS[vRegionCode(body.country)] || currentRegion();
    const kept = loadLedger().filter(t => t.currency !== reg.currency);
    let nextId = kept.reduce((m, t) => Math.max(m, t.id || 0), 0) + 1;
    const all = [...demoFor('expenses', reg).map(e => ({ ...e, id: nextId++, currency: reg.currency })), ...kept];
    saveLedger(all);
    return sendJson(res, 200, { success: true, all, region: reg.code });
  }

  if (pathname === '/api/transactions/clear' && method === 'POST') {
    saveLedger([]);
    return sendJson(res, 200, { success: true, all: [] });
  }

  if ((m = pathname.match(/^\/api\/transactions\/([^/]+)$/)) && method === 'PATCH') {
    const id = vId(m[1]);
    const body = await readJsonBody(req);
    const category = vCategory(body.category, 'category');
    const txns = loadLedger();
    const txn = txns.find(t => t.id === id);
    if (!txn) throw new HttpError(404, 'Transaction not found');
    txn.category = category;
    txn.confidence = 1;
    txn.confidence_source = 'user';
    txn.needs_review = false;
    saveLedger(txns);
    return sendJson(res, 200, { success: true, transaction: txn });
  }

  if ((m = pathname.match(/^\/api\/transactions\/([^/]+)$/)) && method === 'DELETE') {
    const id = vId(m[1]);
    const txns = loadLedger();
    if (!txns.some(t => t.id === id)) throw new HttpError(404, 'Transaction not found');
    const remaining = txns.filter(t => t.id !== id);
    saveLedger(remaining);
    return sendJson(res, 200, { success: true, all: remaining });
  }

  if (pathname === '/api/goals' && method === 'GET') {
    return sendJson(res, 200, loadGoals());
  }

  if (pathname === '/api/goals' && method === 'POST') {
    const body = await readJsonBody(req);
    const name = vString(body.name, 'name', { max: 100, required: true });
    const target = vNumber(body.target_amount, 'target_amount', { min: 1, max: 1e9 });
    const saved = vNumber(body.saved_amount, 'saved_amount', { min: 0, max: 1e9, required: false, fallback: 0 });
    if (saved > target) throw new HttpError(400, 'saved_amount cannot exceed target_amount');
    const deadline = vDate(body.deadline, 'deadline');
    const priority = ['High', 'Medium', 'Low'].includes(body.priority) ? body.priority : 'Medium';

    const goals = loadGoals();
    const nextId = goals.reduce((max, g) => Math.max(max, g.id || 0), 0) + 1;
    const newGoal = {
      id: nextId, name, target_amount: target, saved_amount: saved, deadline, priority,
      currency: currentRegion().currency
    };
    goals.push(newGoal);
    saveGoals(goals);
    return sendJson(res, 200, { success: true, goal: newGoal });
  }

  if (pathname === '/api/goals/reset' && method === 'POST') {
    // same here, other currencies stay
    const body = await readJsonBody(req);
    const reg = REGIONS[vRegionCode(body.country)] || currentRegion();
    const kept = loadGoals().filter(g => g.currency !== reg.currency);
    const all = [...demoFor('goals', reg).map(g => ({ ...g, currency: reg.currency })), ...kept];
    // ids need to stay unique
    all.forEach((g, i) => { g.id = i + 1; });
    saveGoals(all);
    return sendJson(res, 200, { success: true, all, region: reg.code });
  }

  if ((m = pathname.match(/^\/api\/goals\/([^/]+)\/deposit$/)) && method === 'POST') {
    const id = vId(m[1]);
    const body = await readJsonBody(req);
    const amount = vNumber(body.amount, 'amount', { min: 0.01, max: 1e9 });
    const goals = loadGoals();
    const goal = goals.find(g => g.id === id);
    if (!goal) throw new HttpError(404, 'Goal not found');
    goal.saved_amount = Math.min(goal.saved_amount + amount, goal.target_amount);
    saveGoals(goals);
    return sendJson(res, 200, { success: true, all: goals });
  }

  if ((m = pathname.match(/^\/api\/goals\/([^/]+)$/)) && method === 'DELETE') {
    const id = vId(m[1]);
    const goals = loadGoals();
    if (!goals.some(g => g.id === id)) throw new HttpError(404, 'Goal not found');
    const remaining = goals.filter(g => g.id !== id);
    saveGoals(remaining);
    return sendJson(res, 200, { success: true, all: remaining });
  }

  if (pathname === '/api/categories' && method === 'GET') {
    return sendJson(res, 200, { custom: getCustomCategories(), builtIn: Object.keys(STUDENT_LEXICON) });
  }

  if (pathname === '/api/categories' && method === 'POST') {
    const body = await readJsonBody(req);
    const name = vString(body.name, 'name', { max: 40, required: true });
    const rawId = vString(body.id, 'id', { max: 40 }) || name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const id = rawId.toLowerCase();
    if (!/^[a-z0-9_]{1,40}$/.test(id)) throw new HttpError(400, 'Category id may only contain letters, numbers and underscores');
    if (STUDENT_LEXICON[id] || id === 'miscellaneous') throw new HttpError(400, `"${id}" is a built-in category`);

    const color = body.color === undefined || body.color === '' ? '#0284C7' : body.color;
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new HttpError(400, 'color must be a hex value like #0284C7');
    }
    const rawKeywords = Array.isArray(body.keywords)
      ? body.keywords
      : (typeof body.keywords === 'string' ? body.keywords.split(',') : []);
    if (rawKeywords.length > 50) throw new HttpError(400, 'At most 50 keywords per category');
    const keywords = rawKeywords.map(k => {
      if (typeof k !== 'string') throw new HttpError(400, 'Keywords must be text');
      const kw = k.toLowerCase().trim();
      if (kw.length > 40) throw new HttpError(400, 'Keywords must be at most 40 characters');
      return kw;
    }).filter(Boolean);

    const custom = getCustomCategories();
    const newCat = { id, name, color, keywords };
    const existingIdx = custom.findIndex(c => c.id === id);
    if (existingIdx >= 0) custom[existingIdx] = newCat;
    else custom.push(newCat);
    writeJson(CUSTOM_CATEGORIES_FILE, custom);
    return sendJson(res, 200, { success: true, category: newCat, all: custom });
  }

  if (pathname === '/api/nlp/predict' && method === 'POST') {
    const body = await readJsonBody(req);
    const text = vString(body.text, 'text', { max: 500 });
    return sendJson(res, 200, await classify(text));
  }

  if (pathname === '/api/nlp/teach' && method === 'POST') {
    const body = await readJsonBody(req);
    const normText = vString(body.text, 'text', { max: 200, required: true }).toLowerCase();
    const normCat = vCategory(body.category, 'category');

    // same text replaces the old rule
    upsertCsvRow(LEARNED_CSV, ['transaction_text', 'category'], 'transaction_text', { transaction_text: normText, category: normCat });
    upsertCsvRow(FEEDBACK_CSV, ['transaction_text', 'category'], 'transaction_text', { transaction_text: normText, category: normCat });
    fs.mkdirSync(path.dirname(ML_FEEDBACK_CSV), { recursive: true });
    upsertCsvRow(ML_FEEDBACK_CSV, ['text', 'category'], 'text', { text: normText, category: normCat });

    // refit takes ~0.25s so just do it now
    let mlLearned = false;
    if (ml.isReady()) {
      try { await ml.feedback(normText, normCat); mlLearned = true; } catch (err) {
        // model doesn't know custom categories, the rule still applies
        if (!/not a category the model knows/.test(err.message)) console.warn('[Penny] ML feedback failed:', err.message);
      }
    }
    return sendJson(res, 200, { success: true, learned: { text: normText, category: normCat }, ml_updated: mlLearned });
  }

  if (pathname === '/api/peer-benchmarks' && method === 'GET') {
    const profile = readJson(USER_PROFILE_FILE, {
      college: 'Carnegie Mellon University',
      campus_city: 'Pittsburgh',
      country: 'US',
      major: 'Biology',
      year_in_school: 'Freshman',
      age: 19,
      monthly_income: 2400,
      financial_aid: 1200,
      tuition_amount: 34000,
      tuition_period: 'annual'
    });
    return sendJson(res, 200, getPeerBenchmarks(profile));
  }

  if (pathname === '/api/colleges' && method === 'GET') {
    return sendJson(res, 200, { colleges: COLLEGES, cities: Object.keys(CITY_COLI), regions: REGIONS });
  }

  if (pathname === '/api/ml/status' && method === 'GET') {
    return sendJson(res, 200, ml.status());
  }

  if (pathname === '/api/ml/retrain' && method === 'POST') {
    if (!ml.isReady()) throw new HttpError(503, 'ML service is not running');
    return sendJson(res, 200, await ml.retrain());
  }

  if (pathname === '/api/insights' && method === 'GET') {
    if (!ml.isReady()) {
      return sendJson(res, 200, { available: false, reason: ml.status().status === 'starting' ? 'The ML service is still starting.' : 'The ML service is not running.' });
    }
    const profile = readJson(USER_PROFILE_FILE, null);
    if (!profile || !profile.college) return sendJson(res, 200, { available: false, reason: 'No profile yet.' });
    const budgetMeta = calculatePredictedBudget(profile);
    const region = getRegionForProfile(profile);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const inCurrency = e => !e.currency || e.currency === region.currency;
    try {
      const result = await ml.insights({
        today,
        transactions: loadLedger().filter(inCurrency).map(t => ({ id: t.id, date: t.date, description: t.description, category: t.category, amount: t.amount })),
        goals: loadGoals().filter(inCurrency),
        profile: {
          prior_budget: budgetMeta.predicted_budget,
          monthly_inflow: budgetMeta.gross_inflow,
          monthly_tuition: budgetMeta.monthly_tuition_amortized,
          currency: region.currency
        }
      });
      return sendJson(res, 200, { available: true, ...result });
    } catch (err) {
      console.warn('[Penny] insights failed:', err.message);
      return sendJson(res, 200, { available: false, reason: 'The ML service could not compute insights.' });
    }
  }

  if (pathname === '/api/diagnostics' && method === 'GET') {
    const profile = readJson(USER_PROFILE_FILE, null);
    const region = getRegionForProfile(profile);
    let metrics = null;
    if (ml.isReady()) {
      try { metrics = await ml.metrics(); } catch (err) { console.warn('[Penny] metrics failed:', err.message); }
    }
    return sendJson(res, 200, {
      ml: { ...ml.status(), metrics },
      rules: {
        lexicon_keywords: Object.values(STUDENT_LEXICON).reduce((n, kws) => n + kws.length, 0),
        taught_rules: Object.keys(getLearnedRules()).length,
        custom_categories: getCustomCategories().length
      },
      region: { code: region.code, currency: region.currency, symbol: region.symbol }
    });
  }

  if (pathname === '/api/meta' && method === 'GET') {
    let majors = ['Biology', 'Computer Science', 'Economics', 'Engineering', 'Psychology'];
    let years = ['Freshman', 'Sophomore', 'Junior', 'Senior'];
    let payments = ['Cash', 'Credit/Debit Card', 'Mobile Payment App'];
    if (fs.existsSync(STUDENT_CSV)) {
      const rows = readCsv(STUDENT_CSV);
      majors = [...new Set(rows.map(r => r.major).filter(Boolean))].sort();
      years = [...new Set(rows.map(r => r.year_in_school).filter(Boolean))].sort();
      payments = [...new Set(rows.map(r => r.preferred_payment_method).filter(Boolean))].sort();
    }
    return sendJson(res, 200, {
      majors, years, payments,
      colleges: COLLEGES,
      cities: Object.keys(CITY_COLI),
      categories: Object.keys(STUDENT_LEXICON),
      regions: REGIONS
    });
  }

  throw new HttpError(404, 'Not found');
}


function serveStatic(req, res, pathname, method) {
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }
  if (rel.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  const publicRoot = fs.realpathSync(PUBLIC_DIR);
  const requested = path.resolve(publicRoot, '.' + (rel === '/' ? '/index.html' : rel));
  let filePath = null;
  try {
    const real = fs.realpathSync(requested);
    const inside = real.startsWith(publicRoot + path.sep);
    if (inside && fs.statSync(real).isFile()) filePath = real;
  } catch {
    filePath = null;
  }

  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}


const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  // dns rebinding guard
  
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }
  const method = req.method;

  if (pathname.startsWith('/api/')) {
    try {
      // no CORS headers; requiring json content-type makes cross-site writes fail the preflight
      if (method !== 'GET' && method !== 'DELETE') {
        const type = String(req.headers['content-type'] || '').toLowerCase();
        if (!type.startsWith('application/json')) throw new HttpError(415, 'Content-Type must be application/json');
      }
      await handleApi(req, res, pathname, method);
    } catch (err) {
      if (res.headersSent) return;
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
      } else {
        console.error('[Penny] Unhandled error:', err);
        sendJson(res, 500, { error: 'Internal server error' });
      }
    }
    return;
  }

  serveStatic(req, res, pathname, method);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Penny Node Engine] Server running at http://localhost:${PORT} (bound to ${HOST})`);
  ml.start();
});

function shutdown() {
  ml.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => ml.stop());
