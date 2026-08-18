const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
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
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

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
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

// --- Auth Routes ---

// Guest Login (Sub-millisecond auth for instant access & live rooms)
app.post('/api/auth/guest', (req, res) => {
    try {
        const { name } = req.body || {};
        let guestName = (name && typeof name === 'string' && name.trim()) ? name.trim().slice(0, 20) : '';
        if (!guestName) {
            guestName = 'Guest_' + Math.floor(1000 + Math.random() * 9000);
        }

        const guestId = 'guest_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
        const token = jwt.sign(
            { userId: guestId, email: null, name: guestName, isGuest: true },
            process.env.JWT_SECRET || 'fallback_secret',
            { expiresIn: '7d' }
        );

        res.json({ token, user: { name: guestName, isGuest: true } });
    } catch (err) {
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
        res.status(500).json({ error: 'Login failed' });
    }
});

// --- History Routes ---
app.post('/api/history', requireAuth, async (req, res) => {
    try {
        if (req.user.isGuest) {
            return res.status(200).json({ message: 'Guest session complete (history not saved to DB)', isGuest: true });
        }
        const attemptData = { ...req.body, userId: req.user.userId };
        const attempt = new QuizAttempt(attemptData);
        await attempt.save();
        res.status(201).json(attempt);
    } catch (err) {
        res.status(500).json({ error: 'Failed to save history' });
    }
});

