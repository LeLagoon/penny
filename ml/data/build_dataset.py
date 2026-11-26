# Builds ml/data/train.csv and test.csv.
# All phrases are hand-written, not real transactions. The test set uses different merchants and
# phrasings so it checks generalisation. Swap in real anonymised data if you ever get it.
import csv
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

TRAIN = {
    "food": [
        "Swiggy dinner order", "Zomato biryani", "Domino's pizza medium", "Starbucks latte", "Campus canteen lunch",
        "Hostel mess monthly fee", "Maggi and chai at tapri", "Chipotle burrito bowl", "Trader Joe's weekly groceries",
        "McDonald's McAloo meal", "KFC bucket", "Blinkit groceries", "BigBasket vegetables", "Dining hall meal swipe",
        "Panera soup and bread", "Subway footlong", "Haldiram's snacks", "UPI/SWIGGY INSTAMART/8841123/OK",
        "POS 4421 COSTA COFFEE", "Dunkin donuts", "Tesco meal deal", "Pret a Manger sandwich", "Greggs sausage roll",
        "Lidl weekly shop", "Tim Hortons double double", "Uber Eats pad thai", "DoorDash order", "Burger King whopper",
        "Pizza Hut cheese burst", "Cafe Coffee Day cold coffee", "dosa at Saravana Bhavan", "midnight maggi", "D-Mart grocery shopping",
        "Zepto milk and eggs", "fruit and veg market", "boba tea", "ice cream parlour", "dinner with roommates",
        "birthday cake from bakery", "lunch at cafeteria", "Wendy's frosty", "Taco Bell crunchwrap", "Five Guys",
        "Sweetgreen salad", "Whole Foods", "Aldi shop", "Carrefour groceries", "sushi takeaway", "ramen with friends",
        "tiffin service monthly", "street food chaat", "vada pav", "Deliveroo curry", "Just Eat order",
    ],
    "travel": [
        "Uber ride to campus", "Ola cab airport", "Rapido bike taxi", "Metro card recharge", "Monthly bus pass",
        "IRCTC train ticket Pune to Mumbai", "redBus ticket home", "IndiGo flight Delhi", "Air India web booking", "Petrol for bike",
        "Lyft to downtown", "Amtrak Boston to NYC", "Oyster card top up", "TfL contactless", "National Rail advance ticket",
        "Eurostar London Paris", "FlixBus Berlin Munich", "Delta Airlines flight", "Southwest flight", "parking fee garage",
        "toll plaza fastag recharge", "auto rickshaw fare", "Bird scooter ride", "Lime e-scooter", "Clipper card load",
        "BART fare", "MTA subway MetroCard", "Opal card top up", "Myki top up", "Uber trip", "taxi to railway station",
        "local train season ticket", "shuttle bus fare", "Yulu bike rental", "BlaBlaCar ride", "ride share to airport",
        "Bolt ride", "SNCF TGV ticket", "Deutsche Bahn Sparpreis", "Singapore MRT EZ-Link top up", "gas station fill up",
        "Shell fuel", "diesel for car", "airport cab", "cab to hostel", "ferry ticket", "Greyhound bus", "weekend trip train fare",
    ],
    "education": [
        "Algorithms textbook", "campus bookstore purchase", "Chegg rental", "Coursera subscription", "Udemy python course",
        "library fine", "exam fee semester 3", "lab fee", "course registration fee", "notebooks and pens",
        "stationery shop", "xerox and printouts", "photocopy of notes", "scientific calculator", "TI-84 graphing calculator",
        "Kindle book", "edX certificate", "IEEE membership", "hackathon registration fee", "drawing board and drafter",
        "Pearson eText", "McGraw Hill Connect access code", "Quizlet Plus", "tuition fee installment", "semester fee payment",
        "admission fee", "workshop fee", "conference registration", "journal subscription", "GRE exam registration",
        "IELTS fee", "TOEFL test fee", "lab coat and goggles", "engineering drawing sheets", "Linear algebra reference book",
        "Blue book exam booklets", "printing project report", "binding of thesis", "online course Skillshare", "LeetCode premium",
        "Duolingo Plus", "Notion education plan", "Overleaf subscription", "Springer book chapter", "NPTEL certification fee",
        "university transcript fee", "bookstore used textbooks", "language class fee",
    ],
    "technology": [
        "MacBook charger", "USB-C cable", "wireless mouse", "mechanical keyboard", "Sony headphones", "AirPods Pro",
        "power bank 20000mAh", "Jio recharge", "Airtel postpaid bill", "Vi recharge", "broadband bill", "WiFi router",
        "iCloud storage", "Google One", "GitHub Copilot", "ChatGPT Plus", "screen guard for phone", "HDMI adapter",
        "external SSD 1TB", "iPad stylus", "Best Buy electronics", "Verizon wireless bill", "T-Mobile plan", "Comcast internet",
        "laptop repair", "phone screen replacement", "Dell monitor", "webcam", "USB flash drive", "Raspberry Pi kit",
        "Arduino starter kit", "Samsung Galaxy case", "Apple Store purchase", "OnePlus buds", "Logitech MX Master",
        "Notion subscription", "Adobe Creative Cloud", "domain name renewal", "VPN subscription", "Microsoft 365",
        "Spectrum internet", "Vodafone prepaid", "EE mobile contract", "Amazon Kindle device", "laptop sleeve",
        "gaming mouse pad", "cooling pad for laptop", "phone tripod", "SIM card top up",
    ],
    "utilities": [
        "PG rent November", "hostel rent", "monthly rent transfer", "electricity bill", "water bill", "gas bill",
        "laundry wash and fold", "dry cleaning", "room maintenance charges", "maid salary", "cook salary",
        "society maintenance", "security deposit flat", "broker fee for flat", "LPG cylinder refill", "dorm fee spring",
        "residence hall housing payment", "council tax", "renters insurance", "PG&E energy bill", "ConEd electric bill",
        "heating bill", "room heater", "washing machine coins", "dryer tokens laundromat", "trash and cleaning charges",
        "flat rent split with roommates", "apartment rent", "student accommodation payment", "utility bill split",
        "water tanker", "internet and electricity bill", "monthly housing payment", "rent for December", "airbnb long stay",
        "pest control", "gas cylinder booking", "mess and hostel dues", "landlord payment", "electric meter recharge",
        "prepaid electricity recharge", "room cleaning service", "plumber charges", "AC repair", "iron and ironing service",
        "dormitory fee", "sublet payment", "home insurance",
    ],
    "entertainment": [
        "Netflix subscription", "Spotify Premium", "Hulu monthly", "Disney+ Hotstar", "Apple Music", "YouTube Premium",
        "movie tickets PVR", "INOX cinema", "AMC theatres", "BookMyShow concert", "Ticketmaster show", "StubHub tickets",
        "college fest entry pass", "Steam game purchase", "PlayStation Plus", "Xbox Game Pass", "Nintendo eShop",
        "bowling night", "arcade tokens", "billiards", "board game cafe", "club cover charge", "pub night with friends",
        "HBO Max", "Amazon Prime Video", "SonyLIV", "Zee5 subscription", "JioSaavn Pro", "standup comedy show tickets",
        "Twitch subscription", "Epic Games store", "escape room", "karaoke night", "amusement park tickets", "trampoline park",
        "paintball", "mini golf", "theatre play tickets", "museum entry", "festival wristband", "Discord Nitro",
        "Audible monthly", "Crunchyroll", "Paramount+", "concert merch", "go karting", "movie night snacks and tickets",
        "gaming cafe hourly",
    ],
    "healthcare": [
        "Apollo Pharmacy", "1mg medicines", "PharmEasy order", "CVS prescription", "Walgreens", "Boots pharmacy",
        "doctor consultation", "campus health center copay", "dentist cleaning", "eye test and spectacles", "contact lenses",
        "paracetamol and cough syrup", "vitamin supplements", "multivitamin", "blood test", "lab test full body checkup",
        "physiotherapy session", "therapy session", "counselling fee", "urgent care visit", "hospital bill", "first aid kit",
        "hand sanitizer", "Crocin tablets", "ibuprofen", "Netmeds", "Medplus", "NHS prescription charge", "optician",
        "dental filling", "vaccination", "flu shot", "health insurance premium", "medical store", "ORS and electrolytes",
        "skin doctor", "orthopedic consult", "x-ray charges", "ambulance", "mental health app subscription",
        "Practo appointment", "dermatologist", "pharmacy near hostel", "inhaler refill", "eye drops", "student health plan",
        "antibiotics course", "bandages and antiseptic",
    ],
    "shopping": [
        "Amazon order", "Flipkart purchase", "Myntra clothes", "Ajio order", "Zara jacket", "H&M", "Uniqlo", "Nykaa",
        "Meesho", "new shoes", "sneakers", "backpack", "wallet", "haircut", "barber", "salon", "perfume", "deodorant",
        "jeans", "t-shirts", "hoodie", "winter jacket", "sunglasses", "wristwatch", "Walmart", "Target", "Costco bulk buy",
        "TJ Maxx", "thrift store find", "Urban Outfitters", "Shein haul", "Lenskart sunglasses", "gift for friend birthday",
        "kurta for festival", "formal shirt for placement", "trimmer", "grooming kit", "Decathlon sports shoes",
        "slippers", "bag pack for trip", "stationery and room decor", "home decor items", "bedsheet and pillows",
        "umbrella", "socks and innerwear", "Primark", "ASOS order", "IKEA lamp",
    ],
    "emi": [
        "Credit card EMI", "laptop EMI", "phone EMI installment", "education loan EMI", "student loan payment", "Sallie Mae payment",
        "Nelnet", "Mohela payment", "Bajaj Finserv EMI", "loan repayment", "personal loan EMI", "credit card bill payment",
        "HDFC credit card payment", "SBI card bill", "ICICI credit card due", "Klarna installment", "Afterpay payment", "Affirm payment",
        "CRED bill payment", "no cost EMI iPhone", "monthly installment", "bike loan EMI", "interest on loan", "overdue interest charge",
        "SoFi loan", "Aidvantage", "car loan EMI", "instalment for TV", "loan emi auto debit", "pay later settlement",
        "Simpl bill", "LazyPay due", "Slice card payment", "late fee credit card", "finance charge", "student loan servicer payment",
        "amex bill", "loan prepayment", "equated monthly installment", "BNPL payment", "education loan interest", "credit card minimum due",
        "consumer loan repayment", "scooter finance installment", "fridge EMI", "mortgage payment", "Tata Capital EMI", "Capital One payment",
    ],
    "investment": [
        "Index fund SIP", "Zerodha deposit", "Groww mutual fund", "Vanguard S&P 500 ETF", "Fidelity contribution",
        "Robinhood deposit", "Charles Schwab transfer", "Roth IRA contribution", "401k contribution", "mutual fund SIP",
        "Wealthsimple ETF purchase", "Trade Republic savings plan", "Upstox", "Angel One top up", "fixed deposit",
        "recurring deposit", "PPF contribution", "high yield savings transfer", "HYSA deposit", "Nifty 50 index fund",
        "stock purchase", "buying shares", "gold ETF", "digital gold", "SGB subscription", "ELSS tax saver fund",
        "NPS contribution", "savings plan monthly", "emergency fund transfer", "crypto purchase Coinbase", "Kuvera SIP",
        "Paytm Money", "ETMoney", "Vested international stocks", "Acorns round-ups", "ISA contribution", "Moneybox deposit",
        "Nutmeg", "Freetrade", "treasury bills", "bond purchase", "sinking fund deposit", "Zerodha Coin SIP",
        "Smallcase investment", "Stashaway deposit", "Syfe portfolio top up", "mutual fund lumpsum", "SIP auto debit",
    ],
    "miscellaneous": [
        "ATM cash withdrawal", "paid to Rahul", "UPI transfer to friend", "bank charges", "postage and courier", "passport fee",
        "donation to charity", "unknown merchant", "misc expense", "cash", "gift to sister", "tip", "notary charges",
        "visa application fee", "lost and found fee", "membership dues", "annual bank fee", "SMS charges", "money sent to home",
        "fine for late submission", "temple offering", "pocket money to cousin", "reimbursement", "refund adjustment",
        "forex card load", "currency exchange", "stamp paper", "bank draft charges", "club membership", "charity run entry",
        "payment to xyz", "adjustment entry", "wedding gift envelope", "alumni association fee", "random expense",
        "wire transfer fee", "cash given to roommate", "emergency cash", "NEFT to relative", "FASTag fine",
        "name change affidavit", "photo for id card", "locker rental", "gift cards", "flowers for friend", "something else", "other",
        "paid for group dinner share to friend",
    ],
}

