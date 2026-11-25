import mongoose from "mongoose";
const Schema = mongoose.Schema;

// One purchased course in a course order: a snapshot of the title and price at checkout,
// so the order keeps showing what was paid even if the course changes later.
const OrderItemSchema = new Schema({
  courseId:   { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  title:      { type: String, required: true },
  unit_price: { type: Number, required: true, min: 0 },   // price per learner (Rs.)
  learners:   { type: Number, required: true, min: 1 },
  line_total: { type: Number, required: true, min: 0 },   // unit_price × learners
}, { _id: false });

const OrderSchema = new Schema({
  organizer_id:    { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  // 'credit': a credit package (credit_id). 'course': courses bought from the store
  // owner's cart (items). Older orders have no order_type and are credit orders.
  order_type:      { type: String, enum: ['credit', 'course'], default: 'credit' },
  credit_id:       { type: Schema.Types.ObjectId, ref: 'Credit', required: function () { return this.order_type !== 'course'; } },
  items:           { type: [OrderItemSchema], default: undefined },
  // The order's total amount (Rs.) — what was charged. For course orders: the sum of the
  // items' line totals plus GST (gst_amount), if any.
  credit_amount:   { type: Number, required: true, default: 0 },
  // GST on a course order: the rate (0.18 = 18%) and the amount (Rs.) included in
  // credit_amount. 0 for orders without GST (older orders, super admin purchases).
  gst_rate:        { type: Number, default: 0, min: 0 },
  gst_amount:      { type: Number, default: 0, min: 0 },
  purchase_date:   { type: Date, default: Date.now },
  payment_gateway: { type: String, default: 'manual' },
  // Super admin "Add Organization Course": how the organization paid, and the details
  // entered (reference no., cheque/UPI details, notes). Not set for other orders.
  payment_mode:    { type: String, enum: ['online', 'offline', null], default: null },
  payment_details: { type: String, default: null, maxlength: 2000 },
  // Razorpay checkout (store owner cart): the Razorpay order created for this order, and the
  // payment that paid it. The order stays 'pending' until the payment is verified.
  razorpay_order_id:   { type: String, default: null },
  razorpay_payment_id: { type: String, default: null },
  // When the purchase was carried out (learners, courses, invoice added) — set exactly once,
  // so a payment confirmed twice (browser + webhook) is never added twice.
  fulfilled_at:    { type: Date, default: null },
  deletedAt:       { type: Date, default: null },
  status:          { type: String, enum: ['success', 'failed', 'pending', 'canceled', 'refunded'], default: 'pending' },
  createdAt:       { type: Date, default: Date.now },
  updatedAt:       { type: Date, default: Date.now },
});

// listOrder always filters by deletedAt and sorts by createdAt desc (listOrderPagination sorts
// by the clicked column, see order.list_sort.js),
// and buildQuery optionally filters by organizer_id / credit_id (foreign keys with no prior index).
OrderSchema.index({ deletedAt: 1, createdAt: -1 });
OrderSchema.index({ organizer_id: 1, deletedAt: 1 });
OrderSchema.index({ credit_id: 1, deletedAt: 1 });
// Razorpay payment confirmation / webhook finds the order by its Razorpay order id.
OrderSchema.index({ razorpay_order_id: 1 }, { sparse: true });

export default mongoose.model("Order", OrderSchema);
