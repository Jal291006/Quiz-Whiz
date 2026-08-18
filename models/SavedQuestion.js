const mongoose = require('mongoose');

const savedQuestionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    question: {
        type: String,
        required: true
    },
    options: {
        type: [String],
        required: true
    },
    correctAnswer: {
        type: String,
        required: true
    },
    explanation: {
        type: String
    }
}, { timestamps: true });

savedQuestionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('SavedQuestion', savedQuestionSchema);
