import mongoose from 'mongoose';
const Schema = mongoose.Schema;

// Platform-wide settings set by the super admin, one document per key
// (e.g. 'gst_percent' → 18). Read through setting.service.js, which supplies defaults.
const SettingSchema = new Schema({
    key:       { type: String, required: true, unique: true, trim: true },
    value:     { type: Schema.Types.Mixed, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

export default mongoose.model('Setting', SettingSchema, 'settings');
