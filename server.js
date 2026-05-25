const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// CORS and preflight request headers handling for mobile and Flutter Web client requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const JWT_SECRET = 're_library_secret_satin_gold_key_2026';
const GUTENDEX_URL = 'https://gutendex.com';

// BAZA BILAN ISHLASH (NATIVE JSON DATABASE)
function readUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
        fs.writeFileSync(USERS_FILE, JSON.stringify([]));
        return [];
    }
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data || '[]');
}

function writeUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// AUTHENTICATION MIDDLEWARE (Kengaytirilgan va xavfsiz variant)
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    
    // Agar Header umuman kelmagan bo'lsa
    if (!authHeader) {
        return res.status(401).json({ error: 'Ruxsat berilmagan (Authorization Header topilmadi)' });
    }

    // "Bearer <token>" formatini ajratib olish (Bo'sh joylarni tozalash bilan)
    const parts = authHeader.split(' ');
    
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ error: 'Token formati noto\'g\'ri (Format: Bearer <token> bo\'lishi shart)' });
    }

    const token = parts[1]; // Haqiqiy token qismi

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token yaroqsiz yoki muddati o\'tgan' });
        }
        req.user = user;
        next();
    });
}

const apiRouter = express.Router();

// 1. ACCOUNT PAGE: AUTH ENDPOINTS
apiRouter.post('/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const users = readUsers();

        if (users.find(u => u.email === email)) {
            return res.status(400).json({ error: 'Bu email allaqachon ro\'yxatdan o\'tgan' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            id: 'usr_' + Date.now(),
            name: name || email.split('@')[0],
            email,
            password: hashedPassword,
            verified: true,
            preferences: {
                typography: 'Seraph',
                theme: 'warm-sepia'
            },
            wishlist: [],
            library: []
        };

        users.push(newUser);
        writeUsers(users);

        res.status(201).json({ message: 'Muvaffaqiyatli ro\'yxatdan o\'tdingiz' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

apiRouter.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const users = readUsers();
        const user = users.find(u => u.email === email);

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: 'Email yoki parol xato' });
        }

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, message: 'Tizimga muvaffaqiyatli kirdingiz' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

apiRouter.get('/user/profile', authenticateToken, (req, res) => {
    const users = readUsers();
    const user = users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    const { password, ...profileData } = user;
    res.json(profileData);
});

apiRouter.put('/user/preferences', authenticateToken, (req, res) => {
    const { typography, theme } = req.body;
    const users = readUsers();
    const userIndex = users.findIndex(u => u.id === req.user.id);

    if (userIndex === -1) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    if (typography) users[userIndex].preferences.typography = typography;
    if (theme) users[userIndex].preferences.theme = theme;

    writeUsers(users);
    res.json({ message: 'Sozlamalar yangilandi', preferences: users[userIndex].preferences });
});

// 2. HOME & DISCOVER PAGES: BOOK CATALOG (GUTENDEX PROXY)
apiRouter.get('/books', async (req, res) => {
    try {
        const { search, topic } = req.query;
        let url = `${GUTENDEX_URL}/books`;
        const params = {};
        if (search) params.search = search;
        if (topic) params.topic = topic;

        const response = await axios.get(url, { params });
        
        const formattedBooks = response.data.results.map(book => ({
            id: book.id,
            title: book.title,
            author: book.authors[0] ? book.authors[0].name : 'Unknown Author',
            download_count: book.download_count,
            cover_url: book.formats['image/jpeg'] || '',
            text_url: book.formats['text/plain; charset=us-ascii'] || book.formats['text/html'] || '',
            year: book.authors[0] && book.authors[0].birth_year ? book.authors[0].birth_year + 40 : 1813,
            rating: (4.5 + Math.random() * 0.4).toFixed(1)
        }));

        res.json({ count: response.data.count, results: formattedBooks });
    } catch (error) {
        res.status(500).json({ error: 'Gutendex API-dan ma\'lumot olishda xatolik' });
    }
});

// 3. WISHLIST PAGE ENDPOINTS
apiRouter.get('/wishlist', authenticateToken, async (req, res) => {
    try {
        const users = readUsers();
        const user = users.find(u => u.id === req.user.id);
        if (!user || !user.wishlist || !user.wishlist.length) return res.json([]);

        const response = await axios.get(`${GUTENDEX_URL}/books?ids=${user.wishlist.join(',')}`);
        const formattedBooks = response.data.results.map(book => ({
            id: book.id,
            title: book.title,
            author: book.authors[0] ? book.authors[0].name : 'Unknown Author',
            cover_url: book.formats['image/jpeg'] || '',
            year: book.authors[0] && book.authors[0].birth_year ? book.authors[0].birth_year + 40 : 1813,
            rating: 4.7
        }));

        res.json(formattedBooks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

apiRouter.post('/wishlist/toggle', authenticateToken, (req, res) => {
    const { book_id, bookId } = req.body;
    const targetId = book_id || bookId;
    const users = readUsers();
    const userIndex = users.findIndex(u => u.id === req.user.id);

    if (userIndex === -1) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    if (!users[userIndex].wishlist) {
        users[userIndex].wishlist = [];
    }

    const wishlist = users[userIndex].wishlist;
    const idIndex = wishlist.indexOf(targetId);

    if (idIndex > -1) {
        wishlist.splice(idIndex, 1);
    } else {
        wishlist.push(targetId);
    }

    writeUsers(users);
    res.json({ wishlist, count: wishlist.length });
});

// 4. MY LIBRARY & READER PAGES: PROGRESS MANAGEMENT
apiRouter.get('/library', authenticateToken, async (req, res) => {
    try {
        const users = readUsers();
        const user = users.find(u => u.id === req.user.id);
        if (!user || !user.library || !user.library.length) return res.json([]);

        const bookIds = user.library.map(b => b.book_id || b.bookId).join(',');
        const response = await axios.get(`${GUTENDEX_URL}/books?ids=${bookIds}`);

        const detailedLibrary = response.data.results.map(book => {
            const userBookInfo = user.library.find(b => (b.book_id === book.id || b.bookId === book.id));
            return {
                id: book.id,
                title: book.title,
                author: book.authors[0] ? book.authors[0].name : 'Unknown Author',
                cover_url: book.formats['image/jpeg'] || '',
                progress: userBookInfo ? userBookInfo.progress : 0,
                last_chapter: userBookInfo ? userBookInfo.last_chapter || userBookInfo.lastChapter : 1
            };
        });

        res.json(detailedLibrary);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

apiRouter.post('/library/progress', authenticateToken, (req, res) => {
    const { book_id, bookId, progress, last_chapter, lastChapter } = req.body;
    const targetBookId = book_id || bookId;
    const targetProgress = progress;
    const targetLastChapter = last_chapter || lastChapter;

    const users = readUsers();
    const userIndex = users.findIndex(u => u.id === req.user.id);

    if (userIndex === -1) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    if (!users[userIndex].library) {
        users[userIndex].library = [];
    }

    const library = users[userIndex].library;
    const book = library.find(b => (b.book_id === targetBookId || b.bookId === targetBookId));

    if (book) {
        book.progress = targetProgress;
        book.last_chapter = targetLastChapter;
    } else {
        library.push({ book_id: targetBookId, progress: targetProgress, last_chapter: targetLastChapter });
    }

    writeUsers(users);
    res.json({ message: 'Progress saqlandi', library: users[userIndex].library });
});

app.use('/api', apiRouter);
app.use('/api/v1', apiRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`reLibrary Engine running on port ${PORT}...`));
