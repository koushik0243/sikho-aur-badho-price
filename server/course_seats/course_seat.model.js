import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Learner seats an organization holds for a course.
//   purchased — learners bought (course purchase orders); only ever goes up.
//   used      — learners the course was assigned to; only ever goes up. Removing a course
//               from a learner does NOT give the seat back.
// Available = purchased − used. Kept as counters (not recounted from assignments) because
// learner course assignments are hard-deleted.
const CourseSeatSchema = new Schema({
  orgId:     { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  courseId:  { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  purchased: { type: Number, default: 0, min: 0 },
  used:      { type: Number, default: 0, min: 0 },
}, { timestamps: true });

CourseSeatSchema.index({ orgId: 1, courseId: 1 }, { unique: true });

export default mongoose.model("course_seats", CourseSeatSchema);
