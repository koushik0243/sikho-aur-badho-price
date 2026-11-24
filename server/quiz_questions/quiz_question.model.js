import mongoose from "mongoose";
const Schema = mongoose.Schema;

const OptionSchema = new Schema(
  { text: { type: String, required: true }, isCorrect: { type: Boolean, default: false } },
  { _id: false }
);

const QuizQuestionSchema = new Schema(
  {
    courseId:    { type: mongoose.Schema.Types.ObjectId, ref: "Course",  required: true },
    chapterId:   { type: mongoose.Schema.Types.ObjectId, ref: "Chapter", required: true },
    quizId:      { type: mongoose.Schema.Types.ObjectId, ref: "Topic",   required: true },
    // The lesson (a Topic with video_type 'lesson') whose video the question was generated
    // from, or that was picked when it was written by hand. Null for older questions.
    lessonId:    { type: mongoose.Schema.Types.ObjectId, ref: "Topic",   default: null },
    question:    { type: String, required: true },
    answer:      { type: String, default: '' },
    options:     [OptionSchema],
    difficulty:  { type: String, enum: ['beginner', 'intermediate', 'advanced'], required: true },
    explanation: { type: String, default: '' },
    batchNumber: { type: Number, default: 1 },
    // How the question came to exist: 'generated' by AI, or 'created' by hand
    // by a super admin in the course builder. (Removal is tracked by deletedAt.)
    status:      { type: String, enum: ['generated', 'created'], default: 'generated' },
    deletedAt:   { type: Date, default: null },
  },
  { timestamps: true }
);

// listQuestions / listQuestionsForLearner / listQuestionsPagination / getQuestionCount /
// generateAndSaveQuestions' lastBatch lookup all filter by { quizId, deletedAt } and sort
// by batchNumber — this compound index covers that hot equality+sort pattern.
QuizQuestionSchema.index({ quizId: 1, deletedAt: 1, batchNumber: 1 });

export default mongoose.model("quiz_questions", QuizQuestionSchema);