app.get('/api/history', requireAuth, async (req, res) => {
    try {
        if (req.user.isGuest) {
            return res.json([]);
        }
        const history = await QuizAttempt.find({ userId: req.user.userId }).sort({ createdAt: 1 });
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

app.delete('/api/history', requireAuth, async (req, res) => {
    try {
        if (req.user.isGuest) {
            return res.json({ message: 'Guest history cleared' });
        }
        await QuizAttempt.deleteMany({ userId: req.user.userId });
        res.json({ message: 'History cleared successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to clear history' });
    }
});

app.delete('/api/history/:id', requireAuth, async (req, res) => {
    try {
        if (req.user.isGuest) {
            return res.json({ message: 'Entry deleted' });
        }
        const deletedAttempt = await QuizAttempt.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
        if (!deletedAttempt) {
            return res.status(404).json({ error: 'Attempt not found or not authorized' });
        }
        res.json({ message: 'Entry deleted successfully' });
    } catch (err) {
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
        if (req.user.isGuest) {
            return res.status(400).json({ error: 'Please register an account to save questions across sessions.' });
        }
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
        res.status(500).json({ error: 'Failed to save question' });
    }
});

app.get('/api/saved-questions', requireAuth, async (req, res) => {
    try {
        if (req.user.isGuest) {
            return res.json([]);
        }
        const saved = await SavedQuestion.find({ userId: req.user.userId }).sort({ createdAt: -1 });
        res.json(saved);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch saved questions' });
    }
});

app.delete('/api/saved-questions/:id', requireAuth, async (req, res) => {
    try {
        if (req.user.isGuest) {
            return res.json({ message: 'Deleted' });
        }
        const deleted = await SavedQuestion.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
        if (!deleted) {
            return res.status(404).json({ error: 'Not found' });
        }
        res.json({ message: 'Deleted' });
    } catch (err) {
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

// ============================================================================
// 🎮 REAL-TIME MULTIPLAYER ROOM ENGINE (IN-MEMORY SOCKET.IO)
// High Concurrency: 0 Database Writes during live room play
// ============================================================================

// Map<roomCode, RoomObject>
const activeRooms = new Map();
const MAX_ROOM_PLAYERS = 400;

function generateRoomCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (activeRooms.has(code));
    return code;
}

function getLeaderboardList(room) {
    const list = Array.from(room.players.values()).map(p => ({
        name: p.name,
        score: p.score,
        streak: p.streak || 0
    }));
    list.sort((a, b) => b.score - a.score);
    return list;
}

function emitPlayerQuestion(room, player) {
    const qIndex = player.currentQuestionIndex || 0;

    if (qIndex >= room.questions.length) {
        player.completed = true;
        emitRoomGameOver(room, player.socketId);
        maybeEmitFinalRoomLeaderboard(room);
        return;
    }

    const questionData = room.questions[qIndex];
    player.questionStartTime = Date.now();
    player.answered = false;
    player.lastAnswer = null;

    io.to(player.socketId).emit('question_start', {
        questionIndex: qIndex,
        totalQuestions: room.questions.length,
        question: questionData.question,
        options: questionData.options,
        timePerQuestion: room.timePerQuestion,
        startTime: player.questionStartTime
    });
}

function emitRoomGameOver(room, targetSocketId = null) {
    const finalLeaderboard = getLeaderboardList(room);
    const payload = {
        podium: finalLeaderboard.slice(0, 3),
        leaderboard: finalLeaderboard
    };

    if (targetSocketId) {
        io.to(targetSocketId).emit('room_game_over', payload);
    } else {
        io.to(room.code).emit('room_game_over', payload);
    }
}

function maybeEmitFinalRoomLeaderboard(room) {
    if (room.finalLeaderboardSent) return;

    const players = Array.from(room.players.values());
    if (players.length > 0 && players.every(p => p.completed)) {
        room.finalLeaderboardSent = true;
        room.status = 'ended';
        emitRoomGameOver(room);

        setTimeout(() => {
            activeRooms.delete(room.code);
        }, 600000);
    }
}

io.on('connection', (socket) => {
    // --- Host Creates Room ---
    socket.on('create_room', ({ title, questions, timePerQuestion }) => {
        try {
            if (!Array.isArray(questions) || questions.length === 0) {
                return socket.emit('room_error', { message: 'Invalid questions provided.' });
            }

            const roomCode = generateRoomCode();
            const room = {
                code: roomCode,
                title: title || 'Live Quiz Room',
                hostSocketId: socket.id,
                questions,
                timePerQuestion: Number(timePerQuestion) || 20,
                status: 'lobby', // 'lobby' | 'playing' | 'ended'
                currentQuestionIndex: 0,
                players: new Map(), // socketId -> { socketId, name, score, streak, lastAnswer: null, answered: false }
                questionTimer: null,
                finalLeaderboardSent: false
            };

            const hostPlayer = {
                socketId: socket.id,
                name: 'Host 👑',
                score: 0,
                streak: 0,
                answered: false,
                lastAnswer: null,
                currentQuestionIndex: 0,
                completed: false,
                questionStartTime: null
            };
            room.players.set(socket.id, hostPlayer);

            activeRooms.set(roomCode, room);
            socket.join(roomCode);
            socket.roomCode = roomCode;
            socket.isHost = true;

            socket.emit('room_created', {
                roomCode,
                title: room.title,
                totalQuestions: questions.length,
                timePerQuestion: room.timePerQuestion
            });

            io.to(roomCode).emit('lobby_update', {
                playerCount: room.players.size,
                players: Array.from(room.players.values()).map(p => p.name)
            });
        } catch (err) {
            socket.emit('room_error', { message: 'Failed to create room.' });
        }
    });

    // --- Player Joins or Rejoins Room ---
    socket.on('join_room', ({ roomCode, nickname }) => {
        try {
            const cleanCode = String(roomCode || '').replace(/\D/g, '').trim();
            const room = activeRooms.get(cleanCode);

            if (!room) {
                return socket.emit('room_error', { message: 'Room not found. Check your 6-digit code.' });
            }

            const cleanName = String(nickname || '').trim().slice(0, 20) || 'Player_' + Math.floor(100 + Math.random() * 900);
            const lowerName = cleanName.toLowerCase();

            // Find if player was already in room (Reconnection scenario)
            let existingPlayerKey = null;
            let existingPlayer = null;

            for (const [key, player] of room.players.entries()) {
                if (player.name.toLowerCase() === lowerName) {
                    existingPlayerKey = key;
                    existingPlayer = player;
                    break;
                }
            }

            if (existingPlayer) {
                // Reconnect existing player with preserved score!
                if (existingPlayerKey !== socket.id) {
                    room.players.delete(existingPlayerKey);
                }
                existingPlayer.socketId = socket.id;
                room.players.set(socket.id, existingPlayer);

                socket.join(cleanCode);
                socket.roomCode = cleanCode;
                socket.isHost = false;

                socket.emit('room_joined', {
                    roomCode: cleanCode,
                    title: room.title,
                    nickname: existingPlayer.name,
                    playerCount: room.players.size,
                    isReconnect: true
                });

                if (room.status === 'playing') {
                    emitPlayerQuestion(room, existingPlayer);
                } else if (room.status === 'ended') {
                    emitRoomGameOver(room, socket.id);
                }
                return;
            }

            if (room.status !== 'lobby') {
                return socket.emit('room_error', { message: 'This quiz room has already started.' });
            }

            if (room.players.size >= MAX_ROOM_PLAYERS) {
                return socket.emit('room_error', { message: 'This room is full. Maximum capacity is 400 players.' });
            }

            const player = {
                socketId: socket.id,
                name: cleanName,
                score: 0,
                streak: 0,
                answered: false,
                lastAnswer: null,
                currentQuestionIndex: 0,
                completed: false,
                questionStartTime: null
            };

            room.players.set(socket.id, player);
            socket.join(cleanCode);
            socket.roomCode = cleanCode;
            socket.isHost = false;

            const playerList = Array.from(room.players.values()).map(p => p.name);

            // Confirm join to player
            socket.emit('room_joined', {
                roomCode: cleanCode,
                title: room.title,
                nickname: cleanName,
                playerCount: room.players.size
            });

            // Notify host and room lobby of updated player list
            io.to(cleanCode).emit('lobby_update', {
                playerCount: room.players.size,
                players: playerList
            });
        } catch (err) {
            socket.emit('room_error', { message: 'Failed to join room.' });
        }
    });

    socket.on('leave_room', () => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        const room = activeRooms.get(roomCode);
        if (!room) {
            socket.roomCode = null;
            socket.isHost = false;
            return;
        }

        socket.leave(roomCode);

        if (socket.isHost) {
            if (room.questionTimer) clearTimeout(room.questionTimer);
            io.to(roomCode).emit('room_error', { message: 'Host closed the room.' });
            activeRooms.delete(roomCode);
        } else {
            if (room.status === 'lobby') {
                room.players.delete(socket.id);
            }
            io.to(roomCode).emit('lobby_update', {
                playerCount: room.players.size,
                players: Array.from(room.players.values()).map(p => p.name)
            });
        }

        socket.roomCode = null;
        socket.isHost = false;
    });

    // --- Host Starts Quiz ---
    socket.on('start_room_quiz', () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !socket.isHost) return;

        const room = activeRooms.get(roomCode);
        if (!room || room.status !== 'lobby') return;

        room.status = 'playing';
        room.currentQuestionIndex = 0;

        startQuestionRound(room);
    });

    function startQuestionRound(room) {
        if (!room || room.status === 'ended') return;

        room.status = 'playing';

        for (const player of room.players.values()) {
            player.currentQuestionIndex = 0;
            player.completed = false;
            player.answered = false;
            player.lastAnswer = null;
            emitPlayerQuestion(room, player);
        }

        if (room.questionTimer) clearTimeout(room.questionTimer);
    }

    // --- Player Submits Answer ---
    socket.on('submit_room_answer', ({ selectedOption, answerTimeSeconds }) => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        const room = activeRooms.get(roomCode);
        if (!room || room.status !== 'playing') return;

        const player = room.players.get(socket.id);
        if (!player || player.answered || player.completed) return;

        player.answered = true;
        player.lastAnswer = selectedOption;

        const currentIndex = player.currentQuestionIndex || 0;
        const currentQ = room.questions[currentIndex];
        if (!currentQ) {
            player.completed = true;
            emitRoomGameOver(room, socket.id);
            maybeEmitFinalRoomLeaderboard(room);
            return;
        }

        const isCorrect = String(selectedOption).trim().toLowerCase() === String(currentQ.correctAnswer).trim().toLowerCase();

        if (isCorrect) {
            // Speed bonus (max 1000 pts for instant answer down to 500 pts at end of timer)
            const elapsedSeconds = Number(answerTimeSeconds);
            const fallbackElapsed = player.questionStartTime ? (Date.now() - player.questionStartTime) / 1000 : room.timePerQuestion;
            const safeElapsed = Number.isFinite(elapsedSeconds) ? elapsedSeconds : fallbackElapsed;
            const remainingRatio = Math.max(0, 1 - (safeElapsed / room.timePerQuestion));
            const points = Math.round(500 + (500 * remainingRatio));
            player.score += points;
            player.streak += 1;
        } else {
            player.streak = 0;
        }

        player.currentQuestionIndex = currentIndex + 1;

        let completedCount = 0;
        for (const p of room.players.values()) {
            if (p.completed || (p.currentQuestionIndex || 0) >= room.questions.length) completedCount++;
        }

        io.to(room.hostSocketId).emit('answer_stats', {
            answeredCount: completedCount,
            totalPlayers: room.players.size,
            leaderboard: getLeaderboardList(room).slice(0, 10)
        });

        emitPlayerQuestion(room, player);
    });

    socket.on('skip_question_timer', () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !socket.isHost) return;
        const room = activeRooms.get(roomCode);
        if (!room || room.status !== 'playing') return;
        if (room.questionTimer) clearTimeout(room.questionTimer);
        finishQuestionRound(room);
    });

    function finishQuestionRound(room) {
        if (!room || room.status === 'question_ended' || room.status === 'ended') return;
        room.status = 'question_ended';

        const currentQ = room.questions[room.currentQuestionIndex];
        const leaderboards = getLeaderboardList(room);

        io.to(room.code).emit('question_ended', {
            questionIndex: room.currentQuestionIndex,
            correctAnswer: currentQ.correctAnswer,
            explanation: currentQ.explanation || '',
            leaderboard: leaderboards.slice(0, 10)
        });

        // Auto-advance to next question fast (1.8 seconds)
        if (room.questionTimer) clearTimeout(room.questionTimer);
        room.questionTimer = setTimeout(() => {
            room.currentQuestionIndex += 1;
            startQuestionRound(room);
        }, 1800);
    }

    socket.on('skip_question', () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !socket.isHost) return;
        const room = activeRooms.get(roomCode);
        if (!room) return;
        if (room.questionTimer) clearTimeout(room.questionTimer);
        finishQuestionRound(room);
    });

    function endRoomQuiz(room) {
        if (!room) return;
        room.status = 'ended';

        const finalLeaderboard = getLeaderboardList(room);

        io.to(room.code).emit('room_game_over', {
            podium: finalLeaderboard.slice(0, 3),
            leaderboard: finalLeaderboard
        });

        // Clean up room after 10 minutes
        setTimeout(() => {
            activeRooms.delete(room.code);
        }, 600000);
    }

    // --- Disconnect handling ---
    socket.on('disconnect', () => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        const room = activeRooms.get(roomCode);
        if (!room) return;

        if (socket.isHost) {
            // If host disconnects, inform players and destroy room
            io.to(roomCode).emit('room_error', { message: 'Host disconnected. Room closed.' });
            activeRooms.delete(roomCode);
        } else {
            // Only remove from room if still in lobby.
            // If game is in progress, keep score intact so re-joining with same nickname preserves progress!
            if (room.status === 'lobby') {
                room.players.delete(socket.id);
            }
            io.to(roomCode).emit('lobby_update', {
                playerCount: room.players.size,
                players: Array.from(room.players.values()).map(p => p.name)
            });
        }
    });
});

server.listen(PORT, () => {
    console.log(`AI Quiz app running at http://localhost:${PORT}`);
});
