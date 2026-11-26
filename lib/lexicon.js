// keywords for the rule categoriser. whole-word match only (see rules.js), longer phrases score higher
export const STUDENT_LEXICON = {
  food: [
    'chipotle', 'trader joe', 'whole foods', 'sweetgreen', 'dining hall', 'meal plan', 'panera',
    'dunkin', 'starbucks', 'panda express', 'in-n-out', 'shake shack', 'five guys', 'taco bell',
    'wendys', 'chick-fil-a', 'subway sandwich', 'mcdonalds', "mcdonald's", 'kfc', 'dominos', "domino's", 'pizza', 'burger', 'sandwich',
    'doordash', 'uber eats', 'ubereats', 'grubhub', 'postmates', 'instacart', 'groceries', 'grocery', 'safeway', 'kroger',
    'wegmans', 'aldi', 'target grocery', 'costco food', 'cafe', 'bakery', 'boba', 'ice cream',
    'pret', 'pret a manger', 'greggs', 'tesco', 'sainsburys', 'waitrose', 'm&s food', 'deliveroo',
    'just eat', 'mensa', 'carrefour', 'lidl', 'tim hortons', 'woolworths food', 'coles',
    'canteen', 'mess', 'dabba', 'tiffin', 'chai', 'tapri', 'coffee', 'maggi', 'swiggy', 'zomato',
    'zepto', 'blinkit', 'instamart', 'bigbasket', 'biryani', 'shawarma', 'paratha', 'egg roll', 'kathi roll',
    'samosa', 'snack', 'snacks', 'lunch', 'dinner', 'breakfast', 'haldiram', 'chaat', 'dosa', 'poha',
    'restaurant', 'dhaba', 'juice', 'smoothie', 'milk', 'vegetables', 'fruits', 'fairprice', 'dmart', 'big bazaar',
    'burrito', 'noodles', 'momos', 'thali', 'idli', 'pani puri', 'sushi', 'ramen', 'tacos', 'brunch'
  ],
  travel: [
    'uber', 'lyft', 'subway pass', 'metro', 'mta', 'clipper', 'bart', 'amtrak', 'caltrain',
    'mbta', 'metrocard', 'ventra', 'septa', 'bus', 'transit', 'lime scooter', 'bird scooter', 'scooter',
    'gas station', 'petrol', 'diesel', 'shell petrol', 'chevron', 'exxon', 'parking', 'toll', 'ezpass', 'fastrak',
    'flight', 'airline', 'delta airlines', 'united airlines', 'southwest airlines', 'american airlines',
    'tfl', 'oyster', 'national rail', 'eurostar', 'deutsche bahn', 'flixbus', 'sncf',
    'ttc', 'opal card', 'myki', 'translink', 'ez-link', 'mrt',
    'rapido', 'ola', 'ola cab', 'auto rickshaw', 'rickshaw', 'train', 'irctc', 'smartcard', 'local train',
    'bike rental', 'fare', 'yulu', 'redbus', 'indigo', 'air india', 'cab', 'taxi', 'bolt ride', 'bus ticket', 'train ticket',
    'ride', 'fuel', 'commute', 'travel pass', 'vistara', 'spicejet', 'metro card'
  ],
  education: [
    'book', 'books', 'textbook', 'library', 'library fine', 'bookstore', 'campus bookstore', 'chegg',
    'canvas', 'blackboard', 'pearson', 'mcgraw hill', 'cengage', 'quizlet', 'course hero',
    'lab fee', 'tuition', 'course fee', 'blue book', 'scantron', 'printout', 'xerox',
    'photocopy', 'notebook', 'notebooks', 'binder', 'pen', 'pens', 'stationery', 'calculator',
    'ti-84', 'casio', 'kindle', 'udemy', 'coursera', 'edx', 'exam fee', 'certificate',
    'ieee', 'hackathon fee', 'drafter', 'drawing board', 'semester fee', 'admission fee', 'lab manual',
    'enrollment', 'enrolment', 'course enrollment', 'workshop fee', 'conference fee', 'journal', 'research paper'
  ],
  technology: [
    'laptop', 'macbook', 'charger', 'cable', 'type-c', 'usb', 'mouse', 'keyboard',
    'monitor', 'headphone', 'headphones', 'earphone', 'earphones', 'airpods', 'earbuds', 'powerbank', 'power bank', 'wifi',
    'router', 'broadband', 'fiber', 'fibre', 'icloud', 'google one', 'github', 'copilot',
    'chatgpt', 'software', 'screen guard', 'adapter', 'dongle', 'ssd', 'hard disk',
    'ipad', 'ipad pencil', 'stylus', 'apple store', 'best buy', 'verizon', 'at&t', 't-mobile',
    'jio', 'airtel', 'vi recharge', 'vodafone idea', 'spectrum', 'xfinity', 'comcast', 'mobile recharge', 'prepaid recharge',
    'phone case', 'webcam', 'pendrive', 'flash drive', 'raspberry pi', 'arduino', 'smartphone', 'iphone', 'oneplus', 'samsung galaxy'
  ],
  utilities: [
    'rent', 'dorm', 'residence', 'hostel', 'pg', 'pg rent', 'security deposit', 'room rent', 'electricity',
    'water bill', 'gas bill', 'electric bill', 'pge', 'coned', 'heating', 'heater', 'cooler',
    'laundry', 'washer', 'dryer', 'dry clean', 'dry cleaning', 'cleaning', 'trash', 'maintenance',
    'cook salary', 'maid', 'renters insurance', 'society maintenance', 'flat rent', 'broker fee', 'lpg', 'cylinder', 'wifi bill'
  ],
  entertainment: [
    'netflix', 'spotify', 'hulu', 'hbo max', 'disney', 'disney+', 'apple music',
    'youtube premium', 'movie', 'movies', 'cinema', 'amc', 'regal', 'cinemark', 'pvr', 'inox',
    'ticketmaster', 'stubhub', 'concert', 'fest', 'party', 'bar', 'pub', 'club', 'nightclub',
    'bowling', 'arcade', 'billiards', 'board game', 'steam', 'playstation', 'xbox', 'nintendo',
    'bookmyshow', 'prime video', 'hotstar', 'sonyliv', 'zee5', 'gaana', 'jiosaavn', 'amazon prime', 'standup comedy', 'gaming', 'twitch'
  ],
  healthcare: [
    'pharmacy', 'cvs', 'walgreens', 'rite aid', 'boots', 'superdrug', 'apollo', '1mg', 'pharmeasy', 'netmeds',
    'doctor', 'copay', 'co-pay', 'consultation', 'clinic', 'urgent care', 'campus health',
    'student health', 'hospital', 'dental', 'dentist', 'vision', 'spectacle', 'spectacles', 'lens', 'lenses',
    'medicine', 'medicines', 'ibuprofen', 'advil', 'tylenol', 'paracetamol', 'crocin', 'band-aid',
    'bandage', 'multivitamin', 'vitamins', 'cough syrup', 'first aid', 'sanitizer', 'blood test', 'lab test', 'physio', 'therapy', 'counselling'
  ],
  shopping: [
    'amazon', 'target', 'walmart', 'costco', 'tj maxx', 'marshalls', 'zara', 'h&m',
    'uniqlo', 'urban outfitters', 'thrift', 'goodwill', 'myntra', 'ajio', 'flipkart', 'meesho', 'nykaa',
    'clothes', 'shirt', 'tshirt', 't-shirt', 'jeans', 'hoodie', 'jacket', 'shoes', 'sneakers',
    'backpack', 'wallet', 'haircut', 'barber', 'salon', 'parlour', 'perfume', 'deodorant', 'trimmer', 'sunglasses', 'watch'
  ],
  emi: [
    'sallie mae', 'student loan', 'fafsa', 'nelnet', 'mohela', 'aidvantage', 'sofi',
    'loan', 'emi', 'installment', 'instalment', 'credit card payment', 'credit card bill', 'repayment',
    'interest', 'klarna', 'afterpay', 'affirm', 'cred bill', 'bajaj finserv', 'education loan', 'loan emi'
  ],
  investment: [
    'vanguard', 'fidelity', 'charles schwab', 'robinhood', 'roth ira', '401k',
    'index fund', 'etf', 's&p 500', 'stocks', 'sip', 'mutual fund', 'wealthsimple',
    'trade republic', 'groww', 'zerodha', 'angel one', 'high yield savings', 'hysa', 'fixed deposit', 'recurring deposit', 'nifty', 'upstox', 'ppf'
  ]
};
