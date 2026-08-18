const mongoose = require('mongoose');

const quizAttemptSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    category: String,
    categoryLabel: String,
    difficulty: String,
    difficultyLabel: String,
    type: String,
    typeLabel: String,
    totalQuestions: Number,
    answeredQuestions: Number,
    score: Number,
    percentage: Number
}, { timestamps: true });

quizAttemptSchema.index({ userId: 1, createdAt: 1 });
quizAttemptSchema.index({ score: -1 });

module.exports = mongoose.model('QuizAttempt', quizAttemptSchema);
