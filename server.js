const express = require('express');
const fs = require('fs');
const path = require('path');
const compression = require('compression');
const { GoogleGenAI } = require('@google/genai');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const User = require('./models/User');
const QuizAttempt = require('./models/QuizAttempt');
const SavedQuestion = require('./models/SavedQuestion');

function loadEnvFile() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) {
        return;
    }

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    lines.forEach((line) => {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#')) {
            return;
        }

        const separatorIndex = trimmedLine.indexOf('=');
        if (separatorIndex === -1) {
            return;
        }

        const key = trimmedLine.slice(0, separatorIndex).trim();
        const value = trimmedLine.slice(separatorIndex + 1).trim();

        if (key && !process.env[key]) {
            process.env[key] = value;
        }
    });
}

loadEnvFile();

const app = express();

const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

// HTTP Response Compression & Static Asset Caching
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// Connect to MongoDB with Connection Pool Optimization
if (process.env.MONGODB_URI) {
    mongoose.connect(process.env.MONGODB_URI, { family: 4, maxPoolSize: 15 })
        .then(() => console.log('Connected to MongoDB (maxPoolSize: 15)'))
        .catch(err => console.error('MongoDB connection error:', err));
} else {
    console.warn('MONGODB_URI is not set in .env file. Database features will not work.');
}

// Authentication Middleware
const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
        if (!decoded.userId || !mongoose.Types.ObjectId.isValid(decoded.userId)) {
            return res.status(401).json({ error: 'Session expired or invalid. Please re-login.' });
        }
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

// --- Auth Routes ---
const crypto = require('crypto');