TEST = {
    "food": [
        "Behrouz Biryani", "Burger Singh", "Mad Over Donuts", "Nando's dinner", "Costco food court pizza", "Sainsbury's shop",
        "Eat.Fit meal box", "Rolls Mania kathi roll", "Chaayos chai", "mosambi juice centre", "late night Zomato order",
        "Kroger groceries", "Panda Express", "tea and samosa canteen", "Faasos wrap", "Haldiram", "veggies from Reliance Fresh",
        "POS 7781 PRET A MANGER", "UPI-SWIGGY-9087@ybl", "pizza night with the hostel gang", "Cafe Nero flat white", "Domino's",
        "McDonalds", "biryani", "morning coffee",
    ],
    "travel": [
        "Uber", "Ola Mini to Hinjewadi", "Rapido", "Pune metro smart card", "PMPML bus pass", "IRCTC", "Vistara flight booking",
        "Lufthansa ticket", "petrol pump HP", "FASTag recharge", "Gett taxi", "BlaBlaCar", "NJ Transit", "Caltrain monthly",
        "cab to the airport", "UPI-OLACABS-5541@paytm", "train ticket for diwali", "auto fare", "RyanAir Dublin", "KSRTC bus",
        "parking at mall", "Uber ride home", "ICE train Frankfurt", "bike taxi", "flight to Goa",
    ],
    "education": [
        "Class notes printout", "Cormen textbook", "Springer ebook", "college library fine", "GATE exam fee", "CAT mock tests subscription",
        "Unacademy plus", "stationery - pens notebooks", "course fee installment", "NPTEL exam", "SAT registration", "lab record book",
        "xerox 50 pages", "Coursera Plus annual", "Great Learning program fee", "tutor fee", "tuition class payment", "semester registration",
        "university exam form", "hackathon entry", "project report printing and binding", "Chegg study", "engineering graphics sheets",
        "O'Reilly learning", "online coding bootcamp",
    ],
    "technology": [
        "Airtel recharge 599", "Jio fiber bill", "OnePlus charger", "HP laptop service", "Boat earphones", "mechanical keyboard switches",
        "Samsung SSD", "iPhone screen guard", "Dropbox plus", "Cloudflare domain", "Hostinger hosting", "Mac mini",
        "phone repair shop", "BSNL broadband", "Lenovo mouse", "USB hub", "Google Workspace", "Anker power bank", "Apple iCloud+",
        "Netgear router", "Bluetooth speaker", "Cursor pro subscription", "Replit core", "OpenAI API credits", "SIM recharge",
    ],
    "utilities": [
        "Rent - Nov", "PG fees", "flat rent share", "BESCOM electricity", "Tata Power bill", "Mahanagar gas bill", "laundry service",
        "hostel mess dues", "housing fee semester", "Thames Water", "British Gas", "maintenance charges society", "drycleaner",
        "house help payment", "deposit for new flat", "Airbnb monthly stay", "gas refill", "hostel room rent", "NoBroker rent payment",
        "Con Edison", "utilities split with roommates", "apartment cleaning service", "water cooler rent", "plumbing repair", "electricity prepaid",
    ],
    "entertainment": [
        "Netflix", "Spotify", "Prime Video renewal", "Hotstar", "movie with friends INOX", "concert tickets", "Steam sale",
        "PS5 game", "club entry", "pub quiz night", "bowling", "gaming zone", "Spotify Duo", "Apple TV+", "Peacock", "college fest passes",
        "stand up comedy night", "Valorant skins", "Cinepolis", "YouTube music", "Sunburn festival ticket", "laser tag", "Dice board game cafe",
        "Netflix and chill snacks", "Roblox robux",
    ],
    "healthcare": [
        "Apollo clinic", "1mg order", "MedPlus", "doctor visit", "dental checkup", "specs from Lenskart eye test", "Dolo 650",
        "Vitamin D tablets", "campus clinic", "blood sugar test", "Boots", "health checkup package", "physio", "prescription pickup",
        "Walgreens flu shot", "Cipla medicines", "counselor session", "eye checkup", "Pharmacy", "antiseptic and band-aids",
        "cough syrup", "skin clinic consult", "Tata 1mg lab test", "ER copay", "student health insurance",
    ],
    "shopping": [
        "Amazon.in", "Flipkart", "Myntra", "Zara", "Nike shoes", "Adidas", "Levi's jeans", "Pantaloons", "Westside", "Max Fashion",
        "Lifestyle store", "haircut at salon", "Bombay Shaving Company", "Decathlon", "Lenskart", "bought a backpack",
        "Forever 21", "Sephora", "Etsy order", "eBay purchase", "birthday gift", "clothes shopping", "Bath and Body Works",
        "Skechers", "Puma store",
    ],
    "emi": [
        "HDFC card payment", "EMI - laptop", "phone EMI", "loan EMI", "education loan", "Navient payment", "Bajaj EMI", "card bill",
        "credit card outstanding", "Zest money EMI", "ZestMoney", "Klarna", "Affirm", "personal loan instalment", "auto debit EMI",
        "late payment fee card", "SBI card", "Axis bank card bill", "student loan", "OneCard payment", "interest charged", "loan repayment",
        "TVS credit EMI", "monthly instalment", "Paytm postpaid bill",
    ],
    "investment": [
        "SIP", "Groww", "Zerodha", "mutual fund", "index fund", "ETF purchase", "Vanguard", "stock buy", "fixed deposit booking",
        "PPF", "gold bond", "Robinhood", "Coinbase", "Kuvera", "NPS", "RD installment", "Scripbox SIP", "emergency fund",
        "HYSA transfer", "Fidelity", "Nippon India mutual fund", "Mirae asset SIP", "Interactive Brokers deposit", "savings goal transfer",
        "buy Nifty ETF",
    ],
    "miscellaneous": [
        "ATM withdrawal", "cash", "paid Rahul", "bank charges", "courier", "donation", "tip", "misc", "gift", "UPI to friend",
        "passport renewal", "forex", "fine", "something", "payment", "transfer to dad", "annual fee", "notary", "temple donation",
        "sent money home", "cash handed over", "unknown", "membership fee", "adjustment", "pocket money",
    ],
}


def write(name, data, exclude=()):
    rows = []
    seen = set(exclude)
    for cat, items in data.items():
        for text in items:
            key = re.sub(r"\s+", " ", text.lower().strip())
            if key in seen:
                continue
            seen.add(key)
            rows.append((text, cat))
    path = os.path.join(HERE, name)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["text", "category"])
        w.writerows(rows)
    return rows


def norm(t):
    return re.sub(r"\s+", " ", t.lower().strip())


if __name__ == "__main__":
    tr = write("train.csv", TRAIN)
    train_keys = {norm(t) for t, _ in tr}
    # drop test phrases that also appear in train
    dropped = [t for items in TEST.values() for t in items if norm(t) in train_keys]
    te = write("test.csv", TEST, exclude=train_keys)
    print(f"train rows: {len(tr)}, test rows: {len(te)}")
    print(f"dropped {len(dropped)} test phrases that also appear in train: {dropped}")