// Guest Login (Creates a persistent Guest User in MongoDB)
app.post('/api/auth/guest', async (req, res) => {
    try {
        const { name } = req.body || {};
        let guestName = (name && typeof name === 'string' && name.trim()) ? name.trim().slice(0, 20) : '';
        if (!guestName) {
            guestName = 'Guest_' + crypto.randomInt(1000, 9999).toString();
        }

        const guestId = new mongoose.Types.ObjectId();
        const guestEmail = `guest_${guestId.toString()}@quizwizz.local`;
        const randomPass = crypto.randomBytes(16).toString('hex');
        const hashedPassword = await bcrypt.hash(randomPass, 8);

        const guestUser = new User({
            _id: guestId,
            name: guestName,
            email: guestEmail,
            password: hashedPassword
        });
        await guestUser.save();

        const token = jwt.sign(
            { userId: guestUser._id, email: guestUser.email, name: guestUser.name, isGuest: true },
            process.env.JWT_SECRET || 'fallback_secret',
            { expiresIn: '30d' }
        );

        res.json({ token, user: { name: guestUser.name, email: guestUser.email, isGuest: true } });
    } catch (err) {
        console.error('Guest login error:', err);
        res.status(500).json({ error: 'Guest login failed' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.status(400).json({ error: 'All fields are required' });
        
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) return res.status(400).json({ error: 'Email already in use' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ name, email: email.toLowerCase(), password: hashedPassword });
        await user.save();

        const token = jwt.sign({ userId: user._id, email: user.email, name: user.name, isGuest: false }, process.env.JWT_SECRET || 'fallback_secret');
        res.json({ token, user: { name: user.name, email: user.email, isGuest: false } });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(400).json({ error: 'Invalid email or password' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Invalid email or password' });

        const token = jwt.sign({ userId: user._id, email: user.email, name: user.name, isGuest: false }, process.env.JWT_SECRET || 'fallback_secret');
        res.json({ token, user: { name: user.name, email: user.email, isGuest: false } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// --- History Routes ---
app.post('/api/history', requireAuth, async (req, res) => {
    try {
        const attemptData = { ...req.body, userId: req.user.userId };
        const attempt = new QuizAttempt(attemptData);
        await attempt.save();
        leaderboardCache = { data: null, timestamp: 0 };
        res.status(201).json(attempt);
    } catch (err) {
        console.error('Save history error:', err);
        res.status(500).json({ error: 'Failed to save history' });
    }
});

app.get('/api/history', requireAuth, async (req, res) => {
    try {
        const history = await QuizAttempt.find({ userId: req.user.userId }).sort({ createdAt: 1 });
        res.json(history);
    } catch (err) {
        console.error('Fetch history error:', err);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

app.delete('/api/history', requireAuth, async (req, res) => {
    try {
        await QuizAttempt.deleteMany({ userId: req.user.userId });
        leaderboardCache = { data: null, timestamp: 0 };
        res.json({ message: 'History cleared successfully' });
    } catch (err) {
        console.error('Clear history error:', err);
        res.status(500).json({ error: 'Failed to clear history' });
    }
});

app.delete('/api/history/:id', requireAuth, async (req, res) => {
    try {
        const deletedAttempt = await QuizAttempt.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
        if (!deletedAttempt) {
            return res.status(404).json({ error: 'Attempt not found or not authorized' });
        }
        leaderboardCache = { data: null, timestamp: 0 };
        res.json({ message: 'Entry deleted successfully' });
    } catch (err) {
        console.error('Delete attempt error:', err);
        res.status(500).json({ error: 'Failed to delete entry' });
    }
});

// --- Leaderboard Route with In-Memory Caching ---
let leaderboardCache = { data: null, timestamp: 0 };
const LEADERBOARD_CACHE_TTL = 45000; // 45 seconds

app.get('/api/leaderboard', async (req, res) => {
    try {
        const now = Date.now();
        if (leaderboardCache.data && (now - leaderboardCache.timestamp < LEADERBOARD_CACHE_TTL)) {
            return res.json(leaderboardCache.data);
        }

        const pipeline = [
            {
                $group: {
                    _id: '$userId',
                    totalScore: { $sum: '$score' },
                    totalQuestions: { $sum: '$totalQuestions' },
                    quizzesTaken: { $sum: 1 }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $project: {
                    name: '$user.name',
                    totalScore: 1,
                    totalQuestions: 1,
                    quizzesTaken: 1,
                    percentage: {
                        $cond: [
                            { $gt: ['$totalQuestions', 0] },
                            { $round: [{ $multiply: [{ $divide: ['$totalScore', '$totalQuestions'] }, 100] }, 0] },
                            0
                        ]
                    }
                }
            },
            { $sort: { totalScore: -1 } },
            { $limit: 50 }
        ];
        
        const leaderboard = await QuizAttempt.aggregate(pipeline);
        leaderboardCache = { data: leaderboard, timestamp: now };
        res.json(leaderboard);
    } catch (err) {
        console.error('Leaderboard error:', err);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

// --- Saved Questions Routes ---
app.post('/api/saved-questions', requireAuth, async (req, res) => {
    try {
        const { question, options, correctAnswer, explanation } = req.body;
        const saved = new SavedQuestion({
            userId: req.user.userId,
            question, 
            options, 
            correctAnswer, 
            explanation
        });
        await saved.save();
        res.status(201).json(saved);
    } catch (err) {
        console.error('Save question error:', err);
        res.status(500).json({ error: 'Failed to save question' });
    }
});

app.get('/api/saved-questions', requireAuth, async (req, res) => {
    try {
        const saved = await SavedQuestion.find({ userId: req.user.userId }).sort({ createdAt: -1 });
        res.json(saved);
    } catch (err) {
        console.error('Fetch saved questions error:', err);
        res.status(500).json({ error: 'Failed to fetch saved questions' });
    }
});

app.delete('/api/saved-questions/:id', requireAuth, async (req, res) => {
    try {
        const deleted = await SavedQuestion.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
        if (!deleted) {
            return res.status(404).json({ error: 'Not found' });
        }
        res.json({ message: 'Deleted' });
    } catch (err) {
        console.error('Delete saved question error:', err);
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// --- Gemini API Helpers ---
async function callGemini(apiKey, prompt, mimeType = 'application/json') {
    const ai = new GoogleGenAI({ apiKey });
    let lastError = null;

    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            console.log(`Calling Gemini API using model: ${GEMINI_MODEL} (attempt ${attempt})`);
            const response = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: prompt,
                config: { responseMimeType: mimeType }
            });
            return response;
        } catch (error) {
            lastError = error;
            const status = error.status || error.code;
            
            if (status === 503 || status === 429) {
                const waitTime = attempt * 1500;
                console.warn(`Model unavailable (${status}), retrying in ${waitTime}ms...`);
                await new Promise((r) => setTimeout(r, waitTime));
                continue;
            }
            
            if (error.message && (error.message.includes('quota') || error.message.includes('429'))) {
                throw new Error('Rate limit exceeded. Please wait a few moments and try again.');
            }
            throw error;
        }
    }

    if (lastError && lastError.message && (lastError.message.includes('quota') || lastError.message.includes('429'))) {
        throw new Error('Rate limit exceeded. Please wait a few moments and try again.');
    }
    if (lastError && (lastError.status === 429 || lastError.code === 429)) {
        throw new Error('Rate limit exceeded. Please wait a few moments and try again.');
    }
    
    throw lastError;
}

function createPrompt({ topic, amount, type, difficulty }) {
    const normalizedType = type === 'true or false' ? 'true/false' : 'multiple-choice';

    return `
Generate exactly ${amount} quiz questions about "${topic}".

Rules:
- Question type: ${normalizedType}
- Difficulty: ${difficulty}
- Return only valid JSON.
- Keep questions clear, fact-based, and suitable for a quiz app.
- For true/false questions, options must be exactly ["True", "False"].
- For multiple-choice questions, provide exactly 4 options.
- The correctAnswer must match one of the options exactly.
- Include a short explanation for each answer.

Return JSON in this shape:
{
  "questions": [
    {
      "question": "string",
      "options": ["string"],
      "correctAnswer": "string",
      "explanation": "string",
      "difficulty": "easy|medium|hard|extreme|true/false"
    }
  ]
}`.trim();
}

function validateGeneratedQuestions(questions, requestedType, requestedAmount) {
    if (!Array.isArray(questions) || questions.length !== requestedAmount) {
        throw new Error('Gemini did not return the expected number of questions.');
    }

    return questions.map((question, index) => {
        if (!question || typeof question.question !== 'string' || !question.question.trim()) {
            throw new Error(`Question ${index + 1} is missing its text.`);
        }

        if (!Array.isArray(question.options)) {
            throw new Error(`Question ${index + 1} is missing options.`);
        }

        if (requestedType === 'true or false') {
            if (question.options.length !== 2 || !question.options.includes('True') || !question.options.includes('False')) {
                throw new Error(`Question ${index + 1} must use True and False options.`);
            }
        } else if (question.options.length !== 4) {
            throw new Error(`Question ${index + 1} must have exactly 4 options.`);
        }

        if (!question.options.includes(question.correctAnswer)) {
            throw new Error(`Question ${index + 1} has an invalid correct answer.`);
        }

        return {
            question: question.question.trim(),
            options: question.options.map((option) => String(option).trim()),
            correctAnswer: String(question.correctAnswer).trim(),
            explanation: question.explanation ? String(question.explanation).trim() : 'No explanation provided.',
            difficulty: requestedType === 'true or false'
                ? 'true/false'
                : String(question.difficulty || 'medium').toLowerCase()
        };
    });
}

app.post('/api/generate-quiz', async (req, res) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({
                error: 'Missing GEMINI_API_KEY. Add it to your environment before using Gemini mode.'
            });
        }

        const { topic, amount, type, difficulty } = req.body || {};

        if (!topic || typeof topic !== 'string') {
            return res.status(400).json({ error: 'Topic is required.' });
        }

        const parsedAmount = Number(amount);
        if (!Number.isInteger(parsedAmount) || parsedAmount < 1 || parsedAmount > 20) {
            return res.status(400).json({ error: 'Amount must be between 1 and 20.' });
        }

        if (!['multiple-choice', 'true or false'].includes(type)) {
            return res.status(400).json({ error: 'Invalid question type.' });
        }

        const normalizedDifficulty = type === 'true or false' ? 'true/false' : difficulty;
        if (!['easy', 'medium', 'hard', 'extreme', 'true/false'].includes(normalizedDifficulty)) {
            return res.status(400).json({ error: 'Invalid difficulty.' });
        }

        const response = await callGemini(apiKey, createPrompt({
            topic: topic.trim(),
            amount: parsedAmount,
            type,
            difficulty: normalizedDifficulty
        }));

        const parsed = JSON.parse(response.text);
        const questions = validateGeneratedQuestions(parsed.questions, type, parsedAmount);

        return res.json({ questions });
    } catch (error) {
        console.error('Gemini quiz generation failed:', error);
        return res.status(500).json({
            error: error.message || 'Unable to generate quiz questions right now.'
        });
    }
});

function createSummaryPrompt(topic) {
    return `Generate a comprehensive "One-page notes" summary about the topic: "${topic}".
Output must be in valid HTML (do NOT wrap in markdown code blocks, just return HTML tags directly).
Include the following sections clearly formatted using standard HTML tags (e.g., <h2>, <ul>, <li>, <p>):
1. Overview/Introduction
2. Key Points
3. Important Formulas or Rules (if applicable to the topic, otherwise skip)
4. Quick Summary
Make it visually appealing by using <strong> for emphasis and structuring it neatly.`;
}

app.post('/api/generate-summary', async (req, res) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY.' });

        const { topic } = req.body || {};
        if (!topic || typeof topic !== 'string') return res.status(400).json({ error: 'Topic is required.' });

        const response = await callGemini(apiKey, createSummaryPrompt(topic.trim()), 'text/plain');
        return res.send(response.text);
    } catch (error) {
        console.error('Gemini summary generation failed:', error);
        return res.status(500).json({ error: error.message || 'Unable to generate summary.' });
    }
});

// --- PDF Upload & Generation Engine ---
const multer = require('multer');
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are supported.'));
        }
    }
});

async function extractTextFromPDF(buffer) {
    try {
        const { PDFParse } = require('pdf-parse');
        if (PDFParse) {
            const parser = new PDFParse({ data: buffer });
            const result = await parser.getText();
            await parser.destroy().catch(() => {});
            if (result && typeof result.text === 'string') {
                return result.text;
            }
            if (typeof result === 'string') {
                return result;
            }
        }
        const pdf = require('pdf-parse');
        if (typeof pdf === 'function') {
            const data = await pdf(buffer);
            return data.text;
        }
        throw new Error('PDF parser could not extract text.');
    } catch (err) {
        console.error('PDF text extraction error:', err);
        throw new Error('Failed to extract text from PDF: ' + (err.message || 'Invalid or encrypted PDF'));
    }
}

function createPdfQuizPrompt({ textContent, amount, type, difficulty, filename }) {
    const normalizedType = type === 'true or false' ? 'true/false' : 'multiple-choice';

    return `
You are an expert educator and exam creator. Generate exactly ${amount} high-quality quiz questions strictly based on the following document content (Source file: "${filename || 'Document'}").

Document Text:
"""
${textContent}
"""

Rules:
- Question type: ${normalizedType}
- Difficulty: ${difficulty}
- Ensure every question tests key concepts, facts, or ideas found directly in the document.
- Return ONLY valid JSON matching the schema below, without markdown code fences.
- For true/false questions, options must be exactly ["True", "False"].
- For multiple-choice questions, provide exactly 4 options.
- The correctAnswer must match one of the options exactly.
- Include a short, helpful explanation referencing the document for each question.

Return JSON in this shape:
{
  "questions": [
    {
      "question": "string",
      "options": ["string"],
      "correctAnswer": "string",
      "explanation": "string",
      "difficulty": "easy|medium|hard|extreme|true/false"
    }
  ]
}`.trim();
}

function createPdfSummaryPrompt({ textContent, filename }) {
    return `Generate a comprehensive study notes summary based on the following document: "${filename || 'Document'}".
Document Text:
"""
${textContent}
"""
Output must be formatted in clean, valid HTML tags (do NOT wrap in markdown code blocks, return HTML directly).
Include the following structured sections:
1. Document Overview & Core Theme
2. Key Concepts & Definitions
3. Important Takeaways & Rules
4. Summary & Study Highlights
Use <h2>, <h3>, <ul>, <li>, <p>, and <strong> tags to make it visually readable.`;
}

app.post('/api/generate-quiz-pdf', upload.single('pdf'), async (req, res) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Missing GEMINI_API_KEY. Add it to .env.' });
        }

        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ error: 'Please select a PDF file to upload.' });
        }

        const { amount, type, difficulty } = req.body || {};
        const parsedAmount = Number(amount) || 5;
        const normalizedDifficulty = type === 'true or false' ? 'true/false' : (difficulty || 'medium');
        const normalizedType = type === 'true or false' ? 'true or false' : 'multiple-choice';

        const extractedText = await extractTextFromPDF(req.file.buffer);
        if (!extractedText || extractedText.trim().length < 30) {
            return res.status(400).json({
                error: 'Could not extract sufficient text from this PDF. It may be scanned or image-only.'
            });
        }

        const truncatedText = extractedText.trim().slice(0, 25000);

        const prompt = createPdfQuizPrompt({
            textContent: truncatedText,
            amount: parsedAmount,
            type: normalizedType,
            difficulty: normalizedDifficulty,
            filename: req.file.originalname
        });

        const response = await callGemini(apiKey, prompt);
        const parsed = JSON.parse(response.text);
        const questions = validateGeneratedQuestions(parsed.questions, normalizedType, parsedAmount);

        return res.json({ questions, filename: req.file.originalname });
    } catch (error) {
        console.error('PDF quiz generation failed:', error);
        return res.status(500).json({
            error: error.message || 'Unable to generate questions from this PDF.'
        });
    }
});

app.post('/api/generate-summary-pdf', upload.single('pdf'), async (req, res) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Missing GEMINI_API_KEY.' });
        }

        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ error: 'Please select a PDF file to upload.' });
        }

        const extractedText = await extractTextFromPDF(req.file.buffer);
        if (!extractedText || extractedText.trim().length < 30) {
            return res.status(400).json({
                error: 'Could not extract sufficient text from this PDF. It may be scanned or image-only.'
            });
        }

        const truncatedText = extractedText.trim().slice(0, 25000);
        const prompt = createPdfSummaryPrompt({
            textContent: truncatedText,
            filename: req.file.originalname
        });

        const response = await callGemini(apiKey, prompt, 'text/plain');
        return res.send(response.text);
    } catch (error) {
        console.error('PDF summary generation failed:', error);
        return res.status(500).json({
            error: error.message || 'Unable to generate notes from this PDF.'
        });
    }
});

app.listen(PORT, () => {
    console.log(`AI Quiz app running at http://localhost:${PORT}`);
});
